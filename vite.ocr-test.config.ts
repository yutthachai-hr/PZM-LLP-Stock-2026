import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-ocr-test',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        ocrHarness: 'e2e/ocr-harness.html',
      },
    },
  },
})
