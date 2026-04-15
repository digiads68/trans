import React, { useState, useEffect, useCallback } from 'react';
import { getModels, getConfig } from './services/api';
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
  const [batchFiles, setBatchFiles] = useState(null); // list of uploaded files for batch mode
  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [translationResult, setTranslationResult] = useState(null);
  const [translationProgress, setTranslationProgress] = useState(null);
  const [apiConfig, setApiConfig] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  // Track user's translation config for retranslation
  const [translationConfig, setTranslationConfig] = useState({
    provider: 'llm',
    llmModel: 'gpt-4o-mini',
    targetLang: 'vi',
  });

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

  const handleFileUploaded = (data) => {
    setFileData(data);
    setBatchFiles(null);
    setTranslationResult(null);
    setStep('config');
  };

  const handleBatchUploaded = (data) => {
    if (data.files?.length === 1) {
      // Single file — use normal flow
      handleFileUploaded(data.files[0]);
      return;
    }
    setBatchFiles(data.files.filter(f => f.file_id)); // only successfully parsed
    setFileData(null);
    setTranslationResult(null);
    setStep('batch');
  };

  // When selecting a file from batch list to configure and translate
  const handleBatchFileSelect = (file) => {
    setFileData(file);
    setStep('config');
  };

  const handleTranslationStart = (config) => {
    if (config) {
      setTranslationConfig(config);
    }
    setStep('translating');
  };

  const handleTranslationComplete = (result) => {
    setTranslationResult(result);
    setStep('preview');
  };

  const handleTranslationProgress = (progress) => {
    setTranslationProgress(progress);
  };

  const handleCancel = () => {
    setStep('config');
    setTranslationProgress(null);
  };

  const handleReset = () => {
    if ((fileData || batchFiles) && !window.confirm('Bạn có chắc muốn bắt đầu lại? Dữ liệu hiện tại sẽ bị mất.')) {
      return;
    }
    setFileData(null);
    setBatchFiles(null);
    setTranslationResult(null);
    setTranslationProgress(null);
    setStep('upload');
  };

  const handleBackFromConfig = () => {
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

  // Active step labels
  const stepLabels = batchFiles
    ? ['Upload', 'Danh sách', 'Configure', 'Preview']
    : ['Upload', 'Configure', 'Translate', 'Preview'];

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
            onSelectFile={handleBatchFileSelect}
            onBack={() => setStep('upload')}
            translationConfig={translationConfig}
          />
        )}

        {step === 'config' && fileData && (
          <TranslationConfig
            fileData={fileData}
            models={models}
            apiConfig={apiConfig}
            onOpenSettings={() => setShowSettings(true)}
            onTranslationStart={handleTranslationStart}
            onTranslationComplete={handleTranslationComplete}
            onProgress={handleTranslationProgress}
            onBack={handleBackFromConfig}
          />
        )}

        {step === 'translating' && (
          <TranslationProgress
            progress={translationProgress}
            fileData={fileData}
            onCancel={handleCancel}
          />
        )}

        {step === 'preview' && translationResult && (
          <div className="space-y-6">
            <SubtitlePreview
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
            {batchFiles && (
              <div className="flex justify-center">
                <button
                  onClick={handleBackFromPreview}
                  className="btn-secondary text-sm"
                >
                  Quay về danh sách file
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
