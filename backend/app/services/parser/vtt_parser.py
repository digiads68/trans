import re
from .base import BaseParser
from app.models.schemas import SubtitleEntry


class VTTParser(BaseParser):
    """
    Parser for WebVTT subtitle files (.vtt).
    Web Video Text Tracks format, standard for HTML5 video.
    """

    def supported_extensions(self) -> list[str]:
        return ["vtt"]

    async def parse(self, file_content: bytes, filename: str) -> list[SubtitleEntry]:
        text = None
        for encoding in ["utf-8-sig", "utf-8", "latin-1"]:
            try:
                text = file_content.decode(encoding)
                break
            except (UnicodeDecodeError, LookupError):
                continue

        if text is None:
            raise ValueError("Unable to decode VTT file.")

        entries = []
        # Split into cue blocks (separated by double newlines)
        blocks = re.split(r"\n\s*\n", text.strip())

        index = 1
        for block in blocks:
            lines = block.strip().splitlines()
            if not lines:
                continue

            # Skip WEBVTT header line
            if lines[0].strip().upper().startswith("WEBVTT"):
                continue

            # Cue may optionally start with an identifier (non-timestamp line)
            time_line_idx = 0
            if not re.search(r"-->", lines[0]):
                time_line_idx = 1

            if time_line_idx >= len(lines):
                continue

            # Parse timestamp line: 00:00:00.000 --> 00:00:00.000 [position settings]
            time_match = re.match(
                r"(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|(?:\d{2}:)?\d{2}\.\d{3})\s*-->\s*"
                r"(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|(?:\d{2}:)?\d{2}\.\d{3})",
                lines[time_line_idx],
            )
            if not time_match:
                continue

            start_time = time_match.group(1)
            end_time = time_match.group(2)

            # Remaining lines: subtitle text
            text_lines = lines[time_line_idx + 1:]
            subtitle_text = "\n".join(text_lines).strip()

            # Remove VTT markup tags like <b>, <i>, <c.color>, <v Name>
            subtitle_text = re.sub(r"<[^>]+>", "", subtitle_text).strip()

            if subtitle_text:
                entries.append(SubtitleEntry(
                    index=index,
                    start_time=start_time,
                    end_time=end_time,
                    original_text=subtitle_text,
                ))
                index += 1

        return entries
