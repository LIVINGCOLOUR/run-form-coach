import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { loadProgress, loadSettings } from '../../../core/storage'
import { preloadVoice, speak, stopVoice, voicePending } from '../../../core/voice'
import { PHRASES } from '../../../core/phrases'
import { keepAwake } from '../../../core/wake'
import { queueUpload } from '../../../core/upload/uploads'
import { sensors } from '../ble'
import type { GpsStatus } from '../gps'
import { SensorRunner, type SensorRunPhase } from '../runner'
import { SensorRunLog } from '../runLog'
import { SENSOR_RUN_NAME } from '../name'
import { parseKmh } from '../../camera/belt'
import { SPEED_FIT } from '../params'
import { fitSpeedA, saveSpeedFit } from '../speedFit'

// センサーラン：カメラなし・腰にスマホなしで、体に付けたセンサーだけで走る（スマホは腰のポーチ。画面は見ない）。
// 知らせは振動だけ（胸の猫背・頭が前に出る・接地が長い・左右差。ずれは短く3回、頭と接地は直ったら短く2回）。声は、立つ・待つの案内と、終わりの言葉だけ。
// 立った姿勢と走っているかは、センサーで決める（runner.ts）。記録は 60秒ごとに端末へ書き出す（runLog.ts。7時間まで）
// 腰のポーチに入れたこのスマホの向きも記録する（waist.ts。知らせには使わない）。
// トレッドミルでは、ベルトの速さを入れられる（胸の、その速さで正しい前傾と、足首の速さの式の人ごとの合わせに使う。speedFit.ts）。
//   欄は画面のいちばん上に、走っている間も出しておく：始めて5秒でポーチに入れるので、立つ間だけ出していたら入れそびれた（2026-11-06 の2本。
//   ベルト時速9kmで、足首の見積もりは 7.7 のまま）。胸に使うのは走る前傾を覚える時刻（走って40秒）までに入れた値、速さの合わせは終えるときの値。
//   外で走ることが多いので、カメラ版と違い前回の値は入れておかない（外の走りに前のベルトの速さを使わないため）

