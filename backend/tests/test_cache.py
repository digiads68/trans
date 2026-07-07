"""
Unit tests for translation memory cache.
"""

import asyncio
import os
import pytest


@pytest.fixture(autouse=True)
def use_temp_db(tmp_path, monkeypatch):
    """Use a temporary SQLite database for each test."""
    db_path = str(tmp_path / "test_cache.db")
    monkeypatch.setenv("CACHE_DB_PATH", db_path)
    # Re-init the module with new DB path
    import importlib
    import app.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "_DB_PATH", db_path)
    cache_mod._init_db()
    yield


@pytest.mark.asyncio
async def test_cache_miss_returns_none():
    from app.services.cache import get_cached
    result = await get_cached("zh", "vi", "你好")
    assert result is None


@pytest.mark.asyncio
async def test_cache_set_and_get():
    from app.services.cache import get_cached, set_cached
    await set_cached("zh", "vi", "你好", "Xin chào")
    result = await get_cached("zh", "vi", "你好")
    assert result == "Xin chào"


@pytest.mark.asyncio
async def test_cache_different_lang_pairs():
    from app.services.cache import get_cached, set_cached
    await set_cached("en", "vi", "Hello", "Xin chào")
    # Different source lang → miss
    result = await get_cached("zh", "vi", "Hello")
    assert result is None
    # Correct lang pair → hit
    result = await get_cached("en", "vi", "Hello")
    assert result == "Xin chào"


@pytest.mark.asyncio
async def test_cache_empty_text_not_stored():
    from app.services.cache import get_cached, set_cached
    await set_cached("en", "vi", "", "Xin chào")
    # Empty source text should not be cached
    result = await get_cached("en", "vi", "")
    assert result is None


@pytest.mark.asyncio
async def test_cache_same_source_and_target_not_stored():
    from app.services.cache import get_cached, set_cached
    # Source == translated (no-op) should not be cached
    await set_cached("en", "en", "Hello", "Hello")
    result = await get_cached("en", "en", "Hello")
    assert result is None


@pytest.mark.asyncio
async def test_cache_stats():
    from app.services.cache import get_cached, set_cached, get_cache_stats
    await set_cached("en", "vi", "Hello", "Xin chào")
    await set_cached("zh", "vi", "你好", "Xin chào")
    stats = await get_cache_stats()
    assert stats["total_entries"] >= 2


@pytest.mark.asyncio
async def test_cache_hit_count_increments():
    import app.services.cache as cache_mod
    await cache_mod.set_cached("en", "vi", "Test", "Kiểm tra")
    # First hit
    await cache_mod.get_cached("en", "vi", "Test")
    # Second hit
    await cache_mod.get_cached("en", "vi", "Test")
    # Check hit count in DB
    import sqlite3
    conn = sqlite3.connect(cache_mod._DB_PATH)
    row = conn.execute("SELECT hit_count FROM translation_cache").fetchone()
    conn.close()
    assert row[0] >= 2


# ─── Context namespacing (provider/model/mode isolation) ────────────────────

async def test_cache_context_isolation():
    """Different contexts (provider/model/glossary) must not share slots."""
    from app.services.cache import get_cached, set_cached

    await set_cached("en", "vi", "Hello ctx test", "Bản dịch Google", context="google")
    await set_cached("en", "vi", "Hello ctx test", "Bản dịch LLM", context="llm|gpt-4o|standard|abc")

    assert await get_cached("en", "vi", "Hello ctx test", context="google") == "Bản dịch Google"
    assert await get_cached("en", "vi", "Hello ctx test", context="llm|gpt-4o|standard|abc") == "Bản dịch LLM"
    # A third context sees nothing
    assert await get_cached("en", "vi", "Hello ctx test", context="llm|claude|standard|xyz") is None


async def test_cache_default_context_backward_compatible():
    from app.services.cache import get_cached, set_cached
    await set_cached("en", "vi", "No context line", "Không ngữ cảnh")
    assert await get_cached("en", "vi", "No context line") == "Không ngữ cảnh"
