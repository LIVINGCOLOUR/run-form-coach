#!/usr/bin/env python3
# センサーに自動でつなぎ、声の合図でテストを進め、猫背になったら胸を震わせる
#   使い方： tools/coach.sh            （つなぐ操作はいらない。スイッチを入れて付けておくだけ）
#           tools/coach.sh --dry       （声と区切りだけ。センサーは受信画面でつなぎ、記録もそちらで取る。区切りの時刻は phases.csv）
#   記録は records/日時/ に imu.csv（受けた値すべて）と summary.txt（区切りごとのまとめ）
#
# 猫背の見分け方：最初の「立つ」で胸のセンサーの重力の向きを覚え、そこからの傾きを出す。
#   次の「ふつうに走る」で、その人の走るときの前傾（傾きの平均）を覚える。走る前傾は人と速さで変わるので、線はそこから決める
#   そのあとの走る区切りで、傾きが「走る前傾 + MARGIN_DEG」を HOLD_S 秒続けて超えたら、胸を 1秒 震わせる（COOLDOWN_S 秒あける）
#   2026-11-02 のトレッドミル：ふつうに走って胸 約16°、猫背 約28°、胸を張って 約18°。立った姿勢からの固定の 18° では、ふつうの走りでも鳴った
# 区切りはトレッドミル向け：ベルトはゆっくり動き出し、ゆっくり止まるので、走ったまま姿勢だけ変える。止めるのは最後だけ
# 振動は 03_ble_imu の 0xFFE3（2バイト：回数、長さ×10ミリ秒）。古いファームの個体は震えない（猫背の合図は声「胸を張って」に代える）。測るのは続く
import argparse
import asyncio
import csv
import math
import os
import struct
import subprocess
import sys
import time
from datetime import datetime

import numpy as np
from bleak import BleakClient, BleakScanner

# 付ける場所と、そこに付けているセンサー（viewer/viewer.html の SLOTS と同じ）
SLOTS = [
    ("頭", "RFC-IMU-1"),
    ("胸", "RFC-IMU-2"),
    ("左手首", "RFC-IMU-4"),
    ("左足首", "RFC-IMU-3"),
    ("右足首", "RFC-IMU-6"),
]
CHEST = "RFC-IMU-2"
HEAD = "RFC-IMU-1"
LEFT_ANKLE = "RFC-IMU-3"
RIGHT_ANKLE = "RFC-IMU-6"

MARGIN_DEG = 8.0
HOLD_S = 1.5
COOLDOWN_S = 4.0

# 区切り：名前、秒数、始めるときに言うこと、役目
#   stand = 立った姿勢を覚える、run = 走る前傾を覚える、cue = 猫背で知らせる、
#   feel = 予告なしに1個ずつ1秒震わせる（走りながら、どこが震えたか気づけるか。順番は summary.txt に残す）
PHASES = [
    ("立つ", 15, "ベルトの横に足を置いて、まっすぐ立ってください。いまの姿勢を覚えます", "stand"),
    ("走り出す", 30, "ベルトを動かして、ゆっくり走り出してください", None),
    ("ふつうに走る", 40, "ふつうに走ってください。いつもの走り方を覚えます", "run"),
    ("猫背で走る", 40, "猫背で走ってください。背中を丸めて、あごを前に。合図が来ても、そのまま続けてください", "cue"),
    ("ふつうに走る", 30, "ふつうの走りに戻してください", "cue"),
    ("胸を張って走る", 40, "胸を張って走ってください", "cue"),
    ("ふつうに走る", 30, "ふつうの走りに戻してください", "cue"),
    ("振動に気づくか", 60, "ふつうに走ったまま、震えたところと順番を覚えておいてください", "feel"),
    ("止める", 30, "ベルトを止めて、止まったら、まっすぐ立ってください", None),
]

SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb"
IMU_CHAR = "0000ffe1-0000-1000-8000-00805f9b34fb"
BAT_CHAR = "0000ffe2-0000-1000-8000-00805f9b34fb"
BUZZ_CHAR = "0000ffe3-0000-1000-8000-00805f9b34fb"
HEADER_LEN = 7
SAMPLE_LEN = 13
G_SCALE = 0.07
A_SCALES = {8: 0.000244, 16: 0.000488}
VOICE = "Kyoko"
SCAN_S = 30  # これだけ探して見つからないセンサーは、無いものとして進める


