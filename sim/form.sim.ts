// 仮想実験（正しいフォームの線）：研究データの走りを仮想のスマホで映し、
//   ① スマホが真横から前側・後ろ側にずれたとき、測る値（前側・後ろ側の値 yawSign、首の角度、頭の位置、上体、体全体）が1°あたりどれだけ動くか
//   ② ふつうに走ったときの値（上体・体全体）の人による散らばり（決まった線を置く前に、ふつうの人がどこにいるかを見る）
// を出す。頭の値は、研究データの頭の印から作った耳と、MediaPipe の耳の点で大きく違う（params.ts の FORM の頭の説明）ので、②③では見ない
// 動かし方：RIGLET_DIR=<Riglet のデータ> VH_DIR=<Van Hooren のデータ> npx vitest run --config sim/vitest.config.ts sim/form.sim.ts
import { describe, it as itAll } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRiglet } from './riglet'
import { loadUpper } from './vanhooren'
import { LongRun, type Source } from './longrun'
import { film, BASE, BASE_NOISE, type Stream } from './pipeline'
import { FORM } from '../src/modes/camera/params'

const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-form.md'
const SEC = 40 // 測る長さ（秒）
const F = 11 // pipeline.ts の1コマの記録の列の数

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.round(p * (s.length - 1))]
}

// 見えたコマの平均（首・頭の位置・前側後ろ側・上体・体全体）
function avgOf(s: Stream) {
  const acc = { neck: [] as number[], headLean: [] as number[], yaw: [] as number[], trunk: [] as number[], body: [] as number[] }
  for (let i = 0; i < s.n; i++) {
    const j = i * F
    if (s.d[j + 1] !== 1) continue
    acc.neck.push(s.d[j + 3])
    acc.headLean.push(s.d[j + 4])
    acc.yaw.push(s.d[j + 5])
    acc.trunk.push(s.d[j + 6])
    acc.body.push(s.d[j + 7])
  }
  return { neck: mean(acc.neck), headLean: mean(acc.headLean), yaw: mean(acc.yaw), trunk: mean(acc.trunk), body: mean(acc.body) }
}

function rigletRuns(): { id: string; run: LongRun }[] {
  if (!RIGLET) return []
  const out: { id: string; run: LongRun }[] = []
  for (const id of readdirSync(RIGLET).sort()) {
    for (const pace of ['Comfortable', 'Fast']) {
      const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
      if (!existsSync(p)) continue
      try {
        const src = loadRiglet(p, `${id}-${pace === 'Fast' ? '速い' : '楽'}`) as Source
        if (src.frames / src.fps < 20) continue
        const run = new LongRun()
        run.append(src, SEC, out.length + 1)
        out.push({ id: src.id, run })
      } catch {
        // 使えない記録は飛ばす
      }
    }
  }
  return out
}

describe.skipIf(!RIGLET)('Riglet：真横からのずれと測る値', () => {
  itAll('スマホの向きを振る', () => {
    const runs = rigletRuns()
    const yaws = [-10, -5, 0, 5, 10, 15, 20]
    const per = yaws.map((yaw) => runs.map((r, k) => avgOf(film({ sec: SEC, seed: 31 + k, pl: { ...BASE, yaw }, noise: BASE_NOISE, body: (t) => r.run.at(t) }))))
    const i0 = yaws.indexOf(0)
    const keys = ['yaw', 'neck', 'headLean', 'trunk', 'body'] as const
    let text =
      `## ① スマホの向き（真横からのずれ）と、走っているときに測る値\n\n` +
      `Riglet の${runs.length}本（${new Set(runs.map((r) => r.id.split('-')[0])).size}人、楽なペースと速いペース）を${SEC}秒ずつ、真横・1.2m・高さ80cm・超広角・ぶれ1%のスマホを、` +
      `体の中心のまわりに前側（正）・後ろ側（負）へ回して映した。値は見えたコマの平均の、本数の平均（カッコ内は真横との差、±は人によるばらつき）。\n\n` +
      `| 向き | 前側・後ろ側の値（yawSign） | 首の角度 | 頭の位置 | 上体 | 体全体 |\n|---|---|---|---|---|---|\n`
    for (const [i, yaw] of yaws.entries()) {
      const cells = keys.map((k) => {
        const v = per[i].map((x) => x[k])
        const d = per[i].map((x, n) => x[k] - per[i0][n][k])
        const dig = k === 'yaw' ? 3 : 1
        return i === i0 ? `${mean(v).toFixed(dig)}（±${sd(v).toFixed(dig)}）` : `${mean(v).toFixed(dig)}（${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(dig)}、±${sd(d).toFixed(dig)}）`
      })
      text += `| ${yaw > 0 ? `前側${yaw}°` : yaw < 0 ? `後ろ側${-yaw}°` : '真横'} | ${cells.join(' | ')} |\n`
    }
    // 1°あたり（−5°〜+15°の傾き）
    const slope = (k: (typeof keys)[number]) => {
      const xs: number[] = []
      const ys: number[] = []
      for (const [i, yaw] of yaws.entries()) {
        if (yaw < -5 || yaw > 15) continue
        for (const [n, x] of per[i].entries()) {
          xs.push(yaw)
          ys.push(x[k] - per[i0][n][k])
        }
      }
      const mx = mean(xs)
      const my = mean(ys)
      return mean(xs.map((x, n) => (x - mx) * (ys[n] - my))) / mean(xs.map((x) => (x - mx) ** 2))
    }
    text += `\n1°あたり（前側へ。−5°〜+15°の直線の傾き）：yawSign ${slope('yaw').toFixed(4)}、首の角度 ${slope('neck').toFixed(2)}°、頭の位置 ${slope('headLean').toFixed(2)}°、上体 ${slope('trunk').toFixed(2)}°、体全体 ${slope('body').toFixed(2)}°\n`
    console.log(text)
    writeFileSync(OUT, text)
  })
})

