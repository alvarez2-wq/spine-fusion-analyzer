import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteCommonjs } from '@originjs/vite-plugin-commonjs'

export default defineConfig({
  plugins: [react(), viteCommonjs()],
  server: {
    port: 3100,
    host: '127.0.0.1',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      '@cornerstonejs/codec-libjpeg-turbo-8bit',
      '@cornerstonejs/codec-charls',
      '@cornerstonejs/codec-openjpeg',
      '@cornerstonejs/codec-openjph',
      'dicom-parser',
    ],
  },
  build: {
    target: 'esnext',
    commonjsOptions: {
      include: [/codec/, /dicom-parser/],
    },
  },
})
