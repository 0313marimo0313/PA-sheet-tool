import { defineConfig } from 'vite'

export default defineConfig({
  base: '/PA-sheet-tool/',
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
})
