import { PHRASES, phraseId, type PhraseId } from './phrases'
import type { VoiceKind } from './voices'

// 声は Gemini TTS で前もって作った音声ファイルを鳴らす（遅れが出ず、通信も要らない）。
// ファイルがない言葉だけ、スマホ標準の読み上げで代わりに話す。
// iPhone では、最初のタップの流れで AudioContext を動かしておく必要がある
let ctx: AudioContext | null = null
let kind: VoiceKind = 'female'
const buffers = new Map<string, AudioBuffer>()
let current: AudioBufferSourceNode | null = null

const url = (k: VoiceKind, id: PhraseId) => `${import.meta.env.BASE_URL}voices/${k}/${id}.m4a`

export function unlockVoice() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    // 無音を一瞬鳴らして、以後の再生を許可させる
    const b = ctx.createBuffer(1, 1, 22050)
    const s = ctx.createBufferSource()
    s.buffer = b
    s.connect(ctx.destination)
    s.start()
  } catch {
    ctx = null
  }
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    speechSynthesis.speak(u)
  }
}

async function load(k: VoiceKind, id: PhraseId): Promise<AudioBuffer | null> {
  const key = `${k}/${id}`
  const hit = buffers.get(key)
  if (hit) return hit
  if (!ctx) return null
  try {
    const res = await fetch(url(k, id))
    if (!res.ok) return null
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    buffers.set(key, buf)
    return buf
  } catch {
    return null
  }
}

// 走り出す前に、その声の全部の言葉を読み込んでおく
export async function preloadVoice(k: VoiceKind) {
  kind = k
  await Promise.all((Object.keys(PHRASES) as PhraseId[]).map((id) => load(k, id)))
}

function fallback(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  u.rate = 1.05
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

export function speak(text: string, k: VoiceKind = kind) {
  const id = phraseId(text)
  const buf = id ? buffers.get(`${k}/${id}`) : undefined
  if (!buf || !ctx) {
    // まだ読み込めていなければ、読み込めしだい鳴らす
    if (id && ctx) {
      load(k, id).then((b) => (b ? play(b) : fallback(text)))
      return
    }
    fallback(text)
    return
  }
  play(buf)
}

function play(buf: AudioBuffer) {
  if (!ctx) return
  try {
    current?.stop()
  } catch {
    /* すでに止まっている */
  }
  const s = ctx.createBufferSource()
  s.buffer = buf
  s.connect(ctx.destination)
  s.start()
  current = s
}

export function stopVoice() {
  try {
    current?.stop()
  } catch {
    /* すでに止まっている */
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}
