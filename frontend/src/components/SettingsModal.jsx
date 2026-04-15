import React, { useEffect, useState } from 'react';
import { X, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, Key, Globe, Server } from 'lucide-react';
import { getConfig, updateConfig, testConfig } from '../services/api';

const DEFAULT_API_BASE = 'https://api.cliproxyapi.com/v1';

export default function SettingsModal({ onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [apiBase, setApiBase] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, message }
  const [error, setError] = useState(null);

  // Load current config on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getConfig();
        if (cancelled) return;
        setConfig(data);
        setApiBase(data.cliproxy_api_base || '');
        setGoogleEnabled(data.google_translate_enabled);
      } catch (err) {
        if (!cancelled) setError('Không thể tải cấu hình hiện tại: ' + (err.response?.data?.detail || err.message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = {};
      // Only send non-empty fields; backend falls back to runtime config otherwise
      if (apiBase.trim()) payload.api_base = apiBase.trim();
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      const result = await testConfig(payload);
      setTestResult({ ok: true, message: `OK — model ${result.model} trả lời: "${result.response}"` });
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.detail || err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updates = {
        cliproxy_api_base: apiBase.trim(), // empty string clears override
        google_translate_enabled: googleEnabled,
      };
      // Only send api_key if user typed something. Empty input means "don't change".
      // Exception: user can clear the key by typing the literal string "CLEAR".
      if (apiKey.trim() === 'CLEAR') {
        updates.cliproxy_api_key = '';
      } else if (apiKey.trim()) {
        updates.cliproxy_api_key = apiKey.trim();
      }
      const newConfig = await updateConfig(updates);
      setConfig(newConfig);
      setApiKey(''); // clear input after save for security
      onSaved?.(newConfig);
      onClose();
    } catch (err) {
      setError('Lưu thất bại: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">Cài đặt API</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Đang tải cấu hình...
            </div>
          ) : (
            <>
              {/* Status */}
              {config && (
                <div className={`rounded-lg p-3 text-sm flex items-start gap-2
                  ${config.cliproxy_api_key_set
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-amber-50 border border-amber-200 text-amber-800'}`}
                >
                  {config.cliproxy_api_key_set
                    ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    : <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                  <div>
                    <p className="font-medium">
                      {config.cliproxy_api_key_set
                        ? `API key đã cấu hình (nguồn: ${config.cliproxy_api_key_source === 'env' ? 'biến môi trường .env' : 'runtime'})`
                        : 'Chưa cấu hình API key cho LLM'}
                    </p>
                    <p className="text-xs mt-0.5 opacity-80">
                      Endpoint hiện tại: <code>{config.cliproxy_api_base_effective}</code>
                    </p>
                  </div>
                </div>
              )}

              {/* API Base */}
              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-1.5">
                  <Server className="w-4 h-4" />
                  API Base URL
                </label>
                <input
                  type="text"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder={DEFAULT_API_BASE}
                  className="input-field text-sm font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Để trống nếu dùng mặc định ({DEFAULT_API_BASE}). Endpoint OpenAI-compatible.
                </p>
              </div>

              {/* API Key */}
              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-1.5">
                  <Key className="w-4 h-4" />
                  CLIPROXY_API_KEY
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={config?.cliproxy_api_key_set ? '••••••••  (để trống = không thay đổi)' : 'sk-... hoặc cliproxy-...'}
                    className="input-field text-sm font-mono pr-10"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Key dùng cho mọi LLM provider (OpenAI, Claude, Gemini,...). Để xóa: gõ <code>CLEAR</code>.
                </p>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`rounded-lg p-3 text-sm flex items-start gap-2
                  ${testResult.ok
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50 border border-red-200 text-red-800'}`}
                >
                  {testResult.ok
                    ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Test button */}
              <div>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || (!apiKey.trim() && !config?.cliproxy_api_key_set)}
                  className="btn-secondary text-sm flex items-center gap-2"
                >
                  {testing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {testing ? 'Đang test...' : 'Test API key'}
                </button>
              </div>

              <hr className="border-gray-200" />

              {/* Google Translate toggle */}
              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-1.5">
                  <Globe className="w-4 h-4" />
                  Google Translate
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={googleEnabled}
                    onChange={(e) => setGoogleEnabled(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm">Bật Google Translate (không cần API key)</span>
                </label>
              </div>

              {/* Hint */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                Cấu hình được lưu vào <code>data/runtime_config.json</code> trên server và không bị mất khi restart container.
                Nếu để trống, app sẽ fallback xuống biến môi trường trong <code>backend/.env</code>.
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 bg-gray-50 sticky bottom-0">
          <button onClick={onClose} className="btn-secondary text-sm">Đóng</button>
          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}
