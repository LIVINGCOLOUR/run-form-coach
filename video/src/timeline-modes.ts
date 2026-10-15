import narration from './narration-modes.json'
import { APP_LINES as APP1, LINES as LINES1 } from './lines.mjs'
import { APP_LINES, LINES } from './lines-modes.mjs'
import { FPS } from './theme'

// 2本目の紹介動画（使い方は3つ）。冒頭（n1〜n4）と締め（n19）、頭の声かけ（aHead）は1本目の音声を使い回す
export type ModesScene = 'habits' | 'relapse' | 'intro' | 'phone' | 'camera' | 'review' | 'sensor' | 'end'
type Id = keyof typeof narration

const ORDER: [Id, ModesScene][] = [
  ['n1', 'habits'],
  ['n2', 'habits'],
  ['n3', 'relapse'],
  ['n4', 'relapse'],
  ['m5', 'intro'],
  ['m6', 'phone'],
  ['m7', 'phone'],
  ['aCadence', 'phone'],
  ['m8', 'phone'],
  ['m9', 'camera'],
  ['m10', 'camera'],
  ['aHead', 'camera'],
  ['m11', 'review'],
  ['m12', 'sensor'],
  ['m13', 'sensor'],
  ['aArm', 'sensor'],
  ['n19', 'end'],
]

// 声のあとに置く間（秒）。メトロノームの場面は、声かけのあとに音を数回鳴らすぶん長くとる
const AFTER: Partial<Record<Id, number>> = { aCadence: 1.5 }
export const CLICK_SEC = 60 / 176 // メトロノームの間隔（毎分176歩）

export interface MItem {
  id: Id
  app: boolean
  text: string
  src: string // public/ からのパス
  start: number // 場面の頭からのフレーム（items 全体では動画の頭から）
  len: number
}

export interface MSceneSpan {
  key: ModesScene
  from: number
  len: number
  items: MItem[]
}

const f = (sec: number) => Math.round(sec * FPS)

function source(id: Id): { text: string; src: string; app: boolean } {
  if (id in LINES) return { text: LINES[id as keyof typeof LINES], src: `narration-modes/${id}.m4a`, app: false }
  if (id in APP_LINES) return { text: APP_LINES[id as keyof typeof APP_LINES].text, src: `app-modes/${id}.m4a`, app: true }
  if (id in APP1) return { text: APP1[id as keyof typeof APP1].text, src: `app/${id}.m4a`, app: true }
  return { text: LINES1[id as keyof typeof LINES1], src: `narration/${id}.m4a`, app: false }
}

function build() {
  const items: (MItem & { scene: ModesScene })[] = []
  let t = 0.4
  ORDER.forEach(([id, scene], i) => {
    if (i > 0 && ORDER[i - 1][1] !== scene) t += 0.35
    const s = source(id)
    const dur = narration[id]
    items.push({ id, ...s, start: f(t), len: f(dur), scene })
    const next = ORDER[i + 1]
    t += dur + (AFTER[id] ?? (next && next[0].startsWith('a') ? 0.3 : s.app ? 0.45 : 0.25))
  })
  const keys = [...new Set(ORDER.map(([, s]) => s))]
  const starts = keys.map((k, i) => (i === 0 ? 0 : items.find((x) => x.scene === k)!.start - f(0.35)))
  const last = items[items.length - 1]
  const total = last.start + last.len + f(2.2)
  const scenes: MSceneSpan[] = keys.map((key, i) => {
    const from = starts[i]
    const to = i + 1 < keys.length ? starts[i + 1] : total
    return { key, from, len: to - from, items: items.filter((x) => x.scene === key).map((x) => ({ ...x, start: x.start - from })) }
  })
  return { items, scenes, total }
}

export const MODES_TIMELINE = build()
