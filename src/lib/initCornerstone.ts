import * as cornerstone from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';

export let initialized = false;

/**
 * Initialize Cornerstone3D, its tools, and the DICOM image loader.
 * Safe to call multiple times -- subsequent calls are no-ops.
 */
export async function initCornerstone(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    // 1. Initialize Cornerstone3D core (synchronous in v4, returns boolean)
    cornerstone.init();
  } catch (err) {
    console.error('Failed to initialize Cornerstone3D core:', err);
    throw err;
  }

  try {
    // 2. Initialize Cornerstone Tools
    cornerstoneTools.init();
  } catch (err) {
    console.error('Failed to initialize Cornerstone Tools:', err);
    throw err;
  }

  try {
    // 3. Initialize the DICOM image loader.
    //    This calls registerLoaders() internally (wadouri: / wadors: schemes)
    //    AND registers a web-worker with the centralized worker manager.
    //    The dicom-image-loader is EXCLUDED from Vite's optimizeDeps so that
    //    its new URL('./decodeImageFrameWorker.js', import.meta.url) resolves
    //    to the real file in node_modules (not a missing .vite/deps/ file).
    cornerstoneDICOMImageLoader.init({
      maxWebWorkers: navigator.hardwareConcurrency
        ? Math.max(1, Math.floor(navigator.hardwareConcurrency / 2))
        : 1,
    });

    // Register the wadouri metadata provider with Cornerstone's metaData module.
    // This is critical — without it, Cornerstone can't resolve metadata
    // (pixelRepresentation, etc.) needed to create volumes from DICOM images.
    cornerstone.metaData.addProvider(
      cornerstoneDICOMImageLoader.wadouri.metaData.metaDataProvider,
      10000
    );
  } catch (err) {
    console.error('Failed to initialize DICOM image loader:', err);
    throw err;
  }

  try {
    // 4. Register the streaming image volume loader so that volume IDs
    //    with the "cornerstoneStreamingImageVolume:" scheme are handled.
    //    In v4 this loader lives inside @cornerstonejs/core itself.
    cornerstone.volumeLoader.registerVolumeLoader(
      'cornerstoneStreamingImageVolume',
      cornerstone.cornerstoneStreamingImageVolumeLoader as unknown as Types.VolumeLoaderFn
    );
  } catch (err) {
    console.error('Failed to register volume loader:', err);
    throw err;
  }

  initialized = true;
  console.log('Cornerstone3D initialized successfully');
}
