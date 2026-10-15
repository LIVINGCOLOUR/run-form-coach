#!/bin/bash
# 手順書の PDF を作り直す：docs/manual.html → docs/manual.pdf
#   使い方： tools/make_pdf.sh
#   デスクトップにも置くとき： tools/make_pdf.sh ~/Desktop/センサー1個目の作り方.pdf
# 付録B の __BLE_SKETCH__ に、今の firmware/03_ble_imu/03_ble_imu.ino を差し込んでから、
# Google Chrome のヘッドレスで印刷する（manual.html そのものは書き換えない）
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then echo "Google Chrome が見つかりません: $CHROME"; exit 1; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# スケッチを HTML 用に（& < > を置き換えて）差し込む。画像などの相対パスが効くよう docs/ と同じ場所の扱いにする
python3 - "$TMP/manual.html" <<'EOF'
import html, sys
src = open('docs/manual.html', encoding='utf-8').read()
sketch = open('firmware/03_ble_imu/03_ble_imu.ino', encoding='utf-8').read()
assert src.count('__BLE_SKETCH__') == 1, 'manual.html に __BLE_SKETCH__ が1か所だけあるはず'
out = src.replace('__BLE_SKETCH__', html.escape(sketch.rstrip('\n'), quote=False))
out = out.replace('<head>', '<head>\n<base href="file://' + __import__('os').path.abspath('docs') + '/">', 1)
open(sys.argv[1], 'w', encoding='utf-8').write(out)
EOF

"$CHROME" --headless --disable-gpu --no-pdf-header-footer --user-data-dir="$TMP/profile" \
  --print-to-pdf="$TMP/manual.pdf" "file://$TMP/manual.html" 2>/dev/null
[ -s "$TMP/manual.pdf" ] || { echo "PDF ができませんでした"; exit 1; }

cp "$TMP/manual.pdf" docs/manual.pdf
echo "== docs/manual.pdf を作りました"
if [ -n "$1" ]; then cp "$TMP/manual.pdf" "$1"; echo "== $1 にも置きました"; fi
