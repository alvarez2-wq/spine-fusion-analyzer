// Worker wrapper: Vite can only handle `new Worker(new URL(...))` in user
// source code, not inside pre-bundled node_modules.  This file simply
// imports the real decode worker module — its top-level `expose()` call
// sets up the comlink message handler automatically.

// @ts-expect-error – deep import path, types not published
import '@cornerstonejs/dicom-image-loader/dist/esm/decodeImageFrameWorker';
