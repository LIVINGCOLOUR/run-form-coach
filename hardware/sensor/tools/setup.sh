#!/bin/bash
# 最初に1回だけ実行する：書き込みに要るものをそろえる
set -e
cd "$(dirname "$0")/.."
URL=https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json

# 1. Rosetta（Apple シリコンの Mac で、Intel 向けのコンパイラーを動かすため）
if [ "$(uname -m)" = "arm64" ] && ! /usr/bin/pgrep -q oahd; then
  echo "== Rosetta を入れます"
  softwareupdate --install-rosetta --agree-to-license
fi

# 2. Arduino のコマンド版
if ! command -v arduino-cli >/dev/null; then
  echo "== arduino-cli を入れます"
  brew install arduino-cli
fi

# 3. XIAO nRF52840 のボードのパッケージ（Seeed nRF52 Boards）
echo "== XIAO nRF52840 のボードのパッケージを入れます"
arduino-cli core update-index --additional-urls "$URL"
arduino-cli core install Seeeduino:nrf52 --additional-urls "$URL"

# 4. ボードのパッケージは "python" という名前を呼ぶが、Mac には python3 しかないので、つなぐ
mkdir -p tools/bin
ln -sf "$(command -v python3)" tools/bin/python

echo "== 準備ができました"
