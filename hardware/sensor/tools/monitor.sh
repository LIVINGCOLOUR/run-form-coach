#!/bin/bash
# XIAO が出す文字を見る（シリアルモニタ）。終わるときは Ctrl+C
set -e
PORT="${1:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}"
if [ -z "$PORT" ]; then echo "XIAO が見つかりません"; exit 1; fi
arduino-cli monitor -p "$PORT" -c baudrate=115200
