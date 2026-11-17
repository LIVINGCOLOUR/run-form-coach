import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// テスト用のページ（/lab/）の入り口。中身はアプリと同じ（main.tsx）。/lab/ で開いたことは core/lab.ts が見分けて、テスト用のホームを出す。
// 入り口のファイルを分けているのは、作ったページ（dist/index.html・dist/lab/index.html）がそれぞれ自分の入り口だけを読むようにするため
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
