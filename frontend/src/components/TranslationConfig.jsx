import React, { useState } from 'react';
import { Settings, Play, ArrowLeft, Sparkles, Globe, Combine, BookOpen } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';

const LANG_NAMES = {
  'zh-cn': 'Trung Quốc (Giản thể)',
  'zh-tw': 'Trung Quốc (Phồn thể)',
  'en': 'Tiếng Anh',
  'ko': 'Tiếng Hàn',
  'ja': 'Tiếng Nhật',
  'th': 'Tiếng Thái',
  'fr': 'Tiếng Pháp',
  'de': 'Tiếng Đức',
  'es': 'Tiếng Tây Ban Nha',
};

const PROVIDER_INFO = {
  llm: { icon: Sparkles, label: 'AI (LLM)', desc: 'Dịch bằng AI thông minh, chất lượng cao' },
  google: { icon: Globe, label: 'Google Translate', desc: 'Dịch nhanh, miễn phí' },
  hybrid: { icon: Combine, label: 'Kết hợp (Hybrid)', desc: 'Google dịch thô + AI tinh chỉnh' },
};

const MODE_INFO = {
  standard: { icon: Play, label: 'Tiêu chuẩn', desc: 'Dịch từng dòng phụ đề' },
  context: { icon: BookOpen, label: 'Theo ngữ cảnh', desc: 'AI hiểu ngữ cảnh trước sau' },
  glossary: { icon: BookOpen, label: 'Bảng thuật ngữ', desc: 'Sử dụng thuật ngữ tùy chỉnh' },
};

