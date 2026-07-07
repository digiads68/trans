import React, { useState, useMemo } from 'react';
import {
  Edit3, Check, X, RefreshCw, Search, Replace, AlertTriangle,
  Gauge, CaseSensitive,
} from 'lucide-react';
import { retranslateEntry, updateEntry } from '../services/api';

// ── Professional subtitle QC rules (Netflix-style) ───────────────────────────
const QC_MAX_CPS = 20;          // chars per second — faster is unreadable
const QC_MAX_LINE_LEN = 42;     // chars per rendered line
const QC_MIN_DURATION = 1.0;    // seconds
const QC_MAX_DURATION = 7.0;    // seconds

function parseTimestamp(ts) {
  if (!ts) return null;
  // Supports "00:00:01,000" (SRT) and "00:00:01.000" (VTT)
  const m = ts.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
}

function computeQc(entry) {
  const issues = [];
  const text = entry.translated_text || '';

  if (!text) {
    issues.push({ code: 'untranslated', label: 'Chưa dịch' });
    return issues;
  }

  const start = parseTimestamp(entry.start_time);
  const end = parseTimestamp(entry.end_time);
  const duration = start != null && end != null ? end - start : null;

  if (duration != null && duration > 0) {
    const cps = text.replace(/\n/g, '').length / duration;
    if (cps > QC_MAX_CPS) {
      issues.push({ code: 'cps', label: `${cps.toFixed(0)} ký tự/giây — đọc không kịp` });
    }
    if (duration < QC_MIN_DURATION) {
      issues.push({ code: 'flash', label: `Hiện ${duration.toFixed(1)}s — quá ngắn` });
    } else if (duration > QC_MAX_DURATION) {
      issues.push({ code: 'linger', label: `Hiện ${duration.toFixed(1)}s — quá lâu` });
    }
  }

  const longLine = text.split('\n').find((line) => line.length > QC_MAX_LINE_LEN);
  if (longLine) {
    issues.push({ code: 'long', label: `Dòng ${longLine.length} ký tự (>${QC_MAX_LINE_LEN})` });
  }

  return issues;
}

const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'issues', label: 'Có vấn đề' },
  { key: 'untranslated', label: 'Chưa dịch' },
  { key: 'edited', label: 'Đã sửa tay' },
];

