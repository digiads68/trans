import os
import uuid
import logging
import time

from fastapi import APIRouter, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Query, Body
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
import asyncio
import httpx

from app.models.schemas import (
    TranslationRequest,
    BatchTranslationRequest,
    TranslationResponse,
    UploadResponse,
    BatchUploadResponse,
    AvailableModelsResponse,
    FileType,
    TranslationProvider,
    TranslationMode,
    HealthResponse,
)
from app.services.parser import ParserFactory
from app.services.translator import TranslatorFactory
from app.services.translator.base import TranslationCancelled, TranslationFailed
from app.services.exporter import ExporterFactory
from app.services import runtime_config
from app.services import jobs
from app.utils.language_detect import detect_language_from_entries
from app.services.cache import get_cache_stats
from app.api.websocket import manager


def _resolve_translator_creds() -> tuple[str, str]:
    """Get effective (api_base, api_key) from runtime config (falls back to env)."""
    return runtime_config.get_api_base(), runtime_config.get_api_key()


def _validate_provider_or_raise(provider: TranslationProvider) -> None:
    """Validate that the requested provider is configured. Raises HTTPException(400) if not."""
    api_key = runtime_config.get_api_key()
    if provider == TranslationProvider.LLM and not api_key:
        raise HTTPException(
            status_code=400,
            detail="Chưa cấu hình API key cho LLM. Vào Cài đặt (icon ⚙️) để cấu hình hoặc chuyển sang Google Translate.",
        )
    if provider == TranslationProvider.GOOGLE and not runtime_config.get_google_enabled():
        raise HTTPException(
            status_code=400,
            detail="Google Translate đã bị tắt. Vào Cài đặt (icon ⚙️) để bật.",
        )
    if provider == TranslationProvider.HYBRID and not api_key:
        raise HTTPException(
            status_code=400,
            detail="Hybrid mode cần API key cho LLM refine. Cấu hình trong Cài đặt (icon ⚙️).",
        )

# Lazy import to avoid circular dependency with main.py
def _get_plugin_manager():
    try:
        from app.main import plugin_manager
        return plugin_manager
    except ImportError:
        return None

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory store for uploaded files and their entries (with TTL cleanup in main.py)
file_store: dict[str, dict] = {}


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(status="ok", version=settings.APP_VERSION)


# Runtime model list (starts from settings, can be updated via API)
_runtime_models: list[str] = list(settings.AVAILABLE_LLM_MODELS)


class ModelUpdateRequest(BaseModel):
    models: list[str]


@router.get("/models", response_model=AvailableModelsResponse)
async def get_available_models():
    """Get available translation models and providers."""
    return AvailableModelsResponse(
        llm_models=_runtime_models,
        providers=[p.value for p in TranslationProvider],
        modes=[m.value for m in TranslationMode],
    )


@router.put("/models")
async def update_available_models(body: ModelUpdateRequest):
    """Update the runtime list of available LLM models (admin endpoint)."""
    global _runtime_models
    if not body.models:
        raise HTTPException(status_code=400, detail="models list cannot be empty")
    _runtime_models = [m.strip() for m in body.models if m.strip()]
    return {"models": _runtime_models}


@router.post("/models/add")
async def add_model(model: str = Body(..., embed=True)):
    """Add a model to the runtime list."""
    global _runtime_models
    model = model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="model name cannot be empty")
    if model not in _runtime_models:
        _runtime_models.append(model)
    return {"models": _runtime_models}


@router.delete("/models/{model_name}")
async def remove_model(model_name: str):
    """Remove a model from the runtime list."""
    global _runtime_models
    if model_name not in _runtime_models:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")
    if len(_runtime_models) == 1:
        raise HTTPException(status_code=400, detail="Cannot remove the last model")
    _runtime_models.remove(model_name)
    return {"models": _runtime_models}


@router.get("/cache/stats")
async def cache_stats():
    """Get translation memory cache statistics."""
    stats = await get_cache_stats()
    return stats


# ---------------------------------------------------------------------------
# Runtime API key configuration
# ---------------------------------------------------------------------------

class ConfigUpdateRequest(BaseModel):
    cliproxy_api_base: str | None = None
    cliproxy_api_key: str | None = None
    google_translate_enabled: bool | None = None


class ConfigTestRequest(BaseModel):
    api_base: str | None = None
    api_key: str | None = None
    model: str = "gpt-4o-mini"


@router.get("/config")
async def get_config():
    """Return current API configuration. The api_key value is never returned in plaintext."""
    return runtime_config.get_full_config()


