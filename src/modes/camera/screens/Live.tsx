import { useEffect, useRef, useState } from 'react'
import { RUNNING } from '../../../core/params'
import { BASELINE, CORRECT, SETUP, WAIT } from '../params'
import { ITEM_KEYS, type Baseline, type Frame, type ItemKey, type Sample, type Session } from '../../../core/types'
import type { Measure } from '../types'
import { Coach, judged, type CoachEvent, type CoachState } from '../coach'
import { facing, levelFrame, measure, nearSide, rotateFrame, sideOffDeg, yawSign } from '../geometry'
import { worldAngles, type P3 } from '../world'
import { MotionDetector, bodyVisible } from '../motion'
import { L } from '../landmarks'
import { headCircle } from '../ui/head'
import { framing, FramingWindow, FRAMING_TEXT, EDGE, type Framing } from '../framing'
import { overCue } from '../scoring'
import { gravityAvailable, gravityPitch, gravityRoll, phoneStillSec } from '../gravity'
import { queueUpload } from '../../../core/upload/uploads'
import { loadBaselines, loadProgress, loadSettings, persistStorage, saveBaseline, saveProgress, saveSession, writeLogChunk } from '../../../core/storage'
import { LOG_CHUNK, LogSaver } from '../../../core/logChunks'
import { activeItems, afterRun } from '../../../core/level'
import { todayFocus } from '../nextStep'
import { LogRecorder } from '../log'
import { preloadVoice, speak, stopVoice, voicePending } from '../../../core/voice'
import { PHRASES } from '../../../core/phrases'
import { capBaseline, median, standingIssue, type Standing, type StandingIssue } from '../standing'
import { cameraLens, loadLandmarker, openCamera, runPose } from '../pose/detector'
import { fullFrames } from '../fullFrames'
import { SensorRunner } from '../../sensor/runner'
import { sensors } from '../../sensor/ble'
import { POSE, SPEED_FIT } from '../../sensor/params'
import { fitSpeedA, saveSpeedFit } from '../../sensor/speedFit'
import { loadBeltText, parseKmh, runSpeedOf, saveBeltText } from '../belt'

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
  problem?: string | null // 置き方で、いま足りないこと（null ならそろっている）
  pose?: 'a' | 'b' // 直立の基準で、いま測っている立ち方（a：いつもの楽な立ち方、b：胸を開いた立ち方）
  framing: Framing // 体が画面にどう収まっているか（直近1秒でならしたもの。framing.ts）
  fps: number // 骨格を取ったコマの毎秒の数（直近 WAIT.window 秒）
  slow: boolean // 走り出すのを待つ間に、骨格のコマが少なくて走りを数えにくい（WAIT.slowFps）
}

// 頭から足までが画面の高さの何割か。超広角で 1m 前後なら約6割、3m だと約2割
const SPAN_MIN = SETUP.spanMin
const bodySpan = (f: Frame, h: number) => (Math.max(f[L.leftAnkle].y, f[L.rightAnkle].y, f[L.leftHeel].y, f[L.rightHeel].y) - f[L.nose].y) / h

const ITEM_TEXT: Record<ItemKey, string> = { hunch: '背中が丸まっています', head: '頭が前に出ています', trunk: '上体が倒れすぎています', trunkBack: '上体が起きています', body: '体が倒れすぎています', bodyBack: '体が後ろに残っています', hip: '腰が落ちています', landing: '足が体より前に着いています' }

// 置き方の案内（声の言葉）を、画面の1行に出す短い言葉にする。声はそのまま言い、くわしい文は「くわしく」に出す
const SHORT: Record<string, string> = {
  [PHRASES.placeStart]: 'スマホを縦に置いてください',
  [PHRASES.guideDark]: '暗すぎます',
  [PHRASES.guideNone]: '体が映っていません',
  [PHRASES.guideFar]: '全身が入っていません（スマホを離す）',
  [PHRASES.guideNear]: '体が小さすぎます（スマホを近づける）',
  [PHRASES.guideTiltDown]: 'スマホが下を向いています',
  [PHRASES.guideHigh]: 'スマホが高すぎます（腰の高さへ）',
  [PHRASES.guideLow]: 'スマホが低すぎます（腰の高さへ）',
  [PHRASES.guideSide]: '体の横をスマホに向けてください',
  [PHRASES.guideBehind]: '少し後ろ側から撮っています',
  [PHRASES.guideFront]: '少し前側から撮っています',
}

