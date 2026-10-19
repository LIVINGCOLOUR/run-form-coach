// 仮想実験（走りながらの声かけ全体）：研究データの多くのランナーの走りを、仮想のスマホで映して今のコーチに通し、
//   ① ふつうに走っているのに出る声（誤った声）が10分に何回か（項目ごと・ランナーのレベルごと）
//   ② 崩しを大きさを変えて足したとき、見つける割合と、崩れてから声までの秒数
//   ③ 声をかける線を変えたら①②がどう変わるか
// を出す。走り始めの3分（HIP_REF）で基準を作るところから、アプリと同じに通す（間引きも同じ）
// 動かし方：RIGLET_DIR=<Riglet のデータ> [VH_DIR=<Van Hooren>] [RBDS_DIR=<RBDS>] npx vitest run --config sim/vitest.config.ts sim/coach.sim.ts
// データ：Riglet は <ID>/Session1/Treadmill_Run/Treadmill_Run_{Comfortable,Fast}/Post_Process/*.c3d（頭・肩・腰・脚がそろう）
//         Van Hooren は Sub_XX_333ms.c3d と Sub_XX_trunklean.c3d（本当に上体を前に倒した走り）
//         RBDS は RBDSnnnrunT{25,35,45}markers.txt / forces.txt / static.txt（脚だけ。腰の高さだけを見る）
import { describe, it as itAll } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRiglet } from './riglet'
import { loadUpper } from './vanhooren'
import { loadTrial } from './rbds'
import { LongRun, distort, truthOf, legLengthMm, groundOf, DISTORT_LABEL, type DistortKind, type Source } from './longrun'
import { film, replay, BASE, BASE_NOISE, type Extra, type Stream } from './pipeline'
import type { Placement, Noise, Body } from './camera'
import { LIMITS, REL_LIMITS, HEAD_ABS } from '../src/modes/camera/params'
import { HIP_REF, CUE as CUE_P } from '../src/core/params'
import { activeItems, ALL } from '../src/core/level'
import type { ItemKey } from '../src/core/types'

const RIGLET = process.env.RIGLET_DIR
const VH = process.env.VH_DIR
const RBDS = process.env.RBDS_DIR
const OUT = process.env.SIM_OUT ?? 'sim/result-coach.md'

const ITEMS: ItemKey[] = ['head', 'trunk', 'body', 'hip']
const ITEM_JA: Record<ItemKey, string> = { head: '頭', trunk: '上体', body: '体全体', hip: '腰' }
const LEVELS = [
  { label: '初心者（最初）', items: activeItems(0) },
  { label: '中級（最初）', items: activeItems(1) },
  { label: '上級', items: activeItems(ALL) },
]
const NORMAL_SEC = 780 // 3分の基準 + 10分
const ONSET = 250 // 崩し始め（基準ができたあと、声なしの見守りに入る前）
const ONSET_QUIET = 600 // 声なしの見守りに入っていそうなころに崩す
const HOLD = 60 // 崩したままでいる長さ（秒）
const RAMP = 2 // 崩すのにかける秒数
// 実機の記録（2026-10-19 のトレッドミル、ふつうに走った9分）の6秒平均のばらつき（頭 2.6°・上体 0.7°・体全体 0.6°）と、
// 体全体だけに数分続く揺れがあった（1秒平均の相関が60〜120秒あとでも 0.1〜0.2）のに合わせて足す、ゆっくりしたずれ
const REAL_EXTRA: Extra = { neck: [1.8, 3], trunk: [0.35, 3], body: [0.4, 120] }
const CONDS: { label: string; pl?: Partial<Placement>; noise?: Partial<Noise>; extra?: Extra }[] = [
  { label: '基準（真横・1.2m・高さ80cm・ぶれ1%）' },
  { label: '実機なみのゆっくりしたずれを足す', extra: REAL_EXTRA },
  { label: '点のぶれ2%', noise: { sigma: 0.02 } },
  { label: 'スマホが低い（50cm）', pl: { height: 0.5 } },
]
// 崩しの種類ごとの、大きさ（主に変わる値の本当の変化。腰は脚の長さに対する%）と、合っているとみなす声の項目
const KINDS: { kind: DistortKind; of: 'neck' | 'trunk' | 'body' | 'hip'; unit: string; sizes: number[]; ok: ItemKey[] }[] = [
  { kind: 'head', of: 'neck', unit: '°（首の角度）', sizes: [2, 4, 6, 8, 10, 14], ok: ['head'] },
  { kind: 'hunch', of: 'trunk', unit: '°（上体の傾き）', sizes: [2, 4, 6, 8, 10], ok: ['trunk', 'head'] },
  { kind: 'trunk', of: 'trunk', unit: '°（上体の傾き）', sizes: [2, 4, 6, 8, 10], ok: ['trunk', 'body'] },
  { kind: 'body', of: 'body', unit: '°（体全体の傾き）', sizes: [1, 2, 3, 4, 5, 6], ok: ['body', 'trunk'] },
  { kind: 'sit', of: 'hip', unit: '%（腰の高さ、脚の長さに対して）', sizes: [2, 4, 6, 8, 10], ok: ['hip', 'body'] },
]
// 線を変えて試す値（その項目だけ変え、ほかは今の線のまま）
const SWEEP: { item: ItemKey; now: number; values: number[]; set: (v: number) => void }[] = [
  { item: 'head', now: LIMITS.head.cue, values: [5, 6, 7, 8, 10], set: (v) => (LIMITS.head.cue = v) },
  { item: 'trunk', now: REL_LIMITS.trunk.cue, values: [3, 4, 5, 6], set: (v) => (REL_LIMITS.trunk.cue = v) },
  { item: 'body', now: REL_LIMITS.body.cue, values: [2.5, 3, 3.5, 4, 5], set: (v) => (REL_LIMITS.body.cue = v) },
  { item: 'hip', now: LIMITS.hip.cue, values: [3, 4, 5, 6], set: (v) => (LIMITS.hip.cue = v) },
]

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const formCues = (cues: { t: number; item: string }[]) => cues.filter((c) => (ITEMS as string[]).includes(c.item)) as { t: number; item: ItemKey }[]

