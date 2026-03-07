import { useState, useCallback } from 'react';
import { getRenderingEngine } from '@cornerstonejs/core';
import { WindowLevelTool, SplineROITool, annotation } from '@cornerstonejs/tools';
import DicomDropZone from './components/DicomDropZone';
import MPRViewer from './components/MPRViewer';
import ObliqueControls from './components/ObliqueControls';
import VertebraPanel from './components/VertebraPanel';
import ROIPanel from './components/ROIPanel';
import Toolbar from './components/Toolbar';
import MetadataPanel from './components/MetadataPanel';
import { findVertebralBodies, type VertebraResult } from './lib/vertebralFinder';
import {
  createVertebralSegmentation,
  removeVertebralSegmentation,
} from './lib/vertebralSegmentation';
import { computeROIVolume } from './lib/roiVolumeComputer';
import {
  createROISegmentation,
  removeROISegmentation,
} from './lib/roiSegmentation';
import { RENDERING_ENGINE_ID, VIEWPORT_IDS } from './lib/constants';
import { setLabelmapStore } from './lib/labelmapStore';
import type { SeriesMetadata } from './types';
import './index.css';

const ALL_VIEWPORT_IDS = [VIEWPORT_IDS.AXIAL, VIEWPORT_IDS.SAGITTAL, VIEWPORT_IDS.CORONAL, VIEWPORT_IDS.OBLIQUE];

interface LoadedData {
  volumeId: string;
  imageIds: string[];
  metadata: SeriesMetadata;
}

const appContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100vh',
  backgroundColor: '#0a0a0a',
  overflow: 'hidden',
};

const dropZoneContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100vh',
  backgroundColor: '#0a0a0a',
};

const viewerAreaStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  overflow: 'hidden',
  minHeight: 0,
};

const mprContainerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

