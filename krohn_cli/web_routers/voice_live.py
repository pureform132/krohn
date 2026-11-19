"""Voice Live routes: capability discovery + the browser Live-client credential.

``KROHN Live`` (the full-duplex voice mode in the web UI) runs entirely in the browser
against the provider's Live WebSocket. The browser cannot set an ``Authorization``
header on a WebSocket upgrade, so the single-user local dashboard hands the caller the
Gemini key over this loopback-only, session-token-guarded route; the key never leaves
the machine it is already configured on. OpenAI's browser path (ephemeral client
secrets + WebRTC) reports ``available: false`` with the exact blocker until an
``OPENAI_API_KEY`` exists.
"""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import APIRouter, Request

from krohn_cli.web_deps import late

router = APIRouter()

_require_token = late("_require_token")

_GEMINI_LIVE_RECOMMENDED = "models/gemini-3.8-live"
_GEMINI_PAGE = "v1beta"
_MODELS_CACHE: dict[str, Any] = {"ts": 0.0, "models": []}
_CACHE_TTL_S = 600

# Static floor so the picker still offers known-good ids when the models listing is
# unreachable (offline, quota) or the key lacks list permission. Verified live against
# the Generative Language API on 2026-11-18.
_FALLBACK_GEMINI_LIVE = [
    {"id": "models/gemini-3.8-live", "displayName": "Gemini 3.8 Live", "music": False, "transcribe": False},
    {"id": "models/gemini-3.1-flash-live-preview", "displayName": "Gemini 3.1 Flash Live (rápido)", "music": False, "transcribe": False},
    {"id": "models/gemini-3.8-live-extended-thinking", "displayName": "Gemini 3.8 Live Extended Thinking", "music": False, "transcribe": False},
]


def _gemini_key() -> str | None:
    for var in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        value = os.environ.get(var)
        if value:
            return value
    return None


def _discover_gemini_live_models(key: str | None) -> list[dict[str, Any]]:
    cached = _MODELS_CACHE
    if cached["ts"] and time.time() - cached["ts"] < _CACHE_TTL_S:
        return cached["models"]
    if not key:
        return []
    try:
        import httpx

        resp = httpx.get(
            f"https://generativelanguage.googleapis.com/{_GEMINI_PAGE}/models",
            params={"key": key, "pageSize": 1000},
            timeout=10.0,
        )
        resp.raise_for_status()
        models = []
        for entry in resp.json().get("models") or []:
            name = str(entry.get("name", ""))
            methods = entry.get("supportedGenerationMethods") or []
            if "bidiGenerateContent" not in methods:
                continue
            label = str(entry.get("displayName") or name.rsplit("/", 1)[-1])
            lowered = name.lower()
            models.append(
                {
                    "id": name,
                    "displayName": label,
                    "music": "lyria" in lowered,
                    "transcribe": "transcribe" in lowered,
                }
            )
        models.sort(key=lambda m: (m["music"], m["transcribe"], m["id"]))
        cached.update(ts=time.time(), models=models)
        return models
    except Exception:
        if not cached["models"]:
            cached.update(ts=time.time(), models=list(_FALLBACK_GEMINI_LIVE))
        return cached["models"]


@router.get("/api/voice/live-key")
async def get_voice_live_key(request: Request):
    """Probe Live-voice providers (loopback + token). Reports availability and, when
    Gemini is configured, the models the local key can actually use."""
    _require_token(request)
    gemini_key = _gemini_key()
    openai_key = os.environ.get("OPENAI_API_KEY")
    gemini = {
        "available": bool(gemini_key),
        "models": _discover_gemini_live_models(gemini_key),
        "recommended": _GEMINI_LIVE_RECOMMENDED,
        "key": gemini_key,
    }
    openai = {
        "available": bool(openai_key),
        "reason": None
        if openai_key
        else "OPENAI_API_KEY no está configurada en .env; añádela y KROHN activa y prueba GPT Live.",
    }
    return {"ok": True, "providers": {"gemini": gemini, "openai": openai}}