// ③ 決まった線の候補ごとに、ふつうに走った10分のうち、窓（FORM.window 秒）の平均が一度でも線を越えた走りの数（実機なみのゆっくりしたずれを足す）
describe.skipIf(!RIGLET && !VH)('決まった線の候補と、ふつうの走り', () => {
  itAll('窓の平均が線を越えた走り', () => {
    const EXTRA = { neck: [1.8, 3], trunk: [0.35, 3], body: [0.4, 120] } as const
    const runs: { id: string; run: LongRun }[] = []
    if (RIGLET) {
      for (const id of readdirSync(RIGLET).sort()) {
        for (const pace of ['Comfortable', 'Fast']) {
          const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
          if (!existsSync(p)) continue
          try {
            const src = loadRiglet(p, `${id}-${pace === 'Fast' ? '速い' : '楽'}`) as Source
            if (src.frames / src.fps < 20) continue
            const run = new LongRun()
            run.append(src, 600, runs.length + 1)
            runs.push({ id: src.id, run })
          } catch {
            // 使えない記録は飛ばす
          }
        }
      }
    }
    if (VH) {
      const files = readdirSync(VH)
      const subs = [...new Set(files.filter((f) => /^Sub_\d+_333(ms)?\.c3d$/.test(f)).map((f) => f.slice(0, 6)))].sort()
      subs.forEach((s, k) => {
        const nf = files.find((f) => f === `${s}_333ms.c3d` || f === `${s}_333.c3d`)!
        try {
          const run = new LongRun()
          run.append(loadUpper(join(VH, nf), s) as Source, 600, 500 + k)
          runs.push({ id: `VH-${s}`, run })
        } catch {
          // 胸骨の印がない人などは飛ばす
        }
      })
    }
    const W = FORM.window
    const per = runs.map((r, k) => {
      const s = film({ sec: 600, seed: 91 + k, pl: BASE, noise: BASE_NOISE, extra: { neck: [...EXTRA.neck], trunk: [...EXTRA.trunk], body: [...EXTRA.body] }, body: (t) => r.run.at(t) })
      const sec: { trunk: number; body: number }[] = []
      for (let t0 = 0; t0 < 600; t0++) {
        const tr: number[] = []
        const bd: number[] = []
        for (let i = t0 * 15; i < (t0 + 1) * 15 && i < s.n; i++) {
          const j = i * F
          if (s.d[j + 1] !== 1) continue
          tr.push(s.d[j + 6])
          bd.push(s.d[j + 7])
        }
        if (tr.length >= 3) sec.push({ trunk: mean(tr), body: mean(bd) })
      }
      const win: { trunk: number; body: number }[] = []
      for (let i = W; i <= sec.length; i++) {
        const w = sec.slice(i - W, i)
        win.push({ trunk: mean(w.map((x) => x.trunk)), body: mean(w.map((x) => x.body)) })
      }
      return { id: r.id, win }
    })
    const now = (v: number, line: number) => (v === line ? '（今）' : '')
    const lines: { label: string; hit: (w: { trunk: number; body: number }) => boolean }[] = [
      ...[5, 5.5, 6, 6.5, 7].map((v) => ({ label: `体全体 < ${v}°${now(v, FORM.body.min)}`, hit: (w: { body: number }) => w.body < v })),
      ...[13, 14, 15, 16].map((v) => ({ label: `体全体 > ${v}°${now(v, FORM.body.max)}`, hit: (w: { body: number }) => w.body > v })),
      ...[10, 11, 12].map((v) => ({ label: `上体 > ${v}°${now(v, FORM.trunk.max)}`, hit: (w: { trunk: number }) => w.trunk > v })),
      ...[1, 0, -1, -2].map((v) => ({ label: `上体 < ${v}°${now(v, FORM.trunk.min)}`, hit: (w: { trunk: number }) => w.trunk < v })),
    ]
    let text =
      `## ③ 決まった線の候補と、ふつうの走り（${per.length}本、10分ずつ）\n\n` +
      `Riglet と Van Hooren のふつうの走りを10分にのばし、実機なみのゆっくりしたずれ（${JSON.stringify(EXTRA)}）を足して映した。` +
      `${W}秒平均（アプリが正しいフォームの線と比べる長さ）が一度でも線を越えた走りの数と、越えていた${W}秒平均の割合（全部の走りの平均）。` +
      `仮想のランナーは直さないので、越えた走りには、アプリは整える間かそのあとに声をかける（1回の走りで${FORM.tries}回まで、そのあとは${FORM.later / 60}分に1回）。\n\n| 線 | 越えた走り | 越えていた割合 |\n|---|---|---|\n`
    for (const l of lines) {
      const runsHit = per.filter((p) => p.win.some(l.hit))
      const share = mean(per.map((p) => p.win.filter(l.hit).length / Math.max(1, p.win.length)))
      text += `| ${l.label} | ${runsHit.length} / ${per.length}${runsHit.length && runsHit.length <= 6 ? `（${runsHit.map((p) => p.id).join('・')}）` : ''} | ${(share * 100).toFixed(1)}% |\n`
    }
    console.log(text)
    writeFileSync(OUT.replace(/\.md$/, '-lines.md'), text)
  })
})

