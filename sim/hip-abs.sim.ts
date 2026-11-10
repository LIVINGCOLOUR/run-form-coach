// 仮想実験（腰の決まった線）：研究データのふつうの走りを、実機の記録のコマの間隔の仮想のスマホで映し、アプリと同じ立脚中期の腰の高さ
//   （geometry の midstance：腰の中心から立脚側の足首までの高さ ÷ 立脚側の脚の長さ。coach.ts の hipOf と同じく、1秒ごとに平均）を出して、
//   ① ふつうの走りの値が、速さごとにどのあたりにあるか（1本の平均、窓のいちばん低い値）
//   ② 同じ人が速さを変えたときの変わり方（RBDS 時速9 → 12.6 → 16.2km、Riglet 楽 → 速い）
//   ③ 決まった線（params.ts の HIP_ABS）の候補ごとに、ふつうの走りで窓（続いた16個の1秒の平均）が線を下回った走りの割合（外れた声になる走り）と、
//      腰を落とした走り（longrun の distort 'sit'：腰から上を脚の長さの何%か下げ、膝を曲げる）で下回った割合
//   を出す。走りは最初の60秒まで（研究データの続き）なので、10分あたりの回数ではなく、走りの割合で見る。
//   人の動画（YouTube の切り出し）とアプリの記録の値は、ここでは扱わない（params.ts の HIP_ABS の説明）
// 動かし方：RBDS_DIR=… RIGLET_DIR=… VH_DIR=… npx vitest run --config sim/vitest.config.ts sim/hip-abs.sim.ts（結果は sim/result-hip-abs.md）
import { describe, it as itAll } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRbdsLanding, loadRigletLanding, loadVhLanding, type LandingTrial } from './landing-data'
import { bodyAt, filmFrames, runningSpan } from './landing-film'
import { distort, groundOf, legLengthMm } from './longrun'
import { midstance } from '../src/modes/camera/geometry'
import { HIP_ABS, HIP_MID } from '../src/modes/camera/params'

const RBDS = process.env.RBDS_DIR
const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-hip-abs.md'
const ANY = !!(RBDS || RIGLET || VH)

// 速さ（時速 km）：RBDS は決まったベルトの速さ、Riglet は印から見積もった速さ（楽 約8.1・速い 約9.8。sim/result-good-speed.md）、Van Hooren はベルト 12km
const KMH: Record<string, number> = { 'rbds-25': 9, 'rbds-35': 12.6, 'rbds-45': 16.2, 'riglet-楽': 8.1, 'riglet-速い': 9.8, 'vh-333': 12 }

function loadAll(): LandingTrial[] {
  const out: LandingTrial[] = []
  const tryPush = (fn: () => LandingTrial, what: string) => {
    try {
      const tr = fn()
      if (tr.contacts.length < 10) throw new Error(`接地が ${tr.contacts.length} 回しかありません`)
      out.push(tr)
    } catch (e) {
      console.log(`使えない：${what}：${(e as Error).message}`)
    }
  }
  if (RBDS) {
    const ids = [...new Set(readdirSync(RBDS).filter((f) => /^RBDS\d+static\.txt$/.test(f)).map((f) => f.slice(0, 7)))].sort()
    for (const id of ids) for (const sp of ['25', '35', '45']) if (existsSync(join(RBDS, `${id}runT${sp}forces.txt`))) tryPush(() => loadRbdsLanding(RBDS, id, sp), `${id} ${sp}`)
  }
  if (RIGLET) {
    for (const id of readdirSync(RIGLET).sort()) {
      for (const [pace, cond] of [['Comfortable', '楽'], ['Fast', '速い']]) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (existsSync(p)) tryPush(() => loadRigletLanding(p, id, cond), `${id} ${pace}`)
      }
    }
  }
  if (VH) for (const f of readdirSync(VH).sort()) if (/^Sub_\d+_333(ms)?\.c3d$/i.test(f)) tryPush(() => loadVhLanding(join(VH, f), f.slice(0, 6), '333'), f)
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const q = (xs: number[], p: number) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
}
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '-')
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-')

// 1本を映して、1秒ごとの立脚中期の腰の高さ（アプリの hipOf と同じ：立脚中期のコマの平均、hipMax を越えたコマは使わない）
function secondsOf(tr: LandingTrial, k: number, sit: number): number[] {
  const [t0, t1] = runningSpan(tr)
  const legMm = legLengthMm(tr)
  const g = groundOf(tr)
  const frames = filmFrames((t) => distort(bodyAt(tr, t), 'sit', sit, legMm, g), t0, t1 - t0, { timing: 'log', seed: 2000 + k })
  const bySec = new Map<number, number[]>()
  for (const { t, f } of frames) {
    const m = midstance(f)
    if (!m || m.hip > HIP_MID.hipMax) continue
    const s = Math.floor(t)
    bySec.set(s, [...(bySec.get(s) ?? []), m.hip])
  }
  return [...bySec.keys()].sort((a, b) => a - b).map((s) => mean(bySec.get(s)!))
}

// 窓：続いた HIP_ABS.window 個の1秒の値の平均（アプリの hipAbs と同じく、個数で取る。研究データは毎秒ほぼ値がある）
function windows(secs: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + HIP_ABS.window <= secs.length; i++) out.push(mean(secs.slice(i, i + HIP_ABS.window)))
  return out
}

