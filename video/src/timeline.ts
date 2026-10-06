import narration from './narration.json'
import { APP_LINES, LINES } from './lines.mjs'
import { FPS } from './theme'

export type SceneKey = 'hook' | 'problem' | 'solution' | 'points' | 'over' | 'hip' | 'head' | 'lr' | 'good' | 'habit' | 'insight' | 'end'
type Id = keyof typeof narration

// 話す順番と、どの場面で話すか
const ORDER: [Id, SceneKey][] = [
  ['n1', 'hook'],
  ['n2', 'problem'],
  ['n3', 'solution'],
  ['n4', 'points'],
  ['n5', 'points'],
  ['n6', 'points'],
  ['n7', 'points'],
  ['n8', 'over'],
  ['aOver', 'over'],
  ['n9', 'hip'],
  ['aHip', 'hip'],
  ['n10', 'head'],
  ['aHead', 'head'],
  ['n11', 'lr'],
  ['aLR', 'lr'],
  ['n12', 'good'],
  ['aGood', 'good'],
  ['n13', 'habit'],
  ['n14', 'insight'],
  ['n15', 'end'],
]

export interface Item {
  id: Id
  app: boolean
  text: string
  start: number // 動画の頭からのフレーム
  len: number
}

export interface SceneSpan {
  key: SceneKey
  from: number
  len: number
  items: Item[] // start は場面の頭からのフレーム
}

const f = (sec: number) => Math.round(sec * FPS)

function build() {
  const items: (Item & { scene: SceneKey })[] = []
  let t = 0.4
  ORDER.forEach(([id, scene], i) => {
    if (i > 0 && ORDER[i - 1][1] !== scene) t += 0.5
    const app = id.startsWith('a')
    const text = app ? APP_LINES[id as keyof typeof APP_LINES].text : LINES[id as keyof typeof LINES]
    const dur = narration[id]
    items.push({ id, app, text, start: f(t), len: f(dur), scene })
    const next = ORDER[i + 1]
    t += dur + (next && next[0].startsWith('a') ? 0.3 : app ? 0.6 : 0.25)
  })
  const keys = [...new Set(ORDER.map(([, s]) => s))]
  const starts = keys.map((k, i) => (i === 0 ? 0 : items.find((x) => x.scene === k)!.start - f(0.35)))
  const last = items[items.length - 1]
  const total = last.start + last.len + f(2.2)
  const scenes: SceneSpan[] = keys.map((key, i) => {
    const from = starts[i]
    const to = i + 1 < keys.length ? starts[i + 1] : total
    return { key, from, len: to - from, items: items.filter((x) => x.scene === key).map((x) => ({ ...x, start: x.start - from })) }
  })
  return { items, scenes, total }
}

export const TIMELINE = build()