interface Runner {
  id: string
  src: Source
  run: LongRun
  leg: number
  ground: number
  ratio: Record<DistortKind, number> // 崩しの入力1あたりの、主に変わる値の本当の変化
}

function prepare(id: string, src: Source, seed: number, sec = NORMAL_SEC): Runner {
  const run = new LongRun()
  run.append(src, sec, seed)
  const leg = legLengthMm(src)
  const ground = groundOf(src)
  const ratio = {} as Runner['ratio']
  for (const k of KINDS) {
    const d: number[] = []
    for (let t = 0; t < 60; t += 0.2) {
      const b = run.at(t)
      d.push(change(truthOf(b), truthOf(distort(b, k.kind, 5, leg, ground)), k.of, leg))
    }
    ratio[k.kind] = mean(d) / 5
  }
  return { id, src, run, leg, ground, ratio }
}

function change(a: ReturnType<typeof truthOf>, b: ReturnType<typeof truthOf>, of: 'neck' | 'trunk' | 'body' | 'hip', leg: number) {
  return of === 'hip' ? ((a.hip - b.hip) / leg) * 100 : b[of] - a[of]
}

// 崩しの入った体：onset から RAMP 秒かけて崩し、HOLD 秒たったら RAMP 秒かけて戻す
function bodyFn(r: Runner, kind?: DistortKind, size = 0, onset = ONSET): (t: number) => Body {
  if (!kind || !size) return (t) => r.run.at(t)
  const input = size / r.ratio[kind]
  return (t) => {
    const b = r.run.at(t)
    const u = t < onset ? 0 : t < onset + RAMP ? (t - onset) / RAMP : t < onset + HOLD ? 1 : t < onset + HOLD + RAMP ? 1 - (t - onset - HOLD) / RAMP : 0
    return u ? distort(b, kind, input * u, r.leg, r.ground) : b
  }
}

function filmOf(r: Runner, k: number, c: (typeof CONDS)[number], sec: number, body: (t: number) => Body, seed: number): Stream {
  return film({ sec, seed: seed * 1009 + k, pl: { ...BASE, ...c.pl }, noise: { ...BASE_NOISE, ...c.noise }, extra: c.extra, body })
}

const NECK_RANGE_MAX = 20
const excluded: string[] = []
function neckRange(src: Source) {
  const per: number[] = []
  for (let s = 0; s + 1 <= src.frames / src.fps; s++) {
    const v: number[] = []
    for (let i = s * src.fps; i < (s + 1) * src.fps; i += 5) {
      const b = {} as Body
      for (const k of Object.keys(src.joints) as (keyof Body)[]) (b as unknown as Record<string, unknown>)[k] = src.joints[k]![Math.floor(i)]
      v.push(truthOf(b).neck)
    }
    per.push(mean(v))
  }
  const w = per.slice(0, -5).map((_, i) => mean(per.slice(i, i + 6)))
  return Math.max(...w) - Math.min(...w)
}

