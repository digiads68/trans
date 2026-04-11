import re
from .base import BaseParser
from app.models.schemas import SubtitleEntry


class ASSParser(BaseParser):
    """
    Parser for ASS/SSA subtitle files (.ass, .ssa).
    Advanced SubStation Alpha format used widely in anime.
    """

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
        in_events = False
        format_cols: list[str] = []
        index = 1

        for line in text.splitlines():
            line = line.strip()

            if line.lower() == "[events]":
                in_events = True
                continue

            if in_events:
                if line.lower().startswith("[") and line != "[Events]":
                    # New section started
                    break
                if line.lower().startswith("format:"):
                    # Parse column order: Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
                    cols = line[7:].split(",")
                    format_cols = [c.strip().lower() for c in cols]
                elif line.lower().startswith("dialogue:"):
                    if not format_cols:
                        continue
                    # Split only up to len(format_cols) - 1 commas (last field "Text" may contain commas)
                    values = line[9:].split(",", len(format_cols) - 1)
                    if len(values) < len(format_cols):
                        continue

                    col_map = {col: values[i].strip() for i, col in enumerate(format_cols)}

                    start_time = col_map.get("start", "")
                    end_time = col_map.get("end", "")
                    text_raw = col_map.get("text", "")

                    # Remove ASS override tags like {\an8}, {\pos(x,y)}, {\i1}, etc.
                    clean_text = re.sub(r"\{[^}]*\}", "", text_raw)
                    # Convert \N and \n (line breaks in ASS) to actual newlines
                    clean_text = clean_text.replace("\\N", "\n").replace("\\n", "\n").strip()

                    if clean_text:
                        entries.append(SubtitleEntry(
                            index=index,
                            start_time=start_time,
                            end_time=end_time,
                            original_text=clean_text,
                        ))
                        index += 1

        return entries