def say(text, wait=False):
    print("  🔈 " + text)
    p = subprocess.Popen(["say", "-v", VOICE, text])
    if wait:
        p.wait()


def parse_packet(data):
    # viewer/viewer.html の parsePacket と同じ形（03_ble_imu の先頭のコメント）
    n = (len(data) - HEADER_LEN) // SAMPLE_LEN
    if len(data) < HEADER_LEN + SAMPLE_LEN or (len(data) - HEADER_LEN) % SAMPLE_LEN:
        return 0, []
    seq, t0, rng = struct.unpack_from("<HIB", data, 0)
    scale = A_SCALES.get(rng)
    if not scale:
        return 0, []
    out = []
    for k in range(n):
        o = HEADER_LEN + k * SAMPLE_LEN
        dt = data[o]
        g = struct.unpack_from("<3h", data, o + 1)
        a = struct.unpack_from("<3h", data, o + 7)
        out.append(((seq + k) & 0xFFFF, t0 + dt, [x * scale for x in a], [x * G_SCALE for x in g]))
    return seq, out


class Node:
    def __init__(self, place, name):
        self.place, self.name = place, name
        self.client = None
        self.device = None
        self.expected = None
        self.lost = 0
        self.count = 0  # この1秒に届いた数
        self.battery = None
        self.lp = None  # 重力の向き（加速度をならしたもの）
        self.can_buzz = False

    @property
    def connected(self):
        return self.client is not None and self.client.is_connected


