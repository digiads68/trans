from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    APP_NAME: str = "SubTranslator"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    UPLOAD_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
    OUTPUT_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "outputs")

    # ClipProxy API (OpenAI-compatible)
    CLIPROXY_API_BASE: str = "https://api.cliproxyapi.com/v1"
    CLIPROXY_API_KEY: str = ""

    # Available LLM models from cliproxyapi
    AVAILABLE_LLM_MODELS: list[str] = [
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "claude-sonnet-4-20250514",
        "claude-haiku-4-5-20251001",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "deepseek-chat",
        "qwen-turbo",
    ]

    # Google Translate
    GOOGLE_TRANSLATE_ENABLED: bool = True

    # Translation settings
    DEFAULT_TARGET_LANG: str = "vi"
    BATCH_SIZE: int = 20
    MAX_CONCURRENT_REQUESTS: int = 5

    # Future: Video integration plugins
    PLUGINS_DIR: str = "plugins"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.OUTPUT_DIR, exist_ok=True)
