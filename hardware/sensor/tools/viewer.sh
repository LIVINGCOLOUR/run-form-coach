#!/bin/bash
# Bluetooth で値を受ける画面を開く。終わるときは Ctrl+C
# Web Bluetooth は https か localhost でしか動かないので、手元でサーバーを立てる
# ?v= を毎回変えるのは、Chrome が古い viewer.html を覚えたまま使うのを防ぐため（2026-10-14 に実際に起きた）
cd "$(dirname "$0")/../viewer"
( sleep 1; open -a "Google Chrome" "http://localhost:8000/viewer.html?v=$(date +%s)" ) &
python3 -m http.server 8000