class Coach:
    def __init__(self, outdir, dry):
        self.nodes = {name: Node(place, name) for place, name in SLOTS}
        self.dry = dry
        self.outdir = outdir
        self.phase = "準備"
        self.feedback = False
        self.writer = None
        self.base = {}  # 立ったときの重力の向き
        self.base_acc = {CHEST: [], HEAD: []}
        self.collect_base = False
        self.collect_run = False
        self.over_since = None
        self.run_base = None  # 走る前傾（胸、立った姿勢からの度）
        self.run_tilts = []
        self.feel_log = []  # (時刻, 場所)
        self.last_buzz = 0.0
        self.buzz_log = []  # (時刻, 区切り, 傾き)
        self.phase_log = []  # (区切り, 始まりの pc 時刻 ms)
        self.speed = 1.0  # --fast で区切りを短くする（動作確認用）
        self.last_print = 0.0

    # ---- 受け取り ----
    def on_data(self, node, data):
        pc = int(time.time() * 1000)
        seq, samples = parse_packet(data)
        if not samples:
            return
        if node.expected is not None:
            gap = (seq - node.expected) & 0xFFFF
            if 0 < gap < 0x8000:
                node.lost += gap
        node.expected = (seq + len(samples)) & 0xFFFF
        node.count += len(samples)
        for s_seq, t, a, g in samples:
            if self.writer:
                self.writer.writerow([node.name, t, pc, self.phase] + [f"{x:.4f}" for x in a] + [f"{x:.2f}" for x in g])
            v = np.array(a)
            node.lp = v if node.lp is None else node.lp * 0.98 + v * 0.02  # 約0.5秒でならす（100Hz）
            if self.collect_base and node.name in self.base_acc:
                self.base_acc[node.name].append(v)

    def tilt(self, name):
        node = self.nodes.get(name)
        if node is None or node.lp is None or name not in self.base:
            return None
        u = node.lp / np.linalg.norm(node.lp)
        return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(u, self.base[name]))))))

    # ---- つなぐ ----
    async def find_and_connect(self):
        want = set(self.nodes)
        found = {}
        say("センサーを探しています")

        def seen(device, adv):
            name = adv.local_name or device.name
            if name in want and name not in found:
                found[name] = device
                print(f"  見つけた：{name}（{self.nodes[name].place}）")

        scanner = BleakScanner(detection_callback=seen)
        await scanner.start()
        t0 = time.time()
        while len(found) < len(want) and time.time() - t0 < SCAN_S:
            await asyncio.sleep(0.5)
        await scanner.stop()
        for name in sorted(found):
            await self.connect(self.nodes[name], found[name])
        missing = [n for n in self.nodes.values() if not n.connected]
        ok = [n for n in self.nodes.values() if n.connected]
        print(f"== つながった：{len(ok)} / {len(self.nodes)}")
        if missing:
            say("つながらなかったのは、" + "、".join(n.place for n in missing) + "です。残りで進めます", wait=True)
        else:
            say("全部つながりました", wait=True)
        return ok

    async def connect(self, node, device):
        for attempt in range(3):
            try:
                client = BleakClient(device, disconnected_callback=lambda c, n=node: print(f"  !! {n.place}（{n.name}）が切れました"))
                await client.connect(timeout=15)
                node.client, node.device = client, device
                await client.start_notify(IMU_CHAR, lambda _, d, n=node: self.on_data(n, d))
                try:
                    b = await client.read_gatt_char(BAT_CHAR)
                    node.battery = struct.unpack("<H", b)[0] / 1000
                except Exception:
                    pass
                node.can_buzz = any(c.uuid == BUZZ_CHAR for s in client.services for c in s.characteristics)
                bat = f"{node.battery:.2f}V" if node.battery else "-"
                print(f"  つないだ：{node.place}（{node.name}）電池 {bat}　振動 {'あり' if node.can_buzz else 'なし（古いファーム）'}")
                return
            except Exception as e:
                print(f"  {node.name} につなげません（{attempt + 1}回目）：{e}")
                await asyncio.sleep(1)

    async def buzz(self, name, times=1, ms=1000):  # 0.2秒では走りながら気づきにくい。長さは最大 2.55秒
        node = self.nodes.get(name)
        if node and node.connected and node.can_buzz:
            try:
                await node.client.write_gatt_char(BUZZ_CHAR, bytes([times, ms // 10]), response=False)
            except Exception as e:
                print(f"  振動を送れません：{e}")

    # ---- 進める ----
    async def check_motors(self):
        buzzers = [n for n in self.nodes.values() if n.connected and n.can_buzz]
        if not buzzers:
            return
        say("振動の確認です。震えるところを、順に言います", wait=True)
        for n in buzzers:
            say(n.place, wait=True)
            await self.buzz(n.name, 1, 1000)
            await asyncio.sleep(1.8)

    async def ticker(self, phase_end):
        # 1秒ごとに：画面の表示、猫背の見分け
        while time.time() < phase_end:
            await asyncio.sleep(1 if not self.feedback else 0.1)
            now = time.time()
            ct, ht = self.tilt(CHEST), self.tilt(HEAD)
            if self.collect_run and ct is not None:
                self.run_tilts.append(ct)
            if self.feedback and ct is not None and self.run_base is not None:
                if ct > self.run_base + MARGIN_DEG:
                    self.over_since = self.over_since or now
                    if now - self.over_since >= HOLD_S and now - self.last_buzz >= COOLDOWN_S:
                        self.last_buzz = now
                        self.buzz_log.append((now, self.phase, ct))
                        chest = self.nodes[CHEST]
                        if chest.connected and chest.can_buzz:
                            print(f"  ★ 猫背：胸 {ct:.0f}° → 胸を震わせる")
                            await self.buzz(CHEST, 1, 1000)
                        else:  # 振動の命令が無い古いファームのときは、声で知らせる
                            print(f"  ★ 猫背：胸 {ct:.0f}° → 声で知らせる")
                            subprocess.Popen(["say", "-v", VOICE, "胸を張って"])
                else:
                    self.over_since = None
            if now - self.last_print >= 1:
                self.last_print = now
                rates = " ".join(f"{n.place}{n.count if n.connected else '×'}" for n in self.nodes.values())
                for n in self.nodes.values():
                    n.count = 0
                c = f"{ct:4.0f}°" if ct is not None else "  - "
                h = f"{ht:4.0f}°" if ht is not None else "  - "
                print(f"  [{self.phase} 残り{max(0, phase_end - now):3.0f}s] 胸{c} 頭{h}　受信/秒 {rates}", flush=True)

    async def run_phases(self):
        say("始めます。3、2、1", wait=True)
        for name, sec, text, role in PHASES:
            self.phase, self.feedback = name, role == "cue" and not self.dry
            self.phase_log.append((name, int(time.time() * 1000)))
            print(f"== {name}（{sec}秒）")
            say(text)
            first_stand = role == "stand" and not self.base
            if first_stand:
                self.collect_base = True
            end = time.time() + sec / self.speed
            countdown = asyncio.create_task(self.countdown(end))
            feel = asyncio.create_task(self.feel(end)) if role == "feel" and not self.dry else None
            if role == "run":  # 区切りの先頭10秒は姿勢が落ち着かないので、そのあとから覚える
                await self.ticker(time.time() + min(10, sec / 2) / self.speed)
                self.collect_run = True
            await self.ticker(end)
            await countdown
            if feel:
                await feel
            if role == "run":
                self.collect_run = False
                if self.run_tilts:
                    self.run_base = float(np.median(self.run_tilts))
                    print(f"  走る前傾を覚えました：胸 {self.run_base:.0f}°（{self.run_base + MARGIN_DEG:.0f}° を超えたら知らせる）")
            if first_stand:
                self.collect_base = False
                for k, vs in self.base_acc.items():
                    if len(vs) > 200:
                        m = np.mean(vs[len(vs) // 3:], axis=0)  # 動き出しの揺れを避けて、後ろ2/3
                        self.base[k] = m / np.linalg.norm(m)
                print("  立った姿勢を覚えました：" + "、".join(self.nodes[k].place for k in self.base))
        self.phase, self.feedback = "おわり", False
        self.phase_log.append(("おわり", int(time.time() * 1000)))
        if self.feel_log:
            say(f"おしまいです。お疲れさまでした。走っている間に震えたのは{len(self.feel_log)}回です。どこが、どの順番で震えたか、教えてください", wait=True)
        else:
            say("おしまいです。お疲れさまでした", wait=True)

    async def feel(self, end):
        import random
        nodes = [n for n in self.nodes.values() if n.connected and n.can_buzz]
        random.shuffle(nodes)
        await asyncio.sleep(random.uniform(4, 8))
        for n in nodes:
            if time.time() > end - 3:
                break
            self.feel_log.append((time.time(), n.place))
            print(f"  ◆ 震わせた：{n.place}")
            await self.buzz(n.name, 1, 1000)
            await asyncio.sleep(random.uniform(6, 10))

    async def countdown(self, end):
        wait = end - time.time() - 5
        if wait > 3:
            await asyncio.sleep(wait)
            for i in (5, 4, 3, 2, 1):
                subprocess.Popen(["say", "-v", VOICE, str(i)])
                await asyncio.sleep(1)

    async def main(self):
        os.makedirs(self.outdir, exist_ok=True)
        if not self.dry:
            ok = await self.find_and_connect()
            if not ok:
                say("センサーが見つかりません。スイッチと、眠っていないかを確かめてください", wait=True)
                return
            await self.check_motors()
        else:
            say("受信画面で、記録を始めるを押してください。押したら、エンターキーを押してください")
            await asyncio.get_running_loop().run_in_executor(None, input)
        f = open(os.path.join(self.outdir, "imu.csv"), "w", newline="")
        self.writer = csv.writer(f)
        self.writer.writerow(["node", "time_ms", "pc_ms", "phase", "ax_g", "ay_g", "az_g", "gx_dps", "gy_dps", "gz_dps"])
        try:
            await self.run_phases()
        finally:
            self.writer = None
            f.close()
            for n in self.nodes.values():
                if n.connected:
                    try:
                        await n.client.disconnect()
                    except Exception:
                        pass
            with open(os.path.join(self.outdir, "phases.csv"), "w") as pf:
                pf.write("phase,start_pc_ms\n" + "".join(f"{n},{t}\n" for n, t in self.phase_log))
            if self.dry:
                say("受信画面で、記録を止めるを押して、CSVで保存してください", wait=True)
                print(f"== 区切りの時刻：{os.path.join(self.outdir, 'phases.csv')}")
            else:
                write_summary(self, os.path.join(self.outdir, "imu.csv"), os.path.join(self.outdir, "summary.txt"))


def cadence(m):
    # 足首の加速度の大きさの自己相関で、片足の周期を出す → 両足の歩数/分
    m = m - m.mean()
    if len(m) < 300:
        return None
    ac = np.correlate(m, m, "full")[len(m) - 1:]
    ac /= ac[0]
    lag = 40 + int(np.argmax(ac[40:200]))
    return 120 / (lag / 100)


def write_summary(coach, csv_path, out_path):
    rows = {}
    with open(csv_path) as f:
        for r in csv.DictReader(f):
            rows.setdefault((r["phase"], r["node"]), []).append([float(r[k]) for k in ("ax_g", "ay_g", "az_g")])
    lines = [f"記録：{csv_path}", ""]
    for n in coach.nodes.values():
        lines.append(f"{n.place}（{n.name}）：抜け {n.lost} 件" + ("" if n.device else "　※つながらなかった"))
    lines.append("")
    lines.append("区切り              歩数/分  胸の傾き  頭の傾き  着地 左/右(g, 上位10%)  振動")
    done = set()
    for name, _ in coach.phase_log[:-1]:
        if name in done:
            continue
        done.add(name)
        def arr(node):
            v = rows.get((name, node))
            return np.array(v) if v else None
        la, ra = arr(LEFT_ANKLE), arr(RIGHT_ANKLE)
        cad = None
        if la is not None and ra is not None:
            cs = [c for c in (cadence(np.linalg.norm(la, axis=1)), cadence(np.linalg.norm(ra, axis=1))) if c]
            cad = np.mean(cs) if cs and "走る" in name else None
        def tilt(node):
            v = arr(node)
            if v is None or node not in coach.base:
                return None
            u = v.mean(axis=0)
            u /= np.linalg.norm(u)
            return math.degrees(math.acos(max(-1, min(1, float(np.dot(u, coach.base[node]))))))
        def peak(v):
            return np.percentile(np.linalg.norm(v, axis=1), 90) if v is not None else None
        fmt = lambda x, f: (f % x) if x is not None else "-"
        nb = sum(1 for b in coach.buzz_log if b[1] == name)
        lines.append(f"{name:<14}{fmt(cad, '%7.0f'):>9}{fmt(tilt(CHEST), '%7.0f°'):>10}{fmt(tilt(HEAD), '%7.0f°'):>10}"
                     f"      {fmt(peak(la), '%.1f')} / {fmt(peak(ra), '%.1f')}          {nb}回")
    lines.append("")
    if coach.feel_log:
        lines.append("振動に気づくか（震わせた順番）：" + " → ".join(p for _, p in coach.feel_log))
        lines.append("")
    rb = f"{coach.run_base:.0f}° + {MARGIN_DEG:.0f}°" if coach.run_base is not None else "未設定"
    lines.append(f"猫背の線：胸が 走る前傾 {rb} を {HOLD_S} 秒（立った姿勢から）。知らせた時刻：")
    for t, ph, deg in coach.buzz_log:
        lines.append(f"  {datetime.fromtimestamp(t).strftime('%H:%M:%S')}  {ph}  胸 {deg:.0f}°")
    text = "\n".join(lines)
    with open(out_path, "w") as f:
        f.write(text + "\n")
    print("\n" + text)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="センサーにつながず、声と区切りだけ")
    ap.add_argument("--fast", action="store_true", help="区切りを10分の1の長さにする（動作確認用）")
    args = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.join(here, "..", "records", datetime.now().strftime("%Y%m%d-%H%M%S"))
    try:
        coach = Coach(os.path.normpath(outdir), args.dry)
        coach.speed = 10.0 if args.fast else 1.0
        asyncio.run(coach.main())
    except KeyboardInterrupt:
        print("\n中断しました")
        sys.exit(1)
