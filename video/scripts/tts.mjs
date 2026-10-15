// 紹介動画の声を Vertex AI の Gemini TTS で作る（gen-narration.mjs と gen-narration-modes.mjs で共通）
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const project = process.env.VERTEX_PROJECT || execFileSync('gcloud', ['config', 'get-value', 'project']).toString().trim()
const token = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim()

export const NARRATOR = { voice: 'Autonoe', style: '20代の明るく爽やかな女性ナレーターとして、前向きに、はずむように。でも聞き取りやすく、ていねいに' }
export const COACH = { voice: 'Sulafat', style: '日本語のランニングコーチとして、温かく落ち着いた大人の女性の声で、はっきり自然に話してください。' }

export async function tts(text, { voice, style }, m4a) {
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

export const length = (f) => Number(execFileSync('afinfo', [f]).toString().match(/estimated duration: ([\d.]+)/)[1])
