import React, { useState, useCallback } from 'react';
import { Upload, FileText, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { uploadFile } from '../services/api';

export default function FileUpload({ onFileUploaded }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['srt', 'xlsx', 'xls'].includes(ext)) {
      setError('Chỉ hỗ trợ file .srt, .xlsx, .xls');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const data = await uploadFile(file);
      onFileUploaded(data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload thất bại. Vui lòng thử lại.');
    } finally {
      setIsUploading(false);
    }
  }, [onFileUploaded]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Tải lên file phụ đề</h2>

        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
            transition-colors duration-200
            ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
            ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => document.getElementById('file-input').click()}
        >
          <input
            id="file-input"
            type="file"
            className="hidden"
            accept=".srt,.xlsx,.xls"
            onChange={(e) => handleFile(e.target.files[0])}
          />

          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full" />
              <p className="text-gray-600">Đang xử lý...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Upload className="w-12 h-12 text-gray-400" />
              <div>
                <p className="text-lg font-medium text-gray-700">
                  Kéo thả file vào đây hoặc nhấn để chọn
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Hỗ trợ: SRT, Excel (.xlsx, .xls)
                </p>
              </div>
              <div className="flex gap-4 mt-2">
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <FileText className="w-4 h-4" />
                  <span>.srt</span>
                </div>
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>.xlsx / .xls</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
