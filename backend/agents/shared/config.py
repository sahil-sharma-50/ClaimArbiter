"""Load environment variables and agent credentials."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml
from dotenv import load_dotenv
from band.config import load_agent_config

BACKEND_ROOT = Path(__file__).resolve().parents[2]
# Local dev: config at repo root. Docker: config mounted in /app (backend root).
_parent = BACKEND_ROOT.parent
REPO_ROOT = _parent if (_parent / "frontend").is_dir() else BACKEND_ROOT


def load_env() -> None:
    load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class ProviderConfig:
    aiml_api_key: str
    aiml_base_url: str
    aiml_model: str
    featherless_api_key: str
    featherless_base_url: str
    featherless_model: str
    featherless_vision_model: str


@dataclass(frozen=True)
class BandUrls:
    rest_url: str
    ws_url: str


def get_band_urls() -> BandUrls:
    load_env()
    rest = os.environ.get("THENVOI_REST_URL", "https://app.band.ai/").rstrip("/")
    ws = os.environ.get(
        "THENVOI_WS_URL",
        "wss://app.band.ai/api/v1/socket/websocket",
    )
    return BandUrls(rest_url=rest, ws_url=ws)


def get_provider_config() -> ProviderConfig:
    load_env()
    # Defaults MUST match .env.example and gateway/main.py's DEFAULT_*_MODEL so a run
    # with no model env vars resolves consistently everywhere: AIML gpt-4o (insurer
    # agents), Featherless Llama 3.1 8B (open-weight specialist investigators).
    return ProviderConfig(
        aiml_api_key=os.environ["AIML_API_KEY"],
        aiml_base_url=os.environ.get("AIML_BASE_URL", "https://api.aimlapi.com/v1"),
        aiml_model=os.environ.get("AIML_MODEL", "gpt-4o"),
        featherless_api_key=os.environ["FEATHERLESS_API_KEY"],
        featherless_base_url=os.environ.get(
            "FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1"
        ),
        featherless_model=os.environ.get(
            "FEATHERLESS_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct"
        ),
        featherless_vision_model=os.environ.get(
            "FEATHERLESS_VISION_MODEL", "google/gemma-4-31B-it"
        ),
    )


def get_agent_credentials(name: str) -> tuple[str, str]:
    os.chdir(REPO_ROOT)
    return load_agent_config(name)


def state_dir() -> Path:
    override = os.environ.get("ARBITER_STATE_DIR")
    if override:
        path = Path(override)
        path.mkdir(parents=True, exist_ok=True)
        return path
    return REPO_ROOT


def active_chat_id_path() -> Path:
    return state_dir() / ".active_chat_id"


def upload_dir(chat_id: str) -> Path:
    """Per-claim attachment folder under the shared state volume (no database).

    The gateway writes a custom claim's uploaded photos/PDF here; the Evidence
    Analyst (same container, same volume) reads them back. Keyed by chat_id so
    claims never collide. chat_id is basename-sanitized so it can't escape the dir.
    """
    safe = Path(str(chat_id)).name
    path = state_dir() / "uploads" / safe
    path.mkdir(parents=True, exist_ok=True)
    return path


def read_active_chat_id() -> str | None:
    path = active_chat_id_path()
    if not path.exists():
        return None
    value = path.read_text().strip()
    return value or None


def write_active_chat_id(chat_id: str) -> None:
    active_chat_id_path().write_text(chat_id)


def clear_active_chat_id(chat_id: str | None = None) -> None:
    """Drop the active-chat pointer.

    When ``chat_id`` is given, only clear if it matches the current pointer, so
    archiving a stale session never disturbs a different active one.
    """
    path = active_chat_id_path()
    if not path.exists():
        return
    if chat_id is not None and read_active_chat_id() != chat_id:
        return
    path.unlink(missing_ok=True)
