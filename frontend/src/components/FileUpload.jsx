import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload, FileText, AlertCircle, Clock, Trash2, PlayCircle, FolderOpen,
} from 'lucide-react';
import { uploadFile, uploadFileBatch, listProjects, deleteProject } from '../services/api';
import { getLastProjectId, TARGET_LANGUAGES } from '../utils/subtitle';

const ALLOWED_EXTS = ['srt', 'xlsx', 'xls', 'ass', 'ssa', 'vtt'];

function getExt(name) {
  return name.split('.').pop().toLowerCase();
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}

function RecentProjects({ onOpenProject }) {
  const [projects, setProjects] = useState(null);
  const lastId = getLastProjectId();

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const handleDelete = async (p) => {
    if (!window.confirm(`Xóa dự án "${p.filename}" và toàn bộ bản dịch? Không thể hoàn tác.`)) return;
    try {
      await deleteProject(p.file_id);
      setProjects((list) => list.filter((x) => x.file_id !== p.file_id));
    } catch {
      window.alert('Xóa thất bại');
    }
  };

  if (!projects || projects.length === 0) return null;

  return (
    <div className="card mt-6">
      <h2 className="font-semibold mb-3 flex items-center gap-2">
        <FolderOpen className="w-5 h-5 text-blue-600" /> Dự án gần đây
      </h2>
      <p className="text-xs text-gray-500 -mt-2 mb-3">Mọi bản dịch và chỉnh sửa được lưu tự động — mở lại để làm tiếp.</p>
      <div className="divide-y divide-gray-100">
        {projects.map((p) => {
          const pctReviewed = p.total ? Math.round((p.reviewed / p.total) * 100) : 0;
          const pctTranslated = p.total ? Math.round((p.translated / p.total) * 100) : 0;
          const isLast = p.file_id === lastId;
          return (
            <div key={p.file_id} className={`flex items-center gap-3 py-2.5 ${isLast ? 'bg-blue-50/60 -mx-3 px-3 rounded-lg' : ''}`}>
              <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <button onClick={() => onOpenProject(p)} className="flex-1 min-w-0 text-left group">
                <p className="font-medium text-sm text-gray-900 truncate group-hover:text-blue-700">{p.filename}</p>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                  <span>{p.total} dòng</span>
                  <span>Dịch {pctTranslated}%</span>
                  <span className="text-green-700">Duyệt {pctReviewed}%</span>
                  {p.target_lang && <span>→ {TARGET_LANGUAGES[p.target_lang] || p.target_lang}</span>}
                  <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{timeAgo(p.last_access)}</span>
                </div>
                <div className="w-full max-w-xs h-1 bg-gray-200 rounded-full mt-1 relative overflow-hidden">
                  <div className="absolute h-1 bg-blue-300" style={{ width: `${pctTranslated}%` }} />
                  <div className="absolute h-1 bg-green-500" style={{ width: `${pctReviewed}%` }} />
                </div>
              </button>
              <button
                onClick={() => onOpenProject(p)}
                className={`${isLast ? 'btn-primary' : 'btn-secondary'} text-xs py-1.5 px-3 flex items-center gap-1`}
              >
                <PlayCircle className="w-4 h-4" /> {isLast ? 'Tiếp tục' : 'Mở'}
              </button>
              <button onClick={() => handleDelete(p)} className="p-1.5 text-gray-300 hover:text-red-500" title="Xóa dự án">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FileUpload({ onFileUploaded, onBatchUploaded, onOpenProject }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFiles = useCallback(async (files) => {
    const all = Array.from(files);
    const fileList = all.filter((f) => ALLOWED_EXTS.includes(getExt(f.name)));
    if (!fileList.length) {
      setError(`Chỉ hỗ trợ: ${ALLOWED_EXTS.map((e) => '.' + e).join(', ')}`);
      return;
    }
    if (fileList.length > 20) {
      setError('Tối đa 20 file mỗi lần tải lên.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    const onProgress = (e) => {
      if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };

    try {
      if (fileList.length === 1) {
        onFileUploaded(await uploadFile(fileList[0], onProgress));
      } else {
        onBatchUploaded(await uploadFileBatch(fileList, onProgress));
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload thất bại. Vui lòng thử lại.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [onFileUploaded, onBatchUploaded]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Tải lên file phụ đề</h2>

        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors duration-200
            ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
            ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); handleFiles(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ALLOWED_EXTS.map((e) => '.' + e).join(',')}
            multiple
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
              e.target.value = '';
            }}
            data-testid="file-input"
          />

          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full" />
              <p className="text-gray-600">Đang xử lý...</p>
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="w-12 h-12 text-gray-400" />
              <div>
                <p className="text-lg font-medium text-gray-700">Kéo thả file vào đây hoặc nhấn để chọn</p>
                <p className="text-sm text-gray-500 mt-1">
                  SRT, ASS/SSA, VTT, Excel · chọn nhiều file (tối đa 20) để dịch cả bộ phim
                </p>
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

      <RecentProjects onOpenProject={onOpenProject} />
    </div>
  );
}
