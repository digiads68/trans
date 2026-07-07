"""
Unit tests for subtitle file parsers.
Tests SRT, Excel, ASS, and VTT parsers.
"""

import asyncio
import pytest


# ─── SRT ────────────────────────────────────────────────────────────────────

SRT_SAMPLE = b"""1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:05,000 --> 00:00:07,000
This is a test subtitle

3
00:00:10,000 --> 00:00:12,000
Line one
Line two
"""

SRT_WITH_BOM = b"\xef\xbb\xbf" + SRT_SAMPLE  # UTF-8 BOM


@pytest.mark.asyncio
async def test_srt_basic_parse():
    from app.services.parser.srt_parser import SRTParser
    parser = SRTParser()
    entries = await parser.parse(SRT_SAMPLE, "test.srt")
    assert len(entries) == 3
    assert entries[0].index == 1
    assert entries[0].original_text == "Hello world"
    assert entries[0].start_time == "00:00:01,000"
    assert entries[0].end_time == "00:00:03,500"


@pytest.mark.asyncio
async def test_srt_multiline():
    from app.services.parser.srt_parser import SRTParser
    parser = SRTParser()
    entries = await parser.parse(SRT_SAMPLE, "test.srt")
    assert entries[2].original_text == "Line one\nLine two"


@pytest.mark.asyncio
async def test_srt_bom_handling():
    from app.services.parser.srt_parser import SRTParser
    parser = SRTParser()
    entries = await parser.parse(SRT_WITH_BOM, "test.srt")
    assert len(entries) == 3
    assert entries[0].original_text == "Hello world"


@pytest.mark.asyncio
async def test_srt_supported_extensions():
    from app.services.parser.srt_parser import SRTParser
    parser = SRTParser()
    assert "srt" in parser.supported_extensions()


# ─── ASS ────────────────────────────────────────────────────────────────────

ASS_SAMPLE = b"""[Script Info]
Title: Test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello {\\i1}world{\\i0}
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Line one\\NLine two
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Text with, comma inside
"""


@pytest.mark.asyncio
async def test_ass_basic_parse():
    from app.services.parser.ass_parser import ASSParser
    parser = ASSParser()
    entries = await parser.parse(ASS_SAMPLE, "test.ass")
    assert len(entries) == 3


@pytest.mark.asyncio
async def test_ass_strips_override_tags():
    from app.services.parser.ass_parser import ASSParser
    parser = ASSParser()
    entries = await parser.parse(ASS_SAMPLE, "test.ass")
    assert "{" not in entries[0].original_text
    assert "}" not in entries[0].original_text
    assert entries[0].original_text == "Hello world"


@pytest.mark.asyncio
async def test_ass_line_breaks():
    from app.services.parser.ass_parser import ASSParser
    parser = ASSParser()
    entries = await parser.parse(ASS_SAMPLE, "test.ass")
    assert "\n" in entries[1].original_text
    assert entries[1].original_text == "Line one\nLine two"


@pytest.mark.asyncio
async def test_ass_comma_in_text():
    from app.services.parser.ass_parser import ASSParser
    parser = ASSParser()
    entries = await parser.parse(ASS_SAMPLE, "test.ass")
    assert entries[2].original_text == "Text with, comma inside"


@pytest.mark.asyncio
async def test_ass_supported_extensions():
    from app.services.parser.ass_parser import ASSParser
    parser = ASSParser()
    assert "ass" in parser.supported_extensions()
    assert "ssa" in parser.supported_extensions()


# ─── VTT ────────────────────────────────────────────────────────────────────

VTT_SAMPLE = b"""WEBVTT

1
00:00:01.000 --> 00:00:03.500
Hello <b>world</b>

2
00:00:05.000 --> 00:00:07.000
This is a test

identifier-three
00:00:10.000 --> 00:00:12.000
<i>Italic text</i>
"""

VTT_NO_IDENTIFIERS = b"""WEBVTT

00:00:01.000 --> 00:00:03.500
First cue

00:00:05.000 --> 00:00:07.000
Second cue
"""