@router.post("/config")
async def update_config(body: ConfigUpdateRequest):
    """Update runtime API configuration. Pass empty string to clear an override and fall back to .env."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    return runtime_config.update_config(updates)


@router.post("/config/test")
async def test_config(body: ConfigTestRequest):
    """Test API key by making a small LLM call. Uses provided values or falls back to runtime config."""
    from openai import AsyncOpenAI
    base = body.api_base or runtime_config.get_api_base()
    key = body.api_key or runtime_config.get_api_key()
    if not key:
        raise HTTPException(status_code=400, detail="API key is empty")
    try:
        client = AsyncOpenAI(base_url=base, api_key=key, timeout=15.0)
        resp = await client.chat.completions.create(
            model=body.model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        content = resp.choices[0].message.content or ""
        return {"ok": True, "model": body.model, "response": content[:80]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"API test failed: {str(e)[:200]}")


@router.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """Upload a subtitle file (SRT or Excel) for translation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("srt", "xlsx", "xls", "ass", "ssa", "vtt"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format: .{ext}. Supported: .srt, .xlsx, .xls, .ass, .ssa, .vtt",
        )

    file_id = str(uuid.uuid4())[:8]
    content = await file.read()

    # Check file size
    if len(content) > settings.MAX_UPLOAD_SIZE:
        max_mb = settings.MAX_UPLOAD_SIZE // 1_000_000
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {max_mb}MB",
        )

    # Save uploaded file
    upload_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}_{file.filename}")
    with open(upload_path, "wb") as f:
        f.write(content)

    # Parse file
    try:
        parser = ParserFactory.get_parser(file.filename)
        entries = await parser.parse(content, file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    # Detect language
    texts = [e.original_text for e in entries]
    detected_lang = detect_language_from_entries(texts)

    # Store in memory with TTL tracking
    if ext == "srt":
        file_type = FileType.SRT
    elif ext in ("xlsx", "xls"):
        file_type = FileType.EXCEL
    elif ext in ("ass", "ssa"):
        file_type = FileType.ASS
    else:
        file_type = FileType.VTT
    file_store[file_id] = {
        "filename": file.filename,
        "file_type": file_type,
        "entries": entries,
        "detected_lang": detected_lang,
        "upload_path": upload_path,
        "created_at": time.time(),
    }

    # Notify plugins
    pm = _get_plugin_manager()
    if pm:
        await pm.emit_file_uploaded(
            file_id=file_id,
            filename=file.filename,
            entries=entries,
            metadata={"detected_lang": detected_lang, "entry_count": len(entries)},
        )

    return UploadResponse(
        file_id=file_id,
        filename=file.filename,
        file_type=file_type,
        entries=entries[:10],  # Preview first 10
        detected_lang=detected_lang,
        total_entries=len(entries),
    )


@router.post("/upload/batch", response_model=BatchUploadResponse)
async def upload_files_batch(files: list[UploadFile] = File(...)):
    """Upload multiple subtitle files at once. Returns list of parsed file metadata."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 files per batch")

    results: list[UploadResponse] = []
    total_entries = 0

    for file in files:
        if not file.filename:
            continue
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in ("srt", "xlsx", "xls", "ass", "ssa", "vtt"):
            results.append(UploadResponse(
                file_id="",
                filename=file.filename,
                file_type=FileType.SRT,
                total_entries=0,
                detected_lang=None,
                entries=[],
                error=f"Định dạng .{ext} không được hỗ trợ",
            ))
            continue

        file_id = str(uuid.uuid4())[:8]
        content = await file.read()

        if len(content) > settings.MAX_UPLOAD_SIZE:
            max_mb = settings.MAX_UPLOAD_SIZE // 1_000_000
            results.append(UploadResponse(
                file_id="", filename=file.filename, file_type=FileType.SRT,
                total_entries=0, entries=[],
                error=f"File vượt quá giới hạn {max_mb}MB",
            ))
            continue

        upload_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}_{file.filename}")
        with open(upload_path, "wb") as f:
            f.write(content)

        try:
            parser = ParserFactory.get_parser(file.filename)
            entries = await parser.parse(content, file.filename)
        except Exception as e:
            results.append(UploadResponse(
                file_id="", filename=file.filename, file_type=FileType.SRT,
                total_entries=0, entries=[],
                error=f"Không đọc được file: {str(e)[:100]}",
            ))
            continue

        detected_lang = detect_language_from_entries([e.original_text for e in entries])

        if ext == "srt":
            file_type = FileType.SRT
        elif ext in ("xlsx", "xls"):
            file_type = FileType.EXCEL
        elif ext in ("ass", "ssa"):
            file_type = FileType.ASS
        else:
            file_type = FileType.VTT

        file_store[file_id] = {
            "filename": file.filename,
            "file_type": file_type,
            "entries": entries,
            "detected_lang": detected_lang,
            "upload_path": upload_path,
            "created_at": time.time(),
        }

        pm = _get_plugin_manager()
        if pm:
            await pm.emit_file_uploaded(
                file_id=file_id,
                filename=file.filename,
                entries=entries,
                metadata={"detected_lang": detected_lang, "entry_count": len(entries)},
            )

        total_entries += len(entries)
        results.append(UploadResponse(
            file_id=file_id,
            filename=file.filename,
            file_type=file_type,
            entries=entries[:5],
            detected_lang=detected_lang,
            total_entries=len(entries),
        ))

    return BatchUploadResponse(
        files=results,
        total_files=len(results),
        total_entries=total_entries,
    )


@router.get("/file/{file_id}/entries")
async def get_file_entries(
    file_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Get entries for an uploaded file with pagination."""
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="File not found")

    entries = file_store[file_id]["entries"]
    total = len(entries)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "file_id": file_id,
        "total": total,
        "page": page,
        "page_size": page_size,
        "entries": entries[start:end],
    }


