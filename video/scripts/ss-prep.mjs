// SS の月1回の報告の動画（SSReport）の材料を作る。
//   node scripts/ss-prep.mjs <録画.MOV> <骨格の点.json.gz> <始め秒> <終わり秒> [センサーランの前の秒]
// 書くもの（どれも git に入れない video/public/private/）：
//   ss-clip.mp4  … 録画の区間（縦 1080×1920、音なし）
//   ss-data.json … 区間の1コマ（毎秒30）ごとの骨格の点と角度、1秒ごとの値、今日の基準、声の時刻
//   ss-clip2.mp4・ss-pts2.json … センサーランの場面用。区間の前に「前の秒」を足した録画と、1コマごとの骨格の点
//     （前の秒の間に、センサーを付ける場所を1つずつ照準で示す）
// アプリの声かけの決まり（src/core/params.ts の CUE、src/modes/camera/params.ts の上級の猫背の線）をそのまま当てる。
// 今日の基準は、区間の頭の BASE 秒（ふつうに走っている間）の平均（アプリでは走り出しの間にためる）
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'

const [mov, lm, a, b, pre] = process.argv.slice(2)
if (!b) {
  console.error('使い方: node scripts/ss-prep.mjs <録画.MOV> <骨格の点.json.gz> <始め秒> <終わり秒>')
  process.exit(1)
}
const T0 = Number(a)
const T1 = Number(b)
const BASE = 7 // 基準にする区間の頭の秒数
const here = dirname(new URL(import.meta.url).pathname)
const out = join(here, '../public/private')
mkdirSync(out, { recursive: true })
const bundle = join(here, '../node_modules/.tmp/ss-measure.mjs')
await build({ input: join(here, 'ss-measure.ts'), platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const M = await import(pathToFileURL(bundle).href)

const all = M.load(lm, 1080, 1920)
const FPS = 30
const n = Math.round((T1 - T0) * FPS)
const at = (t) => all[Math.round(t * FPS)] ?? { t, p: null, m: null }
const frames = Array.from({ length: n }, (_, k) => at(T0 + k / FPS))
// 進む向きが逆に出たコマ（骨格の左右の取り違え）は角度に使わない
const okM = (f) => f.m && f.m.dir === -1
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
// 1秒ごとの値（アプリと同じく1秒の平均）
const secs = []
for (let s = 0; s < Math.round(T1 - T0); s++) {
  const r = frames.slice(s * FPS, (s + 1) * FPS).filter(okM)
  secs.push(r.length ? { trunk: avg(r.map((f) => f.m.trunk)), neck: avg(r.map((f) => f.m.neck)), headLean: avg(r.map((f) => f.m.headLean)) } : null)
}
const baseSecs = secs.slice(0, BASE).filter(Boolean)
const base = { trunk: avg(baseSecs.map((s) => s.trunk)), neck: avg(baseSecs.map((s) => s.neck)), headLean: avg(baseSecs.map((s) => s.headLean)) }
// 猫背の値（coach.ts の hunchOf）：上体の増えと、首の角度の増え＋neckSlack の小さいほう
const hunch = secs.map((s) => (s ? Math.min(s.trunk - base.trunk, s.neck - base.neck + M.NECK_SLACK) : null))
// 声の時刻：1秒の値が線の外に SUSTAIN 秒続き、直近 WINDOW 秒の平均も線を越えた秒の終わり。
// 直った：声のあと、RECOVER_HOLD 秒続けて線の内側
let cue = null
let recover = null
for (let s = BASE; s < hunch.length; s++) {
  if (cue === null) {
    const run = hunch.slice(s - M.SUSTAIN + 1, s + 1)
    const win = hunch.slice(Math.max(0, s - M.WINDOW + 1), s + 1).filter((v) => v !== null)
    if (run.every((v) => v !== null && v > M.LINE) && avg(win) > M.LINE) cue = s + 1
  } else if (recover === null && s + 1 - cue >= M.RECOVER_HOLD) {
    const back = hunch.slice(s - M.RECOVER_HOLD + 1, s + 1)
    if (back.every((v) => v !== null && v <= M.LINE)) recover = s + 1
  }
}
// 画面に出す、なめらかな値（直前1秒の平均。アプリの1秒の値と同じ長さで、先のコマは見ない）
const smooth = frames.map((_, k) => {
  const r = frames.slice(Math.max(0, k - 29), k + 1).filter(okM)
  if (!r.length) return null
  const tr = avg(r.map((f) => f.m.trunk))
  const nk = avg(r.map((f) => f.m.neck))
  return { trunk: +tr.toFixed(2), neck: +nk.toFixed(2), hunch: +Math.min(tr - base.trunk, nk - base.neck + M.NECK_SLACK).toFixed(2) }
})
const data = {
  source: { file: mov.split('/').pop(), t0: T0, t1: T1 },
  line: M.LINE,
  sustain: M.SUSTAIN,
  baseSec: BASE,
  base,
  cue,
  recover,
  secs: secs.map((s, i) => s && { trunk: +s.trunk.toFixed(2), neck: +s.neck.toFixed(2), headLean: +s.headLean.toFixed(2), hunch: +hunch[i].toFixed(2) }),
  frames: frames.map((f, k) => ({ p: f.p, ok: okM(f), ...(smooth[k] ?? {}) })),
}
writeFileSync(join(out, 'ss-data.json'), JSON.stringify(data))
console.log('基準', base, '線', M.LINE, '声', cue, '直った', recover)
console.log(data.secs.map((s, i) => `${(T0 + i).toFixed(0)}s ${s ? `上体 ${s.trunk} 首 ${s.neck} 頭 ${s.headLean} 猫背 ${s.hunch}` : '-'}`).join('\n'))
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(T0), '-i', mov, '-t', String(T1 - T0), '-an', '-vf', 'scale=1080:1920,fps=30', '-c:v', 'libx264', '-crf', '18', '-g', '15', '-pix_fmt', 'yuv420p', join(out, 'ss-clip.mp4')])
console.log('書いた', out)

if (pre) {
  const PRE = Number(pre)
  const n2 = Math.round((T1 - T0 + PRE) * FPS)
  const pts = Array.from({ length: n2 }, (_, k) => at(T0 - PRE + k / FPS).p)
  writeFileSync(join(out, 'ss-pts2.json'), JSON.stringify({ pre: PRE, frames: pts }))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(T0 - PRE), '-i', mov, '-t', String(T1 - T0 + PRE), '-an', '-vf', 'scale=1080:1920,fps=30', '-c:v', 'libx264', '-crf', '18', '-g', '15', '-pix_fmt', 'yuv420p', join(out, 'ss-clip2.mp4')])
  console.log('センサーランの場面用も書いた（前の秒', PRE, '）')
}
