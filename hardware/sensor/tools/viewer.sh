#!/bin/bash
# Bluetooth で値を受ける画面を開く。終わるときは Ctrl+C
# Web Bluetooth は https か localhost でしか動かないので、手元でサーバーを立てる
cd "$(dirname "$0")/../viewer"
( sleep 1; open -a "Google Chrome" "http://localhost:8000/viewer.html" ) &
python3 -m http.server 8000
