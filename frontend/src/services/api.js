import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000, // translation runs as a background job, no long requests needed
});

export const uploadFile = async (file, onUploadProgress) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
  return response.data;
};

export const uploadFileBatch = async (files, onUploadProgress) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const response = await api.post('/upload/batch', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
  return response.data;
};

export const getModels = async () => {
  const response = await api.get('/models');
  return response.data;
};

export const getConfig = async () => {
  const response = await api.get('/config');
  return response.data;
};

export const updateConfig = async (updates) => {
  const response = await api.post('/config', updates);
  return response.data;
};

export const testConfig = async (payload) => {
  const response = await api.post('/config/test', payload);
  return response.data;
};

export const getFileEntries = async (fileId, page = 1, pageSize = 50) => {
  const response = await api.get(`/file/${fileId}/entries`, {
    params: { page, page_size: pageSize },
  });
  return response.data;
};

// Fetch ALL entries of a file by paging through the entries endpoint
export const getAllEntries = async (fileId) => {
  const pageSize = 200;
  const first = await getFileEntries(fileId, 1, pageSize);
  const entries = [...first.entries];
  const totalPages = Math.ceil(first.total / pageSize);
  for (let page = 2; page <= totalPages; page++) {
    const data = await getFileEntries(fileId, page, pageSize);
    entries.push(...data.entries);
  }
  return entries;
};

// ── Translation jobs ─────────────────────────────────────────────────────────

export const startTranslationJob = async (request) => {
  const response = await api.post('/translate', request);
  return response.data; // { status: 'started', file_id, total, provider }
};

export const getJobStatus = async (fileId) => {
  const response = await api.get(`/translate/${fileId}/status`);
  return response.data; // { status, completed, total, failed, error, ... }
};

export const cancelJob = async (fileId) => {
  const response = await api.post(`/translate/${fileId}/cancel`);
  return response.data;
};

export const retranslateEntry = async (fileId, entryIndex, provider, model, targetLang) => {
  const response = await api.post(
    `/translate/${fileId}/entry/${entryIndex}`,
    null,
    { params: { provider, llm_model: model, target_lang: targetLang } }
  );
  return response.data;
};

export const updateEntry = async (fileId, entryIndex, translatedText) => {
  const response = await api.put(
    `/file/${fileId}/entry/${entryIndex}`,
    null,
    { params: { translated_text: translatedText } }
  );
  return response.data;
};

// Download an export as a blob and trigger the browser download.
// Throws with a clean message when the backend rejects (e.g. no translations).
export const downloadExport = async (fileId, format = 'srt', targetLang = 'vi', filename = 'subtitle') => {
  try {
    const response = await api.get(`/export/${fileId}`, {
      params: { format, target_lang: targetLang },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    // Error responses come back as blobs — decode the JSON detail
    if (err.response?.data instanceof Blob) {
      const text = await err.response.data.text();
      let detail = 'Xuất file thất bại';
      try {
        detail = JSON.parse(text).detail || detail;
      } catch {
        // not JSON — keep generic message
      }
      throw new Error(detail);
    }
    throw new Error(err.response?.data?.detail || err.message || 'Xuất file thất bại');
  }
};

export const createWebSocket = (fileId) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return new WebSocket(`${protocol}//${host}/api/ws/${fileId}`);
};

export default api;
