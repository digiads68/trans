import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Sparkles, Globe, Combine, BookOpen, Film, Save, Trash2, AlertTriangle, Loader2,
} from 'lucide-react';
import {
  LANGUAGES, TARGET_LANGUAGES, loadProfiles, saveProfiles, parseGlossary, glossaryToText,
} from '../utils/subtitle';

const PROVIDERS = {
  llm: { icon: Sparkles, label: 'AI (LLM)', desc: 'Chất lượng cao, hiểu ngữ cảnh' },
  google: { icon: Globe, label: 'Google', desc: 'Nhanh, miễn phí' },
  hybrid: { icon: Combine, label: 'Hybrid', desc: 'Google dịch thô + AI tinh chỉnh' },
};

const DEFAULTS_KEY = 'subtranslator_last_config';

function loadDefaults() {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="border-t border-gray-100 pt-3 mt-3 first:border-0 first:pt-0 first:mt-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {title}
      </h4>
      {children}
    </div>
  );
}

export default function ConfigPanel({
  fileData, lastConfig, models, apiConfig, onOpenSettings,
  onStart, isTranslating, counts,
}) {
  const initial = useMemo(() => ({ ...loadDefaults(), ...(lastConfig || {}) }), [lastConfig]);
  const apiKeySet = apiConfig?.cliproxy_api_key_set ?? true;
  const googleEnabled = apiConfig?.google_translate_enabled ?? true;

  const [provider, setProvider] = useState(initial.provider || 'llm');
  const [llmModel, setLlmModel] = useState(initial.llm_model || 'gpt-4o-mini');
  const [sourceLang, setSourceLang] = useState(initial.source_lang || fileData.detected_lang || 'auto');
  const [targetLang, setTargetLang] = useState(initial.target_lang || 'vi');
  const [contextAware, setContextAware] = useState(initial.context_aware ?? true);
  const [useGlossary, setUseGlossary] = useState(!!initial.glossary);
  const [glossaryText, setGlossaryText] = useState(glossaryToText(initial.glossary));
  const [customPrompt, setCustomPrompt] = useState(initial.custom_prompt || '');
  const [hybridRefine, setHybridRefine] = useState(initial.hybrid_refine ?? true);

  const translatedCount = counts ? counts.total - counts.untranslated : 0;
  const lockedCount = counts ? counts.edited + counts.reviewed : 0;
  const [scope, setScope] = useState(translatedCount > 0 ? 'missing' : 'all_unlocked');

  const [profiles, setProfiles] = useState(loadProfiles);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // After any run finishes, the safe default for the next run is "only missing"
  // (never leave the destructive "all" option selected)
  const wasTranslating = useRef(isTranslating);
  useEffect(() => {
    if (wasTranslating.current && !isTranslating) setScope('missing');
    wasTranslating.current = isTranslating;
  }, [isTranslating]);

  const glossary = useGlossary ? parseGlossary(glossaryText) : null;
  const isLLM = provider !== 'google';

  const applyProfile = (name) => {
    setSelectedProfile(name);
    const p = profiles.find((x) => x.name === name);
    if (!p) return;
    if (p.provider) setProvider(p.provider);
    if (p.llmModel) setLlmModel(p.llmModel);
    if (p.targetLang) setTargetLang(p.targetLang);
    setGlossaryText(p.glossaryText || '');
    setUseGlossary(!!p.glossaryText);
    setCustomPrompt(p.customPrompt || '');
  };

  const handleSaveProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    const next = [
      ...profiles.filter((p) => p.name !== name),
      { name, glossaryText, customPrompt, provider, llmModel, targetLang },
    ];
    setProfiles(next);
    saveProfiles(next);
    setSelectedProfile(name);
    setNewProfileName('');
    setSavingProfile(false);
  };

  const handleDeleteProfile = () => {
    if (!selectedProfile || !window.confirm(`Xóa hồ sơ "${selectedProfile}"?`)) return;
    const next = profiles.filter((p) => p.name !== selectedProfile);
    setProfiles(next);
    saveProfiles(next);
    setSelectedProfile('');
  };

  const needsKey = isLLM && !apiKeySet;
  const needsGoogle = provider === 'google' && !googleEnabled;
  const nothingToDo = scope === 'missing' && counts && counts.untranslated === 0;

  const handleStart = () => {
    if (scope === 'all' && lockedCount > 0 && !window.confirm(
      `Dịch lại toàn bộ sẽ GHI ĐÈ ${lockedCount} dòng bạn đã sửa/duyệt. Tiếp tục?`,
    )) return;

    const request = {
      file_id: fileData.file_id,
      provider,
      llm_model: llmModel,
      mode: 'standard',
      context_aware: isLLM && contextAware,
      source_lang: sourceLang === 'auto' ? null : sourceLang,
      target_lang: targetLang,
      custom_prompt: isLLM && customPrompt.trim() ? customPrompt.trim() : null,
      glossary,
      scope,
      hybrid_primary: provider === 'hybrid' ? 'google' : null,
      hybrid_fallback: provider === 'hybrid' ? 'llm' : null,
      hybrid_refine: provider === 'hybrid' ? hybridRefine : false,
    };
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify({
        provider, llm_model: llmModel, target_lang: targetLang, context_aware: contextAware,
      }));
    } catch { /* ignore */ }
    onStart(request);
  };

  return (
    <div className="text-sm">
      <Section title="Hồ sơ phim" icon={Film}>
        <div className="flex items-center gap-1.5">
          <select
            value={selectedProfile}
            onChange={(e) => applyProfile(e.target.value)}
            className="select-field py-1.5 text-sm"
            aria-label="Hồ sơ phim"
          >
            <option value="">— Không dùng hồ sơ —</option>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          {selectedProfile && (
            <button onClick={handleDeleteProfile} className="p-1.5 text-gray-400 hover:text-red-500" title="Xóa hồ sơ">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        {savingProfile ? (
          <div className="flex items-center gap-1 mt-1.5">
            <input
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
              placeholder="Tên phim..."
              className="input-field py-1 text-sm"
              autoFocus
            />
            <button onClick={handleSaveProfile} className="btn-primary py-1 px-2 text-xs">Lưu</button>
            <button onClick={() => setSavingProfile(false)} className="btn-secondary py-1 px-2 text-xs">Hủy</button>
          </div>
        ) : (
          <button
            onClick={() => { setSavingProfile(true); setNewProfileName(selectedProfile); }}
            className="mt-1.5 text-xs text-blue-600 hover:underline flex items-center gap-1"
            title="Lưu thuật ngữ + bối cảnh + model + ngôn ngữ đích để dùng cho các tập sau"
          >
            <Save className="w-3.5 h-3.5" />
            Lưu cấu hình hiện tại thành hồ sơ
          </button>
        )}
      </Section>

      <Section title="Ngôn ngữ">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Nguồn</span>
            <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="select-field py-1.5 text-sm">
              {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Đích</span>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="select-field py-1.5 text-sm">
              {Object.entries(TARGET_LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Phương thức dịch">
        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(PROVIDERS).map(([key, info]) => {
            const Icon = info.icon;
            return (
              <button
                key={key}
                onClick={() => setProvider(key)}
                title={info.desc}
                className={`p-2 rounded-lg border-2 text-center transition-all ${provider === key
                  ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
              >
                <Icon className="w-4 h-4 mx-auto mb-0.5" />
                <span className="text-xs font-medium">{info.label}</span>
              </button>
            );
          })}
        </div>
        {isLLM && (
          <label className="block mt-2">
            <span className="text-xs text-gray-500">Model AI</span>
            <select value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className="select-field py-1.5 text-sm">
              {(models?.llm_models?.length ? models.llm_models : [llmModel]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {models?.llm_models?.length && !models.llm_models.includes(llmModel) && (
                <option value={llmModel}>{llmModel}</option>
              )}
            </select>
          </label>
        )}
        {provider === 'hybrid' && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input type="checkbox" checked={hybridRefine} onChange={(e) => setHybridRefine(e.target.checked)} />
            <span className="text-xs">AI tinh chỉnh bản dịch thô của Google</span>
          </label>
        )}
        {isLLM && (
          <label className="flex items-start gap-2 mt-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={contextAware} onChange={(e) => setContextAware(e.target.checked)} />
            <span className="text-xs">
              <span className="font-medium">Dịch theo ngữ cảnh</span>
              <span className="block text-gray-500">AI đọc các câu trước/sau để dịch mạch lạc, xưng hô nhất quán (chậm hơn)</span>
            </span>
          </label>
        )}
      </Section>

      <Section title="Thuật ngữ & tên nhân vật" icon={BookOpen}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={useGlossary} onChange={(e) => setUseGlossary(e.target.checked)} />
          <span className="text-xs">Ép dùng bảng thuật ngữ</span>
        </label>
        {useGlossary && (
          <>
            <textarea
              value={glossaryText}
              onChange={(e) => setGlossaryText(e.target.value)}
              placeholder={'Mỗi dòng: từ gốc = từ dịch\n小明 = Tiểu Minh\noppa = anh'}
              className="input-field mt-1.5 h-28 font-mono text-xs"
            />
            <p className={`text-xs mt-0.5 ${glossary ? 'text-green-600' : 'text-gray-400'}`}>
              {glossary ? `✓ ${Object.keys(glossary).length} thuật ngữ` : 'Chưa có thuật ngữ hợp lệ'}
            </p>
          </>
        )}
      </Section>

      {isLLM && (
        <Section title="Bối cảnh phim" icon={Film}>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="VD: Phim cổ trang Trung Quốc. Lý Mộ Bạch là tướng quân, xưng 'bổn tướng', gọi vua là 'bệ hạ'. Văn phong trang trọng."
            className="input-field h-20 text-xs"
          />
        </Section>
      )}

      <Section title="Phạm vi dịch">
        <div className="space-y-1">
          {[
            { key: 'missing', label: `Chỉ dòng chưa dịch${counts ? ` (${counts.untranslated})` : ''}` },
            { key: 'all_unlocked', label: 'Dịch lại tất cả, giữ dòng đã sửa/duyệt' },
            { key: 'all', label: 'Dịch lại toàn bộ (ghi đè bản sửa tay)' },
          ].map((opt) => (
            <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="scope" checked={scope === opt.key} onChange={() => setScope(opt.key)} />
              <span className={`text-xs ${opt.key === 'all' ? 'text-red-600' : ''}`}>{opt.label}</span>
            </label>
          ))}
        </div>
      </Section>

      {(needsKey || needsGoogle) && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-xs flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-amber-900 font-medium">
              {needsKey ? 'Chưa có API key cho AI' : 'Google Translate đang tắt'}
            </p>
            <button onClick={onOpenSettings} className="text-amber-900 underline">Mở Cài đặt</button>
            {needsKey && <span className="text-amber-800"> hoặc chọn Google.</span>}
          </div>
        </div>
      )}

      <button
        onClick={handleStart}
        disabled={isTranslating || needsKey || needsGoogle || nothingToDo}
        className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
      >
        {isTranslating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        {isTranslating ? 'Đang dịch...' : nothingToDo ? 'Không còn dòng chưa dịch' : 'Bắt đầu dịch'}
      </button>
    </div>
  );
}
