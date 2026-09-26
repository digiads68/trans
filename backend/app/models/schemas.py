from pydantic import BaseModel, Field, model_validator
from typing import Literal, Optional
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


EntryStatus = Literal["untranslated", "machine", "edited", "reviewed"]
LOCKED_STATUSES = ("edited", "reviewed")


class SubtitleEntry(BaseModel):
    index: int
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    # Clean text sent to translators (formatting tags split off into prefix/suffix)
    original_text: str
    translated_text: Optional[str] = None
    source_lang: Optional[str] = None
    # untranslated → machine (translator wrote it) → edited (human) → reviewed (approved)
    status: Optional[EntryStatus] = None
    prefix: str = ""
    suffix: str = ""
    raw_text: Optional[str] = None
    # ASS Dialogue fields other than Start/End/Text (layer, style, name, margins, effect)
    ass_fields: Optional[dict[str, str]] = None

    @model_validator(mode="after")
    def _default_status(self):
        if self.status is None:
            self.status = "machine" if self.translated_text else "untranslated"
        return self

    @property
    def is_locked(self) -> bool:
        return self.status in LOCKED_STATUSES


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
    # WebHook notification (5.6)
    webhook_url: Optional[str] = None
    # Which lines to translate:
    #   missing       — only lines with no translation yet
    #   all_unlocked  — everything except human-edited/reviewed lines (default)
    #   all           — everything, overwriting human edits
    scope: Literal["missing", "all_unlocked", "all"] = "all_unlocked"
    # Context-aware and glossary are independent; glossary applies whenever given
    context_aware: bool = False

    @property
    def effective_mode(self) -> "TranslationMode":
        if self.context_aware or self.mode == TranslationMode.CONTEXT_AWARE:
            return TranslationMode.CONTEXT_AWARE
        return self.mode


class EntryUpdate(BaseModel):
    index: int
    translated_text: Optional[str] = None
    status: Optional[EntryStatus] = None


class BulkEntryUpdateRequest(BaseModel):
    updates: list[EntryUpdate]


class RetranslateRequest(BaseModel):
    indices: list[int]
    # True: return suggestions without writing (client confirms via bulk update)
    keep_old: bool = False
    # Optional overrides on top of the file's last translation config
    provider: Optional[TranslationProvider] = None
    llm_model: Optional[str] = None
    target_lang: Optional[str] = None


class BatchExportRequest(BaseModel):
    file_ids: list[str]
    format: str = "srt"
    target_lang: str = "vi"
    bilingual: bool = False


class BatchTranslationRequest(BaseModel):
    file_ids: list[str]
    provider: TranslationProvider = TranslationProvider.LLM
    llm_model: Optional[str] = "gpt-4o-mini"
    mode: TranslationMode = TranslationMode.STANDARD
    source_lang: Optional[str] = None
    target_lang: str = "vi"
    custom_prompt: Optional[str] = None
    glossary: Optional[dict[str, str]] = None
    hybrid_primary: Optional[TranslationProvider] = TranslationProvider.LLM
    hybrid_fallback: Optional[TranslationProvider] = TranslationProvider.GOOGLE
    hybrid_refine: bool = False
    webhook_url: Optional[str] = None
    parallel: bool = False  # Translate files in parallel (False = sequential)


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
    error: Optional[str] = None  # set when the file was rejected in a batch upload


class BatchUploadResponse(BaseModel):
    files: list[UploadResponse]
    total_files: int
    total_entries: int


class AvailableModelsResponse(BaseModel):
    llm_models: list[str] = []
    providers: list[str] = []
    modes: list[str] = []


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = ""
