import type { ReactNode } from 'react'
import { Mannequin } from '../ui/Mannequin'
import { demoStride, REFERENCE } from '../ui/figure'

// フォームの見方：見本のフォームが何から作られているか、9つの観点それぞれの基準・ずれたときに何が起きるか・根拠
// 見本の数字は src/core/reference.json（研究データから作ったもの）から出す

const ideal = REFERENCE.ideal
const normal = REFERENCE.normal
const strideSec = 120 / REFERENCE.cadence
const contactSec = (pct: number) => ((pct / 100) * strideSec).toFixed(2)
const stanceMax = (curve: number[], pct: number) => Math.round(Math.max(...curve.slice(0, Math.round(pct))))

const IDEAL = demoStride({ lean: 7, head: 0, drop: 0 })

type Status = 'coach' | 'record' | 'next'
const STATUS: Record<Status, { label: string; color: string }> = {
  coach: { label: '声かけあり', color: 'var(--accent)' },
  record: { label: '測って記録', color: '#9AA3AD' },
  next: { label: '準備中', color: '#6B7480' },
}

interface Ref {
  key: string
  text: string
  url: string
}
const REFS: Record<string, Ref> = {
  fukuchi: {
    key: 'Fukuchi 2017',
    text: 'Fukuchi RK, Fukuchi CA, Duarte M. A public data set of running biomechanics and the effects of running speed on lower extremity kinematics and kinetics. PeerJ 5:e3298 (2017). データ：figshare（CC BY 4.0）',
    url: 'https://doi.org/10.7717/peerj.3298',
  },
  folland: {
    key: 'Folland 2017',
    text: 'Folland JP, Allen SJ, Black MI, Handsaker JC, Forrester SE. Running Technique is an Important Component of Running Economy and Performance. Med Sci Sports Exerc 49(7):1412–1423 (2017).',
    url: 'https://doi.org/10.1249/MSS.0000000000001245',
  },
  heiderscheit: {
    key: 'Heiderscheit 2011',
    text: 'Heiderscheit BC, Chumanov ES, Michalski MP, Wille CM, Ryan MB. Effects of step rate manipulation on joint mechanics during running. Med Sci Sports Exerc 43(2):296–302 (2011).',
    url: 'https://doi.org/10.1249/MSS.0b013e3181ebedf4',
  },
  arellano: {
    key: 'Arellano 2014',
    text: 'Arellano CJ, Kram R. The metabolic cost of human running: is swinging the arms worth it? J Exp Biol 217(14):2456–2461 (2014).',
    url: 'https://doi.org/10.1242/jeb.100420',
  },
  teng: {
    key: 'Teng 2014',
    text: 'Teng HL, Powers CM. Sagittal plane trunk posture influences patellofemoral joint stress during running. J Orthop Sports Phys Ther 44(10):785–792 (2014).',
    url: 'https://doi.org/10.2519/jospt.2014.5249',
  },
  mcmahon: {
    key: 'McMahon 1987',
    text: 'McMahon TA, Valiant G, Frederick EC. Groucho running. J Appl Physiol 62(6):2326–2337 (1987).',
    url: 'https://doi.org/10.1152/jappl.1987.62.6.2326',
  },
  beck: {
    key: 'Beck 2018',
    text: 'Beck ON, Azua EN, Grabowski AM. Step time asymmetry increases metabolic energy expenditure during running. Eur J Appl Physiol 118(10):2147–2154 (2018).',
    url: 'https://doi.org/10.1007/s00421-018-3939-3',
  },
  malisoux: {
    key: 'Malisoux 2023',
    text: 'Malisoux L, Napier C, Gette P, Delattre N, Theisen D. Reference Values and Determinants of Spatiotemporal and Kinetic Variables in Recreational Runners. Orthop J Sports Med 11(10):23259671231204629 (2023).',
    url: 'https://doi.org/10.1177/23259671231204629',
  },
  novacheck: {
    key: 'Novacheck 1998',
    text: 'Novacheck TF. The biomechanics of running. Gait & Posture 7(1):77–95 (1998).',
    url: 'https://doi.org/10.1016/S0966-6362(97)00038-6',
  },
}

