// 本人の画面収録（YouTube の場面）から、アプリと同じ骨格の推定で1コマずつの点の数字だけを取り出す（検証用。runform-gemini の validation）
//
//   npm run rec:landmarks -- <録画のフォルダ（例 ~/Movies/rfc-rec）> [--out <出力フォルダ>] [--only A01-bad,B01] [--force]
//                            [--pad 2] [--hi 30] [--to <秒>] [--crop 幅:高さ:x:y]
//
// 録画（.mov / .mp4 / .m4v）1本ごとに <出力フォルダ>/<名前>.json.gz（既定は ~/Developer/runform-gemini/landmarks/）を書く。中身は数字だけ：
//   { name, source: { file, width, height, fps, duration }, pose: 骨格の推定の設定, pad,
//     frames:   毎秒15コマ（アプリのカメラ版と同じ上限 POWER.maxFps）の点 [{ t: 録画の秒, p: [[x, y, z, visibility] × 33]（x・y は 0〜1）| null }],
//     framesHi: 毎秒30コマ（--hi。スロー分析・着地を細かく見る用）の点（同じ形）,
//     summary:  アプリのコード（scripts/rec-landmarks/summary.ts → video-judge/judge.ts → src/）で測った区間のまとめ }
//   まとめの区間は、録画の頭とおしりの --pad 秒（既定2秒。録画の手順で前後に2秒ずつ足している）を除いたところ。
//   ほかに <出力フォルダ>/index.json に、全部の録画のまとめの短い表を書く
// 骨格の推定は、アプリと同じ @mediapipe/tasks-vision・同じモデル（public/models/pose_landmarker_full.task）・同じ設定
//   （VIDEO、numPoses 2、確かさの線 0.7 / 0.7 / 0.5、一番大きく映った1人）で、Google Chrome を画面なしで開いて行う
//   （scripts/video-judge/landmarks.mjs と同じやり方。Playwright は使わない）。違いは CPU で動かすこと（アプリは GPU が使えれば GPU）
// コマの画像は一時フォルダ（OS の tmp）にだけ作り、終わったら消す。画像も動画も、出力にもリポジトリにも入れない。
// 録画はこの Mac の外に出さない（本人だけの検証用）
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'rolldown'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const POSE = { model: 'pose_landmarker_full.task', runningMode: 'VIDEO', numPoses: 2, minPoseDetectionConfidence: 0.7, minPosePresenceConfidence: 0.7, minTrackingConfidence: 0.5, delegate: 'CPU', pick: 'largest' }

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
const outDir = resolve(expand(opt('--out') ?? '~/Developer/runform-gemini/landmarks'))
const only = opt('--only')?.split(',')
const PAD = Number(opt('--pad') ?? 2)
const HI = Number(opt('--hi') ?? 30)
const toSec = opt('--to') // 試すとき用：録画の頭からこの秒までだけ
const crop = opt('--crop') // 幅:高さ:x:y（ピクセル。録画で切り抜けなかったとき）
const force = args.includes('--force')
const [inDirArg] = args.filter((a) => !a.startsWith('--'))
if (!inDirArg) {
  console.error('使い方: npm run rec:landmarks -- <録画のフォルダ> [--out <出力フォルダ>] [--only 名前,名前] [--force] [--pad 2] [--hi 30] [--to 秒] [--crop 幅:高さ:x:y]')
  process.exit(1)
}
const inDir = resolve(expand(inDirArg))
const root = new URL('..', import.meta.url).pathname
const LOW = 15 // アプリのカメラ版の上限（src/core/params.ts の POWER.maxFps）

const files = readdirSync(inDir)
  .filter((f) => ['.mov', '.mp4', '.m4v'].includes(extname(f).toLowerCase()))
  .filter((f) => !only || only.includes(basename(f, extname(f))))
  .sort()
