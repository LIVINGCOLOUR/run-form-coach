// トレッドミルの検証：Mac の声で区間を指示する（scripts/treadmill-drill.mjs）と、採点（scripts/treadmill-grade.mjs）で
// 共通に使う区間の表と、時刻表の作り方。画面やファイルと切り離した計算だけ。
// 区間の key は、スマホ版の崩しの撮影（src/modes/phone/drill.ts の DRILL_STEPS）と同じにしている

// 崩しの区間。say は区間の始まりに言う短い言葉（このあとに「30秒」と長さを足す）。
// camera / phone：その区間で出てほしい判定の項目（採点の「見つけたか」に使う）。空なら、いまは判定しない崩し
// legs：脚に負担の大きい崩し（既定の並びに入れない）
export const STEPS = {
  head: { name: '頭を前に', say: '頭を前に出して', camera: ['head'], phone: [] },
  down: { name: '下を向く', say: '下を向いて。目線を足もとに', camera: [], phone: [] },
  hunch: { name: '猫背', say: '猫背にして。背中を丸めて', camera: ['trunk', 'head'], phone: [] },
  lean: { name: '体ごと前に', say: '体ごと前に倒して', camera: ['body', 'trunk'], phone: [] },
  armstill: { name: '腕を振らない', say: '腕を振らないで', camera: [], phone: [] },
  armcross: { name: '腕を横に振る', say: '腕を体の前で、横に振って', camera: [], phone: [] },
  sit: { name: '腰を落とす', say: '腰を落として。ひざを曲げて', camera: ['hip'], phone: [] },
  slow: { name: 'ピッチを落とす', say: 'ピッチを落として。速さはそのまま、大またで', camera: [], phone: ['cadence'] },
  bouncy: { name: '弾む', say: '上に弾んで', camera: [], phone: ['bounce'], legs: true },
  heel: { name: 'かかとから前に', say: '足を前に伸ばして、かかとから着地', camera: [], phone: ['braking'], legs: true },
  flat: { name: 'べた足', say: 'べた足で、ぺたっと着地', camera: [], phone: [], legs: true },
}

export const DEFAULT_STEPS = ['head', 'down', 'hunch', 'lean', 'armstill', 'armcross', 'sit', 'slow']

export const DEFAULTS = {
  prep: 15, // 始めてから、歩き始めるまで（ベルトの上に立つ間）
  walk: 420, // 最初の歩き（映り方を確かめる）
  walkKmh: 5.0, // 歩きの速さ
  jump: true, // 歩いたあと、ベルトを止めてその場で1回ジャンプ（2台の時計のずれを見る）
  speedup: 20, // ベルトの速さをジョグに上げる（このあと 3、2、1、スタート）
  jog: 1200, // ジョグ全体（最初のふつう ＋ 崩しと戻し ＋ 残りのふつう）
  jogKmh: 8.0, // ジョグの速さ
  // 最初のふつう。カメラ版は、しくみが走り始めてから30秒〜3分の自分を基準にする。しくみが走り始めるのは「スタート」より
  // 少しあと（ベルトが速さに乗って歩数が数えられてから）で、画面から外れた秒は数えないので、3分ちょうどだと基準の終わりが崩しに重なる
  // （2026-10-19 の記録：しくみが走り始めたのは「スタート」の15秒あと、基準ができたのは3分25秒あとで、頭を前にの22秒が基準に入った）
  first: 240,
  sec: 30, // 崩しの区間
  gap: 30, // 崩しのあとの、ふつうに戻す区間（0 で入れない）
  cool: 180, // 最後の歩き
  soon: 5, // 区間の終わりのこの秒数前に「あと5秒」
  hr: 145, // 心拍の目安（0 で言わない）
  hrEvery: 600, // ジョグの間、この間隔で心拍の目安を言う（秒）
}

const kmh = (v) => v.toFixed(1)
const SAY = {
  prep: '崩しの記録を始めます。カメラに全身が映る場所で、ベルトの上に立ってください。',
  walk: (o) => `トレッドミルを時速${kmh(o.walkKmh)}にしてください。歩きます。${len(o.walk)}。Mac の画面で、全身が映っているか確かめてください。`,
  stop: 'トレッドミルを止めてください。',
  jump: 'ジャンプの合図をします。その場で1回、軽くジャンプします。',
  jumpGo: 'はい。',
  still: 'そのまま、じっと立ってください。',
  speedup: (o) => `トレッドミルを時速${kmh(o.jogKmh)}にしてください。合図で走り始めます。`,
  normal1: (sec) => `ふつうに走ります。${len(sec)}。`,
  gap: (sec) => `ふつうに戻して。${len(sec)}。`,
  normal2: (sec) => `ここからは、ふつうに走ります。${len(sec)}。`,
  hr: (o) => `心拍が${o.hr}を超えていたら、時速を0.5下げてください。`,
  soon: (s) => `あと${s}秒。`,
  cool: (o) => `おわり。歩いてください。トレッドミルを時速${kmh(o.walkKmh)}にします。${len(o.cool)}。`,
  done: '記録はここまでです。トレッドミルを止めて大丈夫です。おつかれさまでした。',
}

// 秒を「30秒」「3分」「2分30秒」に
export function len(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (!m) return `${s}秒`
  return s ? `${m}分${s}秒` : `${m}分`
}

