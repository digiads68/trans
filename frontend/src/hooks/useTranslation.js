import { useState, useCallback, useRef, useEffect } from 'react';
import {
  startTranslationJob,
  getJobStatus,
  cancelJob,
  getAllEntries,
  createWebSocket,
} from '../services/api';

const POLL_INTERVAL = 2500; // status polling fallback when WS is silent/broken

/**
 * Job-based translation hook. MUST live in a component that stays mounted
 * for the whole translation (i.e. App), not in a screen that unmounts.
 *
 * startJob(request, { onComplete, onError, onCancelled }) → returns immediately;
 * progress arrives via WebSocket with status polling as a fallback. Completion
 * fetches the translated entries and calls onComplete({ entries, failed }).
 */
export function useTranslation() {
  const [progress, setProgress] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState(null);

  const genRef = useRef(0);       // generation counter — stale jobs are ignored
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const finishedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* already closed */ }
      wsRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    genRef.current += 1;
    cleanup();
  }, [cleanup]);

  const startJob = useCallback(async (request, { onComplete, onError, onCancelled } = {}) => {
    const gen = ++genRef.current;
    cleanup();
    finishedRef.current = false;
    setError(null);
    setIsCancelling(false);
    setIsTranslating(true);
    setProgress({
      completed: 0,
      total: 0,
      failed: 0,
      status: 'starting',
      current_text: '',
      startedAt: Date.now(),
    });

    const fileId = request.file_id;
    const startedAt = Date.now();

    const isStale = () => gen !== genRef.current;

    const finish = async (status) => {
      if (isStale() || finishedRef.current) return;
      finishedRef.current = true;
      cleanup();
      setIsTranslating(false);
      setIsCancelling(false);

      if (status.status === 'completed') {
        try {
          const entries = await getAllEntries(fileId);
          if (isStale()) return;
          setProgress((p) => ({ ...p, ...status, startedAt }));
          onComplete?.({ entries, failed: status.failed || 0, total: status.total });
        } catch (err) {
          const msg = 'Dịch xong nhưng không tải được kết quả: ' + (err.message || '');
          setError(msg);
          onError?.(msg, status);
        }
      } else if (status.status === 'error') {
        const msg = status.error || 'Dịch thất bại không rõ nguyên nhân';
        setError(msg);
        setProgress((p) => ({ ...p, ...status, startedAt }));
        onError?.(msg, status);
      } else if (status.status === 'cancelled') {
        setProgress((p) => ({ ...p, ...status, startedAt }));
        onCancelled?.(status);
      }
    };

    const applyProgress = (data) => {
      if (isStale() || finishedRef.current) return;
      setProgress((p) => ({
        ...(p || {}),
        completed: data.completed ?? p?.completed ?? 0,
        total: data.total ?? p?.total ?? 0,
        failed: data.failed ?? p?.failed ?? 0,
        current_text: data.current_text ?? p?.current_text ?? '',
        status: data.status || p?.status || 'processing',
        startedAt,
      }));
    };

    // 1) Start the job — returns immediately
    try {
      const started = await startTranslationJob(request);
      if (isStale()) return;
      applyProgress({ completed: 0, total: started.total, status: 'processing' });
    } catch (err) {
      if (isStale()) return;
      setIsTranslating(false);
      const msg = err.response?.data?.detail || err.message;
      setError(msg);
      onError?.(msg, null);
      return;
    }

    // 2) Live progress via WebSocket (best-effort)
    try {
      const ws = createWebSocket(fileId);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        if (isStale()) return;
        try {
          const data = JSON.parse(event.data);
          applyProgress(data);
          if (['completed', 'cancelled', 'error'].includes(data.status)) {
            // Authoritative state comes from the status endpoint
            getJobStatus(fileId).then(finish).catch(() => {});
          }
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => { wsRef.current = null; };
      ws.onerror = () => { /* polling covers us */ };
    } catch { /* polling covers us */ }

    // 3) Poll status as the reliable fallback
    pollRef.current = setInterval(async () => {
      if (isStale() || finishedRef.current) {
        cleanup();
        return;
      }
      try {
        const status = await getJobStatus(fileId);
        if (isStale()) return;
        applyProgress(status);
        if (['completed', 'cancelled', 'error'].includes(status.status)) {
          await finish(status);
        }
      } catch { /* transient poll failure — next tick retries */ }
    }, POLL_INTERVAL);
  }, [cleanup]);

  const cancel = useCallback(async (fileId) => {
    setIsCancelling(true);
    try {
      await cancelJob(fileId);
      // The job runner confirms via WS/polling → onCancelled fires from finish()
    } catch (err) {
      // No active job — treat as already stopped
      setIsCancelling(false);
      setIsTranslating(false);
      cleanup();
    }
  }, [cleanup]);

  return { startJob, cancel, progress, isTranslating, isCancelling, error, setError };
}
