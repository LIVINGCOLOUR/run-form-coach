import type { PhoneMeasure } from './signal'
import type { GpsFix } from './speed'

// ウェブ（Safari）の動きのセンサー（DeviceMotion）と、画面が消えないようにする仕組み（Wake Lock）
//
// 値の決まり（signal.ts の PhoneMeasure に合わせる）：
//   加速度：accelerationIncludingGravity をそのまま使う（m/s²、重力を含む。W3C の決まりでは止まっていると上向きに約 9.8）。
//     機種によって3つの軸の符号がそろって逆になることがあるが、見る役は上下を「平均の加速度の向き」から決めるので、
//     そろって逆でも同じ値になる（phone.test.ts で確かめている）。だから、ここでは直さずに渡す
//   角速度：rotationRate は deg/s なので rad/s に直す。alpha が z 軸、beta が x 軸、gamma が y 軸まわり（W3C の決まり）

const DEG = Math.PI / 180

// 動きのセンサーの値の形（DeviceMotionEvent のうち使うところだけ。テストで作りやすいように）
export interface MotionLike {
  accelerationIncludingGravity: { x: number | null; y: number | null; z: number | null } | null
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null
}

// 1回分のセンサーの値を、見る役に渡す形に直す。加速度が取れないときは null
export function toMeasure(e: MotionLike, t: number): PhoneMeasure | null {
  const a = e.accelerationIncludingGravity
  if (!a || a.x === null || a.y === null || a.z === null) return null
  const m: PhoneMeasure = { t, ax: a.x, ay: a.y, az: a.z }
  const r = e.rotationRate
  if (r && r.alpha !== null && r.beta !== null && r.gamma !== null) {
    m.gx = r.beta * DEG
    m.gy = r.gamma * DEG
    m.gz = r.alpha * DEG
  }
  return m
}

export type MotionPermission = 'granted' | 'denied' | 'unsupported'

// iPhone では、押したとき（タップの流れの中）に許可を求める。許可の仕組みがない端末はそのまま使える
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported'
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent
  try {
    if (DME?.requestPermission) return (await DME.requestPermission()) === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
  return 'granted'
}

// センサーの値を受け取り始める。止めるための関数を返す
export function listenMotion(cb: (e: MotionLike, interval: number | null) => void): () => void {
  const h = (e: DeviceMotionEvent) => cb(e, typeof e.interval === 'number' ? e.interval : null)
  window.addEventListener('devicemotion', h)
  return () => window.removeEventListener('devicemotion', h)
}

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

// 位置情報（外で走るとき、GPS の速さで判定を止めるため。speed.ts）
//   許可は「スマホ版をはじめる」を押したときに、動きのセンサーの許可とまとめて求める（requestLocation）。
//   許可されたら、走る画面で位置を受け取り続ける（watchLocation）
export type LocationPermission = 'granted' | 'denied' | 'unsupported'

// 許可を求める。許可の画面が出て、答えが決まるまで待つ。許可されたあと位置がすぐ取れなくても（屋内など）granted
export function requestLocation(): Promise<LocationPermission> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve('unsupported')
  return new Promise((done) => {
    navigator.geolocation.getCurrentPosition(
      () => done('granted'),
      (e) => done(e.code === e.PERMISSION_DENIED ? 'denied' : 'granted'),
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 },
    )
  })
}

// 位置を受け取り始める。t は受け取った時刻（performance.now() の秒。センサーの値と同じ時計）。止めるための関数を返す
// 許可されていない・取れないときは onError に code（1=許可されていない、2=取れない、3=時間切れ）
export function watchLocation(cb: (f: GpsFix) => void, onError?: (code: number) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.(2)
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) => {
      const c = p.coords
      cb({ t: performance.now() / 1000, lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, speed: c.speed, altitude: c.altitude, altitudeAccuracy: c.altitudeAccuracy })
    },
    (e) => onError?.(e.code),
    { enableHighAccuracy: true, maximumAge: 0 },
  )
  return () => navigator.geolocation.clearWatch(id)
}
