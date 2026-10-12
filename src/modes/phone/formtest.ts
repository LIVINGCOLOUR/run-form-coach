import type { PhoneSample } from './analyzer'
import type { MountIssue } from './mount'
import { FORM_TEST } from './params'
import type { PhoneSession, PhoneWhere } from './session'

// フォームのテスト（docs/phone-spec.md 機能7）。平らな道を決まった速さで5分走り、前のテストと比べる。声はかけない。数字は params.ts の FORM_TEST
//   比べる値は、始めの FORM_TEST.skip 秒を除いた区間の平均（ピッチ・上下動・ブレーキ・有効接地時間）
//   速さ（GPS のならした速さ。外だけ）で、前のテストと速さがそろっているか・テストの中で一定だったかを確かめ、そろっていなければそう言う
//   坂はウェブでは見分けられない（SPEED の説明）ので、「平らな道」は走る人に任せる

// 1回のテストの値（PhoneSession.test）
export interface FormTestResult {
  ok: boolean // 比べるのに使える（測れた秒が足りて、付け方の問題がない）
  why?: 'short' | 'mount' // 使えない理由
  where: PhoneWhere
  sec: number // 比べる区間で測れた秒
  speed: number | null // 平均の速さ（m/s）。トレッドミル・GPS が取れないときは null
  steady: number | null // 平均の速さから ±FORM_TEST.steadyBand に入っていた秒の割合
  cadence: number | null // 歩/分
  bounceCm: number | null
  brakingMs: number | null
  contactMs: number | null // 有効接地時間（ms。fatigue.ts の材料と同じ）
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function formTestOf(samples: PhoneSample[], mount: MountIssue | null, where: PhoneWhere): FormTestResult {
  const xs = samples.filter((s) => s.t >= FORM_TEST.skip && s.t < FORM_TEST.seconds && s.cadence !== null && !s.mount)
  const pick = (f: (s: PhoneSample) => number | null | undefined) => mean(xs.flatMap((s) => { const v = f(s); return v === null || v === undefined ? [] : [v] }))
  const speeds = xs.flatMap((s) => (s.speed === null || s.speed === undefined ? [] : [s.speed]))
  const speed = mean(speeds)
  const steady = speed ? speeds.filter((v) => Math.abs(v - speed) / speed <= FORM_TEST.steadyBand).length / speeds.length : null
  const need = (FORM_TEST.seconds - FORM_TEST.skip) * FORM_TEST.minCover
  const why = mount ? 'mount' : xs.length < need ? 'short' : undefined
  return {
    ok: !why,
    ...(why ? { why } : {}),
    where,
    sec: xs.length,
    speed,
    steady,
    cadence: pick((s) => s.cadence),
    bounceCm: pick((s) => s.bounceCm),
    brakingMs: pick((s) => s.brakingMs),
    contactMs: pick((s) => s.fat?.contactMs),
  }
}

// 前のテスト（at より前で、使えるもの）。sessions の並びは問わない
export function prevFormTest(sessions: PhoneSession[], at: number): PhoneSession | null {
  return [...sessions].filter((s) => s.test?.ok && s.startedAt < at).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
}

export type FormTestKey = 'cadence' | 'bounceCm' | 'brakingMs' | 'contactMs'

export interface FormTestCompare {
  days: number // 前のテストから何日
  sameWhere: boolean // 同じ場所（外どうし・トレッドミルどうし）
  speedDiff: number | null // 前より何割速いか（0.05 なら 5% 速い）。速さが分からなければ null
  speedOk: boolean | null // 前と速さがそろっている。分からなければ null
  steadyOk: boolean | null // 今回、一定の速さで走れていた。分からなければ null
  items: { key: FormTestKey; cur: number | null; prev: number | null; diff: number | null; same?: boolean }[]
  notes: string[] // 比べるときに気をつけること（速さがそろっていない など）
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`

export function compareFormTests(cur: FormTestResult, curAt: number, prev: FormTestResult, prevAt: number): FormTestCompare {
  const keys: FormTestKey[] = ['cadence', 'bounceCm', 'brakingMs', 'contactMs']
  const items = keys.map((key) => {
    const c = cur[key]
    const p = prev[key]
    const diff = c !== null && p !== null ? c - p : null
    // ピッチだけは、測れる最小の変化より小さい差を「変わっていない」と言う。ほかは目安がないので言わない
    return key === 'cadence' && diff !== null ? { key, cur: c, prev: p, diff, same: Math.abs(diff) < FORM_TEST.cadenceMin } : { key, cur: c, prev: p, diff }
  })
  const sameWhere = cur.where === prev.where
  const speedDiff = cur.speed && prev.speed ? (cur.speed - prev.speed) / prev.speed : null
  const speedOk = speedDiff === null ? null : Math.abs(speedDiff) <= FORM_TEST.speedMatch
  const steadyOk = cur.steady === null ? null : cur.steady >= FORM_TEST.steadyShare
  const notes: string[] = []
  if (!sameWhere) notes.push('前のテストと走った場所（外・トレッドミル）が違うので、そのまま比べられません。')
  if (speedOk === false) notes.push(`速さがそろっていません（前より ${pct(speedDiff!)} ${speedDiff! > 0 ? '速い' : '遅い'}）。ピッチ・上下動・接地時間は速さでも変わるので、差の一部は速さの違いです。`)
  const steady = steadyNote(cur)
  if (steady) notes.push(steady)
  if (sameWhere && cur.where === 'outdoor' && speedDiff === null) notes.push('GPS の速さが取れなかったので、速さがそろっているか分かりません。')
  if (cur.where === 'treadmill') notes.push('トレッドミルでは、速さがそろっているかを確かめられません（同じ設定の速さで走ったものとして比べます）。')
  return { days: Math.round((curAt - prevAt) / (24 * 3600 * 1000)), sameWhere, speedDiff, speedOk, steadyOk, items, notes }
}

// 今回、一定の速さで走れていなかったときの言葉（前のテストがない1回目にも使う）
export function steadyNote(cur: FormTestResult): string | null {
  return cur.steady !== null && cur.steady < FORM_TEST.steadyShare ? `速さが一定ではありませんでした（一定だった時間 ${pct(cur.steady)}）。` : null
}
