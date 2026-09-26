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
from app.services import projects

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Plugin manager (singleton accessible to routes)
plugin_manager = PluginManager(plugins_dir=settings.PLUGINS_DIR)


async def cleanup_expired_files():
    """Evict idle projects from memory (they stay on disk) and purge old ones from disk."""
    from app.services import jobs

    while True:
        await asyncio.sleep(settings.FILE_CLEANUP_INTERVAL)
        now = time.time()
        projects.flush_dirty(file_store)
        active = {fid for fid in file_store if (j := jobs.get_job(fid)) and j.is_active}
        idle = [
            fid for fid, data in file_store.items()
            if fid not in active
            and now - (data.get("last_access") or data.get("created_at", now)) > settings.FILE_STORE_TTL
        ]
        for fid in idle:
            projects.save_project(fid, file_store)
            file_store.pop(fid, None)
        purged = projects.purge_expired_on_disk(active)
        if idle or purged:
            logger.info(f"Cleanup: evicted {len(idle)} idle project(s) from memory, purged {purged} from disk")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    loaded = projects.load_all(file_store)
    if loaded:
        logger.info(f"Restored {loaded} project(s) from disk")
    asyncio.create_task(cleanup_expired_files())
    asyncio.create_task(projects.flusher(file_store))
    count = plugin_manager.discover()
    if count:
        logger.info(f"Loaded {count} plugin(s)")
    await plugin_manager.emit_startup()
    logger.info(f"{settings.APP_NAME} v{settings.APP_VERSION} started")

    yield

    # Shutdown
    projects.flush_dirty(file_store)
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
