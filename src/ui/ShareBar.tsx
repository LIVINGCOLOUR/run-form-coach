import type { Category } from '../core/types'

export function ShareBar({ share, height = 10, labels = true }: { share: Record<Category, number>; height?: number; labels?: boolean }) {
  const pct = (v: number) => Math.round(v * 100)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="share-bar" style={{ height, borderRadius: height / 2 }}>
        <div style={{ width: `${pct(share.good)}%`, background: 'var(--accent)' }} />
        <div style={{ width: `${pct(share.mid)}%`, background: 'var(--muted)' }} />
        <div style={{ width: `${pct(share.bad)}%`, background: 'var(--warn)' }} />
      </div>
      {labels && (
        <div style={{ display: 'flex', gap: 14, fontSize: 12 }} className="muted">
          <span>良い {pct(share.good)}%</span>
          <span>ふつう {pct(share.mid)}%</span>
          <span>悪い {pct(share.bad)}%</span>
        </div>
      )}
    </div>
  )
}