interface Rec {
  key: string
  subject: string
  kmh: number
  mean: number
  minWin: number
  sit: Record<number, number> // 腰を落とした量（%）→ 窓のいちばん高い値（どの窓も下回ったか）
}

const SITS = [3, 4, 6, 8]
// 決まった線の候補（速さでは動かさない。② のとおり、立脚中期の腰の高さは速さでほとんど変わらない）
const CANDS = [0.89, 0.9, 0.91, 0.92, 0.93]
const lineAt = (line: number, _kmh: number) => line

describe.skipIf(!ANY)('腰の決まった線（立脚中期の腰の高さ）', () => {
  itAll('研究データのふつうの走りと、腰を落とした走り', () => {
    const trials = loadAll()
    const recs: Rec[] = []
    trials.forEach((tr, k) => {
      const key = `${tr.dataset}-${tr.cond}`
      const kmh = KMH[key]
      if (kmh === undefined) return
      const secs = secondsOf(tr, k, 0)
      const ws = windows(secs)
      if (!ws.length) return
      const sit: Record<number, number> = {}
      for (const s of SITS) sit[s] = Math.max(...windows(secondsOf(tr, k, s)))
      recs.push({ key, subject: `${tr.dataset}-${tr.subject}`, kmh, mean: mean(secs), minWin: Math.min(...ws), sit })
    })
    const L: string[] = []
    L.push('# 腰の決まった線：立脚中期の腰の高さ（仮想実験 sim/hip-abs.sim.ts）', '')
    L.push(
      '研究データのふつうの走り（RBDS：時速9・12.6・16.2km、Riglet：楽・速い〔印から見積もって時速約8.1・9.8km〕、Van Hooren：時速12km）の最初の60秒までを、実機の記録のコマの間隔（平均毎秒12.5コマ）の仮想のスマホ（真横・1.2m・高さ80cm・超広角、点のぶれ1%）で映し、' +
        `アプリと同じ立脚中期の腰の高さ（腰の中心から立脚側の足首までの高さ ÷ 立脚側の脚の長さ。geometry の midstance、1秒ごとに平均）を出した。窓は続いた ${HIP_ABS.window} 個の1秒の平均（HIP_ABS.window）。`,
      '',
    )
    L.push('## ① ふつうの走りの値（1本の平均）', '')
    L.push('| 走り | 本数 | 時速 | 下から1割 | 真ん中 | 上から1割 | 窓のいちばん低い値（下から1割） |', '|---|---|---|---|---|---|---|')
    for (const key of Object.keys(KMH)) {
      const rs = recs.filter((r) => r.key === key)
      if (!rs.length) continue
      L.push(`| ${key} | ${rs.length} | ${KMH[key]} | ${f3(q(rs.map((r) => r.mean), 0.1))} | ${f3(q(rs.map((r) => r.mean), 0.5))} | ${f3(q(rs.map((r) => r.mean), 0.9))} | ${f3(q(rs.map((r) => r.minWin), 0.1))} |`)
    }
    L.push('', '## ② 同じ人が速さを変えたときの変わり方（時速1kmあたり）', '')
    const slopes = (a: string, b: string) => {
      const out: number[] = []
      for (const ra of recs.filter((r) => r.key === a)) {
        const rb = recs.find((r) => r.key === b && r.subject === ra.subject)
        if (rb) out.push((rb.mean - ra.mean) / (rb.kmh - ra.kmh))
      }
      return out
    }
    L.push('| 比べ | 人数 | 真ん中 | 下から1割 | 上から1割 | 下がった人 |', '|---|---|---|---|---|---|')
    for (const [a, b] of [['rbds-25', 'rbds-35'], ['rbds-35', 'rbds-45'], ['riglet-楽', 'riglet-速い']]) {
      const s = slopes(a, b)
      if (!s.length) continue
      L.push(`| ${a} → ${b} | ${s.length} | ${s.length ? (q(s, 0.5) * 1000).toFixed(1) : '-'}／1000 | ${(q(s, 0.1) * 1000).toFixed(1)} | ${(q(s, 0.9) * 1000).toFixed(1)} | ${s.filter((x) => x < 0).length} |`)
    }
    L.push('', 'そこで、決まった線は速さで動かさない。', '')
    L.push('## ③ 決まった線の候補（どの速さでも同じ線）', '')
    L.push(
      'ふつう：ふつうの走りで、窓が一度でも線を下回った走りの割合（そのまま声にすると外れた声になる走り）。腰 n%：腰を脚の長さの n% 落とした走りで、どの窓も線を下回った割合（気づく割合）',
      '',
    )
    L.push(`| 線 | ふつう（${recs.length}本） | ${SITS.map((s) => `腰 ${s}%`).join(' | ')} |`, `|---|---|${SITS.map(() => '---').join('|')}|`)
    for (const c of CANDS) {
      const fp = recs.filter((r) => r.minWin < lineAt(c, r.kmh)).length
      const det = SITS.map((s) => pct(recs.filter((r) => r.sit[s] < lineAt(c, r.kmh)).length, recs.length))
      L.push(`| ${c.toFixed(2)}${c === HIP_ABS.line ? '（いま）' : ''} | ${fp}本（${pct(fp, recs.length)}） | ${det.join(' | ')} |`)
    }
    L.push('')
    writeFileSync(OUT, L.join('\n'))
    console.log(L.join('\n'))
  })
})
