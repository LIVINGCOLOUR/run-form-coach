// 仮想実験の材料：研究データ（Fukuchi ら 2017、CC BY 4.0）の3次元の点から、MediaPipe と同じ関節の位置を作る
//   走行（runT35markers.txt）：150Hz、骨盤・太もも・すねは「点の集まり」、かかと・つま先の付け根は直接
//   直立（static.txt）：大転子・膝の内外・くるぶしの内外・つま先の付け根などの解剖学的な点がある
//   直立のときの点を、体の部分ごとの点の集まりの動き（剛体の回転と移動）で走行の各コマへ運ぶ
//   床反力（runT35forces.txt）：300Hz。上下方向の力が 50N を超えている間を接地とする（本当の接地の正解）
// 座標：Y が上、X が前後（走る向きが +X）、Z が左右（右が +Z）。単位は mm
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type V3 = [number, number, number]
export interface Trial {
  id: string
  fps: number
  // 各コマの関節（左右）
  joints: { [k in JointName]: V3[] }
  contacts: { start: number; end: number }[] // 床反力で見た接地（秒）
}
export type JointName = 'hipR' | 'hipL' | 'kneeR' | 'kneeL' | 'ankleR' | 'ankleL' | 'heelR' | 'heelL' | 'toeR' | 'toeL' | 'pelvis'

export function table(path: string) {
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const head = lines[0].split('\t')
  const rows = lines.slice(1).map((l) => l.split('\t').map(Number))
  const col = (name: string) => head.indexOf(name)
  return { head, rows, col }
}

export function marker(t: ReturnType<typeof table>, name: string): V3[] {
  const [x, y, z] = ['X', 'Y', 'Z'].map((a) => t.col(name + a))
  if (x < 0) throw new Error('no marker ' + name)
  return t.rows.map((r) => [r[x], r[y], r[z]])
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const mean3 = (ps: V3[]): V3 => scale(ps.reduce(add, [0, 0, 0]), 1 / ps.length)

// 2組の点から、a を b に重ねる回転（Horn の四元数法。最大固有ベクトルは Jacobi 法で求める）
function rotationBetween(a: V3[], b: V3[]): number[][] {
  const ca = mean3(a)
  const cb = mean3(b)
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < a.length; i++) {
    const p = sub(a[i], ca)
    const q = sub(b[i], cb)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += p[r] * q[c]
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]
  // 対称行列の固有ベクトルを Jacobi 法で求め、最大の固有値のものを使う
  const A = N.map((r) => r.slice())
  const Vm = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] ** 2
    if (off < 1e-18) break
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(A[p][q]) < 1e-30) continue
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const sn = t * c
        for (let k = 0; k < 4; k++) {
          const akp = A[k][p]
          const akq = A[k][q]
          A[k][p] = c * akp - sn * akq
          A[k][q] = sn * akp + c * akq
        }
        for (let k = 0; k < 4; k++) {
          const apk = A[p][k]
          const aqk = A[q][k]
          A[p][k] = c * apk - sn * aqk
          A[q][k] = sn * apk + c * aqk
        }
        for (let k = 0; k < 4; k++) {
          const vkp = Vm[k][p]
          const vkq = Vm[k][q]
          Vm[k][p] = c * vkp - sn * vkq
          Vm[k][q] = sn * vkp + c * vkq
        }
      }
  }
  let best = 0
  for (let i = 1; i < 4; i++) if (A[i][i] > A[best][best]) best = i
  const v = [0, 1, 2, 3].map((k) => Vm[k][best])
  const [q0, qx, qy, qz] = v
  return [
    [q0 * q0 + qx * qx - qy * qy - qz * qz, 2 * (qx * qy - q0 * qz), 2 * (qx * qz + q0 * qy)],
    [2 * (qy * qx + q0 * qz), q0 * q0 - qx * qx + qy * qy - qz * qz, 2 * (qy * qz - q0 * qx)],
    [2 * (qz * qx - q0 * qy), 2 * (qz * qy + q0 * qx), q0 * q0 - qx * qx - qy * qy + qz * qz],
  ]
}
const rot = (R: number[][], p: V3): V3 => [0, 1, 2].map((r) => R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]) as V3

const ok = (p: V3) => p.every(Number.isFinite)

