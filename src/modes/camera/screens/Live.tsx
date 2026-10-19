import { useEffect, useRef, useState } from 'react'
import { RUNNING } from '../../../core/params'
import { BASELINE, CORRECT, SETUP } from '../params'
import type { Baseline, Frame, ItemKey, Sample } from '../../../core/types'
import type { Measure } from '../types'
import { Coach, judged, type CoachEvent, type CoachState } from '../coach'
import { facing, levelFrame, measure, rotateFrame, sideOffDeg, yawSign } from '../geometry'
import { MotionDetector, bodyVisible } from '../motion'
import { L } from '../landmarks'
import { overCue } from '../scoring'
import { gravityAvailable, gravityPitch, gravityRoll, phoneStillSec } from '../gravity'
import { queueUpload } from '../../../core/upload/uploads'
import { loadBaselines, loadProgress, loadSettings, saveBaseline, saveLog, saveProgress, saveSession } from '../../../core/storage'
import { activeItems, afterRun, startPhrase } from '../../../core/level'
import { LogRecorder } from '../log'
import { preloadVoice, speak, stopVoice } from '../../../core/voice'
import { PHRASES } from '../../../core/phrases'
import { capBaseline, median, standingIssue, type Standing, type StandingIssue } from '../standing'
import { cameraLens, loadLandmarker, openCamera, runPose } from '../pose/detector'
import { fullFrames } from '../fullFrames'

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
}

// 頭から足までが画面の高さの何割か。超広角で 1m 前後なら約6割、3m だと約2割
const SPAN_MIN = SETUP.spanMin
const bodySpan = (f: Frame, h: number) => (Math.max(f[L.leftAnkle].y, f[L.rightAnkle].y, f[L.leftHeel].y, f[L.rightHeel].y) - f[L.nose].y) / h

const ITEM_TEXT: Record<ItemKey, string> = { head: '頭が前に出ています', trunk: '上体が倒れすぎています', body: '体が倒れすぎています', hip: '腰が落ちています' }

