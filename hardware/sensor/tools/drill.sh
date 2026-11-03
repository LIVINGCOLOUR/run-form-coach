#!/bin/bash
# ランフォームコーチで走るときの、崩し方の声の指示（約9分）。センサーにはつながない（つなぐのは iPhone のアプリ）
#   使い方： tools/drill.sh　／　動作確認： tools/drill.sh --fast（10分の1の長さ）
# 区切りの時刻を records/drill-<日時>.csv に残す（アプリの記録と突き合わせる用）
cd "$(dirname "$0")/.."
VOICE=Kyoko
SCALE=1
[ "$1" = "--fast" ] && SCALE=10

# 秒数|最初に言うこと
PHASES=(
  "60|走り出してください。速さを決めたら、最後まで変えないでください"
  "120|ふつうに走ってください。いまアプリが基準を作っています"
  "60|足を前に出して、ブレーキをかけるように走ってください"
  "60|ふつうに戻してください"
  "60|猫背で走ってください。胸が震えるか、気をつけてください"
  "60|ふつうに戻して、胸を張ってください。胸が震えなければ成功です"
  "60|胸は張ったまま、頭だけ前に出してください。頭が震えるか、気をつけてください"
  "60|ふつうに戻してください。これが最後です"
)

mkdir -p records
LOG="records/drill-$(date +%Y%m%d-%H%M%S).csv"
echo "start_epoch_ms,sec,text" > "$LOG"

say -v $VOICE "アプリで始めるを押したら、エンターキーを押してください" &
read -r -p "アプリで「始める」を押したら Enter > "
say -v $VOICE "始めます"

for p in "${PHASES[@]}"; do
  sec=$(( ${p%%|*} / SCALE )); text=${p#*|}
  echo "$(( $(date +%s) * 1000 )),$sec,$text" >> "$LOG"
  echo "$(date +%H:%M:%S)  ${text}（$((sec))秒）"
  say -v $VOICE "$text" &
  rest=$sec
  # 区切りの10秒前に知らせる
  if [ $sec -gt 15 ]; then
    sleep $(( sec - 10 )); rest=10
    say -v $VOICE "あと10秒で切り替えます" &
  fi
  sleep $rest
done

say -v $VOICE "おしまいです。お疲れさまでした。アプリで終わるを押してください"
echo "おしまい。区切りの記録： $LOG"
