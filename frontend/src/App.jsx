import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getModels, getConfig } from './services/api';
import { useTranslation } from './hooks/useTranslation';
import { setLastProjectId } from './utils/subtitle';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import Workspace from './components/Workspace';
import BatchManager from './components/BatchManager';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [screen, setScreen] = useState('upload'); // upload | workspace | batch
  const [project, setProject] = useState(null); // file summary open in the workspace
  const [batchFiles, setBatchFiles] = useState(null);
  const [fileStatuses, setFileStatuses] = useState({}); // { [fileId]: 'done' | 'error' }
  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [apiConfig, setApiConfig] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchCurrentId, setBatchCurrentId] = useState(null);
  const batchStopRef = useRef(false);

  // The translation hook lives HERE so a job survives screen changes
  const translation = useTranslation();
  const { startJob, cancel, isTranslating, jobFileId } = translation;

  const refreshApiConfig = useCallback(async () => {
    try {
      setApiConfig(await getConfig());
    } catch {
      // backend offline — config panel will show defaults
    }
  }, []);

  useEffect(() => {
    getModels()
      .then(setModels)
      .catch(() => setModelsError('Không kết nối được backend. Kiểm tra máy chủ đang chạy (cổng 8000).'));
    refreshApiConfig();
  }, [refreshApiConfig]);

  const markFileStatus = useCallback((fileId, status) => {
    setFileStatuses((prev) => ({ ...prev, [fileId]: status }));
  }, []);

  const openWorkspace = (summary) => {
    setProject(summary);
    setLastProjectId(summary.file_id);
    setScreen('workspace');
  };

  const handleFileUploaded = (data) => {
    setBatchFiles(null);
    openWorkspace(data);
  };

  const handleBatchUploaded = (data) => {
    const ok = data.files.filter((f) => f.file_id);
    if (ok.length === 1 && ok.length === data.files.length) {
      handleFileUploaded(ok[0]);
      return;
    }
    setBatchFiles(data.files);
    setFileStatuses({});
    setScreen('batch');
  };

  const handleTranslateAll = async (buildRequest) => {
    if (!batchFiles || batchRunning || isTranslating) return;
    setBatchRunning(true);
    batchStopRef.current = false;

    const pending = batchFiles.filter((f) => f.file_id && fileStatuses[f.file_id] !== 'done');
    for (const file of pending) {
      if (batchStopRef.current) break;
      setBatchCurrentId(file.file_id);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        startJob(buildRequest(file), {
          onComplete: (s) => { markFileStatus(file.file_id, s.failed ? 'error' : 'done'); resolve(); },
          onError: () => { markFileStatus(file.file_id, 'error'); resolve(); },
          onCancelled: () => { batchStopRef.current = true; resolve(); },
        });
      });
    }
    setBatchCurrentId(null);
    setBatchRunning(false);
  };

  const handleStopBatch = () => {
    batchStopRef.current = true;
    if (batchCurrentId) cancel(batchCurrentId);
  };

  const goHome = () => {
    setScreen('upload');
    setProject(null);
  };

  const backFromWorkspace = () => {
    if (batchFiles) {
      setScreen('batch');
      setProject(null);
    } else {
      goHome();
    }
  };

  const wide = screen === 'workspace';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <Header
        onHome={goHome}
        onOpenSettings={() => setShowSettings(true)}
        apiConfigured={apiConfig?.cliproxy_api_key_set ?? null}
        jobRunning={isTranslating && screen !== 'workspace' ? jobFileId : null}
        wide={wide}
      />

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onSaved={() => refreshApiConfig()} />
      )}

      <main className={`${wide ? 'max-w-[1600px]' : 'max-w-6xl'} mx-auto px-4 py-6`}>
        {modelsError && (
          <div className="max-w-2xl mx-auto mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-sm">
            {modelsError}
          </div>
        )}

        {screen === 'upload' && (
          <FileUpload
            onFileUploaded={handleFileUploaded}
            onBatchUploaded={handleBatchUploaded}
            onOpenProject={(p) => { setBatchFiles(null); openWorkspace(p); }}
          />
        )}

        {screen === 'batch' && batchFiles && (
          <BatchManager
            files={batchFiles}
            fileStatuses={fileStatuses}
            onOpenFile={openWorkspace}
            onBack={goHome}
            models={models}
            apiConfig={apiConfig}
            onTranslateAll={handleTranslateAll}
            onStopBatch={handleStopBatch}
            batchRunning={batchRunning}
            batchCurrentId={batchCurrentId}
            progress={translation.progress}
          />
        )}

        {screen === 'workspace' && project && (
          <Workspace
            key={project.file_id}
            project={project}
            models={models}
            apiConfig={apiConfig}
            onOpenSettings={() => setShowSettings(true)}
            onBack={backFromWorkspace}
            backLabel={batchFiles ? 'Danh sách file' : 'Trang chủ'}
            translation={translation}
            onJobFinished={markFileStatus}
          />
        )}
      </main>
    </div>
  );
}
