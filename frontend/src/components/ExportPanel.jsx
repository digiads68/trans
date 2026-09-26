import React, { useState } from 'react';
import {
  Download, FileText, FileSpreadsheet, Film, Tv, Loader2, XCircle, X, AlertTriangle, Languages,
} from 'lucide-react';
import { downloadExport } from '../services/api';

const EXPORT_FORMATS = [
  { id: 'srt', label: 'SRT', ext: 'srt', description: 'Mọi trình phát video', icon: FileText },
  { id: 'ass', label: 'ASS', ext: 'ass', description: 'Giữ nguyên style/vị trí của file ASS gốc', icon: FileText },
  { id: 'vtt', label: 'WebVTT', ext: 'vtt', description: 'HTML5 video, YouTube', icon: FileText },
  { id: 'xlsx', label: 'Excel', ext: 'xlsx', description: 'Song ngữ + trạng thái từng dòng', icon: FileSpreadsheet },
  { id: 'premiere', label: 'Premiere XML', ext: 'xml', description: 'Adobe Premiere Pro', icon: Film },
  { id: 'davinci', label: 'DaVinci SRT', ext: 'srt', description: 'DaVinci Resolve (UTF-8, không BOM)', icon: Tv },
];

export default function ExportPanel({ fileId, filename, targetLang = 'vi', counts, onClose }) {
  const baseName = filename?.replace(/\.[^.]+$/, '') || 'subtitle';
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(null);
  const [bilingual, setBilingual] = useState(false);
  const [untranslated, setUntranslated] = useState('source');

  const missing = counts?.untranslated || 0;
  const unreviewed = counts ? counts.total - counts.reviewed - missing : 0;
  const nothingTranslated = counts && counts.total === missing;

  const handleDownload = async (fmt) => {
    setDownloading(fmt.id);
    setError(null);
    try {
      const suffix = bilingual && ['srt', 'vtt', 'ass', 'davinci'].includes(fmt.id) ? '_songngu' : '';
      await downloadExport(fileId, fmt.id, `${baseName}_${targetLang}${suffix}.${fmt.ext}`, {
        targetLang, bilingual, untranslated,
      });
    } catch (err) {
      setError(err.message || 'Xuất file thất bại');
    }
    setDownloading(null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <Download className="w-5 h-5 text-green-600" /> Xuất bản dịch
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Đóng"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {nothingTranslated && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Chưa có dòng nào được dịch. Hãy dịch trước khi xuất.
            </div>
          )}

          {!nothingTranslated && missing > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm">
              <p className="font-medium text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Còn {missing} dòng chưa dịch
              </p>
              <div className="mt-1.5 space-y-1 text-amber-900">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={untranslated === 'source'} onChange={() => setUntranslated('source')} />
                  Giữ nguyên câu gốc ở các dòng đó
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={untranslated === 'empty'} onChange={() => setUntranslated('empty')} />
                  Để trống các dòng đó
                </label>
              </div>
            </div>
          )}

          {!nothingTranslated && unreviewed > 0 && (
            <p className="text-xs text-gray-500">
              Lưu ý: {unreviewed} dòng đã dịch nhưng chưa được duyệt.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={bilingual} onChange={(e) => setBilingual(e.target.checked)} />
            <Languages className="w-4 h-4 text-gray-500" />
            Song ngữ (câu gốc phía trên câu dịch) — cho SRT/ASS/VTT
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
              <XCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EXPORT_FORMATS.map((fmt) => {
              const Icon = fmt.icon;
              const isDownloading = downloading === fmt.id;
              return (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => handleDownload(fmt)}
                  disabled={isDownloading || nothingTranslated}
                  className="flex items-center gap-3 p-3 rounded-lg border-2 border-gray-200 text-left transition-all hover:border-green-500 hover:bg-green-50 disabled:opacity-50"
                >
                  {isDownloading
                    ? <Loader2 className="w-7 h-7 text-gray-400 flex-shrink-0 animate-spin" />
                    : <Icon className="w-7 h-7 text-gray-400 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{fmt.label}</p>
                    <p className="text-xs text-gray-500">{fmt.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
