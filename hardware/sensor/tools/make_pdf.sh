#!/bin/bash
# 手順書の PDF を作り直す：docs/<名前>.html → docs/<名前>.pdf
#   使い方： tools/make_pdf.sh                    （docs/manual.html → docs/manual.pdf）
#            tools/make_pdf.sh manual-haptic      （docs/manual-haptic.html → docs/manual-haptic.pdf）
#   デスクトップにも置くとき： tools/make_pdf.sh ~/Desktop/センサー1個目の作り方.pdf
#                              tools/make_pdf.sh manual-haptic ~/Desktop/センサー振動つきの作り方.pdf
# HTML の中の印を、今のプログラムに差し替えてから、Google Chrome のヘッドレスで印刷する（HTML そのものは書き換えない）
#   __BLE_SKETCH__          → firmware/03_ble_imu/03_ble_imu.ino
#   __SKETCH:<フォルダ名>__ → firmware/<フォルダ名>/<フォルダ名>.ino
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then echo "Google Chrome が見つかりません: $CHROME"; exit 1; fi

NAME=manual
if [ -n "$1" ] && [ "${1%.pdf}" = "$1" ]; then NAME="$1"; shift; fi
SRC="docs/$NAME.html"
[ -f "$SRC" ] || { echo "$SRC がありません"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# スケッチを HTML 用に（& < > を置き換えて）差し込む。画像などの相対パスが効くよう docs/ と同じ場所の扱いにする
python3 - "$SRC" "$TMP/doc.html" <<'EOF'
import html, os, re, sys
src = open(sys.argv[1], encoding='utf-8').read()
def sketch(name):
    return html.escape(open(f'firmware/{name}/{name}.ino', encoding='utf-8').read().rstrip('\n'), quote=False)
assert src.count('__BLE_SKETCH__') <= 1, '__BLE_SKETCH__ は1か所まで'
out = src.replace('__BLE_SKETCH__', sketch('03_ble_imu'))
out = re.sub(r'__SKETCH:([0-9A-Za-z_]+)__', lambda m: sketch(m.group(1)), out)
out = out.replace('<head>', '<head>\n<base href="file://' + os.path.abspath('docs') + '/">', 1)
open(sys.argv[2], 'w', encoding='utf-8').write(out)
EOF

"$CHROME" --headless --disable-gpu --no-pdf-header-footer --user-data-dir="$TMP/profile" \
  --print-to-pdf="$TMP/doc.pdf" "file://$TMP/doc.html" 2>/dev/null
[ -s "$TMP/doc.pdf" ] || { echo "PDF ができませんでした"; exit 1; }

cp "$TMP/doc.pdf" "docs/$NAME.pdf"
echo "== docs/$NAME.pdf を作りました"
if [ -n "$1" ]; then cp "$TMP/doc.pdf" "$1"; echo "== $1 にも置きました"; fi
