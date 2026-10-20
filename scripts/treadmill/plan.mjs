// トレッドミルの検証：Mac の声で区間を指示する（scripts/treadmill-drill.mjs）と、採点（scripts/treadmill-grade.mjs）で
// 共通に使う区間の表と、時刻表の作り方。画面やファイルと切り離した計算だけ。
// 区間の key は、スマホ版の崩しの撮影（src/modes/phone/drill.ts の DRILL_STEPS）と同じにしている

// 崩しの区間。say は区間の始まりに言う短い言葉（このあとに長さを足す）。
// camera / phone：その区間で出てほしい判定の項目（採点の「見つけたか」に使う）。空なら、いまは判定しない崩し
// legs：脚に負担の大きい崩し（並びに入れるのは、着地を確かめる回だけ）
// sec：その崩しだけの長さ（なければ options.sec）。着地は16秒の中央値で見るので、1分にする
// metronome：Mac でメトロノームを鳴らす（いつものピッチ options.cadence にこの倍率をかけたテンポ）
export const STEPS = {
  head: { name: '頭を前に', say: '頭を前に出して', camera: ['head'], phone: [] },
  down: { name: '下を向く', say: '下を向いて。目線を足もとに', camera: [], phone: [] },
  hunch: { name: '猫背', say: '猫背にして。背中を丸めて', camera: ['trunk', 'head'], phone: [] },
  lean: { name: '体ごと前に', say: '体ごと前に倒して', camera: ['body', 'trunk'], phone: [] },
  armstill: { name: '腕を振らない', say: '腕を振らないで', camera: [], phone: [] },
  armcross: { name: '腕を横に振る', say: '腕を体の前で、横に振って', camera: [], phone: [] },
  sit: { name: '腰を落とす', say: '腰を落として。ひざを曲げて', camera: ['hip'], phone: [] },
  // 同じ速さでピッチを約1割下げる。仮想実験（sim/result-landing.md）で、着地の基準からの増えの声が出たのは 56%（本当の増え +0.025）。
  // 前回（2026-10-19）は言葉だけで、歩いたり脚の山が出なかったりして使えなかったので、メトロノームに合わせてもらう
  slow: { name: 'ピッチを落とす', say: 'ピッチを約1割落とします。速さはそのまま、走ったまま、メトロノームの音に足音を合わせて、大またで', camera: ['landing'], phone: ['cadence'], sec: 60, metronome: 0.9 },
  bouncy: { name: '弾む', say: '上に弾んで', camera: [], phone: ['bounce'], legs: true },
  // 着地が体より前（オーバーストライド）。3R の動画の着地の崩しは、基準より +0.03〜+0.09
  heel: { name: 'かかとから前に', say: '大またで、足を体より前に伸ばして、かかとから着地', camera: ['landing'], phone: ['braking'], legs: true, sec: 60 },
  flat: { name: 'べた足', say: 'べた足で、ぺたっと着地', camera: [], phone: [], legs: true },
  // 起きた形（体を後ろに残す）。ふつうは走り出しの区間（options.upright）として使い、アプリの整える声（体が後ろに残っています）に従って直す
  upright: { name: '起きた形で走り出す', say: '体を少し後ろに残して、起きた形で', camera: ['bodyBack', 'trunkBack'], phone: [] },
}

// 既定の並び（2回目、2026-10-20 に決めた）：上体の崩しを走ったままの戻しで撮り直し、着地の崩し2つを足す
export const DEFAULT_STEPS = ['head', 'down', 'hunch', 'lean', 'armstill', 'armcross', 'sit', 'heel', 'slow']

