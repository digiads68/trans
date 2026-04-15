"""Runtime API configuration store.

Allows users to set/update API keys and base URLs at runtime via REST API
without restarting the backend or editing .env files. Configuration is
persisted to data/runtime_config.json so it survives container restarts.

Empty string values fall back to the static settings defined in app.config.
"""
import json
import os
from threading import Lock

from app.config import settings

_CONFIG_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "data",
    "runtime_config.json",
)
_lock = Lock()
_cache: dict | None = None

DEFAULTS = {
    "cliproxy_api_base": "",  # empty -> fallback to settings.CLIPROXY_API_BASE
    "cliproxy_api_key": "",   # empty -> fallback to settings.CLIPROXY_API_KEY
    "google_translate_enabled": True,
}


def _load() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if os.path.exists(_CONFIG_FILE):
        try:
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            _cache = {**DEFAULTS, **(data if isinstance(data, dict) else {})}
        except (json.JSONDecodeError, OSError):
            _cache = dict(DEFAULTS)
    else:
        _cache = dict(DEFAULTS)
    return _cache


def get_api_base() -> str:
    val = _load().get("cliproxy_api_base") or ""
    return val or settings.CLIPROXY_API_BASE


def get_api_key() -> str:
    val = _load().get("cliproxy_api_key") or ""
    return val or settings.CLIPROXY_API_KEY


def get_google_enabled() -> bool:
    return bool(_load().get("google_translate_enabled", True))


def get_full_config() -> dict:
    """Return public-safe view of config (never expose api_key plaintext)."""
    cfg = _load()
    return {
        "cliproxy_api_base": cfg.get("cliproxy_api_base") or "",
        "cliproxy_api_base_effective": get_api_base(),
        "cliproxy_api_key_set": bool(get_api_key()),
        "cliproxy_api_key_source": "runtime" if (cfg.get("cliproxy_api_key") or "") else ("env" if settings.CLIPROXY_API_KEY else "none"),
        "google_translate_enabled": get_google_enabled(),
    }


def update_config(updates: dict) -> dict:
    """Update one or more keys. Empty string clears the runtime override."""
    global _cache
    with _lock:
        cfg = _load()
        for k in ("cliproxy_api_base", "cliproxy_api_key", "google_translate_enabled"):
            if k in updates:
                cfg[k] = updates[k]
        os.makedirs(os.path.dirname(_CONFIG_FILE), exist_ok=True)
        with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        _cache = cfg
    return get_full_config()


def reset_cache():
    """Test helper to reset the in-memory cache."""
    global _cache
    _cache = None
