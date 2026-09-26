import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Search, Replace, CheckCircle2, RefreshCw, Undo2, X, AlertTriangle, CaseSensitive,
  Keyboard, Play, Tag, Check,
} from 'lucide-react';
import { bulkUpdateEntries, retranslateEntries } from '../services/api';
import {
  STATUS_INFO, computeQc, entryDuration, textMetrics, hasInlineTags, parseTimestamp,
  parseJumpTime, QC_MAX_CPS, QC_MAX_LINE_LEN,
} from '../utils/subtitle';

const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'untranslated', label: 'Chưa dịch' },
  { key: 'machine', label: 'Máy dịch' },
  { key: 'edited', label: 'Đã sửa' },
  { key: 'unreviewed', label: 'Chưa duyệt' },
  { key: 'issues', label: 'Lỗi QC' },
];

function matchesFilter(entry, filter, qc) {
  switch (filter) {
    case 'untranslated': return entry.status === 'untranslated';
    case 'machine': return entry.status === 'machine';
    case 'edited': return entry.status === 'edited';
    case 'unreviewed': return entry.status !== 'reviewed';
    case 'issues': return qc.length > 0;
    default: return true;
  }
}

// ── Inline editor for one line ───────────────────────────────────────────────

function EditBox({ entry, onCommit, onCancel }) {
  const [text, setText] = useState(entry.translated_text || '');
  const ref = useRef(null);
  const duration = entryDuration(entry);
  const { cps, maxLine } = textMetrics(text, duration);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onCommit(text, { review: true, move: 1 });
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      onCommit(text, { move: 1 });
    } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      onCommit(text, { move: e.key === 'ArrowDown' ? 1 : -1 });
    }
  };

  return (
    <div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={Math.max(2, text.split('\n').length)}
        className="w-full px-2 py-1.5 border-2 border-blue-400 rounded-md text-sm focus:outline-none resize-none"
        aria-label={`Bản dịch dòng ${entry.index}`}
      />
      <div className="flex items-center justify-between text-[11px] mt-0.5 gap-2">
        <span className="text-gray-400">Enter lưu · Shift+Enter xuống dòng · Ctrl+Enter duyệt · Esc hủy</span>
        <span className="whitespace-nowrap">
          {cps != null && (
            <span className={cps > QC_MAX_CPS ? 'text-red-600 font-medium' : 'text-gray-500'}>
              {cps.toFixed(0)} ký tự/s
            </span>
          )}
          <span className={`ml-2 ${maxLine > QC_MAX_LINE_LEN ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
            {maxLine}/{QC_MAX_LINE_LEN}
          </span>
        </span>
      </div>
    </div>
  );
}

// ── One row ──────────────────────────────────────────────────────────────────

const Row = memo(function Row({
  entry, qc, isEditing, isActive, isSelected, isFlash,
  onSelect, onStartEdit, onCommit, onCancel, onToggleReview, onRetranslate, onSeek, busy,
}) {
  const status = STATUS_INFO[entry.status] || STATUS_INFO.untranslated;
  const inlineTags = hasInlineTags(entry);

  return (
    <div
      id={`row-${entry.index}`}
      className={`grid grid-cols-[28px_44px_76px_1fr_1fr_92px_60px] gap-2 px-2 py-2 border-b border-gray-100 items-start text-sm
        ${isActive ? 'bg-yellow-50' : isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50'}
        ${isFlash ? 'ring-2 ring-inset ring-blue-400' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => {}}
        onClick={(e) => onSelect(entry.index, e.shiftKey)}
        className="mt-1"
        aria-label={`Chọn dòng ${entry.index}`}
      />
      <span className="text-gray-400 text-xs mt-0.5">{entry.index}</span>
      <button
        onClick={() => onSeek(entry)}
        className="text-left text-[11px] font-mono text-gray-400 hover:text-blue-600 mt-0.5"
        title="Tua video tới đây"
      >
        {entry.start_time ? String(entry.start_time).replace(',', '.').slice(0, 11) : ''}
      </button>
      <div className="text-gray-700 whitespace-pre-line break-words">
        {entry.prefix && (
          <span className="inline-flex items-center text-[10px] text-gray-400 bg-gray-100 rounded px-1 mr-1 align-middle" title={`Định dạng giữ nguyên khi xuất: ${entry.prefix}…${entry.suffix}`}>
            <Tag className="w-2.5 h-2.5 mr-0.5" />{entry.prefix.length > 12 ? 'tag' : entry.prefix}
          </span>
        )}
        {entry.original_text}
        {inlineTags && (
          <span className="block text-[10px] text-amber-600 mt-0.5" title={entry.raw_text}>
            ⚠ Có định dạng giữa câu — không giữ được khi xuất
          </span>
        )}
      </div>
      <div className="break-words">
        {isEditing ? (
          <EditBox entry={entry} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <button
            onClick={() => onStartEdit(entry.index)}
            className={`w-full text-left whitespace-pre-line rounded px-1 -mx-1 hover:bg-blue-50 min-h-[1.5rem]
              ${entry.translated_text ? 'text-blue-950' : 'text-gray-300 italic'}`}
            title="Bấm để sửa"
          >
            {entry.translated_text || 'bấm để dịch tay…'}
          </button>
        )}
        {!isEditing && qc.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-amber-700 mt-0.5" title={qc.map((i) => i.label).join('\n')}>
            <AlertTriangle className="w-3 h-3" />
            {qc[0].label}{qc.length > 1 ? ` (+${qc.length - 1})` : ''}
          </span>
        )}
      </div>
      <span className={`text-[11px] border rounded px-1.5 py-0.5 text-center ${status.cls}`}>{status.label}</span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onToggleReview(entry)}
          disabled={!entry.translated_text}
          className={`p-1 rounded ${entry.status === 'reviewed' ? 'text-green-600' : 'text-gray-300 hover:text-green-600'} disabled:opacity-30`}
          title={entry.status === 'reviewed' ? 'Bỏ duyệt' : 'Duyệt (Ctrl+Enter khi đang sửa)'}
        >
          <CheckCircle2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => onRetranslate([entry.index])}
          disabled={busy}
          className="p-1 rounded text-gray-300 hover:text-purple-600 disabled:opacity-30"
          title="Dịch lại dòng này (xem trước khi áp dụng)"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

