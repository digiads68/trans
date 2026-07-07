"""Translation job registry.

Translations run as background asyncio tasks so the HTTP request returns
immediately. Each job tracks progress, supports real cancellation via an
asyncio.Event checked by the translators, and records a user-facing error
message (Vietnamese) when it fails.
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional


class JobConflict(Exception):
    """A translation job is already running for this file."""


@dataclass
class TranslationJob:
    file_id: str
    status: str = "queued"  # queued | processing | completed | cancelled | error
    completed: int = 0
    total: int = 0
    failed: int = 0
    error: Optional[str] = None
    current_text: str = ""
    provider: str = ""
    target_lang: str = "vi"
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    task: Optional[asyncio.Task] = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def is_active(self) -> bool:
        return self.status in ("queued", "processing")

    def to_dict(self) -> dict:
        elapsed = (self.finished_at or time.time()) - self.started_at
        return {
            "file_id": self.file_id,
            "status": self.status,
            "completed": self.completed,
            "total": self.total,
            "failed": self.failed,
            "error": self.error,
            "current_text": self.current_text,
            "provider": self.provider,
            "target_lang": self.target_lang,
            "elapsed_seconds": round(elapsed, 1),
        }


_jobs: dict[str, TranslationJob] = {}

# Finished jobs older than this are pruned when new jobs are created
_FINISHED_JOB_TTL = 3600


def get_job(file_id: str) -> Optional[TranslationJob]:
    return _jobs.get(file_id)


def create_job(file_id: str, total: int, provider: str = "", target_lang: str = "vi") -> TranslationJob:
    """Register a new job. Raises JobConflict if one is already active for the file."""
    existing = _jobs.get(file_id)
    if existing and existing.is_active:
        raise JobConflict(f"Translation already in progress for file {file_id}")

    _prune_finished()
    job = TranslationJob(file_id=file_id, total=total, provider=provider, target_lang=target_lang)
    _jobs[file_id] = job
    return job


def request_cancel(file_id: str) -> Optional[TranslationJob]:
    """Signal cancellation. Returns the job, or None if there is none active."""
    job = _jobs.get(file_id)
    if not job or not job.is_active:
        return None
    job.cancel_event.set()
    if job.task and not job.task.done():
        job.task.cancel()
    return job


def _prune_finished() -> None:
    now = time.time()
    stale = [
        fid for fid, job in _jobs.items()
        if not job.is_active and job.finished_at and now - job.finished_at > _FINISHED_JOB_TTL
    ]
    for fid in stale:
        _jobs.pop(fid, None)


def classify_error(exc: Exception) -> str:
    """Map an exception to a clean Vietnamese user-facing message."""
    try:
        import openai
        if isinstance(exc, openai.AuthenticationError):
            return "API key không hợp lệ hoặc đã hết hạn. Kiểm tra lại trong Cài đặt (icon ⚙️)."
        if isinstance(exc, openai.PermissionDeniedError):
            return "API key không có quyền dùng model này. Thử model khác hoặc kiểm tra gói API."
        if isinstance(exc, openai.NotFoundError):
            return "Model không tồn tại trên API endpoint này. Chọn model khác trong cấu hình."
        if isinstance(exc, openai.RateLimitError):
            return "Vượt giới hạn API (rate limit). Đợi vài phút rồi thử lại, hoặc giảm số request song song."
        if isinstance(exc, openai.APITimeoutError):
            return "API phản hồi quá chậm (timeout). Thử lại hoặc chọn model nhanh hơn."
        if isinstance(exc, openai.APIConnectionError):
            return "Không kết nối được tới API endpoint. Kiểm tra API Base URL trong Cài đặt và kết nối mạng."
        if isinstance(exc, openai.BadRequestError):
            return f"API từ chối request: {str(exc)[:150]}"
    except ImportError:
        pass

    from app.services.translator.base import TranslationFailed
    if isinstance(exc, TranslationFailed):
        return exc.user_message

    if isinstance(exc, asyncio.TimeoutError):
        return "Dịch quá thời gian chờ. Thử lại với file nhỏ hơn hoặc provider khác."

    return f"Lỗi không xác định khi dịch: {str(exc)[:200]}"
