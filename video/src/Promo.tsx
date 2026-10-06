import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from 'remotion'
import narration from './narration.json'
import { Caption, SCoach, SEnd, SHabit, SHook, SInsight, SProblem, SSolution, SSteps } from './Scenes'
import { C, FPS } from './theme'

// ナレーションの文（scripts/gen-narration.mjs と同じ）
const LINES: Record<keyof typeof narration, string> = {
  n1: 'フルマラソン。後半で、失速していませんか。',
  n2: '原因のひとつは、疲れて崩れるフォーム。でも、走っている自分の姿は、自分では見えません。',
  n3: 'ランフォームコーチ。スマホ一台で、あなたの走りを見続ける、AIコーチです。',
  n4: '置いて、立って、走るだけ。',
  n5: '崩れた瞬間に、声で直す。だから、疲れた後半でも崩れないフォームが、体に残ります。',
  n6: '走り姿は、骨格で見える化。次に直すのは、ひとつだけ。',
  n7: '後半で、落ちない走りへ。ランフォームコーチ。',
}

// 場面：開始フレーム、長さ、ナレーション（場面の頭からのずれ）
const S = (sec: number) => Math.round(sec * FPS)
const SCENES = [
  { C: SHook, from: S(0), len: S(5.5), n: 'n1' as const, at: S(0.4) },
  { C: SProblem, from: S(5.5), len: S(11), n: 'n2' as const, at: S(0.4) },
  { C: SSolution, from: S(16.5), len: S(10), n: 'n3' as const, at: S(0.4) },
  { C: SSteps, from: S(26.5), len: S(4.5), n: 'n4' as const, at: S(0.2) },
  { C: SCoach, from: S(31), len: S(7.5), n: null, at: 0 },
  { C: SHabit, from: S(38.5), len: S(10), n: 'n5' as const, at: S(0.3) },
  { C: SInsight, from: S(48.5), len: S(7.5), n: 'n6' as const, at: S(0.2) },
  { C: SEnd, from: S(56), len: S(6), n: 'n7' as const, at: S(0.3) },
]
export const TOTAL = S(62)
const MUSIC_AT = S(2.8)

export function Promo() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {SCENES.map(({ C: Scene, from, len, n, at }, i) => (
        <Sequence key={i} from={from} durationInFrames={len}>
          <Scene />
          {n && <Caption text={LINES[n]} from={at} to={Math.min(len, at + Math.ceil(narration[n] * FPS) + 6)} />}
          {n && (
            <Sequence from={at}>
              <Audio src={staticFile(`narration/${n}.m4a`)} />
            </Sequence>
          )}
        </Sequence>
      ))}

      {/* 走行中の場面は、アプリで実際に流れる声 */}
      <Sequence from={S(31) + 15}>
        <Audio src={staticFile('app/cueHead.m4a')} />
      </Sequence>
      <Sequence from={S(31) + 132}>
        <Audio src={staticFile('app/recover1.m4a')} />
      </Sequence>

      <Sequence from={MUSIC_AT}>
        <Audio
          src={staticFile('music.mp3')}
          volume={(f) => {
            const t = f + MUSIC_AT
            // ナレーションの間は音楽を下げる
            const speaking = SCENES.some((s) => s.n && t >= s.from + s.at && t <= s.from + s.at + narration[s.n] * FPS) || (t >= S(31) + 15 && t <= S(31) + 240)
            const base = speaking ? 0.22 : 0.5
            return base * interpolate(f, [0, 20], [0, 1], { extrapolateRight: 'clamp' }) * interpolate(t, [TOTAL - 30, TOTAL], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          }}
        />
      </Sequence>
    </AbsoluteFill>
  )
}
