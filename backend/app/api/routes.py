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
from app.services.exporter import ExporterFactory
from app.utils.language_detect import detect_language_from_entries
from app.services.cache import get_cache_stats
from app.api.websocket import manager

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
            ))
            continue

        file_id = str(uuid.uuid4())[:8]
        content = await file.read()

        if len(content) > settings.MAX_UPLOAD_SIZE:
            continue  # Skip oversized files silently in batch

        upload_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}_{file.filename}")
        with open(upload_path, "wb") as f:
            f.write(content)

        try:
            parser = ParserFactory.get_parser(file.filename)
            entries = await parser.parse(content, file.filename)
        except Exception:
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


@router.post("/translate", response_model=TranslationResponse)
async def translate_file(request: TranslationRequest):
    """Start translation of an uploaded file."""
    if request.file_id not in file_store:
        raise HTTPException(status_code=404, detail="File not found. Please upload first.")

    file_data = file_store[request.file_id]
    entries = file_data["entries"]
    source_lang = request.source_lang or file_data.get("detected_lang", "auto")

    # Create translator
    try:
        translator = TranslatorFactory.create(
            provider=request.provider,
            model=request.llm_model,
            api_base=settings.CLIPROXY_API_BASE,
            api_key=settings.CLIPROXY_API_KEY,
            hybrid_primary=request.hybrid_primary,
            hybrid_fallback=request.hybrid_fallback,
            hybrid_refine=request.hybrid_refine,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create translator: {str(e)}")

    # Progress callback that sends WebSocket updates
    async def on_progress(completed: int, total: int, current_text: str):
        await manager.send_progress(request.file_id, {
            "type": "progress",
            "file_id": request.file_id,
            "completed": completed,
            "total": total,
            "current_text": current_text,
            "status": "processing",
        })

    # Translate
    import time as _time
    _start_ts = _time.time()
    pm = _get_plugin_manager()
    translation_meta = {
        "source_lang": source_lang,
        "target_lang": request.target_lang,
        "provider": translator.provider_name,
        "mode": request.mode.value if hasattr(request.mode, "value") else str(request.mode),
    }

    try:
        await manager.send_progress(request.file_id, {
            "type": "start",
            "file_id": request.file_id,
            "total": len(entries),
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
        )

        # Update store
        file_store[request.file_id]["entries"] = translated_entries

        if pm:
            await pm.emit_translation_complete(
                request.file_id,
                translated_entries,
                {**translation_meta, "duration_seconds": round(_time.time() - _start_ts, 2)},
            )

        await manager.send_progress(request.file_id, {
            "type": "complete",
            "file_id": request.file_id,
            "completed": len(entries),
            "total": len(entries),
            "status": "completed",
        })

        response = TranslationResponse(
            file_id=request.file_id,
            original_file=file_data["filename"],
            entries=translated_entries,
            source_lang=source_lang,
            target_lang=request.target_lang,
            provider=translator.provider_name,
            model=request.llm_model,
            status="completed",
        )

        # Fire webhook if requested (non-blocking)
        if request.webhook_url:
            asyncio.create_task(_fire_webhook(request.webhook_url, response.model_dump()))

        return response

    except Exception as e:
        logger.error(f"Translation failed: {e}")
        await manager.send_progress(request.file_id, {
            "type": "error",
            "file_id": request.file_id,
            "error": str(e),
            "status": "error",
        })
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")


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

    async def _translate_one(file_id: str) -> dict:
        file_data = file_store[file_id]
        entries = file_data["entries"]
        source_lang = request.source_lang or file_data.get("detected_lang", "auto")

        translator = TranslatorFactory.create(
            provider=request.provider,
            model=request.llm_model,
            api_base=settings.CLIPROXY_API_BASE,
            api_key=settings.CLIPROXY_API_KEY,
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

    translator = TranslatorFactory.create(
        provider=provider, model=llm_model,
        api_base=settings.CLIPROXY_API_BASE,
        api_key=settings.CLIPROXY_API_KEY,
    )

    entry.translated_text = await translator.translate_text(
        entry.original_text, source_lang, target_lang,
    )

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
    format: str = Query("srt", regex="^(srt|xlsx|excel|vtt|premiere|davinci|ass)$"),
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
            # Handle client messages if needed (e.g., cancel)
            if data == "cancel":
                await manager.send_progress(file_id, {
                    "type": "cancelled",
                    "file_id": file_id,
                    "status": "cancelled",
                })
    except WebSocketDisconnect:
        manager.disconnect(websocket, file_id)
