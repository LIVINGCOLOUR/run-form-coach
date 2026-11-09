import { useEffect, useState, useSyncExternalStore } from 'react'
import { sensors, type NodeView } from './ble'
import { batteryPercent } from './battery'
import { ANKLES, BATTERY_LOW, CHEST, HEAD, HEAD_PLACE, HUNCH } from './params'
import { loadMount, markMountAsked, mountLabel, saveMount } from './mount'
import { MountPicker } from './MountPicker'

// 走る前に、自作のセンサーをつなぐ小さな枠（ホームの「はじめる」の下）。つながなくてもカメラ版はいつもどおり使える。
// 胸のセンサーがつながっていれば、走っている間に猫背になったとき胸が、頭のセンサーなら頭が前に出たとき頭が震える（lean.ts）。
// 両足首なら、接地が長い・左右差で足首が震える（contactCoach.ts）
// 「震わす」で試せる場所（走っている間に震える場所）
const TEST_BUZZ = [HUNCH.place, HEAD.place, ANKLES.L, ANKLES.R]

// defaultOpen：はじめから開いておく（センサーランはセンサーが要るので）
export function SensorPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const nodes = useSyncExternalStore(sensors.subscribe, sensors.snapshot)
  const bulk = useSyncExternalStore(sensors.subscribe, sensors.bulkSnapshot)
  const on = nodes.filter((n) => n.status === 'connected').length
  // 電池が少ない（BATTERY_LOW % 以下）センサー。閉じていても見えるように、ボタンにも出す
  const low = nodes.filter((n) => n.status === 'connected' && n.battery !== null && batteryPercent(n.battery) <= BATTERY_LOW)
  // 頭と胸を付ける場所（mount.ts）。初めて頭か胸がつながったときだけ、選ぶ画面を自動で開く（つないでいる途中は待つ）。次からは「付ける場所」の行から開く
  const [mount, setMount] = useState(loadMount)
  const [picking, setPicking] = useState(false)
  const leanOn = nodes.some((n) => n.status === 'connected' && (n.place === HEAD_PLACE || n.place === CHEST))
  useEffect(() => {
    if (!leanOn || mount.asked || bulk.busy) return
    markMountAsked()
    setMount((m) => ({ ...m, asked: true }))
    setOpen(true)
    setPicking(true)
  }, [leanOn, mount.asked, bulk.busy])

  // 前に選んだことのあるセンサーに、選ぶ画面なしでつなぎにいく（getDevices があるブラウザだけ。なければ何もしない）
  useEffect(() => {
    void sensors.restore()
  }, [])

  const link = { background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', fontSize: 12 } as const
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={link}>
        センサー{on ? `（${on} / ${sensors.slots} つながっています）` : 'をつなぐ'}
        {low.length > 0 && <span style={{ color: 'var(--warn)', fontWeight: 700 }}>・電池が少ない：{low.map((n) => `${n.place} ${batteryPercent(n.battery!)}%`).join('、')}</span>}
      </button>
    )
  }
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>センサー</div>
        <button onClick={() => setOpen(false)} style={link}>
          閉じる
        </button>
      </div>
      {picking && (
        <MountPicker
          initial={mount}
          onDone={(m) => {
            setMount(saveMount(m))
            setPicking(false)
          }}
        />
      )}
      {!sensors.supported ? (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          このブラウザはセンサーにつなげません（iPhone の Safari は Bluetooth に対応していません）。iPhone では Bluefy というブラウザでこのページを開くと、つなげます。センサーなしでも、トレッドミル（カメラ）と腰スマホはいつもどおり使えます。
        </div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            スイッチを入れて「まとめてつなぐ」を押し、出てきた名前を選びます（どれからでも。どこのセンサーかは自動で見分けます）。走っている間に、猫背が {HUNCH.hold} 秒続くと胸が、頭が前に出たのが {HEAD.hold} 秒続くと頭が震えます（その場所がつながっているとき）。両足首がつながっていれば、接地が長い（腰が落ちている）と両足首が、接地の長さが左右でずれると長いほうの足首が震え、直ると短く2回震えます。センサーがずれたとみたときは、その場所が短く {HUNCH.slipBuzzCount} 回震え、走ったあとの結果の画面でも知らせます。
          </div>
          {low.length > 0 && (
            <div style={{ color: 'var(--warn)', fontSize: 13, fontWeight: 700, lineHeight: 1.6 }}>
              電池が {BATTERY_LOW}% 以下のセンサーがあります（{low.map((n) => n.place).join('、')}）。走っている途中で切れるかもしれないので、充電してください。
            </div>
          )}
          {bulk.left > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button disabled={bulk.busy} onClick={() => void sensors.connectAll()} style={{ height: 40, borderRadius: 20, border: '1px solid var(--text)', background: 'transparent', color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>
                {bulk.busy ? 'つないでいます…' : bulk.needTap ? '次のセンサーを選ぶ' : 'まとめてつなぐ'}
              </button>
              {bulk.needTap && !bulk.busy && (
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                  このブラウザは、1回押すごとに1個しか選べないようです。もう1回押すと、次のセンサーを選べます（あと {bulk.left} 個）
                </div>
              )}
            </div>
          )}
          {nodes.map((n, i) => (
            <Row key={n.place} n={n} onConnect={() => void sensors.connect(i)} onTest={TEST_BUZZ.includes(n.place) ? () => void sensors.buzz(n.place, 1, 300) : undefined} />
          ))}
          {!picking && (
            // 付ける場所：めったに変えないので、小さな行だけ
            <button onClick={() => setPicking(true)} style={{ ...link, fontSize: 11, textAlign: 'left' }}>
              付ける場所：頭 {mountLabel('head', mount.head)}・胸 {mountLabel('chest', mount.chest)}（変える）
            </button>
          )}
          {bulk.diag.length > 0 && (
            // つないだときに起きたこと（Bluefy でどう動くかを確かめるため。走りの記録にも sensor:ble で入る）
            <div className="muted" style={{ fontSize: 10, lineHeight: 1.5, wordBreak: 'break-all' }}>
              {bulk.diag.slice(-3).map((d, k) => (
                <div key={k}>{d}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ n, onConnect, onTest }: { n: NodeView; onConnect: () => void; onTest?: () => void }) {
  const ok = n.status === 'connected'
  const busy = n.status === 'connecting'
  const low = ok && (n.rate < 80 || n.lost > 0)
  const pct = n.battery !== null ? batteryPercent(n.battery) : null
  const empty = ok && pct !== null && pct <= BATTERY_LOW
  const button = { flexShrink: 0, whiteSpace: 'nowrap', height: 32, padding: '0 12px', borderRadius: 16, background: 'transparent', color: 'var(--text)', fontSize: 12 } as const
  // 知らせの文は省かずに折り返す（スマホの幅で、長いエラーが切れて「つなぎ直す」が文の続きに見えたため）。ボタンは文の下の別の行に置く
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, opacity: n.name ? 1 : 0.5, minWidth: 0 }}>
      <div style={{ width: 52, flexShrink: 0, fontSize: 13, fontWeight: 700 }}>{n.place}</div>
      <div style={{ flex: '1 1 0', minWidth: 0, fontSize: 11, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="muted">{n.name ?? '使わない'}{n.fw ? `（${n.fw}）` : ''}</div>
        <div style={{ color: ok ? 'var(--accent)' : n.status === 'error' || n.status === 'lost' ? 'var(--warn)' : 'var(--muted)', whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{n.message}</div>
        {ok && (
          <div className="muted" style={{ color: low ? 'var(--warn)' : undefined }}>
            {n.rate} 件/秒・抜け {n.lost}
            {pct !== null && <span style={{ color: empty ? 'var(--warn)' : undefined, fontWeight: empty ? 700 : undefined }}>・電池 {pct}%{empty ? '（充電してください）' : ''}</span>}
            {!n.canBuzz ? '・振動なし' : ''}
          </div>
        )}
        {((ok && onTest && n.canBuzz) || (n.name && !ok)) && (
          <div style={{ display: 'flex', gap: 8 }}>
            {ok && onTest && n.canBuzz && (
              <button onClick={onTest} style={{ ...button, border: '1px solid var(--line)' }}>
                震わす
              </button>
            )}
            {n.name && !ok && (
              <button disabled={busy} onClick={onConnect} style={{ ...button, border: '1px solid var(--text)', fontWeight: 700 }}>
                {n.status === 'idle' ? 'つなぐ' : 'つなぎ直す'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
