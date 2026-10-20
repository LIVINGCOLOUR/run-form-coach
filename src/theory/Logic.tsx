import type { ReactNode } from 'react'
import { LEVEL_LABEL, STEPS } from '../core/level'
import { ABSENCE, BREAKDOWN, CUE, HIP_REF, LEVEL, POWER, PRAISE, QUIET, RUNNING, SCORE } from '../core/params'
import { BASELINE, CORRECT, FORM, LIMITS, REL_LIMITS, SETUP, STRIDE } from '../modes/camera/params'
import { ITEM_KEYS } from '../core/types'
import { FORM_ORDER } from '../modes/camera/form'
import { PHRASES } from '../core/phrases'

// 判定のロジック：アプリが実際に使っている数字（params.ts）を、そのまま埋め込んで説明する
// 数字を直したら、このページの説明も自動で変わる

const ITEM_NAME = { head: '頭の位置', trunk: '上体の傾き', trunkBack: '上体の起きすぎ', body: '体全体の傾き', bodyBack: '体全体の起きすぎ', hip: '腰の高さ' } as const
const GROUP_NAME = { body: '体全体', trunk: '上体', head: '頭' } as const
const GROUP_WHAT = {
  body: '足首の中心→肩の中心の線の前傾',
  trunk: '腰の中心→肩の中心の線の前傾',
  head: '首の角度（手前側の肩→耳の前傾 − 腰→肩の前傾）と、頭の位置そのもの（肩→耳の前傾）',
} as const
const GROUP_LINE = {
  body: `${FORM.body.min}°より小さい（起きすぎ・体が後ろに残る）か、${FORM.body.max}°より大きい（倒れすぎ）`,
  trunk: `${FORM.trunk.max}°より大きい（前かがみ）か、${FORM.trunk.min}°より小さい（鉛直よりはっきり後ろ）`,
  head: `首の角度が${FORM.head.neck}°を越え、頭の位置も${FORM.head.headLean}°を越えた（頭が前）`,
} as const
const DRIFT = {
  head: `今日の基準から頭が前に出た量（首の角度の増えと、頭の位置の増えの、小さいほう）が +${LIMITS.head.cue}°`,
  trunk: `今日の基準から +${REL_LIMITS.trunk.cue}°（前かがみ）／−${REL_LIMITS.trunkBack.cue}°（起きすぎ）`,
  body: `今日の基準から +${REL_LIMITS.body.cue}°（倒れすぎ）／−${REL_LIMITS.bodyBack.cue}°（体が後ろに残る）`,
  hip: `今日の基準の腰の高さから ${LIMITS.hip.cue}% 下がった（脚の長さに対する割合）`,
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
          スマホの向きと高さ：下を向いている角度が{SETUP.pitchDownMax}°を超えたら「まっすぐ立てて」、まっすぐなのに腰が画面の高さの{pct(SETUP.hipLowMax)}より下に映ったら「腰の高さくらいまで下げて」、{pct(SETUP.hipHighMin)}より上に映ったら「腰の高さくらいまで上げて」と言い、直るまで先に進まない。研究データの仮想実験で、スマホが高く見下ろしているときと、後ろ側から撮ったときに、着地の角度が大きくずれた（高さ160cmで約37°、後ろ側30°で約31°）ため。スマホが低すぎると、見上げる形で頭が前に出て測れる（高さ50cmで約+9°）。
        </Row>
        <Row>
          真横に置けているか：左右の腰と肩の見え方（奥の腰・肩が手前より前に映れば前側から、後ろに映れば後ろ側から）を{SETUP.yawSmooth}秒ならし、脚の長さに対して+{SETUP.frontMax}を超えたら「走る向きと反対に少しずらして」、{SETUP.behindMax}未満なら「走る向きに少しずらして」と言い、直るまで先に進まない。真横から約8°以内にあたる。
          頭の位置は、スマホが前側に15°ずれるだけで約11°ずれて測れる（研究データ Riglet 2024 の23人で仮想実験）ため。立った姿勢での見分けは、1人あたり約±3°の精度だった。
        </Row>
        <Row>
          そろった状態が{SETUP.readyHold}秒続いたら次へ。案内は、同じ状態が{SETUP.hintStable}秒続いてから言い、同じ案内は{SETUP.hintRepeat}秒おきに繰り返す。声は重ねず、話し終わって1秒あけてから次を話す。
        </Row>
      </Step>

      <Step no="2" title="立った姿勢の確認（走るたびに行う）">
        <Row>
          止まってから{BASELINE.settle}秒待ち、そのあと{BASELINE.collect}秒の立ち姿勢を測る。「動いた」が{BASELINE.movingTolerance}秒未満なら数え直さない。
        </Row>
        <Row>
          この立ち姿勢は、走っているときの頭の判定には使わない。走ると上体だけが前に傾くので、首の角度は立ったときより平均8.8°小さく、人によって−24〜+13°と違う（研究データ Riglet 2024、23人）。立った姿勢と比べると、頭を前に出しても2割しか気づけなかった。
        </Row>
        <Row>
          猫背のチェック：肩→耳の前傾が{BASELINE.standingHead}°以下、腰→肩の前傾が{BASELINE.standingTrunk}°以下。越えていたら、大きくずれている1つだけ直し方を言って測り直す（{BASELINE.retries}回まで）。
        </Row>
      </Step>

      <Step no="3" title="走り出し・一時停止">
        <Row>
          足首が腰より一番前に出た瞬間を接地として数え、ピッチが毎分{RUNNING.runSpm}歩以上のコマを「走っている」とする。1コマずつではぶれる（トレッドミルの歩きでも、2割近いコマで{RUNNING.runSpm}歩以上に出た）ので、直近{RUNNING.ratioWindow}秒のコマの{Math.round(RUNNING.startRatio * 100)}%以上が「走っている」になったら走り出したとみなし、{Math.round(RUNNING.stopRatio * 100)}%を切ったら止まったとみなす。走り出した状態が{RUNNING.startAfter}秒続いたら始める（走り出してから約{Math.round(RUNNING.ratioWindow * RUNNING.startRatio + RUNNING.startAfter)}秒）。
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

      <Step no="4" title="走り出したら：正しいフォームへ整える">
        <Row>
          基準は「走り始めの自分」ではなく「正しいフォーム」。走り始めがもう崩れていたら、そこへ戻しても意味がないため。走り出して{FORM.from}秒たったら、歩数で走っていた秒の{FORM.window}秒平均を、次の線と比べる（線はアプリの骨格の点で測った値で決めた。研究データの印で測った値はそのまま使わない）。
        </Row>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--faint)', textAlign: 'left' }}>
              <th style={TH}>項目（直す順）</th>
              <th style={TH}>外れている</th>
            </tr>
          </thead>
          <tbody>
            {FORM_ORDER.map((g) => (
              <tr key={g}>
                <td style={TD}>
                  {GROUP_NAME[g]}
                  <div style={{ fontSize: 11, color: 'var(--faint)' }}>{GROUP_WHAT[g]}</div>
                </td>
                <td style={{ ...TD, color: 'var(--warn)' }}>{GROUP_LINE[g]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Row>
          体全体：人の動画（3R のトレッドミル）で、講師のよい例は7.0〜9.6°、作者が「上体が起きている」「ブレーキ」「腰落ち」「足を前に出す」と言う例は2.2〜5.4°。研究データ（楽なペース、約時速9km、30本）を仮想のスマホで映すと、本ごとの平均でいちばん小さい人が5.7°。線をよい例と崩しの間の低いほうにしたのは、線の際の人に、ぶれだけで声と「その形です」が行き来しないため（自分のトレッドミルの記録では、時速8kmのふつうの走りが{FORM.window}秒平均で5.1〜7.6°）。倒れすぎの側は、研究データでわざと前に倒したときの平均14.4°（ふつうは7〜13°）より少し上。
          上体：よい例は4.8〜9.9°、作者が「上体の突っ込み」と言う例は11.1〜11.4°。研究データのふつうの走りにも0°前後の人がいるので、後ろ側は鉛直よりはっきり後ろだけ（上体が起きる崩しは、体全体の線でも分かる）。
          頭：アプリの点では、よい姿勢でも大きく出る（講師のよい例で首22〜31°・頭の位置30〜38°、自分のトレッドミルのふつうの走りの{FORM.window}秒平均で最大43°・46°）ので、わざと前に出したとき（59°・68°）や猫背（52°・63°）のように、はっきり前に出たときだけ言う。首の角度だけだと上体が起きたときに、頭の位置だけだと体ごと前に倒したときに、頭は前に出ていなくても大きく出るので、両方が越えたときだけ。
        </Row>
        <Row>
          外れている項目は、優先の順（体全体 → 上体 → 頭）に1つずつ、何が起きているかと直し方を言う。体全体を足首から傾けると上体も同じだけ傾き、上体を変えると体全体もその半分ほど変わり（研究データ）、頭（首の角度）は上体に左右されるので、大きなところから直す。言ったあと{FORM.hold}秒の平均が線の内側に入ったら（線のすぐ際でのぶれで言わないよう、体全体{FORM.body.margin}°・上体{FORM.trunk.margin}°・頭{FORM.head.margin}°内側）「{PHRASES.formOk}」と伝え、{FORM.next}秒あけて次の項目へ。
          入らなければ{CUE.cooldown}秒ごとに言い直すが、1回の走りで{FORM.tries}回まで。それでも入らなければ、その走りではしつこく言わず、{FORM.later / 60}分に1回だけにする（結果の画面に出す）。
        </Row>
        <Row>
          全部が線の内側になったら「{PHRASES.formSet}」（言わずに済んだら、平均が{FORM.settle}秒続けて内側になったところで「{PHRASES.formGood}」）。入らなかった項目があるときは、整ったとは言わない。それまでは、ほかの声かけはしない。整えたあとも、線は走り終わるまで見続ける。どのレベルでも整える（フォームの土台なので）。見ているのは体の傾きと頭の位置だけなので（着地などは見ていない）、「姿勢」と言う。
        </Row>
        <Row>
          スマホが前側にずれて斜めから撮ると、頭は大きく出る（仮想実験で、前側に1°ずれるごとに首+0.72°・頭の位置+0.55°。上体と体全体はほとんど変わらない：−0.03°・−0.06°）。走っている間の「前側から／後ろ側から」の値の平均が{FORM.head.yawMax}（前側に約20°）を越えるときは、頭を線と比べない。
          ただし走っている間のこの値は、点の取り方でもずれる（自分の記録で、立っているとき0.00だった値が、腰の位置が変わらないまま歩き出した瞬間に+0.11、ジョグで+0.07〜0.08。講師の動画の走りは+0.01〜0.03）。スマホの向きのずれと見分けられないので、走っている間に「スマホを動かして」とは言わない（置き方は、立った姿勢で確かめている）。
        </Row>
        <Row>
          今日の基準：整え終わってから（走り出して{HIP_REF.from}秒より後）、歩数で走っていた秒のうち、その項目が線の内側にいた秒（直近{FORM.hold}秒の平均で見る）だけをためる。走り出して{HIP_REF.to / 60}分たち、整え終わってから{FORM.refAfter}秒たったら基準にする。線の内側にいた秒が{FORM.refMin}秒に足りない項目（直らなかった項目）は、走りの平均を線の内側に寄せた値、つまり線そのものを基準にする（頭をずっと線と比べられなかったとき（斜め）は、走りの平均）。腰の高さは、体全体と上体の両方が線の内側にいた秒（整えた形）で作る。基準ができる前に止まったら、次に走り出したところから整え直す（同じ項目の声の回数は、整え直しても数え続ける）。
        </Row>
      </Step>

      <Step no="5" title="1秒ごとの記録と点数">
        <Row>1秒のあいだに3コマ以上の骨格が取れたら、その平均を1秒分の記録にする。</Row>
        <Row>
          今日の基準ができたあとは、正しいフォームの線に加えて、基準からの崩れも見る（線の内側でも、整えた形から崩れたら知らせて、整えた形へ戻すため）。直近{CUE.window}秒の平均が次を越えたら声をかける。
        </Row>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--faint)', textAlign: 'left' }}>
              <th style={TH}>項目</th>
              <th style={TH}>声をかける崩れ</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(DRIFT) as (keyof typeof DRIFT)[]).map((k) => (
              <tr key={k}>
                <td style={TD}>{ITEM_NAME[k]}</td>
                <td style={{ ...TD, color: 'var(--warn)' }}>{DRIFT[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Row>
          研究データ（16人）で、ふつうに走ったときの上体の傾きは人により0.6〜8.8°とばらばらだが、わざと前に倒すと平均7.5°増えた（15人は約6〜13°）。決まった線だけでは、もともと前傾の大きい人の崩れ（線の内側での増え）を見逃すので、整えた形からの増え方でも見る。
          トレッドミルで撮った人の動画で、作者が「上体が起きている」「ブレーキ」「腰落ち」と言う走りは、よい例より上体が5.7〜9.4°、体全体が3.6〜9.0°後ろだった。起きすぎ（後ろ側）は、歩くと上体も体全体も起きるので、歩数で走っていた秒だけ判定する。
        </Row>
        <Row>
          頭が前に出た量は、首の角度の増えと、頭の位置そのものの増えの、小さいほう。首の角度だけだと、上体が起きた分だけ増えて、頭は動いていないのに「頭が前」になる（人の動画で、腰落ちの例が上体−9.4°・頭の位置+1.4°で、首の角度は+12.3°）。頭の位置そのものだけだと、体ごと前に倒しても増える。
          1秒ごとに0で切らずに平均してから比べる（頭は走りながら1秒ごとに約±4°動くので、0で切ると前に出た側だけが残り、実際より大きく出る）。立って測った姿勢とは比べない（走ると上体だけが前に傾くので、首の角度は立ったときより平均8.8°小さく、人によって−24〜+13°と違う。研究データ Riglet 2024、23人）。
        </Row>
        <Row>
          顎（耳→鼻の線の上向き）は、今日の基準からの変化を、上体が起きた分（頭も上体といっしょに回る）を差し引いて測り、記録するだけで声はかけない。人の動画では顎上げ+13°・顎引き−9°と分かれたが、顎を言っていない例でも−7〜+11°動いた。自分のトレッドミルの記録では、ふつうに走っているだけで6秒平均が−10〜+14°動いた（鼻と耳の点がぶれる）。
        </Row>
        <Row>
          点数：項目ごとに、線の内側なら100点、0点まで比例して下がる（正しいフォームの線は、内側の際から線まで、線から外へ体全体{FORM.body.span}°・上体{FORM.trunk.span}°・頭{FORM.head.span}°で0点）。姿勢スコアは、その秒に判定した項目の一番低い点（基準からの崩れと、正しいフォームの線の外れの、悪いほう）。{SCORE.good}点以上が「良い」、{SCORE.mid}点以上が「ふつう」、それ未満が「悪い」。
        </Row>
      </Step>

      <Step no="6" title="今日の基準からの崩れで声をかける">
        <Row>
          直近{CUE.window}秒の平均が、声をかける線を越えていたら声をかける（その{CUE.window}秒のうち{pct(CUE.coverage)}以上の秒に記録があること）。
          <Mark>検証中</Mark>前かがみのようなはっきりした崩れは、{CUE.window}秒で十分に分かる。疲れて少しずつ崩れる変化を見るときは、30秒くらいの平均にする案がある。
        </Row>
        <Row>
          途切れの吸収：前かがみのまま走っていても、上体の角度は1歩ごとに前後に揺れ、骨格の推定もぶれるので、1秒ごとに見ると「線を越えた・戻った」が途切れ途切れになる。そこで、(1) 1秒の中の十数コマ（約3歩）を平均して1歩の中の揺れをならし、(2) 「{CUE.window}秒ずっと越えている」ではなく「{CUE.window}秒の平均が越えている」で決め（途中で1〜2秒戻っても数え直さない）、(3) 骨格が取れなかった秒があっても、{pct(CUE.coverage)}以上の秒に記録があれば判断する。
        </Row>
        <Row>優先順は、{ITEM_KEYS.map((k) => ITEM_NAME[k]).join(' → ')}。一度に言うのは1つだけ（正しいフォームの線の声と合わせて）。</Row>
        <Row>
          言葉は、体の部位ではなく「たとえ」で言う。走りながら自分の脚の動きや呼吸に意識を向けると走りの効率が落ち（Schücker ら 2009）、たとえで覚えた動きは疲れても崩れにくいため。
          前かがみには、背中が丸まり肩が前に落ちる形（猫背）、股関節から折れる形、足首から体ごと倒れる形がある。上体には「胸のライトで前を照らす」（胸が前を向き、「胸を張る」と違って腰を反らせにくい）、体全体と腰には「上から吊られるように」を使う。
          起きすぎには「少しだけ前に」と言い、前かがみの言葉と取り違えて強く倒さないようにする。
          トレッドミルでは足元や操作パネルを見て頭が下がりやすいので、立ち姿勢の確認と走り出しで「目線は正面に」と言う。
        </Row>
        <Row>
          ランナーのレベル：基準からの崩れで声をかける項目を、{LEVEL_LABEL.beginner}は1つずつ足していく（{STEPS.map((x) => x.title).join(' → ')} → すべて）。{LEVEL_LABEL.intermediate}は2つ目から、{LEVEL_LABEL.advanced}は最初からすべて見る。上体・体全体の起きすぎ（基準から後ろへの崩れ）は、腰の段階で足す（腰が落ちる走りは、上体が起きる形に出ることが多い）。
          正しいフォームの線で整える声は、どのレベルでもかける（フォームの土台なので。それでも一度に1つずつ）。
          走り出す前の立ち姿勢の確認のあとに、今日意識することを1つだけ言う。いま足した項目で声がかからない走り（{Math.round(LEVEL.minRunSec / 60)}分以上）が{LEVEL.advanceAfter}回続いたら、次の項目を足し、次の走り出しでそれを伝える。
          まだ注意していない項目も測って記録し、大きく崩れたとき（その項目の点数が{SCORE.mid}点未満）だけ声をかける。一度に意識できるのは1つなので、全部を言うと、どれも残らないため。
        </Row>
        <Row>
          声をかけたら、どの項目でも{CUE.gap}秒はあける。同じ項目は{CUE.cooldown}秒あける（正しいフォームの線の声と、基準からの崩れの声を合わせて数える）。
        </Row>
        <Row>
          直ったらほめる：声をかけてから{CUE.recoverWithin}秒以内に、{CUE.recoverHold}秒続けて「満点の線と声をかける線の真ん中」より内側に戻ったら「いい感じです」。
        </Row>
      </Step>

      <Step no="7" title="ほめる・声なしで確認する時間">
        <Row>
          直近{PRAISE.window / 60}分の平均が{SCORE.good}点以上で、声をかけてから{PRAISE.afterCue}秒以上たっていたら「きれいな姿勢が続いています」。{PRAISE.window / 60}分に1回まで。
        </Row>
        <Row>
          今日の基準ができてから{QUIET.enterWindow / 60}分たち、直近{QUIET.enterWindow / 60}分の平均が{SCORE.good}点以上で、その間に声かけがなければ「ここからしばらく、声なしで確認します」（整えた形と比べた判定で安定していたかを見るため、早くて{(HIP_REF.to + QUIET.enterWindow) / 60}分から）。最初は{QUIET.first / 60}分、保てたら次は{QUIET.step / 60}分ずつ長くする（最長{QUIET.max / 60}分）。
        </Row>
        <Row>
          声なしの間も見続けていて、声をかける項目が線を越えたら（直近{CUE.window}秒の平均。正しいフォームの線は{FORM.window}秒の平均）、すぐに声かけに戻ってその項目を言う。ほかの項目も含めて直近{QUIET.failWindow}秒の平均が{SCORE.mid}点を切ったときも、声かけに戻る。点数の平均が下がるのを待つだけだと、小さな崩れに気づけないため（仮想実験で、見守り中は頭を6°前に出しても見つけたのは4割だった）。スマホ版のピッチ（メトロノームで知らせる項目）は、点数の平均で戻る。
        </Row>
      </Step>

      <Step no="8" title="画面から外れたとき">
        <Row>
          走っている途中で外れたら、{ABSENCE.lostSay}秒で「戻ってください」。{ABSENCE.lostEnd}秒戻らなければ終わる。
        </Row>
        <Row>止まってから外れたら、{ABSENCE.stopEnd}秒で「おつかれさまでした」。</Row>
      </Step>

      <Step no="9" title="スマホの傾きの補正">
        <Row>傾きセンサーで、スマホの左右の傾きを戻してから骨格を測る。</Row>
        <Row>
          スマホが{CORRECT.pitchDownFrom}°を超えて下を向いているとき（または{-CORRECT.pitchUpFrom}°を超えて上を向いているとき）は、上下の向きとレンズの画角（超広角{CORRECT.vfovUltra}°・1倍{CORRECT.vfovNormal}°）から、「まっすぐ立てて撮ったら」の位置に骨格の点を戻す。仮想実験で、高さ120cmから見下ろしたときの着地のすねのずれが約17°から約7°に減った。少し上を向いているだけのときは、直すとかえって少しずれたので直さない。
        </Row>
      </Step>

      <Step no="10" title="いつ見ているか（電池と発熱のため）">
        <Row>骨格を取るのは毎秒{POWER.maxFps}コマまで。画面は真っ暗にする。</Row>
        <Row>
          安定して走れている間は、{POWER.lookEvery}秒のうち{POWER.lookSec}秒だけ骨格を取る（声なしの確認の間は{POWER.lookEveryQuiet}秒のうち{POWER.lookSec}秒）。点数は時間で数えるので、間引いても割合は変わらない。
        </Row>
        <Row>
          次のときは毎コマ取る：今日の基準ができるまで（カメラ版。整える間と、走り出し・止まりを続けて見て決めるため）、走り始めの{POWER.warmup}秒、直近{POWER.recentBad}秒に声をかける線を越えた記録があるとき、正しいフォームの線を越えている・直るのを待っているとき、声をかけた直後、止まっている・人が見えないとき。
        </Row>
      </Step>

      <Step no="11" title="結果画面">
        <Row>
          一番上は「声なしで保てた時間」：声なしで確認している間に、良い姿勢（{SCORE.good}点以上）で走れた時間。前回より増えたか減ったかも出す。声なしの確認に一度も入らなかった走りでは、0 ではなく、入る条件（基準ができてから{QUIET.enterWindow / 60}分、声かけなしで良い姿勢が続く）を添えて、次の目標として出す。
        </Row>
        <Row>良い・ふつう・悪いの割合：1秒ごとの記録を、次の記録までの時間で重みを付けて数える。</Row>
        <Row>
          正しいフォームとの比べ：項目ごとに、走っていた秒の平均と正しいフォームの範囲を並べる（例：体全体の前傾 あなた 5°／正しいフォーム {FORM.body.min}〜{FORM.body.max}°）。整える間に直ったか、直らなかったかも出す。次に走る前の「今日の意識」と、走り姿の「次の一歩」は、正しいフォームから一番離れていた項目を1つだけ選ぶ（離れ方は、項目ごとの0点までの幅で割って比べる）。
        </Row>
        <Row>
          崩れ始め：{BREAKDOWN.minRun / 60}分以上走ったとき、{BREAKDOWN.window / 60}分平均の姿勢スコアが序盤より{BREAKDOWN.drop}点以上下がった最初の時刻。
        </Row>
        <Row>
          走り姿：{STRIDE.every}秒ごとに{STRIDE.sec}秒分の骨格を取り、良い・ふつう・悪いそれぞれの代表の1歩をアニメーションにする。
        </Row>
      </Step>

      <Step no="12" title="スロー動画の分析（走ったあと）">
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
