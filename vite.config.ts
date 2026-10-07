import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
// アプリ（/）と、フォームの見方の説明ページ（/theory/）の2つを作る
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        theory: fileURLToPath(new URL('./theory/index.html', import.meta.url)),
      },
    },
  },
})
