import { useEffect, useRef, useState } from 'react'
import type { Screen } from '../../../App'
import { L } from '../landmarks'
import { LOG_POINTS } from '../log'
import { shareJson } from '../../../core/exportLog'
import { analyzeRun, type SlowReport, type TimedFrame } from '../slowmo'
import { loadLandmarker } from '../pose/detector'
import { scanVideo, seek, type Scan } from '../pose/videoScan'
import { REFERENCE } from '../ui/figure'

// スロー動画の分析：撮った動画を全部のコマで見て、接地のタイミングを測る
// 長さは脚の長さに対する割合で出る。cm は脚の長さを90cm とみなした目安
const LEG_CM = 90
const ideal = REFERENCE.ideal
const normal = REFERENCE.normal
// すねの傾き：足首が膝より前なら「前に」、後ろなら「後ろに」
const tilt = (deg: number) => (Math.round(deg) >= 0 ? `前に${Math.round(deg)}°` : `後ろに${Math.round(-deg)}°`)
const stanceMs = (pct: number) => (pct / 100) * (120 / REFERENCE.cadence) * 1000

type Phase = { name: 'loading' } | { name: 'scan'; done: number } | { name: 'result'; report: SlowReport; scan: Scan } | { name: 'error'; message: string; scan?: Scan }