export default function TranslationConfig({
  fileData, models, onTranslationStart, onTranslationComplete, onProgress, onBack,
}) {
  const [provider, setProvider] = useState('llm');
  const [llmModel, setLlmModel] = useState('gpt-4o-mini');
  const [mode, setMode] = useState('standard');
  const [sourceLang, setSourceLang] = useState(fileData.detected_lang || 'auto');
  const [customPrompt, setCustomPrompt] = useState('');
  const [glossaryText, setGlossaryText] = useState('');
  const [hybridRefine, setHybridRefine] = useState(true);
  const [hybridPrimary, setHybridPrimary] = useState('google');
  const [hybridFallback, setHybridFallback] = useState('llm');
  const { translate, isTranslating, error } = useTranslation();

  const handleTranslate = async () => {
    // Parse glossary
    let glossary = null;
    if (mode === 'glossary' && glossaryText.trim()) {
      glossary = {};
      glossaryText.split('\n').forEach(line => {
        const parts = line.split('=').map(s => s.trim());
        if (parts.length === 2 && parts[0] && parts[1]) {
          glossary[parts[0]] = parts[1];
        }
      });
    }

    const request = {
      file_id: fileData.file_id,
      provider,
      llm_model: llmModel,
      mode,
      source_lang: sourceLang === 'auto' ? null : sourceLang,
      target_lang: 'vi',
      custom_prompt: customPrompt || null,
      glossary,
      hybrid_primary: provider === 'hybrid' ? hybridPrimary : null,
      hybrid_fallback: provider === 'hybrid' ? hybridFallback : null,
      hybrid_refine: provider === 'hybrid' ? hybridRefine : false,
    };

    onTranslationStart();

    try {
      const result = await translate(request);
      onTranslationComplete(result);
    } catch (err) {
      // Error handled by hook
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* File info */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{fileData.filename}</h3>
            <p className="text-sm text-gray-500">
              {fileData.total_entries} dòng phụ đề
              {fileData.detected_lang && ` • Ngôn ngữ: ${LANG_NAMES[fileData.detected_lang] || fileData.detected_lang}`}
            </p>
          </div>
          <button onClick={onBack} className="btn-secondary flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Quay lại
          </button>
        </div>

        {/* Preview first few entries */}
        {fileData.entries && fileData.entries.length > 0 && (
          <div className="mt-4 bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto">
            {fileData.entries.slice(0, 5).map((entry, idx) => (
              <p key={idx} className="text-sm text-gray-600 py-0.5">
                <span className="text-gray-400 mr-2">{entry.index}.</span>
                {entry.original_text}
              </p>
            ))}
            {fileData.total_entries > 5 && (
              <p className="text-xs text-gray-400 mt-1">...và {fileData.total_entries - 5} dòng nữa</p>
            )}
          </div>
        )}
      </div>

      {/* Source language */}
      <div className="card">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-600" />
          Ngôn ngữ nguồn
        </h3>
        <select
          value={sourceLang}
          onChange={(e) => setSourceLang(e.target.value)}
          className="select-field max-w-xs"
        >
          <option value="auto">Tự động nhận diện</option>
          {Object.entries(LANG_NAMES).map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      </div>

      {/* Provider selection */}
      <div className="card">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" />
          Phương thức dịch
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.entries(PROVIDER_INFO).map(([key, info]) => {
            const Icon = info.icon;
            return (
              <button
                key={key}
                onClick={() => setProvider(key)}
                className={`p-4 rounded-xl border-2 text-left transition-all
                  ${provider === key
                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300'}`}
              >
                <Icon className={`w-6 h-6 mb-2 ${provider === key ? 'text-blue-600' : 'text-gray-400'}`} />
                <p className="font-medium">{info.label}</p>
                <p className="text-xs text-gray-500 mt-1">{info.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* LLM Model selection (for LLM and Hybrid) */}
      {(provider === 'llm' || provider === 'hybrid') && (
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Model AI
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {(models?.llm_models || []).map((model) => (
              <button
                key={model}
                onClick={() => setLlmModel(model)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all
                  ${llmModel === model
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {model}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hybrid settings */}
      {provider === 'hybrid' && (
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Combine className="w-5 h-5 text-green-600" />
            Cài đặt Hybrid
          </h3>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700">Dịch chính</label>
                <select
                  value={hybridPrimary}
                  onChange={(e) => setHybridPrimary(e.target.value)}
                  className="select-field mt-1"
                >
                  <option value="google">Google Translate</option>
                  <option value="llm">AI (LLM)</option>
                </select>
              </div>
              <div className="text-gray-400 pt-6">→</div>
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700">Tinh chỉnh</label>
                <select
                  value={hybridFallback}
                  onChange={(e) => setHybridFallback(e.target.value)}
                  className="select-field mt-1"
                >
                  <option value="llm">AI (LLM)</option>
                  <option value="google">Google Translate</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hybridRefine}
                onChange={(e) => setHybridRefine(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm">Dùng AI tinh chỉnh kết quả dịch thô</span>
            </label>
          </div>
        </div>
      )}

      {/* Translation mode */}
      <div className="card">
        <h3 className="font-semibold mb-3">Chế độ dịch</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.entries(MODE_INFO).map(([key, info]) => {
            const Icon = info.icon;
            // Glossary and context only available for LLM
            if ((key === 'context' || key === 'glossary') && provider === 'google') return null;
            return (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`p-3 rounded-lg border-2 text-left transition-all
                  ${mode === key
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'}`}
              >
                <p className="font-medium text-sm">{info.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{info.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Glossary input */}
      {mode === 'glossary' && (
        <div className="card">
          <h3 className="font-semibold mb-2">Bảng thuật ngữ</h3>
          <p className="text-sm text-gray-500 mb-2">Mỗi dòng một cặp: <code>từ gốc = từ dịch</code></p>
          <textarea
            value={glossaryText}
            onChange={(e) => setGlossaryText(e.target.value)}
            placeholder={"oppa = anh ấy\nnoona = chị ấy\nsensei = thầy giáo"}
            className="input-field h-32 font-mono text-sm"
          />
        </div>
      )}

      {/* Custom prompt */}
      {provider !== 'google' && (
        <div className="card">
          <h3 className="font-semibold mb-2">Hướng dẫn thêm cho AI (tùy chọn)</h3>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="VD: Đây là phim cổ trang Trung Quốc, hãy dùng ngôn ngữ trang trọng..."
            className="input-field h-20 text-sm"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Start button */}
      <div className="flex justify-center">
        <button
          onClick={handleTranslate}
          disabled={isTranslating}
          className="btn-primary text-lg px-8 py-3 flex items-center gap-2"
        >
          <Play className="w-5 h-5" />
          {isTranslating ? 'Đang dịch...' : 'Bắt đầu dịch'}
        </button>
      </div>
    </div>
  );
}
