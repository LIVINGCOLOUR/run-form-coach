// 声の種類と、Gemini TTS で作るときの声・話し方
export type VoiceKind = 'female' | 'male' | 'girl' | 'boy'

export const VOICES: Record<VoiceKind, { label: string; gemini: string; style: string }> = {
  female: {
    label: '女性',
    gemini: 'Sulafat',
    style: '日本語のランニングコーチとして、温かく落ち着いた大人の女性の声で、はっきり自然に話してください。',
  },
  male: {
    label: '男性',
    gemini: 'Achird',
    style: '日本語のランニングコーチとして、親しみやすく落ち着いた大人の男性の声で、はっきり自然に話してください。',
  },
  girl: {
    label: '女の子',
    gemini: 'Leda',
    style: '10歳くらいの明るく元気な女の子が、走っている人を応援するように、高めの声で自然に話してください。',
  },
  boy: {
    label: '男の子',
    gemini: 'Puck',
    style: '10歳くらいの元気な男の子が、走っている人を応援するように、高めの声で自然に話してください。',
  },
}

// フェーズ1は女性の声だけ。ほかの声は音声ファイルを作ってから、ここに戻す
export const VOICE_ORDER: VoiceKind[] = ['female']
