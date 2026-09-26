import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Settings2, Film, Download, XCircle, Loader2, AlertTriangle, CheckCircle2, X, Cloud,
} from 'lucide-react';
import { getAllEntries, getProject } from '../services/api';
import { countStatuses, findActiveLine, parseTimestamp, TARGET_LANGUAGES, LANGUAGES } from '../utils/subtitle';
import ConfigPanel from './ConfigPanel';
import SubtitleEditor from './SubtitleEditor';
import VideoPanel from './VideoPanel';
import ExportPanel from './ExportPanel';

const REFRESH_THROTTLE_MS = 2500;

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `~${Math.ceil(seconds)} giây`;
  return `~${Math.floor(seconds / 60)} phút ${Math.round(seconds % 60)} giây`;
}

export default function Workspace({
  project, models, apiConfig, onOpenSettings, onBack, backLabel, translation, onJobFinished,
}) {
  const fileId = project.file_id;
  const [entries, setEntries] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showConfig, setShowConfig] = useState(true);
  const [showVideo, setShowVideo] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [followVideo, setFollowVideo] = useState(true);
  const [videoTime, setVideoTime] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [toast, setToast] = useState(null);
  const videoRef = useRef(null);
  const lastRefreshRef = useRef(0);
  const refreshTimerRef = useRef(null);

  const {
    startJob, resume, cancel, progress, isTranslating, isCancelling, error, setError, jobFileId,
  } = translation;
  const jobHere = jobFileId === fileId;
  const translatingHere = isTranslating && jobHere;

  const notify = useCallback((msg, type = 'success') => {
    setToast({ msg, type, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.type === 'error' ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    lastRefreshRef.current = Date.now();
    try {
      const fresh = await getAllEntries(fileId);
      setEntries(fresh);
    } catch (err) {
      if (err.response?.status === 404) setLoadError('Dự án không còn tồn tại trên máy chủ.');
    }
  }, [fileId]);

  const jobCallbacks = useMemo(() => ({
    onComplete: (status) => {
      notify(status.failed
        ? `Dịch xong — ${status.failed} dòng lỗi, lọc "Chưa dịch" để xử lý`
        : `Dịch xong ${status.total} dòng`, status.failed ? 'error' : 'success');
      onJobFinished?.(fileId, status.failed ? 'error' : 'done');
    },
    onError: (msg) => {
      notify(msg, 'error');
      onJobFinished?.(fileId, 'error');
    },
    onCancelled: (status) => notify(`Đã hủy — giữ lại ${status.completed || 0} dòng đã dịch`),
  }), [fileId, notify, onJobFinished]);

  // Initial load (+ reattach to a job still running after a page refresh)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, info] = await Promise.all([getAllEntries(fileId), getProject(fileId)]);
        if (cancelled) return;
        setEntries(list);
        setDetail(info);
        const translated = list.some((e) => e.translated_text);
        setShowConfig(!translated);
        if (info.job && ['queued', 'processing'].includes(info.job.status) && !(isTranslating && jobHere)) {
          resume(fileId, jobCallbacks);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.response?.data?.detail || 'Không tải được dự án');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Live fill: pull newly translated lines while the job runs (throttled)
  const completed = jobHere ? progress?.completed : null;
  useEffect(() => {
    if (!translatingHere || !completed) return undefined;
    const wait = Math.max(0, REFRESH_THROTTLE_MS - (Date.now() - lastRefreshRef.current));
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(refresh, wait);
    return () => clearTimeout(refreshTimerRef.current);
  }, [completed, translatingHere, refresh]);

  // Job ended → final refresh + reload stored config
  const wasTranslating = useRef(false);
  useEffect(() => {
    if (wasTranslating.current && !translatingHere) {
      refresh();
      getProject(fileId).then(setDetail).catch(() => {});
    }
    wasTranslating.current = translatingHere;
  }, [translatingHere, refresh, fileId]);

  const handleStart = (request) => {
    setError(null);
    setDetail((d) => ({ ...(d || {}), last_config: { ...request } }));
    startJob(request, jobCallbacks);
  };

  const counts = useMemo(() => (entries ? countStatuses(entries) : null), [entries]);

  // Video sync
  const timed = useMemo(() => (entries || [])
    .map((e) => ({ index: e.index, start: parseTimestamp(e.start_time), end: parseTimestamp(e.end_time) }))
    .filter((t) => t.start != null)
    .sort((a, b) => a.start - b.start), [entries]);

  const activePos = showVideo && videoTime != null ? findActiveLine(timed, videoTime) : -1;
  const activeIndex = activePos >= 0 ? timed[activePos].index : null;
  const activeEntry = activeIndex != null ? entries.find((e) => e.index === activeIndex) : null;

  const handleSeek = useCallback((entry) => {
    const t = parseTimestamp(entry.start_time);
    if (t == null) return;
    setShowVideo((open) => {
      if (!open) setShowConfig(false);
      return true;
    });
    // Panel may be mounting — wait a tick for the ref
    setTimeout(() => videoRef.current?.seek(t), 0);
  }, []);

  if (loadError) {
    return (
      <div className="max-w-xl mx-auto card text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
        <p className="text-gray-700">{loadError}</p>
        <button onClick={onBack} className="btn-secondary mt-4">Quay lại</button>
      </div>
    );
  }

  if (!entries) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const targetLang = detail?.last_config?.target_lang || 'vi';
  const total = progress?.total || 0;
  const done = progress?.completed || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  let eta = null;
  if (translatingHere && progress?.startedAt && done > 0 && done < total) {
    const rate = done / ((Date.now() - progress.startedAt) / 1000);
    eta = formatEta((total - done) / rate);
  }
  const showError = error && jobHere && !isTranslating;
  const nothingTranslated = counts.total === counts.untranslated;

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="card py-3 px-4 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1" title={backLabel}>
          <ArrowLeft className="w-4 h-4" /> {backLabel}
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-900 truncate">{project.filename}</h2>
          <p className="text-xs text-gray-500 flex flex-wrap gap-x-2">
            <span>{counts.total} dòng</span>
            {project.detected_lang && <span>{LANGUAGES[project.detected_lang] || project.detected_lang} → {TARGET_LANGUAGES[targetLang] || targetLang}</span>}
            <span>{counts.total - counts.untranslated} đã dịch · {counts.edited} đã sửa · {counts.reviewed} đã duyệt</span>
            {savedAt && (
              <span className="text-green-600 flex items-center gap-0.5">
                <Cloud className="w-3 h-3" /> Đã lưu {savedAt.toLocaleTimeString('vi-VN')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfig((s) => !s)}
            className={`btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5 ${showConfig ? 'ring-2 ring-blue-300' : ''}`}
          >
            <Settings2 className="w-4 h-4" /> Cấu hình dịch
          </button>
          <button
            onClick={() => { if (!showVideo) setShowConfig(false); setShowVideo(!showVideo); }}
            className={`btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5 ${showVideo ? 'ring-2 ring-indigo-300' : ''}`}
          >
            <Film className="w-4 h-4" /> Video
          </button>
          <button onClick={() => setShowExport(true)} className="btn-success text-sm py-1.5 px-3 flex items-center gap-1.5">
            <Download className="w-4 h-4" /> Xuất
          </button>
        </div>
      </div>

      {/* Inline job progress */}
      {translatingHere && (
        <div className="card py-3 px-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {isCancelling ? 'Đang hủy — giữ lại phần đã dịch...' : `Đang dịch ${done}/${total} dòng (${pct}%)`}
                </span>
                <span className="text-xs text-gray-500">
                  {eta && !isCancelling && `còn ${eta}`}
                  {progress?.failed > 0 && <span className="text-amber-600 ml-2">{progress.failed} dòng lỗi</span>}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-1.5">
                <div className="bg-blue-600 h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1 truncate">
                Các dòng dịch xong hiện dần bên dưới — bạn có thể bắt đầu duyệt ngay.
                {progress?.current_text && ` Đang dịch: “${progress.current_text}”`}
              </p>
            </div>
            {!isCancelling && (
              <button onClick={() => cancel(fileId)} className="text-sm text-gray-500 hover:text-red-600 flex items-center gap-1">
                <XCircle className="w-4 h-4" /> Hủy
              </button>
            )}
          </div>
        </div>
      )}

      {showError && (
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-red-800">Dịch thất bại</p>
            <p className="text-red-700">{error}</p>
            {counts.total > counts.untranslated && (
              <p className="text-red-700 mt-0.5">Các dòng đã dịch trước khi lỗi vẫn được giữ lại.</p>
            )}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex gap-4 items-start">
        {showConfig && (
          <aside className="w-80 flex-shrink-0 card p-4 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <ConfigPanel
              key={detail ? 'loaded' : 'loading'}
              fileData={project}
              lastConfig={detail?.last_config}
              models={models}
              apiConfig={apiConfig}
              onOpenSettings={onOpenSettings}
              onStart={handleStart}
              isTranslating={isTranslating}
              counts={counts}
            />
          </aside>
        )}

        <div className={`flex-1 min-w-0 ${showVideo ? 'grid xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] gap-4 items-start' : ''}`}>
          <div className="min-w-0 space-y-3">
            {nothingTranslated && !translatingHere && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                Chọn cấu hình ở bảng “Cấu hình dịch” rồi bấm <b>Bắt đầu dịch</b> — hoặc bấm vào ô bản dịch để dịch tay.
              </div>
            )}
            <SubtitleEditor
              fileId={fileId}
              entries={entries}
              setEntries={setEntries}
              onSaved={setSavedAt}
              notify={notify}
              activeIndex={activeIndex}
              followVideo={followVideo}
              onSeek={handleSeek}
              jobRunning={translatingHere}
            />
          </div>
          {showVideo && (
            <div className="xl:sticky xl:top-20 space-y-1 order-first xl:order-none">
              <VideoPanel
                ref={videoRef}
                onTime={setVideoTime}
                currentEntry={activeEntry}
                onClose={() => setShowVideo(false)}
              />
              <label className="flex items-center gap-2 text-xs text-gray-500 px-1 cursor-pointer">
                <input type="checkbox" checked={followVideo} onChange={(e) => setFollowVideo(e.target.checked)} />
                Tự cuộn tới dòng đang phát
              </label>
            </div>
          )}
        </div>
      </div>

      {showExport && (
        <ExportPanel
          fileId={fileId}
          filename={project.filename}
          targetLang={targetLang}
          counts={counts}
          onClose={() => setShowExport(false)}
        />
      )}

      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-2.5 rounded-lg shadow-lg text-sm flex items-start gap-2
            ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}
        >
          <span className="flex-1">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}
