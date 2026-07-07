import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getModels, getConfig, getAllEntries } from './services/api';
import { useTranslation } from './hooks/useTranslation';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import TranslationConfig from './components/TranslationConfig';
import TranslationProgress from './components/TranslationProgress';
import SubtitlePreview from './components/SubtitlePreview';
import ExportPanel from './components/ExportPanel';
import BatchManager from './components/BatchManager';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [step, setStep] = useState('upload'); // upload, config, translating, preview, batch
  const [fileData, setFileData] = useState(null);
  const [batchFiles, setBatchFiles] = useState(null);
  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [translationResult, setTranslationResult] = useState(null);
  const [apiConfig, setApiConfig] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  // Per-file translation state for batch mode: { [fileId]: 'done' | 'error' }
  const [fileStatuses, setFileStatuses] = useState({});
  // Info about a cancelled/failed job with partial results
  const [partialInfo, setPartialInfo] = useState(null);
  // Batch "translate all" state
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchCurrentId, setBatchCurrentId] = useState(null);
  const batchStopRef = useRef(false);

  const [translationConfig, setTranslationConfig] = useState({
    provider: 'llm',
    llmModel: 'gpt-4o-mini',
    targetLang: 'vi',
  });

  // Translation hook lives HERE so it survives step changes (config → translating)
  const {
    startJob, cancel, progress, isTranslating, isCancelling, error: translationError, setError,
  } = useTranslation();

  const refreshApiConfig = useCallback(async () => {
    try {
      const cfg = await getConfig();
      setApiConfig(cfg);
      return cfg;
    } catch (err) {
      console.error('Failed to fetch config:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    getModels()
      .then(setModels)
      .catch((err) => {
        console.error('Failed to fetch models:', err);
        setModelsError('Không thể tải danh sách models. Kiểm tra kết nối backend.');
      });
    refreshApiConfig();
  }, [refreshApiConfig]);

  const markFileStatus = useCallback((fileId, status) => {
    setFileStatuses((prev) => ({ ...prev, [fileId]: status }));
  }, []);

  const handleFileUploaded = (data) => {
    setFileData(data);
    setBatchFiles(null);
    setTranslationResult(null);
    setPartialInfo(null);
    setError(null);
    setStep('config');
  };

  const handleBatchUploaded = (data) => {
    const okFiles = data.files.filter((f) => f.file_id);
    const failedFiles = data.files.filter((f) => !f.file_id);
    if (okFiles.length === 1 && failedFiles.length === 0) {
      handleFileUploaded(okFiles[0]);
      return;
    }
    setBatchFiles(data.files); // keep failed files so user sees why they were skipped
    setFileData(null);
    setTranslationResult(null);
    setPartialInfo(null);
    setStep('batch');
  };

  const handleBatchFileSelect = (file) => {
    setFileData(file);
    setError(null);
    setStep('config');
  };

  // Start a single-file translation job (from the config screen)
  const handleStartTranslation = (request, meta) => {
    if (meta) setTranslationConfig(meta);
    setPartialInfo(null);
    setStep('translating');

    startJob(request, {
      onComplete: ({ entries, failed }) => {
        setTranslationResult({ entries, failed });
        markFileStatus(request.file_id, 'done');
        setStep('preview');
      },
      onError: (msg, status) => {
        markFileStatus(request.file_id, 'error');
        if (status && status.completed > 0) {
          setPartialInfo({ fileId: request.file_id, completed: status.completed, total: status.total });
        }
        setStep('config'); // error banner shows on the config screen
      },
      onCancelled: (status) => {
        if (status && status.completed > 0) {
          setPartialInfo({ fileId: request.file_id, completed: status.completed, total: status.total });
        }
        setStep('config');
      },
    });
  };

  const handleCancelTranslation = () => {
    if (fileData?.file_id) {
      cancel(fileData.file_id);
      // Stay on the progress screen until the backend confirms (onCancelled)
    }
  };

  // View partial results after a cancelled/failed job
  const handleViewPartial = async () => {
    if (!partialInfo) return;
    try {
      const entries = await getAllEntries(partialInfo.fileId);
      setTranslationResult({
        entries,
        failed: entries.filter((e) => !e.translated_text).length,
        partial: true,
      });
      setStep('preview');
    } catch (err) {
      setError('Không tải được kết quả: ' + (err.message || ''));
    }
  };

  // Translate every untranslated file in the batch, sequentially
  const handleTranslateAll = async (buildRequest) => {
    if (!batchFiles || batchRunning) return;
    setBatchRunning(true);
    batchStopRef.current = false;

    const pending = batchFiles.filter((f) => f.file_id && fileStatuses[f.file_id] !== 'done');
    for (const file of pending) {
      if (batchStopRef.current) break;
      setBatchCurrentId(file.file_id);

      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        startJob(buildRequest(file), {
          onComplete: () => { markFileStatus(file.file_id, 'done'); resolve(); },
          onError: () => { markFileStatus(file.file_id, 'error'); resolve(); },
          onCancelled: () => { batchStopRef.current = true; resolve(); },
        });
      });
    }

    setBatchCurrentId(null);
    setBatchRunning(false);
  };

  const handleStopBatch = () => {
    batchStopRef.current = true;
    if (batchCurrentId) cancel(batchCurrentId);
  };

  const handleReset = () => {
    if ((fileData || batchFiles) && !window.confirm('Bạn có chắc muốn bắt đầu lại? Dữ liệu hiện tại sẽ bị mất.')) {
      return;
    }
    if (isTranslating && fileData?.file_id) cancel(fileData.file_id);
    setFileData(null);
    setBatchFiles(null);
    setTranslationResult(null);
    setPartialInfo(null);
    setFileStatuses({});
    setError(null);
    setStep('upload');
  };

  const handleBackFromConfig = () => {
    setError(null);
    if (batchFiles) {
      setStep('batch');
      setFileData(null);
    } else {
      setStep('upload');
    }
  };

  const handleBackFromPreview = () => {
    if (batchFiles) {
      setStep('batch');
      setFileData(null);
      setTranslationResult(null);
    } else {
      setStep('config');
    }
  };

  const stepLabels = batchFiles
    ? ['Upload', 'Danh sách', 'Cấu hình', 'Kết quả']
    : ['Upload', 'Cấu hình', 'Dịch', 'Kết quả'];

  const stepKeys = batchFiles
    ? ['upload', 'batch', 'config', 'preview']
    : ['upload', 'config', 'translating', 'preview'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <Header
        onReset={handleReset}
        onOpenSettings={() => setShowSettings(true)}
        apiConfigured={apiConfig?.cliproxy_api_key_set ?? null}
      />

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => refreshApiConfig()}
        />
      )}

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Step indicators */}
        <div className="flex items-center justify-center mb-8 gap-2">
          {stepLabels.map((label, idx) => {
            const currentIdx = stepKeys.indexOf(step);
            const isActive = currentIdx >= idx;
            return (
              <React.Fragment key={label}>
                {idx > 0 && (
                  <div className={`h-0.5 w-12 ${isActive ? 'bg-blue-500' : 'bg-gray-300'}`} />
                )}
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                      ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}
                  >
                    {idx + 1}
                  </div>
                  <span className={`text-sm hidden sm:inline ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                    {label}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Models error banner */}
        {modelsError && (
          <div className="max-w-2xl mx-auto mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-700 text-sm">
            {modelsError}
          </div>
        )}

        {/* Main content */}
        {step === 'upload' && (
          <FileUpload
            onFileUploaded={handleFileUploaded}
            onBatchUploaded={handleBatchUploaded}
          />
        )}

        {step === 'batch' && batchFiles && (
          <BatchManager
            files={batchFiles}
            fileStatuses={fileStatuses}
            onSelectFile={handleBatchFileSelect}
            onBack={() => setStep('upload')}
            translationConfig={translationConfig}
            onTranslateAll={handleTranslateAll}
            onStopBatch={handleStopBatch}
            batchRunning={batchRunning}
            batchCurrentId={batchCurrentId}
            progress={progress}
            onPreviewFile={async (file) => {
              try {
                const entries = await getAllEntries(file.file_id);
                setFileData(file);
                setTranslationResult({
                  entries,
                  failed: entries.filter((e) => !e.translated_text).length,
                });
                setStep('preview');
              } catch { /* file may have expired */ }
            }}
          />
        )}

        {step === 'config' && fileData && (
          <TranslationConfig
            fileData={fileData}
            models={models}
            apiConfig={apiConfig}
            onOpenSettings={() => setShowSettings(true)}
            onStartTranslation={handleStartTranslation}
            onBack={handleBackFromConfig}
            translationError={translationError}
            partialInfo={partialInfo}
            onViewPartial={handleViewPartial}
            defaultConfig={translationConfig}
          />
        )}

        {step === 'translating' && (
          <TranslationProgress
            progress={progress}
            fileData={fileData}
            onCancel={handleCancelTranslation}
            isCancelling={isCancelling}
          />
        )}

        {step === 'preview' && translationResult && fileData && (
          <div className="space-y-6">
            {translationResult.partial && (
              <div className="max-w-4xl mx-auto bg-amber-50 border border-amber-300 rounded-lg p-3 text-amber-800 text-sm">
                Đây là kết quả một phần ({translationResult.entries.filter((e) => e.translated_text).length}/
                {translationResult.entries.length} dòng đã dịch). Dùng bộ lọc "Chưa dịch" để xem các dòng còn thiếu,
                hoặc chạy lại "Bắt đầu dịch" — các dòng đã dịch sẽ được lấy từ cache tức thì.
              </div>
            )}
            {translationResult.failed > 0 && !translationResult.partial && (
              <div className="max-w-4xl mx-auto bg-amber-50 border border-amber-300 rounded-lg p-3 text-amber-800 text-sm">
                {translationResult.failed} dòng dịch thất bại (lỗi API tạm thời). Dùng bộ lọc "Chưa dịch"
                để tìm và bấm "Dịch lại" từng dòng, hoặc chạy lại toàn bộ.
              </div>
            )}
            <SubtitlePreview
              key={fileData.file_id}
              fileId={fileData.file_id}
              entries={translationResult.entries}
              models={models}
              translationConfig={translationConfig}
            />
            <ExportPanel
              fileId={fileData.file_id}
              filename={fileData.filename}
              targetLang={translationConfig.targetLang}
            />
            <div className="flex justify-center">
              <button onClick={handleBackFromPreview} className="btn-secondary text-sm">
                {batchFiles ? 'Quay về danh sách file' : 'Quay lại cấu hình'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