// 直立で決めた点 point を、点の集まり cluster の動きに合わせて走行の各コマへ運ぶ
// 点が欠けたコマは、残っている点（3つ以上）だけで重ねる。足りなければ前のコマの値を使う
export function carry(staticCluster: V3[], point: V3, runCluster: V3[][]): V3[] {
  let last: V3 = [NaN, NaN, NaN]
  return runCluster.map((frame) => {
    const idx = frame.map((p, i) => (ok(p) ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 3) return last
    const a = idx.map((i) => staticCluster[i])
    const b = idx.map((i) => frame[i])
    last = add(rot(rotationBetween(a, b), sub(point, mean3(a))), mean3(b))
    return last
  })
}

// 欠けたコマは前後の値でつなぐ（直線で補う）
function fill(ps: V3[]): V3[] {
  const out = ps.slice()
  if (!out.some(ok)) return out // 全部欠けている（その人の直立の点がない）
  let i = 0
  while (i < out.length) {
    if (ok(out[i])) {
      i++
      continue
    }
    let j = i
    while (j < out.length && !ok(out[j])) j++
    const a = i > 0 ? out[i - 1] : out[j]
    const b = j < out.length ? out[j] : a
    for (let k = i; k < j; k++) {
      const u = (k - i + 1) / (j - i + 1)
      out[k] = [0, 1, 2].map((d) => a[d] + (b[d] - a[d]) * u) as V3
    }
    i = j
  }
  return out
}

const PELVIS = ['R.ASIS', 'L.ASIS', 'R.PSIS', 'L.PSIS', 'R.Iliac.Crest', 'L.Iliac.Crest']
const THIGH = (s: string) => ['Top.Lateral', 'Bottom.Lateral', 'Top.Medial', 'Bottom.Medial'].map((p) => `${s}.Thigh.${p}`)
const SHANK = (s: string) => ['Top.Lateral', 'Bottom.Lateral', 'Top.Medial', 'Bottom.Medial'].map((p) => `${s}.Shank.${p}`)

export function loadTrial(dir: string, id: string, speed = '35'): Trial {
  const st = table(join(dir, `${id}static.txt`))
  const run = table(join(dir, `${id}runT${speed}markers.txt`))
  const fz = table(join(dir, `${id}runT${speed}forces.txt`))
  // 直立は全コマの平均
  const s = (name: string): V3 => mean3(marker(st, name))
  const runM = (name: string) => marker(run, name)
  const clusterRun = (names: string[]) => {
    const ms = names.map(runM)
    return ms[0].map((_, i) => ms.map((m) => m[i]))
  }
  // 品質の確認：点の集まりの1つを残りから運んで、走行中の本物と比べる。20mm を超えてずれる人は、直立と走行の
  // あいだで印が貼り直された・名前が違うなどで使えないので除く
  const check = (names: string[]) => {
    for (const leave of names) {
      const use = names.filter((n) => n !== leave)
      const got = carry(use.map(s), s(leave), clusterRun(use))
      const real = runM(leave)
      const err = got.map((p, i) => Math.hypot(p[0] - real[i][0], p[1] - real[i][1], p[2] - real[i][2])).filter(Number.isFinite).sort((x, y) => x - y)
      const med = err[Math.floor(err.length / 2)]
      if (!(med < 20)) throw new Error(`${id}: ${leave} が直立と走行で合いません（${Math.round(med)}mm）`)
    }
  }
  for (const side of ['R', 'L']) {
    check(THIGH(side))
    check(SHANK(side))
    check(['Heel.Top', 'Heel.Bottom', 'Heel.Lateral', 'MT1', 'MT5'].map((m) => `${side}.${m}`))
  }
  check(PELVIS.filter((n) => !n.includes('Crest')))
  const pel = clusterRun(PELVIS)
  const pelS = PELVIS.map(s)
  const joints = {} as Trial['joints']
  for (const side of ['R', 'L'] as const) {
    joints[`hip${side}`] = carry(pelS, s(`${side}.GTR`), pel)
    const kneeS = scale(add(s(`${side}.Knee`), s(`${side}.Knee.Medial`)), 0.5)
    joints[`knee${side}`] = carry(THIGH(side).map(s), kneeS, clusterRun(THIGH(side)))
    const ankleS = scale(add(s(`${side}.Ankle`), s(`${side}.Ankle.Medial`)), 0.5)
    joints[`ankle${side}`] = carry(SHANK(side).map(s), ankleS, clusterRun(SHANK(side)))
    // かかととつま先は、靴の上に貼った印ではなく、足裏の輪郭の点にする（MediaPipe のかかと・つま先と同じ）
    //   直立のとき床（高さ0）にある、かかとの下と、つま先の付け根の下を、足の印の集まりの動きで運ぶ
    //   （足は1つの硬い塊として動かすので、付け根より前の点は蹴り出しで床の下にもぐってしまう。付け根は蹴り出しでも床に残る）
    const FOOT = ['Heel.Top', 'Heel.Bottom', 'Heel.Lateral', 'MT1', 'MT5'].map((m) => `${side}.${m}`)
    const hb = s(`${side}.Heel.Bottom`)
    const mt2 = s(`${side}.MT2`)
    const heelSole: V3 = [hb[0] - 10, 0, hb[2]]
    const toeSole: V3 = [mt2[0], 0, mt2[2]]
    joints[`heel${side}`] = carry(FOOT.map(s), heelSole, clusterRun(FOOT))
    joints[`toe${side}`] = carry(FOOT.map(s), toeSole, clusterRun(FOOT))
  }
  joints.pelvis = pel.map((f) => mean3(f.filter(ok)))
  for (const k of Object.keys(joints) as JointName[]) {
    joints[k] = fill(joints[k])
    if (!joints[k].some(ok)) throw new Error(`${id}: ${k} がありません`)
  }
  // 床反力（300Hz）で接地を決める
  const fy = fz.rows.map((r) => r[fz.col('Fy')])
  const contacts: Trial['contacts'] = []
  let s0 = -1
  fy.forEach((f, i) => {
    if (f > 50 && s0 < 0) s0 = i
    if (f <= 50 && s0 >= 0) {
      contacts.push({ start: s0 / 300, end: i / 300 })
      s0 = -1
    }
  })
  // 床反力のごく短いとがり（数ms）は接地ではないので除く
  return { id, fps: 150, joints, contacts: contacts.filter((c) => c.start > 0 && c.end - c.start > 0.08) }
}
