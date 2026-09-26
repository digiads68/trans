import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Film, X, Eye, EyeOff } from 'lucide-react';

/**
 * Local video reference. The file never leaves the browser (object URL).
 * Parent calls ref.seek(seconds); onTime(seconds) reports playback position.
 */
const VideoPanel = forwardRef(function VideoPanel({ onTime, currentEntry, showOriginal, onClose }, ref) {
  const videoRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [name, setName] = useState('');
  const [overlayOriginal, setOverlayOriginal] = useState(showOriginal ?? false);

  useImperativeHandle(ref, () => ({
    seek(seconds) {
      const v = videoRef.current;
      if (v && seconds != null) {
        v.currentTime = Math.max(0, seconds);
      }
    },
  }));

  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src);
  }, [src]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(file));
    setName(file.name);
  };

  const text = currentEntry?.translated_text || '';

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Film className="w-4 h-4 text-indigo-600" />
          Video đối chiếu
        </h4>
        <div className="flex items-center gap-1">
          {src && (
            <button
              onClick={() => setOverlayOriginal((s) => !s)}
              className="p-1 text-gray-400 hover:text-gray-600"
              title={overlayOriginal ? 'Ẩn bản gốc trên video' : 'Hiện cả bản gốc trên video'}
            >
              {overlayOriginal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600" title="Đóng video">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!src ? (
        <label className="block border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40">
          <input type="file" accept="video/*" className="hidden" onChange={handleFile} />
          <Film className="w-8 h-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-600">Chọn file video trên máy</p>
          <p className="text-xs text-gray-400 mt-1">Video chỉ phát trong trình duyệt, không tải lên máy chủ</p>
        </label>
      ) : (
        <>
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={src}
              controls
              className="w-full max-h-[45vh]"
              onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
              onSeeked={(e) => onTime?.(e.currentTarget.currentTime)}
            />
            {currentEntry && (
              <div className="absolute left-0 right-0 bottom-12 flex flex-col items-center pointer-events-none px-4 gap-1">
                {overlayOriginal && (
                  <span className="bg-black/60 text-gray-200 text-xs px-2 py-0.5 rounded whitespace-pre-line text-center">
                    {currentEntry.original_text}
                  </span>
                )}
                {text && (
                  <span className="bg-black/70 text-white text-base md:text-lg font-medium px-3 py-1 rounded whitespace-pre-line text-center leading-snug">
                    {text}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-xs text-gray-400 truncate">{name}</p>
            <label className="text-xs text-indigo-600 hover:underline cursor-pointer">
              Đổi video
              <input type="file" accept="video/*" className="hidden" onChange={handleFile} />
            </label>
          </div>
        </>
      )}
    </div>
  );
});

export default VideoPanel;
