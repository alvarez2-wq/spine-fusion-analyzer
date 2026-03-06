/**
 * Automated vertebral body finder.
 *
 * Pure algorithm – works on raw HU voxel data from a Cornerstone volume.
 * No ML model; uses intensity profiling and connected-run detection.
 */

import { cache, type Types } from '@cornerstonejs/core';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VertebraResult {
  label: number; // segment index (1-based)
  name: string; // "Vertebra 1", …
  startSlice: number;
  endSlice: number;
  heightMm: number;
  centroidIJK: [number, number, number];
  centroidWorld: [number, number, number];
  color: [number, number, number, number]; // RGBA 0-255
}

export interface FinderResult {
  vertebrae: VertebraResult[];
  labelmapData: Uint8Array;
  segmentCount: number;
}

// ---------------------------------------------------------------------------
// Color palette – golden-angle hue spacing for max distinction
// ---------------------------------------------------------------------------

function generateColors(count: number): [number, number, number, number][] {
  const colors: [number, number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * 137.508) % 360;
    const [r, g, b] = hslToRgb(hue, 0.75, 0.55);
    colors.push([r, g, b, 180]);
  }
  return colors;
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TypedArray = Float32Array | Int16Array | Uint16Array | Int8Array | Uint8Array;

/** Determine which IJK axis corresponds to Superior-Inferior. */
function findSIAxis(direction: number[]): { axis: 0 | 1 | 2; sign: 1 | -1 } {
  // direction is row-major 3×3: [r0c0,r0c1,r0c2, r1c0,r1c1,r1c2, r2c0,r2c1,r2c2]
  // Row 2 = S/I component. Column i = how the i-th IJK axis projects onto S/I.
  const abs0 = Math.abs(direction[6]);
  const abs1 = Math.abs(direction[7]);
  const abs2 = Math.abs(direction[8]);
  let axis: 0 | 1 | 2 = 2;
  if (abs0 >= abs1 && abs0 >= abs2) axis = 0;
  else if (abs1 >= abs0 && abs1 >= abs2) axis = 1;
  const sign = direction[6 + axis] > 0 ? (1 as const) : (-1 as const);
  return { axis, sign };
}

/** Linear voxel index from IJK. */
function linearIndex(
  i: number,
  j: number,
  k: number,
  dimI: number,
  dimJ: number,
): number {
  return i + j * dimI + k * dimI * dimJ;
}

/** IJK → world (LPS) coordinate. */
function ijkToWorld(
  ijk: [number, number, number],
  origin: Types.Point3,
  spacing: Types.Point3,
  direction: number[],
): [number, number, number] {
  const s0 = ijk[0] * spacing[0];
  const s1 = ijk[1] * spacing[1];
  const s2 = ijk[2] * spacing[2];
  return [
    origin[0] + direction[0] * s0 + direction[1] * s1 + direction[2] * s2,
    origin[1] + direction[3] * s0 + direction[4] * s1 + direction[5] * s2,
    origin[2] + direction[6] * s0 + direction[7] * s1 + direction[8] * s2,
  ];
}

