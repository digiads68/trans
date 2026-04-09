import React from 'react';
import { Download, FileText, FileSpreadsheet } from 'lucide-react';
import { exportFile } from '../services/api';

export default function ExportPanel({ fileId, filename }) {
  const baseName = filename?.replace(/\.[^.]+$/, '') || 'subtitle';

  return (
    <div className="card">
      <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
        <Download className="w-5 h-5 text-green-600" />
        Tải xuống bản dịch
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a
          href={exportFile(fileId, 'srt')}
          download={`${baseName}_vi.srt`}
          className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-green-500
                     hover:bg-green-50 transition-all group"
        >
          <FileText className="w-10 h-10 text-gray-400 group-hover:text-green-600" />
          <div>
            <p className="font-medium">File SRT</p>
            <p className="text-sm text-gray-500">{baseName}_vi.srt</p>
            <p className="text-xs text-gray-400">Tương thích với mọi trình phát video</p>
          </div>
        </a>

        <a
          href={exportFile(fileId, 'xlsx')}
          download={`${baseName}_vi.xlsx`}
          className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-green-500
                     hover:bg-green-50 transition-all group"
        >
          <FileSpreadsheet className="w-10 h-10 text-gray-400 group-hover:text-green-600" />
          <div>
            <p className="font-medium">File Excel</p>
            <p className="text-sm text-gray-500">{baseName}_vi.xlsx</p>
            <p className="text-xs text-gray-400">Bao gồm bản gốc và bản dịch song ngữ</p>
          </div>
        </a>
      </div>
    </div>
  );
}
