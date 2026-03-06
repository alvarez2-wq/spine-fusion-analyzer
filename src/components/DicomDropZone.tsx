import { useState, useRef, useCallback } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { initCornerstone } from '../lib/initCornerstone';
import { loadDICOMFiles } from '../lib/dicomLoader';
import type { SeriesMetadata } from '../types';

interface DicomDropZoneProps {
  onLoaded: (
    volumeId: string,
    imageIds: string[],
    metadata: SeriesMetadata
  ) => void;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'initializing' }
  | { status: 'loading'; step: string; detail: string }
  | { status: 'error'; message: string };

/**
 * Recursively read all files from a DataTransferItem that represents a directory.
 */
async function readDirectoryEntries(
  entry: FileSystemDirectoryEntry
): Promise<File[]> {
  const reader = entry.createReader();
  const files: File[] = [];

  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  let batch = await readBatch();
  while (batch.length > 0) {
    for (const child of batch) {
      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (child as FileSystemFileEntry).file(resolve, reject)
        );
        files.push(file);
      } else if (child.isDirectory) {
        const subFiles = await readDirectoryEntries(
          child as FileSystemDirectoryEntry
        );
        files.push(...subFiles);
      }
    }
    batch = await readBatch();
  }

  return files;
}

/**
 * Extract File objects from a drop event, handling both files and directories.
 */
async function extractFilesFromDrop(e: DragEvent<HTMLDivElement>): Promise<File[]> {
  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) {
    // Fallback to dataTransfer.files
    return Array.from(e.dataTransfer?.files ?? []);
  }

  const files: File[] = [];

  // Try the webkitGetAsEntry API for directory support
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        );
        files.push(file);
      } else if (entry.isDirectory) {
        const dirFiles = await readDirectoryEntries(
          entry as FileSystemDirectoryEntry
        );
        files.push(...dirFiles);
      }
    }
    return files;
  }

  // Fallback
  return Array.from(e.dataTransfer?.files ?? []);
}

/**
 * Filter files to likely DICOM files.
 * DICOM files typically have no extension or a .dcm extension.
 * We also accept any file since DICOM files often lack extensions.
 */
function filterDicomCandidates(files: File[]): File[] {
  return files.filter((f) => {
    const name = f.name.toLowerCase();
    // Exclude obviously non-DICOM files
    if (
      name.endsWith('.txt') ||
      name.endsWith('.json') ||
      name.endsWith('.xml') ||
      name.endsWith('.html') ||
      name.endsWith('.js') ||
      name.endsWith('.css') ||
      name.endsWith('.png') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.gif') ||
      name.endsWith('.pdf') ||
      name.endsWith('.zip') ||
      name.endsWith('.ds_store') ||
      name === '.ds_store' ||
      name === 'thumbs.db' ||
      name === 'dicomdir'
    ) {
      return false;
    }
    return true;
  });
}

