import { useEffect, useRef, useState } from 'react'
import type { CoachState } from '../../../core/engine'
import { RUNNING } from '../../../core/params'
import { PHRASES } from '../../../core/phrases'
import { loadSettings } from '../../../core/storage'
import { preloadVoice, speak, stopVoice } from '../../../core/voice'
import type { MountIssue } from '../mount'
import { keepAwake, listenMotion, toMeasure, type MotionLike } from '../sensor'
import { PhoneRun } from '../session'
import { demoRun } from '../simulate'
import { savePhoneLog, savePhoneSession } from '../storage'

// スマホ版の走る画面（ウェブ）。スマホを腰のベルトに付けて走る。画面はつけたまま使う（消えないようにしておく）
// 声は共通のしくみ（engine.ts）が決め、言葉と音声は phrases.ts のものを使う
// sim：模擬データをセンサーの代わりに流し込む速さ（倍）。ブラウザで画面と記録を試すため

interface Hud {
  state: CoachState
  elapsed: number
  quiet: boolean
  caption: string
  cadence: number | null // 直近の1秒のピッチ
  refCadence: number | null
  bounceCm: number | null
  brakingMs: number | null
  cadences: (number | null)[]
  mount: MountIssue | null
  hz: number // 1秒に届いたセンサーの値の数
  gyro: boolean
  wake: boolean
  noData: boolean // 値がしばらく届いていない
}

