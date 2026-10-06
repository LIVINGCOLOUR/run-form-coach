// 紹介動画のナレーションを Vertex AI の Gemini TTS で作り、長さを assets/narration.json に書く
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'public/narration')
mkdirSync(out, { recursive: true })

const project = process.env.VERTEX_PROJECT || execFileSync('gcloud', ['config', 'get-value', 'project']).toString().trim()
const token = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim()
const VOICE = 'Algieba'
const STYLE = 'スポーツの映像のナレーターとして、落ち着いて力強く、かっこよく。言葉の間をたっぷりとって、ゆっくり語る'

export const LINES = {
  n1: 'フルマラソン。後半で、失速していませんか。',
  n2: '原因のひとつは、疲れて崩れるフォーム。でも、走っている自分の姿は、自分では見えません。',
  n3: 'ランフォームコーチ。スマホ一台で、あなたの走りを見続ける、AIコーチです。',
  n4: '置いて、立って、走るだけ。',
  n5: '崩れた瞬間に、声で直す。だから、疲れた後半でも崩れないフォームが、体に残ります。',
  n6: '走り姿は、骨格で見える化。次に直すのは、ひとつだけ。',
  n7: '後半で、落ちない走りへ。ランフォームコーチ。',
}

const durations = {}
for (const [id, text] of Object.entries(LINES)) {
  const m4a = join(out, `${id}.m4a`)
  if (!existsSync(m4a)) {
    const res = await fetch(`https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/gemini-3.8-flash-tts:generateContent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: STYLE } }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: VOICE } } },
      }),
    })
    if (!res.ok) throw new Error(`${id}: ${res.status} ${(await res.text()).slice(0, 300)}`)
    const json = await res.json()
    const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data
    const wav = join(out, `${id}.wav`)
    writeFileSync(wav, Buffer.from(data, 'base64'))
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wav, m4a])
    rmSync(wav)
  }
  const info = execFileSync('afinfo', [m4a]).toString()
  durations[id] = Number(info.match(/estimated duration: ([\d.]+)/)[1])
  console.log(id, durations[id].toFixed(2), 's')
}
writeFileSync(join(root, 'src/narration.json'), JSON.stringify(durations, null, 2) + '\n')
