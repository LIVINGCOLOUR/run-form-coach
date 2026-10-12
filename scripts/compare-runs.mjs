// スマホ版とカメラ版を同時に記録した2つの書き出しを、時刻を合わせて比べる（実機テスト①、docs/phone-test1.md）
// 使い方: npm run compare -- <rfc-phone-….json> <rfc-….json（カメラ版）> [--out フォルダ] [--offset 秒] [--labels normal1,slow,…]
//   --out：結果を置くフォルダ（既定は compare-out/<スマホのファイル名>/）
//   --offset：カメラの時刻 = スマホの時刻 + この秒数、と手で決める（自動で合わせられなかったとき）
//   --labels：走った区間の名前を順に渡す（区間の数が手順書と合わなかったとき）。名前は src/modes/phone/compare.ts の TEST1 の key
// 出すもの：report.md（関門の目安・時刻の合わせ方・区間ごとの表）、chart.svg（ピッチ・上下動・ブレーキの図）、
//   bursts.csv（カメラのかたまりごとの値と、同じ時間のスマホの値）、seconds.csv（スマホの1秒ごとの値と区間）
// 中身の計算は src/modes/phone/compare.ts（テストは compare.test.ts）。ここでは、それを1つのファイルにまとめて動かすだけ
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const out = opt('--out')
const offset = opt('--offset')
const labels = opt('--labels')
const [phonePath, cameraPath] = args
if (!phonePath || !cameraPath) {
  console.error('使い方: npm run compare -- <スマホ版の書き出し.json> <カメラ版の書き出し.json> [--out フォルダ] [--offset 秒] [--labels a,b,…]')
  process.exit(1)
}

const root = new URL('..', import.meta.url).pathname
const bundle = join(root, 'node_modules/.tmp/compare-runs.mjs')
await build({ input: join(root, 'src/modes/phone/compare.ts'), platform: 'node', logLevel: 'warn', output: { file: bundle, format: 'esm' } })
const { compare, report, chartSvg, burstsCsv, secondsCsv } = await import(pathToFileURL(bundle).href)

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const c = compare(read(phonePath), read(cameraPath), {
  offset: offset === undefined ? undefined : Number(offset),
  labels: labels?.split(','),
})
const dir = out ?? join('compare-out', basename(phonePath, '.json'))
mkdirSync(dir, { recursive: true })
const md = report(c)
writeFileSync(join(dir, 'report.md'), md)
writeFileSync(join(dir, 'chart.svg'), chartSvg(c))
writeFileSync(join(dir, 'bursts.csv'), burstsCsv(c))
writeFileSync(join(dir, 'seconds.csv'), secondsCsv(c))
console.log(md)
console.log(`→ ${dir}/（report.md・chart.svg・bursts.csv・seconds.csv）`)
