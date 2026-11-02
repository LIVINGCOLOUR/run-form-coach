#!/bin/bash
# センサーに自動でつなぎ、声の合図でテストを進める（中身は tools/coach.py）
#   使い方： tools/coach.sh　／　動作確認： tools/coach.sh --dry --fast
# 初めてのときは、Python の部品（bleak・numpy）を tools/.venv に入れる
cd "$(dirname "$0")/.."
if [ ! -x tools/.venv/bin/python ]; then
  echo "== 初めてなので準備します"
  python3 -m venv tools/.venv && tools/.venv/bin/pip install -q bleak numpy || exit 1
fi
exec tools/.venv/bin/python tools/coach.py "$@"
