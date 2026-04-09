import React, { useState } from 'react';
import { Edit3, Check, X, RefreshCw } from 'lucide-react';
import { retranslateEntry, updateEntry } from '../services/api';

export default function SubtitlePreview({ fileId, entries, models, translationConfig }) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const [localEntries, setLocalEntries] = useState(entries);
  const [retranslating, setRetranslating] = useState(null);
  const [notification, setNotification] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const totalPages = Math.ceil(localEntries.length / pageSize);
  const visibleEntries = localEntries.slice((page - 1) * pageSize, page * pageSize);

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleEdit = (entry) => {
    setEditingIndex(entry.index);
    setEditText(entry.translated_text || '');
  };

  const handleSave = async (entry) => {
    try {
      await updateEntry(fileId, entry.index, editText);
      setLocalEntries(prev =>
        prev.map(e => e.index === entry.index ? { ...e, translated_text: editText } : e)
      );
      showNotification('Đã lưu');
    } catch (err) {
      showNotification('Lưu thất bại', 'error');
    }
    setEditingIndex(null);
  };

  const handleRetranslate = async (entry) => {
    setRetranslating(entry.index);
    const provider = translationConfig?.provider || 'llm';
    const model = translationConfig?.llmModel || 'gpt-4o-mini';
    const targetLang = translationConfig?.targetLang || 'vi';

    try {
      const result = await retranslateEntry(fileId, entry.index, provider, model, targetLang);
      setLocalEntries(prev =>
        prev.map(e => e.index === entry.index ? { ...e, translated_text: result.translated_text } : e)
      );
      showNotification('Đã dịch lại');
    } catch (err) {
      showNotification('Dịch lại thất bại', 'error');
    }
    setRetranslating(null);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Kết quả dịch ({localEntries.length} dòng)</h3>
        <div className="flex items-center gap-3">
          {notification && (
            <span className={`text-sm px-2 py-1 rounded ${
              notification.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}>
              {notification.msg}
            </span>
          )}
          <span className="text-sm text-gray-500">Trang {page}/{totalPages}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-12">#</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-24">Thời gian</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Gốc</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Tiếng Việt</th>
              <th className="py-2 px-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => (
              <tr key={entry.index} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-2 text-sm text-gray-400">{entry.index}</td>
                <td className="py-2 px-2 text-xs text-gray-400 font-mono">
                  {entry.start_time && (
                    <span>{entry.start_time.substring(0, 8)}</span>
                  )}
                </td>
                <td className="py-2 px-2 text-sm text-gray-700 max-w-xs">
                  <p className="line-clamp-2">{entry.original_text}</p>
                </td>
                <td className="py-2 px-2 text-sm max-w-xs">
                  {editingIndex === entry.index ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="input-field text-sm py-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSave(entry);
                          if (e.key === 'Escape') setEditingIndex(null);
                        }}
                      />
                      <button onClick={() => handleSave(entry)} className="text-green-600 hover:text-green-700">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingIndex(null)} className="text-red-500 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="line-clamp-2 text-blue-900">{entry.translated_text || '—'}</p>
                  )}
                </td>
                <td className="py-2 px-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(entry)}
                      className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                      title="Sửa"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRetranslate(entry)}
                      disabled={retranslating === entry.index}
                      className="p-1 text-gray-400 hover:text-purple-600 transition-colors"
                      title="Dịch lại"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${retranslating === entry.index ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary text-sm py-1 px-3"
          >
            Trước
          </button>
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-secondary text-sm py-1 px-3"
          >
            Sau
          </button>
        </div>
      )}
    </div>
  );
}
