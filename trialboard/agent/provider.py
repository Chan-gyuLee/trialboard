"""No automatic retries, no arbitrary endpoints, no raw HTTP errors in user reports."""

import json
from dataclasses import dataclass
from typing import Protocol

import httpx
from pydantic import SecretStr


class ModelError(RuntimeError):
    """Only fixed public error codes cross this boundary."""


@dataclass(frozen=True)
class Reply:
    value: dict
    response_id: str
    input_tokens: int
    output_tokens: int
    notices: tuple[str, ...] = ()


class Provider(Protocol):
    mode: str
    model: str

    async def complete(
        self, *, instructions: str, payload: dict, schema: dict, max_output_tokens: int
    ) -> Reply: ...


def parse_json(raw: bytes | str):
    def invalid(_):
        raise ValueError("nonfinite JSON")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    return json.loads(raw, parse_constant=invalid, object_pairs_hook=unique)


class OpenAIResponses:
    mode = "OPENAI_RESPONSES"

    def __init__(self, key: SecretStr, model: str, transport=None):
        if not key.get_secret_value() or not model.strip() or len(model) > 100:
            raise ValueError("MODEL_CONFIGURATION_REQUIRED")
        self._key = key
        self.model = model
        # Tests supply an in-memory transport. Live calls use only the fixed official endpoint.
        self._transport = transport

    async def complete(self, *, instructions, payload, schema, max_output_tokens):
        body = {
            "model": self.model,
            "store": False,
            "instructions": instructions,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": json.dumps(payload, ensure_ascii=False, allow_nan=False),
                        }
                    ],
                }
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "trialboard_result",
                    "strict": True,
                    "schema": schema,
                }
            },
            "max_output_tokens": max_output_tokens,
        }
        encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        if len(encoded) > 100000:
            raise ModelError("MODEL_REQUEST_TOO_LARGE")
        try:
            async with httpx.AsyncClient(
                transport=self._transport,
                trust_env=False,
                follow_redirects=False,
                timeout=httpx.Timeout(30),
            ) as client:
                async with client.stream(
                    "POST",
                    "https://api.openai.com/v1/responses",
                    content=encoded,
                    headers={
                        "Authorization": f"Bearer {self._key.get_secret_value()}",
                        "Content-Type": "application/json",
                    },
                ) as response:
                    if response.status_code != 200:
                        raise ModelError("MODEL_HTTP_ERROR")
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 256000:
                            raise ModelError("MODEL_RESPONSE_TOO_LARGE")
            data = parse_json(raw)
            if data.get("status") != "completed":
                raise ModelError("MODEL_INCOMPLETE")
            contents = [
                c
                for item in data.get("output", [])
                if item.get("type") == "message"
                for c in item.get("content", [])
            ]
            if any(c.get("type") == "refusal" for c in contents):
                raise ModelError("MODEL_REFUSAL")
            texts = [c["text"] for c in contents if c.get("type") == "output_text"]
            if len(texts) != 1:
                raise ModelError("MODEL_OUTPUT_INVALID")
            value = parse_json(texts[0])
            usage = data["usage"]
            counts = [usage["input_tokens"], usage["output_tokens"]]
            if not isinstance(value, dict) or any(type(c) is not int or c < 0 for c in counts):
                raise ModelError("MODEL_OUTPUT_INVALID")
            rid = data["id"]
            if not isinstance(rid, str) or len(rid) > 200:
                raise ModelError("MODEL_OUTPUT_INVALID")
            return Reply(value, rid, *counts)
        except ModelError:
            raise
        except httpx.TimeoutException:
            raise ModelError("MODEL_TIMEOUT") from None
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            raise ModelError("MODEL_RESPONSE_INVALID") from None
