"""
Tests for the translation job architecture:
- Job lifecycle (started → processing → completed)
- Real cancellation mid-translation with partial results kept
- Error classification into Vietnamese user-facing messages
- Per-file job conflict (409)
"""

import asyncio
import time
import pytest
from unittest.mock import AsyncMock, patch

import httpx
import openai
from fastapi.testclient import TestClient


SRT_5 = b"""1
00:00:01,000 --> 00:00:03,000
Line one

2
00:00:04,000 --> 00:00:06,000
Line two

3
00:00:07,000 --> 00:00:09,000
Line three

4
00:00:10,000 --> 00:00:12,000
Line four

5
00:00:13,000 --> 00:00:15,000
Line five

"""


@pytest.fixture(scope="module")
def app():
    from app.main import app as _app
    return _app


@pytest.fixture(scope="module")
def client(app):
    # Context manager keeps ONE event loop across requests so background
    # translation tasks persist between the POST and the status polls.
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_runtime_config(tmp_path, monkeypatch):
    from app.services import runtime_config
    monkeypatch.setattr(runtime_config, "_CONFIG_FILE", str(tmp_path / "rc.json"))
    runtime_config.reset_cache()
    yield
    runtime_config.reset_cache()


def _upload(client, content=SRT_5, filename="job.srt"):
    resp = client.post("/api/upload", files={"file": (filename, content, "text/plain")})
    assert resp.status_code == 200
    return resp.json()["file_id"]


def _wait_job(client, file_id, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/api/translate/{file_id}/status")
        if resp.status_code == 200:
            data = resp.json()
            if data["status"] in ("completed", "error", "cancelled"):
                return data
        time.sleep(0.05)
    raise TimeoutError(f"Job for {file_id} did not finish")


def _make_slow_translator(delay_per_entry=0.15):
    """Translator that honors should_cancel between entries — used to test
    real cancellation."""
    from app.services.translator.base import TranslationCancelled

    mock = AsyncMock()
    mock.provider_name = "slow-mock"

    async def slow_translate(*args, **kwargs):
        entries = kwargs.get("entries")
        should_cancel = kwargs.get("should_cancel")
        on_progress = kwargs.get("on_progress")
        for i, e in enumerate(entries):
            if should_cancel and should_cancel():
                raise TranslationCancelled()
            await asyncio.sleep(delay_per_entry)
            e.translated_text = f"dịch {i + 1}"
            if on_progress:
                await on_progress(i + 1, len(entries), e.original_text)
        return entries

    mock.translate_batch.side_effect = slow_translate
    return mock


def _make_failing_translator(exc):
    mock = AsyncMock()
    mock.provider_name = "failing-mock"

    async def fail(*args, **kwargs):
        raise exc

    mock.translate_batch.side_effect = fail
    return mock


def _openai_error(cls, status_code, message="err"):
    """Build an openai APIStatusError subclass instance for tests."""
    request = httpx.Request("POST", "http://test/v1/chat/completions")
    response = httpx.Response(status_code, request=request)
    return cls(message, response=response, body=None)


class TestJobLifecycle:
    def test_job_completes_and_reports_status(self, client):
        fid = _upload(client)
        with patch("app.api.routes.TranslatorFactory.create") as mc:
            mc.return_value = _make_slow_translator(delay_per_entry=0.01)
            resp = client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "llm_model": "gpt-4o-mini",
                "mode": "standard", "target_lang": "vi",
            })
        assert resp.status_code == 200
        assert resp.json()["status"] == "started"

        status = _wait_job(client, fid)
        assert status["status"] == "completed"
        assert status["completed"] == 5
        assert status["failed"] == 0
        assert status["elapsed_seconds"] >= 0

    def test_concurrent_job_rejected_with_409(self, client):
        fid = _upload(client)
        with patch("app.api.routes.TranslatorFactory.create") as mc:
            mc.return_value = _make_slow_translator(delay_per_entry=0.2)
            r1 = client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "mode": "standard", "target_lang": "vi",
            })
            assert r1.status_code == 200
            r2 = client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "mode": "standard", "target_lang": "vi",
            })
            assert r2.status_code == 409

        client.post(f"/api/translate/{fid}/cancel")
        _wait_job(client, fid)

    def test_new_job_allowed_after_completion(self, client):
        fid = _upload(client)
        with patch("app.api.routes.TranslatorFactory.create") as mc:
            mc.return_value = _make_slow_translator(delay_per_entry=0.01)
            client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "mode": "standard", "target_lang": "vi",
            })
            _wait_job(client, fid)

            r2 = client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "mode": "standard", "target_lang": "vi",
            })
            assert r2.status_code == 200
            _wait_job(client, fid)


