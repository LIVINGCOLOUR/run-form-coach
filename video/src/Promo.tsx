import React from 'react'
import type { ComponentType } from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from 'remotion'
import { Caption, SInsight, SSolution } from './Scenes'
import { SEnd2, SHabits, SLearn, SRelapse, STime } from './Scenes3'
import { SExample, SPoints } from './Scenes2'
import { TIMELINE, type Item, type SceneKey } from './timeline'
import { C, FPS } from './theme'

const SCENES: Record<SceneKey, ComponentType<{ items: Item[] }>> = {
  habits: SHabits,
  relapse: SRelapse,
  solution: SSolution,
  points: SPoints,
  over: (p) => <SExample kind="over" {...p} />,
  head: (p) => <SExample kind="head" {...p} />,
  hip: (p) => <SExample kind="hip" {...p} />,
  lr: (p) => <SExample kind="lr" {...p} />,
  good: (p) => <SExample kind="good" {...p} />,
  learn: SLearn,
  insight: SInsight,
  time: STime,
  end: SEnd2,
}

export const TOTAL = TIMELINE.total
const MUSIC_AT = Math.round(0.2 * FPS)

export function Promo() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {TIMELINE.scenes.map(({ key, from, len, items }) => {
        const Scene = SCENES[key]
        return (
          <Sequence key={key} from={from} durationInFrames={len}>
            <Scene items={items} />
            {/* ナレーションには字幕。アプリの声かけは場面の中の吹き出しで見せる */}
            {items
              .filter((it) => !it.app && key !== 'points')
              .map((it) => (
                <Caption key={it.id} text={it.text} from={it.start} to={Math.min(len, it.start + it.len + 6)} />
              ))}
            {items.map((it) => (
              <Sequence key={it.id} from={it.start}>
                <Audio src={staticFile(it.app ? `app/${it.id}.m4a` : `narration/${it.id}.m4a`)} />
              </Sequence>
            ))}
          </Sequence>
        )
      })}

      <Sequence from={MUSIC_AT}>
        <Audio
          src={staticFile('music3.mp3')}
          volume={(f) => {
            const t = f + MUSIC_AT
            // 声の間は音楽を下げる
            const speaking = TIMELINE.items.some((it) => t >= it.start - 4 && t <= it.start + it.len + 4)
            const base = speaking ? 0.2 : 0.48
            return (
              base *
              interpolate(f, [0, 20], [0, 1], { extrapolateRight: 'clamp' }) *
              interpolate(t, [TOTAL - 40, TOTAL], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            )
          }}
        />
      </Sequence>
    </AbsoluteFill>
  )
}