export default function DicomDropZone({ onLoaded }: DicomDropZoneProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (rawFiles: File[]) => {
      const candidates = filterDicomCandidates(rawFiles);
      if (candidates.length === 0) {
        setLoadState({
          status: 'error',
          message: 'No DICOM files found in the selected files.',
        });
        return;
      }

      try {
        // Initialize Cornerstone if not already done
        setLoadState({ status: 'initializing' });
        await initCornerstone();

        setLoadState({ status: 'loading', step: 'reading', detail: `Loading ${candidates.length} files...` });

        const result = await loadDICOMFiles(candidates, (step, detail) => {
          setLoadState({ status: 'loading', step, detail });
        });

        // Success -- notify parent
        onLoaded(result.volumeId, result.imageIds, result.metadata);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An unknown error occurred';
        console.error('DICOM loading error:', err);
        setLoadState({ status: 'error', message });
      }
    },
    [onLoaded]
  );

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = await extractFilesFromDrop(e);
      await processFiles(files);
    },
    [processFiles]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      await processFiles(Array.from(fileList));
    },
    [processFiles]
  );

  const handleReset = useCallback(() => {
    setLoadState({ status: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (dirInputRef.current) dirInputRef.current.value = '';
  }, []);

  // DEV: Load sample data from public/sample-data/spine-ct/
  const handleLoadSample = useCallback(async () => {
    setLoadState({ status: 'loading', step: 'fetching', detail: 'Fetching sample DICOM files…' });
    try {
      const totalFiles = 538;
      const files: File[] = [];
      const batchSize = 50;
      for (let start = 1; start <= totalFiles; start += batchSize) {
        const end = Math.min(start + batchSize - 1, totalFiles);
        const batch = [];
        for (let i = start; i <= end; i++) {
          const name = String(i).padStart(8, '0') + '.dcm';
          batch.push(
            fetch(`${import.meta.env.BASE_URL}sample-data/spine-ct/${name}`)
              .then(r => r.blob())
              .then(blob => new File([blob], name, { type: 'application/dicom' }))
          );
        }
        const batchFiles = await Promise.all(batch);
        files.push(...batchFiles);
        setLoadState({ status: 'loading', step: 'fetching', detail: `Fetched ${files.length}/${totalFiles} files…` });
      }
      await processFiles(files);
    } catch (err) {
      console.error('Sample data loading failed:', err);
      setLoadState({ status: 'error', message: `Failed to load sample data: ${(err as Error).message}` });
    }
  }, [processFiles]);

  // -- Styles --

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: '400px',
    padding: '24px',
    boxSizing: 'border-box',
  };

  const dropZoneStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    width: '100%',
    maxWidth: '640px',
    minHeight: '320px',
    padding: '48px 32px',
    borderRadius: '12px',
    border: isDragOver ? '2px solid #00b4d8' : '2px dashed #3a4a5c',
    backgroundColor: isDragOver ? 'rgba(0, 180, 216, 0.08)' : '#0d1b2a',
    transition: 'border-color 0.2s, background-color 0.2s',
    cursor: 'default',
    textAlign: 'center',
  };

  const iconStyle: React.CSSProperties = {
    fontSize: '48px',
    lineHeight: 1,
    color: '#4cc9f0',
    userSelect: 'none',
  };

  const headingStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '20px',
    fontWeight: 600,
    color: '#e0e0e0',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  };

  const subTextStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '14px',
    color: '#8899aa',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  };

  const buttonRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: '8px',
  };

  const buttonBase: React.CSSProperties = {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    transition: 'background-color 0.15s',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonBase,
    backgroundColor: '#0077b6',
    color: '#ffffff',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonBase,
    backgroundColor: '#1b2838',
    color: '#90caf9',
    border: '1px solid #2a3f55',
  };

  const progressContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    width: '100%',
    maxWidth: '640px',
    padding: '48px 32px',
    borderRadius: '12px',
    border: '2px solid #1b3a4b',
    backgroundColor: '#0d1b2a',
    textAlign: 'center',
  };

  const spinnerStyle: React.CSSProperties = {
    width: '40px',
    height: '40px',
    border: '3px solid #1b3a4b',
    borderTopColor: '#4cc9f0',
    borderRadius: '50%',
    animation: 'dicom-spin 0.8s linear infinite',
  };

  const progressBarOuterStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '300px',
    height: '6px',
    backgroundColor: '#1b3a4b',
    borderRadius: '3px',
    overflow: 'hidden',
  };

  const errorContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    width: '100%',
    maxWidth: '640px',
    padding: '48px 32px',
    borderRadius: '12px',
    border: '2px solid #5c2030',
    backgroundColor: '#1a0a10',
    textAlign: 'center',
  };

  const errorTextStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '14px',
    color: '#ff6b6b',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    maxWidth: '480px',
    wordBreak: 'break-word',
  };

  // -- Render --

  // Inject the keyframe animation for the spinner into the document
  // (only once, guarded by a data attribute check)
  if (typeof document !== 'undefined') {
    if (!document.querySelector('[data-dicom-dropzone-styles]')) {
      const styleTag = document.createElement('style');
      styleTag.setAttribute('data-dicom-dropzone-styles', '');
      styleTag.textContent = `
        @keyframes dicom-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(styleTag);
    }
  }

  // Error state
  if (loadState.status === 'error') {
    return (
      <div style={containerStyle}>
        <div style={errorContainerStyle}>
          <div style={{ fontSize: '40px', lineHeight: 1, userSelect: 'none' }}>
            !
          </div>
          <p style={{ ...headingStyle, color: '#ff6b6b' }}>Loading Failed</p>
          <p style={errorTextStyle}>{loadState.message}</p>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handleReset}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Loading / progress states
  if (loadState.status === 'initializing' || loadState.status === 'loading') {
    const statusText = loadState.status === 'initializing'
      ? 'Initializing Cornerstone3D...'
      : loadState.detail || loadState.step;

    return (
      <div style={containerStyle}>
        <div style={progressContainerStyle}>
          <div style={spinnerStyle} />
          <p style={headingStyle}>{statusText}</p>
          {loadState.status === 'loading' && (
            <p style={{ ...subTextStyle, fontFamily: 'monospace', fontSize: '12px', color: '#6688aa' }}>
              Step: {loadState.step}
            </p>
          )}
          <p style={subTextStyle}>
            Check console or <code style={{ color: '#4cc9f0' }}>window.__spineDebug</code> for details
          </p>
        </div>
      </div>
    );
  }

  // Idle state -- show drop zone
  return (
    <div style={containerStyle}>
      <div
        style={dropZoneStyle}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div style={iconStyle} aria-hidden="true">
          +
        </div>
        <p style={headingStyle}>
          Drop DICOM files or folder here
        </p>
        <p style={subTextStyle}>
          Drag and drop a folder of DICOM images, or use the buttons below
          to select files
        </p>
        <div style={buttonRowStyle}>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => fileInputRef.current?.click()}
          >
            Select Files
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => dirInputRef.current?.click()}
          >
            Select Folder
          </button>
          <button
            type="button"
            style={{ ...secondaryButtonStyle, border: '1px solid #2a5a4a', color: '#70d8b0' }}
            onClick={handleLoadSample}
          >
            Load Sample Data
          </button>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".dcm,.dicom,application/dicom"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
        <input
          ref={dirInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
      </div>
    </div>
  );
}
