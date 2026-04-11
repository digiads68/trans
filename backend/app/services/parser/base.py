from abc import ABC, abstractmethod
from typing import BinaryIO
from app.models.schemas import SubtitleEntry, FileType


class BaseParser(ABC):
    """Base class for all subtitle file parsers."""

    @abstractmethod
    async def parse(self, file_content: bytes, filename: str) -> list[SubtitleEntry]:
        """Parse file content and return list of subtitle entries."""
        pass

    @abstractmethod
    def supported_extensions(self) -> list[str]:
        """Return list of supported file extensions."""
        pass


class ParserFactory:
    """Factory to get the right parser based on file type."""

    _parsers: dict[str, type[BaseParser]] = {}

    @classmethod
    def register(cls, file_type: str, parser_class: type[BaseParser]):
        cls._parsers[file_type] = parser_class

    @classmethod
    def get_parser(cls, filename: str) -> BaseParser:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext == "srt":
            from .srt_parser import SRTParser
            return SRTParser()
        elif ext in ("xlsx", "xls"):
            from .excel_parser import ExcelParser
            return ExcelParser()
        elif ext in ("ass", "ssa"):
            from .ass_parser import ASSParser
            return ASSParser()
        elif ext == "vtt":
            from .vtt_parser import VTTParser
            return VTTParser()
        else:
            raise ValueError(f"Unsupported file format: .{ext}. Supported: .srt, .xlsx, .xls, .ass, .ssa, .vtt")
