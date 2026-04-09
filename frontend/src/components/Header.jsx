import React from 'react';
import { Languages, RotateCcw } from 'lucide-react';

export default function Header({ onReset }) {
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

        <button
          onClick={onReset}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Tệp mới
        </button>
      </div>
    </header>
  );
}
