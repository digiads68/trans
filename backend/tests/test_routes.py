"""
Integration tests for the REST API routes.
Tests upload, file listing, and export endpoints using the FastAPI test client.
Translator calls are mocked to avoid real API calls.
"""

import asyncio
import io
import pytest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport


# ─── Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    """Create app for testing."""
    from app.main import app as _app
    return _app


@pytest.fixture(scope="module")
def client(app):
    """Synchronous test client for simple tests."""
    return TestClient(app)


SRT_CONTENT = b"""1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:05,000 --> 00:00:07,000
Second line
"""

ASS_CONTENT = b"""[Script Info]
Title: Test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Second line
"""

VTT_CONTENT = b"""WEBVTT

1
00:00:01.000 --> 00:00:03.000
Hello world

2
00:00:05.000 --> 00:00:07.000
Second line
"""


# ─── Health check ───────────────────────────────────────────────────────────

def test_health_check(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


# ─── Models endpoint ────────────────────────────────────────────────────────

def test_get_models(client):
    resp = client.get("/api/models")
    assert resp.status_code == 200
    data = resp.json()
    assert "llm_models" in data
    assert "providers" in data
    assert "modes" in data
    assert len(data["llm_models"]) > 0


def test_add_model(client):
    resp = client.post("/api/models/add", json={"model": "test-model-xyz"})
    assert resp.status_code == 200
    assert "test-model-xyz" in resp.json()["models"]


def test_remove_model(client):
    # First add, then remove
    client.post("/api/models/add", json={"model": "to-be-removed"})
    resp = client.delete("/api/models/to-be-removed")
    assert resp.status_code == 200
    assert "to-be-removed" not in resp.json()["models"]


def test_remove_nonexistent_model(client):
    resp = client.delete("/api/models/definitely-not-there")
    assert resp.status_code == 404


# ─── Upload ─────────────────────────────────────────────────────────────────

def test_upload_srt(client):
    resp = client.post(
        "/api/upload",
        files={"file": ("test.srt", SRT_CONTENT, "text/plain")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["file_type"] == "srt"
    assert data["total_entries"] == 2
    assert data["file_id"]
    assert len(data["entries"]) <= 10


def test_upload_ass(client):
    resp = client.post(
        "/api/upload",
        files={"file": ("test.ass", ASS_CONTENT, "text/plain")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["file_type"] == "ass"
    assert data["total_entries"] == 2


def test_upload_vtt(client):
    resp = client.post(
        "/api/upload",
        files={"file": ("test.vtt", VTT_CONTENT, "text/plain")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["file_type"] == "vtt"
    assert data["total_entries"] == 2


def test_upload_unsupported_format(client):
    resp = client.post(
        "/api/upload",
        files={"file": ("test.mkv", b"fake content", "video/x-matroska")},
    )
    assert resp.status_code == 400
    assert "Unsupported" in resp.json()["detail"]


def test_upload_oversized_file(client):
    # 51MB of zeros
    big_content = b"x" * (51 * 1024 * 1024)
    resp = client.post(
        "/api/upload",
        files={"file": ("big.srt", big_content, "text/plain")},
    )
    assert resp.status_code == 413


# ─── File entries endpoint ───────────────────────────────────────────────────

def test_get_file_entries(client):
    # Upload first
    up = client.post(
        "/api/upload",
        files={"file": ("test.srt", SRT_CONTENT, "text/plain")},
    )
    file_id = up.json()["file_id"]

    resp = client.get(f"/api/file/{file_id}/entries")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["entries"]) == 2


def test_get_file_entries_pagination(client):
    up = client.post(
        "/api/upload",
        files={"file": ("test.srt", SRT_CONTENT, "text/plain")},
    )
    file_id = up.json()["file_id"]

    resp = client.get(f"/api/file/{file_id}/entries?page=1&page_size=1")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["entries"]) == 1


def test_get_file_entries_not_found(client):
    resp = client.get("/api/file/nonexistent/entries")
    assert resp.status_code == 404


# ─── Export (requires translation) ──────────────────────────────────────────

def test_export_requires_translation(client):
    up = client.post(
        "/api/upload",
        files={"file": ("test.srt", SRT_CONTENT, "text/plain")},
    )
    file_id = up.json()["file_id"]

    resp = client.get(f"/api/export/{file_id}?format=srt")
    assert resp.status_code == 400
    assert "No translations" in resp.json()["detail"]


def test_export_not_found(client):
    resp = client.get("/api/export/badid?format=srt")
    assert resp.status_code == 404


# ─── Manual entry update ────────────────────────────────────────────────────

def test_update_entry(client):
    up = client.post(
        "/api/upload",
        files={"file": ("test.srt", SRT_CONTENT, "text/plain")},
    )
    file_id = up.json()["file_id"]

    resp = client.put(
        f"/api/file/{file_id}/entry/1",
        params={"translated_text": "Chào thế giới"},
    )
    assert resp.status_code == 200
    assert resp.json()["translated_text"] == "Chào thế giới"


# ─── Cache stats ────────────────────────────────────────────────────────────

def test_cache_stats_endpoint(client):
    resp = client.get("/api/cache/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_entries" in data


# ─── Batch upload ────────────────────────────────────────────────────────────

def test_batch_upload(client):
    resp = client.post(
        "/api/upload/batch",
        files=[
            ("files", ("a.srt", SRT_CONTENT, "text/plain")),
            ("files", ("b.vtt", VTT_CONTENT, "text/plain")),
        ],
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_files"] == 2
    assert data["total_entries"] == 4
    for f in data["files"]:
        assert f["file_id"]
