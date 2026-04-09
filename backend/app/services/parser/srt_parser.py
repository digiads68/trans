import re
from .base import BaseParser
from app.models.schemas import SubtitleEntry


class SRTParser(BaseParser):
    """Parser for SRT subtitle files."""

    def supported_extensions(self) -> list[str]:
        return ["srt"]

    async def parse(self, file_content: bytes, filename: str) -> list[SubtitleEntry]:
        # Try common encodings
        text = None
        for encoding in ["utf-8-sig", "utf-8", "utf-16", "gb18030", "euc-kr", "shift_jis", "latin-1"]:
            try:
                text = file_content.decode(encoding)
                break
            except (UnicodeDecodeError, LookupError):
                continue

        if text is None:
            raise ValueError("Unable to decode file. Please ensure it uses UTF-8 encoding.")

        entries = []
        # Split by double newline (SRT blocks)
        blocks = re.split(r"\n\s*\n", text.strip())

        for block in blocks:
            lines = block.strip().split("\n")
            if len(lines) < 3:
                continue

            # First line: index
            try:
                index = int(lines[0].strip())
            except ValueError:
                continue

            # Second line: timestamps
            time_match = re.match(
                r"(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})",
                lines[1].strip(),
            )
            if not time_match:
                continue

            start_time = time_match.group(1)
            end_time = time_match.group(2)

            # Remaining lines: subtitle text
            subtitle_text = "\n".join(lines[2:]).strip()

            if subtitle_text:
                entries.append(
                    SubtitleEntry(
                        index=index,
                        start_time=start_time,
                        end_time=end_time,
                        original_text=subtitle_text,
                    )
                )

        return entries
