#!/bin/bash
# 03_ble_imu を Bluetooth で書き換える（USB につながない。中身は tools/ota.py）
#   使い方： tools/ota.sh 2     → RFC-IMU-2 を、いまの firmware/03_ble_imu で書き換える（1個あたり約1分半）
#   初めの1回だけは USB（tools/flash.sh）で、無線での書き換えに対応した 03_ble_imu を入れておく
set -e
cd "$(dirname "$0")/.."
if [ -z "$1" ]; then echo "使い方: tools/ota.sh 2"; exit 1; fi
export PATH="$PWD/tools/bin:$PATH"
OUT=$(mktemp -d)
echo "== コンパイルします: RFC-IMU-$1"
arduino-cli compile --additional-urls https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json \
  --fqbn Seeeduino:nrf52:xiaonRF52840 --build-property "compiler.cpp.extra_flags=-DIMU_ID=$1" \
  --output-dir "$OUT" firmware/03_ble_imu > /dev/null
[ -x tools/.venv/bin/python ] || { python3 -m venv tools/.venv && tools/.venv/bin/pip install -q bleak numpy; }
tools/.venv/bin/python tools/ota.py "RFC-IMU-$1" "$OUT/03_ble_imu.ino.zip"
rm -rf "$OUT"
