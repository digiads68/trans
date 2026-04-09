import { useState, useCallback, useRef } from 'react';
import { startTranslation, createWebSocket } from '../services/api';

export function useTranslation() {
  const [progress, setProgress] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);

  const connectWebSocket = useCallback((fileId) => {
    return new Promise((resolve) => {
      const ws = createWebSocket(fileId);
      wsRef.current = ws;

      ws.onopen = () => resolve(ws);

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setProgress(data);

        if (data.status === 'completed' || data.status === 'error') {
          setIsTranslating(false);
        }
      };

      ws.onerror = () => {
        resolve(ws);
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
      // Connect WebSocket for progress
      await connectWebSocket(request.file_id);

      // Start translation
      const result = await startTranslation(request);
      setIsTranslating(false);
      return result;
    } catch (err) {
      setIsTranslating(false);
      const msg = err.response?.data?.detail || err.message;
      setError(msg);
      throw err;
    }
  }, [connectWebSocket]);

  const cancel = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send('cancel');
      wsRef.current.close();
    }
    setIsTranslating(false);
  }, []);

  return { translate, cancel, progress, isTranslating, error };
}
