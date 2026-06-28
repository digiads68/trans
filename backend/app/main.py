import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import router, file_store
from app.plugins.manager import PluginManager

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Plugin manager (singleton accessible to routes)
plugin_manager = PluginManager(plugins_dir=settings.PLUGINS_DIR)


async def cleanup_expired_files():
    """Background task to clean up expired files from file_store."""
    while True:
        await asyncio.sleep(settings.FILE_CLEANUP_INTERVAL)
        now = time.time()
        expired = [
            fid for fid, data in file_store.items()
            if now - data.get("created_at", now) > settings.FILE_STORE_TTL
        ]
        for fid in expired:
            data = file_store.pop(fid, None)
            if data:
                upload_path = data.get("upload_path")
                if upload_path and os.path.exists(upload_path):
                    try:
                        os.remove(upload_path)
                    except OSError:
                        pass
                logger.info(f"Cleaned up expired file: {fid}")
        if expired:
            logger.info(f"Cleanup: removed {len(expired)} expired files")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    asyncio.create_task(cleanup_expired_files())
    count = plugin_manager.discover()
    if count:
        logger.info(f"Loaded {count} plugin(s)")
    await plugin_manager.emit_startup()
    logger.info(f"{settings.APP_NAME} v{settings.APP_VERSION} started")

    yield

    # Shutdown
    await plugin_manager.emit_shutdown()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Subtitle Translation System - Translate subtitles from any language to Vietnamese",
    lifespan=lifespan,
)

# CORS - use configured origins, no wildcard with credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(router, prefix="/api")


@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "api": "/api",
    }
