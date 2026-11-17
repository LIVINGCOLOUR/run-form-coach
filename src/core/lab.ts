// テスト用のページ（/lab/）で開いているか。/lab/ はアプリと同じ画面を使い、ホームだけテスト用（screens/LabHome.tsx）にする。
// アプリはまだ公開できる段階ではないので、テストの機能（答えつきの記録・崩しの撮影・開発中の機能・記録の書き出しなど）は /lab/ に分け、
// ふつうのアプリ（/）からは外す（本人の決め 2026-11-17）
export const IN_LAB = typeof location !== 'undefined' && /^\/lab(\/|$)/.test(location.pathname)
