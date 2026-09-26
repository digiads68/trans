from typing import Optional

from .base import BaseParser
from .tags import split_tags
from app.models.schemas import SubtitleEntry


class ASSParser(BaseParser):
    """
    Parser for ASS/SSA subtitle files (.ass, .ssa).
    Advanced SubStation Alpha format used widely in anime.

    Keeps everything needed to round-trip the file: the header (Script Info,
    Styles, Events Format line) is exposed as `self.header`, and each Dialogue's
    Layer/Style/Name/Margins/Effect are kept in `entry.ass_fields`.
    """

    def __init__(self):
        self.header: Optional[str] = None

    def supported_extensions(self) -> list[str]:
        return ["ass", "ssa"]

    async def parse(self, file_content: bytes, filename: str) -> list[SubtitleEntry]:
        text = None
        for encoding in ["utf-8-sig", "utf-8", "utf-16", "gb18030", "shift_jis", "latin-1"]:
            try:
                text = file_content.decode(encoding)
                break
            except (UnicodeDecodeError, LookupError):
                continue

        if text is None:
            raise ValueError("Unable to decode ASS file.")

        entries = []
        header_lines: list[str] = []
        in_events = False
        format_cols: list[str] = []
        format_line = ""
        index = 1

        for raw_line in text.splitlines():
            line = raw_line.strip()

            if line.lower() == "[events]":
                in_events = True
                header_lines.append("[Events]")
                continue

            if not in_events:
                header_lines.append(raw_line.rstrip())
                continue

            if line.startswith("[") and line.lower() != "[events]":
                # Sections after [Events] (e.g. [Fonts]) are not kept
                break
            if line.lower().startswith("format:"):
                # Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
                format_line = line
                format_cols = [c.strip().lower() for c in line[7:].split(",")]
            elif line.lower().startswith("dialogue:"):
                if not format_cols:
                    continue
                # Last field "Text" may contain commas
                values = line[9:].lstrip().split(",", len(format_cols) - 1)
                if len(values) < len(format_cols):
                    continue

                col_map = {col: values[i].strip() for i, col in enumerate(format_cols)}
                raw_text = values[-1].strip() if format_cols[-1] == "text" else col_map.get("text", "")

                clean, prefix, suffix = split_tags(raw_text)
                clean = clean.replace("\\N", "\n").replace("\\n", "\n").strip()

                if clean:
                    entries.append(SubtitleEntry(
                        index=index,
                        start_time=col_map.get("start", ""),
                        end_time=col_map.get("end", ""),
                        original_text=clean,
                        prefix=prefix,
                        suffix=suffix,
                        raw_text=raw_text if raw_text != clean else None,
                        ass_fields={
                            col: col_map[col] for col in format_cols
                            if col not in ("start", "end", "text")
                        },
                    ))
                    index += 1

        if format_line:
            header_lines.append(format_line)
            self.header = "\n".join(header_lines).strip() + "\n"
        return entries
