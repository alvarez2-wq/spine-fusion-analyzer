import type { VertebraResult } from '../lib/vertebralFinder';

interface VertebraPanelProps {
  vertebrae: VertebraResult[];
  isAnalyzing: boolean;
  analysisProgress: { message: string; percent: number } | null;
  onNavigate: (centroidWorld: [number, number, number]) => void;
  onRunAnalysis: () => void;
  onClearAnalysis: () => void;
}

export default function VertebraPanel({
  vertebrae,
  isAnalyzing,
  analysisProgress,
  onNavigate,
  onRunAnalysis,
  onClearAnalysis,
}: VertebraPanelProps) {
  return (
    <div
      style={{
        padding: '12px',
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        color: '#c0d8e8',
        borderTop: '1px solid #1a2a3a',
      }}
    >
      <div
        style={{
          fontSize: '13px',
          fontWeight: 700,
          marginBottom: '10px',
          letterSpacing: '0.02em',
        }}
      >
        Vertebral Bodies
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        <button
          type="button"
          disabled={isAnalyzing}
          onClick={onRunAnalysis}
          style={{
            flex: 1,
            padding: '6px 10px',
            fontSize: '11px',
            fontWeight: 600,
            borderRadius: '4px',
            border: '1px solid #2a5a7a',
            backgroundColor: isAnalyzing
              ? 'rgba(30, 50, 70, 0.6)'
              : 'rgba(40, 80, 120, 0.5)',
            color: isAnalyzing ? '#5a7a90' : '#8ac4e8',
            cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
        >
          {isAnalyzing ? 'Analyzing…' : 'Find Vertebrae'}
        </button>

        {vertebrae.length > 0 && (
          <button
            type="button"
            onClick={onClearAnalysis}
            style={{
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid #3a2a2a',
              backgroundColor: 'rgba(80, 40, 40, 0.4)',
              color: '#c08080',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Progress bar */}
      {isAnalyzing && analysisProgress && (
        <div style={{ marginBottom: '10px' }}>
          <div
            style={{
              fontSize: '10px',
              color: '#6a8a9a',
              marginBottom: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {analysisProgress.message}
          </div>
          <div
            style={{
              height: '3px',
              backgroundColor: '#1a2a3a',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${analysisProgress.percent}%`,
                backgroundColor: '#4cc9f0',
                borderRadius: '2px',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {/* Vertebra list */}
      {vertebrae.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            maxHeight: '300px',
            overflowY: 'auto',
          }}
        >
          {vertebrae.map((v) => (
            <button
              key={v.label}
              type="button"
              onClick={() => onNavigate(v.centroidWorld)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 8px',
                fontSize: '11px',
                fontFamily: 'inherit',
                color: '#b0c8d8',
                backgroundColor: 'transparent',
                border: '1px solid transparent',
                borderRadius: '3px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.1s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  'rgba(76, 201, 240, 0.08)';
                e.currentTarget.style.borderColor = '#2a4a5a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              {/* Color dot */}
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: `rgb(${v.color[0]},${v.color[1]},${v.color[2]})`,
                  flexShrink: 0,
                }}
              />
              {/* Label */}
              <span style={{ fontWeight: 600, minWidth: '72px' }}>
                {v.name}
              </span>
              {/* Height */}
              <span
                style={{ color: '#6a8a9a', fontSize: '10px', marginLeft: 'auto' }}
              >
                {v.heightMm} mm
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isAnalyzing && vertebrae.length === 0 && (
        <div
          style={{
            fontSize: '10px',
            color: '#4a6a7a',
            textAlign: 'center',
            padding: '8px 0',
          }}
        >
          Click "Find Vertebrae" to auto-detect vertebral bodies
        </div>
      )}
    </div>
  );
}
