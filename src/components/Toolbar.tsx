import { useCallback } from 'react';
import {
  WindowLevelTool,
  PanTool,
  ZoomTool,
  LengthTool,
  SplineROITool,
} from '@cornerstonejs/tools';

interface ToolbarProps {
  activeTool: string;
  onToolChange: (toolName: string) => void;
  slabThickness: number;
  onSlabThicknessChange: (thickness: number) => void;
  slabMode: 'none' | 'mip' | 'average' | 'min';
  onSlabModeChange: (mode: 'none' | 'mip' | 'average' | 'min') => void;
  onLoadNew: () => void;
}

interface ToolDef {
  name: string;
  label: string;
  icon: string;
}

const TOOLS: ToolDef[] = [
  { name: WindowLevelTool.toolName, label: 'W/L', icon: 'WL' },
  { name: PanTool.toolName, label: 'Pan', icon: 'PAN' },
  { name: ZoomTool.toolName, label: 'Zoom', icon: 'ZM' },
  { name: LengthTool.toolName, label: 'Length', icon: 'LEN' },
  { name: SplineROITool.toolName, label: 'ROI Contour', icon: 'ROI' },
];

const SLAB_MODES: { value: 'none' | 'mip' | 'average' | 'min'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'mip', label: 'MIP' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Min' },
];

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  backgroundColor: '#0d1117',
  borderBottom: '1px solid #1a2a3a',
  height: '44px',
  flexShrink: 0,
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  overflow: 'hidden',
};

const sectionDividerStyle: React.CSSProperties = {
  width: '1px',
  height: '24px',
  backgroundColor: '#2a3a4a',
  flexShrink: 0,
};

const toolButtonStyle = (isActive: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '4px',
  border: isActive ? '1px solid #4cc9f0' : '1px solid #2a3f55',
  backgroundColor: isActive ? '#1a3040' : '#131d2b',
  color: isActive ? '#4cc9f0' : '#8899aa',
  cursor: 'pointer',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  transition: 'all 0.12s',
  whiteSpace: 'nowrap',
  letterSpacing: '0.03em',
});

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#6b8aaa',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const slabSliderStyle: React.CSSProperties = {
  width: '80px',
  height: '4px',
  cursor: 'pointer',
  accentColor: '#4cc9f0',
};

const slabValueStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#4cc9f0',
  fontWeight: 600,
  minWidth: '42px',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const selectStyle: React.CSSProperties = {
  padding: '3px 6px',
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '4px',
  border: '1px solid #2a3f55',
  backgroundColor: '#131d2b',
  color: '#90caf9',
  cursor: 'pointer',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  outline: 'none',
};

const loadNewButtonStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '4px',
  border: '1px solid #5c3030',
  backgroundColor: '#2a1020',
  color: '#ff8a8a',
  cursor: 'pointer',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  transition: 'background-color 0.15s',
  whiteSpace: 'nowrap',
  marginLeft: 'auto',
};

export default function Toolbar({
  activeTool,
  onToolChange,
  slabThickness,
  onSlabThicknessChange,
  slabMode,
  onSlabModeChange,
  onLoadNew,
}: ToolbarProps) {
  const handleSlabThickness = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSlabThicknessChange(parseFloat(e.target.value));
    },
    [onSlabThicknessChange]
  );

  const handleSlabMode = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onSlabModeChange(e.target.value as 'none' | 'mip' | 'average' | 'min');
    },
    [onSlabModeChange]
  );

  return (
    <div style={toolbarStyle}>
      {/* Tool selector */}
      <span style={labelStyle}>Tools</span>
      {TOOLS.map((tool) => (
        <button
          key={tool.name}
          type="button"
          style={toolButtonStyle(activeTool === tool.name)}
          onClick={() => onToolChange(tool.name)}
          title={tool.label}
        >
          {tool.icon}
        </button>
      ))}

      <div style={sectionDividerStyle} />

      {/* Slab mode selector */}
      <span style={labelStyle}>Slab</span>
      <select
        style={selectStyle}
        value={slabMode}
        onChange={handleSlabMode}
      >
        {SLAB_MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </select>

      {/* Slab thickness slider (visible only when slab mode is not 'none') */}
      {slabMode !== 'none' && (
        <>
          <input
            type="range"
            min={0.5}
            max={20}
            step={0.5}
            value={slabThickness}
            onChange={handleSlabThickness}
            style={slabSliderStyle}
            title={`Slab thickness: ${slabThickness.toFixed(1)} mm`}
          />
          <span style={slabValueStyle}>{slabThickness.toFixed(1)} mm</span>
        </>
      )}

      {/* Load New button pushed to the right */}
      <button
        type="button"
        style={loadNewButtonStyle}
        onClick={onLoadNew}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#3a1525';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2a1020';
        }}
      >
        Load New
      </button>
    </div>
  );
}
