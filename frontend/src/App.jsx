import React, { useState, useEffect } from 'react';
import { getModels } from './services/api';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import TranslationConfig from './components/TranslationConfig';
import TranslationProgress from './components/TranslationProgress';
import SubtitlePreview from './components/SubtitlePreview';
import ExportPanel from './components/ExportPanel';

export default function App() {
  const [step, setStep] = useState('upload'); // upload, config, translating, preview
  const [fileData, setFileData] = useState(null);
  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [translationResult, setTranslationResult] = useState(null);
  const [translationProgress, setTranslationProgress] = useState(null);
  // Track user's translation config for retranslation
  const [translationConfig, setTranslationConfig] = useState({
    provider: 'llm',
    llmModel: 'gpt-4o-mini',
    targetLang: 'vi',
  });

  useEffect(() => {
    getModels()
      .then(setModels)
      .catch((err) => {
        console.error('Failed to fetch models:', err);
        setModelsError('Không thể tải danh sách models. Kiểm tra kết nối backend.');
      });
  }, []);

  const handleFileUploaded = (data) => {
    setFileData(data);
    setTranslationResult(null);
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
    if (fileData && !window.confirm('Bạn có chắc muốn bắt đầu lại? Dữ liệu hiện tại sẽ bị mất.')) {
      return;
    }
    setFileData(null);
    setTranslationResult(null);
    setTranslationProgress(null);
    setStep('upload');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <Header onReset={handleReset} />

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Step indicators */}
        <div className="flex items-center justify-center mb-8 gap-2">
          {['Upload', 'Configure', 'Translate', 'Preview'].map((label, idx) => {
            const steps = ['upload', 'config', 'translating', 'preview'];
            const isActive = steps.indexOf(step) >= idx;
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
                  <span className={`text-sm ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
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
          <FileUpload onFileUploaded={handleFileUploaded} />
        )}

        {step === 'config' && fileData && (
          <TranslationConfig
            fileData={fileData}
            models={models}
            onTranslationStart={handleTranslationStart}
            onTranslationComplete={handleTranslationComplete}
            onProgress={handleTranslationProgress}
            onBack={() => setStep('upload')}
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
          </div>
        )}
      </main>
    </div>
  );
}
