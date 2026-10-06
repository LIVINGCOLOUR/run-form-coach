import type { ItemKey } from './types'

// 声の言い回し：何が起きているか ＋ どうすればいいか
export const CUE: Record<ItemKey, string> = {
  head: '頭が前に出ています。顎を引いてください。',
  trunk: '上体が前に倒れすぎています。骨盤を立てて、上体を起こしてください。',
  body: '体が前に倒れすぎています。上から吊られているように、体を起こしてください。',
  hip: '腰が落ちています。上から吊られているように意識してください。',
}

export const RECOVER = ['いい感じです。その姿勢を保ちましょう。', 'いい感じです。']

export const SAY = {
  start: '始めます。いつもどおり走ってください。',
  pause: '一時停止します。',
  resume: '再開します。',
  end: 'おつかれさまでした。',
  praise5: 'いい感じです。きれいな姿勢が続いています。',
  quietStart: 'ここからしばらく、声なしで確認します。',
  quietDone: '声なしでも、きれいな姿勢を保てていました。',
}
