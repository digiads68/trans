import React from 'react';
import { FileText, FileSpreadsheet, ArrowLeft, ChevronRight, CheckCircle2, Clock } from 'lucide-react';

const FILE_TYPE_ICONS = {
  srt: FileText,
  excel: FileSpreadsheet,
  ass: FileText,
  vtt: FileText,
};

export default function BatchManager({ files, onSelectFile, onBack, translationConfig }) {
  const translated = files.filter(f => f._translated);
  const totalEntries = files.reduce((sum, f) => sum + (f.total_entries || 0), 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Summary */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{files.length} file đã tải lên</h2>
            <p className="text-sm text-gray-500">
              Tổng {totalEntries} dòng phụ đề
              {translated.length > 0 && ` • ${translated.length}/${files.length} đã dịch`}
            </p>
          </div>
          <button onClick={onBack} className="btn-secondary flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Quay lại
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="space-y-3">
        {files.map((file, idx) => {
          const Icon = FILE_TYPE_ICONS[file.file_type] || FileText;
          const isTranslated = file._translated;
          const lang = file.detected_lang;

          return (
            <button
              key={file.file_id || idx}
              onClick={() => onSelectFile(file)}
              disabled={!file.file_id}
              className={`w-full card flex items-center gap-4 text-left transition-all group
                ${file.file_id
                  ? 'hover:border-blue-400 hover:shadow-md cursor-pointer'
                  : 'opacity-50 cursor-not-allowed'
                }
                ${isTranslated ? 'border-green-200 bg-green-50/50' : ''}
              `}
            >
              <div className={`p-3 rounded-xl ${isTranslated ? 'bg-green-100' : 'bg-gray-100 group-hover:bg-blue-100'}`}>
                <Icon className={`w-6 h-6 ${isTranslated ? 'text-green-600' : 'text-gray-400 group-hover:text-blue-600'}`} />
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
                </div>
                {/* Preview */}
                {file.entries?.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1 truncate">
                    {file.entries[0].original_text}
                  </p>
                )}
              </div>

              <div className="flex-shrink-0 flex items-center gap-2">
                {isTranslated ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <Clock className="w-5 h-5 text-gray-300" />
                )}
                <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Hint */}
      <p className="text-center text-sm text-gray-400">
        Chọn từng file để cấu hình và dịch
      </p>
    </div>
  );
}
