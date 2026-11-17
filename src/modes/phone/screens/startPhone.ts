import type { Screen } from '../../../App'
import { unlockVoice } from '../../../core/voice'
import type { PhoneKind, PhoneWhere } from '../session'
import { requestLocation, requestMotionPermission, requestWakeLock } from '../sensor'

// 腰スマホの走りを始める（ふつうのアプリのホームと、テスト用のページ /lab/ のホームから）。
// 押したときに、動きのセンサーの許可（iPhone）と、画面が消えないようにする仕組みと、位置情報の許可（外のとき）をまとめて求める。
// 動きのセンサーの許可は、押した流れの中で求めないと出ないので先に。位置情報は、そのあとに続けて
export async function startPhone(go: (s: Screen) => void, where: PhoneWhere, kind?: PhoneKind) {
  unlockVoice()
  const wake = requestWakeLock()
  await requestMotionPermission()
  const location = where === 'outdoor' ? await requestLocation() : undefined
  await wake
  go({ name: 'phone', where, location, kind })
}
