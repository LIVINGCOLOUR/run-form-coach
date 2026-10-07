// 紹介動画の声を Vertex AI の Gemini TTS で作り、長さを src/narration.json に書く
//   n*: ナレーション（男性の声）
//   a*: アプリの声かけ（アプリと同じ女性の声）。アプリにある言葉は、アプリの音声ファイルをそのまま使う
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINES, APP_LINES } from '../src/lines.mjs'

const root = new URL('..', import.meta.url).pathname
const project = process.env.VERTEX_PROJECT || execFileSync('gcloud', ['config', 'get-value', 'project']).toString().trim()
const token = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim()

const NARRATOR = { voice: 'Autonoe', style: '20代の明るく爽やかな女性ナレーターとして、前向きに、はずむように。でも聞き取りやすく、ていねいに' }
const COACH = { voice: 'Sulafat', style: '日本語のランニングコーチとして、温かく落ち着いた大人の女性の声で、はっきり自然に話してください。' }

async function tts(text, { voice, style }, m4a) {
  const res = await fetch(`https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/gemini-3.8-flash-tts:generateContent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text, speech_metadata: { style } }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } },
    }),
  })
  if (!res.ok) throw new Error(`${m4a}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()).candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data
  const wav = m4a.replace(/\.m4a$/, '.wav')
  writeFileSync(wav, Buffer.from(data, 'base64'))
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wav, m4a])
  rmSync(wav)
}

const durations = {}
const length = (f) => Number(execFileSync('afinfo', [f]).toString().match(/estimated duration: ([\d.]+)/)[1])

mkdirSync(join(root, 'public/narration'), { recursive: true })
for (const [id, text] of Object.entries(LINES)) {
  const f = join(root, 'public/narration', `${id}.m4a`)
  if (!existsSync(f)) await tts(text, NARRATOR, f)
  durations[id] = length(f)
  console.log(id, durations[id].toFixed(2), 's')
}

mkdirSync(join(root, 'public/app'), { recursive: true })
for (const [id, { text, appFile }] of Object.entries(APP_LINES)) {
  const f = join(root, 'public/app', `${id}.m4a`)
  if (!existsSync(f)) {
    const src = appFile && join(root, '../public/voices/female', `${appFile}.m4a`)
    if (src && existsSync(src)) copyFileSync(src, f)
    else await tts(text, COACH, f)
  }
  durations[id] = length(f)
  console.log(id, durations[id].toFixed(2), 's')
}
writeFileSync(join(root, 'src/narration.json'), JSON.stringify(durations, null, 2) + '\n')
