import { useEffect, useRef, useState } from 'react'
import type { Baseline, Frame, ItemKey, Measure, Sample } from '../core/types'
import { Coach, type CoachState } from '../core/coach'
import { measure, rotateFrame, sideOffDeg } from '../core/geometry'
import { MotionDetector, bodyVisible } from '../core/motion'
import { L } from '../core/landmarks'
import { overCue } from '../core/scoring'
import { gravityAvailable, gravityRoll } from '../core/gravity'
import { loadBaseline, loadSettings, saveBaseline, saveSession } from '../core/storage'
import { speak } from '../core/voice'
import { loadLandmarker, openCamera, runPose } from '../pose/detector'

type Phase = 'loading' | 'setup' | 'baseline' | 'run' | 'error'

interface Hud {
  phase: Phase
  state: CoachState
  caption: string
  elapsed: number
  quiet: boolean
  last?: Sample
  scores: number[]
  checks: { body: boolean; side: boolean; sideDeg: number; light: boolean }
  countdown?: number
  error?: string
}

const ITEM_TEXT: Record<ItemKey, string> = { head: '頭が前に出ています', trunk: '上体が倒れすぎています', body: '体が倒れすぎています', hip: '腰が落ちています' }

export function Live({ video: file, onDone }: { video?: File; onDone: (id?: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tapsRef = useRef<number[]>([])
  const coachRef = useRef<Coach | null>(null)
  const finishRef = useRef<() => void>(() => {})
  const screenMode = loadSettings().screen
  const [hud, setHud] = useState<Hud>({ phase: 'loading', state: 'waiting', caption: '', elapsed: 0, quiet: false, scores: [], checks: { body: false, side: false, sideDeg: 90, light: true } })

  useEffect(() => {
    let stopPose: { stop: () => void } | null = null
    let stream: MediaStream | null = null
    let wake: { release: () => Promise<void> } | null = null
    let objectUrl: string | null = null
    let disposed = false
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    let phase: Phase = 'loading'
    let baseline: Baseline | null = file ? null : loadBaseline()
    const motion = new MotionDetector()
    let okSince: number | null = null
    let lastGuide = 0
    let stillSince: number | null = null
    let baseNecks: number[] = []
    let provisional: number[] = []
    let lastHud = 0
    let caption = ''
    let captionAt = 0
    let finished = false
    let lastSample: Sample | undefined
    let lastLight = true
    let lastLightAt = 0

    const setPhase = (p: Phase) => {
      phase = p
      setHud((h) => ({ ...h, phase: p }))
    }
    const say = (text: string, t: number) => {
      speak(text)
      caption = text
      captionAt = t
    }

    const finish = async () => {
      if (finished) return
      finished = true
      const coach = coachRef.current
      if (coach && coach.samples.length >= 30) {
        const s = coach.finish()
        s.taps = tapsRef.current
        s.provisionalBaseline = !!file
        await saveSession(s)
        onDone(s.id)
      } else {
        onDone()
      }
    }
    finishRef.current = finish

    const brightness = () => {
      // 画面を小さく縮めて平均の明るさを見る
      const c = document.createElement('canvas')
      c.width = 32
      c.height = 18
      const x = c.getContext('2d')!
      x.drawImage(video, 0, 0, 32, 18)
      const d = x.getImageData(0, 0, 32, 18).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      return sum / (d.length / 4)
    }

    const guide = (frame: Frame | null, w: number, h: number, sideDeg: number, light: boolean): string | null => {
      if (!light) return '暗くて見えにくいです。明るい場所に置いてください。'
      if (!frame) return 'トレッドミルの真横に置いて、全身が入るようにしてください。'
      const ys = [L.nose, L.leftAnkle, L.rightAnkle].map((i) => frame[i].y)
      const xs = frame.filter((p) => p.v > 0.5).map((p) => p.x)
      const cx = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
      if (Math.min(...ys) < h * 0.04 || frame[L.nose].v < 0.5) return '頭が切れています。スマホを少し後ろに離してください。'
      if (Math.max(...ys) > h * 0.98 || frame[L.leftAnkle].v < 0.5 || frame[L.rightAnkle].v < 0.5) return '足元が切れています。スマホを少し後ろに離してください。'
      if (cx < w * 0.3) return 'もう少し、スマホを左へ。'
      if (cx > w * 0.7) return 'もう少し、スマホを右へ。'
      if (sideDeg > 15) return 'もう少し真横から撮れるように、置き方を回してください。'
      return null
    }

    const draw = (frame: Frame | null, w: number, h: number, hot: Set<string>) => {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.clearRect(0, 0, w, h)
      if (!frame) return
      const s = Math.max(2, w / 220)
      const line = (a: number, b: number, color: string, width = s * 2.2) => {
        if (frame[a].v < 0.3 || frame[b].v < 0.3) return
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(frame[a].x, frame[a].y)
        ctx.lineTo(frame[b].x, frame[b].y)
        ctx.stroke()
      }
      const lime = '#C8F03C'
      const warn = '#FF8A3D'
      for (const [a, b] of [
        [L.leftHip, L.leftKnee],
        [L.leftKnee, L.leftAnkle],
        [L.rightHip, L.rightKnee],
        [L.rightKnee, L.rightAnkle],
        [L.leftAnkle, L.leftFoot],
        [L.rightAnkle, L.rightFoot],
        [L.leftShoulder, L.leftElbow],
        [L.leftElbow, L.leftWrist],
        [L.rightShoulder, L.rightElbow],
        [L.rightElbow, L.rightWrist],
      ])
        line(a, b, lime)
      const trunkColor = hot.has('trunk') || hot.has('body') ? warn : lime
      line(L.leftHip, L.leftShoulder, trunkColor)
      line(L.rightHip, L.rightShoulder, trunkColor)
      const headColor = hot.has('head') ? warn : lime
      line(L.leftShoulder, L.leftEar, headColor)
      line(L.rightShoulder, L.rightEar, headColor)
      const ear = frame[L.leftEar].v > frame[L.rightEar].v ? frame[L.leftEar] : frame[L.rightEar]
      ctx.strokeStyle = headColor
      ctx.lineWidth = s * 2.2
      ctx.beginPath()
      ctx.arc((ear.x + frame[L.nose].x) / 2, (ear.y + frame[L.nose].y) / 2, Math.hypot(ear.x - frame[L.nose].x, ear.y - frame[L.nose].y) * 0.9, 0, Math.PI * 2)
      ctx.stroke()
    }

    const start = async () => {
      try {
        if ('wakeLock' in navigator) wake = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen').catch(() => null)
        const lm = await loadLandmarker('full')
        if (disposed) return
        if (file) {
          objectUrl = URL.createObjectURL(file)
          video.src = objectUrl
          video.muted = true
          video.playsInline = true
          await video.play()
          video.onended = () => finish()
        } else {
          stream = await openCamera(video)
        }
        if (disposed) return
        setPhase(file ? 'run' : 'setup')
        if (!file) say('トレッドミルの真横にスマホを置いてください。', 0)
        const clock = file ? () => video.currentTime : () => performance.now() / 1000
        stopPose = runPose(video, lm, (tick) => onTick(tick.frame, tick.t, tick.width, tick.height), clock)
      } catch (e) {
        setHud((h) => ({ ...h, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
      }
    }

    const onTick = (raw: Frame | null, t: number, w: number, h: number) => {
      const frame = raw && !file && gravityAvailable() ? rotateFrame(raw, gravityRoll(), w / 2, h / 2) : raw
      const visible = !!frame && bodyVisible(frame)
      const m: Measure | undefined = visible ? measure(frame!) : undefined
      const sideDeg = frame ? sideOffDeg(frame) : 90
      if (phase === 'setup' && t - lastLightAt > 1) {
        lastLight = brightness() > 40
        lastLightAt = t
      }

      // 置き方の案内
      if (phase === 'setup') {
        const problem = guide(visible ? frame : null, w, h, sideDeg, lastLight)
        if (problem) {
          okSince = null
          if (t - lastGuide > 5) {
            say(problem, t)
            lastGuide = t
          }
        } else {
          okSince ??= t
          if (t - okSince > 1.5) {
            say('見えています。全身が入りました。', t)
            if (baseline) {
              setPhase('run')
            } else {
              setPhase('baseline')
              stillSince = null
            }
          }
        }
      }

      // 直立の基準（初回だけ）
      if (phase === 'baseline' && m) {
        const moving = motion.update(frame!, t)
        if (moving) {
          stillSince = null
          baseNecks = []
        } else {
          if (stillSince === null) {
            stillSince = t
            say('上から吊られるように、まっすぐ立って、3秒止まってください。', t)
          }
          const el = t - stillSince
          if (el > 4) baseNecks.push(m.neck)
          const left = Math.ceil(7 - el)
          setHud((hh) => (hh.countdown === left ? hh : { ...hh, countdown: left }))
          if (el > 7 && baseNecks.length > 10) {
            const sorted = baseNecks.slice().sort((a, b) => a - b)
            baseline = { neck: sorted[Math.floor(sorted.length / 2)], createdAt: Date.now() }
            saveBaseline(baseline)
            say('基準を登録しました。走り出すと始まります。', t)
            setPhase('run')
          }
        }
      }

      // 走行中
      let hot = new Set<string>()
      if (phase === 'run') {
        const moving = frame && visible ? motion.update(frame, t) : false
        // 動画で試すときは、最初の10秒から仮の基準を作る
        if (!baseline && file) {
          if (m) provisional.push(m.neck)
          if (t > 10 && provisional.length > 30) {
            const sorted = provisional.slice().sort((a, b) => a - b)
            baseline = { neck: sorted[Math.floor(sorted.length * 0.25)], createdAt: Date.now() }
          }
        }
        if (baseline && !coachRef.current) coachRef.current = new Coach(baseline)
        const coach = coachRef.current
        if (coach) {
          const events = coach.update({ t, present: visible, moving, m, frame: visible ? frame! : undefined })
          for (const e of events) {
            if (e.type === 'speak') say(e.text, t)
            if (e.type === 'state' && e.state === 'ended') finish()
          }
          lastSample = coach.samples[coach.samples.length - 1]
          if (lastSample && !coach.quiet) {
            if (overCue('head', lastSample.head)) hot.add('head')
            if (overCue('trunk', lastSample.trunk)) hot.add('trunk')
            if (overCue('body', lastSample.body)) hot.add('body')
          }
        }
      }

      if (screenMode === 'show' || phase !== 'run') draw(frame, w, h, hot)
      else draw(null, w, h, hot)

      if (t - lastHud > 0.25) {
        lastHud = t
        const coach = coachRef.current
        setHud((hh) => ({
          ...hh,
          state: coach?.state ?? 'waiting',
          elapsed: coach?.active ?? 0,
          quiet: coach?.quiet ?? false,
          last: lastSample,
          scores: coach ? coach.samples.slice(-600).map((s) => s.score) : [],
          caption: t - captionAt < 6 ? caption : '',
          checks: { body: visible, side: sideDeg <= 15, sideDeg: Math.round(sideDeg), light: lastLight },
        }))
      }
    }

    start()
    return () => {
      disposed = true
      stopPose?.stop()
      stream?.getTracks().forEach((tr) => tr.stop())
      wake?.release().catch(() => {})
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      speechSynthesis.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dark = screenMode === 'dark' && hud.phase === 'run' && hud.state !== 'paused'
  const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const last = hud.last

  return (
    <div className="live">
      <video ref={videoRef} playsInline muted style={{ opacity: dark ? 0 : 1 }} />
      <canvas ref={canvasRef} style={{ opacity: dark ? 0 : 1 }} />

      {dark && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: 'var(--accent)' }} />
          <div style={{ fontFamily: 'var(--num)', fontSize: 15, letterSpacing: 4, color: 'var(--faint)' }}>COACHING</div>
          <div style={{ fontSize: 13, color: 'var(--faint)' }}>画面を消しても、声でお知らせします</div>
          <div className="num" style={{ position: 'absolute', right: 24, top: 20, fontSize: 28, color: '#4A525B' }}>{mmss(hud.elapsed)}</div>
        </div>
      )}

      {!dark && (
        <>
          <div style={{ position: 'absolute', left: 16, top: 'max(16px, env(safe-area-inset-top))', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="icon-btn" aria-label="終える" onClick={() => finishRef.current()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--accent)' }} />
            <div style={{ fontFamily: 'var(--num)', fontSize: 15, letterSpacing: 3 }} className="muted">
              {hud.phase === 'setup' ? 'SETUP' : hud.phase === 'baseline' ? 'BASELINE' : hud.state === 'paused' ? 'PAUSED' : hud.quiet ? 'QUIET CHECK' : 'COACHING'}
            </div>
          </div>

          {hud.phase === 'run' && (
            <div style={{ position: 'absolute', right: 16, top: 'max(16px, env(safe-area-inset-top))', textAlign: 'right' }}>
              <div className="num" style={{ fontSize: 56 }}>{mmss(hud.elapsed)}</div>
              <div style={{ fontSize: 13 }} className="muted">
                {hud.state === 'waiting' ? '走り出すと始まります' : hud.state === 'paused' ? '一時停止中' : hud.quiet ? '声なしで確認中' : ''}
              </div>
            </div>
          )}

          {hud.phase === 'run' && last && (
            <div style={{ position: 'absolute', left: 16, top: 80, display: 'flex', flexDirection: 'column', gap: 8, width: 140 }}>
              {(
                [
                  ['頭と背中', last.head, overCue('head', last.head)],
                  ['体幹の前傾', last.trunk, overCue('trunk', last.trunk)],
                  ['体全体の前傾', last.body, overCue('body', last.body)],
                ] as [string, number, boolean][]
              ).map(([label, v, bad]) => (
                <div key={label} style={{ background: 'rgba(10,12,14,0.78)', border: `1px solid ${bad ? 'var(--warn)' : 'var(--line)'}`, borderRadius: 12, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: '#C9CFD5' }}>{label}</div>
                  <div className="num" style={{ fontSize: 26, color: bad ? 'var(--warn)' : 'var(--text)' }}>
                    {label === '頭と背中' ? '+' : ''}
                    {v.toFixed(1)}°
                  </div>
                </div>
              ))}
            </div>
          )}

          {hud.phase === 'setup' && (
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 230, padding: 20, background: 'rgba(10,12,14,0.92)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13 }} className="muted">置き方チェック</div>
              <Check ok={hud.checks.body} label="全身が入っている" />
              <Check ok={hud.checks.side} label="真横から" sub={hud.checks.side ? undefined : `ずれ ${hud.checks.sideDeg}°`} />
              <Check ok={hud.checks.light} label="明るさ" />
              <div style={{ flexGrow: 1 }} />
              <div style={{ fontSize: 12 }} className="muted">スマホの傾き：{gravityAvailable() ? `${gravityRoll().toFixed(1)}° · 自動補正` : '補正なし'}</div>
            </div>
          )}

          {hud.phase === 'baseline' && (
            <div style={{ position: 'absolute', right: 40, top: '20%', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="num" style={{ fontSize: 160, color: 'var(--accent)' }}>{Math.max(1, Math.min(3, hud.countdown ?? 3))}</div>
              <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.35 }}>
                そのまま。
                <br />
                上から吊られるように。
              </div>
              <div style={{ fontSize: 13 }} className="muted">写真は残さず、骨格の角度だけを使います</div>
            </div>
          )}

          {hud.caption && (
            <div style={{ position: 'absolute', left: '50%', bottom: 90, transform: 'translateX(-50%)', maxWidth: '90%' }}>
              <div className="pill">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></svg>
                <div style={{ fontSize: 20, fontWeight: 900 }}>{hud.caption}</div>
              </div>
            </div>
          )}

          {hud.phase === 'run' && (
            <div style={{ position: 'absolute', left: 16, right: 16, bottom: 'max(16px, env(safe-area-inset-bottom))', display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <div style={{ flexGrow: 1, display: 'flex', alignItems: 'flex-end', gap: 14, padding: '10px 14px', borderRadius: 14, background: 'rgba(10,12,14,0.78)', border: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#C9CFD5' }}>姿勢スコア</div>
                  <div className="num" style={{ fontSize: 30, color: (last?.score ?? 100) < 80 ? 'var(--warn)' : 'var(--accent)' }}>{last ? last.score : '—'}</div>
                </div>
                <Spark values={hud.scores} />
                <div style={{ fontSize: 11 }} className="muted">直近10分</div>
              </div>
              <button
                onClick={() => tapsRef.current.push(Math.round(coachRef.current?.active ?? 0))}
                style={{ height: 48, padding: '0 20px', borderRadius: 24, border: '1.5px solid var(--text)', background: 'transparent', fontSize: 15, fontWeight: 700 }}
              >
                今悪い
              </button>
            </div>
          )}

          {last && hud.phase === 'run' && !hud.quiet && (['head', 'trunk', 'body', 'hip'] as ItemKey[]).some((k) => overCue(k, k === 'hip' ? last.hipDrop : last[k])) && (
            <div style={{ position: 'absolute', right: 16, top: 110 }}>
              <div style={{ padding: '8px 14px', borderRadius: 20, background: 'var(--warn)', color: '#0A0C0E', fontSize: 14, fontWeight: 900 }}>
                {ITEM_TEXT[(['head', 'trunk', 'body', 'hip'] as ItemKey[]).find((k) => overCue(k, k === 'hip' ? last.hipDrop : last[k]))!]}
              </div>
            </div>
          )}
        </>
      )}

      {hud.phase === 'loading' && <Center text="準備しています…" />}
      {hud.phase === 'error' && <Center text={`カメラを使えませんでした：${hud.error}`} action={() => onDone()} />}
    </div>
  )
}

function Check({ ok, label, sub }: { ok: boolean; label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 28, height: 28, borderRadius: 14, background: ok ? 'var(--accent)' : 'transparent', border: ok ? 0 : '2px solid var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {ok && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A0C0E" strokeWidth="3"><path d="M5 12l5 5 9-10" /></svg>}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--warn)' }}>{sub}</div>}
      </div>
    </div>
  )
}

function Spark({ values }: { values: number[] }) {
  const w = 220
  const h = 34
  if (values.length < 2) return <svg width={w} height={h} />
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / 100) * (h - 4)).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} aria-hidden="true">
      <polyline fill="none" stroke="#F2F4F5" strokeWidth="1.6" points={pts} />
      <path d={`M0 ${h - 1}H${w}`} stroke="#262C33" />
    </svg>
  )
}

function Center({ text, action }: { text: string; action?: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 16 }}>{text}</div>
      {action && (
        <button className="primary" style={{ maxWidth: 240 }} onClick={action}>
          戻る
        </button>
      )}
    </div>
  )
}
