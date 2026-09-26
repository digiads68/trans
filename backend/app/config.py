from pydantic_settings import BaseSettings
import os


class Settings(BaseSettings):
    APP_NAME: str = "SubTranslator"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    UPLOAD_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
    OUTPUT_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "outputs")

    # CORS origins (comma-separated in env, e.g. "http://localhost:5173,http://localhost:3000")
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

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

    # Upload limits
    MAX_UPLOAD_SIZE: int = 50_000_000  # 50MB

    # Projects: evicted from memory after FILE_STORE_TTL idle seconds (kept on
    # disk), deleted from disk after PROJECT_TTL idle seconds.
    FILE_STORE_TTL: int = 7200  # 2 hours idle
    FILE_CLEANUP_INTERVAL: int = 1800  # 30 minutes
    PROJECT_TTL: int = 14 * 86400  # 14 days idle
    PROJECTS_DIR: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "projects")

    # Future: Video integration plugins
    PLUGINS_DIR: str = "plugins"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.OUTPUT_DIR, exist_ok=True)
os.makedirs(settings.PROJECTS_DIR, exist_ok=True)
