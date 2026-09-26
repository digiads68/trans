"""Durable project storage.

A "project" is one uploaded subtitle file plus all its translation work
(entries with statuses, last translation config, ASS header). The in-memory
`file_store` dict in routes.py stays the working copy; this module mirrors it
to backend/data/projects/{file_id}.json so hours of post-editing survive
backend restarts, browser refreshes and memory eviction.
"""

import asyncio
import json
import logging
import os
import time
from typing import Optional

from app.config import settings
from app.models.schemas import FileType, SubtitleEntry

logger = logging.getLogger(__name__)

FLUSH_INTERVAL = 3.0

_dirty: set[str] = set()


def _path(file_id: str) -> str:
    return os.path.join(settings.PROJECTS_DIR, f"{file_id}.json")


def _serialize(file_id: str, data: dict) -> dict:
    file_type = data.get("file_type")
    return {
        "file_id": file_id,
        "filename": data.get("filename"),
        "file_type": file_type.value if hasattr(file_type, "value") else file_type,
        "detected_lang": data.get("detected_lang"),
        "created_at": data.get("created_at"),
        "last_access": data.get("last_access") or data.get("created_at"),
        "last_config": data.get("last_config"),
        "ass_header": data.get("ass_header"),
        "entries": [e.model_dump() for e in data.get("entries", [])],
    }


def _deserialize(raw: dict) -> dict:
    return {
        "filename": raw["filename"],
        "file_type": FileType(raw["file_type"]) if raw.get("file_type") else FileType.SRT,
        "detected_lang": raw.get("detected_lang"),
        "created_at": raw.get("created_at") or time.time(),
        "last_access": raw.get("last_access") or raw.get("created_at") or time.time(),
        "last_config": raw.get("last_config"),
        "ass_header": raw.get("ass_header"),
        "upload_path": None,
        "entries": [SubtitleEntry(**e) for e in raw.get("entries", [])],
    }


def save_project(file_id: str, file_store: dict) -> None:
    """Write the project to disk atomically (tmp file + os.replace)."""
    data = file_store.get(file_id)
    if data is None:
        return
    _dirty.discard(file_id)
    os.makedirs(settings.PROJECTS_DIR, exist_ok=True)
    target = _path(file_id)
    tmp = f"{target}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_serialize(file_id, data), f, ensure_ascii=False)
        os.replace(tmp, target)
    except OSError as e:
        logger.error(f"Failed to save project {file_id}: {e}")


def mark_dirty(file_id: str) -> None:
    """Schedule a debounced save (used for frequent writes like job progress)."""
    _dirty.add(file_id)


def flush_dirty(file_store: dict) -> None:
    for file_id in list(_dirty):
        save_project(file_id, file_store)


async def flusher(file_store: dict) -> None:
    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        flush_dirty(file_store)


def load_project(file_id: str) -> Optional[dict]:
    path = _path(file_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return _deserialize(json.load(f))
    except (OSError, ValueError, KeyError) as e:
        logger.error(f"Failed to load project {file_id}: {e}")
        return None


def load_all(file_store: dict) -> int:
    """Load every project on disk that isn't already in memory."""
    if not os.path.isdir(settings.PROJECTS_DIR):
        return 0
    count = 0
    for name in os.listdir(settings.PROJECTS_DIR):
        if not name.endswith(".json"):
            continue
        file_id = name[:-5]
        if file_id in file_store:
            continue
        data = load_project(file_id)
        if data is not None:
            file_store[file_id] = data
            count += 1
    return count


def delete_project(file_id: str) -> None:
    _dirty.discard(file_id)
    try:
        os.remove(_path(file_id))
    except FileNotFoundError:
        pass


def summarize(file_id: str, data: dict) -> dict:
    entries = data.get("entries", [])
    counts = {"untranslated": 0, "machine": 0, "edited": 0, "reviewed": 0}
    for e in entries:
        counts[e.status] = counts.get(e.status, 0) + 1
    file_type = data.get("file_type")
    return {
        "file_id": file_id,
        "filename": data.get("filename"),
        "file_type": file_type.value if hasattr(file_type, "value") else file_type,
        "detected_lang": data.get("detected_lang"),
        "total": len(entries),
        "translated": len(entries) - counts["untranslated"],
        **counts,
        "created_at": data.get("created_at"),
        "last_access": data.get("last_access") or data.get("created_at"),
        "target_lang": (data.get("last_config") or {}).get("target_lang"),
    }


def list_recent(file_store: dict, limit: int = 30) -> list[dict]:
    """Summaries of all projects (memory + disk), most recently used first."""
    summaries: dict[str, dict] = {
        fid: summarize(fid, data) for fid, data in file_store.items()
    }
    if os.path.isdir(settings.PROJECTS_DIR):
        for name in os.listdir(settings.PROJECTS_DIR):
            fid = name[:-5]
            if not name.endswith(".json") or fid in summaries:
                continue
            data = load_project(fid)
            if data is not None:
                summaries[fid] = summarize(fid, data)
    return sorted(summaries.values(), key=lambda s: s["last_access"] or 0, reverse=True)[:limit]


def purge_expired_on_disk(active_ids: set[str]) -> int:
    """Delete project files idle longer than PROJECT_TTL."""
    if not os.path.isdir(settings.PROJECTS_DIR):
        return 0
    now = time.time()
    removed = 0
    for name in os.listdir(settings.PROJECTS_DIR):
        if not name.endswith(".json"):
            continue
        fid = name[:-5]
        if fid in active_ids:
            continue
        path = _path(fid)
        try:
            with open(path, encoding="utf-8") as f:
                last = json.load(f).get("last_access") or 0
        except (OSError, ValueError):
            last = os.path.getmtime(path)
        if now - last > settings.PROJECT_TTL:
            delete_project(fid)
            removed += 1
    return removed
