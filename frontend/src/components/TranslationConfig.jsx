import React, { useState, useEffect } from 'react';
import {
  Settings, Play, ArrowLeft, Sparkles, Globe, Combine, BookOpen,
  AlertTriangle, XCircle, Eye, Film, Save, Trash2,
} from 'lucide-react';

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
  google: { icon: Globe, label: 'Google Translate', desc: 'Dịch nhanh, miễn phí, không cần API key' },
  hybrid: { icon: Combine, label: 'Kết hợp (Hybrid)', desc: 'Google dịch thô + AI tinh chỉnh' },
};

const MODE_INFO = {
  standard: { label: 'Tiêu chuẩn', desc: 'Dịch từng dòng phụ đề' },
  context: { label: 'Theo ngữ cảnh', desc: 'AI đọc các dòng trước/sau để dịch mạch lạc' },
  glossary: { label: 'Bảng thuật ngữ', desc: 'Ép tên nhân vật, xưng hô cố định' },
};

const PROFILES_KEY = 'subtranslator_film_profiles';

function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export default function TranslationConfig({
  fileData, models, apiConfig, onOpenSettings,
  onStartTranslation, onBack,
  translationError, partialInfo, onViewPartial,
  defaultConfig,
}) {
  const apiKeySet = apiConfig?.cliproxy_api_key_set ?? true; // optimistic while loading
  const googleEnabled = apiConfig?.google_translate_enabled ?? true;

  const [provider, setProvider] = useState(defaultConfig?.provider || 'llm');
  const [llmModel, setLlmModel] = useState(defaultConfig?.llmModel || 'gpt-4o-mini');
  const [mode, setMode] = useState('standard');
  const [sourceLang, setSourceLang] = useState(fileData.detected_lang || 'auto');
  const [customPrompt, setCustomPrompt] = useState('');
  const [glossaryText, setGlossaryText] = useState('');
  const [hybridRefine, setHybridRefine] = useState(true);

  // Film profiles — persist glossary + film context per series in localStorage
  const [profiles, setProfiles] = useState(loadProfiles);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [showSaveProfile, setShowSaveProfile] = useState(false);

  useEffect(() => {
    setSourceLang(fileData.detected_lang || 'auto');
  }, [fileData]);

  const applyProfile = (name) => {
    setSelectedProfile(name);
    const p = profiles.find((x) => x.name === name);
    if (!p) return;
    if (p.provider) setProvider(p.provider);
    if (p.llmModel) setLlmModel(p.llmModel);
    if (p.glossaryText) {
      setGlossaryText(p.glossaryText);
      setMode('glossary');
    }
    setCustomPrompt(p.customPrompt || '');
  };

  const handleSaveProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    const next = [
      ...profiles.filter((p) => p.name !== name),
      { name, glossaryText, customPrompt, provider, llmModel },
    ];
    setProfiles(next);
    saveProfiles(next);
    setSelectedProfile(name);
    setNewProfileName('');
    setShowSaveProfile(false);
  };

  const handleDeleteProfile = () => {
    if (!selectedProfile) return;
    const next = profiles.filter((p) => p.name !== selectedProfile);
    setProfiles(next);
    saveProfiles(next);
    setSelectedProfile('');
  };

  const parseGlossary = () => {
    if (!glossaryText.trim()) return null;
    const glossary = {};
    glossaryText.split('\n').forEach((line) => {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.substring(0, eqIdx).trim();
        const value = line.substring(eqIdx + 1).trim();
        if (key && value) glossary[key] = value;
      }
    });
    return Object.keys(glossary).length ? glossary : null;
  };

  const glossaryPreview = mode === 'glossary' ? parseGlossary() : null;

  const handleTranslate = () => {
    const glossary = mode === 'glossary' ? parseGlossary() : null;

    const request = {
      file_id: fileData.file_id,
      provider,
      llm_model: llmModel,
      mode,
      source_lang: sourceLang === 'auto' ? null : sourceLang,
      target_lang: 'vi',
      custom_prompt: customPrompt || null,
      glossary,
      // Hybrid luôn = Google dịch thô → LLM tinh chỉnh (backend tự đảm bảo thứ tự đúng)
      hybrid_primary: provider === 'hybrid' ? 'google' : null,
      hybrid_fallback: provider === 'hybrid' ? 'llm' : null,
      hybrid_refine: provider === 'hybrid' ? hybridRefine : false,
    };

    onStartTranslation(request, { provider, llmModel, targetLang: 'vi' });
  };

  const needsKey = (provider === 'llm' || provider === 'hybrid') && !apiKeySet;
  const needsGoogle = provider === 'google' && !googleEnabled;
  const startDisabled = needsKey || needsGoogle;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Translation error from last attempt */}
      {translationError && (
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 flex items-start gap-3">
          <XCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-800">Dịch thất bại</p>
            <p className="text-sm text-red-700 mt-0.5">{translationError}</p>
          </div>
        </div>
      )}

      {/* Partial results available */}
      {partialInfo && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">
              Đã dịch được {partialInfo.completed}/{partialInfo.total} dòng trước khi dừng
            </p>
            <p className="text-sm text-amber-800 mt-0.5">
              Phần đã dịch vẫn được giữ. Bạn có thể xem/xuất ngay, hoặc dịch lại toàn bộ —
              các dòng đã dịch sẽ lấy từ cache tức thì.
            </p>
            <button
              type="button"
              onClick={onViewPartial}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 underline hover:no-underline"
            >
              <Eye className="w-4 h-4" />
              Xem phần đã dịch
            </button>
          </div>
        </div>
      )}

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

      {/* Film profile */}
      <div className="card">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Film className="w-5 h-5 text-indigo-600" />
          Hồ sơ phim
        </h3>
        <p className="text-sm text-gray-500 mb-3">
          Lưu bảng thuật ngữ + bối cảnh phim để dịch phim bộ nhiều tập với tên nhân vật,
          xưng hô nhất quán giữa các tập.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedProfile}
            onChange={(e) => applyProfile(e.target.value)}
            className="select-field max-w-xs text-sm"
          >
            <option value="">— Không dùng hồ sơ —</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>

          {showSaveProfile ? (
            <div className="flex items-center gap-1">
              <input
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                placeholder="Tên phim..."
                className="input-field text-sm py-1.5 w-44"
                autoFocus
              />
              <button onClick={handleSaveProfile} className="btn-primary text-sm py-1.5 px-3">Lưu</button>
              <button onClick={() => setShowSaveProfile(false)} className="btn-secondary text-sm py-1.5 px-3">Hủy</button>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveProfile(true)}
              className="btn-secondary flex items-center gap-1.5 text-sm"
              title="Lưu glossary + bối cảnh hiện tại thành hồ sơ phim"
            >
              <Save className="w-4 h-4" />
              Lưu hồ sơ mới
            </button>
          )}

          {selectedProfile && (
            <button
              onClick={handleDeleteProfile}
              className="text-gray-400 hover:text-red-500 p-1.5"
              title="Xóa hồ sơ này"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
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
          {models?.llm_models?.length ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {models.llm_models.map((model) => (
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
          ) : (
            <p className="text-sm text-amber-600">
              Không tải được danh sách model — sẽ dùng <code>{llmModel}</code>.
            </p>
          )}
        </div>
      )}

      {/* Hybrid settings */}
      {provider === 'hybrid' && (
        <div className="card">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Combine className="w-5 h-5 text-green-600" />
            Cài đặt Hybrid
          </h3>
          <p className="text-sm text-gray-500 mb-3">
            Google Translate dịch thô toàn bộ (nhanh, rẻ) → AI đọc lại từng câu và tinh chỉnh
            cho tự nhiên, đúng xưng hô.
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hybridRefine}
              onChange={(e) => setHybridRefine(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm">Dùng AI tinh chỉnh kết quả dịch thô (khuyến nghị)</span>
          </label>
        </div>
      )}

      {/* Translation mode */}
      <div className="card">
        <h3 className="font-semibold mb-3">Chế độ dịch</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.entries(MODE_INFO).map(([key, info]) => {
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
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            Bảng thuật ngữ / tên nhân vật
          </h3>
          <p className="text-sm text-gray-500 mb-2">
            Mỗi dòng một cặp: <code>từ gốc = từ dịch</code>. AI và Google đều bị ép dùng đúng các từ này.
          </p>
          <textarea
            value={glossaryText}
            onChange={(e) => setGlossaryText(e.target.value)}
            placeholder={"小明 = Tiểu Minh\noppa = anh\nsensei = thầy"}
            className="input-field h-32 font-mono text-sm"
          />
          {glossaryPreview && (
            <p className="text-xs text-green-600 mt-1">
              ✓ {Object.keys(glossaryPreview).length} thuật ngữ hợp lệ
            </p>
          )}
        </div>
      )}

      {/* Film context */}
      {provider !== 'google' && (
        <div className="card">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Film className="w-5 h-5 text-indigo-600" />
            Bối cảnh phim (tùy chọn)
          </h3>
          <p className="text-sm text-gray-500 mb-2">
            Mô tả thể loại, quan hệ nhân vật, xưng hô, văn phong — AI sẽ dịch đúng ngữ cảnh hơn nhiều.
          </p>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={"VD: Phim cổ trang Trung Quốc thời Đường. Nhân vật chính Lý Mộ Bạch là tướng quân, xưng 'bổn tướng', gọi vua là 'bệ hạ'. Văn phong trang trọng, cổ kính."}
            className="input-field h-24 text-sm"
          />
        </div>
      )}

      {/* Provider availability warning */}
      {(needsKey || needsGoogle) && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">
              {needsKey ? 'Chưa cấu hình API key cho LLM' : 'Google Translate đang bị tắt'}
            </p>
            <p className="text-amber-800 mt-0.5">
              {needsKey
                ? 'Bạn cần thêm API key trong Cài đặt để dùng AI/Hybrid, hoặc chuyển sang Google Translate (miễn phí).'
                : 'Vào Cài đặt để bật Google Translate.'}
            </p>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-amber-900 underline hover:no-underline mt-1 font-medium"
              >
                Mở Cài đặt ngay
              </button>
            )}
          </div>
        </div>
      )}

      {/* Start button */}
      <div className="flex justify-center">
        <button
          onClick={handleTranslate}
          disabled={startDisabled}
          className="btn-primary text-lg px-8 py-3 flex items-center gap-2"
        >
          <Play className="w-5 h-5" />
          Bắt đầu dịch
        </button>
      </div>
    </div>
  );
}