function loadRigletRunners(): Runner[] {
  if (!RIGLET) return []
  const out: Runner[] = []
  readdirSync(RIGLET)
    .sort()
    .forEach((id) => {
      for (const pace of ['Comfortable', 'Fast']) {
        const p = join(RIGLET, id, `Session1/Treadmill_Run/Treadmill_Run_${pace}/Post_Process/Treadmill_Run_${pace}.c3d`)
        if (!existsSync(p)) continue
        try {
          const src = loadRiglet(p, `${id}-${pace === 'Fast' ? '速い' : '楽'}`)
          if (src.frames / src.fps < 20) continue
          // 首の角度の6秒平均が20°を超えて動く記録は、肩の関節の中心の推定がおかしいとみて除く
          const range = neckRange(src as Source)
          if (range > NECK_RANGE_MAX) {
            console.log(`除く：${src.id}（首の角度の6秒平均が ${range.toFixed(0)}° 動く）`)
            excluded.push(src.id)
            continue
          }
          out.push(prepare(src.id, src as Source, out.length + 1))
        } catch (e) {
          console.log(`使えない：${id} ${pace}：${(e as Error).message}`)
        }
      }
    })
  return out
}

// 誤った声の数え方：基準ができたあと（HIP_REF.to 秒より後）の10分あたり、と、基準ができる前（決まった線で見ている間）の回数
function falseCues(reps: { r: ReturnType<typeof replay>; end: number }[]) {
  const after: Record<ItemKey, number> = { head: 0, trunk: 0, body: 0, hip: 0 }
  const before: Record<ItemKey, number> = { head: 0, trunk: 0, body: 0, hip: 0 }
  let once = 0
  let minutes = 0
  let runners = 0
  let anyRunner = 0
  let beforeRunner = 0
  for (const { r, end } of reps) {
    const ref = r.runFrom + HIP_REF.to
    minutes += (end - ref) / 60
    runners++
    let any = false
    for (const c of formCues(r.cues)) {
      if (c.t <= ref + 1.5 && c.item === 'head' && c.t > ref) once++
      else if (c.t > ref) {
        after[c.item]++
        any = true
      } else before[c.item]++
    }
    if (any) anyRunner++
    if (formCues(r.cues).some((c) => c.t <= ref)) beforeRunner++
  }
  const per10 = (n: number) => (n / minutes) * 10
  return { after, before, once, per10, runners, anyRunner, beforeRunner, minutes }
}