describe.skipIf(!RIGLET && !VH)('ふつうに走ったときの上体と体全体（人による散らばり）', () => {
  itAll('散らばり', () => {
    const rows: string[] = []
    const add = (label: string, xs: { trunk: number; body: number }[]) => {
      const t = xs.map((x) => x.trunk)
      const b = xs.map((x) => x.body)
      rows.push(`| ${label} | ${xs.length} | ${q(t, 0).toFixed(1)} / ${q(t, 0.1).toFixed(1)} / ${q(t, 0.5).toFixed(1)} / ${q(t, 0.9).toFixed(1)} / ${q(t, 1).toFixed(1)} | ${q(b, 0).toFixed(1)} / ${q(b, 0.1).toFixed(1)} / ${q(b, 0.5).toFixed(1)} / ${q(b, 0.9).toFixed(1)} / ${q(b, 1).toFixed(1)} |`)
    }
    const rr = rigletRuns()
    for (const pace of ['楽', '速い']) {
      const rs = rr.filter((r) => r.id.endsWith(pace))
      if (rs.length) add(`Riglet（${pace}）`, rs.map((r, k) => avgOf(film({ sec: SEC, seed: 51 + k, pl: BASE, noise: BASE_NOISE, body: (t) => r.run.at(t) }))))
    }
    if (VH) {
      const files = readdirSync(VH)
      const subs = [...new Set(files.filter((f) => /^Sub_\d+_333(ms)?\.c3d$/.test(f)).map((f) => f.slice(0, 6)))].sort()
      const xs: { trunk: number; body: number }[] = []
      subs.forEach((s, k) => {
        const nf = files.find((f) => f === `${s}_333ms.c3d` || f === `${s}_333.c3d`)!
        try {
          const run = new LongRun()
          run.append(loadUpper(join(VH, nf), s) as Source, SEC, k + 1)
          xs.push(avgOf(film({ sec: SEC, seed: 71 + k, pl: BASE, noise: BASE_NOISE, body: (t) => run.at(t) })))
        } catch {
          // 胸骨の印がない人などは飛ばす
        }
      })
      if (xs.length) add('Van Hooren（秒速3.33m）', xs)
    }
    const text =
      `## ② ふつうに走ったときの上体と体全体（仮想のスマホで測った値、人による散らばり）\n\n` +
      `真横・1.2m・高さ80cm・超広角・ぶれ1%。1本の${SEC}秒の平均を、本数で並べた（いちばん小さい / 下から1割 / 中央 / 上から1割 / いちばん大きい、度）。\n\n` +
      `| データ | 本数 | 上体 | 体全体 |\n|---|---|---|---|\n${rows.join('\n')}\n`
    console.log(text)
    writeFileSync(OUT.replace(/\.md$/, '-spread.md'), text)
  })
})
