import { useEffect, useRef, useState } from 'react'
import { RUNNING } from '../../../core/params'
import { BASELINE, CORRECT, FRAME_SAY, SETUP, WAIT } from '../params'
import { ITEM_KEYS, type Baseline, type Frame, type ItemKey, type Sample, type Session } from '../../../core/types'
import type { Measure, StandA } from '../types'
import { Coach, judged, type CoachEvent, type CoachState } from '../coach'
import { facing, levelFrame, measure, nearSide, rotateFrame, sideOffDeg, yawSign } from '../geometry'
import { worldAngles, type P3 } from '../world'
import { MotionDetector, bodyVisible } from '../motion'
import { L } from '../landmarks'
import { headCircle } from '../ui/head'
import { framing, FramingVoice, FramingWindow, FRAMING_TEXT, EDGE, type FramePhase, type Framing } from '../framing'
import { overCue } from '../scoring'
import { gravityAvailable, gravityPitch, gravityRoll, phoneStillSec } from '../gravity'
import { queueUpload } from '../../../core/upload/uploads'
import { loadBaselines, loadProgress, loadSettings, persistStorage, saveBaseline, saveProgress, saveSession, writeLogChunk } from '../../../core/storage'
import { LOG_CHUNK, LogSaver } from '../../../core/logChunks'
import { activeItems, afterRun } from '../../../core/level'
import { todayFocus } from '../nextStep'
import { LogRecorder } from '../log'
import { preloadVoice, speak, stopVoice, voicePending } from '../../../core/voice'
import { PHRASES, SAY } from '../../../core/phrases'
import { capBaseline, median, standingIssue, type Standing, type StandingIssue } from '../standing'
import { cameraLens, loadLandmarker, openCamera, runPose } from '../pose/detector'
import { fullFrames } from '../fullFrames'
import { SensorRunner } from '../../sensor/runner'
import { sensors } from '../../sensor/ble'
import { POSE, SPEED_FIT } from '../../sensor/params'
import { fitSpeedA, saveSpeedFit } from '../../sensor/speedFit'
import { loadBeltText, parseKmh, runSpeedOf, saveBeltText } from '../belt'
import { YAW_PHRASE, faceOf, yawArrowDir, yawHint, yawInside, yawOffDeg, yawSideOf, type ArrowDir, type YawLevel } from '../yawGuide'

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
  yawDeg: number | null // 置く間の、真横からのずれの目安（度。前側が正。yawGuide.ts）。測れないときは null
  yawOk: boolean // 真横の線の内側か（入るときと出るときで線が違う）
  yawArrow: { dir: ArrowDir; level: YawLevel } | null // 置く間に、真横の案内を出しているとき、スマホを動かす向き（画面の左右。yawGuide.ts の yawArrowDir）
  yawDone: boolean // 矢印や真横の案内のあとで真横に入った直後（緑の印を短く出す）
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
  [PHRASES.guideHead]: '頭が切れています（スマホを離す）',
  [PHRASES.guideFeet]: '足が切れています（スマホを離す）',
  [PHRASES.guideBoth]: '頭と足が切れています（スマホを離す）',
  [PHRASES.guideHidden]: '体の一部が見えていません',
  [PHRASES.guideNear]: '体が小さすぎます（スマホを近づける）',
  [PHRASES.guideTiltDown]: 'スマホが下を向いています',
  [PHRASES.guideTiltUp]: 'スマホが上を向いています',
  [PHRASES.guideHigh]: 'スマホが高すぎます（腰の高さへ）',
  [PHRASES.guideLow]: 'スマホが低すぎます（腰の高さへ）',
  [PHRASES.guideSide]: '体の横をスマホに向けてください',
  [PHRASES.guideFrontFar]: 'スマホが真横より前（後ろへ大きく動かす）',
  [PHRASES.guideFront]: 'スマホが真横より少し前（後ろへ少し動かす）',
  [PHRASES.guideFrontNear]: 'あと少し（スマホを後ろへほんの少し）',
  [PHRASES.guideBehindFar]: 'スマホが真横より後ろ（前へ大きく動かす）',
  [PHRASES.guideBehind]: 'スマホが真横より少し後ろ（前へ少し動かす）',
  [PHRASES.guideBehindNear]: 'あと少し（スマホを前へほんの少し）',
}

