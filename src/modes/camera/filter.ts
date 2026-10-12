// One Euro フィルター：止まっているときは強くなめらかに、速く動くときは遅れを小さくする
class LowPass {
  private y: number | null = null
  filter(x: number, a: number) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y
    return this.y
  }
  last() {
    return this.y
  }
}

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export class OneEuro {
  private x = new LowPass()
  private dx = new LowPass()
  private prevT: number | null = null
  private minCutoff: number
  private beta: number
  private dCutoff: number
  constructor(minCutoff = 1.5, beta = 0.05, dCutoff = 1) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  filter(value: number, tSec: number): number {
    const dt = this.prevT === null ? 1 / 30 : Math.max(1e-3, tSec - this.prevT)
    this.prevT = tSec
    const prev = this.x.last()
    const d = prev === null ? 0 : (value - prev) / dt
    const ed = this.dx.filter(d, alpha(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(ed)
    return this.x.filter(value, alpha(cutoff, dt))
  }
}
