import React from 'react';
import {
  FileText, FileSpreadsheet, ArrowLeft, ChevronRight, CheckCircle2,
  Clock, Loader2, Play, Square, XCircle, Eye,
} from 'lucide-react';

const FILE_TYPE_ICONS = {
  srt: FileText,
  excel: FileSpreadsheet,
  ass: FileText,
  vtt: FileText,
};

export default function BatchManager({
  files, fileStatuses = {}, onSelectFile, onBack, translationConfig,
  onTranslateAll, onStopBatch, batchRunning, batchCurrentId, progress,
  onPreviewFile,
}) {
  const okFiles = files.filter((f) => f.file_id);
  const failedFiles = files.filter((f) => !f.file_id);
  const doneCount = okFiles.filter((f) => fileStatuses[f.file_id] === 'done').length;
  const totalEntries = okFiles.reduce((sum, f) => sum + (f.total_entries || 0), 0);
  const pendingCount = okFiles.length - doneCount;

  const buildRequest = (file) => ({
    file_id: file.file_id,
    provider: translationConfig?.provider || 'google',
    llm_model: translationConfig?.llmModel || 'gpt-4o-mini',
    mode: 'standard',
    source_lang: null,
    target_lang: translationConfig?.targetLang || 'vi',
    custom_prompt: null,
    glossary: null,
    hybrid_primary: translationConfig?.provider === 'hybrid' ? 'google' : null,
    hybrid_fallback: translationConfig?.provider === 'hybrid' ? 'llm' : null,
    hybrid_refine: translationConfig?.provider === 'hybrid',
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Summary + bulk actions */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold">{okFiles.length} file đã tải lên</h2>
            <p className="text-sm text-gray-500">
              Tổng {totalEntries} dòng phụ đề
              {doneCount > 0 && ` • ${doneCount}/${okFiles.length} đã dịch`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {batchRunning ? (
              <button
                onClick={onStopBatch}
                className="btn-secondary flex items-center gap-1.5 text-sm text-red-600"
              >
                <Square className="w-4 h-4" />
                Dừng
              </button>
            ) : (
              pendingCount > 0 && (
                <button
                  onClick={() => onTranslateAll(buildRequest)}
                  className="btn-primary flex items-center gap-1.5 text-sm"
                  title={`Dịch ${pendingCount} file còn lại bằng ${translationConfig?.provider || 'google'}`}
                >
                  <Play className="w-4 h-4" />
                  Dịch tất cả ({pendingCount})
                </button>
              )
            )}
            <button onClick={onBack} className="btn-secondary flex items-center gap-1 text-sm">
              <ArrowLeft className="w-4 h-4" />
              Quay lại
            </button>
          </div>
        </div>
        {batchRunning && (
          <p className="text-sm text-blue-600 mt-2">
            Đang dịch lần lượt từng file bằng {translationConfig?.provider === 'llm'
              ? `AI (${translationConfig?.llmModel})`
              : translationConfig?.provider === 'hybrid' ? 'Hybrid' : 'Google Translate'}...
          </p>
        )}
      </div>

      {/* Failed uploads */}
      {failedFiles.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="font-medium text-red-800 text-sm mb-2">
            {failedFiles.length} file bị bỏ qua:
          </p>
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

      {/* File list */}
      <div className="space-y-3">
        {okFiles.map((file) => {
          const Icon = FILE_TYPE_ICONS[file.file_type] || FileText;
          const status = fileStatuses[file.file_id];
          const isDone = status === 'done';
          const isError = status === 'error';
          const isActive = batchCurrentId === file.file_id;
          const lang = file.detected_lang;

          const percent = isActive && progress?.total > 0
            ? Math.round((progress.completed / progress.total) * 100)
            : null;

          return (
            <div
              key={file.file_id}
              className={`card flex items-center gap-4 transition-all
                ${isDone ? 'border-green-200 bg-green-50/50' : ''}
                ${isError ? 'border-red-200 bg-red-50/40' : ''}
                ${isActive ? 'border-blue-400 ring-2 ring-blue-100' : ''}
              `}
            >
              <div className={`p-3 rounded-xl flex-shrink-0
                ${isDone ? 'bg-green-100' : isActive ? 'bg-blue-100' : 'bg-gray-100'}`}
              >
                {isActive
                  ? <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                  : <Icon className={`w-6 h-6 ${isDone ? 'text-green-600' : 'text-gray-400'}`} />}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{file.filename}</p>
                <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
                  <span>{file.total_entries} dòng</span>
                  <span className="text-gray-300">|</span>
                  <span className="uppercase text-xs font-medium text-gray-400">{file.file_type}</span>
                  {lang && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span>{lang}</span>
                    </>
                  )}
                  {isError && <span className="text-red-500 text-xs">dịch lỗi — thử lại</span>}
                </div>
                {/* Live progress for the active file */}
                {isActive && percent != null && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="text-xs text-blue-600 mt-1">
                      {progress.completed}/{progress.total} dòng ({percent}%)
                    </p>
                  </div>
                )}
                {!isActive && file.entries?.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1 truncate">
                    {file.entries[0].original_text}
                  </p>
                )}
              </div>

              <div className="flex-shrink-0 flex items-center gap-1.5">
                {isDone ? (
                  <>
                    <button
                      onClick={() => onPreviewFile?.(file)}
                      className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
                      title="Xem và sửa kết quả dịch"
                    >
                      <Eye className="w-4 h-4" />
                      Xem
                    </button>
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  </>
                ) : (
                  <>
                    {!batchRunning && (
                      <button
                        onClick={() => onSelectFile(file)}
                        className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
                        title="Cấu hình chi tiết và dịch file này"
                      >
                        Cấu hình
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                    {!isActive && <Clock className="w-5 h-5 text-gray-300" />}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hint */}
      <p className="text-center text-sm text-gray-400">
        "Dịch tất cả" dùng cấu hình chung • Bấm "Cấu hình" để chỉnh riêng từng file (glossary, bối cảnh phim...)
      </p>
    </div>
  );
}
