import * as cornerstone from '@cornerstonejs/core';
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';
import type { SeriesMetadata } from '../types';

// ---------------------------------------------------------------------------
// Debug helper – always available on window.__spineDebug
// ---------------------------------------------------------------------------
interface DebugState {
  step: string;
  detail: string;
  fileCount: number;
  parsedCount: number;
  error: string | null;
  startTime: number;
  elapsed: number;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
}

function dbg(): DebugState {
  const w = window as unknown as { __spineDebug: DebugState };
  if (!w.__spineDebug) {
    w.__spineDebug = {
      step: 'idle',
      detail: '',
      fileCount: 0,
      parsedCount: 0,
      error: null,
      startTime: 0,
      elapsed: 0,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      crossOriginIsolated: !!(window as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
    };
  }
  return w.__spineDebug;
}

function setDebug(partial: Partial<DebugState>) {
  const d = dbg();
  Object.assign(d, partial);
  if (d.startTime) d.elapsed = (Date.now() - d.startTime) / 1000;
  console.log(`[spine-debug] ${d.step}: ${d.detail}`, d);
}

// ---------------------------------------------------------------------------
// DICOM tag helpers
// ---------------------------------------------------------------------------
function getString(ds: dicomParser.DataSet, tag: string, fallback = ''): string {
  if (!ds.elements[tag]) return fallback;
  return ds.string(tag) ?? fallback;
}

/** Read a decimal-string (DS/IS VR) tag as a number. */
function getDS(ds: dicomParser.DataSet, tag: string, fallback = 0): number {
  if (!ds.elements[tag]) return fallback;
  const val = ds.floatString(tag);
  return val !== undefined && !isNaN(val) ? val : fallback;
}

/** Read a binary unsigned-short (US VR) tag — used for Rows, Columns,
 *  BitsAllocated, BitsStored, HighBit, PixelRepresentation, etc. */
function getUS(ds: dicomParser.DataSet, tag: string, fallback = 0): number {
  if (!ds.elements[tag]) return fallback;
  const val = ds.uint16(tag);
  return val !== undefined && !isNaN(val) ? val : fallback;
}

function getNumberArray(ds: dicomParser.DataSet, tag: string): number[] {
  if (!ds.elements[tag]) return [];
  const raw = ds.string(tag);
  if (!raw) return [];
  return raw.split('\\').map(Number);
}

// ---------------------------------------------------------------------------
// Slice info extracted from DICOM header
// ---------------------------------------------------------------------------
interface SliceInfo {
  file: File;
  imageId: string;
  dataSet: dicomParser.DataSet;
  imagePositionPatient: number[];
  imageOrientationPatient: number[];
  pixelSpacing: [number, number];
  sliceThickness: number;
  rows: number;
  columns: number;
  patientName: string;
  studyDescription: string;
  seriesDescription: string;
}

function computeSliceNormal(orientation: number[]): [number, number, number] {
  if (orientation.length < 6) return [0, 0, 1];
  const [rx, ry, rz, cx, cy, cz] = orientation;
  return [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
}

function sliceDistance(position: number[], normal: [number, number, number]): number {
  return (position[0] || 0) * normal[0] + (position[1] || 0) * normal[1] + (position[2] || 0) * normal[2];
}

// ---------------------------------------------------------------------------
// Custom metadata provider — returns DICOM metadata from our parsed DataSets
// directly, WITHOUT requiring Cornerstone to decode the image first.
// This eliminates the need for the pre-load step that was hanging.
// ---------------------------------------------------------------------------
const metadataByImageId = new Map<string, dicomParser.DataSet>();

function customMetadataProvider(type: string, imageId: string): unknown {
  const ds = metadataByImageId.get(imageId);
  if (!ds) return undefined;

  switch (type) {
    case 'imagePixelModule':
      return {
        samplesPerPixel: getUS(ds, 'x00280002', 1),
        photometricInterpretation: getString(ds, 'x00280004', 'MONOCHROME2'),
        rows: getUS(ds, 'x00280010', 0),
        columns: getUS(ds, 'x00280011', 0),
        bitsAllocated: getUS(ds, 'x00280100', 16),
        bitsStored: getUS(ds, 'x00280101', 16),
        highBit: getUS(ds, 'x00280102', 15),
        pixelRepresentation: getUS(ds, 'x00280103', 0),
        planarConfiguration: getUS(ds, 'x00280006', 0),
      };

    case 'imagePlaneModule': {
      const ipp = getNumberArray(ds, 'x00200032');
      const iop = getNumberArray(ds, 'x00200037');
      const ps = getNumberArray(ds, 'x00280030');
      return {
        imagePositionPatient: ipp.length === 3 ? ipp : [0, 0, 0],
        imageOrientationPatient: iop.length === 6 ? iop : [1, 0, 0, 0, 1, 0],
        pixelSpacing: ps.length === 2 ? ps : [1, 1],
        rowPixelSpacing: ps[0] ?? 1,
        columnPixelSpacing: ps[1] ?? 1,
        sliceThickness: getDS(ds, 'x00180050', 0),
        sliceLocation: getDS(ds, 'x00201041', 0),
        rows: getUS(ds, 'x00280010', 0),
        columns: getUS(ds, 'x00280011', 0),
        frameOfReferenceUID: getString(ds, 'x00200052', ''),
      };
    }

    case 'generalSeriesModule':
      return {
        modality: getString(ds, 'x00080060', 'CT'),
        seriesDescription: getString(ds, 'x0008103e', ''),
        seriesNumber: getDS(ds, 'x00200011', 0),
        seriesInstanceUID: getString(ds, 'x0020000e', ''),
      };

    case 'voiLutModule': {
      const wc = getNumberArray(ds, 'x00281050');
      const ww = getNumberArray(ds, 'x00281051');
      if (wc.length > 0 && ww.length > 0) {
        return {
          windowCenter: wc,
          windowWidth: ww,
        };
      }
      return undefined;
    }

    case 'modalityLutModule':
      return {
        rescaleIntercept: getDS(ds, 'x00281052', 0),
        rescaleSlope: getDS(ds, 'x00281053', 1),
        rescaleType: getString(ds, 'x00281054', 'HU'),
      };

    case 'sopCommonModule':
      return {
        sopClassUID: getString(ds, 'x00080016', ''),
        sopInstanceUID: getString(ds, 'x00080018', ''),
      };

    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Parse a single file — sync CPU work, returns null on failure
// ---------------------------------------------------------------------------
function parseOneFile(file: File, arrayBuffer: ArrayBuffer): SliceInfo | null {
  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
  } catch (err) {
    console.warn(`[spine] Skipping ${file.name}: not valid DICOM`, err);
    return null;
  }

  const imageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(file);

  // Store DataSet for our custom metadata provider
  metadataByImageId.set(imageId, dataSet);

  const pixelSpacingArr = getNumberArray(dataSet, 'x00280030');
  return {
    file,
    imageId,
    dataSet,
    imagePositionPatient: getNumberArray(dataSet, 'x00200032'),
    imageOrientationPatient: getNumberArray(dataSet, 'x00200037'),
    pixelSpacing: [pixelSpacingArr[0] || 1, pixelSpacingArr[1] || 1],
    sliceThickness: getDS(dataSet, 'x00180050', 0),
    rows: getUS(dataSet, 'x00280010', 0),
    columns: getUS(dataSet, 'x00280011', 0),
    patientName: getString(dataSet, 'x00100010', 'Unknown'),
    studyDescription: getString(dataSet, 'x00081030', ''),
    seriesDescription: getString(dataSet, 'x0008103e', ''),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function loadDICOMFiles(
  files: File[],
  onProgress?: (step: string, detail: string) => void,
): Promise<{
  volumeId: string;
  imageIds: string[];
  metadata: SeriesMetadata;
}> {
  if (files.length === 0) throw new Error('No DICOM files provided');

  const report = (step: string, detail: string) => {
    setDebug({ step, detail });
    onProgress?.(step, detail);
  };

  setDebug({ startTime: Date.now(), fileCount: files.length, error: null });

  // -------------------------------------------------------------------
  // Step 1: Read all files into ArrayBuffers IN PARALLEL (batched)
  // -------------------------------------------------------------------
  report('reading', `Reading ${files.length} files...`);
  const BATCH_SIZE = 50;
  const buffers: (ArrayBuffer | null)[] = new Array(files.length);
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (f) => {
        try {
          return await f.arrayBuffer();
        } catch (err) {
          console.warn(`[spine] Failed to read ${f.name}`, err);
          return null;
        }
      })
    );
    for (let j = 0; j < results.length; j++) {
      buffers[i + j] = results[j];
    }
    report('reading', `Read ${Math.min(i + BATCH_SIZE, files.length)} / ${files.length} files`);
  }

  // -------------------------------------------------------------------
  // Step 2: Parse DICOM headers (CPU-bound, but we yield every batch)
  // -------------------------------------------------------------------
  report('parsing', `Parsing DICOM headers...`);
  const slices: SliceInfo[] = [];
  for (let i = 0; i < files.length; i++) {
    const buf = buffers[i];
    if (!buf) continue;
    const info = parseOneFile(files[i], buf);
    if (info) slices.push(info);
    if ((i + 1) % 100 === 0) {
      setDebug({ parsedCount: slices.length, detail: `Parsed ${i + 1} / ${files.length}` });
      // Yield to UI thread periodically
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (slices.length === 0) {
    const err = new Error(`No valid DICOM files found (checked ${files.length} files)`);
    setDebug({ error: err.message });
    throw err;
  }
  report('parsing', `Parsed ${slices.length} valid DICOM slices`);

  // -------------------------------------------------------------------
  // Step 3: Sort by slice position
  // -------------------------------------------------------------------
  const normal = computeSliceNormal(slices[0].imageOrientationPatient);
  slices.sort((a, b) => sliceDistance(a.imagePositionPatient, normal) - sliceDistance(b.imagePositionPatient, normal));
  const sortedImageIds = slices.map((s) => s.imageId);

  // -------------------------------------------------------------------
  // Step 4: Register custom metadata provider
  // -------------------------------------------------------------------
  report('metadata', 'Registering metadata provider...');
  // Register at high priority (above wadouri's provider)
  cornerstone.metaData.addProvider(customMetadataProvider, 20000);

  // Verify that our provider works for the first image
  const testMeta = cornerstone.metaData.get('imagePixelModule', sortedImageIds[0]);
  if (!testMeta || testMeta.bitsAllocated === undefined) {
    const err = new Error(
      `Custom metadata provider failed for ${sortedImageIds[0]}. ` +
      `Got: ${JSON.stringify(testMeta)}`
    );
    setDebug({ error: err.message });
    throw err;
  }
  report('metadata', `Metadata provider OK (bitsAllocated=${testMeta.bitsAllocated}, pixelRep=${testMeta.pixelRepresentation})`);

  // -------------------------------------------------------------------
  // Step 5: Build series metadata for UI
  // -------------------------------------------------------------------
  const first = slices[0];
  const metadata: SeriesMetadata = {
    patientName: first.patientName,
    studyDescription: first.studyDescription,
    seriesDescription: first.seriesDescription,
    rows: first.rows,
    columns: first.columns,
    numberOfSlices: slices.length,
    pixelSpacing: first.pixelSpacing,
    sliceThickness: first.sliceThickness,
    imageOrientationPatient: first.imageOrientationPatient,
  };

  // -------------------------------------------------------------------
  // Step 6: Create volume
  // -------------------------------------------------------------------
  const volumeId = `cornerstoneStreamingImageVolume:${crypto.randomUUID()}`;
  report('volume-create', `Creating volume (${sortedImageIds.length} slices)...`);

  let volume: unknown;
  try {
    volume = await cornerstone.volumeLoader.createAndCacheVolume(
      volumeId,
      { imageIds: sortedImageIds }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setDebug({ error: `createAndCacheVolume failed: ${msg}` });
    throw new Error(`createAndCacheVolume failed: ${msg}`);
  }
  report('volume-create', 'Volume created successfully');

  // -------------------------------------------------------------------
  // Step 7: Start loading pixel data into the volume
  // -------------------------------------------------------------------
  report('volume-load', 'Loading pixel data into volume...');
  if (volume && typeof (volume as { load?: unknown }).load === 'function') {
    (volume as { load: () => void }).load();
  } else {
    console.warn('[spine] Volume has no .load() method — pixel data may not stream:', volume);
  }
  report('volume-load', 'Volume load() started — pixel data streaming in background');

  setDebug({ step: 'done', detail: `Loaded ${slices.length} slices`, error: null });
  return { volumeId, imageIds: sortedImageIds, metadata };
}
