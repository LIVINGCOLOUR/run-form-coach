#!/usr/bin/env python3
# 03_ble_imu を Bluetooth で書き換える（USB につながない）
#   使い方： tools/ota.sh 2        （RFC-IMU-2 を、いまの firmware/03_ble_imu で書き換える）
#   中身：Nordic の古い形の DFU（SDK 11、Adafruit のブートローダーが使う形）。手順は
#     1. アプリの DFU サービス（0x1530）に「ブートローダーへ」と書く → XIAO が再起動して「AdaDFU」の名前で待つ
#     2. AdaDFU につなぎ、大きさ → 初めの情報（.dat）→ 本体（.bin を20バイトずつ）→ 確かめる → 切り替える
#   途中で失敗しても、ブートローダーは残るので、USB（tools/flash.sh）でいつでも戻せる
import asyncio
import json
import os
import struct
import sys
import time
import zipfile

from bleak import BleakClient, BleakScanner

DFU_SERVICE = "00001530-1212-efde-1523-785feabcd123"
DFU_CTRL = "00001531-1212-efde-1523-785feabcd123"
DFU_PACKET = "00001532-1212-efde-1523-785feabcd123"
PRN = 8  # これだけ送るごとに、受け取った量を知らせてもらう（送りすぎて取りこぼさないように）
CHUNK = 20


async def find(match, timeout=30):
    hit = None

    def cb(d, a):
        nonlocal hit
        if hit is None and match(d, a):
            hit = d

    s = BleakScanner(detection_callback=cb)
    await s.start()
    t0 = time.time()
    while hit is None and time.time() - t0 < timeout:
        await asyncio.sleep(0.3)
    await s.stop()
    return hit


async def main(name, zip_path):
    z = zipfile.ZipFile(zip_path)
    app = json.loads(z.read("manifest.json"))["manifest"]["application"]
    image, init = z.read(app["bin_file"]), z.read(app["dat_file"])
    print(f"== {name} を書き換えます（{len(image)} バイト）")

    # 1. アプリからブートローダーへ（前に途中で止まって、もうブートローダーで待っているときは飛ばす）
    is_boot = lambda d, a: DFU_SERVICE in [u.lower() for u in a.service_uuids] or (a.local_name or "").startswith("AdaDFU")
    dev = await find(lambda d, a: (a.local_name or d.name) == name or is_boot(d, a))
    if dev and (dev.name or "").startswith("AdaDFU"):
        print("== もうブートローダーで待っています")
    elif not dev:
        sys.exit(f"{name} が見つかりません（電源、10分たって眠っていないか、ほかにつながっていないか）")
    else:
        async with BleakClient(dev) as c:
            if not any(s.uuid == DFU_SERVICE for s in c.services):
                sys.exit("このファームは無線での書き換えに対応していません（一度 USB で今の 03_ble_imu を書き込む）")
            await c.start_notify(DFU_CTRL, lambda *_: None)
            try:
                await c.write_gatt_char(DFU_CTRL, bytes([0x01, 0x04]), response=True)
            except Exception:
                pass  # すぐ再起動するので、返事の前に切れることがある
        print("== ブートローダーに切り替えました。AdaDFU を探します")
        await asyncio.sleep(2)

    # 2. ブートローダーに送る
    boot = await find(lambda d, a: DFU_SERVICE in [u.lower() for u in a.service_uuids] or (a.local_name or "").startswith("AdaDFU"))
    if not boot:
        sys.exit("AdaDFU が見つかりません。USB（tools/flash.sh）で書き込み直してください")
    q = asyncio.Queue()
    async with BleakClient(boot, timeout=20) as c:
        await c.start_notify(DFU_CTRL, lambda _, d: q.put_nowait(bytes(d)))

        async def expect(op):
            while True:
                r = await asyncio.wait_for(q.get(), 30)
                if r[0] == 0x10 and r[1] == op:
                    if r[2] != 1:
                        raise RuntimeError(f"手順 {op} で失敗（返事 {r.hex()}）")
                    return

        await c.write_gatt_char(DFU_CTRL, bytes([0x01, 0x04]), response=True)  # 始める：アプリだけ
        await c.write_gatt_char(DFU_PACKET, struct.pack("<III", 0, 0, len(image)), response=False)
        await expect(0x01)
        await c.write_gatt_char(DFU_CTRL, bytes([0x02, 0x00]), response=True)  # 初めの情報
        await c.write_gatt_char(DFU_PACKET, init, response=False)
        await c.write_gatt_char(DFU_CTRL, bytes([0x02, 0x01]), response=True)
        await expect(0x02)
        await c.write_gatt_char(DFU_CTRL, bytes([0x08]) + struct.pack("<H", PRN), response=True)
        await c.write_gatt_char(DFU_CTRL, bytes([0x03]), response=True)  # 本体を送る
        t0 = time.time()
        sent = 0
        done = False  # 最後の束では、受け取った量の知らせより先に「受け取り終えた」が来ることがある
        for i in range(0, len(image), CHUNK):
            await c.write_gatt_char(DFU_PACKET, image[i:i + CHUNK], response=False)
            sent += 1
            if sent % PRN == 0:
                while True:
                    r = await asyncio.wait_for(q.get(), 30)
                    if r[0] == 0x11:
                        break
                    if r[:3] == bytes([0x10, 0x03, 0x01]):
                        done = True
                        break
                    if r[0] == 0x10:
                        raise RuntimeError(f"送る途中で止まりました（返事 {r.hex()}）")
            if sent % 500 == 0:
                print(f"  {i * 100 // len(image)}%（{time.time() - t0:.0f} 秒）", flush=True)
        if not done:
            await expect(0x03)
        print(f"== 送り終えました（{time.time() - t0:.0f} 秒）。確かめています")
        await c.write_gatt_char(DFU_CTRL, bytes([0x04]), response=True)
        await expect(0x04)
        try:
            await c.write_gatt_char(DFU_CTRL, bytes([0x05]), response=True)  # 切り替えて再起動
        except Exception:
            pass
    print("== 書き換えました。新しいファームで起動します")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
