// 研究データから、見本の走り（基準のフォーム）を作る
// 使い方: node scripts/build-reference.mjs <RBDS の processed.txt を置いたフォルダ>
//   データ: Fukuchi RK, Fukuchi CA, Duarte M (2017) A public data set of running biomechanics and the effects of
//   running speed on lower extremity kinematics and kinetics. PeerJ 5:e3298. https://doi.org/10.7717/peerj.3298
//   置き場: https://doi.org/10.6084/m9.figshare.4543435 （CC BY 4.0）
// 秒速3.5m と 4.5m のデータ（左右の脚それぞれを1本として数える）を合わせて、秒速4.0m（キロ4分10秒、サブ3のペース）
// 相当にする。角度は矢状面（前後）だけ：股関節の屈曲、膝の屈曲、足首の背屈
//   見本（ideal）：着地のすねが鉛直に近い上位4分の1の脚の平均。データ全体の平均は、ふつうの市民ランナーの走り
//     （かかとから着く人が多く、すねは平均で前に約17°倒れて着く）で、きれいなフォームの見本にはならないため
//   ふつうの範囲（normal）：全員の平均と標準偏差。見本からのずれを説明するときの比較に使う
//   着地のすねの角度は、股関節の角度から骨盤の前傾ぶんを引いて求める。前傾はデータにないので、接地中に膝が
//     一番曲がる瞬間に足首が腰の真下に来るとして、脚ごとに決める
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('使い方: node scripts/build-reference.mjs <RBDS のフォルダ>')
  process.exit(1)
}
const root = new URL('..', import.meta.url).pathname
const files = readdirSync(dir).filter((f) => /^RBDS\d+processed\.txt$/.test(f)).sort()

function speed(spd) {
  const limbs = []
  const stance = []
  const subjects = new Set()
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').trim().split('\n')
    const head = lines[0].split('\t')
    const col = Object.fromEntries(head.map((h, i) => [h, i]))
    const rows = lines.slice(1).map((l) => l.split('\t'))
    for (const s of ['R', 'L']) {
      const names = ['hip', 'knee', 'ankle'].map((j) => `${s}${j}AngZ${spd}`)
      if (!names.every((n) => n in col)) continue
      const curves = names.map((n) => rows.map((r) => Number(r[col[n]])))
      if (curves.flat().some((x) => !Number.isFinite(x))) continue
      // 床反力が NaN になったところが離地
      const grf = rows.map((r) => r[col[`${s}grfZ${spd}`]]?.trim().toLowerCase())
      const to = grf.findIndex((x) => x === 'nan')
      const [hip, knee] = curves
      const end = to > 0 ? to : 36
      let mid = 0
      for (let i = 0; i < end; i++) if (knee[i] > knee[mid]) mid = i
      const tilt = hip[mid] - knee[mid] / 2
      limbs.push({ curves, stance: end, shank: hip[0] - tilt - knee[0], subject: f, speed: spd })
    }
  }
  return limbs
}

const all = [...speed('35'), ...speed('45')]
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))
const r1 = (x) => Math.round(x * 10) / 10
// 3.5m/s と 4.5m/s を同じ重みにするため、速さごとに平均してから平均する
const bySpeed = (limbs, fn) => mean(['35', '45'].map((v) => fn(limbs.filter((l) => l.speed === v))).filter((x) => Number.isFinite(x)))
const band = (limbs, j) => [
  Array.from({ length: 101 }, (_, i) => r1(bySpeed(limbs, (ls) => mean(ls.map((l) => l.curves[j][i]))))),
  Array.from({ length: 101 }, (_, i) => r1(bySpeed(limbs, (ls) => sd(ls.map((l) => l.curves[j][i]))))),
]
const best = all.slice().sort((a, b) => a.shank - b.shank).slice(0, Math.round(all.length / 4))
const summary = (limbs) => ({
  limbs: limbs.length,
  runners: new Set(limbs.map((l) => l.subject)).size,
  stancePct: r1(bySpeed(limbs, (ls) => mean(ls.map((l) => l.stance)))),
  shankAtContact: [r1(mean(limbs.map((l) => l.shank))), r1(sd(limbs.map((l) => l.shank)))],
  hip: band(limbs, 0),
  knee: band(limbs, 1),
  ankle: band(limbs, 2),
})
const ideal = summary(best)
const normal = summary(all)
const out = {
  source: 'Fukuchi RK, Fukuchi CA, Duarte M (2017) PeerJ 5:e3298. doi:10.7717/peerj.3298 / data: doi:10.6084/m9.figshare.4543435 (CC BY 4.0)',
  note: '秒速3.5m と 4.5m を合わせたもの。角度は度、1周を0〜100%（その脚の接地が0%）。[平均, 標準偏差]',
  speedMs: 4.0,
  // 論文の表のピッチ（1分あたりの1周の数）：3.5m/s 85.68、4.5m/s 91.74 → 歩数は2倍
  cadence: Math.round(((85.68 + 91.74) / 2) * 2),
  ideal,
  normal,
}
writeFileSync(join(root, 'src/modes/camera/reference.json'), JSON.stringify(out))
console.log(`cadence ${out.cadence} | ideal: ${ideal.limbs} limbs / ${ideal.runners} runners, stance ${ideal.stancePct}%, shank ${ideal.shankAtContact} | normal: ${normal.limbs} limbs / ${normal.runners} runners, stance ${normal.stancePct}%, shank ${normal.shankAtContact}`)
