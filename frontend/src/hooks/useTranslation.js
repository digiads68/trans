import { useState, useCallback, useRef, useEffect } from 'react';
import { startTranslation, createWebSocket } from '../services/api';

const WS_CONNECT_TIMEOUT = 15000; // 15s

export function useTranslation() {
  const [progress, setProgress] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const isMountedRef = useRef(true);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const closeWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback((fileId) => {
    return new Promise((resolve, reject) => {
      const ws = createWebSocket(fileId);
      wsRef.current = ws;

      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          resolve(null); // Proceed without WS (progress won't show but translation still works)
        }
      }, WS_CONNECT_TIMEOUT);

      ws.onopen = () => {
        clearTimeout(timeout);
        resolve(ws);
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          setProgress(data);

          if (data.status === 'completed' || data.status === 'error') {
            setIsTranslating(false);
          }
        } catch (e) {
          // Ignore malformed messages
        }
      };

      ws.onerror = (e) => {
        clearTimeout(timeout);
        if (isMountedRef.current) {
          setError('WebSocket connection failed. Translation will continue without live progress.');
        }
        resolve(null);
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    });
  }, []);

  const translate = useCallback(async (request) => {
    setIsTranslating(true);
    setError(null);
    setProgress({ completed: 0, total: 0, status: 'connecting' });

    try {
      // Connect WebSocket for progress (non-blocking - translation works without it)
      await connectWebSocket(request.file_id);

      // Start translation
      const result = await startTranslation(request);
      if (isMountedRef.current) {
        setIsTranslating(false);
      }
      closeWebSocket();
      return result;
    } catch (err) {
      if (isMountedRef.current) {
        setIsTranslating(false);
        const msg = err.response?.data?.detail || err.message;
        setError(msg);
      }
      closeWebSocket();
      throw err;
    }
  }, [connectWebSocket, closeWebSocket]);

  const cancel = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send('cancel');
    }
    closeWebSocket();
    if (isMountedRef.current) {
      setIsTranslating(false);
      setProgress(null);
    }
  }, [closeWebSocket]);

  return { translate, cancel, progress, isTranslating, error };
}
