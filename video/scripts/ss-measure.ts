// SS の月1回の報告の動画（SSReport）用：本人の走りの録画の骨格の点（npm run rec:landmarks の出力）から、
// 切り出す区間の1コマごとの点と、アプリと同じ測り方（src/modes/camera/geometry.ts の measure）の上体・首の角度を出す。
// 録画・点の数字は本人だけのもの。出力は video/public/private/（git に入れない）
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { Frame } from '../../src/core/types'
import { measure } from '../../src/modes/camera/geometry'
import { HUNCH, STRICT } from '../../src/modes/camera/params'
import { CUE } from '../../src/core/params'

export const LINE = STRICT.advanced.hunch.cue // 上級の猫背の線（度）
export const SUSTAIN = CUE.sustain
export const WINDOW = CUE.window
export const RECOVER_HOLD = CUE.recoverHold
export const NECK_SLACK = HUNCH.neckSlack

// 縦に回して記録した録画（iPhone の縦撮り）は、点が縦長の画像（w × h）の 0〜1 で入っている
export function load(file: string, w: number, h: number) {
  const j = JSON.parse(gunzipSync(readFileSync(file)).toString())
  return (j.framesHi as { t: number; p: number[][] | null }[]).map((fr) => {
    if (!fr.p) return { t: fr.t, p: null, m: null }
    const frame = fr.p.map(([x, y, z, v]) => ({ x: x * w, y: y * h, z, v })) as unknown as Frame
    const m = measure(frame)
    return { t: fr.t, p: fr.p.map(([x, y, , v]) => [+x.toFixed(4), +y.toFixed(4), +v.toFixed(2)]), m: { trunk: m.trunk, neck: m.neck, headLean: m.headLean, dir: m.dir } }
  })
}
