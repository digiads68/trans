import React from 'react';
import { Languages, RotateCcw, Settings as SettingsIcon } from 'lucide-react';

export default function Header({ onReset, onOpenSettings, apiConfigured }) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Languages className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">SubTranslator</h1>
            <p className="text-xs text-gray-500">Dịch phụ đề thông minh bằng AI</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="btn-secondary flex items-center gap-2 text-sm relative"
            title={apiConfigured ? 'Cài đặt API' : 'API chưa cấu hình — bấm để cài đặt'}
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Cài đặt</span>
            {apiConfigured === false && (
              <span
                className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-white"
                aria-label="API chưa cấu hình"
              />
            )}
          </button>

          <button
            onClick={onReset}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Tệp mới</span>
          </button>
        </div>
      </div>
    </header>
  );
}
