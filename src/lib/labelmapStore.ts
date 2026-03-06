/**
 * Module-level store for labelmap data.
 *
 * The binary labelmap (Uint8Array, 100M+ elements) cannot be passed as a
 * React prop because React 19 dev-mode's render logger tries to diff it,
 * causing a RangeError. This simple store lets App.tsx write and
 * MPRViewer.tsx read the data without going through React's prop system.
 */

let labelmapData: Uint8Array | null = null;

export function setLabelmapStore(data: Uint8Array | null): void {
  labelmapData = data;
}

export function getLabelmapStore(): Uint8Array | null {
  return labelmapData;
}
