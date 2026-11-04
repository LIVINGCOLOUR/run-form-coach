// 画面が消えないようにする（Screen Wake Lock。スマホ版・センサーランで使う）。
// iPhone では、画面が消える（ロックされる）と、ウェブのページの中の時計（setInterval）や通知の受け取りが止まることがある（未確認。Bluefy での振る舞いは記録の sensor:gap で確かめる）。
// 使えないブラウザでは false（画面の設定の「自動ロック」を「なし」にしてもらう）
// 画面が消えないようにする。画面を切り替えて戻ると外れるので、戻ったときに取り直す（keepAwake の中で）
type Sentinel = { released?: boolean; release: () => Promise<void> }
let sentinel: Sentinel | null = null

export async function requestWakeLock(): Promise<boolean> {
  const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock
  if (!wl) return false
  if (sentinel && !sentinel.released) return true
  try {
    sentinel = await wl.request('screen')
    return true
  } catch {
    sentinel = null
    return false
  }
}

export function wakeLockHeld(): boolean {
  return !!sentinel && !sentinel.released
}

// 走っている画面の間、画面が消えないようにしておく。やめるための関数を返す
export function keepAwake(onChange: (held: boolean) => void): () => void {
  const again = () => {
    if (document.visibilityState === 'visible') requestWakeLock().then(onChange)
  }
  document.addEventListener('visibilitychange', again)
  requestWakeLock().then(onChange)
  return () => {
    document.removeEventListener('visibilitychange', again)
    sentinel?.release().catch(() => {})
    sentinel = null
  }
}

