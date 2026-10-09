import type { ReactNode } from 'react'
import { ABSENCE, BASELINE, BREAKDOWN, CUE, HIP_REF, LIMITS, POWER, PRAISE, QUIET, RUNNING, SCORE, SETUP, STRIDE } from '../core/params'

// 判定のロジック：アプリが実際に使っている数字（params.ts）を、そのまま埋め込んで説明する
// 数字を直したら、このページの説明も自動で変わる

const ITEM_NAME = { head: '頭の位置', trunk: '上体の傾き', body: '体全体の傾き', hip: '腰の高さ' } as const
const UNIT = { head: '°', trunk: '°', body: '°', hip: '%' } as const
const ITEM_WHAT = {
  head: '走る前に測った直立の基準から、首の角度が前に出た量',
  trunk: '腰→肩の線の前傾',
  body: '接地している足首→肩の線の前傾',
  hip: `走り始め（${HIP_REF.from}秒〜${HIP_REF.to / 60}分）の自分の腰の高さからの下がり（脚の長さに対する割合）`,
} as const

export function Logic() {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>判定のロジック</h2>
      <p style={P}>
        アプリが「いつ・何を見て・どう決めているか」を、全部書き出しています。数字はアプリが実際に使っている値をそのまま表示しているので、ロジックを調整すると、このページも同じ値に変わります。
        <Mark>検証中</Mark>の付いた値は、試しやすさのために一時的にそうしているものです。
      </p>

      <Step no="1" title="置き方（スマホを置いて、全身が入るまで）">
        <Row>開いてから{SETUP.talkAfter}秒は話さない（スマホを置いて離れる間）。</Row>
        <Row>スマホが{SETUP.phoneStill}秒静止してから判定を始める（手に持っている間の映像を、人と見間違えないため）。</Row>
        <Row>
          「映っている」は、直近{SETUP.seenWindow}秒のコマのうち{pct(SETUP.seenOn)}以上で全身が見えたとき。{pct(SETUP.seenOff)}を切るまでは「映っていない」に戻さない。
        </Row>
        <Row>全身：頭（鼻か耳）と、肩・腰・膝・足首の左右どちらかが見えていて、上から頭→肩→腰→膝→足首の順に並んでいること。</Row>
        <Row>大きさ：頭から足までが画面の高さの{pct(SETUP.spanMin)}以上。足りなければ「近づいて」と言う。</Row>
        <Row>真横：真横からのずれが{SETUP.sideMax}°以内。</Row>
        <Row>
          そろった状態が{SETUP.readyHold}秒続いたら次へ。案内は、同じ状態が{SETUP.hintStable}秒続いてから言い、同じ案内は{SETUP.hintRepeat}秒おきに繰り返す。声は重ねず、話し終わって1秒あけてから次を話す。
        </Row>
      </Step>

      <Step no="2" title="直立の基準（走るたびに取る）">
        <Row>
          止まってから{BASELINE.settle}秒待ち、そのあと{BASELINE.collect}秒の首の角度の中央値を基準にする。「動いた」が{BASELINE.movingTolerance}秒未満なら数え直さない。
        </Row>
        <Row>
          猫背のチェック：肩→耳の前傾が{BASELINE.standingHead}°以下、腰→肩の前傾が{BASELINE.standingTrunk}°以下。越えていたら、大きくずれている1つだけ直し方を言って測り直す（{BASELINE.retries}回まで）。
        </Row>
        <Row>甘くなりすぎないよう、直近5回の基準の真ん中より{BASELINE.slack}°以上悪い分は{BASELINE.slack}°までに抑える。</Row>
      </Step>

      <Step no="3" title="走り出し・一時停止">
        <Row>
          足首が腰より一番前に出た瞬間を接地として数え、ピッチが毎分{RUNNING.runSpm}歩以上なら「走っている」。走っている状態が{RUNNING.startAfter}秒続いたら始める。
        </Row>
        {RUNNING.inPlaceForTesting && (
          <Row>
            <Mark>検証中</Mark>トレッドミルがないときのために、その場で走るフリ（左右の脚が交互に上下するリズムが毎秒2歩以上）も走っているとみなす。
          </Row>
        )}
        <Row>
          止まった状態が{RUNNING.pauseAfter}秒続いたら一時停止。{!RUNNING.pauseEnabled && <><Mark>検証中</Mark>今は一時停止を切っている。</>}
        </Row>
      </Step>

      <Step no="4" title="1秒ごとの記録と点数">
        <Row>1秒のあいだに3コマ以上の骨格が取れたら、その平均を1秒分の記録にする。</Row>
        <Row>項目ごとに、線の内側なら100点、0点の線までは比例して下がる。姿勢スコアは、4つの項目の一番低い点。</Row>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--faint)', textAlign: 'left' }}>
              <th style={TH}>項目</th>
              <th style={TH}>100点</th>
              <th style={TH}>0点</th>
              <th style={TH}>声をかける線</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(LIMITS) as (keyof typeof LIMITS)[]).map((k) => (
              <tr key={k}>
                <td style={TD}>
                  {ITEM_NAME[k]}
                  <div style={{ fontSize: 11, color: 'var(--faint)' }}>{ITEM_WHAT[k]}</div>
                </td>
                <td style={TD}>
                  {LIMITS[k].full}
                  {UNIT[k]}まで
                </td>
                <td style={TD}>
                  {LIMITS[k].zero}
                  {UNIT[k]}
                </td>
                <td style={{ ...TD, color: 'var(--warn)' }}>
                  {LIMITS[k].cue}
                  {UNIT[k]}を越えたら
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Row>
          姿勢スコア{SCORE.good}点以上が「良い」、{SCORE.mid}点以上が「ふつう」、それ未満が「悪い」。
        </Row>
      </Step>

      <Step no="5" title="声をかける">
        <Row>
          直近{CUE.window}秒の平均が、声をかける線を越えていたら声をかける（その{CUE.window}秒のうち{pct(CUE.coverage)}以上の秒に記録があること）。
          <Mark>検証中</Mark>前かがみのようなはっきりした崩れは、{CUE.window}秒で十分に分かる。疲れて少しずつ崩れる変化を見るときは、30秒くらいの平均にする案がある。
        </Row>
        <Row>
          途切れの吸収：前かがみのまま走っていても、上体の角度は1歩ごとに前後に揺れ、骨格の推定もぶれるので、1秒ごとに見ると「線を越えた・戻った」が途切れ途切れになる。そこで、(1) 1秒の中の十数コマ（約3歩）を平均して1歩の中の揺れをならし、(2) 「{CUE.window}秒ずっと越えている」ではなく「{CUE.window}秒の平均が越えている」で決め（途中で1〜2秒戻っても数え直さない）、(3) 骨格が取れなかった秒があっても、{pct(CUE.coverage)}以上の秒に記録があれば判断する。
        </Row>
        <Row>優先順は、頭 → 上体 → 体全体 → 腰。一度に言うのは1つだけ。</Row>
        <Row>
          声をかけたら、どの項目でも{CUE.gap}秒はあける。同じ項目は{CUE.cooldown}秒あける。
        </Row>
        <Row>
          直ったらほめる：声をかけてから{CUE.recoverWithin}秒以内に、{CUE.recoverHold}秒続けて「満点の線と声をかける線の真ん中」より内側に戻ったら「いい感じです」。
        </Row>
      </Step>

      <Step no="6" title="ほめる・声なしで確認する時間">
        <Row>
          直近{PRAISE.window / 60}分の平均が{SCORE.good}点以上で、声をかけてから{PRAISE.afterCue}秒以上たっていたら「きれいな姿勢が続いています」。{PRAISE.window / 60}分に1回まで。
        </Row>
        <Row>
          直近{QUIET.enterWindow / 60}分の平均が{SCORE.good}点以上で、その間に声かけがなければ「ここからしばらく、声なしで確認します」。最初は{QUIET.first / 60}分、保てたら次は{QUIET.step / 60}分ずつ長くする（最長{QUIET.max / 60}分）。
        </Row>
        <Row>
          声なしの間も見続けていて、直近{QUIET.failWindow}秒の平均が{SCORE.mid}点を切ったら、声かけに戻る。
        </Row>
      </Step>

      <Step no="7" title="画面から外れたとき">
        <Row>
          走っている途中で外れたら、{ABSENCE.lostSay}秒で「戻ってください」。{ABSENCE.lostEnd}秒戻らなければ終わる。
        </Row>
        <Row>止まってから外れたら、{ABSENCE.stopEnd}秒で「おつかれさまでした」。</Row>
      </Step>

      <Step no="8" title="いつ見ているか（電池と発熱のため）">
        <Row>骨格を取るのは毎秒{POWER.maxFps}コマまで。画面は真っ暗にする。</Row>
        <Row>
          安定して走れている間は、{POWER.lookEvery}秒のうち{POWER.lookSec}秒だけ骨格を取る（声なしの確認の間は{POWER.lookEveryQuiet}秒のうち{POWER.lookSec}秒）。点数は時間で数えるので、間引いても割合は変わらない。
        </Row>
        <Row>
          次のときは毎コマ取る：走り始めの{POWER.warmup}秒、直近{POWER.recentBad}秒に声をかける線を越えた記録があるとき、声をかけた直後、止まっている・人が見えないとき。
        </Row>
      </Step>

      <Step no="9" title="結果画面">
        <Row>良い・ふつう・悪いの割合：1秒ごとの記録を、次の記録までの時間で重みを付けて数える。</Row>
        <Row>
          崩れ始め：{BREAKDOWN.minRun / 60}分以上走ったとき、{BREAKDOWN.window / 60}分平均の姿勢スコアが序盤より{BREAKDOWN.drop}点以上下がった最初の時刻。
        </Row>
        <Row>
          走り姿：{STRIDE.every}秒ごとに{STRIDE.sec}秒分の骨格を取り、良い・ふつう・悪いそれぞれの代表の1歩をアニメーションにする。
        </Row>
      </Step>

      <Step no="10" title="スロー動画の分析（走ったあと）">
        <Row>動画を1コマずつ止めて骨格を取る。足の高さが上下するリズムから1歩の長さを出し、実際のピッチが毎分130〜230歩に入るようにスローの倍率を決める。</Row>
        <Row>2本の足を、動画の最初から最後まで追う。骨格の推定は左右の名前を取り違えることがあるので、名前ではなく、前のコマからの動きで予想した位置に近いほうを同じ足とする。</Row>
        <Row>地面の線は足ごとに引く。スマホが腰の高さから少し見下ろすと、奥の足は地面に着いていても手前の足より画面の上で高く映るため（研究データの仮想実験で約25画素）。スマホの傾きに合わせて斜めにも引く。</Row>
        <Row>着地・離地：その足の一番低い点が、その足の地面の線から脚の長さの2%以内にある間を接地とする。着地はもう一方の足（または腰）より前で起きたものだけを数える。すねの角度は、はっきり見えている手前の脚の着地で測る。</Row>
      </Step>
    </section>
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const P = { margin: 0, fontSize: 15, lineHeight: 1.85, color: '#C9CFD5' } as const
const TH = { padding: '6px 4px', fontWeight: 500, borderBottom: '1px solid var(--line)' } as const
const TD = { padding: '8px 4px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' } as const

function Step({ no, title, children }: { no: string; title: string; children: ReactNode }) {
  return (
    <article className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="num" style={{ fontSize: 20, color: 'var(--accent)' }}>
          {no}
        </span>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{title}</h3>
      </div>
      {children}
    </article>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 14, lineHeight: 1.75, color: '#D5DADF' }}>・{children}</div>
}

function Mark({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 8, border: '1px solid #E0B341', color: '#E0B341', marginRight: 6, marginLeft: 2 }}>{children}</span>
}
