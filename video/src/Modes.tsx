import React from 'react'
import type { ComponentType } from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from 'remotion'
import { SInsight } from './Scenes'
import { SExample, SPoints } from './Scenes2'
import { SEnd2, SHabits, SRelapse } from './Scenes3'
import { SCamera, SIntro, SPhone, SSensor } from './ScenesModes'
import { buzzAt, CLICK_SEC, MODES_TIMELINE, type MItem, type ModesScene } from './timeline-modes'
import type { Item } from './timeline'
import { C, FPS } from './theme'

// 2本目の紹介動画：冒頭は1本目と同じ。「ランフォームコーチ」のあとを「使い方は3つ」にした
// 冒頭と締めの場面は1本目の部品をそのまま使う（items の形は同じ。id の型だけが違う）
const asItems = (p: { items: MItem[] }) => p.items as unknown as Item[]
const SCENES: Record<ModesScene, ComponentType<{ items: MItem[] }>> = {
  habits: (p) => <SHabits items={asItems(p)} />,
  relapse: (p) => <SRelapse items={asItems(p)} />,
  intro: SIntro,
  phone: SPhone,
  camera: SCamera,
  nine: (p) => <SPoints items={asItems(p)} />,
  hip: (p) => {
    // 「脚の力をむだに使い」のあたりで、見出しの下に一行足す
    const [m17] = p.items
    return <SExample kind="hip" items={asItems(p)} sub={{ text: '脚の力をむだに使い、疲れやすい。', at: m17.start + Math.round(m17.len * 0.68) }} />
  },
  review: () => <SInsight note="正しいフォームと比べて、次に直すのは" />,
  sensor: SSensor,
  end: (p) => <SEnd2 items={asItems(p)} tagline="外でも、トレッドミルでも。" size={96} />,
}

const T = MODES_TIMELINE
export const MODES_TOTAL = T.total
const MUSIC_AT = Math.round(0.2 * FPS)

// メトロノームの音：スマホの場面の声かけのあとに4回
const cue = T.items.find((it) => it.id === 'aCadence')!
const CLICKS = Array.from({ length: 4 }, (_, k) => cue.start + cue.len + 6 + Math.round(k * CLICK_SEC * FPS))
// 振動の音：センサーの場面で、胸のセンサーが震えるとき（声かけはなし）
const BUZZ = buzzAt(T.items.find((it) => it.id === 'm21')!)

export function Modes() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {T.scenes.map(({ key, from, len, items }) => {
        const Scene = SCENES[key]
        return (
          <Sequence key={key} from={from} durationInFrames={len}>
            <Scene items={items} />
            {/* 字幕は付けない（1本目と同じ。見出しの文字で中身が分かる） */}
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

      <Sequence from={BUZZ} durationInFrames={16}>
        <Audio src={staticFile('app-modes/buzz.wav')} volume={0.7} />
      </Sequence>

      <Sequence from={MUSIC_AT}>
        <Audio
          src={staticFile('music3.mp3')}
          volume={(f) => {
            const t = f + MUSIC_AT
            // 声とメトロノーム、振動の音の間は音楽を下げる
            const speaking = T.items.some((it) => t >= it.start - 4 && t <= it.start + it.len + 4) || CLICKS.some((c) => t >= c - 6 && t <= c + 10) || (t >= BUZZ - 6 && t <= BUZZ + 20)
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
