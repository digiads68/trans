"""
Translator post-editing workflow:
- projects persist to disk and reload after eviction/restart
- re-running translation never wipes human edits (scope + merge)
- line statuses, bulk updates, retranslation with stored config
- export options (bilingual, untranslated handling, batch ZIP)
- ASS/SRT formatting tags survive round-trip
"""

import asyncio
import io
import os
import time
import zipfile
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

SRT_3 = b"""1
00:00:01,000 --> 00:00:03,000
Hello

2
00:00:04,000 --> 00:00:06,000
{\\an8}<i>Look up</i>

3
00:00:07,000 --> 00:00:09,000
Goodbye

"""

ASS_SAMPLE = b"""[Script Info]
Title: Demo
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sign,Impact,60,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,8,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,0:00:01.00,0:00:03.00,Sign,Hero,0,0,0,,{\\an8}Hello there
Dialogue: 0,0:00:04.00,0:00:06.00,Sign,,0,0,0,,Second line
"""


@pytest.fixture(scope="module")
def app():
    from app.main import app as _app
    return _app


@pytest.fixture(scope="module")
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_runtime_config(tmp_path, monkeypatch):
    from app.services import runtime_config
    monkeypatch.setattr(runtime_config, "_CONFIG_FILE", str(tmp_path / "rc.json"))
    runtime_config.reset_cache()
    yield
    runtime_config.reset_cache()


def _upload(client, content=SRT_3, filename="ep.srt"):
    resp = client.post("/api/upload", files={"file": (filename, content, "text/plain")})
    assert resp.status_code == 200, resp.text
    return resp.json()["file_id"]


def _entries(client, fid):
    return client.get(f"/api/file/{fid}/entries", params={"page_size": 200}).json()["entries"]