// sessions：これまでの走り（新しい順）。走り出す前に言う「今日意識するのは…」を、ホームの「今日の意識」と同じ1つにするため
export function Live({ video: file, sessions = [], onDone }: { video?: File; sessions?: Session[]; onDone: (id?: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tapsRef = useRef<number[]>([])
  const coachRef = useRef<Coach | null>(null)
  const finishRef = useRef<() => void>(() => {})
  const screenMode = loadSettings().screen
  // 前面カメラは鏡のように左右反転して見せる（骨格の計算は反転しない元の映像で行う）
  const mirror = !file && loadSettings().camera === 'front'
  // 検証用の「全コマ記録」（URL に ?full=1）。走っている間も間引かず毎コマ骨格を取る。動画で試すときはもともと毎コマ取る
  const full = !file && fullFrames()
  const [hud, setHud] = useState<Hud>({ phase: 'loading', state: 'waiting', caption: '', elapsed: 0, quiet: false, scores: [], checks: { body: false, side: false, sideDeg: 90, light: true }, framing: 'none', fps: 0, slow: false })
  // ベルトの速さ（時速 km。走る前に入れる。前回の値を覚えている。空欄なら使わない）。belt.ts
  const [beltText, setBeltText] = useState<string>(() => (file ? '' : loadBeltText()))
  const beltRef = useRef<number | undefined>(undefined)
  beltRef.current = parseKmh(beltText)
  const beltInvalid = beltText.trim() !== '' && beltRef.current === undefined

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
    // 直立の基準は毎回取る（その日の置き方のずれも消え、姿勢がよくなればそれについていく）
    let baseline: Baseline | null = null
    const motion = new MotionDetector()
    let okSince: number | null = null
    let notReadySince: number | null = null
    let lastGuide = 0
    let stillSince: number | null = null
    let baseNecks: number[] = []
    let baseLeans: number[] = [] // 立った姿勢の頭の位置（肩→耳の前傾）。b のものを、頭の線の「胸を開いた立ち方からの差」に使う
    let baseYaws: number[] = [] // 立った姿勢の前側・後ろ側の値（記録用）
    let openPose: { neck: number; headLean: number } | undefined // 胸を開いた立ち方（b）の首・頭の位置（Coach に渡す。form.ts の headOver）
    let rollOk: boolean | null = null // 傾きセンサーの左右の傾きが分かっているか（変わったら記録に残す）
    let baseMovingSince: number | null = null
    let baseStands: Standing[] = []
    let baseHips: number[] = [] // 立った姿勢の腰の高さ（走りの数字の腰の高さを割る）
    let baseTries = 0 // 2つの立ち方を測り直してもらった回数（差が小さかった）
    // 2つの立ち方：a「いつもの楽な立ち方」→ b「胸を開いて、肩を後ろに引いて、顎を軽く引いて」を3秒ずつ（params.ts の POSE）
    let poseStage: 'a' | 'b' = 'a'
    let poseRepeats = 0 // いまの立ち方を言い直した回数（BASELINE.forceAfter 回で、揺れを見ずに測る）
    let poseA: Standing | undefined // a のときのカメラの頭の位置と上体（記録と結果の画面用）
    let standing: { head: number; trunk: number; issue: StandingIssue | null; hip?: number; habit?: Standing } | undefined
    let provisional: number[] = []
    let lastHud = 0
    let caption = ''
    let captionAt = 0
    let finished = false
    let lastSample: Sample | undefined
    let lastLight = true
    let lastLightAt = 0
    let lastProblem: string | null = PHRASES.placeStart
    let lastSaid = ''
    let setupAt: number | null = null
    let hintMsg = ''
    let hintSince = 0
    // 「映っている」は、直近2秒のコマのうち見えていた割合で決める（一瞬の見間違いで切り替えない）
    let seenHist: { t: number; seen: boolean }[] = []
    let yawHist: { t: number; v: number }[] = []
    let present = false
    let bodyAnnounced = false
    let firstSaid = false
    let lastPresent = true
    let lastMoving = false
    let lastNextSay = 0 // 次に何をすればいいかを最後に言った時刻
    // 体が画面にどう収まっているか（framing.ts）。画面に出すのは直近1秒でならしたもの、
    // 走り出すのを待つ間に理由を言うのは直近 WAIT.window 秒でならしたもの（骨格を取ったコマだけを入れるので、コマ数も分かる）
    const shown = new FramingWindow(1)
    const waitWin = new FramingWindow(WAIT.window)

    // 調整用の記録（骨格の点と判定の数字）。カメラで撮るときは、スマホ版の記録と時刻を合わせられるよう、時計の対応を残す
    const rec = new LogRecorder(file ? undefined : { perfMs: performance.now(), epochMs: Date.now() })
    if (full || file) rec.log.full = true
    // 長い走り（マラソンで7時間まで）でも、記録を手元に溜めこまない：LOG_CHUNK.every 秒ごとに端末へ書き出す（アプリが落ちても、そこまでは残る）
    const saver = new LogSaver(rec.log, { write: writeLogChunk })
    void persistStorage().then((st) => {
      if (st) rec.log.storage = st
    })
    let nowT = 0
    let tickMoving = false
    // ランナーのレベルと、今日注意する項目（走り終わったら、続いて声がかからなかったかで次の段階へ）
    const progress = loadProgress()
    // 自作のセンサー（つないであるとき）：値を記録し、胸で猫背・頭で前に出たの・足首で接地を見て震わせる（sensor/runner.ts。腰スマホ・センサーランと共通）。
    // 区切りはカメラの直立の基準と「走っている」を使う。胸の線はレベルごと。トレッドミルでは接地の知らせを声でも言う
    let camNow: { t: number; trunk: number; head: number } | null = null // 走っている間の、いちばん新しいカメラの値（センサーへ渡す）
    const sensorRun = !file && sensors.supported
      ? new SensorRunner({
          onEvent: (t, text) => rec.event(t, text),
          level: progress.level,
          voice: true,
          running: () => {
            const coach = coachRef.current
            return phase === 'run' && !!coach && coach.state === 'running' && coach.stepping
          },
          // カメラの上体と頭の位置（直近1秒のコマがあるときだけ）。胸のセンサーがずれたのか、本当に崩れたのかを分けるのに使う（sensor/lean.ts）
          camera: () => (camNow && performance.now() / 1000 - camNow.t < 1 ? { trunk: camNow.trunk, head: camNow.head } : null),
          // ベルトの速さ（入れたとき）：胸の、その速さで正しい前傾に使う（sensor/expect.ts）
          belt: () => beltRef.current,
        })
      : null
    const logTimer = setInterval(() => {
      const cur = sensorRun?.current()
      if (cur) rec.log.sensors = cur
      void saver.flush()
    }, LOG_CHUNK.every * 1000)
    // 走り終わり（やめたときも）：残りを書いて、走っている途中の印を外す
    const saveAll = () => {
      clearInterval(logTimer)
      return saver.flush(true)
    }
    let sensorsClosed = false
    const closeSensors = () => {
      if (sensorsClosed) return
      sensorsClosed = true
      const log = sensorRun?.finish()
      if (log) rec.log.sensors = log
    }
    const setPhase = (p: Phase) => {
      rec.event(nowT, `phase:${p}`)
      phase = p
      setHud((h) => ({ ...h, phase: p }))
    }
    const say = (text: string, t: number) => {
      rec.event(t, text)
      speak(text)
      caption = text
      captionAt = t
    }

    // 今日意識すること（ホームの「今日の意識」と同じ1つ。nextStep.ts の todayFocus）
    const focus = todayFocus(sessions, progress)

    const finish = async () => {
      if (finished) return
      finished = true
      closeSensors()
      const coach = coachRef.current
      if (coach && coach.samples.length >= 30) {
        // その走りの速さ：ベルトの速さ（真）→ 足首のセンサーの見積もり → カメラの速さの目安（belt.ts）。結果の画面のよい例の範囲を、この速さにする
        const steps = sensorRun?.session.contactSteps.map((x) => x.s) ?? []
        const s = coach.finish()
        const belt = beltRef.current
        const speed = runSpeedOf({ belt, sensorV: steps.map((x) => x.v), camSv: s.form?.find((r) => r.group === 'landing')?.speed })
        if (speed) {
          s.speedKmh = speed.kmh
          s.speedSource = speed.source
          rec.event(nowT, `speed:${speed.source} ${speed.kmh}`)
        }
        // ベルトの速さが分かっていて、足首の1歩が足りれば、速さの式をこの人に合わせて端末に残す（sensor/speedFit.ts）
        if (belt !== undefined && steps.length >= SPEED_FIT.minSteps) {
          const fit = fitSpeedA(steps, belt)
          const a = saveSpeedFit(fit)
          if (fit) rec.event(nowT, `speedFit:A ${fit.speedA} n ${fit.n} spread ${fit.spread} use ${a}`)
        }
        s.taps = tapsRef.current
        s.provisionalBaseline = !!file
        s.standing = standing
        s.logId = rec.log.id
        s.focus = { level: progress.level, step: progress.step }
        rec.log.sessionId = s.id
        await saveSession(s)
        saveProgress(afterRun(progress, s))
        await saveAll()
        queueUpload('camera', rec.log.id, rec.log.startedAt)
        onDone(s.id)
      } else {
        // 走りが始まらなかったときこそ調整に使うので、記録は残す
        await saveAll()
        queueUpload('camera', rec.log.id, rec.log.startedAt)
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

    // 置き方の案内。背面カメラでは画面が見えないので、本人がどう動けばいいかで言う
    // yaw：スマホが体の前側から（正）か後ろ側から（負）撮っているか。1秒でならした値
    const guide = (frame: Frame | null, w: number, h: number, sideDeg: number, yaw: number, light: boolean): string | null => {
      if (!light) return PHRASES.guideDark
      if (!frame) return PHRASES.guideNone
      const ys = [L.nose, L.leftAnkle, L.rightAnkle].map((i) => frame[i].y)
      if (Math.min(...ys) < h * 0.04 || Math.max(...ys) > h * 0.98 || !bodyVisible(frame)) return PHRASES.guideFar
      // 小さく映っていると膝や足首の点がぶれて、走り出しや角度が取れない。画面の高さの4割はほしい
      if (bodySpan(frame, h) < SPAN_MIN) return PHRASES.guideNear
      // スマホが下を向いている・高すぎる・体の後ろ側から撮っている：着地の角度などが大きくずれるので直してもらう
      const pitch = !file && gravityAvailable() ? gravityPitch() : 0
      if (pitch > SETUP.pitchDownMax) return PHRASES.guideTiltDown
      const hipY = (frame[L.leftHip].y + frame[L.rightHip].y) / 2 / h
      if (Math.abs(pitch) <= SETUP.pitchDownMax && hipY > SETUP.hipLowMax) return PHRASES.guideHigh
      if (Math.abs(pitch) <= SETUP.pitchDownMax && hipY < SETUP.hipHighMin) return PHRASES.guideLow
      // 体がスマホのほうを向いているときは、まず横を向いてもらう（前側・後ろ側の値は、横を向いていないと当てにならない）
      if (sideDeg > 20) return PHRASES.guideSide
      // 真横から約8°以内に置いてもらう。頭の位置は、前側に15°ずれるだけで +11° ずれて測れる（params.ts の SETUP）
      if (yaw < SETUP.behindMax) return PHRASES.guideBehind
      if (yaw > SETUP.frontMax) return PHRASES.guideFront
      const xs = frame.filter((p) => p.v > 0.5).map((p) => p.x)
      const cx = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
      if (cx < w * 0.3 || cx > w * 0.7) {
        // 画面の真ん中へ向かう向きが、本人の前か後ろかで言い分ける（前面カメラは映像が反転しているので逆）
        const toCenter = cx < w * 0.3 ? 1 : -1
        const forward = toCenter === facing(frame) ? !mirror : mirror
        return forward ? PHRASES.guideForward : PHRASES.guideBack
      }
      return null
    }

    // guideOf：置く・立つ・走り出すのを待つ間は、映像のふちを色で囲み（全身が入っていれば緑、足りなければ橙）、
    // 頭・足が切れている側のふちを太く塗る。離れていても、どこが切れているかが色で分かるように
    const draw = (frame: Frame | null, w: number, h: number, hot: Set<string>, guideOf?: Framing) => {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.clearRect(0, 0, w, h)
      const s = Math.max(2, w / 220)
      if (guideOf) {
        const ok = guideOf === 'ok'
        ctx.setLineDash([])
        ctx.strokeStyle = ok ? '#C8F03C' : '#FF8A3D'
        ctx.lineWidth = s * 3
        ctx.strokeRect(s * 1.5, s * 1.5, w - s * 3, h - s * 3)
        // 頭と足が収まってほしい線（点線）。この線の内側に頭から足までが入れば「全身」
        ctx.setLineDash([s * 4, s * 3])
        ctx.lineWidth = s
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'
        for (const y of [h * EDGE.top, h * EDGE.bottom]) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        ctx.setLineDash([])
        const band = h * 0.1
        ctx.fillStyle = 'rgba(255,138,61,0.55)'
        if (guideOf === 'head' || guideOf === 'both') ctx.fillRect(0, 0, w, band)
        if (guideOf === 'feet' || guideOf === 'both') ctx.fillRect(0, h - band, w, band)
        if (guideOf === 'none') {
          ctx.fillStyle = 'rgba(255,138,61,0.18)'
          ctx.fillRect(0, 0, w, h)
        }
      }
      if (!frame) return
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
      // 頭の丸は、耳から少し後ろ・上を中心にする（見た目だけ。ui/head.ts）
      const hc = headCircle(ear, frame[L.nose])
      ctx.arc(hc.x, hc.y, hc.r, 0, Math.PI * 2)
      ctx.stroke()
    }

    const start = async () => {
      try {
        if ('wakeLock' in navigator) wake = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen').catch(() => null)
        const [lm] = await Promise.all([loadLandmarker(), preloadVoice(loadSettings().voice)])
        if (disposed) return
        if (file) {
          objectUrl = URL.createObjectURL(file)
          video.src = objectUrl
          video.muted = true
          video.playsInline = true
          await video.play()
          video.onended = () => finish()
        } else {
          stream = await openCamera(video, loadSettings().camera)
        }
        if (disposed) return
        setPhase(file ? 'run' : 'setup')
        const clock = file ? () => video.currentTime : () => performance.now() / 1000
        // 走っている間は、コーチが要ると言ったときだけ骨格を取る（人が見えなくなったら毎コマ取って探す）。全コマ記録のときは毎コマ
        const want = () => !!file || full || phase !== 'run' || !coachRef.current || !lastPresent || coachRef.current.wantsDetail()
        stopPose = runPose(
          video,
          lm,
          (tick) => (tick.skipped ? onSkip(tick.t) : onTick(tick.frame, tick.t, tick.width, tick.height, tick.world)),
          clock,
          want,
        )
      } catch (e) {
        setHud((h) => ({ ...h, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
      }
    }

    const handle = (events: CoachEvent[], t: number) => {
      for (const e of events) {
        if (e.type === 'speak') say(e.text, t)
        if (e.type === 'state' && e.state === 'ended') finish()
      }
    }

    // 骨格を取らなかったコマ。時間だけ進め、見えている・走っているは直前のままにする
    const onSkip = (t: number) => {
      const coach = coachRef.current
      if (phase !== 'run' || !coach) return
      handle(coach.update({ t, present: lastPresent, moving: lastMoving }), t)
      updateHud(t, lastPresent, 0)
    }

    const onTick = (raw: Frame | null, t: number, w: number, h: number, world?: P3[]) => {
      nowT = t
      tickMoving = false
      // スマホの傾きを直す：左右の傾きを戻し、下を向いているとき（または大きく上を向いているとき）は上下の向きも戻す。
      // 傾きセンサーが使えない（許可がない・機種が出さない）間は直せないので、体全体・上体・着地を正しいフォームの線と比べない（noRoll。coach.ts）
      const noRoll = !file && !gravityAvailable()
      if (!file && rollOk !== !noRoll) {
        rollOk = !noRoll
        rec.event(t, rollOk ? 'roll:ok' : 'roll:none')
      }
      let frame = raw
      if (raw && !file && gravityAvailable()) {
        frame = rotateFrame(raw, gravityRoll(), w / 2, h / 2)
        const pitch = gravityPitch()
        if (pitch > CORRECT.pitchDownFrom || pitch < CORRECT.pitchUpFrom) frame = levelFrame(frame, pitch, cameraLens === 'ultra' ? CORRECT.vfovUltra : CORRECT.vfovNormal, w, h)
      }
      const visible = !!frame && bodyVisible(frame, 0.5, h)
      // 画面に映ったまま（傾きを直す前）の点で、頭・足が切れていないかを見る
      const fr = framing(raw, h)
      shown.push(t, fr)
      waitWin.push(t, fr)
      const m: Measure | undefined = visible ? measure(frame!) : undefined
      // worldLandmarks からの向きと角度（記録に残すだけ。world.ts）
      const wa = visible && world ? worldAngles(world, file ? 0 : gravityRoll(), file ? 0 : gravityPitch(), nearSide(frame!) === 'right') : null
      if (m && phase === 'run') camNow = { t, trunk: m.trunk, head: m.headLean }
      const sideDeg = frame ? sideOffDeg(frame) : 90
      if (phase === 'setup' && t - lastLightAt > 1) {
        lastLight = brightness() > 40
        lastLightAt = t
      }

      // 置き方の案内
      // 進む条件は、画面に出している3つ（全身・真横・明るさ）だけ。真ん中に寄っているかなどは声で案内するだけにする
      if (phase === 'setup') {
        // 真横の判定は、骨格の推定で両肩・両腰が少し開いて見えるため、35°までは通す
        // 手に持っている間は判定しない（動く映像を人と見間違えることがある）。置いて1.5秒静止してから見る
        const placed = !!file || phoneStillSec() > SETUP.phoneStill
        const seen = visible && placed
        seenHist.push({ t, seen })
        seenHist = seenHist.filter((x) => t - x.t <= SETUP.seenWindow)
        const ratio = seenHist.filter((x) => x.seen).length / seenHist.length
        // 9割以上のコマで2秒見えたら「映った」、3割を切ったら「映っていない」（間で行ったり来たりしない）
        if (!present && t - seenHist[0].t >= SETUP.seenWindow * 0.9 && ratio >= SETUP.seenOn) present = true
        else if (present && ratio < SETUP.seenOff) {
          present = false
          bodyAnnounced = false
        }
        if (frame && visible) yawHist.push({ t, v: yawSign(frame) })
        yawHist = yawHist.filter((x) => t - x.t <= SETUP.yawSmooth)
        const yaw = yawHist.length ? yawHist.reduce((a, x) => a + x.v, 0) / yawHist.length : 0
        // 人は映っているのに頭・足が切れている（全身が「映った」にならない）ときは、「まだ体が映っていません」ではなく、離れるよう言う
        const cut = shown.current()
        const partly = !present && lastLight && (cut === 'head' || cut === 'feet' || cut === 'both' || cut === 'hidden')
        const hint = placed ? (partly ? PHRASES.guideFar : guide(present ? frame : null, w, h, sideDeg, yaw, lastLight)) : null
        const blocking =
          hint === PHRASES.guideTiltDown || hint === PHRASES.guideHigh || hint === PHRASES.guideLow || hint === PHRASES.guideBehind || hint === PHRASES.guideFront || hint === PHRASES.guideNear
        const ready = present && visible && lastLight && sideDeg <= SETUP.sideMax && !!frame && !blocking
        lastProblem = ready ? null : hint === PHRASES.guideForward || hint === PHRASES.guideBack || !hint ? PHRASES.guideSide : hint
        // 開いてすぐは話さない（スマホを置いて離れるまでの間）
        setupAt ??= t
        const talk = t - setupAt >= SETUP.talkAfter
        if (ready) {
          notReadySince = null
          okSince ??= t
          if (t - okSince > SETUP.readyHold && talk) {
            // 次に何をすればいいかまで、続けて声で言う（画面は見えない前提）
            lastNextSay = t
            say(PHRASES.placeOk, t)
            say(PHRASES.poseHabit, t)
            poseStage = 'a'
            setHud((hh) => ({ ...hh, pose: 'a' }))
            setPhase('baseline')
            stillSince = null
          }
        } else {
          // 判定が一瞬ゆれただけなら、数えた時間を消さない
          notReadySince ??= t
          if (t - notReadySince > 0.6) okSince = null
          // 離れていて画面が見えなくても分かるよう、全身が入ったら声で知らせる
          if (talk && !bodyAnnounced && present) {
            bodyAnnounced = true
            say(PHRASES.bodyIn, t)
            lastGuide = t
          }
          let msg = lastProblem ?? PHRASES.guideNone
          if (!placed || (!firstSaid && msg === PHRASES.guideNone)) msg = PHRASES.placeStart
          if (msg !== hintMsg) {
            hintMsg = msg
            hintSince = t
          }
          // 同じ案内が1.2秒続いてから言う。変わったら言い直し、同じなら6秒ごとに繰り返す
          // 「置いてください」のあとの「まだ体が映っていません」は、同じ案内として扱う
          const same = msg === lastSaid || (msg === PHRASES.guideNone && lastSaid === PHRASES.placeStart)
          if (talk && t - hintSince >= SETUP.hintStable && t - lastGuide > (same ? SETUP.hintRepeat : 1.5)) {
            say(msg, t)
            lastGuide = t
            lastSaid = msg
            firstSaid = true
          }
        }
      }

      // 直立の基準（走るたびに取る）。止まってから1秒は落ち着くのを待ち、そのあと3秒の真ん中の値を使う
      if (phase === 'baseline' && m) {
        const moving = motion.update(frame!, t)
        tickMoving = moving
        // 骨格の推定は止まっていても少し揺れるので、1秒続けて動いたときだけ数え直す
        if (moving) baseMovingSince ??= t
        else baseMovingSince = null
        // 案内（2つの立ち方や測り直しの声）を言い終えるまでは測らない。聞きながら姿勢を直すため
        const force = poseRepeats >= BASELINE.forceAfter
        if (voicePending() || (!force && baseMovingSince !== null && t - baseMovingSince > BASELINE.movingTolerance)) {
          stillSince = null
          baseNecks = []
          baseLeans = []
          baseYaws = []
          baseStands = []
          baseHips = []
        } else {
          stillSince ??= t
          const el = t - stillSince
          if (el > BASELINE.settle) {
            baseNecks.push(m.neck)
            baseLeans.push(m.headLean)
            baseYaws.push(m.yaw)
            baseStands.push({ head: m.neck + m.trunk, trunk: m.trunk })
            baseHips.push(m.hipRatio)
          }
          const left = Math.max(1, Math.ceil(BASELINE.settle + BASELINE.collect - el))
          setHud((hh) => (hh.countdown === left ? hh : { ...hh, countdown: left }))
          if (el > BASELINE.settle + BASELINE.collect && baseNecks.length > 10) {
            // 2つの立ち方（a → b）を3秒ずつ。カメラの頭の位置と上体を記録に残し、胸・頭のセンサーの向きも測る（sensor/session.ts の pose・calibrate）。
            // カメラの立ち姿勢の線（standing.ts）では、いつもの猫背とまっすぐを分けられなかったので、「まっすぐです」とは言わない
            const st = { head: median(baseStands.map((x) => x.head)), trunk: median(baseStands.map((x) => x.trunk)) }
            const cam = { trunk: st.trunk, head: st.head }
            rec.event(t, `pose:${poseStage} head ${st.head.toFixed(1)} trunk ${st.trunk.toFixed(1)} neck ${median(baseNecks).toFixed(1)} headLean ${median(baseLeans).toFixed(1)} yaw ${median(baseYaws).toFixed(3)}`)
            sensorRun?.pose(poseStage, t, BASELINE.collect, cam)
            const restart = () => {
              poseRepeats = 0
              lastNextSay = t
              stillSince = null
              baseNecks = []
              baseLeans = []
              baseYaws = []
              baseStands = []
              baseHips = []
            }
            if (poseStage === 'a') {
              poseA = st
              poseStage = 'b'
              setHud((hh) => ({ ...hh, pose: 'b' }))
              say(PHRASES.poseOpen, t)
              restart()
            } else {
              // 胸（なければ頭）のセンサーで、a と b の差が小さければ測り直す（POSE.retries 回まで。使い切ったら、b を立った姿勢にして今までの見方）
              const r = sensorRun?.calibrate(t, baseTries >= POSE.retries) ?? null
              if (r?.retry) {
                baseTries++
                poseStage = 'a'
                setHud((hh) => ({ ...hh, pose: 'a' }))
                say(PHRASES.poseRetry, t)
                say(PHRASES.poseHabit, t)
                restart()
              } else {
                // 基準（首の角度・立ち姿勢・腰の高さ）は b（胸を開いた立ち方）で取る：目指す形を今日の基準にする（いつもの猫背を基準にしない）
                const today = median(baseNecks)
                // 頭の線は、走っている頭を、この立ち方（b）からの差でも見る（スマホの向きでずれにくい。params.ts の FORM の頭）
                openPose = { neck: today, headLean: median(baseLeans) }
                const createdAt = Date.now()
                baseline = { neck: capBaseline(today, loadBaselines()), createdAt, ...st }
                saveBaseline({ neck: today, createdAt, ...st })
                // 決まった線（standing.ts）は、b でも越えていたら知らせるだけ（測り直さない。越えていなくても、まっすぐとは言わない）
                const issue = standingIssue(st)
                standing = { ...st, issue, hip: median(baseHips), habit: poseA }
                const fallback = r?.parts.find((x) => x.mode !== 'none')?.mode === 'fallback'
                say(fallback ? PHRASES.poseSmall : issue === 'head' ? PHRASES.baseHeadLeft : issue === 'back' ? PHRASES.baseBackLeft : PHRASES.poseDone, t)
                say(focus.say, t) // 今日意識すること（ホームと同じ1つ。前の言葉のあとに続けて話す）
                lastNextSay = t
                // ベルトの速さ（走る前に入れたもの）を記録に残す。線とよい例の範囲は、この速さにする（Coach を作るときに渡す）
                rec.event(t, beltRef.current === undefined ? 'belt:none' : `belt:kmh ${beltRef.current}`)
                setPhase('run')
              }
            }
          }
        }
      }

      // 基準がなかなか取れないときは、立ち方をもう一度言う。間隔は言い終えてから数える
      // （2026-11-06：言った時から数えていたので、胸を開く案内 7.5秒→10.4秒 では言い終えてから測る4秒が取れる前に言い直し、何度も繰り返した）
      if (phase === 'baseline' && voicePending()) lastNextSay = t
      if (phase === 'baseline' && t - lastNextSay > BASELINE.repeat) {
        lastNextSay = t
        say(poseStage === 'a' ? PHRASES.poseHabit : PHRASES.poseOpen, t)
        poseRepeats++
        if (poseRepeats === BASELINE.forceAfter) rec.event(t, `pose:force ${poseStage}`)
      }

      // 走行中
      let hot = new Set<string>()
      if (phase === 'run') {
        const moving = frame && visible ? motion.update(frame, t) : false
        tickMoving = moving
        lastPresent = visible
        lastMoving = moving
        // 動画で試すときは、最初の10秒から仮の基準を作る
        if (!baseline && file) {
          if (m) provisional.push(m.neck)
          if (t > 10 && provisional.length > 30) {
            const sorted = provisional.slice().sort((a, b) => a - b)
            baseline = { neck: sorted[Math.floor(sorted.length * 0.25)], createdAt: Date.now() }
          }
        }
        // 検証中は一時停止を切っている（params.ts）。kmh：ベルトの速さ（入れたときだけ。速さで動く線をその速さにする）
        if (baseline && !coachRef.current) coachRef.current = new Coach({ pause: RUNNING.pauseEnabled, items: activeItems(progress.step), level: progress.level, kmh: beltRef.current, open: openPose })
        const coach = coachRef.current
        // 走り出すのを待っている間は、黙ったままにしない。
        // 走りの始まりは、全身が見えたコマだけで歩数を数える（coach.ts の RunningGate）ので、体が入っていない・頭や足が切れているなら、
        // 「走り出すと始まります」ではなく、それを言う（言葉は置き方の案内と同じ）。記録には、そのときの見え方とコマ数を残す
        if (coach && coach.state === 'waiting' && t - lastNextSay > RUNNING.waitRepeat) {
          lastNextSay = t
          const why = waitWin.okRatio < WAIT.seenMin ? waitWin.current() : 'ok'
          rec.event(t, `wait:${why} ok ${waitWin.okRatio.toFixed(2)} fps ${waitWin.fps.toFixed(1)}`)
          say(why === 'none' ? PHRASES.guideNone : why === 'ok' ? PHRASES.waitRun : PHRASES.guideFar, t)
        }
        if (coach) {
          handle(coach.update({ t, present: visible, moving, m, frame: visible ? frame! : undefined, noRoll }), t)
          lastSample = coach.samples[coach.samples.length - 1]
          if (lastSample && !coach.quiet) {
            if (overCue('head', judged(lastSample, 'head'))) hot.add('head')
            if (overCue('trunk', judged(lastSample, 'trunk')) || overCue('trunkBack', judged(lastSample, 'trunkBack'))) hot.add('trunk')
            if (overCue('body', judged(lastSample, 'body')) || overCue('bodyBack', judged(lastSample, 'bodyBack'))) hot.add('body')
          }
        }
      }

      // 置く・立つ・走り出すのを待つ間は、映像と骨格と、収まり方の印を出す
      const waiting = phase === 'run' && (!coachRef.current || coachRef.current.state === 'waiting')
      const previewNow = phase === 'setup' || phase === 'baseline' || waiting
      if (previewNow) draw(frame, w, h, hot, shown.current())
      else if (screenMode === 'show') draw(frame, w, h, hot)
      else draw(null, w, h, hot)

      // 上限は置かない（LOG_CHUNK.every 秒ごとに端末へ書き出して、手元の rows は空にする）
      rec.frame(t, phase, w, h, frame, { visible, moving: tickMoving, by: motion.by, cadence: motion.cadence, m, sideDeg, still: phoneStillSec(), pitch: gravityPitch(), roll: noRoll || file ? null : gravityRoll(), world: wa })
      updateHud(t, visible, sideDeg)
    }

    const updateHud = (t: number, visible: boolean, sideDeg: number) => {
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
          checks: { body: visible, side: sideDeg <= SETUP.sideMax, sideDeg: Math.round(sideDeg), light: lastLight },
          problem: lastProblem,
          framing: shown.current(),
          fps: Math.round(waitWin.fps * 10) / 10,
          slow: phase === 'run' && coach?.state === 'waiting' && waitWin.fps < WAIT.slowFps,
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
      // 終わりの言葉（おつかれさまでした）は最後まで言わせる
      if (!finished) {
        stopVoice()
        closeSensors()
        void saveAll()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 置く・2つの立ち方・走り出すのを待つ間（preview）は、映像と骨格を出し、文字は1行（と、たたんだ「くわしく」）だけにする。
  // 置く人が画面をのぞいて、全身が入っているか・頭や足が切れていないかを確かめられるように（2026-11-06 本人：文字でいっぱいで、体が枠に収まっているかが見えなかった）。
  // 走り出したあとは、背面カメラで画面は見えないので真っ暗にする（案内は声で行う）
  const preview = hud.phase === 'setup' || hud.phase === 'baseline' || (hud.phase === 'run' && hud.state === 'waiting')
  const dark = screenMode === 'dark' && !preview && (hud.phase === 'baseline' || hud.phase === 'run')
  const darkLabel = hud.state === 'paused' ? 'PAUSED' : hud.quiet ? 'QUIET CHECK' : 'COACHING'
  const darkText = hud.state === 'paused' ? '一時停止中' : '画面を消しても、声でお知らせします'
  const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const last = hud.last
  const label =
    hud.phase === 'loading' || hud.phase === 'error' ? '' : hud.phase === 'setup' ? 'SETUP' : hud.phase === 'baseline' ? 'BASELINE' : hud.state === 'waiting' ? 'READY' : hud.state === 'paused' ? 'PAUSED' : hud.quiet ? 'QUIET CHECK' : 'COACHING'
  // 大事な1行：体が収まっていなければまずそれ（どこが切れているか）。そろっていれば、いますること
  const status: { text: string; ok: boolean } =
    hud.framing !== 'ok'
      ? { text: FRAMING_TEXT[hud.framing], ok: false }
      : hud.phase === 'setup'
        ? hud.problem
          ? { text: SHORT[hud.problem] ?? hud.problem, ok: false }
          : { text: '✓ そろいました。待つと次へ進みます', ok: true }
        : hud.phase === 'baseline'
          ? { text: hud.pose === 'b' ? '2つ目：胸を開いて3秒止まる' : '1つ目：いつもの楽な立ち方で3秒止まる', ok: true }
          : hud.slow
            ? { text: `処理が追いつきません（毎秒${hud.fps}コマ）`, ok: false }
            : { text: '✓ 走り出すと始まります', ok: true }

  return (
    <div className={preview ? 'live preview' : 'live'}>
      <div className="live-top" style={dark ? { display: 'none' } : undefined}>
        <button className="icon-btn" aria-label="終える" onClick={() => finishRef.current()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--accent)' }} />
        <div style={{ fontFamily: 'var(--num)', fontSize: 15, letterSpacing: 3 }} className="muted">
          {label}
        </div>
        {full && <FullBadge />}
      </div>

      <div className="live-stage">
        <video ref={videoRef} playsInline muted style={{ opacity: dark ? 0 : 1, transform: mirror ? 'scaleX(-1)' : undefined }} />
        <canvas ref={canvasRef} style={{ opacity: dark ? 0 : 1, transform: mirror ? 'scaleX(-1)' : undefined }} />
      </div>

      {preview && (
        <div className="live-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {hud.phase === 'baseline' && hud.framing === 'ok' && (
              <div className="num" style={{ fontSize: 44, lineHeight: 1, color: 'var(--accent)' }}>{Math.max(1, Math.min(3, hud.countdown ?? 3))}</div>
            )}
            <div className="live-status" role="status" style={{ color: status.ok ? 'var(--accent)' : 'var(--warn)' }}>
              {status.text}
            </div>
          </div>
          {hud.phase === 'setup' && !file && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ flexGrow: 1 }}>ベルトの速さ</span>
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={SPEED_FIT.kmhMin}
                max={SPEED_FIT.kmhMax}
                placeholder="空欄可"
                aria-label="ベルトの速さ（時速 km）"
                value={beltText}
                onChange={(e) => {
                  setBeltText(e.target.value)
                  saveBeltText(e.target.value)
                }}
                style={{ width: 110, padding: '6px 8px', borderRadius: 10, border: `1px solid ${beltInvalid ? 'var(--warn)' : 'var(--line)'}`, background: 'rgba(255,255,255,0.06)', color: 'var(--text)', fontSize: 16, fontFamily: 'var(--num)' }}
              />
              <span className="muted">km/h</span>
            </label>
          )}
          {hud.phase === 'setup' && beltInvalid && (
            <div style={{ fontSize: 12, color: 'var(--warn)' }}>
              時速{SPEED_FIT.kmhMin}〜{SPEED_FIT.kmhMax}kmの数字を入れてください（このままだと使いません）
            </div>
          )}
          <details>
            <summary>くわしく</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, fontSize: 12, lineHeight: 1.5 }} className="muted">
              {hud.phase === 'setup' && (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Chip ok={hud.framing === 'ok'} label="全身" />
                    <Chip ok={hud.checks.side} label={hud.checks.side ? '真横' : `真横（ずれ ${hud.checks.sideDeg}°）`} />
                    <Chip ok={hud.checks.light} label="明るさ" />
                  </div>
                  {hud.problem && <div style={{ color: 'var(--text)', fontSize: 14 }}>{hud.problem}</div>}
                  <div>そろうと、触らなくても次へ進みます{cameraLens === 'ultra' ? '（超広角）' : ''}。点線の間に頭から足まで入れてください</div>
                  {!file && <div>ベルトの速さは、入れるとよい例の範囲と足首のセンサーの速さをこの速さに合わせます。途中で変えるなら走り出しの速さを。前回の値を覚えています</div>}
                </>
              )}
              {hud.phase === 'baseline' && (
                <div>{hud.pose === 'b' ? '胸を開いて、肩を後ろに引いて、顎を軽く引いて止まります。' : ''}2つの立ち方の違いを、猫背の物差しにします。写真は残さず、骨格の角度だけを使います</div>
              )}
              {hud.phase === 'run' && <div>全身が映った状態で走り出すと、歩数を数えて約10秒で始まります。頭や足が切れていると数えられません</div>}
              <div>骨格：毎秒{hud.fps}コマ{hud.fps < WAIT.slowFps ? `（${WAIT.slowFps}コマより少ないと、走りを数えにくくなります）` : ''}</div>
            </div>
          </details>
        </div>
      )}

      {dark && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: 'var(--accent)' }} />
          <div style={{ fontFamily: 'var(--num)', fontSize: 15, letterSpacing: 4, color: 'var(--faint)' }}>{darkLabel}</div>
          <div style={{ fontSize: 13, color: 'var(--faint)' }}>{darkText}</div>
          {full && <FullBadge />}
          {hud.phase === 'run' && <div className="num" style={{ position: 'absolute', right: 24, top: 20, fontSize: 28, color: '#4A525B' }}>{mmss(hud.elapsed)}</div>}
          <button className="icon-btn" aria-label="終える" onClick={() => finishRef.current()} style={{ position: 'absolute', left: 16, top: 'max(16px, env(safe-area-inset-top))', opacity: 0.4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}

      {!dark && !preview && (
        <>
          {hud.phase === 'run' && (
            <div style={{ position: 'absolute', right: 16, top: 'max(16px, env(safe-area-inset-top))', textAlign: 'right' }}>
              <div className="num" style={{ fontSize: 56 }}>{mmss(hud.elapsed)}</div>
              <div style={{ fontSize: 13 }} className="muted">
                {hud.state === 'paused' ? '一時停止中' : hud.quiet ? '声なしで確認中' : ''}
              </div>
            </div>
          )}

          {hud.phase === 'run' && last && (
            <div style={{ position: 'absolute', left: 16, top: 80, display: 'flex', flexDirection: 'column', gap: 8, width: 140 }}>
              {(
                [
                  ['頭と背中', last.head, overCue('head', judged(last, 'head'))],
                  ['体幹の前傾', last.trunk, overCue('trunk', judged(last, 'trunk')) || overCue('trunkBack', judged(last, 'trunkBack'))],
                  ['体全体の前傾', last.body, overCue('body', judged(last, 'body')) || overCue('bodyBack', judged(last, 'bodyBack'))],
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

          {last && hud.phase === 'run' && !hud.quiet && ITEM_KEYS.some((k) => overCue(k, judged(last, k))) && (
            <div style={{ position: 'absolute', right: 16, top: 110 }}>
              <div style={{ padding: '8px 14px', borderRadius: 20, background: 'var(--warn)', color: '#0A0C0E', fontSize: 14, fontWeight: 900 }}>
                {ITEM_TEXT[ITEM_KEYS.find((k) => overCue(k, judged(last, k)))!]}
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

// 全コマ記録のときの小さな印（画面が暗いときも見える色で）
function FullBadge() {
  return <div style={{ padding: '2px 8px', borderRadius: 10, border: '1px solid #4A525B', fontSize: 11, color: '#8A939C' }}>全コマ記録</div>
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 16, background: ok ? 'rgba(200,240,60,0.16)' : 'rgba(255,138,61,0.16)', border: `1px solid ${ok ? 'var(--accent)' : 'var(--warn)'}`, fontSize: 13, fontWeight: 700, color: ok ? 'var(--accent)' : 'var(--warn)' }}>
      {ok ? '✓' : '・'} {label}
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