class TestCancellation:
    def test_cancel_stops_job_and_keeps_partial(self, client):
        fid = _upload(client)
        with patch("app.api.routes.TranslatorFactory.create") as mc:
            mc.return_value = _make_slow_translator(delay_per_entry=0.25)
            resp = client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "mode": "standard", "target_lang": "vi",
            })
            assert resp.status_code == 200

            # Let a couple of entries finish, then cancel
            time.sleep(0.6)
            cancel_resp = client.post(f"/api/translate/{fid}/cancel")
            assert cancel_resp.status_code == 200

        status = _wait_job(client, fid)
        assert status["status"] == "cancelled"

        # Partially translated entries are kept in the store
        entries = client.get(f"/api/file/{fid}/entries").json()["entries"]
        translated = [e for e in entries if e["translated_text"]]
        assert 0 < len(translated) < 5


class TestErrorClassification:
    def test_auth_error_produces_vietnamese_message(self, client):
        fid = _upload(client)
        exc = _openai_error(openai.AuthenticationError, 401, "Invalid API key")
        with patch("app.api.routes.TranslatorFactory.create") as mc:
            mc.return_value = _make_failing_translator(exc)
            client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "mode": "standard", "target_lang": "vi",
            })
        status = _wait_job(client, fid)
        assert status["status"] == "error"
        assert "API key" in status["error"]
        assert "Error code" not in status["error"]  # no raw SDK noise

    def test_rate_limit_error_message(self, client):
        fid = _upload(client)
        exc = _openai_error(openai.RateLimitError, 429, "rate limited")
        with patch("app.api.routes.TranslatorFactory.create") as mc:
            mc.return_value = _make_failing_translator(exc)
            client.post("/api/translate", json={
                "file_id": fid, "provider": "llm", "mode": "standard", "target_lang": "vi",
            })
        status = _wait_job(client, fid)
        assert status["status"] == "error"
        assert "giới hạn" in status["error"]

    def test_translation_failed_passes_user_message(self, client):
        from app.services.translator.base import TranslationFailed
        fid = _upload(client)
        exc = TranslationFailed("Google Translate liên tục thất bại — thử lại sau.")
        with patch("app.api.routes.TranslatorFactory.create") as mc:
            mc.return_value = _make_failing_translator(exc)
            client.post("/api/translate", json={
                "file_id": fid, "provider": "google", "mode": "standard", "target_lang": "vi",
            })
        status = _wait_job(client, fid)
        assert status["status"] == "error"
        assert "Google Translate" in status["error"]


class TestJobRegistry:
    def test_classify_error_unknown(self):
        from app.services.jobs import classify_error
        msg = classify_error(RuntimeError("boom"))
        assert "boom" in msg

    def test_create_and_conflict(self):
        from app.services import jobs
        job = jobs.create_job("test-file-x", total=10)
        assert job.is_active
        with pytest.raises(jobs.JobConflict):
            jobs.create_job("test-file-x", total=10)
        job.status = "completed"
        job.finished_at = time.time()
        # Now a new job is allowed
        job2 = jobs.create_job("test-file-x", total=5)
        assert job2.total == 5
        job2.status = "completed"
        job2.finished_at = time.time()

    def test_request_cancel_no_job(self):
        from app.services import jobs
        assert jobs.request_cancel("nonexistent-file") is None
