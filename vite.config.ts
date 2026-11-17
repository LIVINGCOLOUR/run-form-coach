import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
// アプリ（/）と、フォームの見方の説明ページ（/theory/）と、テスト用のページ（/lab/。アプリと同じ入り口で、ホームだけテスト用。src/core/lab.ts）の3つを作る
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        theory: fileURLToPath(new URL('./theory/index.html', import.meta.url)),
        lab: fileURLToPath(new URL('./lab/index.html', import.meta.url)),
      },
    },
  },
})
