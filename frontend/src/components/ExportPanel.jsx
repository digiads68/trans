import React from 'react';
import { Download, FileText, FileSpreadsheet, Film, Tv } from 'lucide-react';
import { exportFile } from '../services/api';

const EXPORT_FORMATS = [
  {
    id: 'srt',
    label: 'File SRT',
    ext: 'srt',
    description: 'Tương thích với mọi trình phát video',
    icon: FileText,
    color: 'blue',
  },
  {
    id: 'xlsx',
    label: 'File Excel',
    ext: 'xlsx',
    description: 'Bao gồm bản gốc và bản dịch song ngữ',
    icon: FileSpreadsheet,
    color: 'green',
  },
  {
    id: 'vtt',
    label: 'File VTT',
    ext: 'vtt',
    description: 'WebVTT — dành cho HTML5 video, YouTube',
    icon: FileText,
    color: 'purple',
  },
  {
    id: 'premiere',
    label: 'Premiere Pro XML',
    ext: 'xml',
    description: 'Import vào Adobe Premiere Pro',
    icon: Film,
    color: 'orange',
  },
  {
    id: 'davinci',
    label: 'DaVinci Resolve SRT',
    ext: 'srt',
    description: 'SRT tối ưu cho DaVinci Resolve',
    icon: Tv,
    color: 'pink',
  },
];

const colorMap = {
  blue:   'hover:border-blue-500 hover:bg-blue-50 group-hover:text-blue-600',
  green:  'hover:border-green-500 hover:bg-green-50 group-hover:text-green-600',
  purple: 'hover:border-purple-500 hover:bg-purple-50 group-hover:text-purple-600',
  orange: 'hover:border-orange-500 hover:bg-orange-50 group-hover:text-orange-600',
  pink:   'hover:border-pink-500 hover:bg-pink-50 group-hover:text-pink-600',
};

export default function ExportPanel({ fileId, filename, targetLang = 'vi' }) {
  const baseName = filename?.replace(/\.[^.]+$/, '') || 'subtitle';

  return (
    <div className="card">
      <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
        <Download className="w-5 h-5 text-green-600" />
        Tải xuống bản dịch
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {EXPORT_FORMATS.map((fmt) => {
          const Icon = fmt.icon;
          const hoverClasses = colorMap[fmt.color];
          const outputName = `${baseName}_${targetLang}.${fmt.ext}`;

          return (
            <a
              key={fmt.id}
              href={exportFile(fileId, fmt.id, targetLang)}
              download={outputName}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200
                         transition-all group ${hoverClasses}`}
            >
              <Icon className={`w-10 h-10 text-gray-400 flex-shrink-0 ${hoverClasses.split(' ').pop()}`} />
              <div className="min-w-0">
                <p className="font-medium truncate">{fmt.label}</p>
                <p className="text-sm text-gray-500 truncate">{outputName}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fmt.description}</p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