describe.skipIf(!RIGLET)('Riglet：ふつうの走りと崩し', () => {
  const runners = loadRigletRunners()
  const sections: string[] = []
  // 崩しの結果（線を変える試しでも使うので、流れごと残す）
  const streams = new Map<string, Stream>()
  // まとめの表に使う数字（上級・実機なみのずれ）：今の線と提案の線での、誤った声と、崩しの大きさごとの見つけた割合
  type Det = Record<string, { right: number; latSec: number }>
  const sum = { now: { false: {} as Record<ItemKey, number>, det: {} as Record<DistortKind, Det> }, prop: { false: {} as Record<ItemKey, number>, det: {} as Record<DistortKind, Det> } }

  itAll('ふつうに走ったときの誤った声', () => {
    console.log(`使う走り：${runners.length}`)
    let text =
      `## ① ふつうに走ったときの誤った声（10分あたりの回数）\n\n` +
      `基準ができたあと（走り始めて${HIP_REF.to}秒より後）の10分。カッコ内は、声が1回でも出た走りの割合。` +
      `「基準の前」は、走り始めの${HIP_REF.to}秒（上体と体全体を決まった線で見ている間）に出た回数の合計。` +
      `「一度だけ」は、基準ができたときに一度だけ見る頭の位置そのもの（${HEAD_ABS.line}°）で出た声（上級だけ）。\n\n` +
      `| 置き方・ぶれ | レベル | 頭 | 上体 | 体全体 | 腰 | 合計（声が出た走り） | 基準の前（頭/上体/体全体/腰、声が出た走り） | 一度だけ |\n|---|---|---|---|---|---|---|---|---|\n`
    for (const c of CONDS) {
      const ss = runners.map((r, k) => filmOf(r, k, c, NORMAL_SEC, bodyFn(r), 1))
      if (c === CONDS[1]) ss.forEach((s, k) => streams.set(`${c.label}|${k}|normal`, s))
      for (const lv of LEVELS) {
        const f = falseCues(ss.map((s) => ({ r: replay(s, { items: lv.items }), end: NORMAL_SEC })))
        if (c === CONDS[1] && lv === LEVELS[2]) for (const k of ITEMS) sum.now.false[k] = f.per10(f.after[k])
        const tot = ITEMS.reduce((a, k) => a + f.after[k], 0)
        text += `| ${c.label} | ${lv.label} | ${ITEMS.map((k) => f.per10(f.after[k]).toFixed(2)).join(' | ')} | ${f.per10(tot).toFixed(2)}（${pct(f.anyRunner / f.runners)}） | ${ITEMS.map((k) => f.before[k]).join('/')}（${f.beforeRunner}本） | ${f.once}本 |\n`
      }
    }
    text += `\n（${runners.length}本 × 10分 = ${runners.length * 10}分ずつ）\n`
    sections[0] = text
    console.log(text)
  })

  itAll('崩しの大きさと見つけるまで', () => {
    // 崩しの入力1あたりの、ほかの値の本当の変化（崩しの性質を見るため）
    let text =
      `## ② 崩しの大きさと、見つけた割合・声までの秒数（上級＝全部の項目を見る）\n\n` +
      `走り始めて${ONSET}秒（基準ができたあと）から${HOLD}秒崩し、その間に姿勢の声（頭・上体・体全体・腰のどれか）が出た割合と、` +
      `崩し始めから声までの秒数の中央値。「合う項目」は、崩しに合った声だった割合。` +
      `「見守り中」は、${ONSET_QUIET}秒（声なしの見守りに入っていそうなころ）に同じだけ崩したとき（実機なみのずれ）。` +
      `大きさは、崩したときの本当の変化（3次元の点から、アプリと同じ定義で測った値）。\n\n`
    text += `崩しの性質（主に変わる値が1増えたときの、ほかの値の変化。${runners.length}本の平均）\n\n| 崩し | 首の角度 | 上体 | 体全体 | 腰の高さ（%） |\n|---|---|---|---|---|\n`
    for (const k of KINDS) {
      const rows = runners.map((r) => {
        const d = [0, 0, 0, 0]
        let n = 0
        for (let t = 0; t < 60; t += 0.5, n++) {
          const b = r.run.at(t)
          const a = truthOf(b)
          const x = truthOf(distort(b, k.kind, 1 / r.ratio[k.kind], r.leg, r.ground))
          d[0] += x.neck - a.neck
          d[1] += x.trunk - a.trunk
          d[2] += x.body - a.body
          d[3] += ((a.hip - x.hip) / r.leg) * 100
        }
        return d.map((v) => v / n)
      })
      text += `| ${DISTORT_LABEL[k.kind]} | ${[0, 1, 2, 3].map((i) => mean(rows.map((x) => x[i])).toFixed(2)).join(' | ')} |\n`
    }
    for (const k of KINDS) {
      text += `\n### ${DISTORT_LABEL[k.kind]}\n\n| 大きさ${k.unit} | 基準：見つけた | 基準：合う項目 | 基準：声まで | 実機なみ：見つけた | 実機なみ：合う項目 | 実機なみ：声まで | 見守り中：見つけた | 見守り中：声まで |\n|---|---|---|---|---|---|---|---|---|\n`
      for (const size of k.sizes) {
        const cols: string[] = []
        for (const [ci, c] of [CONDS[0], CONDS[1]].entries()) {
          const ss = runners.map((r, i) => filmOf(r, i, c, ONSET + HOLD + 10, bodyFn(r, k.kind, size), 1))
          if (ci === 1) ss.forEach((s, i) => streams.set(`${c.label}|${i}|${k.kind}|${size}`, s))
          const d = detect(ss.map((s) => replay(s, {})), k.ok, ONSET)
          cols.push(pct(d.found), pct(d.right), d.lat)
          if (ci === 1) (sum.now.det[k.kind] ??= {})[size] = { right: d.right, latSec: d.latSec }
          if (ci === 1) {
            const sq = runners.map((r, i) => filmOf(r, i, c, ONSET_QUIET + HOLD + 10, bodyFn(r, k.kind, size, ONSET_QUIET), 1))
            const dq = detect(sq.map((s) => replay(s, {})), k.ok, ONSET_QUIET)
            cols.push(pct(dq.found), dq.lat)
          }
        }
        text += `| ${size} | ${[cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7]].join(' | ')} |\n`
      }
    }
    sections[1] = text
    console.log(text)
  })

  itAll('線を変えたとき', () => {
    let text =
      `## ③ 声をかける線を変えたとき（上級、実機なみのずれ）\n\n` +
      `その項目の線だけを変え、ほかは今の線のまま。誤った声はその項目の10分あたりの回数、見つけた割合は崩し始めから${HOLD}秒の間にその項目（合う項目）の声が出た割合。` +
      `頭・腰は「走り始めの自分との差」の線、上体・体全体は「走り始めの自分からの増え方」の線（REL_LIMITS）。\n\n`
    const c = CONDS[1]
    for (const sw of SWEEP) {
      const kinds = KINDS.filter((k) => k.ok[0] === sw.item || (sw.item === 'trunk' && k.kind === 'hunch'))
      const heads = kinds.flatMap((k) => k.sizes.map((s) => `${DISTORT_LABEL[k.kind].split('（')[0]} ${s}`))
      text += `### ${ITEM_JA[sw.item]}（今 ${sw.now}）\n\n| 線 | 誤った声 | ${heads.join(' | ')} |\n|---|---|${heads.map(() => '---').join('|')}|\n`
      for (const v of sw.values) {
        sw.set(v)
        try {
          const f = falseCues(runners.map((_, i) => ({ r: replay(streams.get(`${c.label}|${i}|normal`)!, {}), end: NORMAL_SEC })))
          const cols = kinds.flatMap((k) =>
            k.sizes.map((s) => {
              const d = detect(runners.map((_, i) => replay(streams.get(`${c.label}|${i}|${k.kind}|${s}`)!, {})), [sw.item], ONSET)
              return pct(d.right)
            }),
          )
          text += `| ${v}${v === sw.now ? '（今）' : ''} | ${f.per10(f.after[sw.item]).toFixed(2)} | ${cols.join(' | ')} |\n`
        } finally {
          sw.set(sw.now)
        }
      }
      text += '\n'
    }
    // 頭は、線を上げるほかに、平均する長さ（CUE.window、今は全部の項目で共通）を長くする案も試す
    const hk = KINDS.find((k) => k.kind === 'head')!
    const nowW = CUE_P.window
    text +=
      `### 頭：平均する長さも変えたとき（今 ${nowW}秒・${LIMITS.head.cue}°）\n\n` +
      `| 長さ | 線 | 誤った声 | ${hk.sizes.map((s) => `頭を前に ${s}`).join(' | ')} | 声まで（頭を前に 8） |\n|---|---|---|${hk.sizes.map(() => '---').join('|')}|---|\n`
    for (const w of [6, 10, 15]) {
      for (const v of [5, 6, 7, 8]) {
        CUE_P.window = w
        LIMITS.head.cue = v
        try {
          const f = falseCues(runners.map((_, i) => ({ r: replay(streams.get(`${c.label}|${i}|normal`)!, {}), end: NORMAL_SEC })))
          const ds = hk.sizes.map((sz) => detect(runners.map((_, i) => replay(streams.get(`${c.label}|${i}|head|${sz}`)!, {})), ['head'], ONSET))
          text += `| ${w}秒 | ${v}° | ${f.per10(f.after.head).toFixed(2)} | ${ds.map((d) => pct(d.right)).join(' | ')} | ${ds[hk.sizes.indexOf(8)].lat} |\n`
        } finally {
          CUE_P.window = nowW
          LIMITS.head.cue = SWEEP[0].now
        }
      }
    }
    // 提案の線をまとめて入れたとき
    const PROPOSAL = { head: 8, trunk: 4, hip: 4 }
    LIMITS.head.cue = PROPOSAL.head
    REL_LIMITS.trunk.cue = PROPOSAL.trunk
    LIMITS.hip.cue = PROPOSAL.hip
    try {
      text +=
        `## ④ 提案の線をまとめて入れたとき（頭 ${PROPOSAL.head}°・上体の増え方 ${PROPOSAL.trunk}°・腰 ${PROPOSAL.hip}%、体全体は今のまま。実機なみのずれ）\n\n` +
        `| レベル | 誤った声（10分あたり 頭/上体/体全体/腰） | 声が出た走り |\n|---|---|---|\n`
      for (const lv of LEVELS) {
        const f = falseCues(runners.map((_, i) => ({ r: replay(streams.get(`${c.label}|${i}|normal`)!, { items: lv.items }), end: NORMAL_SEC })))
        text += `| ${lv.label} | ${ITEMS.map((k) => f.per10(f.after[k]).toFixed(2)).join(' / ')} | ${pct(f.anyRunner / f.runners)} |\n`
        if (lv === LEVELS[2]) for (const k of ITEMS) sum.prop.false[k] = f.per10(f.after[k])
      }
      text += `\n| 崩し | ${'大きさ → 合う項目の声が出た割合（声まで）'} |\n|---|---|\n`
      for (const k of KINDS) {
        const cells = k.sizes.map((sz) => {
          const d = detect(runners.map((_, i) => replay(streams.get(`${c.label}|${i}|${k.kind}|${sz}`)!, {})), k.ok, ONSET)
          ;(sum.prop.det[k.kind] ??= {})[sz] = { right: d.right, latSec: d.latSec }
          return `${sz}：${pct(d.right)}（${d.lat}）`
        })
        text += `| ${DISTORT_LABEL[k.kind]} | ${cells.join('、')} |\n`
      }
    } finally {
      LIMITS.head.cue = SWEEP[0].now
      REL_LIMITS.trunk.cue = SWEEP[1].now
      LIMITS.hip.cue = SWEEP[3].now
    }
    sections[2] = text
    console.log(text)
    const intro =
      `# 走りながらの声かけの仮想実験（多くのランナー）\n\n` +
      `研究データ（Riglet ら 2024、CC0、https://doi.org/10.6084/m9.figshare.25592865.v1）の${new Set(runners.map((r) => r.id.split('-')[0])).size}人が、トレッドミルを楽なペースと速いペースで走った記録（それぞれ約1分）から、` +
      `1歩きずつ切って並べ直した13分の走りを作り、仮想のスマホ（毎秒15コマ・点のぶれ・左右の取り違え）で映して、今のコーチ（src/modes/camera/coach.ts）にアプリと同じ間引きで通した。` +
      `首の角度の6秒平均が${NECK_RANGE_MAX}°を超えて動く記録（${excluded.join('・') || 'なし'}）は、肩の関節の中心の推定がおかしいとみて除いた。` +
      `崩しは3次元の点を動かして作ったもの（データに崩しの条件はない）。数分かけての揺れや疲れは元の記録に入らないので、` +
      `実機の記録のばらつきに合わせたゆっくりしたずれを足した条件も並べた（${JSON.stringify(REAL_EXTRA)}：[大きさ°, 続く秒]）。\n` +
      `限り：元の記録は1本あたり約1分なので、数分かけての変化（疲れ・服や光による推定のずれ）は「実機なみのずれ」で足した分しかない。` +
      `崩しは作りもの（本当に上体を倒した走りは result-coach-vh.md、脚だけのデータでの腰は result-coach-rbds.md）。カメラ版はピッチを判定しないので、ピッチの崩しは試していない。\n` +
      `動かし方：RIGLET_DIR=<データ> npx vitest run --config sim/vitest.config.ts sim/coach.sim.ts\n\n`
    // まとめ：崩しごとに、合う項目の声を9割の走りで出せる、いちばん小さい崩しの大きさ
    const ninety = (det: Det | undefined, sizes: number[]) => {
      const sz = sizes.find((x) => det?.[x] && det[x].right >= 0.9)
      return sz === undefined ? `${sizes[sizes.length - 1]}でも届かない` : `${sz}（${Math.round(det![sz].latSec)}秒）`
    }
    const item: Record<DistortKind, ItemKey> = { head: 'head', hunch: 'trunk', trunk: 'trunk', body: 'body', sit: 'hip' }
    const lineNow: Record<ItemKey, string> = { head: `${LIMITS.head.cue}°`, trunk: `増え方 ${REL_LIMITS.trunk.cue}°`, body: `増え方 ${REL_LIMITS.body.cue}°`, hip: `${LIMITS.hip.cue}%` }
    const lineProp: Record<ItemKey, string> = { head: `${PROPOSAL.head}°`, trunk: `増え方 ${PROPOSAL.trunk}°`, body: `増え方 ${REL_LIMITS.body.cue}°`, hip: `${PROPOSAL.hip}%` }
    const summary =
      `## まとめ（上級、実機なみのずれ、${runners.length}本）\n\n` +
      `「9割」は、崩しに合った声を9割の走りで${HOLD}秒以内に出せた、いちばん小さい崩しの大きさ（カッコ内は声までの秒数の中央値）。誤った声は基準ができたあとの10分あたり。\n\n` +
      `| 崩し | 声の項目 | 今の線 | 誤った声 | 9割 | 提案の線 | 誤った声 | 9割 |\n|---|---|---|---|---|---|---|---|\n` +
      KINDS.map((k) => {
        const it = item[k.kind]
        return `| ${DISTORT_LABEL[k.kind].split('（')[0]}（${k.unit.split('（')[0]}） | ${ITEM_JA[it]} | ${lineNow[it]} | ${sum.now.false[it]?.toFixed(2)} | ${ninety(sum.now.det[k.kind], k.sizes)} | ${lineProp[it]} | ${sum.prop.false[it]?.toFixed(2)} | ${ninety(sum.prop.det[k.kind], k.sizes)} |`
      }).join('\n') +
      '\n'
    writeFileSync(OUT, intro + summary + '\n' + sections.filter(Boolean).join('\n') + '\n')
  })
})

