import { useState, useCallback, useEffect, useRef } from 'react';

interface ObliqueControlsProps {
  onPlaneChange: (
    normal: [number, number, number],
    viewUp: [number, number, number]
  ) => void;
  onAnglesChange?: (angles: { tilt: number; spin: number; swivel: number }) => void;
  /** Actual camera vectors (from trackball or other external source) for display */
  actualNormal?: [number, number, number];
  actualViewUp?: [number, number, number];
}

/**
 * Degree-to-radian conversion.
 */
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Rotation matrix around the X axis (tilt / pitch).
 * Multiplies a 3-element vector.
 */
function rotateX(v: [number, number, number], angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    v[0],
    v[1] * c - v[2] * s,
    v[1] * s + v[2] * c,
  ];
}

/**
 * Rotation matrix around the Y axis (swivel / yaw).
 */
function rotateY(v: [number, number, number], angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    v[0] * c + v[2] * s,
    v[1],
    -v[0] * s + v[2] * c,
  ];
}

/**
 * Rotation matrix around the Z axis (spin / roll).
 */
function rotateZ(v: [number, number, number], angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    v[0] * c - v[1] * s,
    v[0] * s + v[1] * c,
    v[2],
  ];
}

/**
 * Normalize a 3-component vector.
 */
function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 1e-10) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Apply intrinsic Euler rotations to base vectors to compute
 * the final viewPlaneNormal and viewUp for the oblique viewport.
 *
 * Base orientation is sagittal:
 *   viewPlaneNormal = [1, 0, 0]  (looking from the right side)
 *   viewUp           = [0, 0, 1]  (superior is up)
 *
 * Axis mapping (relative to sagittal base):
 *   Tilt  (pitch) → Ry  — tips the view up/down (around horizontal Y axis)
 *   Swivel (yaw)  → Rz  — turns the view left/right (around vertical Z axis)
 *   Spin  (roll)  → Rx  — rotates the image in-plane (around viewing X axis)
 *
 * Intrinsic Z'Y'X'' order (swivel in base frame → tilt in swiveled frame
 * → spin in tilted frame) equals extrinsic X→Y→Z (spin→tilt→swivel in
 * world frame). This ensures each slider behaves intuitively regardless
 * of the other sliders' values.
 */
function computePlaneVectors(
  tiltDeg: number,
  spinDeg: number,
  swivelDeg: number
): { normal: [number, number, number]; viewUp: [number, number, number] } {
  const tiltRad = degToRad(tiltDeg);
  const spinRad = degToRad(spinDeg);
  const swivelRad = degToRad(swivelDeg);

  // Base sagittal orientation
  let normal: [number, number, number] = [1, 0, 0];
  let viewUp: [number, number, number] = [0, 0, 1];

  // Extrinsic X → Y → Z  (= intrinsic Z' → Y' → X'')

  // 1. Spin (roll) — Rx — in-plane rotation around the viewing axis
  normal = rotateX(normal, spinRad);
  viewUp = rotateX(viewUp, spinRad);

  // 2. Tilt (pitch) — Ry — tips the view up/down
  normal = rotateY(normal, tiltRad);
  viewUp = rotateY(viewUp, tiltRad);

  // 3. Swivel (yaw) — Rz — turns the view left/right
  normal = rotateZ(normal, swivelRad);
  viewUp = rotateZ(viewUp, swivelRad);

  return {
    normal: normalize(normal),
    viewUp: normalize(viewUp),
  };
}

// Preset definitions
interface Preset {
  label: string;
  normal: [number, number, number];
  viewUp: [number, number, number];
}

const PRESETS: Preset[] = [
  { label: 'Axial', normal: [0, 0, 1], viewUp: [0, -1, 0] },
  { label: 'Sagittal', normal: [1, 0, 0], viewUp: [0, 0, 1] },
  { label: 'Coronal', normal: [0, 1, 0], viewUp: [0, 0, 1] },
];

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  padding: '16px',
  backgroundColor: '#0d1117',
  borderLeft: '1px solid #1a2a3a',
  height: '100%',
  overflowY: 'auto',
  minWidth: '260px',
  maxWidth: '300px',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#6b8aaa',
  marginBottom: '4px',
};

const sliderContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const sliderLabelRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '12px',
  color: '#b0c4d8',
};

const sliderStyle: React.CSSProperties = {
  width: '100%',
  height: '4px',
  cursor: 'pointer',
  accentColor: '#4cc9f0',
};

const presetRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexWrap: 'wrap',
};

const presetButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '4px',
  border: '1px solid #2a3f55',
  backgroundColor: '#131d2b',
  color: '#90caf9',
  cursor: 'pointer',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  transition: 'background-color 0.15s, border-color 0.15s',
};

const resetButtonStyle: React.CSSProperties = {
  ...presetButtonStyle,
  backgroundColor: '#1a1030',
  borderColor: '#4a3070',
  color: '#b39ddb',
  width: '100%',
  textAlign: 'center',
};

const valueDisplayStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#4cc9f0',
  minWidth: '48px',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const vectorDisplayStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#5a7a9a',
  fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  padding: '8px',
  backgroundColor: '#0a0f18',
  borderRadius: '4px',
  border: '1px solid #1a2a3a',
  lineHeight: '1.6',
};

export default function ObliqueControls({ onPlaneChange, onAnglesChange, actualNormal, actualViewUp }: ObliqueControlsProps) {
  const [tilt, setTilt] = useState(0);
  const [spin, setSpin] = useState(0);
  const [swivel, setSwivel] = useState(0);

  // Track the actual displayed vectors (may come from sliders OR presets)
  const [currentNormal, setCurrentNormal] = useState<[number, number, number]>([1, 0, 0]);
  const [currentViewUp, setCurrentViewUp] = useState<[number, number, number]>([0, 0, 1]);

  // Ref to skip the useEffect after a preset is applied (prevents override)
  const presetApplied = useRef(false);

  // Compute and fire the callback whenever angles change
  useEffect(() => {
    if (presetApplied.current) {
      presetApplied.current = false;
      return;
    }
    const { normal, viewUp } = computePlaneVectors(tilt, spin, swivel);
    setCurrentNormal(normal);
    setCurrentViewUp(viewUp);
    onPlaneChange(normal, viewUp);
    onAnglesChange?.({ tilt, spin, swivel });
  }, [tilt, spin, swivel, onPlaneChange, onAnglesChange]);

  const handlePreset = useCallback(
    (preset: Preset) => {
      presetApplied.current = true;
      setTilt(0);
      setSpin(0);
      setSwivel(0);
      setCurrentNormal(preset.normal);
      setCurrentViewUp(preset.viewUp);
      onPlaneChange(preset.normal, preset.viewUp);
      onAnglesChange?.({ tilt: 0, spin: 0, swivel: 0 });
    },
    [onPlaneChange, onAnglesChange]
  );

  const handleReset = useCallback(() => {
    // Directly apply the base sagittal orientation (same pattern as handlePreset).
    // We can't rely on the useEffect alone because if the angles are already 0
    // (e.g. after a preset was applied), React won't re-trigger the effect.
    presetApplied.current = true;
    setTilt(0);
    setSpin(0);
    setSwivel(0);
    const baseNormal: [number, number, number] = [1, 0, 0];
    const baseViewUp: [number, number, number] = [0, 0, 1];
    setCurrentNormal(baseNormal);
    setCurrentViewUp(baseViewUp);
    onPlaneChange(baseNormal, baseViewUp);
    onAnglesChange?.({ tilt: 0, spin: 0, swivel: 0 });
  }, [onPlaneChange, onAnglesChange]);

  const formatVec = (v: [number, number, number]) =>
    `[${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}]`;

  return (
    <div style={containerStyle}>
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#e0e0e0' }}>
        Oblique Controls
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={sectionTitleStyle}>Rotation Angles</div>

        {/* Tilt slider */}
        <div style={sliderContainerStyle}>
          <div style={sliderLabelRowStyle}>
            <span>Tilt (Pitch)</span>
            <span style={valueDisplayStyle}>{tilt.toFixed(1)}&deg;</span>
          </div>
          <input
            type="range"
            min={-90}
            max={90}
            step={0.5}
            value={tilt}
            onChange={(e) => setTilt(parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>

        {/* Spin slider */}
        <div style={sliderContainerStyle}>
          <div style={sliderLabelRowStyle}>
            <span>Spin (Roll)</span>
            <span style={valueDisplayStyle}>{spin.toFixed(1)}&deg;</span>
          </div>
          <input
            type="range"
            min={-90}
            max={90}
            step={0.5}
            value={spin}
            onChange={(e) => setSpin(parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>

        {/* Swivel slider */}
        <div style={sliderContainerStyle}>
          <div style={sliderLabelRowStyle}>
            <span>Swivel (Yaw)</span>
            <span style={valueDisplayStyle}>{swivel.toFixed(1)}&deg;</span>
          </div>
          <input
            type="range"
            min={-180}
            max={180}
            step={0.5}
            value={swivel}
            onChange={(e) => setSwivel(parseFloat(e.target.value))}
            style={sliderStyle}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={sectionTitleStyle}>Presets</div>
        <div style={presetRowStyle}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              style={presetButtonStyle}
              onClick={() => handlePreset(preset)}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a2d40';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a5f80';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#131d2b';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a3f55';
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          style={resetButtonStyle}
          onClick={handleReset}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#251845';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1030';
          }}
        >
          Reset Oblique
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={sectionTitleStyle}>Current Vectors</div>
        <div style={vectorDisplayStyle}>
          <div>Normal: {formatVec(actualNormal ?? currentNormal)}</div>
          <div>ViewUp: {formatVec(actualViewUp ?? currentViewUp)}</div>
        </div>
      </div>
    </div>
  );
}

export { computePlaneVectors };