/** 1-D Gaussian smoothing (zero-padded). */
function gaussianSmooth1D(signal: number[], sigma: number): number[] {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let sum = 0;
  for (let x = -radius; x <= radius; x++) {
    const v = Math.exp((-x * x) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const out = new Array<number>(signal.length);
  for (let i = 0; i < signal.length; i++) {
    let acc = 0;
    for (let ki = 0; ki < kernel.length; ki++) {
      const si = i + ki - radius;
      if (si >= 0 && si < signal.length) acc += signal[si] * kernel[ki];
    }
    out[i] = acc;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function findVertebralBodies(
  volumeId: string,
  onProgress?: (msg: string, pct: number) => void,
): Promise<FinderResult> {
  onProgress?.('Loading volume data…', 0);

  const volume = cache.getVolume(volumeId);
  if (!volume) throw new Error('Volume not found in cache');

  // Cornerstone3D v4 uses VoxelManager; getScalarData() may not be available
  // on StreamingImageVolume. Use getCompleteScalarDataArray() via voxelManager.
  let scalarData: TypedArray;
  try {
    scalarData = volume.getScalarData() as TypedArray;
  } catch {
    const vm = (volume as unknown as { voxelManager: { getCompleteScalarDataArray: () => TypedArray } }).voxelManager;
    if (vm?.getCompleteScalarDataArray) {
      scalarData = vm.getCompleteScalarDataArray();
    } else {
      throw new Error('Cannot access volume scalar data');
    }
  }
  const dimensions = volume.dimensions as [number, number, number];
  const spacing = volume.spacing as [number, number, number];
  const origin = volume.origin as Types.Point3;
  const direction = Array.from(volume.direction) as number[];

  const [dimI, dimJ, dimK] = dimensions;
  const totalVoxels = dimI * dimJ * dimK;

  // 1. Determine SI axis
  const { axis: siAxis, sign: siSign } = findSIAxis(direction);
  const perpAxes = ([0, 1, 2] as const).filter((a) => a !== siAxis) as [
    0 | 1 | 2,
    0 | 1 | 2,
  ];
  const siLen = dimensions[siAxis];
  const siSpacing = spacing[siAxis];

  onProgress?.('Locating spine…', 5);

  // 2. Find spine centroid in a few sample slices
  const sampleSlices: number[] = [];
  for (let f = 0.3; f <= 0.7; f += 0.1) {
    sampleSlices.push(Math.floor(siLen * f));
  }

  const spineCenters = new Map<number, { c0: number; c1: number }>();
  let avgC0 = 0,
    avgC1 = 0,
    nSamples = 0;

  for (const s of sampleSlices) {
    const center = findSpineCentroid(
      scalarData,
      dimensions,
      siAxis,
      perpAxes,
      s,
    );
    if (center) {
      spineCenters.set(s, center);
      avgC0 += center.c0;
      avgC1 += center.c1;
      nSamples++;
    }
  }
  if (nSamples === 0) {
    // Fallback: use volume center
    avgC0 = dimensions[perpAxes[0]] / 2;
    avgC1 = dimensions[perpAxes[1]] / 2;
  } else {
    avgC0 /= nSamples;
    avgC1 /= nSamples;
  }

  onProgress?.('Computing bone density profile…', 15);

  // 3. Compute bone-fraction profile along SI axis using an elliptical ROI
  const radiusMm = 35; // mm — generous to capture vertebral body
  const radiusVox0 = radiusMm / spacing[perpAxes[0]];
  const radiusVox1 = radiusMm / spacing[perpAxes[1]];

  const boneFraction: number[] = new Array(siLen).fill(0);

  for (let s = 0; s < siLen; s++) {
    // Use the closest known centroid, or the average
    let c0 = avgC0,
      c1 = avgC1;
    const known = spineCenters.get(s);
    if (known) {
      c0 = known.c0;
      c1 = known.c1;
    }

    const p0Start = Math.max(0, Math.floor(c0 - radiusVox0));
    const p0End = Math.min(
      dimensions[perpAxes[0]] - 1,
      Math.ceil(c0 + radiusVox0),
    );
    const p1Start = Math.max(0, Math.floor(c1 - radiusVox1));
    const p1End = Math.min(
      dimensions[perpAxes[1]] - 1,
      Math.ceil(c1 + radiusVox1),
    );

    let boneCount = 0,
      total = 0;

    for (let p0 = p0Start; p0 <= p0End; p0++) {
      const d0 = (p0 - c0) / radiusVox0;
      const d0sq = d0 * d0;
      for (let p1 = p1Start; p1 <= p1End; p1++) {
        const d1 = (p1 - c1) / radiusVox1;
        if (d0sq + d1 * d1 > 1.0) continue; // outside ellipse
        total++;

        const ijk: [number, number, number] = [0, 0, 0];
        ijk[siAxis] = s;
        ijk[perpAxes[0]] = p0;
        ijk[perpAxes[1]] = p1;
        const idx = linearIndex(ijk[0], ijk[1], ijk[2], dimI, dimJ);
        const hu = scalarData[idx];
        if (hu >= 150 && hu <= 1500) boneCount++;
      }
    }

    boneFraction[s] = total > 0 ? boneCount / total : 0;

    // Yield every 100 slices
    if (s % 100 === 0) {
      const pct = 15 + Math.round((s / siLen) * 50);
      onProgress?.(`Profiling slice ${s}/${siLen}…`, pct);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.('Detecting vertebral bodies…', 70);

  // 4. Smooth and detect bodies
  const smoothed = gaussianSmooth1D(boneFraction, 2.5);

  // Adaptive threshold: use median of non-zero values × 0.3
  const nonZero = smoothed.filter((v) => v > 0.001);
  nonZero.sort((a, b) => a - b);
  const median =
    nonZero.length > 0 ? nonZero[Math.floor(nonZero.length / 2)] : 0.02;
  const threshold = Math.max(0.01, median * 0.35);

  // Find connected runs above threshold
  const runs: { start: number; end: number }[] = [];
  let inRun = false,
    runStart = 0;

  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] >= threshold && !inRun) {
      inRun = true;
      runStart = i;
    } else if (smoothed[i] < threshold && inRun) {
      inRun = false;
      runs.push({ start: runStart, end: i - 1 });
    }
  }
  if (inRun) runs.push({ start: runStart, end: smoothed.length - 1 });

  // 5. Filter by height and split oversized runs
  const MIN_HEIGHT_MM = 10;
  const MAX_HEIGHT_MM = 50;
  const SPLIT_THRESHOLD_MM = 45;

  const filteredRuns: { start: number; end: number }[] = [];

  for (const run of runs) {
    const heightMm = (run.end - run.start + 1) * siSpacing;
    if (heightMm < MIN_HEIGHT_MM) continue;

    if (heightMm > SPLIT_THRESHOLD_MM) {
      // Try to split at local minima
      const subRuns = splitRunAtMinima(smoothed, run, siSpacing, MIN_HEIGHT_MM);
      filteredRuns.push(...subRuns);
    } else if (heightMm <= MAX_HEIGHT_MM) {
      filteredRuns.push(run);
    }
  }

  // Sort: superior first (depends on siSign)
  filteredRuns.sort((a, b) =>
    siSign > 0 ? b.start - a.start : a.start - b.start,
  );

  onProgress?.('Creating segmentation…', 80);

  // 6. Build labelmap
  const labelmapData = new Uint8Array(totalVoxels); // all zeros = background

  const colors = generateColors(filteredRuns.length);
  const vertebrae: VertebraResult[] = [];

  for (let idx = 0; idx < filteredRuns.length; idx++) {
    const run = filteredRuns[idx];
    const label = idx + 1;
    const heightMm = (run.end - run.start + 1) * siSpacing;
    const centroidSlice = Math.round((run.start + run.end) / 2);

    // Fill labelmap for this body
    let sumI = 0,
      sumJ = 0,
      sumK = 0,
      voxCount = 0;

    for (let s = run.start; s <= run.end; s++) {
      let c0 = avgC0,
        c1 = avgC1;
      const known = spineCenters.get(s);
      if (known) {
        c0 = known.c0;
        c1 = known.c1;
      }

      const bodyRadiusMm = 28;
      const rv0 = bodyRadiusMm / spacing[perpAxes[0]];
      const rv1 = bodyRadiusMm / spacing[perpAxes[1]];

      const p0S = Math.max(0, Math.floor(c0 - rv0));
      const p0E = Math.min(dimensions[perpAxes[0]] - 1, Math.ceil(c0 + rv0));
      const p1S = Math.max(0, Math.floor(c1 - rv1));
      const p1E = Math.min(dimensions[perpAxes[1]] - 1, Math.ceil(c1 + rv1));

      for (let p0 = p0S; p0 <= p0E; p0++) {
        const d0 = (p0 - c0) / rv0;
        const d0sq = d0 * d0;
        for (let p1 = p1S; p1 <= p1E; p1++) {
          const d1 = (p1 - c1) / rv1;
          if (d0sq + d1 * d1 > 1.0) continue;

          const ijk: [number, number, number] = [0, 0, 0];
          ijk[siAxis] = s;
          ijk[perpAxes[0]] = p0;
          ijk[perpAxes[1]] = p1;

          const li = linearIndex(ijk[0], ijk[1], ijk[2], dimI, dimJ);
          const hu = scalarData[li];

          if (hu >= 100 && hu <= 1500) {
            labelmapData[li] = label;
            sumI += ijk[0];
            sumJ += ijk[1];
            sumK += ijk[2];
            voxCount++;
          }
        }
      }
    }

    // Centroid
    const centIJK: [number, number, number] =
      voxCount > 0
        ? [
            Math.round(sumI / voxCount),
            Math.round(sumJ / voxCount),
            Math.round(sumK / voxCount),
          ]
        : (() => {
            const ijk: [number, number, number] = [0, 0, 0];
            ijk[siAxis] = centroidSlice;
            ijk[perpAxes[0]] = Math.round(avgC0);
            ijk[perpAxes[1]] = Math.round(avgC1);
            return ijk;
          })();

    const centWorld = ijkToWorld(centIJK, origin, spacing, direction);

    vertebrae.push({
      label,
      name: `Vertebra ${label}`,
      startSlice: run.start,
      endSlice: run.end,
      heightMm: Math.round(heightMm * 10) / 10,
      centroidIJK: centIJK,
      centroidWorld: centWorld,
      color: colors[idx],
    });

    if (idx % 5 === 0) {
      onProgress?.(
        `Segmenting vertebra ${idx + 1}/${filteredRuns.length}…`,
        80 + Math.round((idx / filteredRuns.length) * 15),
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(`Found ${vertebrae.length} vertebral bodies`, 100);

  return {
    vertebrae,
    labelmapData,
    segmentCount: vertebrae.length,
  };
}

// ---------------------------------------------------------------------------
// Sub-routines
// ---------------------------------------------------------------------------

function findSpineCentroid(
  scalarData: TypedArray,
  dimensions: [number, number, number],
  siAxis: 0 | 1 | 2,
  perpAxes: [0 | 1 | 2, 0 | 1 | 2],
  sliceIdx: number,
): { c0: number; c1: number } | null {
  const dimI = dimensions[0],
    dimJ = dimensions[1];
  const dim0 = dimensions[perpAxes[0]];
  const dim1 = dimensions[perpAxes[1]];

  let sumP0 = 0,
    sumP1 = 0,
    count = 0;

  // Sample every other pixel for speed
  for (let p0 = 0; p0 < dim0; p0 += 2) {
    for (let p1 = 0; p1 < dim1; p1 += 2) {
      const ijk: [number, number, number] = [0, 0, 0];
      ijk[siAxis] = sliceIdx;
      ijk[perpAxes[0]] = p0;
      ijk[perpAxes[1]] = p1;
      const idx = linearIndex(ijk[0], ijk[1], ijk[2], dimI, dimJ);
      const hu = scalarData[idx];

      if (hu >= 200 && hu <= 1500) {
        sumP0 += p0;
        sumP1 += p1;
        count++;
      }
    }
  }

  if (count < 20) return null;
  return { c0: sumP0 / count, c1: sumP1 / count };
}

/** Split an oversized run at its deepest local minimum. */
function splitRunAtMinima(
  smoothed: number[],
  run: { start: number; end: number },
  siSpacing: number,
  minHeightMm: number,
): { start: number; end: number }[] {
  const minSlices = Math.ceil(minHeightMm / siSpacing);

  // Find the deepest local minimum within the run (excluding edges)
  let minVal = Infinity;
  let minIdx = -1;

  for (let i = run.start + minSlices; i <= run.end - minSlices; i++) {
    if (smoothed[i] < minVal) {
      minVal = smoothed[i];
      minIdx = i;
    }
  }

  if (minIdx < 0) return [run]; // Can't split

  const left = { start: run.start, end: minIdx - 1 };
  const right = { start: minIdx + 1, end: run.end };

  const results: { start: number; end: number }[] = [];

  // Recursively split if still oversized
  const leftH = (left.end - left.start + 1) * siSpacing;
  const rightH = (right.end - right.start + 1) * siSpacing;

  if (leftH >= minHeightMm) {
    if (leftH > 45) {
      results.push(...splitRunAtMinima(smoothed, left, siSpacing, minHeightMm));
    } else {
      results.push(left);
    }
  }
  if (rightH >= minHeightMm) {
    if (rightH > 45) {
      results.push(
        ...splitRunAtMinima(smoothed, right, siSpacing, minHeightMm),
      );
    } else {
      results.push(right);
    }
  }

  return results.length > 0 ? results : [run];
}