export function Slow({ video: file, go }: { video: File; go: (x: Screen) => void }) {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const cancel = useRef(false)

  useEffect(() => {
    cancel.current = false
    let url = ''
    ;(async () => {
      try {
        const lm = await loadLandmarker()
        setPhase({ name: 'scan', done: 0 })
        let last = 0
        const scan = await scanVideo(
          file,
          lm,
          (done) => {
            // 画面の更新は2%ごと
            if (done - last >= 0.02) {
              last = done
              setPhase({ name: 'scan', done })
            }
          },
          () => cancel.current,
        )
        url = scan.video.src
        if (cancel.current) return
        ;(window as unknown as { __rfcScan?: TimedFrame[] }).__rfcScan = scan.frames // 調べるとき用
        const report = analyzeRun(scan.frames)
        if (!report) {
          setPhase({ name: 'error', message: '接地を2回以上見つけられませんでした。真横から、足元まで入るように撮った動画で試してください。', scan })
          return
        }
        setPhase({ name: 'result', report, scan })
      } catch (e) {
        setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      cancel.current = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  return (
    <main className="page">
      <div className="row">
        <button className="icon-btn" aria-label="ホームへ" onClick={() => go({ name: 'home' })}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <div style={{ fontFamily: 'var(--num)', letterSpacing: 3, fontSize: 15 }} className="muted">
          SLOW MOTION
        </div>
        <div style={{ width: 44 }} />
      </div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>スロー動画の分析</h1>

      {phase.name === 'loading' && <p className="muted">骨格のモデルを読み込んでいます…</p>}
      {phase.name === 'scan' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>1コマずつ骨格を取っています… {Math.round(phase.done * 100)}%</div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${phase.done * 100}%`, height: 8, background: 'var(--accent)' }} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            スロー動画はコマが多いので、10秒の動画で1〜2分かかります。
          </div>
        </div>
      )}
      {phase.name === 'error' && (
        <>
          <div className="card" style={{ color: 'var(--warn)', lineHeight: 1.7 }}>
            {phase.message}
          </div>
          {phase.scan && (
            <button onClick={() => exportScan(phase.scan!, null)} style={LINK}>
              骨格の記録を書き出す（うまくいかなかった原因を調べるため。映像なし）
            </button>
          )}
        </>
      )}
      {phase.name === 'result' && <Report report={phase.report} scan={phase.scan} />}

      <div style={{ flexGrow: 1 }} />
      <button className="primary" onClick={() => go({ name: 'home' })}>
        ホームへ
      </button>
    </main>
  )
}

const LINK = { background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12, alignSelf: 'flex-start' } as const

// 分析に使った骨格の数字（映像なし）を書き出す
function exportScan(scan: Scan, report: SlowReport | null) {
  const name = `rfc-slow-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`
  const r1 = (x: number) => Math.round(x * 10) / 10
  shareJson(name, {
    report,
    step: scan.step,
    width: scan.width,
    height: scan.height,
    points: LOG_POINTS,
    frames: scan.frames.map(({ t, f }) => [Math.round(t * 10000) / 10000, ...LOG_POINTS.flatMap((i) => [r1(f[i].x), r1(f[i].y), Math.round(f[i].v * 100) / 100])]),
  })
}

type Tone = 'good' | 'mid' | 'bad'
const TONE: Record<Tone, string> = { good: 'var(--accent)', mid: '#C9CFD5', bad: 'var(--warn)' }

function Report({ report: r, scan }: { report: SlowReport; scan: Scan }) {
  const n = r.contacts.length
  const confidence = n >= 6 ? '高' : n >= 3 ? '中' : '低'
  const rows: { label: string; value: string; ref: string; tone: Tone }[] = [
    {
      label: 'ピッチ',
      value: `毎分${Math.round(r.cadence)}歩`,
      ref: `見本 ${REFERENCE.cadence}歩`,
      tone: r.cadence >= 165 ? 'good' : r.cadence >= 150 ? 'mid' : 'bad',
    },
    r.contactMs === null
      ? { label: '接地時間（1歩）', value: '測れませんでした', ref: '動画では、両足が浮いた瞬間が見分けられませんでした', tone: 'mid' as Tone }
      : {
          label: '接地時間（1歩）',
          value: `${(r.contactMs / 1000).toFixed(2)}秒`,
          ref: `見本 ${(stanceMs(ideal.stancePct) / 1000).toFixed(2)}秒 ／ データ全体 ${(stanceMs(normal.stancePct) / 1000).toFixed(2)}秒`,
          tone: (r.contactMs <= stanceMs(normal.stancePct) + 15 ? 'good' : r.contactMs <= 300 ? 'mid' : 'bad') as Tone,
        },
    ...(r.flightMs === null
      ? []
      : [
          {
            label: '両足が浮いている時間（1歩）',
            value: `${(r.flightMs / 1000).toFixed(2)}秒`,
            ref: '走りなら必ずある',
            tone: (r.flightMs >= 60 ? 'good' : r.flightMs >= 30 ? 'mid' : 'bad') as Tone,
          },
        ]),
    {
      label: '着地のすね',
      value: tilt(r.shankAtContact),
      ref: `見本 前に${Math.round(ideal.shankAtContact[0])}° ／ データ全体 前に${Math.round(normal.shankAtContact[0])}°`,
      tone: r.shankAtContact <= ideal.shankAtContact[0] + 2 ? 'good' : r.shankAtContact < 15 ? 'mid' : 'bad',
    },
    {
      label: '着地の位置（腰より前）',
      value: `約${Math.round(r.footAheadAtContact * LEG_CM)}cm`,
      ref: `脚の長さの${Math.round(r.footAheadAtContact * 100)}%`,
      tone: 'mid',
    },
    {
      label: '上下動',
      value: `約${(r.verticalLeg * LEG_CM).toFixed(1)}cm`,
      ref: '市民ランナーの実測 7.7 ± 1.2cm',
      tone: r.verticalLeg * LEG_CM <= 9 ? 'good' : r.verticalLeg * LEG_CM <= 10.5 ? 'mid' : 'bad',
    },
    {
      label: '上体の前傾',
      value: `${Math.round(r.trunk)}°`,
      ref: '見本 7°',
      tone: Math.abs(r.trunk - 7) <= 5 ? 'good' : 'mid',
    },
  ]

  const exportData = () => exportScan(scan, r)

  return (
    <>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
        {r.slow > 1 ? `${r.slow}倍のスロー動画として読みました（実際の時間で毎秒約${Math.round(r.framesPerSec)}コマ）。` : `実際の速さの動画として読みました（毎秒約${Math.round(r.framesPerSec)}コマ）。`}
        接地を{n}回見つけました（確信度：{confidence}）。
      </div>
      <Landing report={r} scan={scan} />
      <div className="card" style={{ padding: '4px 16px' }}>
        {rows.map((x) => (
          <div key={x.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: 14 }}>{x.label}</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: TONE[x.tone] }}>{x.value}</div>
              <div style={{ fontSize: 11, color: 'var(--faint)' }}>{x.ref}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>
        スマホ1台・真横からの2Dの測定です。手前の脚だけで数え、左右は同じとみなしています。cm は脚の長さを約90cmとした目安です。見本との比べ方は
        <a href="/theory/">フォームの見方</a>にあります。
      </p>
      <button onClick={exportData} style={LINK}>
        分析の記録を書き出す（骨格の数字だけ・映像なし）
      </button>
    </>
  )
}

// 着地の瞬間のコマに、手前の脚と、腰の真下の線、すねの角度を描く
function Landing({ report: r, scan }: { report: SlowReport; scan: Scan }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = r.contacts.slice().sort((a, b) => a.shank - b.shank)[Math.floor(r.contacts.length / 2)]
    const vt = c.start * r.slow
    const hit = scan.frames.reduce((a, b) => (Math.abs(b.t - vt) < Math.abs(a.t - vt) ? b : a))
    let gone = false
    ;(async () => {
      await seek(scan.video, hit.t)
      const canvas = ref.current
      if (gone || !canvas) return
      draw(canvas, scan.video, hit, c.shank)
    })()
    return () => {
      gone = true
    }
  }, [r, scan])
  return (
    <div className="stage" style={{ display: 'flex', flexDirection: 'column' }}>
      <canvas ref={ref} style={{ width: '100%', height: 'auto', display: 'block' }} />
      <div style={{ position: 'absolute', left: 10, top: 8, fontSize: 12, color: '#fff', textShadow: '0 1px 2px #000' }}>着地の瞬間</div>
    </div>
  )
}

function draw(canvas: HTMLCanvasElement, video: HTMLVideoElement, { f }: TimedFrame, shank: number) {
  // 体のまわりを切り抜く
  const xs = f.map((p) => p.x)
  const ys = f.map((p) => p.y)
  const pad = 0.25 * (Math.max(...ys) - Math.min(...ys))
  const x0 = Math.max(0, Math.min(...xs) - pad)
  const y0 = Math.max(0, Math.min(...ys) - pad)
  const x1 = Math.min(video.videoWidth, Math.max(...xs) + pad)
  const y1 = Math.min(video.videoHeight, Math.max(...ys) + pad / 2)
  const W = 640
  const k = W / (x1 - x0)
  canvas.width = W
  canvas.height = Math.round((y1 - y0) * k)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height)
  const P = (i: number) => [(f[i].x - x0) * k, (f[i].y - y0) * k] as const
  const near = f[L.leftKnee].v + f[L.leftAnkle].v >= f[L.rightKnee].v + f[L.rightAnkle].v
  const [hip, knee, ankle, heel, toe] = near
    ? [L.leftHip, L.leftKnee, L.leftAnkle, L.leftHeel, L.leftFoot]
    : [L.rightHip, L.rightKnee, L.rightAnkle, L.rightHeel, L.rightFoot]
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // 腰の真下の線
  const [hx, hy] = P(hip)
  ctx.setLineDash([8, 8])
  ctx.strokeStyle = '#C8F03C'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.lineTo(hx, canvas.height)
  ctx.stroke()
  ctx.setLineDash([])
  // 手前の脚
  ctx.strokeStyle = '#FF8A3D'
  ctx.lineWidth = 6
  ctx.beginPath()
  for (const [j, i] of [hip, knee, ankle, heel, toe].entries()) {
    const [x, y] = P(i)
    if (j === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  const [kx, ky] = P(knee)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(`すね ${tilt(shank)}`, kx + 14, ky)
}

