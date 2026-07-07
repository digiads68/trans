import React from 'react';
import { Loader2, XCircle, AlertTriangle } from 'lucide-react';

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `~${mins}p ${secs}s`;
}

export default function TranslationProgress({ progress, fileData, onCancel, isCancelling }) {
  const total = progress?.total || fileData?.total_entries || 0;
  const completed = progress?.completed || 0;
  const failed = progress?.failed || 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const status = progress?.status || 'processing';

  // ETA from observed translation rate
  let eta = null;
  if (progress?.startedAt && completed > 0 && completed < total) {
    const elapsedSec = (Date.now() - progress.startedAt) / 1000;
    const rate = completed / elapsedSec; // lines per second
    if (rate > 0) eta = formatEta((total - completed) / rate);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card text-center">
        <div className="flex justify-center mb-6">
          <div className="relative">
            <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold text-blue-600">{percent}%</span>
            </div>
          </div>
        </div>

        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {isCancelling ? 'Đang hủy dịch...' : 'Đang dịch phụ đề...'}
        </h2>
        <p className="text-gray-500 mb-1">
          {fileData?.filename} • {completed}/{total} dòng
        </p>
        {eta && !isCancelling && (
          <p className="text-sm text-gray-400 mb-4">Còn lại {eta}</p>
        )}
        {isCancelling && (
          <p className="text-sm text-amber-600 mb-4">
            Các dòng đã dịch sẽ được giữ lại để xem và xuất file.
          </p>
        )}

        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Failed lines warning */}
        {failed > 0 && (
          <div className="inline-flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5 mb-2">
            <AlertTriangle className="w-4 h-4" />
            {failed} dòng lỗi
          </div>
        )}

        {/* Current text being translated */}
        {progress?.current_text && !isCancelling && (
          <div className="bg-gray-50 rounded-lg p-3 mt-4">
            <p className="text-xs text-gray-400 mb-1">Đang dịch:</p>
            <p className="text-sm text-gray-600 italic truncate">{progress.current_text}</p>
          </div>
        )}

        {/* Cancel button */}
        {onCancel && status !== 'completed' && status !== 'error' && !isCancelling && (
          <button
            onClick={onCancel}
            className="mt-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
          >
            <XCircle className="w-4 h-4" />
            Hủy dịch (giữ lại phần đã dịch)
          </button>
        )}
      </div>
    </div>
  );
}