interface Point {
  no: string
  title: string
  base: ReactNode // 見本（基準）
  off: ReactNode // ずれると何が起きるか
  how: ReactNode // アプリでの見方
  status: Status
  refs: string[]
  demo?: Parameters<typeof demoStride>[0] // ずれた形（見本と重ねて見せる）
  offLabel?: string
}

const POINTS: Point[] = [
  {
    no: '01',
    title: '頭の位置',
    base: '耳が肩の真上にある。走る前にまっすぐ立って測った、その日の自分の頭の位置が基準。',
    off: '頭が前に出ると、首と肩が頭を支え続けることになり、上体も前に引っぱられやすい。ただし頭の位置そのものと走りの効率を直接調べた研究は、まだ見つけられていない（コーチの経験則に近い観点）。',
    how: '立って測った基準から、首の角度が5°以上前に出た状態が続いたら声をかける。',
    status: 'coach',
    refs: [],
    demo: { lean: 7, head: 12, drop: 0 },
    offLabel: '頭が前に出た形',
  },
  {
    no: '02',
    title: '上体の傾き',
    base: '腰から肩にかけて、わずかに前に傾く（見本は7°）。',
    off: '97人のランナーを調べた研究では、上体がまっすぐに近い人ほど記録が良かった。一方で、上体を7°ほど前に倒すと膝の負担が約6%減り、そのぶんお尻の筋肉の負担が増える。倒れすぎず、反りすぎずが目安。',
    how: '腰から肩の線が15°以上、足首から肩の線が8°以上前に倒れた状態が続いたら声をかける。',
    status: 'coach',
    refs: ['folland', 'teng'],
    demo: { lean: 17, head: 3, drop: 0 },
    offLabel: '上体が倒れすぎた形',
  },
  {
    no: '03',
    title: '腕振り',
    base: '脚と反対に振る（左脚が前のとき左腕は後ろ）。肘は90°前後で、後ろに引く。',
    off: '腕を振らずに走ると、腕を後ろで組んだときで3%、胸の前で組んだときで9%、頭に乗せたときで13%、エネルギーの消費が増えた。腕振りは、脚の振りで生まれる体のねじれを打ち消している。',
    how: '肘と手首の動きから、振りの大きさと左右の対称性を見る予定。',
    status: 'next',
    refs: ['arellano'],
    demo: { lean: 7, head: 0, drop: 0, arm: 0.2 },
    offLabel: '腕をほとんど振らない形',
  },
  {
    no: '04',
    title: '着地の位置',
    base: `着地の瞬間のすねが鉛直に近い（見本は前に${Math.round(ideal.shankAtContact[0])}°）。足は腰の少し前に着く。`,
    off: `着地のすねが前に倒れているほど（足を前に出しすぎて着くほど）、記録が悪かった。研究データ全体の平均は前に${Math.round(normal.shankAtContact[0])}°で、見本はその中でも鉛直に近い4分の1の人たち。前に着くほどブレーキがかかる。`,
    how: '接地の瞬間（足首が一番前に出た瞬間）のすねの角度を測る予定。',
    status: 'next',
    refs: ['folland', 'fukuchi'],
    demo: { lean: 7, head: 0, drop: 0, over: 1 },
    offLabel: '足を前に出しすぎて着く形',
  },
  {
    no: '05',
    title: '接地時間',
    base: `1歩の接地は約${contactSec(ideal.stancePct)}秒（1周の${ideal.stancePct}%）。毎分${REFERENCE.cadence}歩のとき。`,
    off: '接地時間が短く、1周のうち地面に着いている割合が小さい人ほど、記録が良かった。',
    how: '足首が地面の高さにある時間を測る。0.2秒前後を測るには毎秒30コマ以上が要るので、ときどき細かく撮って測る予定。',
    status: 'next',
    refs: ['folland', 'fukuchi'],
  },
  {
    no: '06',
    title: 'ピッチ',
    base: `毎分${REFERENCE.cadence}歩（研究データのランナーが、キロ4分10秒前後で走ったときの平均）。`,
    off: 'いつものピッチを5〜10%上げると、膝が吸収するエネルギーが減り、着地のブレーキと上下動も小さくなった。歩幅が小さくピッチが高い人ほど、エネルギーの消費が少なかった。',
    how: '足首が腰より一番前に出た瞬間を接地として数え、1分あたりの歩数を出す。',
    status: 'record',
    refs: ['heiderscheit', 'folland', 'fukuchi'],
  },
  {
    no: '07',
    title: '腰の高さ',
    base: `接地中に膝が曲がるのは${stanceMax(ideal.knee[0], ideal.stancePct)}°まで（研究データの平均は${stanceMax(normal.knee[0], normal.stancePct)}°）。腰が落ちずに、上から吊られているように走る。`,
    off: '接地中に膝が伸びている人ほど、エネルギーの消費が少なかった。膝を深く曲げて腰を落として走ると、酸素の消費が最大50%増えた。',
    how: '走り始めの自分の腰の高さ（脚の長さに対する割合）から、6%以上下がった状態が続いたら声をかける。',
    status: 'coach',
    refs: ['folland', 'mcmahon'],
    demo: { lean: 7, head: 0, drop: 16 },
    offLabel: '腰が落ちた形',
  },
  {
    no: '08',
    title: '上下動',
    base: '接地中の腰の上下動が小さい。弾みすぎず、沈みすぎない。',
    off: '接地中の骨盤の上下動は、走りの効率（エネルギーの消費）を一番よく説明した要素だった。ピッチを上げると上下動も小さくなる。',
    how: '1歩ごとの腰の一番高い位置と低い位置の差を、脚の長さに対する割合で測る予定。',
    status: 'next',
    refs: ['folland', 'heiderscheit'],
  },
  {
    no: '09',
    title: '左右の差',
    base: '左右の接地時間や1歩の長さがそろっている。',
    off: '左右の1歩の時間をわざとずらして走ると、接地時間の左右差が10%増えるごとに、エネルギーの消費が7.8%増えた。',
    how: '左右それぞれの接地時間と1歩の時間を比べる予定（真横からだと奥の脚が隠れるので、精度に限りがある）。',
    status: 'next',
    refs: ['beck'],
  },
]

