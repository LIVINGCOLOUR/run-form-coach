// 採点（npm run grade）を試すための見本を作る：区間の記録（drill-sample-….json）と、同じ時間のカメラ版・スマホ版の作りものの記録。
// 使い方: node scripts/treadmill/make-sample.mjs <置き場所のフォルダ> [--steps a,b,…] [--full]
//   --full  カメラ版を全コマ記録（?full=1 で撮ったとき）の形で作る
// 区間は npm run drill の既定の並び（言い終わりまで3.5秒かかったことにする）。値の作り方は scripts/treadmill/sample.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'
import { buildPlan, stamp } from './plan.mjs'

const args = process.argv.slice(2)
const i = args.indexOf('--steps')
const steps = i >= 0 ? args.splice(i, 2)[1].split(',') : undefined
const fi = args.indexOf('--full')
const full = fi >= 0 && !!args.splice(fi, 1)
const dir = args[0]
if (!dir) {
  console.error('使い方: node scripts/treadmill/make-sample.mjs <置き場所のフォルダ> [--steps a,b,…] [--full]')
  process.exit(1)
}
const root = new URL('../..', import.meta.url).pathname
const bundle = join(root, 'node_modules/.tmp/treadmill-sample.mjs')
await build({ input: join(root, 'scripts/treadmill/sample.ts'), platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const { makeCameraSample, makePhoneSample } = await import(pathToFileURL(bundle).href)

const plan = buildPlan({ steps })
const t0 = new Date(2026, 9, 19, 17, 0, 0).getTime()
const sections = plan.sections.map((s, k) => {
  const announceAt = t0 + s.plannedStart * 1000
  const next = plan.sections[k + 1]
  return { key: s.key, kind: s.kind, name: s.name, kmh: s.kmh, after: s.after, plannedStart: s.plannedStart, plannedSec: s.plannedSec, announceAt, start: announceAt + 3500, end: t0 + (next ? next.plannedStart : plan.total) * 1000 }
})
const jumpAt = t0 + plan.cues.find((c) => c.jump).at * 1000
const drill = { kind: 'treadmill-drill', version: 1, clock: 'mac', startedAt: t0, options: plan.options, voice: 'Kyoko', note: '見本（作りもの）', plan: [], sections, jumpAt, said: [], done: true, endedAt: t0 + plan.total * 1000 }
mkdirSync(dir, { recursive: true })
const name = stamp(t0)
const ss = sections.map((s) => ({ key: s.key, kind: s.kind, start: s.start, end: s.end }))
const files = {
  [`drill-sample-${name}.json`]: drill,
  [`rfc-sample-${name}.json`]: makeCameraSample(ss, jumpAt, 1, full),
  [`rfc-phone-sample-${name}.json`]: makePhoneSample(ss, jumpAt),
}
for (const [f, data] of Object.entries(files)) writeFileSync(join(dir, f), JSON.stringify(data))
console.log(`見本を作りました → ${dir}`)
console.log(`npm run grade -- ${Object.keys(files).map((f) => join(dir, f)).join(' ')}`)
