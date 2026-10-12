#!/bin/bash
# プログラムを XIAO に書き込む
#   使い方： tools/flash.sh 01_blink
#   ポートを指定するとき： tools/flash.sh 01_blink /dev/cu.usbmodem1101
set -e
cd "$(dirname "$0")/.."
if [ -z "$1" ]; then echo "使い方: tools/flash.sh 01_blink"; exit 1; fi
SKETCH="firmware/$1"
URL=https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
FQBN=Seeeduino:nrf52:xiaonRF52840
export PATH="$PWD/tools/bin:$PATH"

echo "== コンパイルします: $SKETCH"
arduino-cli compile --additional-urls "$URL" --fqbn "$FQBN" "$SKETCH"

PORT="${2:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}"
if [ -z "$PORT" ]; then
  echo "XIAO が見つかりません。ケーブル（データ転送対応か）を確かめ、XIAO のリセットボタンを素早く2回押してから、もう一度実行してください"
  exit 1
fi
echo "== 書き込みます: $PORT"
arduino-cli upload --additional-urls "$URL" --fqbn "$FQBN" -p "$PORT" "$SKETCH"
echo "== 書き込みました"
