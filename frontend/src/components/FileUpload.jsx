import React, { useState, useCallback } from 'react';
import { Upload, FileText, FileSpreadsheet, AlertCircle, CheckCircle } from 'lucide-react';
import { uploadFile, uploadFileBatch } from '../services/api';

const ALLOWED_EXTS = ['srt', 'xlsx', 'xls', 'ass', 'ssa', 'vtt'];

function getExt(name) {
  return name.split('.').pop().toLowerCase();
}

export default function FileUpload({ onFileUploaded, onBatchUploaded }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [batchMode, setBatchMode] = useState(false);

  const handleFiles = useCallback(async (files) => {
    const fileList = Array.from(files).filter(f => ALLOWED_EXTS.includes(getExt(f.name)));
    if (!fileList.length) {
      setError(`Chỉ hỗ trợ: ${ALLOWED_EXTS.map(e => '.' + e).join(', ')}`);
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    const onProgress = (e) => {
      if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };

    try {
      if (fileList.length === 1 && !batchMode) {
        const data = await uploadFile(fileList[0], onProgress);
        onFileUploaded(data);
      } else {
        const data = await uploadFileBatch(fileList, onProgress);
        if (onBatchUploaded) {
          onBatchUploaded(data);
        } else if (data.files?.length > 0) {
          // Fallback: use first file if no batch handler
          onFileUploaded(data.files[0]);
        }
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload thất bại. Vui lòng thử lại.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [onFileUploaded, onBatchUploaded, batchMode]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleInputChange = useCallback((e) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    // Reset input value so the same file can be re-selected
    e.target.value = '';
  }, [handleFiles]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Tải lên file phụ đề</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={batchMode}
              onChange={e => setBatchMode(e.target.checked)}
              className="rounded"
            />
            Nhiều file
          </label>
        </div>

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
            accept={ALLOWED_EXTS.map(e => '.' + e).join(',')}
            multiple={batchMode}
            onChange={handleInputChange}
          />

          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full" />
              <p className="text-gray-600">Đang xử lý...</p>
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="w-48">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Đang tải lên</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Upload className="w-12 h-12 text-gray-400" />
              <div>
                <p className="text-lg font-medium text-gray-700">
                  {batchMode ? 'Kéo thả nhiều file vào đây' : 'Kéo thả file vào đây hoặc nhấn để chọn'}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Hỗ trợ: SRT, Excel (.xlsx/.xls), ASS/SSA, VTT{batchMode ? ' — tối đa 20 file' : ''}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {['.srt', '.xlsx / .xls', '.ass / .ssa', '.vtt'].map(label => (
                  <div key={label} className="flex items-center gap-1 text-sm text-gray-500">
                    <FileText className="w-4 h-4" />
                    <span>{label}</span>
                  </div>
                ))}
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
