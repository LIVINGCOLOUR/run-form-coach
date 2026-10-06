// Gemini TTS で、アプリが話す言葉を声の種類ごとに音声ファイルにする。
// 使い方: `npm run voices`（Vertex AI。gcloud でログインしておく）
//   既にあるファイルは作り直さない。作り直すときは消してから実行する。
//   一部だけ: `npm run voices -- female` / `npm run voices -- female cueHead`
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import ts from 'typescript'

const root = new URL('..', import.meta.url).pathname

// 作り方は2通り。
//   Vertex AI（既定）: gcloud でログイン済みなら、その権限で呼ぶ。Google Cloud の無料トライアルのクレジットが使える
//     プロジェクトは VERTEX_PROJECT、なければ gcloud の設定のプロジェクト
//   Gemini API（TTS_BACKEND=gemini）: .env.local の GEMINI_API_KEY を使う
const env = existsSync(join(root, '.env.local')) ? readFileSync(join(root, '.env.local'), 'utf8') : ''
const BACKEND = process.env.TTS_BACKEND || 'vertex'
const key = process.env.GEMINI_API_KEY || env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim()
const project = process.env.VERTEX_PROJECT || (BACKEND === 'vertex' ? execFileSync('gcloud', ['config', 'get-value', 'project']).toString().trim() : '')
if (BACKEND === 'gemini' && !key) {
  console.error('GEMINI_API_KEY がありません。.env.local に書いてください。')
  process.exit(1)
}
if (BACKEND === 'vertex' && !project) {
  console.error('Vertex AI のプロジェクトが分かりません。VERTEX_PROJECT を指定するか、gcloud config set project を実行してください。')
  process.exit(1)
}
let token = ''
let tokenAt = 0
const vertexToken = () => {
  // アクセストークンは1時間で切れるので、40分ごとに取り直す
  if (!token || Date.now() - tokenAt > 40 * 60 * 1000) {
    token = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim()
    tokenAt = Date.now()
  }
  return token
}

// TypeScript の言葉の一覧と声の設定を読み込む
const load = (file) => {
  const src = readFileSync(join(root, 'src/core', file), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}))
  return mod.exports
}
const { PHRASES } = load('phrases.ts')
const { VOICES, VOICE_ORDER } = load('voices.ts')

const MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts'
const [onlyVoice, onlyId] = process.argv.slice(2)

async function request(text, voice, style) {
  if (BACKEND === 'vertex') {
    return fetch(`https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vertexToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text, speech_metadata: { style } }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } },
      }),
    })
  }
  return fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
  })
}

function audioOf(json) {
  if (BACKEND === 'vertex') return json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data
  return (json.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).filter((c) => c.type === 'audio').pop()?.data
}

async function tts(text, voice, style) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await request(text, voice, style)
    if (res.ok) {
      const data = audioOf(await res.json())
      if (!data) throw new Error('音声が返ってきませんでした')
      return Buffer.from(data, 'base64')
    }
    const body = await res.text()
    if (res.status === 429 || res.status >= 500) {
      // 回数の上限に当たったら、長めに待つ
      const wait = 30000 * attempt
      console.warn(`  ${res.status}、${wait / 1000}秒待って再試行`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    throw new Error(`${res.status} ${body.slice(0, 300)}`)
  }
  throw new Error('再試行しても失敗しました')
}

// 先頭が RIFF なら WAV。そうでなければ 24kHz・16bit・モノラルの生データとして WAV に包む
function toWav(buf) {
  if (buf.subarray(0, 4).toString() === 'RIFF') return buf
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + buf.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(24000, 24)
  h.writeUInt32LE(48000, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(buf.length, 40)
  return Buffer.concat([h, buf])
}

let made = 0
for (const [kind, v] of Object.entries(VOICES)) {
  // 指定がなければ、設定で選べる声（VOICE_ORDER）だけを作る
  if (onlyVoice ? kind !== onlyVoice : !VOICE_ORDER.includes(kind)) continue
  const dir = join(root, 'public/voices', kind)
  mkdirSync(dir, { recursive: true })
  for (const [id, text] of Object.entries(PHRASES)) {
    if (onlyId && id !== onlyId) continue
    const out = join(dir, `${id}.m4a`)
    if (existsSync(out)) continue
    process.stdout.write(`${kind}/${id} … `)
    const wav = join(dir, `${id}.wav`)
    writeFileSync(wav, toWav(await tts(text, v.gemini, v.style)))
    // iPhone の Safari でも鳴る AAC（m4a）に変換して小さくする
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wav, out])
    rmSync(wav)
    made++
    console.log('ok')
    await new Promise((r) => setTimeout(r, Number(process.env.TTS_GAP_MS ?? (BACKEND === 'vertex' ? 1000 : 7000))))
  }
}
console.log(`作成 ${made} 件`)
