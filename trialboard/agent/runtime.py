"""Explicit product runtime selection; independent of the coding assistant login."""

import os

from pydantic import SecretStr

from trialboard.agent.codex_provider import CodexChatGPT
from trialboard.agent.dacon_provider import DACON_MODELS, DEFAULT_MODEL, DaconResponses


def runtime_metadata(name: str) -> dict:
    if name == "codex":
        return {
            "provider": "CODEX_CHATGPT",
            "model": os.getenv("TRIALBOARD_CODEX_MODEL") or "CLI_DEFAULT",
            "configured": True,
            "billing": "PERSONAL_CODEX",
        }
    if name != "dacon":
        raise ValueError("RUNTIME_PROVIDER_NOT_ALLOWED")
    model = os.getenv("TRIALBOARD_DACON_MODEL", DEFAULT_MODEL)
    if model not in DACON_MODELS:
        raise ValueError("DACON_MODEL_NOT_ALLOWED")
    return {
        "provider": "DACON_RESPONSES",
        "model": model,
        "configured": bool(os.getenv("TRIALBOARD_DACON_API_KEY", "").strip()),
        "billing": "COMPETITION_TEAM_QUOTA",
    }


def runtime_provider(name: str = "dacon"):
    metadata = runtime_metadata(name)
    if name == "dacon":
        return DaconResponses(
            SecretStr(os.getenv("TRIALBOARD_DACON_API_KEY", "")), metadata["model"]
        )
    return CodexChatGPT(os.getenv("TRIALBOARD_CODEX_MODEL") or None)
