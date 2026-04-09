import asyncio
import logging
import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import router, file_store

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Subtitle Translation System - Translate subtitles from any language to Vietnamese",
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
                # Clean up uploaded file
                upload_path = data.get("upload_path")
                if upload_path and os.path.exists(upload_path):
                    try:
                        os.remove(upload_path)
                    except OSError:
                        pass
                logger.info(f"Cleaned up expired file: {fid}")
        if expired:
            logger.info(f"Cleanup: removed {len(expired)} expired files")


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_expired_files())
    logger.info(f"{settings.APP_NAME} v{settings.APP_VERSION} started")


@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "api": "/api",
    }
