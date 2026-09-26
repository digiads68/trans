import React, { useState } from 'react';
import {
  FileText, FileSpreadsheet, ArrowLeft, CheckCircle2, Clock, Loader2, Play, Square, XCircle,
  FolderArchive, AlertTriangle,
} from 'lucide-react';
import { downloadBatchZip } from '../services/api';
import { TARGET_LANGUAGES, loadProfiles, parseGlossary } from '../utils/subtitle';

const FILE_TYPE_ICONS = { srt: FileText, excel: FileSpreadsheet, ass: FileText, vtt: FileText };

export default function BatchManager({
  files, fileStatuses = {}, onOpenFile, onBack, models, apiConfig,
  onTranslateAll, onStopBatch, batchRunning, batchCurrentId, progress,
}) {
  const okFiles = files.filter((f) => f.file_id);
  const failedFiles = files.filter((f) => !f.file_id);
  const doneCount = okFiles.filter((f) => fileStatuses[f.file_id] === 'done').length;
  const pendingCount = okFiles.length - doneCount;
  const totalEntries = okFiles.reduce((sum, f) => sum + (f.total_entries || 0), 0);

  const apiKeySet = apiConfig?.cliproxy_api_key_set ?? true;
  const profiles = loadProfiles();
  const [profileName, setProfileName] = useState('');
  const [provider, setProvider] = useState(apiKeySet ? 'llm' : 'google');
  const [llmModel, setLlmModel] = useState('gpt-4o-mini');
  const [targetLang, setTargetLang] = useState('vi');
  const [contextAware, setContextAware] = useState(true);
  const [zipFormat, setZipFormat] = useState('srt');
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState(null);

  const profile = profiles.find((p) => p.name === profileName);

  const applyProfile = (name) => {
    setProfileName(name);
    const p = profiles.find((x) => x.name === name);
    if (!p) return;
    if (p.provider) setProvider(p.provider);
    if (p.llmModel) setLlmModel(p.llmModel);
    if (p.targetLang) setTargetLang(p.targetLang);
  };

  const isLLM = provider !== 'google';
  const buildRequest = (file) => ({
    file_id: file.file_id,
    provider,
    llm_model: llmModel,
    mode: 'standard',
    context_aware: isLLM && contextAware,
    source_lang: null,
    target_lang: targetLang,
    custom_prompt: isLLM ? (profile?.customPrompt || null) : null,
    glossary: parseGlossary(profile?.glossaryText),
    scope: 'missing',
    hybrid_primary: provider === 'hybrid' ? 'google' : null,
    hybrid_fallback: provider === 'hybrid' ? 'llm' : null,
    hybrid_refine: provider === 'hybrid',
  });

  const handleZip = async () => {
    setZipping(true);
    setZipError(null);
    try {
      await downloadBatchZip(okFiles.map((f) => f.file_id), zipFormat, targetLang);
    } catch (err) {
      setZipError(err.message);
    }
    setZipping(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold">{okFiles.length} file · {totalEntries} dòng phụ đề</h2>
            <p className="text-sm text-gray-500">{doneCount}/{okFiles.length} file đã dịch xong</p>
          </div>
          <button onClick={onBack} className="btn-secondary flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" /> Trang chủ
          </button>
        </div>

        {/* Shared config for "translate all" */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <label className="block">
            <span className="text-xs text-gray-500">Hồ sơ phim</span>
            <select value={profileName} onChange={(e) => applyProfile(e.target.value)} className="select-field py-1.5 text-sm" disabled={batchRunning}>
              <option value="">— Không dùng —</option>
              {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Phương thức</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="select-field py-1.5 text-sm" disabled={batchRunning}>
              <option value="llm">AI (LLM)</option>
              <option value="google">Google</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Model AI</span>
            <select value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className="select-field py-1.5 text-sm" disabled={batchRunning || !isLLM}>
              {(models?.llm_models?.length ? models.llm_models : [llmModel]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Ngôn ngữ đích</span>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="select-field py-1.5 text-sm" disabled={batchRunning}>
              {Object.entries(TARGET_LANGUAGES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
          {isLLM && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={contextAware} onChange={(e) => setContextAware(e.target.checked)} disabled={batchRunning} />
              Dịch theo ngữ cảnh
            </label>
          )}
          {profile && (
            <span className="text-indigo-700">
              Áp dụng hồ sơ “{profile.name}”: {Object.keys(parseGlossary(profile.glossaryText) || {}).length} thuật ngữ
              {profile.customPrompt ? ' + bối cảnh phim' : ''}
            </span>
          )}
          {isLLM && !apiKeySet && (
            <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Chưa có API key — chọn Google hoặc vào Cài đặt</span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {batchRunning ? (
            <button onClick={onStopBatch} className="btn-secondary flex items-center gap-1.5 text-sm text-red-600">
              <Square className="w-4 h-4" /> Dừng
            </button>
          ) : (
            <button
              onClick={() => onTranslateAll(buildRequest)}
              disabled={pendingCount === 0 || (isLLM && !apiKeySet)}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              <Play className="w-4 h-4" /> Dịch tất cả ({pendingCount})
            </button>
          )}
          <span className="text-gray-300 mx-1">|</span>
          <select value={zipFormat} onChange={(e) => setZipFormat(e.target.value)} className="select-field py-1.5 text-sm w-auto">
            <option value="srt">SRT</option>
            <option value="ass">ASS</option>
            <option value="vtt">VTT</option>
            <option value="xlsx">Excel</option>
          </select>
          <button onClick={handleZip} disabled={zipping || doneCount === 0} className="btn-success flex items-center gap-1.5 text-sm">
            {zipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderArchive className="w-4 h-4" />}
            Xuất tất cả (ZIP)
          </button>
        </div>
        {zipError && <p className="text-sm text-red-600 mt-2">{zipError}</p>}
        <p className="text-xs text-gray-400 mt-2">
          “Dịch tất cả” chỉ dịch các dòng còn thiếu, không đụng vào dòng đã sửa/duyệt. Mở từng file để hậu kiểm.
        </p>
      </div>

      {failedFiles.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="font-medium text-red-800 text-sm mb-2">{failedFiles.length} file bị bỏ qua:</p>
          <ul className="space-y-1">
            {failedFiles.map((f, i) => (
              <li key={i} className="text-sm text-red-700 flex items-center gap-2">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{f.filename}</span>
                {f.error && <span className="text-red-500 text-xs">— {f.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        {okFiles.map((file) => {
          const Icon = FILE_TYPE_ICONS[file.file_type] || FileText;
          const status = fileStatuses[file.file_id];
          const isActive = batchCurrentId === file.file_id;
          const percent = isActive && progress?.total > 0 ? Math.round((progress.completed / progress.total) * 100) : null;
          return (
            <div
              key={file.file_id}
              className={`card py-3 flex items-center gap-4
                ${status === 'done' ? 'border-green-200 bg-green-50/50' : ''}
                ${status === 'error' ? 'border-red-200 bg-red-50/40' : ''}
                ${isActive ? 'border-blue-400 ring-2 ring-blue-100' : ''}`}
            >
              <div className="p-2.5 rounded-xl bg-gray-100 flex-shrink-0">
                {isActive
                  ? <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  : <Icon className={`w-5 h-5 ${status === 'done' ? 'text-green-600' : 'text-gray-400'}`} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{file.filename}</p>
                <p className="text-xs text-gray-500">
                  {file.total_entries} dòng · <span className="uppercase">{file.file_type}</span>
                  {file.detected_lang && ` · ${file.detected_lang}`}
                  {status === 'error' && <span className="text-red-500"> · dịch lỗi — mở file để xem chi tiết</span>}
                </p>
                {isActive && percent != null && (
                  <div className="mt-1.5 w-full bg-gray-200 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${percent}%` }} />
                  </div>
                )}
              </div>
              {status === 'done' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : !isActive && <Clock className="w-5 h-5 text-gray-300" />}
              <button onClick={() => onOpenFile(file)} disabled={batchRunning} className="btn-secondary text-sm py-1.5 px-3">
                Mở
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
