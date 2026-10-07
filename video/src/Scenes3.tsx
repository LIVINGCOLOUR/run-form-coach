import React from 'react'
import { Easing, interpolate, interpolateColors, spring, useCurrentFrame } from 'remotion'
import { Bg } from './Scenes'
import { Figure } from './Figure'
import type { Item } from './timeline'
import { C, FPS, num } from './theme'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const fadeUp = (f: number, at: number, dur = 14) => ({
  opacity: interpolate(f, [at, at + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(f, [at, at + dur], [40, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
})
const pop = (f: number, at: number) => spring({ frame: f - at, fps: FPS, config: { damping: 14, stiffness: 170 } })
const H2 = { fontWeight: 900, fontSize: 76, lineHeight: 1.3, letterSpacing: -1 } as const

// 1. 自己流のクセ：頭が前・足が前すぎ・腰が落ちる を順にオレンジで重ねる
export function SHabits({ items }: { items: Item[] }) {
  const f = useCurrentFrame()
  const [n1, n2] = items
  // n2 の「頭が前」「足が前」「腰が落ちる」を、文の長さのおよその位置で出す
  const at = [0.0, 0.2, 0.42].map((r) => n2.start + Math.round(n2.len * r))
  const head = interpolate(f, [at[0], at[0] + 12], [0, 1], clamp)
  const leg = interpolate(f, [at[1], at[1] + 12], [0, 1], clamp)
  const hip = interpolate(f, [at[2], at[2] + 12], [0, 1], clamp)
  const labels: [string, number, number][] = [
    ['頭が前に出ている', at[0], 640],
    ['足が前に出すぎている', at[1], 1330],
    ['腰が落ちている', at[2], 1020],
  ]
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 80, top: 210, ...fadeUp(f, n1.start) }}>
        <div style={H2}>
          自分のフォーム、
          <br />
          <span style={{ color: C.accent }}>見たことありますか。</span>
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <Figure
          frame={f}
          lean={8 + 4 * head}
          head={11 * head}
          drop={14 * hip}
          upper={interpolateColors(head, [0, 1], [C.limb, C.warn])}
          legColor={interpolateColors(leg, [0, 1], [C.limb, C.warn])}
          transform="translate(150,560) scale(2)"
        />
      </svg>
      {labels.map(([t, a, y]) => {
        const s = pop(f, a)
        return (
          <div key={t} style={{ position: 'absolute', right: 60, top: y, opacity: Math.min(1, s), transform: `translateX(${(1 - Math.min(1, s)) * 60}px)` }}>
            <div style={{ padding: '14px 24px', borderRadius: 30, background: C.warn, color: C.bg, fontWeight: 900, fontSize: 38 }}>{t}</div>
          </div>
        )
      })}
    </Bg>
  )
}

// 2. 教わっても、ひとりで走ると元どおり：7日分の点が、教室の日だけライムで、あとはオレンジに戻る
export function SRelapse({ items }: { items: Item[] }) {
  const f = useCurrentFrame()
  const [n3, n4] = items
  const days = ['教室', '2日目', '3日目', '4日目', '5日目', '6日目', '7日目']
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 80, top: 210, ...fadeUp(f, n3.start) }}>
        <div style={H2}>
          教わっても、
          <br />
          ひとりだと<span style={{ color: C.warn }}>元どおり。</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 60, right: 60, top: 560, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {days.map((d, i) => {
          const at = n3.start + 10 + i * 12
          const s = pop(f, at)
          // 教室の日はライム。あとは日を追うごとにオレンジへ戻っていく
          const k = i === 0 ? 0 : Math.min(1, i / 3)
          const color = interpolateColors(k, [0, 1], [C.accent, C.warn])
          return (
            <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: Math.min(1, s), transform: `translateX(${(1 - Math.min(1, s)) * -50}px)` }}>
              <div style={{ width: 150, fontSize: 36, fontWeight: 700, color: i === 0 ? C.accent : C.muted }}>{d}</div>
              <div style={{ flexGrow: 1, height: 44, borderRadius: 22, background: C.line, overflow: 'hidden' }}>
                <div style={{ width: `${(i === 0 ? 92 : 92 - i * 7) * Math.min(1, s)}%`, height: 44, borderRadius: 22, background: color }} />
              </div>
              <div style={{ width: 210, fontSize: 30, color }}>{i === 0 ? 'コーチと一緒' : i < 3 ? '少しずつ崩れる' : '元どおり'}</div>
            </div>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 1330, ...fadeUp(f, n4.start) }}>
        <div style={{ ...H2, fontSize: 70 }}>
          崩れたまま、
          <br />
          走り続けていませんか。
        </div>
      </div>
    </Bg>
  )
}

