import { useState } from 'react'
import { MOUNTS } from './params'
import { mountLabel, type Mount } from './mount'

// 頭と胸のセンサーを付ける場所を選ぶ（ホームの「センサー」の枠。SensorPanel.tsx）。横から見た人型の絵（右が前）の点でも、横の文字でも選べる。
// 選んだ点は緑、ほかは灰色。判定の数字は場所で変えない（params.ts の MOUNTS）

type Point = { key: string; x: number; y: number; on: boolean; label: string; pick?: () => void }

// 横から見た人型（viewBox 0 0 100 200、右が前）。points の点を上に描く。点に pick があれば押せる
export function MountFigure({ width, points }: { width: number; points: Point[] }) {
  const body = { fill: 'none', stroke: 'var(--faint)', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="0 0 100 200" width={width} height={width * 2} role="img" aria-label="横から見た人の絵" style={{ flexShrink: 0, display: 'block' }}>
      <circle cx={50} cy={22} r={12} {...body} />
      {/* 鼻の向きで前を示す */}
      <path d="M62,23 L65,26 L62,27" {...body} strokeWidth={2} />
      <path d="M49,34 L49,41" {...body} />
      <path d="M44,42 Q58,40 60,52 L60,86 Q58,100 50,102 Q42,100 41,86 L40,52 Q40,44 44,42 Z" {...body} />
      <path d="M50,48 Q46,70 50,92 L54,96" {...body} />
      <path d="M48,102 L46,148 L44,190 L56,191" {...body} />
      <path d="M53,102 L56,148 L54,188" {...body} />
      {points.map((p) => (
        <g key={p.key} onClick={p.pick} style={{ cursor: p.pick ? 'pointer' : undefined }}>
          {p.pick && <circle cx={p.x} cy={p.y} r={11} fill="transparent" />}
          <circle cx={p.x} cy={p.y} r={p.on ? 5 : 4} fill={p.on ? 'var(--accent)' : 'var(--faint)'} stroke="var(--bg)" strokeWidth={1.5}>
            <title>{p.label}</title>
          </circle>
        </g>
      ))}
    </svg>
  )
}

export function MountPicker({ initial, onDone }: { initial: Mount; onDone: (m: Mount) => void }) {
  const [m, setM] = useState<Mount>(initial)
  const points: Point[] = [
    ...MOUNTS.head.map((p) => ({ key: `h-${p.id}`, x: p.x, y: p.y, on: m.head === p.id, label: p.label, pick: () => setM((v) => ({ ...v, head: p.id })) })),
    ...MOUNTS.chest.map((p) => ({ key: `c-${p.id}`, x: p.x, y: p.y, on: m.chest === p.id, label: p.label, pick: () => setM((v) => ({ ...v, chest: p.id })) })),
  ]
  const option = (on: boolean) =>
    ({ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', borderRadius: 10, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: 'transparent', color: on ? 'var(--text)' : 'var(--muted)', fontSize: 13, textAlign: 'left' }) as const
  const dot = (on: boolean) => <span style={{ width: 10, height: 10, borderRadius: 5, flexShrink: 0, background: on ? 'var(--accent)' : 'var(--faint)' }} />
  const group = (title: string, items: readonly { id: string; label: string; note: string }[], sel: string, pick: (id: string) => void) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{title}</div>
      {items.map((p) => (
        <button key={p.id} onClick={() => pick(p.id)} style={option(sel === p.id)} aria-pressed={sel === p.id}>
          {dot(sel === p.id)}
          <span style={{ minWidth: 0 }}>
            {p.label}
            {p.note && <span className="muted" style={{ fontSize: 11 }}>（{p.note}）</span>}
          </span>
        </button>
      ))}
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, borderRadius: 12, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>付ける場所</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        頭と胸のセンサーを付ける場所を選んでください。毎回同じ場所に付けると、走りどうしを比べやすくなります。
        見方はどの場所でも同じです（いまの線は、{mountLabel('head', 'forehead')}と{mountLabel('chest', 'sternum')}で付けた記録から決めました）。
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <MountFigure width={104} points={points} />
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {group('頭', MOUNTS.head, m.head, (id) => setM((v) => ({ ...v, head: id as Mount['head'] })))}
          {group('胸', MOUNTS.chest, m.chest, (id) => setM((v) => ({ ...v, chest: id as Mount['chest'] })))}
        </div>
      </div>
      <button onClick={() => onDone(m)} style={{ height: 40, borderRadius: 20, border: '1px solid var(--text)', background: 'transparent', color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>
        決める
      </button>
    </div>
  )
}

// センサーランの2つの立ち方の案内の端に出す、小さな絵と文字（つながっている頭・胸だけ）
export function MountBadge({ mount, head, chest }: { mount: Mount; head: boolean; chest: boolean }) {
  if (!head && !chest) return null
  const points: Point[] = []
  const words: string[] = []
  if (head) {
    const p = MOUNTS.head.find((x) => x.id === mount.head)!
    points.push({ key: 'h', x: p.x, y: p.y, on: true, label: p.label })
    words.push(`頭：${p.label}`)
  }
  if (chest) {
    const p = MOUNTS.chest.find((x) => x.id === mount.chest)!
    points.push({ key: 'c', x: p.x, y: p.y, on: true, label: p.label })
    words.push(`胸：${p.label}`)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end' }} className="muted">
      <span style={{ fontSize: 12 }}>{words.join('、')}</span>
      <MountFigure width={22} points={points} />
    </div>
  )
}
