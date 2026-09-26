import React from 'react';
import { Languages, Home, Settings as SettingsIcon, Loader2 } from 'lucide-react';

export default function Header({ onHome, onOpenSettings, apiConfigured, jobRunning, wide }) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className={`${wide ? 'max-w-[1600px]' : 'max-w-6xl'} mx-auto px-4 py-2.5 flex items-center justify-between`}>
        <button onClick={onHome} className="flex items-center gap-3 text-left" title="Về trang chủ">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Languages className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-tight">SubTranslator</h1>
            <p className="text-xs text-gray-500">Dịch & hậu kiểm phụ đề phim</p>
          </div>
        </button>

        <div className="flex items-center gap-2">
          {jobRunning && (
            <span className="text-xs text-blue-600 flex items-center gap-1 mr-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang dịch nền
            </span>
          )}
          <button
            onClick={onOpenSettings}
            className="btn-secondary flex items-center gap-2 text-sm py-1.5 relative"
            title={apiConfigured ? 'Cài đặt API' : 'API chưa cấu hình — bấm để cài đặt'}
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Cài đặt</span>
            {apiConfigured === false && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-white" aria-label="API chưa cấu hình" />
            )}
          </button>
          <button onClick={onHome} className="btn-secondary flex items-center gap-2 text-sm py-1.5">
            <Home className="w-4 h-4" />
            <span className="hidden sm:inline">Dự án</span>
          </button>
        </div>
      </div>
    </header>
  );
}