// 時刻表。sections：区間（key・種類・予定の始まり（秒）・長さ・速さ）。cues：言う言葉（予定の秒）
//   種類：prep（立つ）・walk（歩く）・stop（止める）・jump（合図のジャンプと、じっと立つ）・speedup（速さを上げる）・
//     normal（ふつう）・drill（崩し）・gap（崩しのあとの、ふつうに戻す）・cool（最後の歩き）
//   言葉の begin：その区間の始まりの言葉（言い終えた時刻を、記録の区間の始まりにする）。jump：ジャンプの「はい」
export function buildPlan(o = {}) {
  const opt = { ...DEFAULTS, ...o }
  const steps = opt.steps ?? DEFAULT_STEPS
  for (const k of steps) if (!STEPS[k]) throw new Error(`区間の名前が分かりません: ${k}（使えるもの: ${Object.keys(STEPS).join(', ')}）`)
  const warnings = []
  const last = opt.jog - opt.first - steps.length * (opt.sec + opt.gap)
  if (last < 0) warnings.push(`ジョグ ${len(opt.jog)} に、最初のふつう・崩し・戻しが入りきりません（${len(-last)} はみ出る）。ジョグを ${len(opt.jog - last)} にします`)
  if (opt.first < 240) warnings.push('最初のふつうが4分より短いと、カメラ版の走り始めの自分の基準ができる前に崩しが始まり、崩した姿勢が基準に入ります')
  const sections = []
  const cues = []
  let t = 0
  const section = (key, kind, name, sec, say, extra = {}) => {
    sections.push({ key, kind, name, plannedStart: t, plannedSec: sec, ...extra })
    cues.push({ at: t, say, begin: sections.length - 1 })
    if (['walk', 'normal', 'drill', 'cool'].includes(kind) && sec >= opt.soon + 10) cues.push({ at: t + sec - opt.soon, say: SAY.soon(opt.soon) })
    t += sec
  }
  if (opt.prep > 0) section('prep', 'prep', '立つ', opt.prep, SAY.prep)
  if (opt.walk > 0) section('walk', 'walk', '歩く', opt.walk, SAY.walk(opt), { kmh: opt.walkKmh })
  if (opt.jump) {
    // ベルトを止めて、「ジャンプの合図をします」→ 3、2、1 → 「はい」。はいの時刻が、2台の記録と合わせる手がかり
    if (opt.walk > 0) section('stop', 'stop', '止める', 12, SAY.stop, { kmh: 0 })
    sections.push({ key: 'jump', kind: 'jump', name: 'ジャンプ', plannedStart: t, plannedSec: 14, kmh: 0 })
    cues.push({ at: t, say: SAY.jump, begin: sections.length - 1 })
    cues.push({ at: t + 5, say: '3' }, { at: t + 6, say: '2' }, { at: t + 7, say: '1' }, { at: t + 8, say: SAY.jumpGo, jump: true })
    cues.push({ at: t + 10, say: SAY.still })
    t += 14
  }
  // ジョグの速さにして、3、2、1、スタート。スタートを言い終えた時刻が、最初のふつうの始まり
  section('speedup', 'speedup', '速さを上げる', opt.speedup, SAY.speedup(opt), { kmh: opt.jogKmh })
  cues.push({ at: t - 3, say: '3' }, { at: t - 2, say: '2' }, { at: t - 1, say: '1' })
  const jogStart = t
  section('normal1', 'normal', 'ふつう', opt.first, 'スタート。', { kmh: opt.jogKmh })
  cues.push({ at: jogStart + 1.5, say: SAY.normal1(opt.first) })
  for (const k of steps) {
    section(k, 'drill', STEPS[k].name, opt.sec, `次は、${STEPS[k].say}。${len(opt.sec)}。`, { kmh: opt.jogKmh })
    if (opt.gap > 0) section('gap', 'gap', 'ふつうに戻す', opt.gap, SAY.gap(opt.gap), { kmh: opt.jogKmh, after: k })
  }
  if (last > 0) section('normal2', 'normal', 'ふつう（残り）', last, SAY.normal2(last), { kmh: opt.jogKmh })
  const jogEnd = t
  if (opt.cool > 0) section('cool', 'cool', '歩く（おわり）', opt.cool, SAY.cool(opt), { kmh: opt.walkKmh })
  else cues.push({ at: t, say: 'おわり。歩いてください。' })
  cues.push({ at: t, say: SAY.done, end: true })
  // 心拍の目安：ジョグの間、hrEvery ごと。崩しと戻しの区間（採点に使う）と、ほかの言葉の近くは避けて後ろへずらす
  if (opt.hr > 0) {
    for (let at = jogStart + opt.hrEvery; at < jogEnd - 20; at += opt.hrEvery) {
      let a = at
      const bad = (x) => sections.some((s) => (s.kind === 'drill' || s.kind === 'gap') && x >= s.plannedStart - 8 && x < s.plannedStart + s.plannedSec) || cues.some((c) => Math.abs(c.at - x) < 7)
      while (a < jogEnd - 20 && bad(a)) a += 1
      if (a < jogEnd - 20) cues.push({ at: a, say: SAY.hr(opt) })
    }
  }
  cues.sort((a, b) => a.at - b.at)
  return { options: { ...opt, steps }, sections, cues, total: t, warnings }
}

// ローカルの時刻（Mac の時計）を「HH:MM:SS」に
export function clock(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 「YYYYMMDD-HHMM」（ローカルの時刻）
export function stamp(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