def _wait_job(client, fid, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = client.get(f"/api/translate/{fid}/status").json()
        if data.get("status") in ("completed", "error", "cancelled"):
            return data
        time.sleep(0.05)
    raise TimeoutError


def _translator(tag="MT", delay=0.0):
    """Mock translator: writes '<tag> <original>' into each given entry."""
    mock = AsyncMock()
    mock.provider_name = "mock"
    mock.calls = []

    async def fake(*args, **kwargs):
        mock.calls.append(kwargs)
        batch = kwargs["entries"]
        on_progress = kwargs.get("on_progress")
        for i, e in enumerate(batch):
            if delay:
                await asyncio.sleep(delay)
            e.translated_text = f"{tag} {e.original_text}"
            if on_progress:
                await on_progress(i + 1, len(batch), e.original_text)
        return batch

    mock.translate_batch.side_effect = fake
    return mock


def _run(client, fid, translator=None, **body):
    translator = translator or _translator()
    with patch("app.api.routes.TranslatorFactory.create", return_value=translator):
        resp = client.post("/api/translate", json={
            "file_id": fid, "provider": "llm", "target_lang": "vi", **body,
        })
    assert resp.status_code == 200, resp.text
    return resp.json(), _wait_job(client, fid), translator


# ─── Persistence ─────────────────────────────────────────────────────────────

class TestPersistence:
    def test_upload_is_saved_to_disk(self, client):
        from app.config import settings
        fid = _upload(client)
        assert os.path.exists(os.path.join(settings.PROJECTS_DIR, f"{fid}.json"))

    def test_evicted_project_reloads_with_edits(self, client):
        from app.api.routes import file_store
        fid = _upload(client)
        client.put(f"/api/file/{fid}/entry/1", params={"translated_text": "Xin chào"})

        file_store.pop(fid)  # simulate eviction / backend restart
        entries = _entries(client, fid)
        assert entries[0]["translated_text"] == "Xin chào"
        assert entries[0]["status"] == "edited"

    def test_load_all_into_fresh_store(self, client):
        from app.services import projects
        fid = _upload(client)
        fresh: dict = {}
        projects.load_all(fresh)
        assert fid in fresh
        assert fresh[fid]["entries"][1].prefix == "{\\an8}<i>"

    def test_recent_projects_and_delete(self, client):
        fid = _upload(client, filename="recent_test.srt")
        listing = client.get("/api/projects").json()["projects"]
        assert listing[0]["file_id"] == fid
        assert listing[0]["total"] == 3

        detail = client.get(f"/api/projects/{fid}").json()
        assert detail["filename"] == "recent_test.srt"

        assert client.delete(f"/api/projects/{fid}").status_code == 200
        assert client.get(f"/api/file/{fid}/entries").status_code == 404

    def test_purge_expired_on_disk(self, client, monkeypatch):
        from app.api.routes import file_store
        from app.config import settings
        from app.services import projects
        fid = _upload(client)
        file_store[fid]["last_access"] = time.time() - settings.PROJECT_TTL - 10
        projects.save_project(fid, file_store)
        file_store.pop(fid)
        assert projects.purge_expired_on_disk(set()) >= 1
        assert projects.load_project(fid) is None


# ─── Job scope: human edits are never wiped ─────────────────────────────────

class TestJobScope:
    def test_default_scope_keeps_edited_lines(self, client):
        fid = _upload(client)
        client.put(f"/api/file/{fid}/entry/1", params={"translated_text": "Bản sửa tay"})

        started, status, _ = _run(client, fid)
        assert started["total"] == 2  # edited line excluded
        assert status["status"] == "completed"

        entries = _entries(client, fid)
        assert entries[0]["translated_text"] == "Bản sửa tay"
        assert entries[0]["status"] == "edited"
        assert entries[2]["translated_text"] == "MT Goodbye"
        assert entries[2]["status"] == "machine"

    def test_scope_missing_only_translates_empty_lines(self, client):
        fid = _upload(client)
        _run(client, fid, _translator("FIRST"))
        client.put(f"/api/file/{fid}/entry/2", params={"translated_text": ""})

        started, _, tr = _run(client, fid, _translator("SECOND"), scope="missing")
        assert started["total"] == 1
        assert [e.original_text for e in tr.calls[0]["entries"]] == ["Look up"]
        entries = _entries(client, fid)
        assert entries[0]["translated_text"] == "FIRST Hello"
        assert entries[1]["translated_text"] == "SECOND Look up"

    def test_scope_all_overwrites_edits(self, client):
        fid = _upload(client)
        client.put(f"/api/file/{fid}/entry/1", params={"translated_text": "Sửa tay"})
        started, _, _ = _run(client, fid, scope="all")
        assert started["total"] == 3
        assert _entries(client, fid)[0]["translated_text"] == "MT Hello"

    def test_edit_during_job_survives(self, client):
        fid = _upload(client)
        translator = _translator(delay=0.3)
        with patch("app.api.routes.TranslatorFactory.create", return_value=translator):
            client.post("/api/translate", json={"file_id": fid, "provider": "llm", "scope": "all"})
            time.sleep(0.1)
            client.put(f"/api/file/{fid}/entry/3", params={"translated_text": "Người dùng sửa"})
            _wait_job(client, fid)
        entries = _entries(client, fid)
        assert entries[2]["translated_text"] == "Người dùng sửa"
        assert entries[0]["translated_text"] == "MT Hello"

    def test_context_aware_flag_and_full_entries(self, client):
        from app.models.schemas import TranslationMode
        fid = _upload(client)
        _, _, tr = _run(client, fid, context_aware=True, glossary={"Hello": "Chào"})
        kwargs = tr.calls[0]
        assert kwargs["mode"] == TranslationMode.CONTEXT_AWARE
        assert kwargs["glossary"] == {"Hello": "Chào"}
        assert len(kwargs["full_entries"]) == 3

    def test_translators_never_see_tags(self, client):
        fid = _upload(client)
        _, _, tr = _run(client, fid)
        texts = [e.original_text for e in tr.calls[0]["entries"]]
        assert "Look up" in texts
        assert not any("<" in t or "{" in t for t in texts)


# ─── Statuses, bulk update, retranslate ──────────────────────────────────────

class TestEditing:
    def test_bulk_update_statuses(self, client):
        fid = _upload(client)
        resp = client.put(f"/api/file/{fid}/entries", json={"updates": [
            {"index": 1, "translated_text": "Chào"},
            {"index": 2, "translated_text": "Nhìn lên", "status": "reviewed"},
            {"index": 3, "status": "reviewed"},
        ]})
        assert resp.status_code == 200
        by_idx = {e["index"]: e for e in resp.json()["entries"]}
        assert by_idx[1]["status"] == "edited"
        assert by_idx[2]["status"] == "reviewed"

        stats = client.get(f"/api/file/{fid}/stats").json()
        assert stats["edited"] == 1
        assert stats["reviewed"] == 2
        assert stats["total"] == 3

    def test_clearing_text_marks_untranslated(self, client):
        fid = _upload(client)
        client.put(f"/api/file/{fid}/entry/1", params={"translated_text": "A"})
        client.put(f"/api/file/{fid}/entry/1", params={"translated_text": ""})
        assert _entries(client, fid)[0]["status"] == "untranslated"

    def test_retranslate_uses_stored_config(self, client):
        fid = _upload(client)
        _run(client, fid, glossary={"Hello": "Xin chào"}, custom_prompt="Phim cổ trang",
             llm_model="gpt-4o")

        tr = _translator("RE")
        with patch("app.api.routes.TranslatorFactory.create", return_value=tr) as create:
            resp = client.post(f"/api/translate/{fid}/entries", json={"indices": [1]})
        assert resp.status_code == 200
        kwargs = tr.calls[0]
        assert kwargs["glossary"] == {"Hello": "Xin chào"}
        assert kwargs["custom_prompt"] == "Phim cổ trang"
        assert len(kwargs["full_entries"]) == 3
        assert create.call_args.kwargs["model"] == "gpt-4o"
        assert tr.skip_cache_read is True

        result = resp.json()["results"][0]
        assert result == {"index": 1, "old": "MT Hello", "new": "RE Hello"}
        assert _entries(client, fid)[0]["translated_text"] == "RE Hello"

    def test_retranslate_keep_old_does_not_write(self, client):
        fid = _upload(client)
        _run(client, fid)
        with patch("app.api.routes.TranslatorFactory.create", return_value=_translator("NEW")):
            resp = client.post(f"/api/translate/{fid}/entries",
                               json={"indices": [1, 3], "keep_old": True})
        results = resp.json()["results"]
        assert [r["new"] for r in results] == ["NEW Hello", "NEW Goodbye"]
        assert _entries(client, fid)[0]["translated_text"] == "MT Hello"


# ─── Export ──────────────────────────────────────────────────────────────────

class TestExport:
    def _translated(self, client):
        fid = _upload(client)
        _run(client, fid)
        return fid

    def test_srt_export_restores_tags(self, client):
        fid = self._translated(client)
        text = client.get(f"/api/export/{fid}", params={"format": "srt"}).content.decode()
        assert "{\\an8}<i>MT Look up</i>" in text

    def test_bilingual_export(self, client):
        fid = self._translated(client)
        text = client.get(f"/api/export/{fid}", params={"format": "srt", "bilingual": True}).content.decode()
        assert "Hello\nMT Hello" in text

    def test_untranslated_error_and_empty(self, client):
        fid = self._translated(client)
        client.put(f"/api/file/{fid}/entry/3", params={"translated_text": ""})

        resp = client.get(f"/api/export/{fid}", params={"untranslated": "error"})
        assert resp.status_code == 409
        assert "1" in resp.json()["detail"]

        text = client.get(f"/api/export/{fid}", params={"untranslated": "empty"}).content.decode()
        assert "Goodbye" not in text
        text = client.get(f"/api/export/{fid}").content.decode()
        assert "Goodbye" in text  # default: fall back to source

    def test_excel_header_uses_target_language(self, client):
        import openpyxl
        fid = _upload(client)
        _run(client, fid, target_lang="en")
        content = client.get(f"/api/export/{fid}", params={"format": "xlsx"}).content
        ws = openpyxl.load_workbook(io.BytesIO(content)).active
        assert ws.cell(row=1, column=5).value == "English Translation"

    def test_batch_zip(self, client):
        done = self._translated(client)
        untouched = _upload(client, filename="ep2.srt")
        resp = client.post("/api/export/batch", json={"file_ids": [done, untouched], "format": "srt"})
        assert resp.status_code == 200
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        names = zf.namelist()
        assert any(n.endswith(".srt") for n in names)
        assert "_report.txt" in names
        assert "ep2.srt" in zf.read("_report.txt").decode()


# ─── ASS round-trip ──────────────────────────────────────────────────────────

class TestAssRoundTrip:
    def test_ass_keeps_header_styles_and_fields(self, client):
        fid = _upload(client, ASS_SAMPLE, "sign.ass")
        _run(client, fid)
        text = client.get(f"/api/export/{fid}", params={"format": "ass"}).content.decode("utf-8-sig")
        assert "Title: Demo" in text
        assert "PlayResX: 1280" in text
        assert "Style: Sign,Impact,60" in text
        assert "Dialogue: 1,0:00:01.00,0:00:03.00,Sign,Hero,0,0,0,,{\\an8}MT Hello there" in text
        assert text.count("[Events]") == 1


@pytest.mark.asyncio
async def test_split_tags_cases():
    from app.services.parser.tags import split_tags, has_inline_tags
    assert split_tags("{\\an8}<i>Hi</i>") == ("Hi", "{\\an8}<i>", "</i>")
    assert split_tags("<i>A</i> B <i>C</i>") == ("A B C", "", "")
    assert has_inline_tags("He said {\\b1}no{\\b0} ok")
    assert not has_inline_tags("<i>whole line</i>")


def test_upload_without_subtitle_lines_is_rejected(client):
    resp = client.post("/api/upload", files={"file": ("bad.srt", b"not a subtitle", "text/plain")})
    assert resp.status_code == 400
    assert "Không tìm thấy dòng phụ đề" in resp.json()["detail"]

    resp = client.post("/api/upload/batch", files=[
        ("files", ("bad.srt", b"garbage", "text/plain")),
        ("files", ("ok.srt", SRT_3, "text/plain")),
    ])
    files = resp.json()["files"]
    assert files[0]["file_id"] == "" and "Không tìm thấy" in files[0]["error"]
    assert files[1]["file_id"]