export function Live({ video: file, onDone }: { video?: File; onDone: (id?: string) => void }) {
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
    // 直立の基準は毎回取る（その日の置き方のずれも消え、姿勢がよくなればそれについていく）
    let baseline: Baseline | null = null
    const motion = new MotionDetector()
    let okSince: number | null = null
    let notReadySince: number | null = null
    let lastGuide = 0
    let stillSince: number | null = null
    let baseNecks: number[] = []
    let baseMovingSince: number | null = null
    let baseStands: Standing[] = []
    let baseTries = 0 // 立ち姿勢を直してもらった回数
    let standing: { head: number; trunk: number; issue: StandingIssue | null } | undefined
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

    // 調整用の記録（骨格の点と判定の数字）。カメラで撮るときは、スマホ版の記録と時刻を合わせられるよう、時計の対応を残す
    const rec = new LogRecorder(file ? undefined : { perfMs: performance.now(), epochMs: Date.now() })
    if (full || file) rec.log.full = true
    let nowT = 0
    let tickMoving = false
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

    // ランナーのレベルと、今日注意する項目（走り終わったら、続いて声がかからなかったかで次の段階へ）
    const progress = loadProgress()

    const finish = async () => {
      if (finished) return
      finished = true
      const coach = coachRef.current
      if (coach && coach.samples.length >= 30) {
        const s = coach.finish()
        s.taps = tapsRef.current
        s.provisionalBaseline = !!file
        s.standing = standing
        s.logId = rec.log.id
        s.focus = { level: progress.level, step: progress.step }
        rec.log.sessionId = s.id
        await saveSession(s)
        saveProgress(afterRun(progress, s))
        await saveLog(rec.log).catch(() => {})
        queueUpload('camera', rec.log.id, rec.log.startedAt)
        onDone(s.id)
      } else {
        // 走りが始まらなかったときこそ調整に使うので、記録は残す
        await saveLog(rec.log).catch(() => {})
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
          (tick) => (tick.skipped ? onSkip(tick.t) : onTick(tick.frame, tick.t, tick.width, tick.height)),
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

    const onTick = (raw: Frame | null, t: number, w: number, h: number) => {
      nowT = t
      tickMoving = false
      // スマホの傾きを直す：左右の傾きを戻し、下を向いているとき（または大きく上を向いているとき）は上下の向きも戻す
      let frame = raw
      if (raw && !file && gravityAvailable()) {
        frame = rotateFrame(raw, gravityRoll(), w / 2, h / 2)
        const pitch = gravityPitch()
        if (pitch > CORRECT.pitchDownFrom || pitch < CORRECT.pitchUpFrom) frame = levelFrame(frame, pitch, cameraLens === 'ultra' ? CORRECT.vfovUltra : CORRECT.vfovNormal, w, h)
      }
      const visible = !!frame && bodyVisible(frame, 0.5, h)
      const m: Measure | undefined = visible ? measure(frame!) : undefined
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
        const hint = placed ? guide(present ? frame : null, w, h, sideDeg, yaw, lastLight) : null
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
            say(PHRASES.baseStand, t)
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
        if (baseMovingSince !== null && t - baseMovingSince > BASELINE.movingTolerance) {
          stillSince = null
          baseNecks = []
          baseStands = []
        } else {
          stillSince ??= t
          const el = t - stillSince
          if (el > BASELINE.settle) {
            baseNecks.push(m.neck)
            baseStands.push({ head: m.neck + m.trunk, trunk: m.trunk })
          }
          const left = Math.max(1, Math.ceil(BASELINE.settle + BASELINE.collect - el))
          setHud((hh) => (hh.countdown === left ? hh : { ...hh, countdown: left }))
          if (el > BASELINE.settle + BASELINE.collect && baseNecks.length > 10) {
            // 猫背のチェック。崩れていたら1つだけ直し方を言って取り直す（2回まで。それでもだめならその姿勢で始める）
            const st = { head: median(baseStands.map((x) => x.head)), trunk: median(baseStands.map((x) => x.trunk)) }
            const issue = standingIssue(st)
            if (issue && baseTries < BASELINE.retries) {
              baseTries++
              say(issue === 'head' ? PHRASES.baseHead : PHRASES.baseBack, t)
              lastNextSay = t
              stillSince = null
              baseNecks = []
              baseStands = []
            } else {
              const today = median(baseNecks)
              const createdAt = Date.now()
              baseline = { neck: capBaseline(today, loadBaselines()), createdAt, ...st }
              saveBaseline({ neck: today, createdAt, ...st })
              standing = { ...st, issue }
              say(!issue ? PHRASES.baseGood : issue === 'head' ? PHRASES.baseHeadLeft : PHRASES.baseBackLeft, t)
              say(startPhrase(progress), t) // 今日意識すること（前の言葉のあとに続けて話す）
              lastNextSay = t
              setPhase('run')
            }
          }
        }
      }

      // 基準がなかなか取れないときは、立ち方をもう一度言う
      if (phase === 'baseline' && t - lastNextSay > BASELINE.repeat) {
        lastNextSay = t
        say(PHRASES.baseStand, t)
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
        if (baseline && !coachRef.current) coachRef.current = new Coach({ pause: RUNNING.pauseEnabled, items: activeItems(progress.step) }) // 検証中は一時停止を切っている（params.ts）
        const coach = coachRef.current
        // 走り出すのを待っている間は、黙ったままにしない
        if (coach && coach.state === 'waiting' && t - lastNextSay > RUNNING.waitRepeat) {
          lastNextSay = t
          say(PHRASES.waitRun, t)
        }
        if (coach) {
          handle(coach.update({ t, present: visible, moving, m, frame: visible ? frame! : undefined }), t)
          lastSample = coach.samples[coach.samples.length - 1]
          if (lastSample && !coach.quiet) {
            if (overCue('head', lastSample.head)) hot.add('head')
            if (overCue('trunk', judged(lastSample, 'trunk'))) hot.add('trunk')
            if (overCue('body', judged(lastSample, 'body'))) hot.add('body')
          }
        }
      }

      if (screenMode === 'show') draw(frame, w, h, hot)
      else draw(null, w, h, hot)

      if (rec.log.rows.length < 80000) {
        rec.frame(t, phase, w, h, frame, { visible, moving: tickMoving, by: motion.by, cadence: motion.cadence, m, sideDeg, still: phoneStillSec(), pitch: gravityPitch() })
      }
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
        saveLog(rec.log).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 背面カメラで画面は見えないので、置き方・基準・走行中のすべてで真っ暗にする（案内は声で行う）
  const dark = screenMode === 'dark' && (hud.phase === 'setup' || hud.phase === 'baseline' || hud.phase === 'run')
  const darkLabel = hud.phase === 'setup' ? 'SETUP' : hud.phase === 'baseline' ? 'BASELINE' : hud.state === 'paused' ? 'PAUSED' : hud.state === 'waiting' ? 'READY' : hud.quiet ? 'QUIET CHECK' : 'COACHING'
  const darkText =
    hud.phase === 'setup' ? '置き方を声で案内します' : hud.phase === 'baseline' ? 'まっすぐ立って、3秒止まってください' : hud.state === 'waiting' ? '走り出すと始まります' : hud.state === 'paused' ? '一時停止中' : '画面を消しても、声でお知らせします'
  const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const last = hud.last

  return (
    <div className="live">
      <video ref={videoRef} playsInline muted style={{ opacity: dark ? 0 : 1, transform: mirror ? 'scaleX(-1)' : undefined }} />
      <canvas ref={canvasRef} style={{ opacity: dark ? 0 : 1, transform: mirror ? 'scaleX(-1)' : undefined }} />

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

      {!dark && (
        <>
          <div style={{ position: 'absolute', left: 16, top: 'max(16px, env(safe-area-inset-top))', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="icon-btn" aria-label="終える" onClick={() => finishRef.current()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--accent)' }} />
            <div style={{ fontFamily: 'var(--num)', fontSize: 15, letterSpacing: 3 }} className="muted">
              {hud.phase === 'loading' || hud.phase === 'error' ? '' : hud.phase === 'setup' ? 'SETUP' : hud.phase === 'baseline' ? 'BASELINE' : hud.state === 'paused' ? 'PAUSED' : hud.quiet ? 'QUIET CHECK' : 'COACHING'}
            </div>
            {full && <FullBadge />}
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
                  ['体幹の前傾', last.trunk, overCue('trunk', judged(last, 'trunk'))],
                  ['体全体の前傾', last.body, overCue('body', judged(last, 'body'))],
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
            <>
              {/* 離れていても色で分かるよう、画面のふち全体を光らせる */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', border: `12px solid ${hud.checks.body ? 'var(--accent)' : 'var(--warn)'}`, opacity: 0.85 }} />
              <div style={{ position: 'absolute', left: 0, right: 0, top: 'max(70px, calc(env(safe-area-inset-top) + 60px))', display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ padding: '10px 22px', borderRadius: 20, background: hud.checks.body ? 'var(--accent)' : 'var(--warn)', color: '#0A0C0E', fontWeight: 900, fontSize: 34 }}>
                  {hud.checks.body ? '✓ 全身 OK' : '全身が入っていません'}
                </div>
              </div>
            </>
          )}
          {hud.phase === 'setup' && (
            <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'max(12px, env(safe-area-inset-bottom))', padding: '12px 14px', borderRadius: 18, background: 'rgba(10,12,14,0.82)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Chip ok={hud.checks.body} label="全身" />
                <Chip ok={hud.checks.side} label={hud.checks.side ? '真横' : `真横（ずれ ${hud.checks.sideDeg}°）`} />
                <Chip ok={hud.checks.light} label="明るさ" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.45 }}>{hud.problem ?? 'そろいました。このまま待つと次へ進みます。'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flexGrow: 1, fontSize: 12 }} className="muted">
                  3つそろうと、触らなくても自動で次へ進みます{cameraLens === 'ultra' ? '（超広角）' : ''}
                </div>
              </div>
            </div>
          )}

          {hud.phase === 'baseline' && (
            <div style={{ position: 'absolute', left: 12, right: 12, top: 'max(70px, calc(env(safe-area-inset-top) + 60px))', padding: '12px 16px', borderRadius: 18, background: 'rgba(10,12,14,0.78)', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div className="num" style={{ fontSize: 72, color: 'var(--accent)', width: 50, textAlign: 'center' }}>{Math.max(1, Math.min(3, hud.countdown ?? 3))}</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.4 }}>目線は正面に。上から吊られるように、まっすぐ立って3秒止まる</div>
                <div style={{ fontSize: 12 }} className="muted">初回だけ。写真は残さず、骨格の角度だけを使います</div>
              </div>
            </div>
          )}

          {hud.caption && hud.phase !== 'setup' && (
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

          {last && hud.phase === 'run' && !hud.quiet && (['head', 'trunk', 'body', 'hip'] as ItemKey[]).some((k) => overCue(k, judged(last, k))) && (
            <div style={{ position: 'absolute', right: 16, top: 110 }}>
              <div style={{ padding: '8px 14px', borderRadius: 20, background: 'var(--warn)', color: '#0A0C0E', fontSize: 14, fontWeight: 900 }}>
                {ITEM_TEXT[(['head', 'trunk', 'body', 'hip'] as ItemKey[]).find((k) => overCue(k, judged(last, k)))!]}
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
