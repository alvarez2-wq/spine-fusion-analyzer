import { useState, useCallback } from 'react';
import type { SeriesMetadata } from '../types';

interface MetadataPanelProps {
  metadata: SeriesMetadata;
  obliqueAngles: { tilt: number; spin: number; swivel: number };
}

const panelStyle = (collapsed: boolean): React.CSSProperties => ({
  backgroundColor: '#0d1117',
  borderTop: '1px solid #1a2a3a',
  padding: collapsed ? '0' : '0',
  flexShrink: 0,
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  overflow: 'hidden',
  transition: 'max-height 0.2s ease-out',
  maxHeight: collapsed ? '32px' : '200px',
});

const toggleBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  cursor: 'pointer',
  userSelect: 'none',
};

const toggleLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#6b8aaa',
};

const toggleArrowStyle = (collapsed: boolean): React.CSSProperties => ({
  fontSize: '10px',
  color: '#6b8aaa',
  transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
  transition: 'transform 0.2s',
});

const contentStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '4px 24px',
  padding: '0 12px 10px 12px',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '2px 0',
  fontSize: '11px',
  borderBottom: '1px solid #0f1822',
};

const fieldLabelStyle: React.CSSProperties = {
  color: '#5a7a9a',
  fontWeight: 500,
};

const fieldValueStyle: React.CSSProperties = {
  color: '#c0d0e0',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  maxWidth: '160px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export default function MetadataPanel({
  metadata,
  obliqueAngles,
}: MetadataPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const fields: { label: string; value: string }[] = [
    { label: 'Patient', value: metadata.patientName || 'Unknown' },
    { label: 'Study', value: metadata.studyDescription || 'N/A' },
    { label: 'Series', value: metadata.seriesDescription || 'N/A' },
    {
      label: 'Dimensions',
      value: `${metadata.columns} x ${metadata.rows} x ${metadata.numberOfSlices}`,
    },
    {
      label: 'Pixel Spacing',
      value: `${metadata.pixelSpacing[0].toFixed(2)} x ${metadata.pixelSpacing[1].toFixed(2)} mm`,
    },
    {
      label: 'Slice Thickness',
      value: `${metadata.sliceThickness.toFixed(2)} mm`,
    },
    {
      label: 'Oblique Tilt',
      value: `${obliqueAngles.tilt.toFixed(1)}\u00B0`,
    },
    {
      label: 'Oblique Spin',
      value: `${obliqueAngles.spin.toFixed(1)}\u00B0`,
    },
    {
      label: 'Oblique Swivel',
      value: `${obliqueAngles.swivel.toFixed(1)}\u00B0`,
    },
  ];

  return (
    <div style={panelStyle(collapsed)}>
      <div style={toggleBarStyle} onClick={toggle}>
        <span style={toggleLabelStyle}>Metadata</span>
        <span style={toggleArrowStyle(collapsed)}>&#9650;</span>
      </div>
      {!collapsed && (
        <div style={contentStyle}>
          {fields.map((field) => (
            <div key={field.label} style={fieldStyle}>
              <span style={fieldLabelStyle}>{field.label}</span>
              <span style={fieldValueStyle} title={field.value}>
                {field.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
