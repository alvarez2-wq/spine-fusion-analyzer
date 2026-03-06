/**
 * ROI Volume Computer
 *
 * Collects SplineROI contour annotations drawn across slices,
 * determines which voxels fall inside the contours, fills a labelmap,
 * and computes the enclosed volume.
 */

import { cache, type Types } from '@cornerstonejs/core';
import { annotation, SplineROITool } from '@cornerstonejs/tools';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ROIVolumeResult {
  volumeMm3: number;
  volumeCm3: number;
  voxelCount: number;
  sliceCount: number; // number of slices with contours
  labelmapData: Uint8Array;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Point-in-polygon test using ray casting algorithm.
 * Works with 2D points (we project 3D contour points onto the slice plane).
 */
function pointInPolygon2D(
  px: number,
  py: number,
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Determine which IJK axis is closest to the viewport's view plane normal.
 * Returns the axis index (0, 1, or 2) and the sign.
 */
function findSliceAxis(
  viewPlaneNormal: Types.Point3,
  direction: number[],
): { axis: 0 | 1 | 2; sign: 1 | -1 } {
  // For each IJK axis, compute its world-space direction
  // direction is row-major 3×3: columns are IJK axes
  let bestAxis: 0 | 1 | 2 = 2;
  let bestDot = 0;

  for (let col = 0; col < 3; col++) {
    // IJK axis col has world direction: (direction[0*3+col], direction[1*3+col], direction[2*3+col])
    const dx = direction[0 * 3 + col];
    const dy = direction[1 * 3 + col];
    const dz = direction[2 * 3 + col];
    const dot = Math.abs(
      viewPlaneNormal[0] * dx +
      viewPlaneNormal[1] * dy +
      viewPlaneNormal[2] * dz,
    );
    if (dot > bestDot) {
      bestDot = dot;
      bestAxis = col as 0 | 1 | 2;
    }
  }

  const dx = direction[0 * 3 + bestAxis];
  const dy = direction[1 * 3 + bestAxis];
  const dz = direction[2 * 3 + bestAxis];
  const dotSign =
    viewPlaneNormal[0] * dx +
    viewPlaneNormal[1] * dy +
    viewPlaneNormal[2] * dz;

  return { axis: bestAxis, sign: dotSign > 0 ? 1 : -1 };
}

/**
 * Convert a world coordinate to IJK index.
 */
function worldToIJK(
  world: Types.Point3,
  origin: Types.Point3,
  spacing: Types.Point3,
  direction: number[],
): [number, number, number] {
  // offset from origin
  const ox = world[0] - origin[0];
  const oy = world[1] - origin[1];
  const oz = world[2] - origin[2];

  // direction is row-major 3x3. Inverse of an orthogonal matrix = transpose
  // IJK = D^T * offset / spacing
  const ijk: [number, number, number] = [0, 0, 0];
  for (let col = 0; col < 3; col++) {
    const dx = direction[0 * 3 + col];
    const dy = direction[1 * 3 + col];
    const dz = direction[2 * 3 + col];
    ijk[col] = (ox * dx + oy * dy + oz * dz) / spacing[col];
  }

  return ijk;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function computeROIVolume(
  volumeId: string,
  onProgress?: (msg: string, pct: number) => void,
): Promise<ROIVolumeResult> {
  onProgress?.('Collecting contour annotations…', 0);

  const volume = cache.getVolume(volumeId);
  if (!volume) throw new Error('Volume not found in cache');

  const dimensions = volume.dimensions as [number, number, number];
  const spacing = volume.spacing as [number, number, number];
  const origin = volume.origin as Types.Point3;
  const direction = Array.from(volume.direction) as number[];
  const [dimI, dimJ, dimK] = dimensions;
  const totalVoxels = dimI * dimJ * dimK;

  // Collect all SplineROI annotations
  const allAnnotations = annotation.state.getAllAnnotations();

  const roiAnnotations = allAnnotations.filter(
    (a) => a.metadata?.toolName === SplineROITool.toolName,
  );

  if (roiAnnotations.length === 0) {
    throw new Error(
      'No ROI contours found. Draw contours on the oblique viewport first, ' +
      'then click Compute Volume.',
    );
  }

  onProgress?.(`Processing ${roiAnnotations.length} contours…`, 10);

  // Group contour polylines by their slice index
  // Each annotation has a contour with world-space 3D polyline points
  // We need to figure out which slice each contour is on

  // Use the first contour's view plane normal to determine the slice axis
  const firstAnnotation = roiAnnotations[0] as { data: { contour: { polyline: Types.Point3[] } }; metadata: { viewPlaneNormal?: Types.Point3 } };
  const vpNormal: Types.Point3 = (firstAnnotation.metadata?.viewPlaneNormal as Types.Point3) || [1, 0, 0];

  const { axis: sliceAxis } = findSliceAxis(vpNormal, direction);
  const perpAxes = ([0, 1, 2] as const).filter(a => a !== sliceAxis) as [0 | 1 | 2, 0 | 1 | 2];

  // For each annotation, get its polyline and convert to IJK to determine slice
  interface SliceContour {
    sliceIdx: number;
    polygon2D: { x: number; y: number }[];
  }

  const sliceContours: SliceContour[] = [];

  for (const ann of roiAnnotations) {
    const annData = ann as {
      data: {
        contour?: { polyline?: Types.Point3[]; closed?: boolean };
        handles?: { points?: Types.Point3[] };
      };
    };
    // Use contour.polyline if available, otherwise fall back to handles.points
    // (SplineROI annotations may not populate polyline until rendered)
    const contourPolyline = annData.data?.contour?.polyline;
    const handlePoints = annData.data?.handles?.points;
    const polyline =
      (contourPolyline && contourPolyline.length >= 3)
        ? contourPolyline
        : (handlePoints && handlePoints.length >= 3)
          ? handlePoints
          : null;
    if (!polyline) {
      continue;
    }

    // Filter out any NaN/invalid points
    const validPolyline = polyline.filter(
      (p) => p && !isNaN(p[0]) && !isNaN(p[1]) && !isNaN(p[2]),
    );
    if (validPolyline.length < 3) {
      continue;
    }

    // Convert polyline points to IJK
    const ijkPoints = validPolyline.map(p => worldToIJK(p as Types.Point3, origin, spacing, direction));

    // Determine the slice index (average of slice axis values)
    const avgSlice = ijkPoints.reduce((sum, p) => sum + p[sliceAxis], 0) / ijkPoints.length;
    const sliceIdx = Math.round(avgSlice);

    // Project to 2D in the perpendicular plane
    const polygon2D = ijkPoints.map(p => ({
      x: p[perpAxes[0]],
      y: p[perpAxes[1]],
    }));

    sliceContours.push({ sliceIdx, polygon2D });
  }

  if (sliceContours.length === 0) {
    throw new Error(
      `No valid contours found. ${roiAnnotations.length} annotation(s) were found ` +
      'but none had enough polyline data (need ≥ 3 points). ' +
      'Make sure to close each contour with a double-click.',
    );
  }

  // Sort by slice index
  sliceContours.sort((a, b) => a.sliceIdx - b.sliceIdx);

  // Group contours by slice (multiple contours on same slice = union)
  const contoursBySlice = new Map<number, { x: number; y: number }[][]>();
  for (const sc of sliceContours) {
    if (!contoursBySlice.has(sc.sliceIdx)) {
      contoursBySlice.set(sc.sliceIdx, []);
    }
    contoursBySlice.get(sc.sliceIdx)!.push(sc.polygon2D);
  }

  onProgress?.('Filling volume labelmap…', 30);

  // Build labelmap
  const labelmapData = new Uint8Array(totalVoxels);
  const sliceIndices = Array.from(contoursBySlice.keys()).sort((a, b) => a - b);
  const minSlice = sliceIndices[0];
  const maxSlice = sliceIndices[sliceIndices.length - 1];

  let voxelCount = 0;

  // For each slice between min and max, interpolate if no contour exists
  for (let s = minSlice; s <= maxSlice; s++) {
    let contoursForSlice = contoursBySlice.get(s);

    // If no contour on this slice, interpolate between nearest slices
    if (!contoursForSlice) {
      // Find nearest previous and next slices with contours
      let prevSlice = -1, nextSlice = -1;
      for (let p = s - 1; p >= minSlice; p--) {
        if (contoursBySlice.has(p)) { prevSlice = p; break; }
      }
      for (let n = s + 1; n <= maxSlice; n++) {
        if (contoursBySlice.has(n)) { nextSlice = n; break; }
      }

      if (prevSlice >= 0 && nextSlice >= 0) {
        // Interpolate: use the contour from the closer slice
        // Simple approach: morph between prev and next contours
        const t = (s - prevSlice) / (nextSlice - prevSlice);
        const prevContours = contoursBySlice.get(prevSlice)!;
        const nextContours = contoursBySlice.get(nextSlice)!;

        // Use the first contour from each for interpolation
        if (prevContours.length > 0 && nextContours.length > 0) {
          const interp = interpolateContours(prevContours[0], nextContours[0], t);
          contoursForSlice = [interp];
        }
      }
    }

    if (!contoursForSlice) continue;

    // For each voxel in this slice's perpendicular plane, test if inside any contour
    const dim0 = dimensions[perpAxes[0]];
    const dim1 = dimensions[perpAxes[1]];

    // Compute bounding box for all contours on this slice
    let bbMinX = Infinity, bbMaxX = -Infinity;
    let bbMinY = Infinity, bbMaxY = -Infinity;
    for (const contour of contoursForSlice) {
      for (const pt of contour) {
        if (pt.x < bbMinX) bbMinX = pt.x;
        if (pt.x > bbMaxX) bbMaxX = pt.x;
        if (pt.y < bbMinY) bbMinY = pt.y;
        if (pt.y > bbMaxY) bbMaxY = pt.y;
      }
    }

    const p0Start = Math.max(0, Math.floor(bbMinX) - 1);
    const p0End = Math.min(dim0 - 1, Math.ceil(bbMaxX) + 1);
    const p1Start = Math.max(0, Math.floor(bbMinY) - 1);
    const p1End = Math.min(dim1 - 1, Math.ceil(bbMaxY) + 1);

    for (let p0 = p0Start; p0 <= p0End; p0++) {
      for (let p1 = p1Start; p1 <= p1End; p1++) {
        // Test if this voxel center is inside any contour
        let inside = false;
        for (const contour of contoursForSlice) {
          if (pointInPolygon2D(p0, p1, contour)) {
            inside = true;
            break;
          }
        }
        if (inside) {
          const ijk: [number, number, number] = [0, 0, 0];
          ijk[sliceAxis] = s;
          ijk[perpAxes[0]] = p0;
          ijk[perpAxes[1]] = p1;
          const linearIdx = ijk[0] + ijk[1] * dimI + ijk[2] * dimI * dimJ;
          labelmapData[linearIdx] = 1;
          voxelCount++;
        }
      }
    }

    // Progress update
    if ((s - minSlice) % 10 === 0) {
      const pct = 30 + Math.round(((s - minSlice) / (maxSlice - minSlice + 1)) * 60);
      onProgress?.(`Filling slice ${s - minSlice + 1}/${maxSlice - minSlice + 1}…`, pct);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Compute volume
  const voxelVolumeMm3 = spacing[0] * spacing[1] * spacing[2];
  const volumeMm3 = voxelCount * voxelVolumeMm3;
  const volumeCm3 = volumeMm3 / 1000;

  onProgress?.(`Volume: ${volumeCm3.toFixed(2)} cm³ (${voxelCount} voxels)`, 100);

  return {
    volumeMm3,
    volumeCm3,
    voxelCount,
    sliceCount: contoursBySlice.size,
    labelmapData,
  };
}

/**
 * Interpolate between two 2D contours linearly.
 * Resamples both contours to the same number of points, then lerps.
 */
function interpolateContours(
  contourA: { x: number; y: number }[],
  contourB: { x: number; y: number }[],
  t: number,
): { x: number; y: number }[] {
  // Resample both to same number of points
  const targetN = Math.max(contourA.length, contourB.length);
  const resampledA = resampleContour(contourA, targetN);
  const resampledB = resampleContour(contourB, targetN);

  // Lerp
  return resampledA.map((pa, i) => ({
    x: pa.x + (resampledB[i].x - pa.x) * t,
    y: pa.y + (resampledB[i].y - pa.y) * t,
  }));
}

/**
 * Resample a 2D contour to have exactly N evenly-spaced points.
 */
function resampleContour(
  contour: { x: number; y: number }[],
  n: number,
): { x: number; y: number }[] {
  if (contour.length === n) return contour;
  if (contour.length < 2) return Array(n).fill(contour[0] || { x: 0, y: 0 });

  // Compute cumulative arc lengths
  const arcLengths = [0];
  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i].x - contour[i - 1].x;
    const dy = contour[i].y - contour[i - 1].y;
    arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = arcLengths[arcLengths.length - 1];
  if (totalLen === 0) return Array(n).fill(contour[0]);

  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const targetLen = (i / n) * totalLen;
    // Find segment
    let segIdx = 0;
    for (let j = 1; j < arcLengths.length; j++) {
      if (arcLengths[j] >= targetLen) { segIdx = j - 1; break; }
    }
    const segLen = arcLengths[segIdx + 1] - arcLengths[segIdx];
    const frac = segLen > 0 ? (targetLen - arcLengths[segIdx]) / segLen : 0;
    result.push({
      x: contour[segIdx].x + (contour[segIdx + 1].x - contour[segIdx].x) * frac,
      y: contour[segIdx].y + (contour[segIdx + 1].y - contour[segIdx].y) * frac,
    });
  }
  return result;
}
