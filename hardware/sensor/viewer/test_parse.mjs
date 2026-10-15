// viewer.html のパーサ（<script id="parser">）に、03_ble_imu と同じ形のバイト列を通して確かめる
//   使い方： node viewer/test_parse.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./viewer.html', import.meta.url), 'utf8');
const code = html.match(/<script id="parser">([\s\S]*?)<\/script>/)[1];
const { parsePacket, parseBattery } = new Function(code + '\nreturn { parsePacket, parseBattery };')();

// ファームと同じ詰め方：先頭の通し番号 u16、先頭の時刻 u32、加速度の範囲 u8（g）、
// 1件 = 時刻の差 u8 + ジャイロ i16×3 + 加速度 i16×3
function build(seq, samples, range = 16) {
  const buf = new ArrayBuffer(7 + samples.length * 13);
  const v = new DataView(buf);
  v.setUint16(0, seq, true);
  v.setUint32(2, samples[0].t, true);
  v.setUint8(6, range);
  samples.forEach((s, k) => {
    const o = 7 + k * 13;
    v.setUint8(o, s.t - samples[0].t);
    s.g.forEach((x, i) => v.setInt16(o + 1 + i * 2, x, true));
    s.a.forEach((x, i) => v.setInt16(o + 7 + i * 2, x, true));
  });
  return v;
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
let tests = 0;

// 1) MTU 247 のとき：18件（7 + 18×13 = 241 バイト）、100Hz（時刻の差は 10/10/10/11… のように 1/1024 秒刻みで揺れる）
const t0 = 4294967000 - 100; // uint32 の上のほうでも正しく読めるか
const raw = Array.from({ length: 18 }, (_, k) => ({
  t: t0 + Math.floor((Math.floor((k * 1024) / 100) * 1000) / 1024),
  g: [k * 100 - 900, -32768, 32767],
  a: [4096, -4096 + k, k * -7],
}));
let p = parsePacket(build(65530, raw, 8));
assert.equal(p.n, 18);
assert.equal(p.seq, 65530);
assert.equal(p.range, 8);
p.samples.forEach((s, k) => {
  assert.equal(s.seq, (65530 + k) & 0xffff); // 65535 の次は 0 に戻る
  assert.equal(s.t, raw[k].t);
  raw[k].g.forEach((x, i) => near(s.g[i], x * 0.07));
  raw[k].a.forEach((x, i) => near(s.a[i], x * 0.000244));
});
near(p.samples[0].g[1], -2293.76);   // -32768 → 下限
assert.equal(p.samples[17].t - p.samples[0].t, raw[17].t - raw[0].t);
tests++;

// 2) 加速度の換算：±8g と ±16g で、同じ数が違う g になる
p = parsePacket(build(0, [{ t: 0, g: [0, 0, 0], a: [4096, 32767, -32768] }], 8));
near(p.samples[0].a[0], 0.999424);   // ±8g：4096 → 約 1 g
near(p.samples[0].a[1], 7.995148);   // ±8g：上限 → 約 8 g
near(p.samples[0].a[2], -7.995392);  // ±8g：下限 → 約 -8 g
p = parsePacket(build(0, [{ t: 0, g: [0, 0, 0], a: [2048, 32767, -32768] }], 16));
assert.equal(p.range, 16);
near(p.samples[0].a[0], 0.999424);   // ±16g：2048 → 約 1 g
near(p.samples[0].a[1], 15.990296);  // ±16g：上限 → 約 16 g
near(p.samples[0].a[2], -15.990784); // ±16g：下限 → 約 -16 g
tests++;

// 3) MTU 23 のとき：20 バイトに1件
p = parsePacket(build(7, [{ t: 123456, g: [1, 2, 3], a: [-1, -2, -3] }]));
assert.equal(p.n, 1);
assert.equal(p.samples[0].t, 123456);
near(p.samples[0].a[2], -3 * 0.000488);
tests++;

// 4) 古い形（範囲のバイトがない 6 + 13N バイト、さらに古い16バイト）と、知らない範囲は 0 件として扱う（でたらめな値を出さない）
assert.equal(parsePacket(new DataView(new ArrayBuffer(16))).n, 0);
assert.equal(parsePacket(new DataView(new ArrayBuffer(6 + 13))).n, 0);
assert.equal(parsePacket(new DataView(new ArrayBuffer(6 + 18 * 13))).n, 0);
assert.equal(parsePacket(build(0, [{ t: 0, g: [0, 0, 0], a: [0, 0, 0] }], 4)).n, 0);
tests++;

// 5) 50Hz で、時刻の差が 255 ms まで入る
p = parsePacket(build(0, [0, 20, 40, 255].map((d) => ({ t: 1000 + d, g: [0, 0, 0], a: [0, 0, 0] }))));
assert.deepEqual(p.samples.map((s) => s.t), [1000, 1020, 1040, 1255]);
tests++;

// 6) 電池：uint16 ミリボルト
const b = new DataView(new ArrayBuffer(2));
b.setUint16(0, 3917, true);
near(parseBattery(b), 3.917);
tests++;

console.log(`OK: parsePacket は値・時刻・通し番号・加速度の範囲を、parseBattery は電池の電圧を正しく戻す（${tests}件のテスト）`);