@pytest.mark.asyncio
async def test_vtt_basic_parse():
    from app.services.parser.vtt_parser import VTTParser
    parser = VTTParser()
    entries = await parser.parse(VTT_SAMPLE, "test.vtt")
    assert len(entries) == 3


@pytest.mark.asyncio
async def test_vtt_strips_html_tags():
    from app.services.parser.vtt_parser import VTTParser
    parser = VTTParser()
    entries = await parser.parse(VTT_SAMPLE, "test.vtt")
    assert "<b>" not in entries[0].original_text
    assert entries[0].original_text == "Hello world"
    assert entries[2].original_text == "Italic text"


@pytest.mark.asyncio
async def test_vtt_no_identifiers():
    from app.services.parser.vtt_parser import VTTParser
    parser = VTTParser()
    entries = await parser.parse(VTT_NO_IDENTIFIERS, "test.vtt")
    assert len(entries) == 2
    assert entries[0].original_text == "First cue"


@pytest.mark.asyncio
async def test_vtt_timestamps():
    from app.services.parser.vtt_parser import VTTParser
    parser = VTTParser()
    entries = await parser.parse(VTT_SAMPLE, "test.vtt")
    assert entries[0].start_time == "00:00:01.000"
    assert entries[0].end_time == "00:00:03.500"


@pytest.mark.asyncio
async def test_vtt_supported_extensions():
    from app.services.parser.vtt_parser import VTTParser
    parser = VTTParser()
    assert "vtt" in parser.supported_extensions()


# ─── ParserFactory ──────────────────────────────────────────────────────────

def test_parser_factory_srt():
    from app.services.parser.base import ParserFactory
    from app.services.parser.srt_parser import SRTParser
    parser = ParserFactory.get_parser("subtitle.srt")
    assert isinstance(parser, SRTParser)


def test_parser_factory_ass():
    from app.services.parser.base import ParserFactory
    from app.services.parser.ass_parser import ASSParser
    parser = ParserFactory.get_parser("subtitle.ass")
    assert isinstance(parser, ASSParser)


def test_parser_factory_ssa():
    from app.services.parser.base import ParserFactory
    from app.services.parser.ass_parser import ASSParser
    parser = ParserFactory.get_parser("subtitle.ssa")
    assert isinstance(parser, ASSParser)


def test_parser_factory_vtt():
    from app.services.parser.base import ParserFactory
    from app.services.parser.vtt_parser import VTTParser
    parser = ParserFactory.get_parser("subtitle.vtt")
    assert isinstance(parser, VTTParser)


def test_parser_factory_unsupported():
    from app.services.parser.base import ParserFactory
    with pytest.raises(ValueError, match="Unsupported"):
        ParserFactory.get_parser("subtitle.mkv")


# ─── Excel parser robustness ─────────────────────────────────────────────────

def _make_xlsx(rows):
    import io
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_excel_contains_match_headers():
    """Headers like 'Original Text' / 'Start Time (s)' are recognized."""
    from app.services.parser.excel_parser import ExcelParser
    content = _make_xlsx([
        ["No.", "Start Time", "End Time", "Original Text"],
        [1, "00:00:01,000", "00:00:03,000", "Hello"],
        [2, "00:00:04,000", "00:00:06,000", "World"],
    ])
    entries = await ExcelParser().parse(content, "t.xlsx")
    assert len(entries) == 2
    assert entries[0].original_text == "Hello"
    assert entries[0].start_time == "00:00:01,000"
    # Header row was NOT parsed as a subtitle line
    assert all("Original" not in e.original_text for e in entries)


async def test_excel_duplicate_indices_reindexed():
    """Duplicate index values in the sheet must not collapse entries."""
    from app.services.parser.excel_parser import ExcelParser
    content = _make_xlsx([
        ["index", "text"],
        [1, "Line A"],
        [1, "Line B"],
        [2, "Line C"],
    ])
    entries = await ExcelParser().parse(content, "t.xlsx")
    assert len(entries) == 3
    indices = [e.index for e in entries]
    assert len(set(indices)) == 3, f"Indices not unique: {indices}"