const MOUNT_TEXT: Record<MountIssue, string> = {
  notWaist: '腰以外に付いているようです。この走りは判定を止めています',
  loose: 'スマホがゆるいようです。この走りは判定を止めています',
  shifted: '途中でスマホがずれたようです。この走りは判定を止めています',
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const DEG = 180 / Math.PI

export function PhoneLive({ sim, onDone }: { sim?: number; onDone: (id?: string) => void }) {
  const finishRef = useRef<() => void>(() => {})
  const [hud, setHud] = useState<Hud>({
    state: 'waiting', elapsed: 0, quiet: false, caption: '', cadence: null, refCadence: null, bounceCm: null, brakingMs: null, cadences: [], mount: null, hz: 0, gyro: false, wake: false, noData: false,
  })

  useEffect(() => {
    let disposed = false
    let finished = false
    const perf0 = performance.now()
    const run = new PhoneRun({ perfMs: perf0, epochMs: Date.now() }, { userAgent: navigator.userAgent, intervalMs: null, sim })
    let caption = ''
    let captionAt = -1e9
    let lastWait = perf0 / 1000
    let arrivals: number[] = [] // 値が届いた時刻（直近1秒）
    let wake = false

    const now = () => (sim ? perf0 / 1000 + ((performance.now() - perf0) / 1000) * sim : performance.now() / 1000)
    const say = (text: string, t: number, log = false) => {
      if (log) run.said(t, text)
      speak(text)
      caption = text
      captionAt = t
    }

    const finish = async () => {
      if (finished) return
      finished = true
      const { session, log } = run.finish()
      if (session) await savePhoneSession(session).catch(() => {})
      // 走りが始まらなかったときこそ調整に使うので、記録は残す
      await savePhoneLog(log).catch(() => {})
      onDone(session?.id)
    }
    finishRef.current = finish

    const handle = (ev: ReturnType<PhoneRun['feed']>, t: number) => {
      for (const e of ev) {
        if (e.type === 'speak') say(e.text, t)
        if (e.type === 'state' && e.state === 'ended') finish()
      }
    }

    const onMotion = (e: MotionLike, t: number, interval: number | null) => {
      if (disposed || finished) return
      const m = toMeasure(e, t)
      if (!m) return
      if (interval !== null && run.log.device.intervalMs === null) run.log.device.intervalMs = interval
      arrivals.push(t)
      handle(run.feed(m), t)
    }

    // センサーの値（模擬データのときは、時刻に合わせて流し込む）
    let stopMotion = () => {}
    let simTimer: ReturnType<typeof setInterval> | null = null
    if (sim) {
      const data = demoRun()
      let i = 0
      const base = perf0 / 1000
      simTimer = setInterval(() => {
        const until = now()
        while (i < data.length && base + data[i].t <= until) {
          const d = data[i++]
          // センサーと同じ形（角速度は deg/s）にしてから、同じ道を通す
          const e: MotionLike = {
            accelerationIncludingGravity: { x: d.ax, y: d.ay, z: d.az },
            rotationRate: d.gx === undefined ? null : { alpha: d.gz! * DEG, beta: d.gx * DEG, gamma: d.gy! * DEG },
          }
          onMotion(e, base + d.t, 1000 / 60)
        }
      }, 50)
    } else {
      stopMotion = listenMotion((e, interval) => onMotion(e, performance.now() / 1000, interval))
    }

    const stopAwake = keepAwake((held) => {
      wake = held
    })
    preloadVoice(loadSettings().voice).catch(() => {})

    // 値が途切れたことに気づくためのタイマーと、画面の更新
    const timer = setInterval(() => {
      if (disposed || finished) return
      const t = now()
      handle(run.tick(t), t)
      const coach = run.coach
      // 走り出すのを待っている間は、黙ったままにしない（値が届いているときだけ）
      if (coach.state === 'waiting' && run.analyzer.connected(t) && t - lastWait > RUNNING.waitRepeat) {
        lastWait = t
        say(PHRASES.waitRun, t, true)
      }
      arrivals = arrivals.filter((x) => t - x <= 1)
      const ss = coach.samples
      const last = ss[ss.length - 1]
      setHud({
        state: coach.state,
        elapsed: coach.active,
        quiet: coach.quiet,
        caption: t - captionAt < 6 ? caption : '',
        cadence: last?.cadence ?? (run.analyzer.moving ? run.analyzer.last?.cadence ?? null : null),
        refCadence: run.analyzer.ref?.cadence ?? null,
        bounceCm: last?.bounceCm ?? null,
        brakingMs: last?.brakingMs ?? null,
        cadences: ss.slice(-600).map((s) => s.cadence),
        mount: run.analyzer.mount.issue,
        hz: arrivals.length, // 模擬データのときは、模擬の時刻の1秒あたり
        gyro: run.log.device.gyro,
        wake,
        noData: t - perf0 / 1000 > 3 && !run.analyzer.connected(t),
      })
    }, 250)

    return () => {
      disposed = true
      stopMotion()
      if (simTimer) clearInterval(simTimer)
      clearInterval(timer)
      stopAwake()
      // 終わりの言葉（おつかれさまでした）は最後まで言わせる
      if (!finished) {
        stopVoice()
        savePhoneLog(run.finish().log).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const label = hud.state === 'paused' ? 'PAUSED' : hud.state === 'waiting' ? 'READY' : hud.quiet ? 'QUIET CHECK' : 'COACHING'
  const note =
    hud.state === 'waiting' ? '腰のベルトにスマホを付けて、走り出すと始まります' : hud.state === 'paused' ? '一時停止中。走り出すと再開します' : hud.quiet ? '声なしで確認中' : hud.refCadence === null ? '走り始めの基準を作っています（3分）' : ''

  return (
    <main className="page" style={{ gap: 14 }}>
      <div className="row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-btn" aria-label="終える" onClick={() => finishRef.current()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: hud.state === 'running' ? 'var(--accent)' : 'var(--faint)' }} />
          <div style={{ fontFamily: 'var(--num)', fontSize: 15, letterSpacing: 3 }} className="muted">
            {label}
          </div>
        </div>
        <div className="num" style={{ fontSize: 44 }}>{mmss(hud.elapsed)}</div>
      </div>

      {sim && <div style={{ fontSize: 12, color: 'var(--warn)' }}>模擬データで試しています（{sim}倍の速さ）</div>}
      {note && <div style={{ fontSize: 14 }} className="muted">{note}</div>}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <div style={{ fontSize: 13 }} className="muted">ピッチ</div>
          <div style={{ fontSize: 12 }} className="muted">{hud.refCadence !== null ? `基準 ${Math.round(hud.refCadence)} 歩/分` : '基準はまだ'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div className="num" style={{ fontSize: 96, lineHeight: 0.85, color: 'var(--accent)' }}>{hud.cadence !== null ? Math.round(hud.cadence) : '—'}</div>
          <div style={{ fontSize: 14, paddingBottom: 4 }} className="muted">歩/分</div>
        </div>
        <Spark values={hud.cadences} ref_={hud.refCadence} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Small label="上下動" value={hud.bounceCm !== null ? hud.bounceCm.toFixed(1) : '—'} unit="cm" />
        <Small label="着地のブレーキ" value={hud.brakingMs !== null ? hud.brakingMs.toFixed(2) : '—'} unit="m/s" />
      </div>

      {hud.mount && <div style={{ padding: '10px 14px', borderRadius: 14, background: 'var(--warn)', color: '#0A0C0E', fontSize: 14, fontWeight: 900, lineHeight: 1.5 }}>{MOUNT_TEXT[hud.mount]}</div>}
      {hud.noData && (
        <div style={{ padding: '10px 14px', borderRadius: 14, border: '1px solid var(--warn)', color: 'var(--warn)', fontSize: 13, lineHeight: 1.6 }}>
          動きのセンサーの値が届いていません。許可しなかったときは、Safari をいったん閉じて開き直し、もう一度「スマホ版をはじめる」を押してください。
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip ok={hud.hz >= 30} label={`センサー ${hud.hz}回/秒`} />
        <Chip ok={hud.gyro} label={hud.gyro ? 'ジャイロ あり' : 'ジャイロ なし'} />
        <Chip ok={hud.wake} label={hud.wake ? '画面は消えません' : '画面が消えるかも'} />
      </div>
      {!hud.wake && <div style={{ fontSize: 12 }} className="muted">画面が消えると測れません。設定の「画面表示と明るさ」→「自動ロック」を「なし」にしてください。</div>}

      <div style={{ flexGrow: 1 }} />

      {hud.caption && (
        <div className="pill" style={{ alignSelf: 'center', maxWidth: '100%' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></svg>
          <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.4 }}>{hud.caption}</div>
        </div>
      )}

      <button className="primary" onClick={() => finishRef.current()}>
        終える
      </button>
    </main>
  )
}

function Small({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 12 }} className="muted">{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
        <span className="num" style={{ fontSize: 34 }}>{value}</span>
        <span style={{ fontSize: 12, paddingBottom: 3 }} className="muted">{unit}</span>
      </div>
    </div>
  )
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 16, background: ok ? 'rgba(200,240,60,0.16)' : 'rgba(255,138,61,0.16)', border: `1px solid ${ok ? 'var(--accent)' : 'var(--warn)'}`, fontSize: 13, fontWeight: 700, color: ok ? 'var(--accent)' : 'var(--warn)' }}>
      {ok ? '✓' : '・'} {label}
    </div>
  )
}

// 直近10分のピッチ。点線が基準
function Spark({ values, ref_ }: { values: (number | null)[]; ref_: number | null }) {
  const W = 320
  const H = 48
  const xs = values.filter((v): v is number => v !== null)
  if (xs.length < 2) return <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} />
  const lo = Math.min(...xs, ref_ ?? Infinity) - 4
  const hi = Math.max(...xs, ref_ ?? -Infinity) + 4
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4)
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W
  let d = ''
  values.forEach((v, i) => {
    if (v === null) return
    d += `${d && values[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
  })
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="直近10分のピッチ">
      {ref_ !== null && <path d={`M0 ${y(ref_)}H${W}`} stroke="var(--faint)" strokeDasharray="4 4" />}
      <path d={d} fill="none" stroke="#F2F4F5" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
