import { PHRASES } from '../../core/phrases'
import type { NodeView } from './ble'
import { SENSOR_NOTICE, SENSOR_STALL } from './params'

// 付けているセンサーの途切れを見張る（カメラなしの走り：センサーランと腰スマホ。runner.ts が持つ）。BLE も画面も持たないので、テストで値を流して確かめられる。
//   走り出す前：付けているのにつながっていない場所（missingAtStart）。センサーランは声で言う（立ち方の案内の前に）
//   走っている間：値が SENSOR_STALL.sec 秒より来なければ途切れ（切れた・固まったを分けない）。SENSOR_NOTICE.after 秒続いたら「切れました」を1回、
//     そのあと値が来たら「戻りました」を1回（言ったときだけ）。すぐ戻った途切れは言わない（記録には数える）
//   結果の画面のため：場所ごとの途切れの回数と、合わせた秒（summary）、この走りで値が1つも来なかった場所
// アプリが止まっていた（画面が消えた・裏に回った。runner.ts の sensor:gap）間は、値が来ないのはセンサーのせいではないので数えない（appGap）

// 場所ごとの言葉（音声は決まった文で前もって作るので、場所ごとに1つずつ。core/phrases.ts）。ない場所は同じ形の文（端末の読み上げで話す）
const SAY: Record<string, { missing: string; lost: string; back: string }> = {
  頭: { missing: PHRASES.sensorMissingHead, lost: PHRASES.sensorLostHead, back: PHRASES.sensorBackHead },
  胸: { missing: PHRASES.sensorMissingChest, lost: PHRASES.sensorLostChest, back: PHRASES.sensorBackChest },
  左手首: { missing: PHRASES.sensorMissingWristL, lost: PHRASES.sensorLostWristL, back: PHRASES.sensorBackWristL },
  右手首: { missing: PHRASES.sensorMissingWristR, lost: PHRASES.sensorLostWristR, back: PHRASES.sensorBackWristR },
  左足首: { missing: PHRASES.sensorMissingAnkleL, lost: PHRASES.sensorLostAnkleL, back: PHRASES.sensorBackAnkleL },
  右足首: { missing: PHRASES.sensorMissingAnkleR, lost: PHRASES.sensorLostAnkleR, back: PHRASES.sensorBackAnkleR },
}
export const noticeText = (place: string, kind: 'missing' | 'lost' | 'back') =>
  SAY[place]?.[kind] ?? `${place}のセンサーが${kind === 'missing' ? 'つながっていません' : kind === 'lost' ? '切れました' : '戻りました'}。`

// 結果の画面に出す、場所ごとの途切れ（n：回数、sec：合わせた秒）
export type SensorDrop = { place: string; n: number; sec: number }

export class SensorWatch {
  readonly missingAtStart: string[] // 走り始めに、付けているのにつながっていなかった場所
  private readonly places: (string | null)[] // 付けている（名前のある）枠の場所。付けていない枠は null
  private last: (number | null)[] // 最後に値が来た t（まだ来ていなければ null。走り始めにつながっていた場所は、走り始めの t）
  private since: (number | null)[] // 途切れ始めた t（途切れていなければ null）
  private told: boolean[] // いまの途切れで「切れました」を言った
  private seen: boolean[] // この走りで値が1つでも来た
  private drops: { n: number; sec: number }[]

  constructor(views: readonly Pick<NodeView, 'place' | 'name' | 'status'>[], t0: number) {
    this.places = views.map((v) => (v.name ? v.place : null))
    this.missingAtStart = views.filter((v) => v.name && v.status !== 'connected').map((v) => v.place)
    this.last = views.map((v) => (v.name && v.status === 'connected' ? t0 : null))
    this.since = views.map(() => null)
    this.told = views.map(() => false)
    this.seen = views.map(() => false)
    this.drops = views.map(() => ({ n: 0, sec: 0 }))
  }

  // 値が届いた。途切れていて「切れました」を言っていたら、「戻りました」の文を返す
  packet(node: number, t: number): string | null {
    if (node < 0 || node >= this.last.length || !this.places[node]) return null
    let say: string | null = null
    const s = this.since[node]
    if (s !== null) {
      this.drops[node].n++
      this.drops[node].sec += t - s
      if (this.told[node]) say = noticeText(this.places[node]!, 'back')
      this.since[node] = null
      this.told[node] = false
    }
    this.last[node] = t
    this.seen[node] = true
    return say
  }

  // tick ごと。いま言う「切れました」の文を返す（途切れが SENSOR_NOTICE.after 秒続いた場所。1回の途切れに1回）
  tick(t: number): string[] {
    const out: string[] = []
    this.last.forEach((last, i) => {
      const place = this.places[i]
      if (!place || last === null) return
      if (this.since[i] === null && t - last > SENSOR_STALL.sec) this.since[i] = last
      const s = this.since[i]
      if (s !== null && !this.told[i] && t - s >= SENSOR_NOTICE.after) {
        this.told[i] = true
        out.push(noticeText(place, 'lost'))
      }
    })
    return out
  }

  // アプリが止まっていた（t まで）：その間は値を受け取れないので、途切れていない場所は t から数え直す
  appGap(t: number) {
    this.last.forEach((last, i) => {
      if (last !== null && this.since[i] === null) this.last[i] = t
    })
  }

  // 結果の画面のため：途切れた場所（いま途切れている分も t まで入れる）と、この走りで値が1つも来なかった場所
  summary(t: number): { drops: SensorDrop[]; missing: string[] } {
    const drops: SensorDrop[] = []
    const missing: string[] = []
    this.places.forEach((place, i) => {
      if (!place) return
      if (!this.seen[i]) {
        missing.push(place)
        return
      }
      const s = this.since[i]
      const n = this.drops[i].n + (s !== null ? 1 : 0)
      const sec = this.drops[i].sec + (s !== null ? t - s : 0)
      if (n > 0) drops.push({ place, n, sec: Math.round(sec) })
    })
    return { drops, missing }
  }
}
