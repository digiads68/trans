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

export const updateEntry = async (fileId, entryIndex, translatedText, status) => {
  const params = {};
  if (translatedText !== undefined) params.translated_text = translatedText;
  if (status) params.status = status;
  const response = await api.put(`/file/${fileId}/entry/${entryIndex}`, null, { params });
  return response.data;
};

async function blobErrorMessage(err, fallback) {
  // Error responses of blob requests come back as blobs — decode the JSON detail
  if (err.response?.data instanceof Blob) {
    const text = await err.response.data.text();
    try {
      return JSON.parse(text).detail || fallback;
    } catch {
      return fallback;
    }
  }
  return err.response?.data?.detail || err.message || fallback;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// options: { targetLang, bilingual, untranslated: 'source'|'empty'|'error' }
export const downloadExport = async (fileId, format, filename, options = {}) => {
  try {
    const response = await api.get(`/export/${fileId}`, {
      params: {
        format,
        target_lang: options.targetLang,
        bilingual: options.bilingual || undefined,
        untranslated: options.untranslated || 'source',
      },
      responseType: 'blob',
    });
    saveBlob(response.data, filename);
  } catch (err) {
    throw new Error(await blobErrorMessage(err, 'Xuất file thất bại'));
  }
};

export const downloadBatchZip = async (fileIds, format, targetLang, bilingual = false) => {
  try {
    const response = await api.post('/export/batch', {
      file_ids: fileIds, format, target_lang: targetLang, bilingual,
    }, { responseType: 'blob', timeout: 300000 });
    saveBlob(response.data, `phu_de_${targetLang}.zip`);
  } catch (err) {
    throw new Error(await blobErrorMessage(err, 'Xuất ZIP thất bại'));
  }
};

// ── Projects & editing ───────────────────────────────────────────────────────

export const listProjects = async () => (await api.get('/projects')).data.projects;
export const getProject = async (fileId) => (await api.get(`/projects/${fileId}`)).data;
export const deleteProject = async (fileId) => (await api.delete(`/projects/${fileId}`)).data;

// updates: [{ index, translated_text?, status? }]
export const bulkUpdateEntries = async (fileId, updates) => {
  const response = await api.put(`/file/${fileId}/entries`, { updates });
  return response.data.entries;
};

// Returns [{ index, old, new }]; keepOld=true writes nothing (preview for a diff)
export const retranslateEntries = async (fileId, indices, keepOld = true) => {
  const response = await api.post(`/translate/${fileId}/entries`, {
    indices, keep_old: keepOld,
  }, { timeout: 300000 });
  return response.data.results;
};

export const createWebSocket = (fileId) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return new WebSocket(`${protocol}//${host}/api/ws/${fileId}`);
};

export default api;