// 崩しの間（onset〜onset+HOLD+2秒）に出た姿勢の声
function detect(reps: ReturnType<typeof replay>[], ok: ItemKey[], onset: number) {
  let found = 0
  let right = 0
  const lat: number[] = []
  for (const r of reps) {
    const cs = formCues(r.cues).filter((c) => c.t >= onset && c.t <= onset + HOLD + 2)
    if (cs.length) {
      found++
      lat.push(cs[0].t - onset)
    }
    if (cs.some((c) => ok.includes(c.item))) right++
  }
  const n = reps.length
  return { found: found / n, right: right / n, lat: lat.length ? `${Math.round(median(lat))}秒` : '—', latSec: median(lat) }
}

// 本当に上体を前に倒した走り（Van Hooren 2024）：ふつうの走りで基準を作り、ONSET 秒から HOLD 秒だけ前に倒した走りに入れ替える
// 頭の印がないので、頭の項目は声をかけない（測る線が作りもの）
const VH_OPTS = { items: ['trunk', 'body', 'hip'] as ItemKey[], mute: true }
describe.skipIf(!VH)('Van Hooren：本当に前に倒した走り', () => {
  itAll('わざと前に倒した走りを見つけるか', () => {
    const files = readdirSync(VH!)
    const subs = [...new Set(files.filter((f) => /^Sub_\d+_trunklean\.c3d$/i.test(f)).map((f) => f.slice(0, 6)))].sort()
    const people: { id: string; lean: Stream[]; norm: Stream[]; dt: number; db: number }[] = []
    subs.forEach((s, k) => {
      const lf = files.find((f) => f.toLowerCase() === `${s.toLowerCase()}_trunklean.c3d`)
      const nf = files.find((f) => f === `${s}_333ms.c3d` || f === `${s}_333.c3d`)
      if (!lf || !nf) return
      let norm: Source
      let lean: Source
      try {
        norm = loadUpper(join(VH!, nf), s) as Source
        lean = loadUpper(join(VH!, lf), s) as Source
      } catch (e) {
        console.log(`使えない：${s}：${(e as Error).message}`)
        return
      }
      const leanRun = new LongRun()
      leanRun.append(norm, ONSET, k + 1)
      leanRun.append(lean, HOLD, k + 101)
      leanRun.append(norm, 20, k + 201)
      const normRun = new LongRun()
      normRun.append(norm, NORMAL_SEC, k + 1)
      const tr = (src: Source) => {
        const a: number[][] = []
        for (let i = 0; i < src.frames; i += 5) {
          const b = {} as Body
          for (const key of Object.keys(src.joints) as (keyof Body)[]) (b as unknown as Record<string, unknown>)[key] = src.joints[key]![i]
          const x = truthOf(b)
          a.push([x.trunk, x.body])
        }
        return [mean(a.map((x) => x[0])), mean(a.map((x) => x[1]))]
      }
      const [nt, nb] = tr(norm)
      const [lt, lb] = tr(lean)
      const f = (c: (typeof CONDS)[number], sec: number, run: LongRun, seed: number) =>
        film({ sec, seed, pl: { ...BASE, ...c.pl }, noise: { ...BASE_NOISE, ...c.noise }, extra: c.extra, body: (t) => run.at(t) })
      people.push({
        id: s,
        lean: [CONDS[0], CONDS[1]].map((c) => f(c, ONSET + HOLD + 20, leanRun, 500 + k)),
        norm: [CONDS[0], CONDS[1]].map((c) => f(c, NORMAL_SEC, normRun, 600 + k)),
        dt: lt - nt,
        db: lb - nb,
      })
    })
    // 本当に前に倒したと言える人（上体が2°以上増えた人）だけで、見つけた割合を出す
    const leaners = people.filter((p) => p.dt >= 2)
    const evalRow = (ci: number) => {
      const d = detect(leaners.map((p) => replay(p.lean[ci], VH_OPTS)), ['trunk', 'body'], ONSET)
      const f = falseCues(people.map((p) => ({ r: replay(p.norm[ci], VH_OPTS), end: NORMAL_SEC })))
      return { d, f }
    }
    const rows = [0, 1].map((ci) => {
      const { d, f } = evalRow(ci)
      return `| ${CONDS[ci].label} | ${pct(d.right)} | ${d.lat} | ${(['trunk', 'body'] as ItemKey[]).map((k) => f.per10(f.after[k]).toFixed(2)).join(' / ')} |`
    })
    // 線を変えたとき（実機なみ）
    const sweep: string[] = []
    for (const [k, vs] of [['trunk', [3, 4, 5, 6]], ['body', [2.5, 3, 3.5, 4]]] as const) {
      const now = REL_LIMITS[k].cue
      for (const v of vs) {
        REL_LIMITS[k].cue = v
        try {
          const { d, f } = evalRow(1)
          sweep.push(`| ${ITEM_JA[k]} ${v}${v === now ? '（今）' : ''} | ${pct(d.right)} | ${d.lat} | ${f.per10(f.after.trunk).toFixed(2)} / ${f.per10(f.after.body).toFixed(2)} |`)
        } finally {
          REL_LIMITS[k].cue = now
        }
      }
    }
    const per = people.map((p) => {
      const r = replay(p.lean[0], VH_OPTS)
      const cs = formCues(r.cues).filter((x) => x.t >= ONSET && x.t <= ONSET + HOLD + 2)
      return `| ${p.id} | ${p.dt.toFixed(1)}° | ${p.db.toFixed(1)}° | ${cs.length ? `${ITEM_JA[cs[0].item]}（${Math.round(cs[0].t - ONSET)}秒）` : 'なし'} |`
    })
    const text =
      `# 本当に上体を前に倒した走りを見つけるか（仮想実験）\n\n` +
      `研究データ（Van Hooren & Meijer 2024、論文は CC BY 4.0、データ https://osf.io/7qbxc/ は制限なしで公開）の${people.length}人の、秒速3.33mのふつうの走りと「少し上体を前に倒して」走った条件（それぞれ約1分）。` +
      `ふつうの走りを1歩きずつ並べ直して${ONSET}秒走り、そこから${HOLD}秒だけ前に倒した走りに入れ替えて、今のコーチ（上級）に通した。頭の印がないので、頭の項目は声をかけないようにした。` +
      `見つけた割合は、上体が本当に2°以上増えた${leaners.length}人（上体 平均 +${mean(leaners.map((p) => p.dt)).toFixed(1)}°・体全体 +${mean(leaners.map((p) => p.db)).toFixed(1)}°）で数えた。` +
      `誤った声は、ふつうの走りだけで作った13分の、基準ができたあとの10分あたり。\n` +
      `動かし方：VH_DIR=<データ> npx vitest run --config sim/vitest.config.ts sim/coach.sim.ts\n\n` +
      `| 置き方・ぶれ | 上体か体全体の声が出た | 声まで（中央値） | 誤った声（10分あたり 上体 / 体全体） |\n|---|---|---|---|\n${rows.join('\n')}\n\n` +
      `線を変えたとき（実機なみのずれ）\n\n| 線（REL_LIMITS） | 上体か体全体の声が出た | 声まで | 誤った声（上体 / 体全体） |\n|---|---|---|---|\n${sweep.join('\n')}\n\n` +
      `| 人 | 上体の変化 | 体全体の変化 | 最初の声（基準の置き方） |\n|---|---|---|---|\n${per.join('\n')}\n`
    console.log(text)
    writeFileSync(OUT.replace(/\.md$/, '-vh.md'), text)
  })
})

