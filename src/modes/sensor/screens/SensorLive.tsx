import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { loadProgress, loadSettings } from '../../../core/storage'
import { preloadVoice, speak, stopVoice, voicePending } from '../../../core/voice'
import { PHRASES } from '../../../core/phrases'
import { keepAwake } from '../../../core/wake'
import { queueUpload } from '../../../core/upload/uploads'
import { sensors } from '../ble'
import { SensorRunner, type SensorRunPhase } from '../runner'
import { SensorRunLog } from '../runLog'
import { SENSOR_RUN_NAME } from '../name'

// センサーラン：カメラなし・腰にスマホなしで、体に付けたセンサーだけで外を走る（スマホはポケットかアームバンド。画面は見ない）。
// 知らせは振動だけ（胸の猫背・頭が前に出る・接地が長い・左右差。ずれは短く3回）。声は、立つ・待つの案内と、終わりの言葉だけ。
// 立った姿勢と走っているかは、センサーで決める（runner.ts）。記録は 60秒ごとに端末へ書き出す（runLog.ts。7時間まで）

const PHASE_TEXT: Record<SensorRunPhase, { label: string; text: string }> = {
  stand: { label: 'STAND 1/2', text: 'いつもの楽な立ち方で、3秒止まってください' },
  ready: { label: 'READY', text: '走り出すと始まります' },
  run: { label: 'RUNNING', text: '見ています。崩れたら、その場所が震えます' },
  stop: { label: 'STOPPED', text: '止まっています。走り出すと続きます' },
}
const HOLD_MS = 1500 // 終えるボタンは長押し（ポケットの中で触れて終わらないように）

const mmss = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
}

export function SensorLive({ onDone }: { onDone: (logId?: string) => void }) {
  const [phase, setPhase] = useState<SensorRunPhase>('stand')
  const [stage, setStage] = useState<'a' | 'b'>('a') // 2つの立ち方のどちらを測っているか
  const [runSec, setRunSec] = useState(0)
  const [wake, setWake] = useState(false)
  const [holding, setHolding] = useState(false)
  const finishRef = useRef<() => void>(() => {})
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodes = useSyncExternalStore(sensors.subscribe, sensors.snapshot)

  useEffect(() => {
    let finished = false
    const clock = { perfMs: performance.now(), epochMs: Date.now() }
    const rec = new SensorRunLog(clock)
    const runner = new SensorRunner({
      onEvent: rec.event,
      level: loadProgress().level,
      say: (text) => speak(text),
      speaking: voicePending,
      onChange: () => {
        setPhase(runner.phase)
        setStage(runner.stage)
      },
    })
    setPhase(runner.phase)
    rec.event(clock.perfMs / 1000, 'phase:sensorRun')
    rec.start(runner)
    void preloadVoice(loadSettings().voice)
    const stopAwake = keepAwake(setWake)
    const ui = setInterval(() => setRunSec(runner.runSec), 1000)

    const finish = async () => {
      if (finished) return
      finished = true
      clearInterval(ui)
      speak(PHRASES.end)
      await rec.finish()
      queueUpload('sensor', rec.log.id, rec.log.startedAt)
      onDone(rec.log.id)
    }
    finishRef.current = finish
    return () => {
      clearInterval(ui)
      stopAwake()
      if (!finished) {
        stopVoice()
        void rec.finish()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const on = nodes.filter((n) => n.status === 'connected')
  const lost = nodes.filter((n) => n.name && n.status === 'lost')
  const p = phase === 'stand' && stage === 'b' ? { label: 'STAND 2/2', text: '胸を開いて、肩を後ろに引いて、顎を軽く引いて、3秒止まってください' } : PHASE_TEXT[phase]
  const startHold = () => {
    setHolding(true)
    holdTimer.current = setTimeout(() => finishRef.current(), HOLD_MS)
  }
  const endHold = () => {
    setHolding(false)
    if (holdTimer.current) clearTimeout(holdTimer.current)
  }

  return (
    <main className="page" style={{ gap: 14 }}>
      <div className="row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: phase === 'run' ? 'var(--accent)' : 'var(--faint)' }} />
          <div style={{ fontFamily: 'var(--num)', fontSize: 15, letterSpacing: 3 }} className="muted">
            {p.label}
          </div>
        </div>
        <div className="num" style={{ fontSize: 44 }}>{mmss(runSec)}</div>
      </div>
      <div style={{ fontSize: 13 }} className="muted">{SENSOR_RUN_NAME}（走っていた時間）</div>

      <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.5 }}>{p.text}</div>
      {phase === 'stand' && (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
          2つの立ち方を3秒ずつ測ります（案内の声が終わってから）。1つ目はいつもの楽な立ち方、2つ目は胸を開いた立ち方です。
          センサーは付けるたびに角度が変わるので、決まった線ではなく、この2つの違いを今日の猫背の物差しにします。
          2つ目のほうへ近いほど良い姿勢として見ます（違いが小さいと、もう一度お願いします）。
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip ok={on.length > 0} label={`センサー ${on.length}個`} />
        {lost.length > 0 && <Chip ok={false} label={`切れた：${lost.map((n) => n.place).join('・')}（つなぎ直しています）`} />}
        <Chip ok={wake} label={wake ? '画面は消えません' : '画面が消えるかも'} />
      </div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
        画面を消さないでください（消えると、センサーの値の受け取りや振動が止まるおそれがあります）。
        {wake ? '画面の明るさを下げておくと、電池が長くもちます。' : '設定の「画面表示と明るさ」→「自動ロック」を「なし」にし、明るさを下げてください。'}
        ポケットに入れるときは、画面を体の側に向けてください。
      </div>

      <div style={{ flexGrow: 1 }} />

      <button
        className="primary"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => e.preventDefault()}
        style={{ opacity: holding ? 0.6 : 1, userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
      >
        {holding ? 'そのまま押し続けると終わります' : '長押しで終える'}
      </button>
    </main>
  )
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 16, background: ok ? 'rgba(200,240,60,0.16)' : 'rgba(255,138,61,0.16)', border: `1px solid ${ok ? 'var(--accent)' : 'var(--warn)'}`, fontSize: 13, fontWeight: 700, color: ok ? 'var(--accent)' : 'var(--warn)' }}>
      {ok ? '✓' : '・'} {label}
    </div>
  )
}