async def _run_translation_job(
    job: "jobs.TranslationJob",
    request: TranslationRequest,
    translator,
    source_lang: str,
):
    """Background task that runs one translation job to completion."""
    file_data = file_store.get(request.file_id)
    if file_data is None:
        job.status = "error"
        job.error = "File đã hết hạn trong bộ nhớ. Upload lại file."
        job.finished_at = time.time()
        return

    entries = file_data["entries"]
    total = len(entries)
    pm = _get_plugin_manager()
    translation_meta = {
        "source_lang": source_lang,
        "target_lang": request.target_lang,
        "provider": translator.provider_name,
        "mode": request.mode.value if hasattr(request.mode, "value") else str(request.mode),
    }

    async def on_progress(completed: int, tot: int, current_text: str):
        job.completed = completed
        job.current_text = current_text
        await manager.send_progress(request.file_id, {
            "type": "progress",
            "file_id": request.file_id,
            "completed": completed,
            "total": tot,
            "current_text": current_text,
            "status": "processing",
        })

    job.status = "processing"
    start_ts = time.time()

    try:
        # Fresh run: clear previous translations so failed-count is accurate.
        # Cached lines re-fill instantly, so restarting a cancelled job is cheap.
        for e in entries:
            e.translated_text = None

        await manager.send_progress(request.file_id, {
            "type": "start",
            "file_id": request.file_id,
            "total": total,
            "provider": translator.provider_name,
            "status": "processing",
        })

        if pm:
            await pm.emit_translation_start(request.file_id, entries, translation_meta)

        translated_entries = await translator.translate_batch(
            entries=entries,
            source_lang=source_lang,
            target_lang=request.target_lang,
            mode=request.mode,
            on_progress=on_progress,
            custom_prompt=request.custom_prompt,
            glossary=request.glossary,
            should_cancel=job.cancel_event.is_set,
        )

        file_store[request.file_id]["entries"] = translated_entries

        failed = sum(1 for e in translated_entries if not e.translated_text)
        job.completed = total
        job.failed = failed
        job.status = "completed"
        job.finished_at = time.time()

        if pm:
            await pm.emit_translation_complete(
                request.file_id,
                translated_entries,
                {**translation_meta, "duration_seconds": round(time.time() - start_ts, 2)},
            )

        await manager.send_progress(request.file_id, {
            "type": "complete",
            "file_id": request.file_id,
            "completed": total,
            "total": total,
            "failed": failed,
            "status": "completed",
        })

        if request.webhook_url:
            asyncio.create_task(_fire_webhook(request.webhook_url, {
                "file_id": request.file_id,
                "original_file": file_data["filename"],
                "status": "completed",
                "total_entries": total,
                "failed_entries": failed,
                **translation_meta,
            }))

    except (TranslationCancelled, asyncio.CancelledError):
        job.status = "cancelled"
        job.finished_at = time.time()
        # Entries translated before the cancel are kept in file_store
        await manager.send_progress(request.file_id, {
            "type": "cancelled",
            "file_id": request.file_id,
            "completed": job.completed,
            "total": total,
            "status": "cancelled",
        })
        logger.info(f"Translation cancelled for {request.file_id} at {job.completed}/{total}")

    except Exception as e:
        logger.exception(f"Translation job failed for {request.file_id}")
        job.status = "error"
        job.error = jobs.classify_error(e)
        job.finished_at = time.time()
        await manager.send_progress(request.file_id, {
            "type": "error",
            "file_id": request.file_id,
            "error": job.error,
            "status": "error",
        })