// 3. 走りながら体で覚える：崩れ→声→直る を繰り返すうちに、オレンジが出なくなる
export function SLearn({ items }: { items: Item[] }) {
  const f = useCurrentFrame()
  const [n15, n16] = items
  const cycle = 46
  const reps = 6
  const i = Math.min(reps - 1, Math.floor(f / cycle))
  const t = f % cycle
  // 回を重ねるほど、崩れが小さく短くなる
  const amp = Math.max(0, 1 - i / (reps - 1))
  const bad = t < 18 ? amp : t < 30 ? amp * (1 - (t - 18) / 12) : 0
  const upper = interpolateColors(bad, [0, 1], [C.accent, C.warn])
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 80, top: 210, ...fadeUp(f, n15.start) }}>
        <div style={H2}>
          走りながら、
          <br />
          <span style={{ color: C.accent }}>体で覚える。</span>
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <Figure frame={f} lean={8 + 4 * bad} head={11 * bad} upper={upper} transform="translate(210,470) scale(1.65)" />
      </svg>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 1250, display: 'flex', gap: 14 }}>
        {Array.from({ length: reps }, (_, k) => (
          <div key={k} style={{ flexGrow: 1, height: 18, borderRadius: 9, background: k <= i ? interpolateColors(1 - k / (reps - 1), [0, 1], [C.accent, C.warn]) : C.line }} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: 80, top: 1300, fontSize: 30, color: C.muted }}>声をかけるたびに、崩れが小さくなっていく</div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 1390, ...fadeUp(f, n16.start) }}>
        <div style={{ fontWeight: 900, fontSize: 54, lineHeight: 1.35 }}>
          毎回の練習が、
          <br />
          コーチと一緒の練習に。
          <br />
          <span style={{ color: C.accent }}>最適なフォームへ、最短で。</span>
        </div>
      </div>
    </Bg>
  )
}

// 4. 整ったフォームは、タイムを縮める近道
export function STime({ items }: { items: Item[] }) {
  const f = useCurrentFrame()
  const [n18] = items
  const s = pop(f, n18.start)
  const sweep = interpolate(f, [n18.start, n18.start + 60], [0, 300], { ...clamp, easing: Easing.out(Easing.cubic) })
  const r = 220
  const a = (deg: number) => [540 + r * Math.sin((deg * Math.PI) / 180), 900 - r * Math.cos((deg * Math.PI) / 180)]
  const [ex, ey] = a(sweep)
  return (
    <Bg>
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={540} cy={900} r={r} fill="none" stroke={C.line} strokeWidth={18} />
        <path d={`M540 ${900 - r} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${ex} ${ey}`} fill="none" stroke={C.accent} strokeWidth={18} strokeLinecap="round" />
        <rect x={510} y={900 - r - 70} width={60} height={34} rx={8} fill={C.line} />
        <path d={`M540 900L${540 + 150 * Math.sin((sweep * Math.PI) / 180)} ${900 - 150 * Math.cos((sweep * Math.PI) / 180)}`} stroke={C.text} strokeWidth={10} strokeLinecap="round" />
        <circle cx={540} cy={900} r={16} fill={C.text} />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1240, textAlign: 'center', opacity: Math.min(1, s), transform: `translateY(${(1 - Math.min(1, s)) * 40}px)` }}>
        <div style={{ ...H2, fontSize: 80 }}>
          整ったフォームは、
          <br />
          <span style={{ color: C.accent }}>タイムを縮める近道。</span>
        </div>
      </div>
    </Bg>
  )
}

// 5. 締め：フォームを整えて、一緒にタイムを縮めよう
export function SEnd2({ items }: { items: Item[] }) {
  const f = useCurrentFrame()
  void items
  const a = pop(f, 4)
  const b = pop(f, 24)
  const out = interpolate(f, [100, 114], [1, 0], clamp)
  const logo = interpolate(f, [110, 130], [0, 1], clamp)
  return (
    <Bg>
      <div style={{ position: 'absolute', left: 80, right: 60, top: 640, opacity: out }}>
        <div style={{ fontWeight: 900, fontSize: 112, letterSpacing: -3, lineHeight: 1.25 }}>
          <div style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>フォームを整えて、</div>
          <div style={{ opacity: b, transform: `translateY(${(1 - b) * 40}px)`, color: C.accent }}>
            一緒に
            <br />
            タイムを縮めよう。
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 46, opacity: logo }}>
        <svg width={190} height={190} viewBox="0 0 28 28" fill="none" stroke={C.accent} strokeWidth={2}>
          <circle cx={14} cy={14} r={12} />
          <circle cx={14} cy={14} r={4.5} />
          <path d="M14 2v4M14 22v4" />
        </svg>
        <div style={{ fontFamily: num, fontWeight: 700, fontSize: 124, letterSpacing: 14 }}>RUN FORM COACH</div>
        <div style={{ fontSize: 52, fontWeight: 700 }}>置いて、立って、走るだけ。</div>
        <div style={{ fontFamily: num, fontSize: 40, color: C.muted, marginTop: 30 }}>run-form-coach.vercel.app</div>
        <div style={{ fontSize: 28, color: C.faint }}>※開発中の機能を含みます</div>
      </div>
    </Bg>
  )
}