// ── Diff modal for retranslation ─────────────────────────────────────────────

function DiffModal({ items, onApply, onClose }) {
  const [accepted, setAccepted] = useState(() => new Set(items.filter((i) => i.new).map((i) => i.index)));
  const toggle = (idx) => setAccepted((prev) => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold">So sánh bản dịch lại ({items.length} dòng)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-3 space-y-3">
          {items.map((item) => (
            <label key={item.index} className={`block border rounded-lg p-3 cursor-pointer ${accepted.has(item.index) ? 'border-purple-300 bg-purple-50/40' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <input type="checkbox" checked={accepted.has(item.index)} disabled={!item.new} onChange={() => toggle(item.index)} />
                <span className="text-xs text-gray-400">#{item.index}</span>
                <span className="text-xs text-gray-600 truncate">{item.original}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] text-gray-400 mb-0.5">Hiện tại</p>
                  <p className="whitespace-pre-line text-gray-600">{item.old || <em className="text-gray-300">trống</em>}</p>
                </div>
                <div>
                  <p className="text-[11px] text-purple-500 mb-0.5">Bản dịch mới</p>
                  <p className="whitespace-pre-line text-purple-900">{item.new || <em className="text-red-400">dịch lỗi</em>}</p>
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="btn-secondary text-sm">Giữ bản cũ</button>
          <button onClick={() => onApply(items.filter((i) => accepted.has(i.index)))} disabled={!accepted.size} className="btn-primary text-sm">
            Áp dụng {accepted.size} dòng
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main editor ──────────────────────────────────────────────────────────────

export default function SubtitleEditor({
  fileId, entries, setEntries, onSaved, notify, activeIndex, followVideo, onSeek, jobRunning,
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [flashIndex, setFlashIndex] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [diffItems, setDiffItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceExcluded, setReplaceExcluded] = useState(() => new Set());
  const [showHelp, setShowHelp] = useState(false);
  const lastClickedRef = useRef(null);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const qcMap = useMemo(() => {
    const map = new Map();
    for (const e of entries) map.set(e.index, computeQc(e));
    return map;
  }, [entries]);

  const counts = useMemo(() => {
    const c = { all: entries.length, untranslated: 0, machine: 0, edited: 0, unreviewed: 0, issues: 0, reviewed: 0 };
    for (const e of entries) {
      c[e.status] = (c[e.status] || 0) + 1;
      if (e.status !== 'reviewed') c.unreviewed += 1;
      if (qcMap.get(e.index)?.length) c.issues += 1;
    }
    return c;
  }, [entries, qcMap]);

  const searchTerm = query.trim().startsWith('#') || parseJumpTime(query) != null ? '' : query.trim().toLowerCase();

  const visible = useMemo(() => entries.filter((e) => {
    if (!matchesFilter(e, filter, qcMap.get(e.index) || [])) return false;
    if (!searchTerm) return true;
    return e.original_text.toLowerCase().includes(searchTerm)
      || (e.translated_text || '').toLowerCase().includes(searchTerm);
  }), [entries, filter, qcMap, searchTerm]);

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // ── Scrolling helpers ──
  const scrollTo = useCallback((index, block = 'nearest') => {
    requestAnimationFrame(() => {
      document.getElementById(`row-${index}`)?.scrollIntoView({ block, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    if (followVideo && activeIndex != null && editingIndex == null) scrollTo(activeIndex, 'center');
  }, [activeIndex, followVideo, editingIndex, scrollTo]);

  const flash = (index) => {
    setFlashIndex(index);
    scrollTo(index, 'center');
    setTimeout(() => setFlashIndex((cur) => (cur === index ? null : cur)), 1500);
  };

  // ── Persisting changes ──
  const applyLocal = useCallback((updatedList) => {
    const byIdx = new Map(updatedList.map((e) => [e.index, e]));
    setEntries((prev) => prev.map((e) => (byIdx.has(e.index) ? { ...e, ...byIdx.get(e.index) } : e)));
  }, [setEntries]);

  const persist = useCallback(async (updates, undoLabel) => {
    const before = updates.map((u) => {
      const cur = entriesRef.current.find((e) => e.index === u.index);
      return { index: u.index, translated_text: cur?.translated_text ?? '', status: cur?.status };
    });
    // Optimistic update
    applyLocal(updates.map((u) => {
      const cur = entriesRef.current.find((e) => e.index === u.index) || {};
      const text = u.translated_text !== undefined ? (u.translated_text || null) : cur.translated_text;
      const status = u.status || (u.translated_text !== undefined ? (u.translated_text ? 'edited' : 'untranslated') : cur.status);
      return { index: u.index, translated_text: text, status };
    }));
    try {
      const saved = await bulkUpdateEntries(fileId, updates);
      applyLocal(saved);
      onSaved?.(new Date());
      if (undoLabel) setUndoStack((s) => [...s.slice(-19), { label: undoLabel, updates: before }]);
      return true;
    } catch (err) {
      applyLocal(before.map((b) => ({ ...b, translated_text: b.translated_text || null })));
      notify?.(err.response?.data?.detail || 'Lưu thất bại — kiểm tra kết nối backend', 'error');
      return false;
    }
  }, [applyLocal, fileId, notify, onSaved]);

  const handleUndo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((s) => s.slice(0, -1));
    if (await persist(last.updates, null)) notify?.(`Đã hoàn tác: ${last.label}`);
  };

  // ── Editing flow ──
  const moveFrom = useCallback((index, delta) => {
    const list = visibleRef.current;
    const pos = list.findIndex((e) => e.index === index);
    const next = list[pos + delta];
    setEditingIndex(next ? next.index : null);
    if (next) scrollTo(next.index);
  }, [scrollTo]);

  const commitRef = useRef(null);
  commitRef.current = async (index, text, { review = false, move = 0 } = {}) => {
    const entry = entriesRef.current.find((e) => e.index === index);
    if (!entry) return;
    const changed = text !== (entry.translated_text || '');
    if (move) moveFrom(index, move); else setEditingIndex(null);
    if (!changed && !review) return;
    const update = { index };
    if (changed) update.translated_text = text;
    if (review && text) update.status = 'reviewed';
    await persist([update], null);
  };

  const handleCommit = useCallback((text, opts) => {
    // EditBox is keyed to the row being edited, so read the index from state via closure-free ref
    commitRef.current(editingIndexRef.current, text, opts);
  }, []);
  const editingIndexRef = useRef(editingIndex);
  editingIndexRef.current = editingIndex;

  const handleCancel = useCallback(() => setEditingIndex(null), []);
  const handleStartEdit = useCallback((index) => setEditingIndex(index), []);

  const handleToggleReview = useCallback((entry) => {
    const status = entry.status === 'reviewed' ? 'edited' : 'reviewed';
    persist([{ index: entry.index, status }], status === 'reviewed' ? `duyệt dòng ${entry.index}` : `bỏ duyệt dòng ${entry.index}`);
  }, [persist]);

  // ── Selection ──
  const handleSelect = useCallback((index, shift) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClickedRef.current != null) {
        const list = visibleRef.current;
        const a = list.findIndex((e) => e.index === lastClickedRef.current);
        const b = list.findIndex((e) => e.index === index);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(list[i].index);
          return next;
        }
      }
      if (next.has(index)) next.delete(index); else next.add(index);
      lastClickedRef.current = index;
      return next;
    });
  }, []);

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.index));
  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((e) => e.index)));
  };

  // ── Retranslate with preview ──
  const handleRetranslate = useCallback(async (indices) => {
    if (!indices.length) return;
    setBusy(true);
    try {
      const results = await retranslateEntries(fileId, indices, true);
      const byIdx = new Map(entriesRef.current.map((e) => [e.index, e]));
      setDiffItems(results.map((r) => ({ ...r, original: byIdx.get(r.index)?.original_text })));
    } catch (err) {
      notify?.(err.response?.data?.detail || 'Dịch lại thất bại', 'error');
    }
    setBusy(false);
  }, [fileId, notify]);

  const applyDiff = async (items) => {
    setDiffItems(null);
    const ok = await persist(
      items.map((i) => ({ index: i.index, translated_text: i.new, status: 'machine' })),
      `dịch lại ${items.length} dòng`,
    );
    if (ok) notify?.(`Đã áp dụng bản dịch mới cho ${items.length} dòng`);
  };

  const bulkReview = async () => {
    const targets = [...selected].filter((idx) => entriesRef.current.find((e) => e.index === idx)?.translated_text);
    if (!targets.length) return;
    if (await persist(targets.map((index) => ({ index, status: 'reviewed' })), `duyệt ${targets.length} dòng`)) {
      notify?.(`Đã duyệt ${targets.length} dòng`);
      setSelected(new Set());
    }
  };

  // ── Search / jump ──
  const handleSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const q = query.trim();
    const idMatch = q.match(/^#(\d+)$/);
    if (idMatch) {
      const idx = Number(idMatch[1]);
      if (entries.some((x) => x.index === idx)) {
        setFilter('all');
        flash(idx);
      } else notify?.(`Không có dòng #${idx}`, 'error');
      return;
    }
    const t = parseJumpTime(q);
    if (t != null) {
      let best = null;
      for (const x of entries) {
        const s = parseTimestamp(x.start_time);
        if (s != null && s <= t + 0.5) best = x;
      }
      if (best) {
        setFilter('all');
        flash(best.index);
        onSeek?.(best);
      }
    }
  };

  // ── Find & replace ──
  const replaceMatches = useMemo(() => {
    if (!findText) return [];
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    return entries
      .filter((e) => e.translated_text && pattern.test(e.translated_text))
      .map((e) => {
        pattern.lastIndex = 0;
        return { index: e.index, old: e.translated_text, new: e.translated_text.replace(pattern, replaceText) };
      });
  }, [entries, findText, replaceText, caseSensitive]);

  const applyReplace = async () => {
    const items = replaceMatches.filter((m) => !replaceExcluded.has(m.index) && m.new !== m.old);
    if (!items.length) return;
    const ok = await persist(
      items.map((m) => ({ index: m.index, translated_text: m.new })),
      `thay "${findText}" → "${replaceText}" (${items.length} dòng)`,
    );
    if (ok) {
      notify?.(`Đã thay thế trong ${items.length} dòng`);
      setReplaceExcluded(new Set());
    }
  };

  const continueReview = () => {
    const first = entries.find((e) => e.status !== 'reviewed' && e.translated_text);
    if (!first) {
      notify?.('Tất cả dòng đã dịch đều đã duyệt 🎉');
      return;
    }
    setFilter('all');
    setQuery('');
    setEditingIndex(first.index);
    scrollTo(first.index, 'center');
  };

  const reviewedPct = entries.length ? Math.round((counts.reviewed / entries.length) * 100) : 0;
  const lastUndo = undoStack[undoStack.length - 1];

  return (
    <div className="card p-0 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Tìm trong bản gốc & bản dịch · #123 hoặc 00:12:30 + Enter để nhảy tới"
              className="input-field py-1.5 pl-8 text-sm"
              aria-label="Tìm kiếm"
            />
          </div>
          <button
            onClick={() => setShowReplace((s) => !s)}
            className={`btn-secondary text-sm py-1.5 flex items-center gap-1.5 ${showReplace ? 'ring-2 ring-blue-300' : ''}`}
          >
            <Replace className="w-4 h-4" /> Thay thế
          </button>
          <button onClick={continueReview} className="btn-secondary text-sm py-1.5 flex items-center gap-1.5" title="Mở dòng chưa duyệt đầu tiên">
            <Play className="w-4 h-4" /> Duyệt tiếp
          </button>
          {lastUndo && (
            <button onClick={handleUndo} className="btn-secondary text-sm py-1.5 flex items-center gap-1.5" title={`Hoàn tác: ${lastUndo.label}`}>
              <Undo2 className="w-4 h-4" /> Hoàn tác
            </button>
          )}
          <button onClick={() => setShowHelp((s) => !s)} className="p-1.5 text-gray-400 hover:text-gray-600" title="Phím tắt">
            <Keyboard className="w-4 h-4" />
          </button>
        </div>

        {showHelp && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
            <span><kbd className="font-mono">Enter</kbd> lưu & sang dòng sau</span>
            <span><kbd className="font-mono">Shift+Enter</kbd> xuống dòng trong phụ đề</span>
            <span><kbd className="font-mono">Ctrl+Enter</kbd> lưu + duyệt + dòng sau</span>
            <span><kbd className="font-mono">Alt+↑/↓</kbd> lưu & đi lên/xuống</span>
            <span><kbd className="font-mono">Esc</kbd> hủy sửa</span>
            <span><kbd className="font-mono">Shift+click</kbd> chọn nhiều dòng</span>
          </div>
        )}

        {showReplace && (
          <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input value={findText} onChange={(e) => { setFindText(e.target.value); setReplaceExcluded(new Set()); }} placeholder="Tìm trong bản dịch..." className="input-field py-1 text-sm w-48" />
              <span className="text-gray-400">→</span>
              <input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="Thay bằng..." className="input-field py-1 text-sm w-48" />
              <button
                onClick={() => setCaseSensitive((s) => !s)}
                className={`p-1.5 rounded border ${caseSensitive ? 'bg-blue-100 border-blue-400 text-blue-700' : 'border-gray-300 text-gray-400'}`}
                title="Phân biệt hoa/thường"
              >
                <CaseSensitive className="w-4 h-4" />
              </button>
              <button onClick={applyReplace} disabled={!replaceMatches.length} className="btn-primary text-sm py-1 px-3">
                Thay {replaceMatches.length - replaceExcluded.size} dòng
              </button>
            </div>
            {replaceMatches.length > 0 && (
              <div className="max-h-40 overflow-y-auto bg-white rounded border border-blue-100 divide-y">
                {replaceMatches.slice(0, 200).map((m) => (
                  <label key={m.index} className="flex items-start gap-2 px-2 py-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!replaceExcluded.has(m.index)}
                      onChange={() => setReplaceExcluded((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.index)) next.delete(m.index); else next.add(m.index);
                        return next;
                      })}
                    />
                    <span className="text-gray-400 w-10">#{m.index}</span>
                    <span className="flex-1 text-gray-500 line-through">{m.old}</span>
                    <span className="flex-1 text-blue-800">{m.new}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filters + review progress */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const n = counts[f.key];
            const warn = (f.key === 'untranslated' || f.key === 'issues') && n > 0;
            return (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setEditingIndex(null); }}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-all
                  ${filter === f.key ? 'bg-blue-600 text-white'
                    : warn ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {f.label} ({n})
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500" title="Tiến độ hậu kiểm">
            <span>Đã duyệt {counts.reviewed}/{entries.length}</span>
            <div className="w-24 h-1.5 bg-gray-200 rounded-full">
              <div className="h-1.5 bg-green-500 rounded-full transition-all" style={{ width: `${reviewedPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-sm">
          <span className="font-medium text-blue-900">Đã chọn {selected.size} dòng</span>
          <button onClick={() => handleRetranslate([...selected])} disabled={busy || jobRunning} className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Dịch lại
          </button>
          <button onClick={bulkReview} className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> Duyệt
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:underline ml-auto">Bỏ chọn</button>
        </div>
      )}

      {/* Rows */}
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[28px_44px_76px_1fr_1fr_92px_60px] gap-2 px-2 py-1.5 border-b border-gray-200 text-xs font-medium text-gray-500 bg-gray-50 sticky top-0 z-10">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Chọn tất cả dòng đang hiện" />
            <span>#</span>
            <span>Thời gian</span>
            <span>Bản gốc</span>
            <span>Bản dịch</span>
            <span>Trạng thái</span>
            <span />
          </div>
          {visible.map((entry) => (
            <Row
              key={entry.index}
              entry={entry}
              qc={qcMap.get(entry.index) || []}
              isEditing={editingIndex === entry.index}
              isActive={activeIndex === entry.index}
              isSelected={selected.has(entry.index)}
              isFlash={flashIndex === entry.index}
              onSelect={handleSelect}
              onStartEdit={handleStartEdit}
              onCommit={handleCommit}
              onCancel={handleCancel}
              onToggleReview={handleToggleReview}
              onRetranslate={handleRetranslate}
              onSeek={onSeek}
              busy={busy || jobRunning}
            />
          ))}
          {visible.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-400">Không có dòng nào khớp bộ lọc/tìm kiếm</p>
          )}
        </div>
      </div>

      {diffItems && <DiffModal items={diffItems} onApply={applyDiff} onClose={() => setDiffItems(null)} />}
    </div>
  );
}
