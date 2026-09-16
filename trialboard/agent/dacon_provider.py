"""Competition-only Responses transport. No account fallback or automatic retry."""

from copy import deepcopy

from pydantic import SecretStr

from trialboard.agent.provider import OpenAIResponses

DACON_MODELS = ("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
DEFAULT_MODEL = "gpt-5.6-terra"


class DaconResponses(OpenAIResponses):
    mode = "DACON_RESPONSES"
    endpoint = "https://dacon-apim-hackathon-0903.azure-api.net/hackathon/openai/v1/responses"
    timeout_seconds = 80

    def __init__(self, key: SecretStr, model: str = DEFAULT_MODEL, transport=None):
        if model not in DACON_MODELS:
            raise ValueError("DACON_MODEL_NOT_ALLOWED")
        if not key.get_secret_value().strip():
            raise ValueError("DACON_API_KEY_REQUIRED")
        super().__init__(key, model, transport)
        self.runtime = {"provider": self.mode, "endpoint": self.endpoint}

    def headers(self):
        return {"api-key": self._key.get_secret_value(), "Content-Type": "application/json"}

    def http_error(self, status):
        return {
            401: "DACON_AUTH_FAILED",
            400: "DACON_REQUEST_REJECTED",
            404: "DACON_MODEL_OR_ENDPOINT_UNAVAILABLE",
            429: "DACON_RATE_LIMITED",
            403: "DACON_QUOTA_EXHAUSTED",
        }.get(status, "DACON_HTTP_ERROR")

    def response_notices(self, headers):
        # Never preserve arbitrary headers/body or echo credentials in reports.
        names = (
            "x-team-remaining-quota-tokens",
            "x-team-tokens-consumed",
            "x-team-remaining-tokens",
            "x-team-remaining-requests",
        )
        return tuple(
            f"DACON_ESTIMATE {name}={value}"
            for name in names
            if (value := headers.get(name, "")).isascii() and value.isdigit() and len(value) <= 16
        )

    def output_schema(self, schema):
        # Strict Responses output requires all object properties to be required.
        result = deepcopy(schema)

        def visit(node):
            if isinstance(node, dict):
                if "properties" in node:
                    node["additionalProperties"] = False
                    node["required"] = list(node["properties"])
                for value in node.values():
                    visit(value)
            elif isinstance(node, list):
                for value in node:
                    visit(value)

        visit(result)
        return result
