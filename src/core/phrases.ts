import type { ItemKey } from './types'

// アプリが話す言葉の一覧。id ごとに、声の種類ぶんの音声ファイルを public/voices/<声>/<id>.m4a に用意する
// （scripts/gen-voices.mjs で Gemini TTS から作る）。ここに文を足したら、音声も作り直す
// 前かがみを直す言葉は、体の部位ではなく「たとえ」で言う（部位に意識を向けると走りが硬くなり、たとえは疲れても崩れにくい）。
//   胸のライト：背中が丸まり肩が前に落ちる形（猫背）に。「胸を張る」と違って腰を反らせにくい
//   上から吊られる：足首から体ごと倒れる形と、腰が落ちる形に
export const PHRASES = {
  cueHead: '頭が前に出ています。顎を引いてください。',
  cueTrunk: '前かがみになっています。胸のライトで、前を照らしてください。',
  cueBody: '体が前に倒れすぎています。上から吊られているように、背を高くしてください。',
  cueHip: '腰が落ちています。上から吊られているように意識してください。',
  recover1: 'いい感じです。その姿勢を保ちましょう。',
  recover2: 'いい感じです。',
  start: '始めます。いつもどおり走ってください。',
  pause: '一時停止します。',
  resume: '再開します。',
  end: 'おつかれさまでした。',
  lost: '画面から外れました。トレッドミルの真ん中に戻ってください。',
  giveUp: '戻らないので、ここで終わりにします。おつかれさまでした。',
  praise5: 'いい感じです。きれいな姿勢が続いています。',
  quietStart: 'ここからしばらく、声なしで確認します。',
  quietDone: '声なしでも、きれいな姿勢を保てていました。',
  placeStart: 'トレッドミルの真横に、スマホを縦向きに置いてください。',
  bodyIn: '全身が入りました。',
  placeOk: '見えています。全身が入りました。',
  guideDark: '暗くて見えにくいです。明るい場所に置いてください。',
  guideNone: 'まだ体が映っていません。スマホの前の、トレッドミルの上に立ってください。',
  guideFar: '全身がまだ映っていません。スマホからもう少し離れてください。',
  guideNear: '体が小さく映っています。スマホにもう少し近づいてください。',
  guideTiltDown: 'スマホが下を向いています。腰の高さくらいに置いて、まっすぐ立ててください。',
  guideHigh: 'スマホが高い位置にあります。腰の高さくらいまで下げてください。',
  guideLow: 'スマホが低い位置にあります。腰の高さくらいまで上げてください。',
  guideBehind: '体の少し後ろ側から撮っています。スマホを走る向きに少しずらして、体の真横に置いてください。',
  guideFront: '体の少し前側から撮っています。スマホを走る向きと反対に少しずらして、体の真横に置いてください。',
  guideSide: '横を向いてください。走る向きに立って、体の横をスマホに向けてください。',
  guideForward: '少し前に進んでください。',
  guideBack: '少し後ろに下がってください。',
  baseStand: '目線は正面の、目の高さに。上から吊られるように、まっすぐ立って、3秒止まってください。',
  baseDone: '基準を登録しました。走り出すと始まります。',
  baseGood: '頭も背中もまっすぐです。基準を登録しました。走り出すと始まります。',
  baseHead: '頭が前に出ています。顎を軽く引いて、耳を肩の真上に乗せてください。そのまま3秒止まってください。',
  baseBack: '背中が丸まって、肩が前に落ちています。胸を開いて、肩を腰の真上に乗せてください。そのまま3秒止まってください。',
  baseHeadLeft: '頭が少し前に出たままですが、今日はこの姿勢で始めます。走り出すと始まります。',
  baseBackLeft: '背中が少し丸まったままですが、今日はこの姿勢で始めます。走り出すと始まります。',
  waitRun: 'まだ始まっていません。走り出すと始まります。',
  focusUpright: '今日意識するのは、ひとつだけ。胸のライトで前を照らすように、背を高くして走りましょう。目線は正面に。',
  focusHip: '今日意識するのは、腰の高さです。上から吊られているように、腰を高く保って走りましょう。',
  focusHead: '今日意識するのは、頭の位置です。耳を肩の真上に乗せるように走りましょう。',
  focusAll: '今日は、すべての項目を見ます。崩れたときだけ声をかけます。',
  stepHip: '前かがみにならずに走れるようになりました。今日から、腰の高さも見ます。腰を高く保って走りましょう。',
  stepHead: '腰も高く保てています。今日から、頭の位置も見ます。耳を肩の真上に乗せるように走りましょう。',
  stepAll: '頭の位置も保てています。今日から、すべての項目を見ます。崩れたときだけ声をかけます。',
  sample: 'こんにちは。今日も一緒に、きれいなフォームで走りましょう。',
} as const

export type PhraseId = keyof typeof PHRASES

export const CUE: Record<ItemKey, string> = {
  head: PHRASES.cueHead,
  trunk: PHRASES.cueTrunk,
  body: PHRASES.cueBody,
  hip: PHRASES.cueHip,
}

export const RECOVER = [PHRASES.recover1, PHRASES.recover2]

export const SAY = {
  start: PHRASES.start,
  pause: PHRASES.pause,
  resume: PHRASES.resume,
  end: PHRASES.end,
  lost: PHRASES.lost,
  giveUp: PHRASES.giveUp,
  praise5: PHRASES.praise5,
  quietStart: PHRASES.quietStart,
  quietDone: PHRASES.quietDone,
}

// 文から id を引く（音声ファイルを探すため）
const BY_TEXT = new Map<string, PhraseId>(Object.entries(PHRASES).map(([id, text]) => [text, id as PhraseId]))
export const phraseId = (text: string) => BY_TEXT.get(text)
