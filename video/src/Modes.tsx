import React from 'react'
import type { ComponentType } from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { SInsight } from './Scenes'
import { SEnd2, SHabits, SRelapse } from './Scenes3'
import { breakAt, SCamera, SIntro, SPhone, SSensor } from './ScenesModes'
import { CLICK_SEC, MODES_TIMELINE, type MItem, type ModesScene } from './timeline-modes'
import type { Item } from './timeline'
import { C, FPS, jp } from './theme'

// 2本目の紹介動画：冒頭は1本目と同じ。「ランフォームコーチ」のあとを「使い方は3つ」にした
// 冒頭と締めの場面は1本目の部品をそのまま使う（items の形は同じ。id の型だけが違う）
const asItems = (p: { items: MItem[] }) => p.items as unknown as Item[]
const SCENES: Record<ModesScene, ComponentType<{ items: MItem[] }>> = {
  habits: (p) => <SHabits items={asItems(p)} />,
  relapse: (p) => <SRelapse items={asItems(p)} />,
  intro: SIntro,
  phone: SPhone,
  camera: SCamera,
  review: () => <SInsight />,
  sensor: SSensor,
  end: (p) => <SEnd2 items={asItems(p)} tagline="外でも、トレッドミルでも。" size={96} />,
}

// ナレーションの字幕（1本目の Caption と同じ形）。場面の外に置くので、字の形と色をここで決める。
// 長い文は区切りのよい所で2行にする
function Caption({ text, from, to }: { text: string; from: number; to: number }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [from, from + 6, to - 6, to], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left: 50, right: 50, bottom: 56, display: 'flex', justifyContent: 'center', opacity: o, fontFamily: jp, color: C.text }}>
      <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.5, textAlign: 'center', padding: '18px 30px', borderRadius: 20, background: 'rgba(10,12,14,0.78)' }}>{breakAt(text, 22)}</div>
    </div>
  )
}

const T = MODES_TIMELINE
export const MODES_TOTAL = T.total
const MUSIC_AT = Math.round(0.2 * FPS)

// メトロノームの音：スマホの場面の声かけのあとに4回
const cue = T.items.find((it) => it.id === 'aCadence')!
const CLICKS = Array.from({ length: 4 }, (_, k) => cue.start + cue.len + 6 + Math.round(k * CLICK_SEC * FPS))

export function Modes() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {T.scenes.map(({ key, from, len, items }) => {
        const Scene = SCENES[key]
        return (
          <Sequence key={key} from={from} durationInFrames={len}>
            <Scene items={items} />
            {/* ナレーションには字幕。アプリの声かけは場面の中の吹き出しで見せる */}
            {items
              .filter((it) => !it.app)
              .map((it) => (
                <Caption key={it.id} text={it.text} from={it.start} to={Math.min(len, it.start + it.len + 6)} />
              ))}
            {items.map((it) => (
              <Sequence key={it.id} from={it.start}>
                <Audio src={staticFile(it.src)} />
              </Sequence>
            ))}
          </Sequence>
        )
      })}

      {CLICKS.map((at, k) => (
        <Sequence key={`c${k}`} from={at} durationInFrames={6}>
          <Audio src={staticFile('app-modes/click.wav')} volume={0.55} />
        </Sequence>
      ))}

      <Sequence from={MUSIC_AT}>
        <Audio
          src={staticFile('music3.mp3')}
          volume={(f) => {
            const t = f + MUSIC_AT
            // 声とメトロノームの間は音楽を下げる
            const speaking = T.items.some((it) => t >= it.start - 4 && t <= it.start + it.len + 4) || CLICKS.some((c) => t >= c - 6 && t <= c + 10)
            const base = speaking ? 0.2 : 0.48
            return (
              base *
              interpolate(f, [0, 20], [0, 1], { extrapolateRight: 'clamp' }) *
              interpolate(t, [MODES_TOTAL - 40, MODES_TOTAL], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            )
          }}
        />
      </Sequence>
    </AbsoluteFill>
  )
}
