import { useEffect, useRef, useCallback } from 'react';
import {
  RenderingEngine,
  Enums,
  cache,
  type Types,
  setVolumesForViewports,
  getRenderingEngine,
} from '@cornerstonejs/core';
import {
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  ReferenceLinesTool,
  LengthTool,
  SplineROITool,
  Enums as ToolEnums,
  addTool,
  annotation,
} from '@cornerstonejs/tools';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import type { SeriesMetadata } from '../types';
import { RENDERING_ENGINE_ID, TOOLGROUP_ID, VIEWPORT_IDS } from '../lib/constants';
import { getLabelmapStore } from '../lib/labelmapStore';
import { generateSurfaceMeshActor, disposeSurfaceMeshActor } from '../lib/surfaceMeshGenerator';

interface MPRViewerProps {
  volumeId: string;
  imageIds: string[];
  metadata: SeriesMetadata;
  obliquePlaneNormal: [number, number, number];
  obliqueViewUp: [number, number, number];
  activeTool: string;
  slabThickness: number;
  slabMode: 'none' | 'mip' | 'average' | 'min';
  navigationTarget?: [number, number, number] | null;
  hasLabelmapData?: boolean;
  show3DSurface?: boolean;
}

// --- Styles ---

const viewportLabelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  left: 6,
  color: '#a0d0e0',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  zIndex: 10,
  pointerEvents: 'none',
  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
};

const syncButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 3,
  right: 4,
  zIndex: 10,
  padding: '1px 5px',
  fontSize: '10px',
  fontWeight: 600,
  borderRadius: '3px',
  border: '1px solid #2a3f55',
  backgroundColor: 'rgba(19, 29, 43, 0.85)',
  color: '#6b8aaa',
  cursor: 'pointer',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  transition: 'all 0.15s',
  lineHeight: '1.4',
};

const smallViewportCellStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  backgroundColor: '#000',
  border: '1px solid #1a2a3a',
  overflow: 'hidden',
};

const obliqueCellStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  backgroundColor: '#000',
  border: '2px solid #4cc9f0',
  overflow: 'hidden',
};

// --- Tool registration ---

let toolsRegistered = false;

function registerToolsOnce() {
  if (toolsRegistered) return;
  const tools = [WindowLevelTool, PanTool, ZoomTool, StackScrollTool, ReferenceLinesTool, LengthTool, SplineROITool];
  for (const tool of tools) {
    try {
      addTool(tool);
    } catch (err) {
      console.debug(`[MPRViewer] Tool ${tool.toolName} already registered:`, (err as Error).message);
    }
  }
  toolsRegistered = true;
}

// --- Component ---

