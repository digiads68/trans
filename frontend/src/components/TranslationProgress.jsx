import React from 'react';
import { Loader2, XCircle } from 'lucide-react';

export default function TranslationProgress({ progress, fileData, onCancel }) {
  const total = progress?.total || fileData?.total_entries || 0;
  const completed = progress?.completed || 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const status = progress?.status || 'processing';

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

        <h2 className="text-xl font-semibold text-gray-900 mb-2">Đang dịch phụ đề...</h2>
        <p className="text-gray-500 mb-6">
          {fileData?.filename} • {completed}/{total} dòng
        </p>

        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Current text being translated */}
        {progress?.current_text && (
          <div className="bg-gray-50 rounded-lg p-3 mt-4">
            <p className="text-xs text-gray-400 mb-1">Đang dịch:</p>
            <p className="text-sm text-gray-600 italic truncate">{progress.current_text}</p>
          </div>
        )}

        {status === 'error' && progress?.error && (
          <div className="bg-red-50 rounded-lg p-3 mt-4 text-red-600 text-sm">
            Lỗi: {progress.error}
          </div>
        )}

        {/* Cancel button */}
        {onCancel && status !== 'completed' && status !== 'error' && (
          <button
            onClick={onCancel}
            className="mt-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
          >
            <XCircle className="w-4 h-4" />
            Hủy dịch
          </button>
        )}
      </div>
    </div>
  );
}
