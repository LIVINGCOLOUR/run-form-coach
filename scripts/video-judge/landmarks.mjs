// 人の動画で今のカメラ版の判定を試す（1）：動画を切り出して、アプリと同じ骨格の推定で1コマずつの点を取る
//
//   node scripts/video-judge/landmarks.mjs <clips.json> <出力フォルダ> [--only id,id] [--fps 15] [--keep-frames]
//
// clips.json：{ videos: { 名前: 動画のパス（clips.json からの相対でもよい） }, clips: [{ id, video, crop: [幅, 高さ, x, y], from, to }] }
//   時刻は元の動画の秒。ffmpeg で切り抜いて毎秒15コマ（アプリが骨格を取るのと同じ上限 POWER.maxFps）の JPEG にする
// 骨格の推定は、アプリと同じ @mediapipe/tasks-vision・同じモデル（public/models/pose_landmarker_full.task）・同じ設定
//   （VIDEO、numPoses 2、確かさの線 0.7 / 0.7 / 0.5、一番大きく映った1人）で、Google Chrome を画面なしで開いて行う。
//   違いは CPU で動かすこと（アプリは GPU が使えれば GPU）。なめらかにする（One Euro）のは judge.ts の側でする
// 出力：<出力フォルダ>/<id>.json = { id, fps, width, height, frames: [{ t: 元の動画の秒, p: [[x, y, v] × 33]（0〜1）| null }] }
// 動画は自分の手元だけで使う（リポジトリに入れない・どこにも上げない）
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const only = opt('--only')?.split(',')
const FPS = Number(opt('--fps') ?? 15) // ふつうはアプリと同じ毎秒15コマ。着地を細かく見たいときは 30 など
const keep = args.includes('--keep-frames')
const [configPath, outDir] = args.filter((a) => !a.startsWith('--'))
if (!configPath || !outDir) {
  console.error('使い方: node scripts/video-judge/landmarks.mjs <clips.json> <出力フォルダ> [--only id,id] [--fps 15] [--keep-frames]')
  process.exit(1)
}
const root = new URL('../..', import.meta.url).pathname
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const clips = config.clips.filter((c) => !only || only.includes(c.id))
mkdirSync(outDir, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'video-judge-'))

// 1. 切り出し
for (const c of clips) {
  const video = resolve(dirname(configPath), config.videos[c.video])
  const dir = join(work, c.id)
  mkdirSync(dir)
  const [w, h, x, y] = c.crop
  execFileSync('ffmpeg', ['-v', 'error', '-ss', String(c.from), '-to', String(c.to), '-i', video, '-vf', `crop=${w}:${h}:${x}:${y},fps=${FPS}`, '-q:v', '2', join(dir, '%05d.jpg')])
  c.n = readdirSync(dir).length
  c.width = w
  c.height = h
  console.log(`${c.id}: ${c.n} コマ`)
}

// 2. Chrome の中で骨格を取る
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { FilesetResolver, PoseLandmarker } from '/tv/vision_bundle.mjs'
const post = (url, body) => fetch(url, { method: 'POST', body: JSON.stringify(body) })
try {
  const job = await (await fetch('/job')).json()
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe')
  for (const c of job.clips) {
    const lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 2,
      minPoseDetectionConfidence: 0.7, minPosePresenceConfidence: 0.7, minTrackingConfidence: 0.5,
    })
    const frames = []
    for (let i = 0; i < c.n; i++) {
      const img = new Image()
      img.src = '/frames/' + c.id + '/' + String(i + 1).padStart(5, '0') + '.jpg'
      await img.decode()
      const res = lm.detectForVideo(img, Math.round((i * 1000) / job.fps) + 1)
      let best = null, area = -1
      for (const p of res.landmarks) {
        const xs = p.map((q) => q.x), ys = p.map((q) => q.y)
        const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
        if (a > area) { area = a; best = p }
      }
      frames.push({ t: +(c.from + i / job.fps).toFixed(4), p: best && best.map((q) => [+q.x.toFixed(5), +q.y.toFixed(5), +(q.visibility ?? 1).toFixed(3)]) })
    }
    lm.close()
    await post('/result', { id: c.id, fps: job.fps, width: c.width, height: c.height, frames })
  }
  await post('/done', {})
} catch (e) { await post('/error', { message: String(e && e.stack || e) }) }
</script>`

const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.task': 'application/octet-stream' }
const MOUNTS = [
  ['/tv/', join(root, 'node_modules/@mediapipe/tasks-vision/')],
  ['/mediapipe/', join(root, 'node_modules/@mediapipe/tasks-vision/wasm/')],
  ['/models/', join(root, 'public/models/')],
  ['/frames/', work + '/'],
]
let chrome
const finished = new Promise((done, fail) => {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        res.end('ok')
        const data = JSON.parse(body)
        if (url === '/result') {
          writeFileSync(join(outDir, `${data.id}.json`), JSON.stringify(data))
          const seen = data.frames.filter((f) => f.p).length
          console.log(`${data.id}: 骨格 ${seen}/${data.frames.length} コマ`)
        } else if (url === '/done') {
          server.close()
          done()
        } else {
          server.close()
          fail(new Error(data.message))
        }
      })
      return
    }
    if (url === '/') return res.end(PAGE)
    if (url === '/job') return res.end(JSON.stringify({ fps: FPS, clips: clips.map(({ id, n, from, width, height }) => ({ id, n, from, width, height })) }))
    const m = MOUNTS.find(([p]) => url.startsWith(p))
    const file = m && join(m[1], url.slice(m[0].length))
    if (!file || !file.startsWith(m[1]) || !existsSync(file)) {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  })
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(work, 'chrome')}`, `http://127.0.0.1:${port}/`], { stdio: 'ignore' })
  })
})
try {
  await finished
} finally {
  chrome?.kill()
  if (!keep) rmSync(work, { recursive: true, force: true })
  else console.log(`コマの画像: ${work}`)
}
