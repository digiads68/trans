from io import BytesIO
from openpyxl import load_workbook
from .base import BaseParser
from app.models.schemas import SubtitleEntry


class ExcelParser(BaseParser):
    """Parser for Excel subtitle files (.xlsx, .xls)."""

    def supported_extensions(self) -> list[str]:
        return ["xlsx", "xls"]

    async def parse(self, file_content: bytes, filename: str) -> list[SubtitleEntry]:
        wb = load_workbook(filename=BytesIO(file_content), read_only=True)
        ws = wb.active

        entries = []
        headers = {}

        # Detect header row - look for common column names
        first_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
        if first_row is None:
            raise ValueError("Excel file is empty")

        # Normalize headers
        header_map = {
            "index": ["index", "no", "no.", "#", "stt", "số", "number"],
            "start_time": ["start", "start_time", "starttime", "time_start", "from", "bắt đầu"],
            "end_time": ["end", "end_time", "endtime", "time_end", "to", "kết thúc"],
            "text": ["text", "content", "subtitle", "dialog", "dialogue", "original", "nội dung",
                      "source", "lời thoại", "phụ đề", "原文", "대사", "台词"],
            "translated": ["translated", "translation", "target", "vietnamese", "tiếng việt",
                           "dịch", "bản dịch", "译文", "번역"],
        }

        # Pass 1: exact alias match. Pass 2: contains-match so headers like
        # "Original Text" or "EN Subtitle" are still recognized.
        for col_idx, cell_value in enumerate(first_row):
            if cell_value is None:
                continue
            cell_lower = str(cell_value).strip().lower()
            for field, aliases in header_map.items():
                if field not in headers and cell_lower in aliases:
                    headers[field] = col_idx
                    break
        for col_idx, cell_value in enumerate(first_row):
            if cell_value is None or col_idx in headers.values():
                continue
            cell_lower = str(cell_value).strip().lower()
            for field, aliases in header_map.items():
                if field in headers:
                    continue
                if any(alias in cell_lower for alias in aliases if len(alias) >= 3):
                    headers[field] = col_idx
                    break

        # If no recognizable headers, assume: col0=index, col1=text (or col0=text)
        start_row = 2
        if "text" not in headers:
            # Try treating first row as data
            if first_row[0] and isinstance(first_row[0], (int, float)):
                headers = {"index": 0, "text": 1}
                start_row = 1
            else:
                # Single column or unrecognized - treat first non-empty column as text
                for col_idx, cell_value in enumerate(first_row):
                    if cell_value is not None:
                        headers["text"] = col_idx
                        break
                start_row = 1

        idx = 1
        for row in ws.iter_rows(min_row=start_row, values_only=True):
            row_list = list(row)

            # Get text content
            text_col = headers.get("text", 0)
            if text_col >= len(row_list) or row_list[text_col] is None:
                continue

            text = str(row_list[text_col]).strip()
            if not text:
                continue

            # Get index
            entry_index = idx
            if "index" in headers and headers["index"] < len(row_list):
                try:
                    entry_index = int(row_list[headers["index"]])
                except (ValueError, TypeError):
                    pass

            # Get timestamps if available
            start_time = None
            end_time = None
            if "start_time" in headers and headers["start_time"] < len(row_list):
                start_time = str(row_list[headers["start_time"]]) if row_list[headers["start_time"]] else None
            if "end_time" in headers and headers["end_time"] < len(row_list):
                end_time = str(row_list[headers["end_time"]]) if row_list[headers["end_time"]] else None

            entries.append(
                SubtitleEntry(
                    index=entry_index,
                    start_time=start_time,
                    end_time=end_time,
                    original_text=text,
                )
            )
            idx += 1

        wb.close()

        # Duplicate indices (bad source sheets) would make multiple entries
        # share one translation slot — reindex sequentially if any collide.
        seen: set[int] = set()
        has_duplicates = False
        for entry in entries:
            if entry.index in seen:
                has_duplicates = True
                break
            seen.add(entry.index)
        if has_duplicates:
            for i, entry in enumerate(entries, start=1):
                entry.index = i

        return entries