// label：時間の横の短い印（立ち方の何番目か）。ほかの段階は、下の文で分かるので出さない
const PHASE_TEXT: Record<SensorRunPhase, { label: string; text: string }> = {
  stand: { label: '立ち方 1/2', text: 'いつもの楽な立ち方で、3秒止まってください' },
  ready: { label: '', text: '走り出すと始まります' },
  run: { label: '', text: '見ています。崩れたら、その場所が震えます' },
  stop: { label: '', text: '止まっています。走り出すと続きます' },
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
  const [gps, setGps] = useState<GpsStatus | null>(null) // 位置情報の様子（記録に残すだけ。Bluefy で取れるかを画面で確かめる）
  const [runSec, setRunSec] = useState(0)
  const [wake, setWake] = useState(false)
  const [holding, setHolding] = useState(false)
  const finishRef = useRef<() => void>(() => {})
  const [beltText, setBeltText] = useState('')
  const beltRef = useRef<number | undefined>(undefined)
  beltRef.current = parseKmh(beltText)
  const beltInvalid = beltText.trim() !== '' && beltRef.current === undefined
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
      gps: true,
      waist: true,
      belt: () => beltRef.current,
      onChange: () => {
        setPhase(runner.phase)
        setStage(runner.stage)
        setGps(runner.gpsStatus)
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
      const t = performance.now() / 1000
      const belt = beltRef.current
      rec.event(t, belt === undefined ? 'belt:none' : `belt:kmh ${belt}`)
      // ベルトの速さが分かっていて、足首の1歩が足りれば、速さの式をこの人に合わせて端末に残す（speedFit.ts。カメラ版と同じ）
      const steps = runner.session.contactSteps.map((x) => x.s)
      if (belt !== undefined && steps.length >= SPEED_FIT.minSteps) {
        const fit = fitSpeedA(steps, belt)
        const a = saveSpeedFit(fit)
        if (fit) rec.event(t, `speedFit:A ${fit.speedA} n ${fit.n} spread ${fit.spread} use ${a}`)
      }
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
  const p = phase === 'stand' && stage === 'b' ? { label: '立ち方 2/2', text: '胸を開いて、肩を後ろに引いて、顎を軽く引いて、3秒止まってください' } : PHASE_TEXT[phase]
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
          {p.label && <div style={{ fontSize: 15, fontWeight: 700 }} className="muted">{p.label}</div>}
        </div>
        <div className="num" style={{ fontSize: 44 }}>{mmss(runSec)}</div>
      </div>
      <div style={{ fontSize: 13 }} className="muted">{SENSOR_RUN_NAME}（走っていた時間）</div>

      <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.5 }}>{p.text}</div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 700 }}>
          <span style={{ flexGrow: 1 }}>トレッドミルのベルトの速さ</span>
          <input
            type="number"
            inputMode="decimal"
            step={0.1}
            min={SPEED_FIT.kmhMin}
            max={SPEED_FIT.kmhMax}
            placeholder="例 9.0"
            aria-label="ベルトの速さ（時速 km）"
            value={beltText}
            onChange={(e) => setBeltText(e.target.value)}
            style={{ width: 110, padding: '8px 10px', borderRadius: 10, border: `1px solid ${beltInvalid ? 'var(--warn)' : 'var(--line)'}`, background: 'rgba(255,255,255,0.06)', color: 'var(--text)', fontSize: 16, fontFamily: 'var(--num)' }}
          />
          <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>km/h</span>
        </label>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: beltInvalid ? 'var(--warn)' : undefined }} className={beltInvalid ? undefined : 'muted'}>
          {beltInvalid
            ? `時速${SPEED_FIT.kmhMin}〜${SPEED_FIT.kmhMax}kmの数字を入れてください（このままだと使いません）`
            : phase === 'stand' || phase === 'ready'
              ? '外を走るときは空欄。入れると、胸の基準と、足首で見積もる速さの合わせに使います。'
              : '終える前に入れれば、足首で見積もる速さの合わせに使います。'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip ok={on.length > 0} label={`センサー ${on.length}個`} />
        {lost.length > 0 && <Chip ok={false} label={`切れた：${lost.map((n) => n.place).join('・')}（つなぎ直しています）`} />}
        <Chip ok={wake} label={wake ? '画面は消えません' : '画面が消えるかも'} />
        <Chip ok={gps === 'on'} label={gps === 'on' ? 'GPS：記録しています' : gps === 'none' ? 'GPS：このブラウザでは使えません' : gps === 'denied' ? 'GPS：許可されていません' : 'GPS：待っています'} />
      </div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
        画面を消さないでください（消えると、センサーの値の受け取りや振動が止まるおそれがあります）。
        {wake ? '画面の明るさを下げておくと、電池が長くもちます。' : '設定の「画面表示と明るさ」→「自動ロック」を「なし」にし、明るさを下げてください。'}
      </div>
      <details>
        <summary className="muted" style={{ fontSize: 12 }}>くわしく</summary>
        <div className="muted" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, fontSize: 12, lineHeight: 1.7 }}>
          <div>
            始めると、2つの立ち方を3秒ずつ測ります（案内の声が終わってから）。1つ目はいつもの楽な立ち方、2つ目は胸を開いた立ち方です。
            センサーは付けるたびに角度が変わるので、決まった線ではなく、この2つの違いを今日の猫背の物差しにします（違いが小さいと、もう一度お願いします）。
          </div>
          <div>ベルトの速さは、走り出して40秒までに入れたものを胸の基準に使います。足首で見積もる速さは、入れた走りのあと、次の走りから合います。</div>
          <div>腰のポーチに入れると、このスマホの向きも記録します（画面が消えている間は途切れます）。ポケットに入れるときは、画面を体の側に向けてください。</div>
        </div>
      </details>

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