export function Theory() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'max(24px, env(safe-area-inset-top)) 16px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <a href="/" style={{ fontFamily: 'var(--num)', letterSpacing: 3, fontWeight: 700, fontSize: 16, color: 'var(--muted)', textDecoration: 'none' }}>
          RUN FORM COACH
        </a>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, lineHeight: 1.35 }}>
          フォームの見方
          <br />
          <span style={{ color: 'var(--accent)' }}>見本と、9つの観点</span>
        </h1>
        <p style={P}>
          ランフォームコーチは、研究データから作った「見本のフォーム」を基準に、走っている人のフォームがどれだけずれているかを見ます。
          このページでは、見本が何から作られているか、9つの観点それぞれで「見本はどういう走りか」「ずれると何が起きるか」「アプリでどう見ているか」を、根拠の研究と一緒に紹介します。
        </p>
      </header>

      <section style={SECTION}>
        <H2>見本のフォーム</H2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
          <div className="stage" style={{ height: 300 }}>
            <Mannequin frames={IDEAL} upperColor="var(--accent)" width={330} height={300} viewBox="0 0 330 300" transform="translate(40,-8) scale(0.66)" />
            <div style={{ position: 'absolute', left: 12, top: 10, fontSize: 12, color: '#C9CFD5' }}>実際の速さ（毎分{REFERENCE.cadence}歩）</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={P}>
              脚の動き（股関節・膝・足首の角度、接地の長さ）は、市民ランナー39人をトレッドミルで3Dモーションキャプチャした公開データ
              <Cite id="fukuchi" />
              から作っています。キロ4分10秒前後（サブ3のペース）に合わせ、秒速3.5mと4.5mのデータを合わせました。
            </p>
            <p style={P}>
              データ全体の平均は「ふつうの市民ランナー」の走りで、かかとから着く人が多く、着地のすねは平均で前に{Math.round(normal.shankAtContact[0])}°倒れています。
              そこで見本は、<b>着地のすねが鉛直に近い上位4分の1の脚（{ideal.limbs}本・{ideal.runners}人）</b>の平均にしました。
            </p>
            <Numbers />
          </div>
        </div>
        <KneeChart />
        <Note>
          データにないもの：腕（脚と反対に振り、肘は90°前後とした）、上体の傾き（7°とした）、頭。股関節の角度は骨盤から見た太ももの角度なので、骨盤の前傾ぶん（データにない）を、接地中に膝が一番曲がった瞬間に足首が腰の真下に来るとして決めています。
          走りの上下動（跳ね）は、市民ランナー860人の実測（7.7 ± 1.2cm）
          <Cite id="malisoux" />
          に合わせました。平面の骨格では骨盤や腕の動きがないぶん上下動が小さく出るため、アニメーションでは接地中の膝をデータの平均より少し深く（最大約51°）曲げています。
        </Note>
      </section>

      <section style={SECTION}>
        <H2>9つの観点</H2>
        <p style={P}>
          見本の形（点線）と、ずれた形を重ねて見せています。「声かけあり」は今のアプリで走りながら声をかけている観点、「測って記録」は記録だけしている観点、「準備中」はこれから入れる観点です。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {POINTS.map((p) => (
            <PointCard key={p.no} p={p} />
          ))}
        </div>
      </section>

      <section style={SECTION}>
        <H2>このページの数字について</H2>
        <ul style={{ ...P, margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>研究の多くは、3Dモーションキャプチャなどの精密な装置で測ったものです。アプリはスマホ1台で真横から撮るので、同じ精度では測れません。特に膝や足首の角度は数度の誤差があり、奥側の脚は使えません。</li>
          <li>声をかける線（5°・15°など）は、今は仮の値です。実際の記録を見ながら合わせていきます。</li>
          <li>研究で分かっているのは「その傾向がある」ということで、一人ひとりの最適なフォームは体格や走力で変わります。アプリが目指すのは、見本の方向に向かって、自分のベストを1つずつ更新することです。</li>
          <li>けがの診断や治療のためのものではありません。痛みがあるときは医療機関に相談してください。</li>
        </ul>
      </section>

      <section style={SECTION}>
        <H2>参考にした研究</H2>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(REFS).map(([id, r]) => (
            <li key={id} id={`ref-${id}`} style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--muted)' }}>
              {r.text}{' '}
              <a href={r.url} target="_blank" rel="noreferrer">
                リンク
              </a>
            </li>
          ))}
        </ol>
      </section>

      <a className="primary" href="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
        アプリを開く
      </a>
    </main>
  )
}

