// 2本目の紹介動画（使い方は3つ）の声を作り、長さを src/narration-modes.json に書く
//   m*: ナレーション（1本目と同じ声）→ public/narration-modes/
//   a*: アプリの声かけ（アプリと同じ声）→ public/app-modes/。アプリにある言葉は、アプリの音声ファイルをそのまま使う
//   1本目から使い回す音声（冒頭 n1〜n4、締め n19、頭の声かけ aHead）は、長さを測るだけ
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINES, APP_LINES } from '../src/lines-modes.mjs'
import { COACH, NARRATOR, length, tts } from './tts.mjs'

const root = new URL('..', import.meta.url).pathname
const durations = {}

for (const id of ['n1', 'n2', 'n3', 'n4', 'n19']) durations[id] = length(join(root, 'public/narration', `${id}.m4a`))
durations.aHead = length(join(root, 'public/app', 'aHead.m4a'))

mkdirSync(join(root, 'public/narration-modes'), { recursive: true })
for (const [id, text] of Object.entries(LINES)) {
  const f = join(root, 'public/narration-modes', `${id}.m4a`)
  if (!existsSync(f)) await tts(text, NARRATOR, f)
  durations[id] = length(f)
  console.log(id, durations[id].toFixed(2), 's')
}

mkdirSync(join(root, 'public/app-modes'), { recursive: true })
for (const [id, { text, appFile }] of Object.entries(APP_LINES)) {
  const f = join(root, 'public/app-modes', `${id}.m4a`)
  if (!existsSync(f)) {
    const src = appFile && join(root, '../public/voices/female', `${appFile}.m4a`)
    if (src && existsSync(src)) copyFileSync(src, f)
    else await tts(text, COACH, f)
  }
  durations[id] = length(f)
  console.log(id, durations[id].toFixed(2), 's')
}
writeFileSync(join(root, 'src/narration-modes.json'), JSON.stringify(durations, null, 2) + '\n')