export default function SubtitlePreview({ fileId, entries, models, translationConfig }) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const [localEntries, setLocalEntries] = useState(entries);
  const [editedIndices, setEditedIndices] = useState(new Set());
  const [retranslating, setRetranslating] = useState(null);
  const [notification, setNotification] = useState(null);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  // Find & Replace state
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const qcMap = useMemo(() => {
    const map = new Map();
    for (const e of localEntries) {
      map.set(e.index, computeQc(e));
    }
    return map;
  }, [localEntries]);

  const counts = useMemo(() => ({
    all: localEntries.length,
    issues: localEntries.filter((e) => qcMap.get(e.index)?.length > 0).length,
    untranslated: localEntries.filter((e) => !e.translated_text).length,
    edited: editedIndices.size,
  }), [localEntries, qcMap, editedIndices]);

  const filteredEntries = useMemo(() => {
    switch (filter) {
      case 'issues': return localEntries.filter((e) => qcMap.get(e.index)?.length > 0);
      case 'untranslated': return localEntries.filter((e) => !e.translated_text);
      case 'edited': return localEntries.filter((e) => editedIndices.has(e.index));
      default: return localEntries;
    }
  }, [localEntries, filter, qcMap, editedIndices]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleEntries = filteredEntries.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Find & Replace matches
  const findMatches = useMemo(() => {
    if (!findText) return [];
    const needle = caseSensitive ? findText : findText.toLowerCase();
    return localEntries.filter((e) => {
      const hay = caseSensitive ? (e.translated_text || '') : (e.translated_text || '').toLowerCase();
      return hay.includes(needle);
    });
  }, [localEntries, findText, caseSensitive]);

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const changeFilter = (key) => {
    setFilter(key);
    setPage(1);
    setEditingIndex(null);
  };

  const handleEdit = (entry) => {
    setEditingIndex(entry.index);
    setEditText(entry.translated_text || '');
  };

  const handleSave = async (entry) => {
    try {
      await updateEntry(fileId, entry.index, editText);
      setLocalEntries((prev) =>
        prev.map((e) => (e.index === entry.index ? { ...e, translated_text: editText } : e))
      );
      setEditedIndices((prev) => new Set(prev).add(entry.index));
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
      setLocalEntries((prev) =>
        prev.map((e) => (e.index === entry.index ? { ...e, translated_text: result.translated_text } : e))
      );
      showNotification('Đã dịch lại');
    } catch (err) {
      showNotification(err.response?.data?.detail || 'Dịch lại thất bại', 'error');
    }
    setRetranslating(null);
  };

  const handleReplaceAll = async () => {
    if (!findText || findMatches.length === 0) return;
    setReplacing(true);

    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    let ok = 0;
    let failed = 0;
    const updated = new Map();

    for (const entry of findMatches) {
      const newText = (entry.translated_text || '').replace(pattern, replaceText);
      if (newText === entry.translated_text) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await updateEntry(fileId, entry.index, newText);
        updated.set(entry.index, newText);
        ok += 1;
      } catch {
        failed += 1;
      }
    }

    if (updated.size > 0) {
      setLocalEntries((prev) =>
        prev.map((e) => (updated.has(e.index) ? { ...e, translated_text: updated.get(e.index) } : e))
      );
      setEditedIndices((prev) => {
        const next = new Set(prev);
        updated.forEach((_, idx) => next.add(idx));
        return next;
      });
    }

    setReplacing(false);
    showNotification(
      failed ? `Đã thay ${ok} dòng, ${failed} lỗi` : `Đã thay thế trong ${ok} dòng`,
      failed ? 'error' : 'success'
    );
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold text-lg">Kết quả dịch ({localEntries.length} dòng)</h3>
        <div className="flex items-center gap-3">
          {notification && (
            <span className={`text-sm px-2 py-1 rounded ${
              notification.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}>
              {notification.msg}
            </span>
          )}
          <button
            onClick={() => setShowFindReplace((s) => !s)}
            className={`btn-secondary text-sm flex items-center gap-1.5 ${showFindReplace ? 'ring-2 ring-blue-300' : ''}`}
          >
            <Replace className="w-4 h-4" />
            Tìm & Thay thế
          </button>
        </div>
      </div>

      {/* Find & Replace panel */}
      {showFindReplace && (
        <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder="Tìm trong bản dịch..."
                className="input-field text-sm py-1.5 pl-8 w-52"
              />
            </div>
            <span className="text-gray-400">→</span>
            <input
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="Thay bằng..."
              className="input-field text-sm py-1.5 w-52"
            />
            <button
              type="button"
              onClick={() => setCaseSensitive((s) => !s)}
              className={`p-1.5 rounded border text-sm ${caseSensitive
                ? 'bg-blue-100 border-blue-400 text-blue-700'
                : 'border-gray-300 text-gray-400 hover:text-gray-600'}`}
              title="Phân biệt hoa/thường"
            >
              <CaseSensitive className="w-4 h-4" />
            </button>
            <button
              onClick={handleReplaceAll}
              disabled={!findText || findMatches.length === 0 || replacing}
              className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"
            >
              {replacing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Thay tất cả
            </button>
            {findText && (
              <span className="text-sm text-gray-500">
                {findMatches.length} dòng khớp
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Dùng để đổi tên nhân vật/xưng hô đồng loạt — VD tìm "cô ấy" thay bằng "nàng".
          </p>
        </div>
      )}

      {/* QC filter tabs */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Gauge className="w-4 h-4 text-gray-400 mr-0.5" />
        {FILTERS.map((f) => {
          const count = counts[f.key];
          const active = filter === f.key;
          const warn = (f.key === 'issues' || f.key === 'untranslated') && count > 0;
          return (
            <button
              key={f.key}
              onClick={() => changeFilter(f.key)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-all
                ${active
                  ? 'bg-blue-600 text-white'
                  : warn
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-12">#</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-24">Thời gian</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Gốc</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Tiếng Việt</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-24">QC</th>
              <th className="py-2 px-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const issues = qcMap.get(entry.index) || [];
              const isEdited = editedIndices.has(entry.index);
              return (
                <tr key={entry.index} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-2 text-sm text-gray-400">{entry.index}</td>
                  <td className="py-2 px-2 text-xs text-gray-400 font-mono">
                    {entry.start_time && <span>{entry.start_time.substring(0, 8)}</span>}
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
                      <p className={`line-clamp-2 ${entry.translated_text ? 'text-blue-900' : 'text-gray-300 italic'}`}>
                        {entry.translated_text || 'chưa dịch'}
                        {isEdited && <span className="ml-1 text-xs text-green-600" title="Đã sửa tay">✎</span>}
                      </p>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    {issues.length > 0 && (
                      <span
                        className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded
                          ${issues.some((i) => i.code === 'untranslated')
                            ? 'bg-red-50 text-red-600'
                            : 'bg-amber-50 text-amber-700'}`}
                        title={issues.map((i) => i.label).join('\n')}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {issues.length}
                      </span>
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
              );
            })}
            {visibleEntries.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                  Không có dòng nào khớp bộ lọc này
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="btn-secondary text-sm py-1 px-3"
          >
            Trước
          </button>
          <span className="text-sm text-gray-500">
            {safePage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="btn-secondary text-sm py-1 px-3"
          >
            Sau
          </button>
        </div>
      )}
    </div>
  );
}