// 脚だけのデータ（RBDS、Fukuchi ら 2017）：腰の高さの誤った声と、腰を落としたときに見つけるか。上体は骨盤に固定した仮のもの
const HIP_OPTS = { items: ['hip'] as ItemKey[], mute: true }
describe.skipIf(!RBDS)('RBDS：腰の高さ', () => {
  itAll('腰の高さの誤った声と、腰を落としたとき', () => {
    const ids = [...new Set(readdirSync(RBDS!).filter((f) => /^RBDS\d+static\.txt$/.test(f)).map((f) => f.slice(0, 7)))].sort()
    const runners: Runner[] = []
    const label: string[] = []
    for (const id of ids)
      for (const sp of ['25', '35', '45']) {
        if (!existsSync(join(RBDS!, `${id}runT${sp}markers.txt`)) || !existsSync(join(RBDS!, `${id}runT${sp}forces.txt`))) continue
        try {
          const tr = loadTrial(RBDS!, id, sp)
          const src: Source = { id: `${id}-${sp}`, fps: tr.fps, frames: tr.joints.hipR.length, joints: tr.joints }
          runners.push(prepare(src.id, src, runners.length + 1))
          label.push(sp)
        } catch (e) {
          console.log(`使えない：${id} ${sp}：${(e as Error).message}`)
        }
      }
    const sizes = [2, 4, 6, 8, 10]
    let text =
      `# 腰の高さ：脚だけのデータでの確かめ（仮想実験）\n\n` +
      `研究データ（Fukuchi ら 2017、CC BY 4.0、https://doi.org/10.6084/m9.figshare.4543435）の${new Set(runners.map((r) => r.id.split('-')[0])).size}人が、秒速2.5・3.5・4.5mで走った記録（各30秒）から13分の走りを作り、今のコーチ（上級）に通した。` +
      `上体と頭は骨盤に固定した仮のものなので、腰の高さだけに声をかけるようにした。\n` +
      `動かし方：RBDS_DIR=<データ> npx vitest run --config sim/vitest.config.ts sim/coach.sim.ts\n\n` +
      `| 速さ | 本数 | 腰の誤った声（10分あたり） | ${sizes.map((s) => `腰を${s}%落とす：見つけた（声まで）`).join(' | ')} |\n|---|---|---|${sizes.map(() => '---').join('|')}|\n`
    for (const sp of ['25', '35', '45', 'all']) {
      const rs = runners.filter((_, i) => sp === 'all' || label[i] === sp)
      if (!rs.length) continue
      const f = falseCues(rs.map((r, k) => ({ r: replay(filmOf(r, k, CONDS[0], NORMAL_SEC, bodyFn(r), 2), HIP_OPTS), end: NORMAL_SEC })))
      const cols = sizes.map((s) => {
        const d = detect(rs.map((r, k) => replay(filmOf(r, k, CONDS[0], ONSET + HOLD + 10, bodyFn(r, 'sit', s), 2), HIP_OPTS)), ['hip'], ONSET)
        return `${pct(d.right)}（${d.lat}）`
      })
      text += `| ${sp === 'all' ? 'すべて' : `秒速${Number(sp) / 10}m`} | ${rs.length} | ${f.per10(f.after.hip).toFixed(2)} | ${cols.join(' | ')} |\n`
    }
    console.log(text)
    writeFileSync(OUT.replace(/\.md$/, '-rbds.md'), text)
  })
})
