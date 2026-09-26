import { useState, useCallback, useRef, useEffect } from 'react';
import {
  startTranslationJob,
  getJobStatus,
  cancelJob,
  createWebSocket,
} from '../services/api';

const POLL_INTERVAL = 2000; // status polling — authoritative; WS is only a fast nudge
const TERMINAL = ['completed', 'cancelled', 'error'];

/**
 * Job-based translation hook. MUST live in App (a component that stays mounted
 * for the whole job), never in a screen that can unmount mid-translation.
 *
 * startJob(request, callbacks) starts a backend job; resume(fileId, callbacks)
 * reattaches to a job that is already running (e.g. after a page refresh).
 * callbacks: onComplete(status), onError(message, status), onCancelled(status).
 * Translated lines are merged into the project on the server as the job runs;
 * screens refetch entries when `progress.completed` changes.
 */
export function useTranslation() {
  const [progress, setProgress] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState(null);
  const [jobFileId, setJobFileId] = useState(null);

  const genRef = useRef(0); // generation counter — stale jobs are ignored
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

  const track = useCallback((fileId, gen, startedAt, callbacks) => {
    const { onComplete, onError, onCancelled } = callbacks || {};
    const isStale = () => gen !== genRef.current;

    const apply = (data) => {
      if (isStale() || finishedRef.current) return;
      setProgress((p) => ({
        ...(p || {}),
        fileId,
        completed: data.completed ?? p?.completed ?? 0,
        total: data.total ?? p?.total ?? 0,
        failed: data.failed ?? p?.failed ?? 0,
        current_text: data.current_text ?? p?.current_text ?? '',
        status: data.status || p?.status || 'processing',
        startedAt,
      }));
    };

    const finish = (status) => {
      if (isStale() || finishedRef.current) return;
      finishedRef.current = true;
      cleanup();
      setIsTranslating(false);
      setIsCancelling(false);
      setProgress((p) => ({ ...(p || {}), ...status, fileId, startedAt }));
      if (status.status === 'completed') {
        onComplete?.(status);
      } else if (status.status === 'error') {
        const msg = status.error || 'Dịch thất bại không rõ nguyên nhân';
        setError(msg);
        onError?.(msg, status);
      } else if (status.status === 'cancelled') {
        onCancelled?.(status);
      }
    };

    const poll = async () => {
      if (isStale() || finishedRef.current) return;
      try {
        const status = await getJobStatus(fileId);
        if (isStale()) return;
        apply(status);
        if (TERMINAL.includes(status.status)) finish(status);
      } catch { /* transient poll failure — next tick retries */ }
    };

    try {
      const ws = createWebSocket(fileId);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        if (isStale()) return;
        try {
          const data = JSON.parse(event.data);
          apply(data);
          if (TERMINAL.includes(data.status)) poll();
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => { wsRef.current = null; };
      ws.onerror = () => { /* polling covers us */ };
    } catch { /* polling covers us */ }

    pollRef.current = setInterval(poll, POLL_INTERVAL);
    poll();
  }, [cleanup]);

  const begin = useCallback((fileId) => {
    const gen = ++genRef.current;
    cleanup();
    finishedRef.current = false;
    setError(null);
    setIsCancelling(false);
    setIsTranslating(true);
    setJobFileId(fileId);
    const startedAt = Date.now();
    setProgress({ fileId, completed: 0, total: 0, failed: 0, status: 'starting', current_text: '', startedAt });
    return { gen, startedAt };
  }, [cleanup]);

  const startJob = useCallback(async (request, callbacks = {}) => {
    const fileId = request.file_id;
    const { gen, startedAt } = begin(fileId);
    try {
      const started = await startTranslationJob(request);
      if (gen !== genRef.current) return;
      setProgress((p) => ({ ...p, total: started.total, status: 'processing' }));
    } catch (err) {
      if (gen !== genRef.current) return;
      setIsTranslating(false);
      const msg = err.response?.data?.detail || err.message;
      setError(msg);
      callbacks.onError?.(msg, null);
      return;
    }
    track(fileId, gen, startedAt, callbacks);
  }, [begin, track]);

  const resume = useCallback((fileId, callbacks = {}) => {
    const { gen, startedAt } = begin(fileId);
    track(fileId, gen, startedAt, callbacks);
  }, [begin, track]);

  const cancel = useCallback(async (fileId) => {
    setIsCancelling(true);
    try {
      await cancelJob(fileId);
      // The job runner confirms via WS/polling → onCancelled fires from finish()
    } catch {
      // No active job — treat as already stopped
      genRef.current += 1;
      setIsCancelling(false);
      setIsTranslating(false);
      cleanup();
    }
  }, [cleanup]);

  return {
    startJob, resume, cancel, progress, isTranslating, isCancelling, error, setError, jobFileId,
  };
}