// 体の映り方ごとの声（framing.ts）。置く間は、どう直すかまで言う。2つの立ち方・走り出しを待つ・走っている間は、
// 本人はトレッドミルの上にいるので起きていることだけを言い、映っていないときは走っている間と同じ「画面から外れました…」
const SETUP_PHRASE: Record<Exclude<Framing, 'ok'>, string> = {
  none: PHRASES.guideNone,
  head: PHRASES.guideHead,
  feet: PHRASES.guideFeet,
  both: PHRASES.guideBoth,
  hidden: PHRASES.guideHidden,
}
const FRAME_PHRASE: Record<Framing, string> = {
  ok: PHRASES.bodyIn,
  none: SAY.lost,
  head: PHRASES.frameHead,
  feet: PHRASES.frameFeet,
  both: PHRASES.frameBoth,
  hidden: PHRASES.frameHidden,
}
// 置く間に、全身が入ったかを確かめている（FRAME_SAY.okHold 秒）あいだの画面の1行。声にはしない
const CHECKING = '全身が入ったか確かめています'
// 走っている間に「終える」を1回押してから、もう一度押せば終わる間（ミリ秒）
const END_CONFIRM_MS = 4000

// sessions：これまでの走り（新しい順）。走り出す前に言う「今日意識するのは…」を、ホームの「今日の意識」と同じ1つにするため
export function Live({ video: file, sessions = [], onDone }: { video?: File; sessions?: Session[]; onDone: (id?: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const coachRef = useRef<Coach | null>(null)
  const finishRef = useRef<() => void>(() => {})
  const [confirmEnd, setConfirmEnd] = useState(false) // 走っている間に終えるを1回押した（もう一度押すと終わる）
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])
  const screenMode = loadSettings().screen
  // 前面カメラは鏡のように左右反転して見せる（骨格の計算は反転しない元の映像で行う）
  const mirror = !file && loadSettings().camera === 'front'
  // 検証用の「全コマ記録」（URL に ?full=1）。走っている間も間引かず毎コマ骨格を取る。動画で試すときはもともと毎コマ取る
  const full = !file && fullFrames()
  const [hud, setHud] = useState<Hud>({ phase: 'loading', state: 'waiting', caption: '', elapsed: 0, quiet: false, scores: [], checks: { body: false, side: false, sideDeg: 90, light: true }, framing: 'none', fps: 0, slow: false, yawDeg: null, yawOk: false, yawArrow: null, yawDone: false })
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
    let standA: StandA | null = null // a のときの頭の位置・首・腰の高さ（Coach に渡す。そこからの差を記録するだけ。params.ts の STAND_REF）
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
    // v：前側・後ろ側の値（yawSign）。f：顔の向き（元の映像で右 +1・左 −1。鼻と耳が見えないコマは 0）
    let yawHist: { t: number; v: number; f: number }[] = []
    let yawIn = false // 真横の線の内側か（yawGuide.ts の yawInside。入る線と出る線が違う）
    let yawDeg: number | null = null // 真横からのずれの目安（度、前側が正）。測れないときは null
    let yawGuided = false // 真横の案内を言ったあと、まだ真横に入っていない（入ったら「真横になりました」と言う）
    let yawArrow: Hud['yawArrow'] = null // 画面に出す、スマホを動かす向きの矢印（置く間だけ）
    let yawArrowShown = false // 矢印を出したあと、まだ真横に入っていない
    let yawDoneAt = -Infinity // 真横に入ったと画面に出した時刻
    let firstSaid = false
    let lastPresent = true
    let lastMoving = false
    let lastNextSay = 0 // 次に何をすればいいかを最後に言った時刻
    // 体が画面にどう収まっているか（framing.ts）。画面に出すのは直近1秒でならしたもの、
    // 走り出すのを待つ間に理由を言うのは直近 WAIT.window 秒でならしたもの（骨格を取ったコマだけを入れるので、コマ数も分かる）
    const shown = new FramingWindow(1)
    const waitWin = new FramingWindow(WAIT.window)
    // 映り方が変わったら声で言う見張り（framing.ts の FramingVoice。数字は params.ts の FRAME_SAY）。「全身が入りました」もここで確かめる
    const framer = new FramingVoice()
    let lastFraming: Framing = 'none' // いちばん新しいコマの映り方（走っている間、切れていれば間引かずに見るため）

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
    // 全身が入ってから見ること（暗さと、全身が入っているかは、呼ぶ前に見る）。
    // yawOff：真横からのずれの目安（度。前側が正。SETUP.yawSmooth 秒でならした値から。測れないときは null）
    const guide = (frame: Frame, w: number, h: number, sideDeg: number, yawOff: number | null): string | null => {
      // 小さく映っていると膝や足首の点がぶれて、走り出しや角度が取れない。画面の高さの4割はほしい
      if (bodySpan(frame, h) < SPAN_MIN) return PHRASES.guideNear
      // スマホが下を向いている・高すぎる・体の後ろ側から撮っている：着地の角度などが大きくずれるので直してもらう
      const pitch = !file && gravityAvailable() ? gravityPitch() : 0
      if (pitch > SETUP.pitchDownMax) return PHRASES.guideTiltDown
      // 上向きも同じ角度で言う（上向きのときは高さの確かめもしないため、言わないと見上げたまま進んでしまう。角度は下向きと同じにした仮の値）
      if (pitch < -SETUP.pitchDownMax) return PHRASES.guideTiltUp
      const hipY = (frame[L.leftHip].y + frame[L.rightHip].y) / 2 / h
      if (Math.abs(pitch) <= SETUP.pitchDownMax && hipY > SETUP.hipLowMax) return PHRASES.guideHigh
      if (Math.abs(pitch) <= SETUP.pitchDownMax && hipY < SETUP.hipHighMin) return PHRASES.guideLow
      // 体がスマホのほうを向いているときは、まず横を向いてもらう（前側・後ろ側の値は、横を向いていないと当てにならない）
      if (sideDeg > 20) return PHRASES.guideSide
      // 真横から約5°以内に置いてもらう（一度入ったら8°まで）。頭の位置は、前側に15°ずれるだけで +11° ずれて測れる（params.ts の SETUP）。
      // どちらへ・どれくらいずらすかまで言う（yawGuide.ts）
      const yh = yawOff === null ? null : yawHint(yawOff, yawIn)
      if (yh) return YAW_PHRASE[yh.side][yh.level]
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
        // 走っている間は、コーチが要ると言ったときだけ骨格を取る（人が見えなくなった・頭や足が切れたら毎コマ取って探す。映り方の声が続いたかを数えるため）。全コマ記録のときは毎コマ
        const want = () => !!file || full || phase !== 'run' || !coachRef.current || !lastPresent || lastFraming !== 'ok' || coachRef.current.wantsDetail()
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
        if (e.type === 'speak' && e.text === SAY.lost) {
          // 走っている間に骨格が見えなくなって ABSENCE.lostSay 秒（声かけのしくみが言う）。頭や足が切れていると分かればそれを言い、
          // 映り方の声（FramingVoice）が同じことを少し前に言っていれば、重ねない
          const now = shown.current()
          const f: Framing = framer.stable !== 'ok' ? framer.stable : now !== 'ok' ? now : 'none'
          if (framer.saidRecently(f, t)) rec.event(t, `frame:${f} lost skip`)
          else {
            say(FRAME_PHRASE[f], t)
            framer.said(f, t)
          }
          continue
        }
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
      lastFraming = fr
      // 置く間は、スマホを手に持っている間（動く映像を人と見間違えることがある）を「映っていない」として数える
      const placed = !!file || phoneStillSec() > SETUP.phoneStill
      const coachNow = coachRef.current
      framer.phase = framePhaseOf(phase, coachNow?.state)
      framer.push(t, phase === 'setup' && !placed ? 'none' : fr, raw)
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
        // 手に持っている間は判定しない（動く映像を人と見間違えることがある）。置いて1.5秒静止してから見る（placed）
        // 全身が入っている（full）：いまのコマまで、全身が入って人の体の形らしいのが FRAME_SAY.okHold 秒続いた（framing.ts の FramingVoice）。
        // 一瞬の見間違い・人が画面から消えたコマ・頭や足が画面のふちから出ているコマでは、全身が入ったとしない
        const full = placed && framer.okNow
        if (frame && visible) {
          const seeFace = frame[L.nose].v > 0.5 && Math.max(frame[L.leftEar].v, frame[L.rightEar].v) > 0.5
          yawHist.push({ t, v: yawSign(frame), f: seeFace ? facing(frame) : 0 })
        }
        yawHist = yawHist.filter((x) => t - x.t <= SETUP.yawSmooth)
        // 真横からのずれは、全身が入って体の横がスマホに向いているときだけ見る（正面を向いていると、前側・後ろ側の値は当てにならない）。
        // 測れない間は内側の印を外す（また入るときは yawIn 度から）
        const wasIn = yawIn
        yawDeg = full && sideDeg <= 20 && yawHist.length ? yawOffDeg(yawHist.reduce((a, x) => a + x.v, 0) / yawHist.length) : null
        yawIn = yawDeg !== null && yawInside(yawDeg, yawIn)
        // 真横の案内のあとで真横に入ったら、そう言う（そのまま動かさないでほしいので）。全身が入ったと言うのと同じく、置き方がそろう前に言う
        if (yawIn && !wasIn && (yawGuided || yawArrowShown)) {
          yawDoneAt = t
          yawArrowShown = false
        }
        if (yawIn && !wasIn && yawGuided && setupAt !== null && t - setupAt >= SETUP.talkAfter) {
          say(PHRASES.guideSideOk, t)
          lastGuide = t
          lastSaid = PHRASES.guideSideOk
          yawGuided = false
        }
        // 全身が入るまでは、何が足りないか（体が映っていない・頭・足・両方が切れている・体の一部が見えていない）を言い分ける。
        // 直近1秒でならした映り方が全身なら、確かめ終わるまで（FRAME_SAY.okHold 秒）黙って待つ
        const cut = shown.current()
        const checking = placed && lastLight && !full && cut === 'ok'
        const hint = !placed ? null : !lastLight ? PHRASES.guideDark : full ? guide(frame!, w, h, sideDeg, yawDeg) : cut === 'ok' ? null : SETUP_PHRASE[cut]
        // 真横の案内を出しているときは、画面にもスマホを動かす向きを大きな矢印で出す（声と同じ向き・大きさ）。
        // 走る人の顔の向きがそろって分からないときは出さない（逆を指すと外れた案内になる。声とメーターだけ）
        const yh = yawSideOf(hint) && yawDeg !== null ? yawHint(yawDeg, yawIn) : null
        const arrowDir = yh ? yawArrowDir(yh.side, faceOf(yawHist.filter((x) => x.f !== 0).map((x) => x.f)), mirror) : null
        yawArrow = yh && arrowDir ? { dir: arrowDir, level: yh.level } : null
        if (yawArrow) yawArrowShown = true
        // 真横に向ける・前後に寄る案内は、声で言うだけで進むのを止めない（真横は sideMax で見る）
        const blocking = hint !== null && hint !== PHRASES.guideSide && hint !== PHRASES.guideForward && hint !== PHRASES.guideBack
        const ready = full && lastLight && sideDeg <= SETUP.sideMax && !blocking
        lastProblem = ready ? null : !placed ? PHRASES.placeStart : checking ? CHECKING : hint === PHRASES.guideForward || hint === PHRASES.guideBack || !hint ? PHRASES.guideSide : hint
        // 開いてすぐは話さない（スマホを置いて離れるまでの間）
        setupAt ??= t
        const talk = t - setupAt >= SETUP.talkAfter
        if (ready) {
          notReadySince = null
          okSince ??= t
          if (t - okSince > SETUP.readyHold && talk) {
            // 次に何をすればいいかまで、続けて声で言う（画面は見えない前提）。
            // 「全身が入りました」を少し前に言っていれば、「見えています。全身が入りました。」は重ねない
            lastNextSay = t
            if (!framer.saidRecently('ok', t, FRAME_SAY.repeat)) say(PHRASES.placeOk, t)
            framer.said('ok', t)
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
          // 離れていて画面が見えなくても分かるよう、全身が入ったら声で知らせる（切れている・映っていないと言ったあとも、また言う）
          if (talk && full && framer.lastSaid?.f !== 'ok') {
            say(PHRASES.bodyIn, t)
            framer.said('ok', t)
            lastGuide = t
          }
          let msg = lastProblem ?? PHRASES.guideNone
          if (!placed || (!firstSaid && msg === PHRASES.guideNone)) msg = PHRASES.placeStart
          // 真横の案内は、向きが同じなら「大きく／少し／あと少し」が変わっても同じ案内として扱う（線の際で言葉が替わるたびに言い直さない）
          const side = yawSideOf(msg)
          if (msg !== hintMsg && !(side && side === yawSideOf(hintMsg))) hintSince = t
          hintMsg = msg
          // 同じ案内が1.2秒続いてから言う。変わったら言い直し、同じなら6秒ごとに繰り返す（言うときは、いまの大きさの言葉で）
          // 「置いてください」のあとの「まだ体が映っていません」は、同じ案内として扱う。全身を確かめている間は言わない
          const same = msg === lastSaid || (msg === PHRASES.guideNone && lastSaid === PHRASES.placeStart) || (!!side && side === yawSideOf(lastSaid))
          if (talk && msg !== CHECKING && t - hintSince >= SETUP.hintStable && t - lastGuide > (same ? SETUP.hintRepeat : 1.5)) {
            say(msg, t)
            lastGuide = t
            lastSaid = msg
            firstSaid = true
            if (side) yawGuided = true
            // 映り方の案内なら、映り方の見張りにも言ったと知らせる（次の場面で、また全身が入ったと言うため）
            const said = (Object.keys(SETUP_PHRASE) as Exclude<Framing, 'ok'>[]).find((k) => SETUP_PHRASE[k] === msg)
            if (said) framer.said(said, t)
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
            // 腰の高さ（hip）：腰の中心 → 低いほうの足首の高さ ÷ 脚の長さ（hipRatio）の真ん中。立った姿勢 a からの腰の下がりを記録するため（STAND_REF）
            const hips = baseHips.filter((x) => x > 0)
            const hipSt = hips.length ? median(hips) : undefined
            rec.event(t, `pose:${poseStage} head ${st.head.toFixed(1)} trunk ${st.trunk.toFixed(1)} neck ${median(baseNecks).toFixed(1)} headLean ${median(baseLeans).toFixed(1)} yaw ${median(baseYaws).toFixed(3)}${hipSt !== undefined ? ` hip ${hipSt.toFixed(3)}` : ''}`)
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
              standA = { headLean: median(baseLeans), neck: median(baseNecks), ...(hipSt !== undefined ? { hip: hipSt } : {}) }
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
      // 体が映っていない・体の一部が見えていない（骨格の角度が取れない）間は言い直さず、映り方の声に任せる（言い直した回数にも数えない）
      if (phase === 'baseline' && framer.stable !== 'none' && framer.stable !== 'hidden' && t - lastNextSay > BASELINE.repeat) {
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
        if (baseline && !coachRef.current) coachRef.current = new Coach({ pause: RUNNING.pauseEnabled, items: activeItems(progress.step), level: progress.level, kmh: beltRef.current, open: openPose, stand: standA })
        const coach = coachRef.current
        // 走り出すのを待っている間は、黙ったままにしない。
        // 走りの始まりは、全身が見えたコマだけで歩数を数える（coach.ts の RunningGate）ので、体が入っていない・頭や足が切れているなら、
        // 「走り出すと始まります」ではなく、それを言う（映り方の声と同じ言葉。映り方の声が少し前に言っていれば重ねない）。
        // 確かめた映り方（framer.stable）が全身でも、直近 WAIT.window 秒で全身のコマが WAIT.seenMin を切っていれば（出たり入ったり）、多かった理由を言う。
        // 記録には、そのときの見え方とコマ数を残す
        if (coach && coach.state === 'waiting' && t - lastNextSay > RUNNING.waitRepeat) {
          lastNextSay = t
          const why: Framing = framer.stable !== 'ok' ? framer.stable : waitWin.okRatio < WAIT.seenMin ? waitWin.current() : 'ok'
          rec.event(t, `wait:${why} ok ${waitWin.okRatio.toFixed(2)} fps ${waitWin.fps.toFixed(1)}`)
          if (why === 'ok') say(PHRASES.waitRun, t)
          else if (!framer.saidRecently(why, t)) {
            say(FRAME_PHRASE[why], t)
            framer.said(why, t)
          }
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

      // 映り方が変わったら言う（2つの立ち方・走り出しを待つ・走っている間。置く間は上の案内が言う）。
      // 走っている間に映っていないのは、声かけのしくみの「画面から外れました…」が言う（handle。ABSENCE.lostSay）
      if (!file && !finished && (phase === 'baseline' || phase === 'run') && coachRef.current?.state !== 'ended') {
        const f = framer.due(t)
        if (f && !(framer.phase === 'run' && f === 'none')) {
          rec.event(t, `frame:${f}`)
          say(FRAME_PHRASE[f], t)
          framer.said(f, t)
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
          yawDeg: phase === 'setup' && yawDeg !== null ? Math.round(yawDeg) : null,
          yawOk: yawIn,
          yawArrow: phase === 'setup' ? yawArrow : null,
          yawDone: phase === 'setup' && t - yawDoneAt < 1.5,
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
  const darkText = hud.state === 'paused' ? '一時停止中' : hud.quiet ? '声なしで確認中' : '画面を消しても、声でお知らせします'
  // 終える：置く・立ち方・走り出しを待つ間は1回のタップで終える。走っている間（止まっている間も）は、ベルトの操作などで
  // 画面に触れて終わらないよう、1回目で「もう一度押すと終わります」にし、END_CONFIRM_MS の間にもう一度押したら終える。
  // センサーラン・腰スマホ（ポーチの中）の長押しとは違い、トレッドミルではスマホは台の上で、手を伸ばして1回で押せるほうがよい
  const running = hud.phase === 'run' && hud.state !== 'waiting'
  const onEnd = () => {
    if (!running || confirmEnd) {
      finishRef.current()
      return
    }
    setConfirmEnd(true)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmEnd(false), END_CONFIRM_MS)
  }
  const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const last = hud.last
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
      {/* 終えるボタンは、どの段階でもいちばん上に重ねる（z-index。.live-top）。走っている間は映像や数字の下に隠れて押せなかった */}
      <div className="live-top">
        <button className={confirmEnd ? 'end-btn confirm' : 'end-btn'} onClick={onEnd}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          {confirmEnd ? 'もう一度押すと終わります' : '終える'}
        </button>
        {full && !dark && <FullBadge />}
      </div>

      <div className="live-stage">
        <video ref={videoRef} playsInline muted style={{ opacity: dark ? 0 : 1, transform: mirror ? 'scaleX(-1)' : undefined }} />
        <canvas ref={canvasRef} style={{ opacity: dark ? 0 : 1, transform: mirror ? 'scaleX(-1)' : undefined }} />
        {hud.phase === 'setup' && hud.framing === 'ok' && (hud.yawArrow ? <YawArrow dir={hud.yawArrow.dir} level={hud.yawArrow.level} /> : hud.yawDone ? <YawDone /> : null)}
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
          {hud.phase === 'setup' && hud.framing === 'ok' && hud.yawDeg !== null && <YawMeter deg={hud.yawDeg} ok={hud.yawOk} />}
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
          <div style={{ fontSize: 13, color: 'var(--faint)' }}>{darkText}</div>
          {full && <FullBadge />}
          {hud.phase === 'run' && <div className="num" style={{ position: 'absolute', right: 24, top: 20, fontSize: 28, color: '#4A525B' }}>{mmss(hud.elapsed)}</div>}
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

// 映り方の声の場面（framing.ts の FramePhase）
function framePhaseOf(phase: Phase, state?: CoachState): FramePhase {
  if (phase === 'baseline') return 'pose'
  if (phase === 'run') return !state || state === 'waiting' ? 'wait' : 'run'
  return 'setup'
}

// 全コマ記録のときの小さな印（画面が暗いときも見える色で）
function FullBadge() {
  return <div style={{ padding: '2px 8px', borderRadius: 10, border: '1px solid #4A525B', fontSize: 11, color: '#8A939C' }}>全コマ記録</div>
}

// 置く間の、真横からのずれのメーター（yawGuide.ts）。真ん中が真横、右へ行くほど前側から、左へ行くほど後ろ側から撮っている。
// 緑の帯が真横の線（SETUP.yawIn 度以内）。数字は目安（人により約3°ちがう。params.ts の SETUP）
const YAW_SPAN = 20
function YawMeter({ deg, ok }: { deg: number; ok: boolean }) {
  const pos = (d: number) => 50 + (Math.max(-YAW_SPAN, Math.min(YAW_SPAN, d)) / YAW_SPAN) * 50
  const color = ok ? 'var(--accent)' : 'var(--warn)'
  const a = Math.abs(deg)
  const text = ok ? '真横です' : `スマホが真横より約${a}°${deg > 0 ? '前（後ろへ動かす）' : '後ろ（前へ動かす）'}`
  return (
    <div aria-label={`真横からのずれ：${text}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ color, fontWeight: 700, fontSize: 13 }}>
        {text}
      </div>
      <div style={{ position: 'relative', height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.08)', border: '1px solid var(--line)' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos(-SETUP.yawIn)}%`, width: `${pos(SETUP.yawIn) - pos(-SETUP.yawIn)}%`, background: 'rgba(200,240,60,0.22)' }} />
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: '50%', width: 1, background: 'var(--accent)' }} />
        <div style={{ position: 'absolute', top: 1, width: 10, height: 10, marginLeft: -5, borderRadius: 5, left: `${pos(deg)}%`, background: color, transition: 'left 0.25s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }} className="muted">
        <span>スマホが後ろ</span>
        <span>真横</span>
        <span>スマホが前</span>
      </div>
    </div>
  )
}

// 置く間の、スマホを動かす向きの大きな矢印（映像の上に重ねる。押せない）。向きは画面の左右（yawGuide.ts の yawArrowDir）。
// 大きさは声と同じ3段：大きく（far）は矢じりを2つ、少し（mid）は長い矢印、あと少し（near）は短い矢印。ゆっくり点滅（動きを減らす設定なら点滅しない。index.css の .yaw-arrow）
function YawArrow({ dir, level }: { dir: ArrowDir; level: YawLevel }) {
  // viewBox は 横 0〜200・縦 0〜100。右向きに描いて、左は裏返す。1つの矢印は真ん中にそろえる（長さ：少し 180、あと少し 120）
  const len = level === 'near' ? 120 : 180
  const tail = (200 - len) / 2
  const tip = tail + len
  const head = (x: number) => `M${x - 50} 10 L${x} 50 L${x - 50} 90 L${x - 50} 72 L${x - 22} 50 L${x - 50} 28 Z`
  return (
    <div className="yaw-arrow" aria-label={`スマホを画面の${dir === 'left' ? '左' : '右'}へ動かす`}>
      <svg viewBox="0 0 200 100" style={{ transform: dir === 'left' ? 'scaleX(-1)' : undefined }} aria-hidden="true">
        <g fill="#FF8A3D" stroke="#0A0C0E" strokeWidth="4" strokeLinejoin="round">
          {level === 'far' ? (
            <>
              <path d={`M10 38 H100 V62 H10 Z`} />
              <path d={head(140)} />
              <path d={head(190)} />
            </>
          ) : (
            <path d={`M${tail} 36 H${tip - 40} V10 L${tip} 50 L${tip - 40} 90 V64 H${tail} Z`} />
          )}
        </g>
      </svg>
      <div className="yaw-arrow-label">{dir === 'left' ? '← ' : ''}スマホをこちらへ{dir === 'right' ? ' →' : ''}</div>
    </div>
  )
}

// 矢印や真横の案内のあとで真横に入った直後に、短く出す緑の印
function YawDone() {
  return (
    <div className="yaw-arrow done" role="status">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" fill="#C8F03C" stroke="#0A0C0E" strokeWidth="4" />
        <path d="M28 52 L44 68 L74 36" fill="none" stroke="#0A0C0E" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="yaw-arrow-label">真横です</div>
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
