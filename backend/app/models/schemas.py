from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class TranslationProvider(str, Enum):
    LLM = "llm"
    GOOGLE = "google"
    HYBRID = "hybrid"  # LLM + Google cross-use


class TranslationMode(str, Enum):
    STANDARD = "standard"        # Direct translation
    CONTEXT_AWARE = "context"    # LLM considers surrounding subtitles for context
    GLOSSARY = "glossary"        # Use custom glossary/terminology


class FileType(str, Enum):
    SRT = "srt"
    EXCEL = "excel"
    ASS = "ass"
    VTT = "vtt"


class SubtitleEntry(BaseModel):
    index: int
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    original_text: str
    translated_text: Optional[str] = None
    source_lang: Optional[str] = None


class TranslationRequest(BaseModel):
    file_id: str
    provider: TranslationProvider = TranslationProvider.LLM
    llm_model: Optional[str] = "gpt-4o-mini"
    mode: TranslationMode = TranslationMode.STANDARD
    source_lang: Optional[str] = None  # Auto-detect if None
    target_lang: str = "vi"
    custom_prompt: Optional[str] = None
    glossary: Optional[dict[str, str]] = None
    # Hybrid mode settings
    hybrid_primary: Optional[TranslationProvider] = TranslationProvider.LLM
    hybrid_fallback: Optional[TranslationProvider] = TranslationProvider.GOOGLE
    hybrid_refine: bool = False  # Use LLM to refine Google translation


class TranslationProgress(BaseModel):
    file_id: str
    total: int
    completed: int
    current_text: Optional[str] = None
    status: str = "processing"  # processing, completed, error
    error: Optional[str] = None


class TranslationResponse(BaseModel):
    file_id: str
    original_file: str
    translated_file: Optional[str] = None
    entries: list[SubtitleEntry] = []
    source_lang: Optional[str] = None
    target_lang: str = "vi"
    provider: str = ""
    model: Optional[str] = None
    status: str = "pending"


class UploadResponse(BaseModel):
    file_id: str
    filename: str
    file_type: FileType
    entries: list[SubtitleEntry] = []
    detected_lang: Optional[str] = None
    total_entries: int = 0


class AvailableModelsResponse(BaseModel):
    llm_models: list[str] = []
    providers: list[str] = []
    modes: list[str] = []


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = ""