@router.post("/translate")
async def translate_file(request: TranslationRequest):
    """Start a translation job. Returns immediately; track progress via
    WebSocket /ws/{file_id} or GET /translate/{file_id}/status."""
    if request.file_id not in file_store:
        raise HTTPException(status_code=404, detail="File not found. Please upload first.")

    file_data = file_store[request.file_id]
    entries = file_data["entries"]
    source_lang = request.source_lang or file_data.get("detected_lang") or "auto"

    # Validate provider configuration
    _validate_provider_or_raise(request.provider)
    api_base, api_key = _resolve_translator_creds()

    try:
        translator = TranslatorFactory.create(
            provider=request.provider,
            model=request.llm_model,
            api_base=api_base,
            api_key=api_key,
            hybrid_primary=request.hybrid_primary,
            hybrid_fallback=request.hybrid_fallback,
            hybrid_refine=request.hybrid_refine,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create translator: {str(e)}")

    try:
        job = jobs.create_job(
            request.file_id,
            total=len(entries),
            provider=translator.provider_name,
            target_lang=request.target_lang,
        )
    except jobs.JobConflict:
        raise HTTPException(
            status_code=409,
            detail="File này đang được dịch. Đợi hoàn thành hoặc hủy job hiện tại trước.",
        )

    job.task = asyncio.create_task(_run_translation_job(job, request, translator, source_lang))

    return {
        "status": "started",
        "file_id": request.file_id,
        "total": len(entries),
        "provider": translator.provider_name,
    }


@router.get("/translate/{file_id}/status")
async def get_translation_status(file_id: str):
    """Poll translation job status (fallback when WebSocket is unavailable)."""
    job = jobs.get_job(file_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No translation job for this file")
    return job.to_dict()


@router.post("/translate/{file_id}/cancel")
async def cancel_translation(file_id: str):
    """Cancel a running translation job. Already-translated lines are kept."""
    job = jobs.request_cancel(file_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không có job dịch nào đang chạy cho file này")
    return {"status": "cancelling", "file_id": file_id, "completed": job.completed, "total": job.total}


async def _fire_webhook(url: str, payload: dict) -> None:
    """Send webhook notification with translation result. Errors are logged, not raised."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code >= 400:
                logger.warning(f"Webhook {url} returned {resp.status_code}")
    except Exception as e:
        logger.warning(f"Webhook delivery failed ({url}): {e}")


@router.post("/translate/batch")
async def translate_files_batch(request: BatchTranslationRequest):
    """
    Translate multiple uploaded files with a single set of settings.
    Returns list of translation results.
    Sequential by default; set parallel=true for concurrent translation.
    """
    if not request.file_ids:
        raise HTTPException(status_code=400, detail="file_ids cannot be empty")

    missing = [fid for fid in request.file_ids if fid not in file_store]
    if missing:
        raise HTTPException(status_code=404, detail=f"Files not found: {missing}")

    # Validate provider configuration once for the whole batch
    _validate_provider_or_raise(request.provider)
    api_base, api_key = _resolve_translator_creds()

    async def _translate_one(file_id: str) -> dict:
        file_data = file_store[file_id]
        entries = file_data["entries"]
        source_lang = request.source_lang or file_data.get("detected_lang", "auto")

        translator = TranslatorFactory.create(
            provider=request.provider,
            model=request.llm_model,
            api_base=api_base,
            api_key=api_key,
            hybrid_primary=request.hybrid_primary,
            hybrid_fallback=request.hybrid_fallback,
            hybrid_refine=request.hybrid_refine,
        )

        async def on_progress(completed: int, total: int, current_text: str):
            await manager.send_progress(file_id, {
                "type": "progress",
                "file_id": file_id,
                "completed": completed,
                "total": total,
                "current_text": current_text,
                "status": "processing",
            })

        try:
            await manager.send_progress(file_id, {
                "type": "start",
                "file_id": file_id,
                "total": len(entries),
                "provider": translator.provider_name,
                "status": "processing",
            })

            translated = await translator.translate_batch(
                entries=entries,
                source_lang=source_lang,
                target_lang=request.target_lang,
                mode=request.mode,
                on_progress=on_progress,
                custom_prompt=request.custom_prompt,
                glossary=request.glossary,
            )

            file_store[file_id]["entries"] = translated

            await manager.send_progress(file_id, {
                "type": "complete",
                "file_id": file_id,
                "completed": len(entries),
                "total": len(entries),
                "status": "completed",
            })

            return {
                "file_id": file_id,
                "filename": file_data["filename"],
                "status": "completed",
                "total_entries": len(translated),
                "source_lang": source_lang,
                "target_lang": request.target_lang,
                "provider": translator.provider_name,
            }

        except Exception as e:
            logger.error(f"Batch translate failed for {file_id}: {e}")
            await manager.send_progress(file_id, {
                "type": "error",
                "file_id": file_id,
                "error": str(e),
                "status": "error",
            })
            return {
                "file_id": file_id,
                "filename": file_data.get("filename", ""),
                "status": "error",
                "error": str(e),
            }

    if request.parallel:
        results = await asyncio.gather(*[_translate_one(fid) for fid in request.file_ids])
    else:
        results = []
        for fid in request.file_ids:
            results.append(await _translate_one(fid))

    # Fire webhook if requested
    if request.webhook_url:
        asyncio.create_task(_fire_webhook(request.webhook_url, {"results": results}))

    return {
        "results": results,
        "total_files": len(results),
        "completed": sum(1 for r in results if r.get("status") == "completed"),
        "failed": sum(1 for r in results if r.get("status") == "error"),
    }


@router.post("/translate/{file_id}/entry/{entry_index}")
async def translate_single_entry(
    file_id: str,
    entry_index: int,
    provider: TranslationProvider = TranslationProvider.LLM,
    llm_model: str = "gpt-4o-mini",
    target_lang: str = "vi",
):
    """Re-translate a single subtitle entry."""
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="File not found")

    entries = file_store[file_id]["entries"]
    entry = next((e for e in entries if e.index == entry_index), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    source_lang = file_store[file_id].get("detected_lang", "auto")

    _validate_provider_or_raise(provider)
    api_base, api_key = _resolve_translator_creds()

    translator = TranslatorFactory.create(
        provider=provider, model=llm_model,
        api_base=api_base,
        api_key=api_key,
    )

    try:
        entry.translated_text = await translator.translate_text(
            entry.original_text, source_lang, target_lang,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=jobs.classify_error(e))

    return entry


@router.put("/file/{file_id}/entry/{entry_index}")
async def update_entry(file_id: str, entry_index: int, translated_text: str):
    """Manually update a translation."""
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="File not found")

    entries = file_store[file_id]["entries"]
    entry = next((e for e in entries if e.index == entry_index), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    entry.translated_text = translated_text
    return entry


@router.get("/export/{file_id}")
async def export_file(
    file_id: str,
    format: str = Query("srt", pattern="^(srt|xlsx|excel|vtt|premiere|davinci|ass)$"),
    target_lang: str = Query("vi"),
):
    """Export translated file in desired format."""
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="File not found")

    file_data = file_store[file_id]
    entries = file_data["entries"]

    # Check if translations exist
    has_translations = any(e.translated_text for e in entries)
    if not has_translations:
        raise HTTPException(status_code=400, detail="No translations available. Please translate first.")

    exporter = ExporterFactory.get_exporter(format)
    base_name = file_data["filename"].rsplit(".", 1)[0]
    output_filename = f"{base_name}_{target_lang}.{exporter.file_extension()}"
    output_path = os.path.join(settings.OUTPUT_DIR, f"{file_id}_{output_filename}")

    await exporter.export(entries, output_path)

    # Notify plugins
    pm = _get_plugin_manager()
    if pm:
        await pm.emit_export(file_id, format, output_path, entries)

    return FileResponse(
        path=output_path,
        filename=output_filename,
        media_type="application/octet-stream",
    )


@router.websocket("/ws/{file_id}")
async def websocket_endpoint(websocket: WebSocket, file_id: str):
    """WebSocket endpoint for real-time translation progress."""
    await manager.connect(websocket, file_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "cancel":
                # Real cancellation — the job runner broadcasts the
                # "cancelled" event once the translator actually stops.
                jobs.request_cancel(file_id)
    except WebSocketDisconnect:
        manager.disconnect(websocket, file_id)
