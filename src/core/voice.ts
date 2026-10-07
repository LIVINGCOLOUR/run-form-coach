import { PHRASES, phraseId, type PhraseId } from './phrases'
import type { VoiceKind } from './voices'

// 声は Gemini TTS で前もって作った音声ファイルを鳴らす（遅れが出ず、通信も要らない）。
// ファイルがない言葉だけ、スマホ標準の読み上げで代わりに話す。
// iPhone では、最初のタップの流れで AudioContext を動かしておく必要がある
let ctx: AudioContext | null = null
let kind: VoiceKind = 'female'
const buffers = new Map<string, AudioBuffer>()
let current: AudioBufferSourceNode | null = null
let fallbackEl: HTMLAudioElement | null = null

const url = (k: VoiceKind, id: PhraseId) => `${import.meta.env.BASE_URL}voices/${k}/${id}.m4a`

export function unlockVoice() {
  // iPhone の消音スイッチがオンでも鳴るようにする（Safari 16.4 以降の Audio Session）
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = 'playback'
  } catch {
    /* 対応していないブラウザ */
  }
  // audio 要素も一度鳴らして、代わりの鳴らし方を使えるようにしておく
  try {
    fallbackEl ??= new Audio()
    fallbackEl.muted = true
    fallbackEl.play().catch(() => {})
    fallbackEl.muted = false
  } catch {
    fallbackEl = null
  }
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
  if (!buf || !ctx || ctx.state === 'closed') {
    // まだ読み込めていなければ、audio 要素でファイルをそのまま鳴らす。ファイルがない言葉は標準の読み上げ
    if (id && playFile(k, id)) {
      if (ctx) load(k, id)
      return
    }
    fallback(text)
    return
  }
  if (ctx.state !== 'running') {
    // 止まっていて起こせないときは、audio 要素で鳴らす
    ctx.resume().catch(() => {})
    if (id && playFile(k, id)) return
  }
  play(buf)
}

function playFile(k: VoiceKind, id: PhraseId) {
  if (!fallbackEl) return false
  fallbackEl.src = url(k, id)
  fallbackEl.play().catch(() => {})
  return true
}

function play(buf: AudioBuffer) {
  if (!ctx) return
  // iPhone は画面の切り替えなどで音の仕組みが止まることがあるので、起こし直す
  if (ctx.state !== 'running') ctx.resume().catch(() => {})
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