const P = { margin: 0, fontSize: 15, lineHeight: 1.85, color: '#C9CFD5' } as const
const SECTION = { display: 'flex', flexDirection: 'column', gap: 14 } as const

function H2({ children }: { children: ReactNode }) {
  return <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>{children}</h2>
}

function Note({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--faint)' }}>{children}</p>
}

function Cite({ id }: { id: string }) {
  return (
    <a href={`#ref-${id}`} style={{ fontSize: 12, marginLeft: 2, textDecoration: 'none' }}>
      [{REFS[id].key}]
    </a>
  )
}

function Numbers() {
  const rows: [string, string, string][] = [
    ['ピッチ', `毎分${REFERENCE.cadence}歩`, '論文の表（秒速3.5m・4.5m の平均）'],
    ['接地時間（1歩）', `${contactSec(ideal.stancePct)}秒`, `データ全体 ${contactSec(normal.stancePct)}秒`],
    ['着地のすね', `前に${Math.round(ideal.shankAtContact[0])}°`, `データ全体 前に${Math.round(normal.shankAtContact[0])}°`],
    ['接地中の膝の曲がり', `最大${stanceMax(ideal.knee[0], ideal.stancePct)}°`, `データ全体 最大${stanceMax(normal.knee[0], normal.stancePct)}°`],
  ]
  return (
    <div className="card" style={{ padding: '6px 16px' }}>
      {rows.map(([k, v, n]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 14 }}>{k}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--faint)' }}>{n}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// 1周（0〜100%）の膝の曲がり：見本（線）と、データ全体の平均±標準偏差（帯）
function KneeChart() {
  const W = 680
  const H = 220
  const pad = { l: 52, r: 16, t: 10, b: 30 }
  const x = (i: number) => pad.l + (i / 100) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / 120) * (H - pad.t - pad.b)
  const line = (c: number[]) => c.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')
  const [m, sd] = normal.knee
  const band = m.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v + sd[i]).toFixed(1)}`).join('') + m.map((_, j) => m.length - 1 - j).map((i) => `L${x(i).toFixed(1)} ${y(m[i] - sd[i]).toFixed(1)}`).join('') + 'Z'
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>膝の曲がり（1周＝2歩のあいだ）</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="膝の曲がりの見本と、データ全体の範囲">
        <rect x={x(0)} y={pad.t} width={x(ideal.stancePct) - x(0)} height={H - pad.t - pad.b} fill="#1A2016" />
        <text x={x(ideal.stancePct / 2)} y={pad.t + 24} fill="#7C8A5A" fontSize={20} textAnchor="middle">
          接地
        </text>
        {[0, 30, 60, 90, 120].map((v) => (
          <g key={v}>
            <path d={`M${pad.l} ${y(v)}H${W - pad.r}`} stroke="#1E2429" />
            <text x={pad.l - 6} y={y(v) + 7} fill="#6B7480" fontSize={18} textAnchor="end">
              {v}°
            </text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map((i) => (
          <text key={i} x={x(i)} y={H - 4} fill="#6B7480" fontSize={18} textAnchor="middle">
            {i}%
          </text>
        ))}
        <path d={band} fill="#9AA3AD" opacity={0.22} />
        <path d={line(m)} stroke="#9AA3AD" strokeWidth={1.5} strokeDasharray="5 4" fill="none" />
        <path d={line(ideal.knee[0])} stroke="var(--accent)" strokeWidth={3} fill="none" />
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <span>
          <span style={{ display: 'inline-block', width: 18, height: 3, background: 'var(--accent)', verticalAlign: 'middle', marginRight: 6 }} />
          見本（着地がきれいな上位4分の1）
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 18, height: 10, background: '#9AA3AD', opacity: 0.4, verticalAlign: 'middle', marginRight: 6 }} />
          データ全体の平均±標準偏差（{normal.runners}人）
        </span>
      </div>
    </div>
  )
}

function PointCard({ p }: { p: Point }) {
  const st = STATUS[p.status]
  return (
    <article className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="num" style={{ fontSize: 22, color: 'var(--accent)' }}>
          {p.no}
        </span>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{p.title}</h3>
        <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, border: `1px solid ${st.color}`, color: st.color }}>{st.label}</span>
      </div>
      {p.demo && (
        <div className="stage" style={{ height: 170, display: 'flex', justifyContent: 'center' }}>
          <Mannequin
            frames={demoStride(p.demo)}
            ghost={IDEAL}
            ghostColor="var(--accent)"
            upperColor="var(--warn)"
            width={170}
            height={170}
            viewBox="0 0 170 170"
            transform="translate(14,-6) scale(0.38)"
          />
          <div style={{ position: 'absolute', left: 12, top: 10, fontSize: 11, color: '#C9CFD5', lineHeight: 1.6 }}>
            <span style={{ color: 'var(--warn)' }}>■</span> {p.offLabel}
            <br />
            <span style={{ color: 'var(--accent)' }}>┄</span> 見本
          </div>
        </div>
      )}
      <Field label="見本">{p.base}</Field>
      <Field label="ずれると">
        {p.off}
        {p.refs.map((r) => (
          <Cite key={r} id={r} />
        ))}
      </Field>
      <Field label="アプリでは">{p.how}</Field>
    </article>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 11, color: 'var(--faint)', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 14, lineHeight: 1.75, color: '#D5DADF' }}>{children}</div>
    </div>
  )
}
