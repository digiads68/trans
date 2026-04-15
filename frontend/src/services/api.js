import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 300000, // 5 min for large translations
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

export const startTranslation = async (request) => {
  const response = await api.post('/translate', request);
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

export const exportFile = (fileId, format = 'srt', targetLang = 'vi') => {
  return `${API_BASE}/export/${fileId}?format=${format}&target_lang=${targetLang}`;
};

export const createWebSocket = (fileId) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return new WebSocket(`${protocol}//${host}/api/ws/${fileId}`);
};

export default api;
