// スマホ標準の読み上げ（日本語）。iPhone では最初にタップした流れで一度鳴らしておく必要がある
let jaVoice: SpeechSynthesisVoice | null = null

function pickVoice() {
  const voices = speechSynthesis.getVoices()
  jaVoice = voices.find((v) => v.lang === 'ja-JP' && /Kyoko|O-ren|Hattori/.test(v.name)) ?? voices.find((v) => v.lang.startsWith('ja')) ?? null
}

export function unlockVoice() {
  if (!('speechSynthesis' in window)) return
  pickVoice()
  speechSynthesis.onvoiceschanged = pickVoice
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  speechSynthesis.speak(u)
}

export function speak(text: string, onSpoken?: (text: string) => void) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  if (jaVoice) u.voice = jaVoice
  u.rate = 1.05
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
  onSpoken?.(text)
}
