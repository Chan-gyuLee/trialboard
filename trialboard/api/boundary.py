"""Small ASGI boundary for a loopback-only development service.

This is not authentication or a production perimeter. Limit bodies before JSON
parsing, reject non-local browser origins, and do not log submitted content.
"""

import asyncio

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from trialboard.api.models import MAX_BODY_BYTES

DEV_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


class LocalBoundary:
    def __init__(
        self,
        app: ASGIApp,
        design_body_bytes: int | None = None,
        project_body_bytes: int | None = None,
    ):
        self.app = app
        self.design_body_bytes = design_body_bytes
        self.project_body_bytes = project_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)

        async def reject(status: int, code: str) -> None:
            await JSONResponse({"error": {"code": code}}, status_code=status)(scope, receive, send)

        origin = headers.get("origin")
        same_origin = f"{scope['scheme']}://{headers.get('host', '')}"
        if origin and origin not in (*DEV_ORIGINS, same_origin):
            await reject(403, "ORIGIN_NOT_ALLOWED")
            return

        async def safe_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                message = dict(message)
                message["headers"] = [
                    *message.get("headers", []),
                    (b"cache-control", b"no-store"),
                    (b"x-content-type-options", b"nosniff"),
                ]
            await send(message)

        if scope["method"] not in {"POST", "PUT", "PATCH", "DELETE"}:
            await self.app(scope, receive, safe_send)
            return
        body_limit = (
            self.design_body_bytes
            if scope.get("path") in ("/api/design-comparisons", "/api/design-proposals")
            and self.design_body_bytes is not None
            else MAX_BODY_BYTES
        )
        if scope.get("path") in {
            "/api/projects",
            "/api/projects/source-versions",
            "/api/projects/import/preview",
            "/api/projects/import/commit",
        } and self.project_body_bytes is not None:
            body_limit = self.project_body_bytes
        if (
            self.project_body_bytes is not None
            and scope.get("path", "").startswith("/api/research/runs/")
            and scope.get("path", "").endswith("/automation")
        ):
            from trialboard.api.automation import AUTOMATION_BODY_BYTES

            body_limit = AUTOMATION_BODY_BYTES
        content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            await reject(415, "JSON_REQUIRED")
            return
        try:
            declared = int(headers.get("content-length", "0"))
        except ValueError:
            await reject(400, "INVALID_CONTENT_LENGTH")
            return
        if declared < 0:
            await reject(400, "INVALID_CONTENT_LENGTH")
            return
        if declared > body_limit:
            await reject(413, "BODY_TOO_LARGE")
            return

        body = bytearray()
        try:
            async with asyncio.timeout(10):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    if len(body) + len(chunk) > body_limit:
                        await reject(413, "BODY_TOO_LARGE")
                        return
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            await reject(408, "BODY_TIMEOUT")
            return

        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, safe_send)
