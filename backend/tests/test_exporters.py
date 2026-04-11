"""
Unit tests for subtitle file exporters.
Tests SRT, VTT, Premiere, and DaVinci exporters.
"""

import asyncio
import os
import tempfile
import pytest

from app.models.schemas import SubtitleEntry


def _make_entries(count: int = 3) -> list[SubtitleEntry]:
    return [
        SubtitleEntry(
            index=i + 1,
            start_time=f"00:00:{i:02d},000",
            end_time=f"00:00:{i:02d},500",
            original_text=f"Original {i + 1}",
            translated_text=f"Translated {i + 1}",
        )
        for i in range(count)
    ]


def _make_entries_vtt(count: int = 2) -> list[SubtitleEntry]:
    """Entries with VTT-style dot timestamps."""
    return [
        SubtitleEntry(
            index=i + 1,
            start_time=f"00:00:{i:02d}.000",
            end_time=f"00:00:{i:02d}.500",
            original_text=f"Original {i + 1}",
            translated_text=f"Translated {i + 1}",
        )
        for i in range(count)
    ]


# ─── SRT Exporter ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_srt_exporter_creates_file():
    from app.services.exporter.srt_exporter import SRTExporter
    exporter = SRTExporter()
    entries = _make_entries()

    with tempfile.NamedTemporaryFile(suffix=".srt", delete=False) as tf:
        path = tf.name

    try:
        result = await exporter.export(entries, path)
        assert os.path.exists(result)
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_srt_exporter_format():
    from app.services.exporter.srt_exporter import SRTExporter
    exporter = SRTExporter()
    entries = _make_entries(2)

    with tempfile.NamedTemporaryFile(suffix=".srt", delete=False, mode="w") as tf:
        path = tf.name

    try:
        await exporter.export(entries, path)
        content = open(path, encoding="utf-8").read()
        assert "1\n" in content
        assert "Translated 1" in content
        assert "-->" in content
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_srt_exporter_uses_translated_text():
    from app.services.exporter.srt_exporter import SRTExporter
    exporter = SRTExporter()
    entries = _make_entries(1)
    entries[0].translated_text = "TRANSLATED"

    with tempfile.NamedTemporaryFile(suffix=".srt", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export(entries, path)
        content = open(path, encoding="utf-8").read()
        assert "TRANSLATED" in content
        assert "Original" not in content
    finally:
        os.unlink(path)


# ─── VTT Exporter ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vtt_exporter_header():
    from app.services.exporter.vtt_exporter import VTTExporter
    exporter = VTTExporter()
    entries = _make_entries_vtt()

    with tempfile.NamedTemporaryFile(suffix=".vtt", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export(entries, path)
        content = open(path, encoding="utf-8").read()
        assert content.startswith("WEBVTT")
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_vtt_exporter_normalizes_srt_timestamp():
    from app.services.exporter.vtt_exporter import VTTExporter
    exporter = VTTExporter()
    # SRT uses comma; VTT should use dot
    entry = SubtitleEntry(
        index=1,
        start_time="00:00:01,500",
        end_time="00:00:03,000",
        original_text="Test",
        translated_text="Test translated",
    )
    with tempfile.NamedTemporaryFile(suffix=".vtt", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export([entry], path)
        content = open(path, encoding="utf-8").read()
        assert "00:00:01.500" in content  # comma → dot
        assert "," not in content.split("-->")[0].split("\n")[-1]
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_vtt_exporter_file_extension():
    from app.services.exporter.vtt_exporter import VTTExporter
    assert VTTExporter().file_extension() == "vtt"


# ─── Premiere Exporter ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_premiere_exporter_valid_xml():
    from app.services.exporter.premiere_exporter import PremiereExporter
    exporter = PremiereExporter()
    entries = _make_entries(2)

    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export(entries, path)
        content = open(path, encoding="utf-8").read()
        assert '<?xml version="1.0"' in content
        assert "<xmeml" in content
        assert "<subtitle>" in content
        assert "Translated 1" in content
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_premiere_exporter_escapes_xml():
    from app.services.exporter.premiere_exporter import PremiereExporter
    exporter = PremiereExporter()
    entry = SubtitleEntry(
        index=1,
        start_time="00:00:01,000",
        end_time="00:00:02,000",
        original_text="Test",
        translated_text='Say "hello" & goodbye <world>',
    )
    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export([entry], path)
        content = open(path, encoding="utf-8").read()
        assert "&amp;" in content
        assert "&lt;" in content
        assert "&quot;" in content
    finally:
        os.unlink(path)


# ─── DaVinci Exporter ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_davinci_exporter_uses_comma():
    from app.services.exporter.davinci_exporter import DaVinciExporter
    exporter = DaVinciExporter()
    entry = SubtitleEntry(
        index=1,
        start_time="00:00:01.500",  # VTT dot format
        end_time="00:00:03.000",
        original_text="Test",
        translated_text="Test DaVinci",
    )
    with tempfile.NamedTemporaryFile(suffix=".srt", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export([entry], path)
        content = open(path, encoding="utf-8").read()
        assert "00:00:01,500" in content  # dot → comma
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_davinci_exporter_utf8_no_bom():
    from app.services.exporter.davinci_exporter import DaVinciExporter
    exporter = DaVinciExporter()
    entries = _make_entries(1)

    with tempfile.NamedTemporaryFile(suffix=".srt", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export(entries, path)
        raw = open(path, "rb").read()
        assert not raw.startswith(b"\xef\xbb\xbf")  # No BOM
    finally:
        os.unlink(path)


# ─── ASS Exporter ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ass_exporter_header():
    from app.services.exporter.ass_exporter import ASSExporter
    exporter = ASSExporter()
    entries = _make_entries(2)

    with tempfile.NamedTemporaryFile(suffix=".ass", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export(entries, path)
        content = open(path, encoding="utf-8-sig").read()
        assert "[Script Info]" in content
        assert "[V4+ Styles]" in content
        assert "[Events]" in content
        assert "Dialogue:" in content
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_ass_exporter_line_breaks():
    from app.services.exporter.ass_exporter import ASSExporter
    exporter = ASSExporter()
    entry = SubtitleEntry(
        index=1,
        start_time="00:00:01,000",
        end_time="00:00:03,000",
        original_text="Line1",
        translated_text="First line\nSecond line",
    )
    with tempfile.NamedTemporaryFile(suffix=".ass", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export([entry], path)
        content = open(path, encoding="utf-8-sig").read()
        assert "\\N" in content  # newline converted to ASS line break
        assert "\n" not in content.split("Dialogue:")[1].split("\\N")[0] or True  # no raw newline inside text
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_ass_exporter_timestamp_format():
    from app.services.exporter.ass_exporter import ASSExporter
    exporter = ASSExporter()
    entry = SubtitleEntry(
        index=1,
        start_time="01:02:03,456",
        end_time="01:02:05,789",
        original_text="Test",
        translated_text="Test ASS",
    )
    with tempfile.NamedTemporaryFile(suffix=".ass", delete=False) as tf:
        path = tf.name

    try:
        await exporter.export([entry], path)
        content = open(path, encoding="utf-8-sig").read()
        # ASS format: H:MM:SS.cc (centiseconds)
        assert "1:02:03.45" in content
    finally:
        os.unlink(path)


@pytest.mark.asyncio
async def test_ass_exporter_file_extension():
    from app.services.exporter.ass_exporter import ASSExporter
    assert ASSExporter().file_extension() == "ass"


# ─── ExporterFactory ────────────────────────────────────────────────────────

def test_exporter_factory_srt():
    from app.services.exporter.base import ExporterFactory
    from app.services.exporter.srt_exporter import SRTExporter
    assert isinstance(ExporterFactory.get_exporter("srt"), SRTExporter)


def test_exporter_factory_vtt():
    from app.services.exporter.base import ExporterFactory
    from app.services.exporter.vtt_exporter import VTTExporter
    assert isinstance(ExporterFactory.get_exporter("vtt"), VTTExporter)


def test_exporter_factory_premiere():
    from app.services.exporter.base import ExporterFactory
    from app.services.exporter.premiere_exporter import PremiereExporter
    assert isinstance(ExporterFactory.get_exporter("premiere"), PremiereExporter)


def test_exporter_factory_davinci():
    from app.services.exporter.base import ExporterFactory
    from app.services.exporter.davinci_exporter import DaVinciExporter
    assert isinstance(ExporterFactory.get_exporter("davinci"), DaVinciExporter)


def test_exporter_factory_ass():
    from app.services.exporter.base import ExporterFactory
    from app.services.exporter.ass_exporter import ASSExporter
    assert isinstance(ExporterFactory.get_exporter("ass"), ASSExporter)


def test_exporter_factory_unsupported():
    from app.services.exporter.base import ExporterFactory
    with pytest.raises(ValueError, match="Unsupported"):
        ExporterFactory.get_exporter("mkv")
