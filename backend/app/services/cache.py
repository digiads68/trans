"""
Translation memory cache using SQLite.
Caches previously translated phrases to reduce API calls and improve speed.
Cache key: (context, source_lang, target_lang, source_text) → translated_text

`context` namespaces entries by provider/model/mode/glossary so a Google
translation is never returned for an LLM request (and vice versa), and
glossary-influenced results don't leak into plain requests.

The DB lives in backend/data/ so translation memory persists across restarts.
"""

import asyncio
import hashlib
import logging
import os
import sqlite3
import time
from typing import Optional

logger = logging.getLogger(__name__)

_DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "data",
    "translation_cache.db",
)
_DB_PATH = os.environ.get("CACHE_DB_PATH", _DEFAULT_DB_PATH)
if os.path.dirname(_DB_PATH):
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
_lock = asyncio.Lock()

# Maximum number of cache entries to prevent unbounded growth
MAX_CACHE_ENTRIES = 100_000
# TTL for cache entries (30 days in seconds)
CACHE_TTL = 30 * 24 * 3600


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _init_db():
    with _get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS translation_cache (
                cache_key   TEXT PRIMARY KEY,
                source_lang TEXT NOT NULL,
                target_lang TEXT NOT NULL,
                source_text TEXT NOT NULL,
                translated  TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                hit_count   INTEGER DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_lang_pair
            ON translation_cache (source_lang, target_lang)
        """)
        conn.commit()


def _make_key(source_lang: str, target_lang: str, source_text: str, context: str = "") -> str:
    raw = f"{context}|{source_lang}|{target_lang}|{source_text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# Initialize DB on import
try:
    _init_db()
except Exception as e:
    logger.warning(f"Translation cache init failed: {e}")


async def get_cached(
    source_lang: str, target_lang: str, source_text: str, context: str = ""
) -> Optional[str]:
    """Look up a translation in the cache. Returns None on miss."""
    if not source_text.strip():
        return None

    key = _make_key(source_lang, target_lang, source_text, context)
    try:
        async with _lock:
            result = await asyncio.to_thread(_get_cached_sync, key)
        return result
    except Exception as e:
        logger.debug(f"Cache get failed: {e}")
        return None


def _get_cached_sync(key: str) -> Optional[str]:
    with _get_connection() as conn:
        row = conn.execute(
            "SELECT translated, created_at FROM translation_cache WHERE cache_key = ?",
            (key,),
        ).fetchone()
        if row is None:
            return None
        translated, created_at = row
        if time.time() - created_at > CACHE_TTL:
            conn.execute("DELETE FROM translation_cache WHERE cache_key = ?", (key,))
            conn.commit()
            return None
        # Update hit count
        conn.execute(
            "UPDATE translation_cache SET hit_count = hit_count + 1 WHERE cache_key = ?",
            (key,),
        )
        conn.commit()
        return translated


async def set_cached(
    source_lang: str,
    target_lang: str,
    source_text: str,
    translated_text: str,
    context: str = "",
) -> None:
    """Store a translation in the cache."""
    if not source_text.strip() or not translated_text.strip():
        return
    # Don't cache if source == translated (no-op translation)
    if source_text.strip() == translated_text.strip():
        return

    key = _make_key(source_lang, target_lang, source_text, context)
    try:
        async with _lock:
            await asyncio.to_thread(
                _set_cached_sync,
                key,
                source_lang,
                target_lang,
                source_text,
                translated_text,
            )
    except Exception as e:
        logger.debug(f"Cache set failed: {e}")


def _set_cached_sync(
    key: str,
    source_lang: str,
    target_lang: str,
    source_text: str,
    translated_text: str,
) -> None:
    with _get_connection() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO translation_cache
               (cache_key, source_lang, target_lang, source_text, translated, created_at, hit_count)
               VALUES (?, ?, ?, ?, ?, ?, 0)""",
            (key, source_lang, target_lang, source_text, translated_text, int(time.time())),
        )
        # Evict oldest entries if over limit
        count = conn.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0]
        if count > MAX_CACHE_ENTRIES:
            excess = count - MAX_CACHE_ENTRIES
            conn.execute(
                """DELETE FROM translation_cache WHERE cache_key IN (
                   SELECT cache_key FROM translation_cache
                   ORDER BY created_at ASC LIMIT ?)""",
                (excess,),
            )
        conn.commit()


async def get_cache_stats() -> dict:
    """Return cache statistics."""
    try:
        async with _lock:
            return await asyncio.to_thread(_get_stats_sync)
    except Exception:
        return {}


def _get_stats_sync() -> dict:
    with _get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0]
        total_hits = conn.execute("SELECT SUM(hit_count) FROM translation_cache").fetchone()[0] or 0
        return {"total_entries": total, "total_hits": total_hits}
