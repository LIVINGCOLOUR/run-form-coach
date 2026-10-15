// 2本目の紹介動画の確認用：指定したコマを PNG にし、1枚の一覧（out/modes-sheet.png）に並べる
//   node scripts/stills-modes.mjs [出力フォルダ] [コマ番号...]
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const [dir = join(root, 'out/modes-stills'), ...rest] = process.argv.slice(2)
const frames = rest.map(Number)
mkdirSync(dir, { recursive: true })
const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts') })
const composition = await selectComposition({ serveUrl, id: 'Modes' })
const files = []
for (const frame of frames) {
  const output = join(dir, `m${String(frame).padStart(4, '0')}.png`)
  await renderStill({ serveUrl, composition, frame, output, scale: 0.5 })
  files.push(output)
  console.log(frame, output)
}
if (process.env.SHEET) {
  const cols = 4
  const inputs = files.flatMap((f) => ['-i', f])
  const n = files.length
  const layout = files.map((_, i) => `${(i % cols) * 540}_${Math.floor(i / cols) * 960}`).join('|')
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `xstack=inputs=${n}:layout=${layout}:fill=black`, process.env.SHEET])
  console.log('sheet', process.env.SHEET)
}
