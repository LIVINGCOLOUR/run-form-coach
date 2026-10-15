#!/bin/bash
# プログラムを XIAO に書き込む
#   使い方： tools/flash.sh 01_blink
#   何個目かを付けるとき（03_ble_imu）： tools/flash.sh 03_ble_imu 2   → RFC-IMU-2 という名前になる
#   ポートを指定するとき： tools/flash.sh 01_blink /dev/cu.usbmodem1101
#   コンパイルだけ（書き込まない）： tools/flash.sh 03_ble_imu 2 --compile-only
set -e
cd "$(dirname "$0")/.."
if [ -z "$1" ]; then echo "使い方: tools/flash.sh 01_blink　／　tools/flash.sh 03_ble_imu 2"; exit 1; fi
SKETCH="firmware/$1"
shift
URL=https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
FQBN=Seeeduino:nrf52:xiaonRF52840
export PATH="$PWD/tools/bin:$PATH"

ID=""
PORT=""
COMPILE_ONLY=""
for a in "$@"; do
  case "$a" in
    /dev/*) PORT="$a" ;;
    [1-9]) ID="$a" ;;
    --compile-only) COMPILE_ONLY=1 ;;
    *) echo "わからない引数です: $a（番号は 1〜9、ポートは /dev/cu.usbmodem…）"; exit 1 ;;
  esac
done

FLAGS=()
if [ -n "$ID" ]; then
  FLAGS=(--build-property "compiler.cpp.extra_flags=-DIMU_ID=$ID")
  echo "== 名前: RFC-IMU-$ID"
elif [ "$SKETCH" = "firmware/03_ble_imu" ]; then
  echo "== 番号を付けなかったので、名前は RFC-IMU-1 になります（2個目からは tools/flash.sh 03_ble_imu 2 のように番号を付ける）"
fi

echo "== コンパイルします: $SKETCH"
arduino-cli compile --additional-urls "$URL" --fqbn "$FQBN" "${FLAGS[@]}" "$SKETCH"
if [ -n "$COMPILE_ONLY" ]; then echo "== コンパイルできました（書き込みはしていません）"; exit 0; fi

PORT="${PORT:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}"
if [ -z "$PORT" ]; then
  echo "XIAO が見つかりません。ケーブル（データ転送対応か）を確かめ、XIAO のリセットボタンを素早く2回押してから、もう一度実行してください"
  exit 1
fi
echo "== 書き込みます: $PORT"
arduino-cli upload --additional-urls "$URL" --fqbn "$FQBN" -p "$PORT" "$SKETCH"
echo "== 書き込みました"
