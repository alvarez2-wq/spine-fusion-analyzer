/**
 * ROIPanel — UI panel for drawing contour ROIs across slices
 * and computing / displaying the enclosed 3D volume.
 */

import { useState, useEffect } from 'react';
import { SplineROITool, annotation } from '@cornerstonejs/tools';

interface ROIPanelProps {
  isComputing: boolean;
  computeProgress: { message: string; percent: number } | null;
  roiResult: { volumeCm3: number; voxelCount: number; sliceCount: number } | null;
  onComputeVolume: () => void;
  onClearROI: () => void;
  onClearContours: () => void;
  activeTool: string;
  onToolChange: (toolName: string) => void;
  show3DSurface: boolean;
  onToggle3DSurface: () => void;
  hasLabelmapData: boolean;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  padding: '12px 10px',
  borderTop: '1px solid #1a2a3a',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#b0c4d8',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '10px',
};

const buttonStyle = (
  variant: 'primary' | 'secondary' | 'danger' | 'active',
): React.CSSProperties => {
  const base: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: 600,
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    transition: 'all 0.15s',
    width: '100%',
    letterSpacing: '0.02em',
  };
  switch (variant) {
    case 'primary':
      return {
        ...base,
        border: '1px solid #2a5a4a',
        backgroundColor: '#1a3a30',
        color: '#70d8b0',
      };
    case 'active':
      return {
        ...base,
        border: '1px solid #4cc9f0',
        backgroundColor: '#1a3040',
        color: '#4cc9f0',
      };
    case 'secondary':
      return {
        ...base,
        border: '1px solid #2a3f55',
        backgroundColor: '#131d2b',
        color: '#8899aa',
      };
    case 'danger':
      return {
        ...base,
        border: '1px solid #5c3030',
        backgroundColor: '#2a1020',
        color: '#ff8a8a',
      };
  }
};

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 0',
  fontSize: '11px',
  color: '#8899aa',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
};

const valueStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#4cc9f0',
  fontVariantNumeric: 'tabular-nums',
};

const progressBarStyle: React.CSSProperties = {
  width: '100%',
  height: '4px',
  backgroundColor: '#1a2a3a',
  borderRadius: '2px',
  overflow: 'hidden',
  marginTop: '6px',
};

const hintStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#556677',
  marginTop: '6px',
  lineHeight: '1.4',
  fontStyle: 'italic',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function getROIAnnotationCount(): number {
  try {
    const all = annotation.state.getAllAnnotations();
    return all.filter(a => a.metadata?.toolName === SplineROITool.toolName).length;
  } catch {
    return 0;
  }
}

export default function ROIPanel({
  isComputing,
  computeProgress,
  roiResult,
  onComputeVolume,
  onClearROI,
  onClearContours,
  activeTool,
  onToolChange,
  show3DSurface,
  onToggle3DSurface,
  hasLabelmapData,
}: ROIPanelProps) {
  // Poll annotation count every second when ROI tool is active
  const [contourCount, setContourCount] = useState(0);
  useEffect(() => {
    setContourCount(getROIAnnotationCount());
    const interval = setInterval(() => {
      setContourCount(getROIAnnotationCount());
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTool, roiResult]);

  const isROIActive = activeTool === SplineROITool.toolName;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>ROI Volume</div>

      {/* Draw mode toggle */}
      <button
        type="button"
        style={buttonStyle(isROIActive ? 'active' : 'secondary')}
        onClick={() =>
          onToolChange(isROIActive ? 'WindowLevel' : SplineROITool.toolName)
        }
      >
        {isROIActive ? '~ Drawing Contours ~' : 'Draw Contours'}
      </button>

      {isROIActive && (
        <div style={hintStyle}>
          Click to place points. Double-click to close contour.
          Use arrow keys to move to next slice and draw another contour.
        </div>
      )}

      {/* Contour count */}
      <div style={{ ...infoRowStyle, marginTop: '8px' }}>
        <span>Contours drawn</span>
        <span style={valueStyle}>{contourCount}</span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
        {/* Compute volume button */}
        <button
          type="button"
          style={buttonStyle(contourCount > 0 && !isComputing ? 'primary' : 'secondary')}
          onClick={onComputeVolume}
          disabled={contourCount === 0 || isComputing}
        >
          {isComputing ? 'Computing…' : 'Compute Volume'}
        </button>

        {/* Progress bar */}
        {isComputing && computeProgress && (
          <div>
            <div style={{ fontSize: '10px', color: '#6688aa', marginBottom: '3px' }}>
              {computeProgress.message}
            </div>
            <div style={progressBarStyle}>
              <div
                style={{
                  width: `${computeProgress.percent}%`,
                  height: '100%',
                  backgroundColor: '#70d8b0',
                  borderRadius: '2px',
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
        )}

        {/* Results */}
        {roiResult && (
          <div style={{
            padding: '8px',
            borderRadius: '4px',
            backgroundColor: '#0f1f2f',
            border: '1px solid #1a3a4a',
            marginTop: '4px',
          }}>
            <div style={infoRowStyle}>
              <span>Volume</span>
              <span style={{ ...valueStyle, color: '#70d8b0', fontSize: '13px' }}>
                {roiResult.volumeCm3.toFixed(2)} cm³
              </span>
            </div>
            <div style={infoRowStyle}>
              <span>Voxels</span>
              <span style={valueStyle}>{roiResult.voxelCount.toLocaleString()}</span>
            </div>
            <div style={infoRowStyle}>
              <span>Slices</span>
              <span style={valueStyle}>{roiResult.sliceCount}</span>
            </div>
          </div>
        )}

        {/* 3D Surface toggle */}
        {hasLabelmapData && (
          <button
            type="button"
            style={buttonStyle(show3DSurface ? 'active' : 'secondary')}
            onClick={onToggle3DSurface}
          >
            {show3DSurface ? '~ 3D Surface ON ~' : 'Show 3D Surface'}
          </button>
        )}

        {/* Clear buttons */}
        {(contourCount > 0 || roiResult) && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            {contourCount > 0 && (
              <button
                type="button"
                style={{ ...buttonStyle('danger'), flex: 1 }}
                onClick={onClearContours}
              >
                Clear Contours
              </button>
            )}
            {roiResult && (
              <button
                type="button"
                style={{ ...buttonStyle('danger'), flex: 1 }}
                onClick={onClearROI}
              >
                Clear Volume
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
