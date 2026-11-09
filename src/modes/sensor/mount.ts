import { MOUNT_DEFAULT, MOUNT_KEY, MOUNTS, type ChestMount, type HeadMount } from './params'

// 頭と胸のセンサーを付けた場所（params.ts の MOUNTS）を、端末（localStorage）に覚える。
// 読めない・書けない環境（プライベートブラウズなど）でも、いまのやり方（MOUNT_DEFAULT）で動く。判定の数字は場所で変えない
export type Mount = { head: HeadMount; chest: ChestMount }
// set：本人が選ぶ画面で「決める」を押したことがあるか。asked：選ぶ画面を一度でも出したか（初めて頭か胸をつないだときだけ自動で開くため）
export type MountState = Mount & { set: boolean; asked: boolean }

const isHead = (v: unknown): v is HeadMount => MOUNTS.head.some((m) => m.id === v)
const isChest = (v: unknown): v is ChestMount => MOUNTS.chest.some((m) => m.id === v)

export function loadMount(key = MOUNT_KEY): MountState {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') as Partial<MountState> | null
    if (v && typeof v === 'object') {
      return { head: isHead(v.head) ? v.head : MOUNT_DEFAULT.head, chest: isChest(v.chest) ? v.chest : MOUNT_DEFAULT.chest, set: v.set === true, asked: v.asked === true }
    }
  } catch {
    /* 読めなければ既定 */
  }
  return { ...MOUNT_DEFAULT, set: false, asked: false }
}

const write = (s: MountState, key: string) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(s))
  } catch {
    /* 保存できない環境では何もしない */
  }
}

// 「決める」を押した：場所を覚える
export function saveMount(m: Mount, key = MOUNT_KEY): MountState {
  const s: MountState = { head: m.head, chest: m.chest, set: true, asked: true }
  write(s, key)
  return s
}

// 選ぶ画面を自動で開いた（決めずに閉じても、次からは自動で開かない）
export function markMountAsked(key = MOUNT_KEY) {
  write({ ...loadMount(key), asked: true }, key)
}

export const mountLabel = (part: 'head' | 'chest', id: string) => (MOUNTS[part] as readonly { id: string; label: string }[]).find((m) => m.id === id)?.label ?? id

// 記録（SensorLog の mount）に残す形
export function mountForLog(key = MOUNT_KEY): { head: HeadMount; chest: ChestMount; set: boolean } {
  const s = loadMount(key)
  return { head: s.head, chest: s.chest, set: s.set }
}