export default function MPRViewer({
  volumeId,
  imageIds: _imageIds,
  metadata: _metadata,
  obliquePlaneNormal,
  obliqueViewUp,
  activeTool,
  slabThickness,
  slabMode,
  navigationTarget,
  hasLabelmapData,
  show3DSurface,
}: MPRViewerProps) {
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const obliqueRef = useRef<HTMLDivElement>(null);
  const volume3DRef = useRef<HTMLDivElement>(null);

  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const toolGroupRef = useRef<ReturnType<typeof ToolGroupManager.createToolGroup> | undefined>(undefined);
  const surfaceActorRef = useRef<ReturnType<typeof generateSurfaceMeshActor> | null>(null);
  const vtkRenderRef = useRef<ReturnType<typeof vtkGenericRenderWindow.newInstance> | null>(null);
  const surfaceVersionRef = useRef(0);
  const isSetupRef = useRef(false);

  // Setup rendering engine and viewports
  useEffect(() => {
    if (isSetupRef.current) return;
    if (
      !axialRef.current ||
      !sagittalRef.current ||
      !coronalRef.current ||
      !obliqueRef.current
    ) {
      return;
    }

    isSetupRef.current = true;

    registerToolsOnce();

    let renderingEngine = getRenderingEngine(RENDERING_ENGINE_ID) as RenderingEngine | undefined;
    if (!renderingEngine) {
      renderingEngine = new RenderingEngine(RENDERING_ENGINE_ID);
    }
    renderingEngineRef.current = renderingEngine;

    const viewportInputArray: Types.PublicViewportInput[] = [
      {
        viewportId: VIEWPORT_IDS.AXIAL,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: axialRef.current!,
        defaultOptions: {
          orientation: Enums.OrientationAxis.AXIAL,
        },
      },
      {
        viewportId: VIEWPORT_IDS.SAGITTAL,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: sagittalRef.current!,
        defaultOptions: {
          orientation: Enums.OrientationAxis.SAGITTAL,
        },
      },
      {
        viewportId: VIEWPORT_IDS.CORONAL,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: coronalRef.current!,
        defaultOptions: {
          orientation: Enums.OrientationAxis.CORONAL,
        },
      },
      {
        viewportId: VIEWPORT_IDS.OBLIQUE,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: obliqueRef.current!,
        defaultOptions: {
          orientation: {
            viewPlaneNormal: obliquePlaneNormal as Types.Point3,
            viewUp: obliqueViewUp as Types.Point3,
          },
        },
      },
    ];

    renderingEngine.setViewports(viewportInputArray);

    // Create tool group
    let toolGroup = ToolGroupManager.getToolGroup(TOOLGROUP_ID);
    if (toolGroup) {
      ToolGroupManager.destroyToolGroup(TOOLGROUP_ID);
    }
    toolGroup = ToolGroupManager.createToolGroup(TOOLGROUP_ID)!;
    toolGroupRef.current = toolGroup;

    // Add tools to the group
    toolGroup.addTool(WindowLevelTool.toolName);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName, {
      configuration: {
        invert: false,
        minZoomScale: 0.1,
        maxZoomScale: 30,
        zoomToCenter: false,
      },
    });
    toolGroup.addTool(StackScrollTool.toolName);
    toolGroup.addTool(ReferenceLinesTool.toolName);
    toolGroup.addTool(LengthTool.toolName);
    toolGroup.addTool(SplineROITool.toolName, {
      configuration: {
        splineType: SplineROITool.SplineTypes.Linear,
      },
    });

    // Default bindings
    toolGroup.setToolActive(WindowLevelTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
    });
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
    });
    toolGroup.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
    });
    toolGroup.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
    });
    toolGroup.setToolPassive(LengthTool.toolName);
    toolGroup.setToolPassive(SplineROITool.toolName);

    // Configure ReferenceLines: oblique viewport is the source,
    // so the 3 small viewports show where the oblique slice intersects
    toolGroup.setToolConfiguration(ReferenceLinesTool.toolName, {
      sourceViewportId: VIEWPORT_IDS.OBLIQUE,
      showFullDimension: true,
    });
    toolGroup.setToolEnabled(ReferenceLinesTool.toolName);

    // Add all 2D viewports to the tool group
    toolGroup.addViewport(VIEWPORT_IDS.AXIAL, RENDERING_ENGINE_ID);
    toolGroup.addViewport(VIEWPORT_IDS.SAGITTAL, RENDERING_ENGINE_ID);
    toolGroup.addViewport(VIEWPORT_IDS.CORONAL, RENDERING_ENGINE_ID);
    toolGroup.addViewport(VIEWPORT_IDS.OBLIQUE, RENDERING_ENGINE_ID);

    // Set volumes on each 2D viewport
    setVolumesForViewports(
      renderingEngine,
      [{ volumeId }],
      [VIEWPORT_IDS.AXIAL, VIEWPORT_IDS.SAGITTAL, VIEWPORT_IDS.CORONAL, VIEWPORT_IDS.OBLIQUE]
    ).then(() => {
      renderingEngine.renderViewports([
        VIEWPORT_IDS.AXIAL, VIEWPORT_IDS.SAGITTAL, VIEWPORT_IDS.CORONAL, VIEWPORT_IDS.OBLIQUE,
      ]);

      // Delayed resize to fix canvas sizing race condition
      setTimeout(() => {
        renderingEngine.resize(true, true);
        renderingEngine.render();
      }, 200);
    });

    return () => {
      isSetupRef.current = false;
      renderingEngineRef.current = null;
      toolGroupRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeId]);

  // Update oblique viewport camera when plane normal or viewUp changes
  useEffect(() => {
    const engine = renderingEngineRef.current;
    if (!engine) return;

    const obliqueViewport = engine.getViewport(VIEWPORT_IDS.OBLIQUE);
    if (!obliqueViewport) return;

    try {
      obliqueViewport.setCamera({
        viewPlaneNormal: obliquePlaneNormal as Types.Point3,
        viewUp: obliqueViewUp as Types.Point3,
      });
      obliqueViewport.render();
    } catch (err) {
      console.error('[MPRViewer] Error updating oblique camera:', err);
    }
  }, [obliquePlaneNormal, obliqueViewUp]);

  // Update active tool
  useEffect(() => {
    const toolGroup = toolGroupRef.current;
    if (!toolGroup) return;

    const switchableTools = [
      WindowLevelTool.toolName,
      PanTool.toolName,
      ZoomTool.toolName,
      LengthTool.toolName,
      SplineROITool.toolName,
    ];

    // Clear all bindings first
    for (const toolName of switchableTools) {
      try {
        toolGroup.setToolPassive(toolName, { removeAllBindings: true });
      } catch (err) {
        console.debug(`[MPRViewer] Error clearing bindings for ${toolName}:`, err);
      }
    }

    // Selected tool on left click
    try {
      toolGroup.setToolActive(activeTool, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
    } catch (err) {
      console.error(`[MPRViewer] Error activating ${activeTool}:`, err);
    }

    // Pan always on middle click
    try {
      toolGroup.setToolActive(PanTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
      });
    } catch (err) {
      console.debug('[MPRViewer] Error setting Pan on middle click:', err);
    }

    // Zoom always on right click
    try {
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
      });
    } catch (err) {
      console.debug('[MPRViewer] Error setting Zoom on right click:', err);
    }
  }, [activeTool]);

  // Update slab thickness and mode on oblique viewport
  useEffect(() => {
    const engine = renderingEngineRef.current;
    if (!engine) return;

    const obliqueViewport = engine.getViewport(VIEWPORT_IDS.OBLIQUE) as Types.IVolumeViewport;
    if (!obliqueViewport) return;

    try {
      if (slabMode === 'none') {
        obliqueViewport.setBlendMode(Enums.BlendModes.COMPOSITE);
        obliqueViewport.setSlabThickness(0.5);
      } else {
        const blendModeMap: Record<string, Enums.BlendModes> = {
          mip: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
          average: Enums.BlendModes.AVERAGE_INTENSITY_BLEND,
          min: Enums.BlendModes.MINIMUM_INTENSITY_BLEND,
        };
        obliqueViewport.setBlendMode(blendModeMap[slabMode] ?? Enums.BlendModes.COMPOSITE);
        obliqueViewport.setSlabThickness(slabThickness);
      }
      obliqueViewport.render();
    } catch (err) {
      console.error('[MPRViewer] Error updating slab settings:', err);
    }
  }, [slabThickness, slabMode]);

  // Standalone VTK.js 3D surface rendering (bypasses Cornerstone's offscreen pipeline)
  // Uses a version-counter ref so React StrictMode / re-renders don't
  // create multiple WebGL contexts (browser limit is ~8-16).
  // The ref persists across StrictMode unmount/remount cycles, so only
  // the LAST invocation's deferred callback will actually proceed.
  useEffect(() => {
    const container = volume3DRef.current;
    if (!container) return;

    // Helper to clean up VTK resources
    const cleanupVTK = () => {
      if (vtkRenderRef.current) {
        try { vtkRenderRef.current.delete(); } catch { /* ignore */ }
        vtkRenderRef.current = null;
      }
      if (surfaceActorRef.current) {
        disposeSurfaceMeshActor(surfaceActorRef.current);
        surfaceActorRef.current = null;
      }
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };

    // Clean up any existing VTK rendering first
    cleanupVTK();

    if (!show3DSurface || !hasLabelmapData) return;

    // Bump the version counter — only the callback whose captured version
    // matches the current ref value will proceed. Earlier invocations
    // (from StrictMode double-fire or rapid re-renders) become no-ops.
    surfaceVersionRef.current++;
    const myVersion = surfaceVersionRef.current;

    const timerId = setTimeout(() => {
      // Stale invocation — a newer effect has already started
      if (surfaceVersionRef.current !== myVersion) return;

      const labelmapData = getLabelmapStore();
      if (!labelmapData || !volume3DRef.current) return;

      const volume = cache.getVolume(volumeId);
      if (!volume) return;

      try {
        // Generate surface mesh actor (runs marching cubes — ~1-7s)
        const actor = generateSurfaceMeshActor({
          labelmapData,
          dimensions: volume.dimensions as [number, number, number],
          spacing: volume.spacing as [number, number, number],
          origin: volume.origin as [number, number, number],
          direction: Array.from(volume.direction),
        });

        // Check again after the heavy computation
        if (surfaceVersionRef.current !== myVersion) {
          disposeSurfaceMeshActor(actor);
          return;
        }
        surfaceActorRef.current = actor;

        // Create standalone VTK.js rendering pipeline (1 WebGL context)
        const grw = vtkGenericRenderWindow.newInstance({
          background: [0.04, 0.06, 0.08, 1.0],
        });
        grw.setContainer(container);
        grw.resize();

        const renderer = grw.getRenderer();
        const renderWindow = grw.getRenderWindow();

        // Set up trackball camera interaction
        const interactor = renderWindow.getInteractor();
        const trackballStyle = vtkInteractorStyleTrackballCamera.newInstance();
        interactor.setInteractorStyle(trackballStyle);

        // Add the surface mesh actor
        renderer.addActor(actor);
        renderer.resetCamera();

        // Adjust camera to view from an elevated angle (avoids edge-on
        // invisibility for thin/single-slice labelmaps)
        const cam = renderer.getActiveCamera();
        const fp = cam.getFocalPoint();
        const pos = cam.getPosition();
        const dist = Math.sqrt(
          (pos[0] - fp[0]) ** 2 + (pos[1] - fp[1]) ** 2 + (pos[2] - fp[2]) ** 2,
        );
        cam.setPosition(
          fp[0] + dist * 0.65,
          fp[1] - dist * 0.45,
          fp[2] + dist * 0.55,
        );
        cam.setViewUp(0, 0, 1);
        renderer.resetCameraClippingRange();
        renderWindow.render();

        vtkRenderRef.current = grw;
      } catch (err) {
        console.error('[MPRViewer] Failed to create 3D surface:', err);
      }
    }, 0);

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      if (vtkRenderRef.current) {
        vtkRenderRef.current.resize();
      }
    });
    resizeObserver.observe(container);

    return () => {
      clearTimeout(timerId);
      resizeObserver.disconnect();
      cleanupVTK();
    };
  }, [show3DSurface, hasLabelmapData, volumeId]);

  // Navigate oblique viewport to a world-space point (e.g., when user clicks a vertebra)
  useEffect(() => {
    if (!navigationTarget) return;
    const engine = renderingEngineRef.current;
    if (!engine) return;

    const obliqueVp = engine.getViewport(VIEWPORT_IDS.OBLIQUE);
    if (!obliqueVp) return;

    const camera = obliqueVp.getCamera();
    const { viewPlaneNormal, focalPoint, position } = camera;
    if (!viewPlaneNormal || !focalPoint || !position) return;

    // Project the target point onto the view plane normal to compute the offset
    const targetDist =
      navigationTarget[0] * viewPlaneNormal[0] +
      navigationTarget[1] * viewPlaneNormal[1] +
      navigationTarget[2] * viewPlaneNormal[2];
    const currentDist =
      focalPoint[0] * viewPlaneNormal[0] +
      focalPoint[1] * viewPlaneNormal[1] +
      focalPoint[2] * viewPlaneNormal[2];
    const delta = targetDist - currentDist;

    const newFocalPoint: Types.Point3 = [
      focalPoint[0] + viewPlaneNormal[0] * delta,
      focalPoint[1] + viewPlaneNormal[1] * delta,
      focalPoint[2] + viewPlaneNormal[2] * delta,
    ];
    const newPosition: Types.Point3 = [
      position[0] + viewPlaneNormal[0] * delta,
      position[1] + viewPlaneNormal[1] * delta,
      position[2] + viewPlaneNormal[2] * delta,
    ];

    obliqueVp.setCamera({ focalPoint: newFocalPoint, position: newPosition });
    obliqueVp.render();

    // Re-render small viewports to update reference lines
    engine.renderViewports([
      VIEWPORT_IDS.AXIAL,
      VIEWPORT_IDS.SAGITTAL,
      VIEWPORT_IDS.CORONAL,
    ]);
  }, [navigationTarget]);

  // Sync a small viewport's camera to match the oblique viewport
  const handleSync = useCallback((viewportId: string) => {
    const engine = renderingEngineRef.current;
    if (!engine) return;

    const obliqueVp = engine.getViewport(VIEWPORT_IDS.OBLIQUE);
    const targetVp = engine.getViewport(viewportId);
    if (!obliqueVp || !targetVp) return;

    const camera = obliqueVp.getCamera();
    targetVp.setCamera({
      viewPlaneNormal: camera.viewPlaneNormal,
      viewUp: camera.viewUp,
    });
    targetVp.render();
  }, []);

  // Keyboard shortcuts: Arrow keys for slice scroll, Delete/Backspace to remove annotations, Escape to clear all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete/Backspace: remove selected annotation (or last one if none selected)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't intercept if user is typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        e.preventDefault();
        const selected = annotation.selection.getAnnotationsSelected();
        if (selected && selected.length > 0) {
          for (const uid of selected) {
            annotation.state.removeAnnotation(uid);
          }
        } else {
          // No selection — remove the most recent Length annotation
          const allAnnotations = annotation.state.getAllAnnotations();
          const lengthAnnotations = allAnnotations.filter(
            (a) => a.metadata?.toolName === LengthTool.toolName
          );
          if (lengthAnnotations.length > 0) {
            const last = lengthAnnotations[lengthAnnotations.length - 1];
            annotation.state.removeAnnotation(last.annotationUID);
          }
        }
        // Re-render all viewports to clear the removed annotation visually
        renderingEngineRef.current?.renderViewports([
          VIEWPORT_IDS.AXIAL, VIEWPORT_IDS.SAGITTAL, VIEWPORT_IDS.CORONAL, VIEWPORT_IDS.OBLIQUE,
        ]);
        return;
      }

      // Escape: clear ALL length annotations
      if (e.key === 'Escape') {
        const allAnnotations = annotation.state.getAllAnnotations();
        const lengthAnnotations = allAnnotations.filter(
          (a) => a.metadata?.toolName === LengthTool.toolName
        );
        for (const a of lengthAnnotations) {
          annotation.state.removeAnnotation(a.annotationUID);
        }
        renderingEngineRef.current?.renderViewports([
          VIEWPORT_IDS.AXIAL, VIEWPORT_IDS.SAGITTAL, VIEWPORT_IDS.CORONAL, VIEWPORT_IDS.OBLIQUE,
        ]);
        return;
      }

      // Arrow keys: slice scrolling on oblique viewport
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const engine = renderingEngineRef.current;
      if (!engine) return;

      const obliqueVp = engine.getViewport(VIEWPORT_IDS.OBLIQUE) as Types.IVolumeViewport;
      if (!obliqueVp) return;

      e.preventDefault();

      const delta = e.key === 'ArrowDown' ? 1 : -1;

      // Move the camera focal point along the view plane normal
      const camera = obliqueVp.getCamera();
      const { viewPlaneNormal, focalPoint, position } = camera;
      if (!viewPlaneNormal || !focalPoint || !position) return;

      // Use the volume's spacing to determine step size
      const volume = cache.getVolume(volumeId);
      if (!volume) return;
      const spacing = volume.spacing;
      // Average spacing as step size (works for any oblique angle)
      const avgSpacing = (spacing[0] + spacing[1] + spacing[2]) / 3;
      const step = avgSpacing;

      const newFocalPoint: Types.Point3 = [
        focalPoint[0] + viewPlaneNormal[0] * step * delta,
        focalPoint[1] + viewPlaneNormal[1] * step * delta,
        focalPoint[2] + viewPlaneNormal[2] * step * delta,
      ];
      const newPosition: Types.Point3 = [
        position[0] + viewPlaneNormal[0] * step * delta,
        position[1] + viewPlaneNormal[1] * step * delta,
        position[2] + viewPlaneNormal[2] * step * delta,
      ];

      obliqueVp.setCamera({
        focalPoint: newFocalPoint,
        position: newPosition,
      });
      obliqueVp.render();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [volumeId]);

  // --- Layout ---

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      width: '100%',
      height: '100%',
      gap: '2px',
      backgroundColor: '#0a0a0a',
    }}>
      {/* Large principal viewport — Oblique */}
      <div style={obliqueCellStyle}>
        <div style={{
          ...viewportLabelStyle,
          color: '#4cc9f0',
          fontSize: '12px',
          top: 8,
          left: 10,
        }}>
          OBLIQUE - Cage Aligned
        </div>
        <div ref={obliqueRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Small viewports stacked vertically */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '220px',
        minWidth: '180px',
        gap: '2px',
        flexShrink: 0,
      }}>
        {/* Axial */}
        <div style={smallViewportCellStyle}>
          <div style={viewportLabelStyle}>AXIAL</div>
          <button
            type="button"
            title="Sync to oblique view"
            style={syncButtonStyle}
            onClick={() => handleSync(VIEWPORT_IDS.AXIAL)}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(76, 201, 240, 0.2)';
              e.currentTarget.style.borderColor = '#4cc9f0';
              e.currentTarget.style.color = '#4cc9f0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(19, 29, 43, 0.85)';
              e.currentTarget.style.borderColor = '#2a3f55';
              e.currentTarget.style.color = '#6b8aaa';
            }}
          >
            SYNC
          </button>
          <div ref={axialRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Sagittal */}
        <div style={smallViewportCellStyle}>
          <div style={viewportLabelStyle}>SAGITTAL</div>
          <button
            type="button"
            title="Sync to oblique view"
            style={syncButtonStyle}
            onClick={() => handleSync(VIEWPORT_IDS.SAGITTAL)}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(76, 201, 240, 0.2)';
              e.currentTarget.style.borderColor = '#4cc9f0';
              e.currentTarget.style.color = '#4cc9f0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(19, 29, 43, 0.85)';
              e.currentTarget.style.borderColor = '#2a3f55';
              e.currentTarget.style.color = '#6b8aaa';
            }}
          >
            SYNC
          </button>
          <div ref={sagittalRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Coronal */}
        <div style={smallViewportCellStyle}>
          <div style={viewportLabelStyle}>CORONAL</div>
          <button
            type="button"
            title="Sync to oblique view"
            style={syncButtonStyle}
            onClick={() => handleSync(VIEWPORT_IDS.CORONAL)}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(76, 201, 240, 0.2)';
              e.currentTarget.style.borderColor = '#4cc9f0';
              e.currentTarget.style.color = '#4cc9f0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(19, 29, 43, 0.85)';
              e.currentTarget.style.borderColor = '#2a3f55';
              e.currentTarget.style.color = '#6b8aaa';
            }}
          >
            SYNC
          </button>
          <div ref={coronalRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* 3D Surface Viewport */}
        <div style={{
          ...smallViewportCellStyle,
          border: show3DSurface ? '1px solid #00b8c9' : '1px solid #1a2a3a',
        }}>
          <div style={{
            ...viewportLabelStyle,
            color: '#00b8c9',
          }}>3D SURFACE</div>
          <div ref={volume3DRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
    </div>
  );
}