export default function App() {
  const [loadedData, setLoadedData] = useState<LoadedData | null>(null);
  const [activeTool, setActiveTool] = useState<string>(WindowLevelTool.toolName);
  const [slabThickness, setSlabThickness] = useState<number>(5);
  const [slabMode, setSlabMode] = useState<'none' | 'mip' | 'average' | 'min'>('none');
  const [obliquePlaneNormal, setObliquePlaneNormal] = useState<[number, number, number]>([1, 0, 0]);
  const [obliqueViewUp, setObliqueViewUp] = useState<[number, number, number]>([0, 0, 1]);
  const [obliqueAngles, setObliqueAngles] = useState<{ tilt: number; spin: number; swivel: number }>({
    tilt: 0,
    spin: 0,
    swivel: 0,
  });

  // Vertebral body finder state
  const [vertebrae, setVertebrae] = useState<VertebraResult[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ message: string; percent: number } | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<[number, number, number] | null>(null);

  // ROI contour volume state
  const [isComputingROI, setIsComputingROI] = useState(false);
  const [roiProgress, setROIProgress] = useState<{ message: string; percent: number } | null>(null);
  const [roiResult, setROIResult] = useState<{ volumeCm3: number; voxelCount: number; sliceCount: number } | null>(null);
  const [labelmapData, setLabelmapData] = useState<Uint8Array | null>(null);
  const [show3DSurface, setShow3DSurface] = useState(false);

  const handleAnglesChange = useCallback(
    (angles: { tilt: number; spin: number; swivel: number }) => {
      setObliqueAngles(angles);
    },
    []
  );

  const handleLoaded = useCallback(
    (volumeId: string, imageIds: string[], metadata: SeriesMetadata) => {
      setLoadedData({ volumeId, imageIds, metadata });
    },
    []
  );

  const handleLoadNew = useCallback(() => {
    setLoadedData(null);
    setActiveTool(WindowLevelTool.toolName);
    setSlabThickness(5);
    setSlabMode('none');
    setObliquePlaneNormal([1, 0, 0]);
    setObliqueViewUp([0, 0, 1]);
    setObliqueAngles({ tilt: 0, spin: 0, swivel: 0 });
    setVertebrae([]);
    setNavigationTarget(null);
    setROIResult(null);
    setLabelmapStore(null);
    setLabelmapData(null);
    setShow3DSurface(false);
  }, []);

  const handlePlaneChange = useCallback(
    (normal: [number, number, number], viewUp: [number, number, number]) => {
      setObliquePlaneNormal(normal);
      setObliqueViewUp(viewUp);
    },
    []
  );

  // Callback for trackball rotation on the oblique viewport
  const handleObliqueCameraChange = useCallback(
    (normal: [number, number, number], viewUp: [number, number, number]) => {
      setObliquePlaneNormal(normal);
      setObliqueViewUp(viewUp);
    },
    []
  );

  const handleToolChange = useCallback((toolName: string) => {
    setActiveTool(toolName);
  }, []);

  const handleSlabThicknessChange = useCallback((thickness: number) => {
    setSlabThickness(thickness);
  }, []);

  const handleSlabModeChange = useCallback(
    (mode: 'none' | 'mip' | 'average' | 'min') => {
      setSlabMode(mode);
    },
    []
  );

  // Vertebral body finder callbacks

  const handleRunAnalysis = useCallback(async () => {
    if (!loadedData) return;
    setIsAnalyzing(true);
    try {
      const result = await findVertebralBodies(
        loadedData.volumeId,
        (message, percent) => setAnalysisProgress({ message, percent }),
      );
      setVertebrae(result.vertebrae);

      await createVertebralSegmentation(
        loadedData.volumeId,
        result.labelmapData,
        result.vertebrae,
        ALL_VIEWPORT_IDS,
      );
    } catch (err) {
      console.error('Vertebral analysis failed:', err);
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  }, [loadedData]);

  const handleClearAnalysis = useCallback(() => {
    removeVertebralSegmentation(ALL_VIEWPORT_IDS);
    setVertebrae([]);
    setNavigationTarget(null);
  }, []);

  const handleNavigateToVertebra = useCallback(
    (centroidWorld: [number, number, number]) => {
      // Toggle to force re-trigger even if clicking same vertebra
      setNavigationTarget(null);
      requestAnimationFrame(() => setNavigationTarget(centroidWorld));
    },
    [],
  );

  // ROI contour volume callbacks
  const handleComputeROIVolume = useCallback(async () => {
    if (!loadedData) return;
    setIsComputingROI(true);
    try {
      const result = await computeROIVolume(
        loadedData.volumeId,
        (message, percent) => setROIProgress({ message, percent }),
      );
      setROIResult({
        volumeCm3: result.volumeCm3,
        voxelCount: result.voxelCount,
        sliceCount: result.sliceCount,
      });
      setLabelmapStore(result.labelmapData);
      setLabelmapData(result.labelmapData);

      await createROISegmentation(
        loadedData.volumeId,
        result.labelmapData,
        ALL_VIEWPORT_IDS,
      );
    } catch (err) {
      console.error('ROI volume computation failed:', err);
      alert((err as Error).message || 'ROI volume computation failed');
    } finally {
      setIsComputingROI(false);
      setROIProgress(null);
    }
  }, [loadedData]);

  const handleClearROI = useCallback(() => {
    removeROISegmentation(ALL_VIEWPORT_IDS);
    setROIResult(null);
    setLabelmapStore(null);
    setLabelmapData(null);
    setShow3DSurface(false);

    // Force re-render all viewports to clear stale overlays
    try {
      const engine = getRenderingEngine(RENDERING_ENGINE_ID);
      engine?.renderViewports(ALL_VIEWPORT_IDS);
    } catch {
      // Ignore render errors
    }
  }, []);

  const handleToggle3DSurface = useCallback(() => {
    setShow3DSurface(prev => !prev);
  }, []);

  const handleClearContours = useCallback(() => {
    // Remove all SplineROI annotations (with individual error handling)
    try {
      const allAnnotations = annotation.state.getAllAnnotations();
      const roiAnnotations = allAnnotations.filter(
        (a) => a.metadata?.toolName === SplineROITool.toolName,
      );
      for (const a of roiAnnotations) {
        try {
          annotation.state.removeAnnotation(a.annotationUID);
        } catch {
          // Ignore individual annotation removal failures
        }
      }
    } catch (err) {
      console.warn('[App] Error clearing annotations:', err);
    }

    // Also clear any computed ROI volume
    removeROISegmentation(ALL_VIEWPORT_IDS);
    setROIResult(null);
    setLabelmapStore(null);
    setLabelmapData(null);
    setShow3DSurface(false);

    // Reset tool to WindowLevel so the user re-activates drawing cleanly
    setActiveTool(WindowLevelTool.toolName);

    // Force re-render all viewports to clear stale annotation visuals
    try {
      const engine = getRenderingEngine(RENDERING_ENGINE_ID);
      engine?.renderViewports(ALL_VIEWPORT_IDS);
    } catch {
      // Ignore render errors
    }
  }, []);

  // If no data loaded, show the drop zone
  if (!loadedData) {
    return (
      <div style={dropZoneContainerStyle}>
        <DicomDropZone onLoaded={handleLoaded} />
      </div>
    );
  }

  return (
    <div style={appContainerStyle}>
      {/* Top toolbar */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={handleToolChange}
        slabThickness={slabThickness}
        onSlabThicknessChange={handleSlabThicknessChange}
        slabMode={slabMode}
        onSlabModeChange={handleSlabModeChange}
        onLoadNew={handleLoadNew}
      />

      {/* Main content: MPR viewer + oblique controls */}
      <div style={viewerAreaStyle}>
        <div style={mprContainerStyle}>
          <MPRViewer
            volumeId={loadedData.volumeId}
            imageIds={loadedData.imageIds}
            metadata={loadedData.metadata}
            obliquePlaneNormal={obliquePlaneNormal}
            obliqueViewUp={obliqueViewUp}
            activeTool={activeTool}
            slabThickness={slabThickness}
            slabMode={slabMode}
            navigationTarget={navigationTarget}
            hasLabelmapData={labelmapData !== null}
            show3DSurface={show3DSurface}
            onObliqueCameraChange={handleObliqueCameraChange}
          />
        </div>

        {/* Right panel: oblique controls + vertebra finder */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '280px',
          minWidth: '240px',
          flexShrink: 0,
          borderLeft: '1px solid #1a2a3a',
          overflowY: 'auto',
          backgroundColor: '#0d1520',
        }}>
          <ObliqueControls
            onPlaneChange={handlePlaneChange}
            onAnglesChange={handleAnglesChange}
            actualNormal={obliquePlaneNormal}
            actualViewUp={obliqueViewUp}
          />
          <VertebraPanel
            vertebrae={vertebrae}
            isAnalyzing={isAnalyzing}
            analysisProgress={analysisProgress}
            onNavigate={handleNavigateToVertebra}
            onRunAnalysis={handleRunAnalysis}
            onClearAnalysis={handleClearAnalysis}
          />
          <ROIPanel
            isComputing={isComputingROI}
            computeProgress={roiProgress}
            roiResult={roiResult}
            onComputeVolume={handleComputeROIVolume}
            onClearROI={handleClearROI}
            onClearContours={handleClearContours}
            activeTool={activeTool}
            onToolChange={handleToolChange}
            show3DSurface={show3DSurface}
            onToggle3DSurface={handleToggle3DSurface}
            hasLabelmapData={labelmapData !== null}
          />
        </div>
      </div>

      {/* Metadata panel at the bottom */}
      <MetadataPanel
        metadata={loadedData.metadata}
        obliqueAngles={obliqueAngles}
      />
    </div>
  );
}
