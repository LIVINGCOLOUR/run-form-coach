import type { ItemKey } from './types'

// アプリが話す言葉の一覧。id ごとに、声の種類ぶんの音声ファイルを public/voices/<声>/<id>.m4a に用意する
// （scripts/gen-voices.mjs で Gemini TTS から作る）。ここに文を足したら、音声も作り直す
export const PHRASES = {
  cueHead: '頭が前に出ています。顎を引いてください。',
  cueTrunk: '上体が前に倒れすぎています。骨盤を立てて、上体を起こしてください。',
  cueBody: '体が前に倒れすぎています。上から吊られているように、体を起こしてください。',
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
  guideSide: '横を向いてください。走る向きに立って、体の横をスマホに向けてください。',
  guideForward: '少し前に進んでください。',
  guideBack: '少し後ろに下がってください。',
  baseStand: '上から吊られるように、まっすぐ立って、3秒止まってください。',
  baseDone: '基準を登録しました。走り出すと始まります。',
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
