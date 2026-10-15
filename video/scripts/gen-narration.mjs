// 紹介動画の声を Vertex AI の Gemini TTS で作り、長さを src/narration.json に書く
//   n*: ナレーション（男性の声）
//   a*: アプリの声かけ（アプリと同じ女性の声）。アプリにある言葉は、アプリの音声ファイルをそのまま使う
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINES, APP_LINES } from '../src/lines.mjs'
import { COACH, NARRATOR, length, tts } from './tts.mjs'

const root = new URL('..', import.meta.url).pathname
const durations = {}

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