if (!files.length) {
  console.error(`録画が見つかりません: ${inDir}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

// アプリの測り方（summary.ts）を読み込む
const bundle = join(root, 'node_modules/.tmp/rec-landmarks.mjs')
mkdirSync(dirname(bundle), { recursive: true })
await build({ input: join(root, 'scripts/rec-landmarks/summary.ts'), platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const S = await import(pathToFileURL(bundle).href)

const probe = (file) => {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,duration:format=duration', '-of', 'json', file], { encoding: 'utf8' }))
  const s = j.streams[0]
  const [a, b] = s.avg_frame_rate.split('/').map(Number)
  return { width: s.width, height: s.height, fps: b ? a / b : NaN, duration: Number(s.duration ?? j.format.duration) }
}

const work = mkdtempSync(join(tmpdir(), 'rec-landmarks-'))
const jobs = []
for (const f of files) {
  const name = basename(f, extname(f))
  const out = join(outDir, `${name}.json.gz`)
  if (existsSync(out) && !force) {
    console.log(`${name}: もうある（--force で取り直す）`)
    continue
  }
  const src = join(inDir, f)
  const info = probe(src)
  const [cw, ch, cx, cy] = crop ? crop.split(':').map(Number) : [info.width, info.height, 0, 0]
  const hi = Math.min(HI, Math.round(info.fps) || HI)
  const passes = []
  for (const [key, fps] of [['frames', LOW], ['framesHi', hi]]) {
    const dir = join(work, `${name}-${key}`)
    mkdirSync(dir)
    const vf = [crop ? `crop=${cw}:${ch}:${cx}:${cy}` : null, `fps=${fps}`].filter(Boolean).join(',')
    execFileSync('ffmpeg', ['-v', 'error', ...(toSec ? ['-t', toSec] : []), '-i', src, '-vf', vf, '-q:v', '2', join(dir, '%05d.jpg')])
    passes.push({ id: `${name}-${key}`, key, fps, n: readdirSync(dir).length })
  }
  console.log(`${name}: ${cw}x${ch}（元 ${info.width}x${info.height}・毎秒${info.fps.toFixed(1)}コマ・${info.duration.toFixed(1)}秒）→ ${passes.map((p) => `${p.n}コマ（毎秒${p.fps}）`).join('・')}`)
  jobs.push({ name, out, file: f, info, width: cw, height: ch, passes, results: {} })
}

// Chrome の中で骨格を取る（landmarks.mjs と同じページ。z も取る）
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { FilesetResolver, PoseLandmarker } from '/tv/vision_bundle.mjs'
const post = (url, body) => fetch(url, { method: 'POST', body: JSON.stringify(body) })
try {
  const job = await (await fetch('/job')).json()
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe')
  for (const c of job.passes) {
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
      const res = lm.detectForVideo(img, Math.round((i * 1000) / c.fps) + 1)
      let best = null, area = -1
      for (const p of res.landmarks) {
        const xs = p.map((q) => q.x), ys = p.map((q) => q.y)
        const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
        if (a > area) { area = a; best = p }
      }
      frames.push({ t: +(i / c.fps).toFixed(4), p: best && best.map((q) => [+q.x.toFixed(5), +q.y.toFixed(5), +(q.z ?? 0).toFixed(5), +(q.visibility ?? 1).toFixed(3)]) })
    }
    lm.close()
    await post('/result', { id: c.id, frames })
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
const allPasses = jobs.flatMap((j) => j.passes.map((p) => ({ ...p, job: j })))
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-')
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const index = existsSync(join(outDir, 'index.json')) ? JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8')) : {}

// 1本ぶんの点がそろったら、まとめを出して書く
const finishJob = (j) => {
  const toJudge = (frames) => ({ id: j.name, fps: 0, width: j.width, height: j.height, frames: frames.map((fr) => ({ t: fr.t, p: fr.p && fr.p.map(([x, y, , v]) => [x, y, v]) })) })
  const frames = j.results.frames
  const end = frames.length ? frames[frames.length - 1].t : 0
  const from = Math.min(PAD, end / 2)
  const to = Math.max(from, end - PAD)
  let summary = null
  try {
    summary = S.summarize(toJudge(frames), j.results.framesHi ? toJudge(j.results.framesHi) : null, from, to)
  } catch (e) {
    summary = { error: String(e?.message ?? e) }
  }
  const rec = {
    name: j.name,
    source: { file: j.file, width: j.info.width, height: j.info.height, fps: +j.info.fps.toFixed(3), duration: +j.info.duration.toFixed(3), crop: crop ?? null, analysedWidth: j.width, analysedHeight: j.height },
    pose: POSE,
    pad: PAD,
    lines: S.LINES,
    fps: { frames: LOW, framesHi: j.passes.find((p) => p.key === 'framesHi').fps },
    frames,
    framesHi: j.results.framesHi,
    summary,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(j.out, gzipSync(JSON.stringify(rec)))
  const a = summary?.app
  const seen = frames.filter((x) => x.p).length
  index[j.name] = a
    ? { seen: +(seen / Math.max(1, frames.length)).toFixed(3), visible: +a.visibleRatio.toFixed(3), moving: +a.movingRatio.toFixed(3), cadence: summary.landing?.cadence ?? null, cadenceMotion: a.cadence, body: a.body, trunk: a.trunk, neck: a.neck, headLean: a.headLean, hip: a.hipRatio, yaw: a.yaw, landRes: summary.landing?.res ?? null, landHeel: summary.landing?.heel ?? null, speedLeg: summary.landing?.speed ?? null, footAhead: summary.slowmo?.footAhead ?? null, cues: summary.coach.cues.map((c) => c.item) }
    : { seen, error: summary?.error ?? 'まとめなし' }
  console.log(
    a
      ? `${j.name}: 骨格 ${seen}/${frames.length}・見えた ${Math.round(a.visibleRatio * 100)}%・走る ${Math.round(a.movingRatio * 100)}%｜体全体 ${f1(a.body)}° 上体 ${f1(a.trunk)}° 首 ${f1(a.neck)}° 頭の位置 ${f1(a.headLean)}° 腰 ${f2(a.hipRatio)}｜着地 ${f2(summary.landing?.res)}（かかと ${f2(summary.landing?.heel)}、速さの目安 ${f2(summary.landing?.speed)}）｜ピッチ ${Math.round(summary.landing?.cadence) || '-'}（歩数の数え方 ${Math.round(a.cadence) || '-'}）｜声 ${summary.coach.cues.map((c) => c.item).join(',') || 'なし'}`
      : `${j.name}: 骨格 ${seen}/${frames.length}・まとめを出せない（${index[j.name].error}）`,
  )
}

let chrome
if (allPasses.length) {
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
            const p = allPasses.find((x) => x.id === data.id)
            p.job.results[p.key] = data.frames
            rmSync(join(work, p.id), { recursive: true, force: true }) // 終わったコマの画像はすぐ消す
            if (p.job.passes.every((q) => p.job.results[q.key])) finishJob(p.job)
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
      if (url === '/job') return res.end(JSON.stringify({ passes: allPasses.map(({ id, n, fps }) => ({ id, n, fps })) }))
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
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((r) => chrome.once('exit', r))
      chrome.kill()
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
} else rmSync(work, { recursive: true, force: true })
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1))
console.log(`書いた: ${outDir}`)