export const DEFAULTS = {
  prep: 15, // 始めてから、歩き始めるまで（ベルトの上に立つ間）
  walk: 300, // 最初の歩き（映り方と、歩きを走りと取り違えないかを確かめる）
  walkKmh: 5.0, // 歩きの速さ
  jump: true, // 歩いたあと、ベルトを止めてその場で1回ジャンプ（2台の時計のずれを見る）
  speedup: 20, // ベルトの速さをジョグに上げる（このあと 3、2、1、スタート）
  jog: 1350, // ジョグ全体（起きた形の走り出し ＋ 最初のふつう ＋ 崩しと戻し ＋ 速さを変える ＋ 残りのふつう）
  jogKmh: 8.0, // ジョグの速さ（本人が楽に走れる速さ。BTM W500 は最高 12km/h）
  // 起きた形（体を後ろに残す）で走り出し、アプリの「整える」声に従って直す（声で直せるかは仮想実験では確かめられない）。0 で入れない
  upright: 90,
  // 最初のふつう。カメラ版は、しくみが走り始めてから30秒〜3分の自分を基準にする。しくみが走り始めるのは「スタート」より
  // 少しあと（ベルトが速さに乗って歩数が数えられてから）で、画面から外れた秒は数えないので、3分ちょうどだと基準の終わりが崩しに重なる
  // （2026-10-19 の記録：しくみが走り始めたのは「スタート」の15秒あと、基準ができたのは3分25秒あとで、頭を前にの22秒が基準に入った）。
  // 起きた形の走り出しを入れるときも、そのあとに4分とる（直したあとの形で基準ができるように）
  first: 240,
  sec: 30, // 崩しの区間（STEPS の sec がない崩し）
  gap: 30, // 崩しのあとの、ふつうに戻す区間（0 で入れない）
  cadence: 165, // いつものピッチ（歩／分）。メトロノームのテンポに使う。2026-10-19（時速8km）のふつうの区間は 164〜167
  // 速さを段階的に変える（時速 km。最後にジョグの速さへ戻す）。着地の値が速さでどれだけ変わるかと、速さが変わったときに誤った声が出ないかを見る
  speeds: [9.0, 10.0],
  speedSec: 60, // 速さごとの長さ（戻したあとも同じ長さ走る）
  // ジョグのあと、ベルトを止めてスマホを走る向きと反対へ約30cm動かし、この長さ走る（0 で入れない）。
  // 走っている間の前側・後ろ側の値（yawSign）が +0.07 前後だったのが、置き方のずれ（動かすと約 −0.06）か点の取り方かを見分ける
  moved: 120,
  moveSec: 25, // スマホを動かしてベルトに戻るまで（画面から30秒外れると、カメラ版は走りを終えるので、それより短く）
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
  upright: (sec) => `スタート。体を少し後ろに残して、起きた形で走り出します。アプリの声が聞こえたら、そのとおりに直して、直ったらその形で走ります。${len(sec)}。`,
  normal1: (sec) => `ふつうに走ります。${len(sec)}。`,
  normal1After: (sec) => `ここからは、ふつうの形で走ります。${len(sec)}。`,
  gap: (sec) => `走ったまま、フォームだけ戻して。${len(sec)}。`, // 速さは落とさない（2026-10-19 は戻しのたびに歩きに戻していて、戻しの区間が測れなかった）
  speed: (v, sec) => `トレッドミルを時速${kmh(v)}にしてください。走ったまま、ふつうの形で。${len(sec)}。`,
  speedBack: (v, sec) => `トレッドミルを時速${kmh(v)}に戻してください。走ったまま、ふつうの形で。${len(sec)}。`,
  normal2: (sec) => `ここからは、ふつうに走ります。${len(sec)}。`,
  hr: (o) => `心拍が${o.hr}を超えていたら、時速を0.5下げてください。`,
  soon: (s) => `あと${s}秒。`,
  move: (sec) => `スマホを三脚ごと、トレッドミルと平行に、走る向きと反対へ約30センチ動かしてください。向きは変えません。${sec - 5}秒以内に、ベルトの真ん中に戻ります。`,
  speedup2: (o) => `トレッドミルを時速${kmh(o.jogKmh)}にしてください。合図で走ります。`,
  moved: (sec) => `スタート。ふつうに走ります。${len(sec)}。`,
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

// メトロノームのテンポ（歩／分）：いつものピッチ × 倍率
export const metronomeBpm = (o, k) => Math.round((o.cadence ?? DEFAULTS.cadence) * STEPS[k].metronome)

// 時刻表。sections：区間（key・種類・予定の始まり（秒）・長さ・速さ）。cues：言う言葉（予定の秒）
//   種類：prep（立つ）・walk（歩く）・stop（止める）・jump（合図のジャンプと、じっと立つ）・speedup（速さを上げる）・
//     normal（ふつう）・drill（崩し。起きた形の走り出しも）・gap（崩しのあとの、ふつうに戻す）・speed（速さを変えて、ふつうに走る）・
//     move（スマホを動かす）・moved（スマホを動かしたあとの、ふつうの走り）・cool（最後の歩き）
//   言葉の begin：その区間の始まりの言葉（言い終えた時刻を、記録の区間の始まりにする）。jump：ジャンプの「はい」。
//   metronome：その区間の間、Mac でメトロノームを鳴らす（テンポ・歩／分）
export function buildPlan(o = {}) {
  const opt = { ...DEFAULTS, ...o }
  const steps = opt.steps ?? DEFAULT_STEPS
  for (const k of steps) if (!STEPS[k]) throw new Error(`区間の名前が分かりません: ${k}（使えるもの: ${Object.keys(STEPS).join(', ')}）`)
  const speeds = opt.speeds ?? []
  const warnings = []
  const secOf = (k) => STEPS[k].sec ?? opt.sec
  const drills = steps.reduce((a, k) => a + secOf(k) + opt.gap, 0)
  const speedTotal = speeds.length ? (speeds.length + 1) * opt.speedSec : 0
  const last = opt.jog - opt.upright - opt.first - drills - speedTotal
  if (last < 0) warnings.push(`ジョグ ${len(opt.jog)} に、走り出し・最初のふつう・崩しと戻し・速さを変える区間が入りきりません（${len(-last)} はみ出る）。ジョグを ${len(opt.jog - last)} にします`)
  if (opt.first < 240) warnings.push('最初のふつうが4分より短いと、カメラ版の走り始めの自分の基準ができる前に崩しが始まり、崩した姿勢が基準に入ります')
  if (opt.moved > 0 && opt.moveSec > 28) warnings.push('スマホを動かす間が長いと、画面から30秒外れたところでカメラ版が走りを終えます')
  const sections = []
  const cues = []
  let t = 0
  const section = (key, kind, name, sec, say, extra = {}) => {
    sections.push({ key, kind, name, plannedStart: t, plannedSec: sec, ...extra })
    cues.push({ at: t, say, begin: sections.length - 1, ...(extra.metronome ? { metronome: extra.metronome, sec } : {}) })
    if (['walk', 'normal', 'drill', 'cool', 'speed', 'moved'].includes(kind) && sec >= opt.soon + 10) cues.push({ at: t + sec - opt.soon, say: SAY.soon(opt.soon) })
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
  // ジョグの速さにして、3、2、1、スタート。スタートを言い終えた時刻が、最初の区間（起きた形の走り出しか、最初のふつう）の始まり
  section('speedup', 'speedup', '速さを上げる', opt.speedup, SAY.speedup(opt), { kmh: opt.jogKmh })
  cues.push({ at: t - 3, say: '3' }, { at: t - 2, say: '2' }, { at: t - 1, say: '1' })
  const jogStart = t
  if (opt.upright > 0) {
    section('upright', 'drill', '起きた形で走り出す', opt.upright, SAY.upright(opt.upright), { kmh: opt.jogKmh })
    section('normal1', 'normal', 'ふつう', opt.first, SAY.normal1After(opt.first), { kmh: opt.jogKmh })
  } else {
    section('normal1', 'normal', 'ふつう', opt.first, 'スタート。', { kmh: opt.jogKmh })
    cues.push({ at: jogStart + 1.5, say: SAY.normal1(opt.first) })
  }
  for (const k of steps) {
    const st = STEPS[k]
    const sec = secOf(k)
    const metronome = st.metronome ? metronomeBpm(opt, k) : undefined
    section(k, 'drill', st.name, sec, `次は、${st.say}。${len(sec)}。`, { kmh: opt.jogKmh, ...(metronome ? { metronome } : {}) })
    if (opt.gap > 0) section('gap', 'gap', 'ふつうに戻す', opt.gap, SAY.gap(opt.gap), { kmh: opt.jogKmh, after: k })
  }
  speeds.forEach((v) => section(`speed${kmh(v)}`, 'speed', `時速${kmh(v)}`, opt.speedSec, SAY.speed(v, opt.speedSec), { kmh: v }))
  if (speeds.length) section(`speed${kmh(opt.jogKmh)}`, 'speed', `時速${kmh(opt.jogKmh)}に戻す`, opt.speedSec, SAY.speedBack(opt.jogKmh, opt.speedSec), { kmh: opt.jogKmh })
  if (last > 0) section('normal2', 'normal', 'ふつう（残り）', last, SAY.normal2(last), { kmh: opt.jogKmh })
  const jogEnd = t
  if (opt.moved > 0) {
    section('stop2', 'stop', '止める', 12, SAY.stop, { kmh: 0 })
    section('move', 'move', 'スマホを動かす', opt.moveSec, SAY.move(opt.moveSec), { kmh: 0 })
    section('speedup2', 'speedup', '速さを上げる', opt.speedup, SAY.speedup2(opt), { kmh: opt.jogKmh })
    cues.push({ at: t - 3, say: '3' }, { at: t - 2, say: '2' }, { at: t - 1, say: '1' })
    section('moved', 'moved', 'スマホを動かしたあと', opt.moved, SAY.moved(opt.moved), { kmh: opt.jogKmh })
  }
  if (opt.cool > 0) section('cool', 'cool', '歩く（おわり）', opt.cool, SAY.cool(opt), { kmh: opt.walkKmh })
  else cues.push({ at: t, say: 'おわり。歩いてください。' })
  cues.push({ at: t, say: SAY.done, end: true })
  // 心拍の目安：ジョグの間、hrEvery ごと。崩しと戻し・速さを変える区間・起きた形の走り出し（採点に使う）と、ほかの言葉の近くは避けて後ろへずらす
  // （ずらした結果、前の目安から hrEvery の半分もたっていなければ言わない）
  if (opt.hr > 0) {
    let prev = -Infinity
    for (let at = jogStart + opt.hrEvery; at < jogEnd - 20; at += opt.hrEvery) {
      let a = at
      const bad = (x) => sections.some((s) => ['drill', 'gap', 'speed'].includes(s.kind) && x >= s.plannedStart - 8 && x < s.plannedStart + s.plannedSec) || cues.some((c) => Math.abs(c.at - x) < 7)
      while (a < jogEnd - 20 && bad(a)) a += 1
      if (a < jogEnd - 20 && a - prev >= opt.hrEvery / 2) {
        cues.push({ at: a, say: SAY.hr(opt) })
        prev = a
      }
    }
  }
  cues.sort((a, b) => a.at - b.at)
  return { options: { ...opt, steps }, sections, cues, total: t, warnings }
}

// メトロノームの音（WAV、16bit・1チャンネル）：bpm のテンポで sec 秒。1拍ごとに短い高い音（スマホ版のメトロノームと同じ 1600Hz・0.05秒）
export function clickWav(bpm, sec, rate = 22050) {
  const n = Math.round(sec * rate)
  const data = Buffer.alloc(n * 2)
  const every = (60 / bpm) * rate
  const len = Math.round(0.05 * rate)
  for (let b = 0; b * every < n; b++) {
    const s0 = Math.round(b * every)
    for (let i = 0; i < len && s0 + i < n; i++) {
      const env = Math.min(1, i / 40) * Math.min(1, (len - i) / 200)
      data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 1600 * i) / rate) * env * 0.8 * 32767), (s0 + i) * 2)
    }
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8)
  head.write('fmt ', 12)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
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
