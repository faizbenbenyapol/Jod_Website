'use strict';

// ทดสอบผ่าน HTTP จริงตั้งแต่ต้นจนจบ: เปิดเซิร์ฟเวอร์ด้วยข้อมูลเดโมชุดใหม่ในโฟลเดอร์ชั่วคราว แล้วยิงคำขอเหมือนหน้าเว็บ
// ล็อกวันที่เป็น 15 ต.ค. 2569 เพื่อให้ผลซ้ำได้ทุกครั้งที่รัน
// รันด้วย: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { writeSeed } = require('../scripts/seed');

const TODAY = '2026-10-15';
let server;
let base;
let tmpDir;

/**
 * ส่งคำขอ JSON ไปที่เซิร์ฟเวอร์ทดสอบ
 *
 * @param {string} method - HTTP method
 * @param {string} url - path เช่น "/api/team"
 * @param {object|string} [body] - ข้อมูลที่ส่ง (string = ส่งตามนั้นตรง ๆ ใช้ทดสอบ JSON เสีย)
 * @returns {Promise<{status: number, body: any}>}
 */
async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // ไม่ใช่ JSON (เช่น หน้า HTML หรือข้อความ 404) ก็คืนเป็นข้อความ
  }
  return { status: res.status, body: parsed };
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jod-kamrai-test-'));
  const dbPath = path.join(tmpDir, 'db.json');
  writeSeed(dbPath, TODAY);
  server = createApp({ dbPath, today: () => TODAY }).server;
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('กรณี 1 (ใช้งานปกติ): จดยอดวันนี้ ได้กำไรถูกต้องและนับวันเพิ่ม', async () => {
  const before = await call('GET', '/api/vendor/P02');
  const r = await call('POST', '/api/vendor/P02/entries', {
    date: TODAY,
    sales: '1,500',
    costs: [{ category: 'วัตถุดิบ', amount: '600' }, { category: 'แก๊ส/ถ่าน/ไฟฟ้า', amount: 60 }],
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.action, 'created');
  assert.equal(r.body.entry.sales, 1500);
  assert.equal(r.body.entry.totalCost, 660);
  assert.equal(r.body.entry.profit, 840);
  assert.equal(r.body.summary.daysRecorded, before.body.summary.daysRecorded + 1);
});

test('กรณี 2 (ข้อมูลไม่ครบ): ไม่ใส่ยอดขาย → ไม่บันทึก และบอกว่าช่องไหนขาด', async () => {
  const r = await call('POST', '/api/vendor/P03/entries', { date: TODAY, costs: [] });
  assert.equal(r.status, 400);
  assert.match(r.body.errors.sales, /กรุณาใส่ยอดขาย/);

  const after = await call('GET', '/api/vendor/P03');
  assert.ok(!after.body.entries.some((e) => e.date === TODAY), 'ต้องไม่มีอะไรถูกบันทึก');
});

test('กรณี 3 (ข้อมูลไม่ถูกต้อง): ติดลบ / ตัวอักษร / วันในอนาคต / อื่นๆ ไม่บอกว่าค่าอะไร', async () => {
  const r = await call('POST', '/api/vendor/P04/entries', {
    date: '2026-10-20',
    sales: 'หนึ่งพัน',
    costs: [
      { category: 'วัตถุดิบ', amount: '-5' },
      { category: 'อื่นๆ', amount: 80, note: '' },
      { category: 'ค่าอะไรไม่รู้', amount: 10 },
    ],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.errors.date, /ล่วงหน้า/);
  assert.match(r.body.errors.sales, /เฉพาะตัวเลข/);
  assert.match(r.body.errors['costs.0.amount'], /ติดลบ/);
  assert.match(r.body.errors['costs.1.note'], /ค่าอะไร/);
  assert.match(r.body.errors['costs.2.category'], /ประเภท/);
});

test('กรณี 4 (ทำรายการซ้ำ): จดวันเดิมซ้ำ → ระบบถามก่อน แล้วบวกเพิ่มหรือแทนที่ได้ตามที่เลือก', async () => {
  const first = await call('POST', '/api/vendor/P05/entries', { date: TODAY, sales: 1500, costs: [{ category: 'วัตถุดิบ', amount: 660 }] });
  assert.equal(first.status, 201);

  const dup = await call('POST', '/api/vendor/P05/entries', { date: TODAY, sales: 400, costs: [{ category: 'ภาชนะ', amount: 20 }] });
  assert.equal(dup.status, 409, 'ต้องไม่บันทึกทับเงียบ ๆ');
  assert.equal(dup.body.existing.sales, 1500);

  const added = await call('POST', '/api/vendor/P05/entries', { date: TODAY, sales: 400, costs: [{ category: 'ภาชนะ', amount: 20 }], mode: 'add' });
  assert.equal(added.status, 200);
  assert.equal(added.body.entry.sales, 1900);
  assert.equal(added.body.entry.profit, 1220);

  const replaced = await call('POST', '/api/vendor/P05/entries', { date: TODAY, sales: 1000, costs: [], mode: 'replace' });
  assert.equal(replaced.body.entry.sales, 1000);
  assert.equal(replaced.body.entry.totalCost, 0);

  const view = await call('GET', '/api/vendor/P05');
  assert.equal(view.body.entries.filter((e) => e.date === TODAY).length, 1, 'วันเดียวต้องมีบันทึกเดียว');
});

test('กรณี 5 (กดขอความช่วยเหลือซ้ำ): ไม่สร้างคำขอใหม่ และบอกว่าส่งไปแล้ว', async () => {
  const first = await call('POST', '/api/vendor/P06/help', { topic: 'call' });
  assert.equal(first.status, 201);
  const again = await call('POST', '/api/vendor/P06/help', { topic: 'call' });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyOpen, true);

  const team = await call('GET', '/api/team');
  assert.equal(team.body.helpRequests.filter((h) => h.participantId === 'P06').length, 1);
});

test('กรณี 6 (หน้าทีม): คนที่ต้องโทรขึ้นก่อน และเหตุผลอ่านเข้าใจได้', async () => {
  const team = await call('GET', '/api/team');
  const levels = team.body.participants.map((p) => p.level);
  const firstGreen = levels.indexOf('green');
  assert.ok(levels.slice(0, levels.indexOf('yellow')).every((l) => l === 'red'), 'แดงต้องมาก่อนเหลือง');
  assert.ok(levels.slice(firstGreen).every((l) => l === 'green'), 'เขียวต้องอยู่ท้ายสุด');
  assert.equal(team.body.participants[0].id, 'P60', 'คนที่ยังไม่เคยจดเลยขึ้นเป็นอันดับแรก');
  assert.deepEqual(team.body.participants[0].reasons, ['ยังไม่เคยจดเลย']);
});

test('กรณี 7 (ความปลอดภัยพื้นฐาน): ขอไฟล์นอก public ไม่ได้, JSON เสีย, รหัสร้านไม่มีอยู่', async () => {
  const traversal = await call('GET', '/..%2Fdata%2Fdb.json');
  assert.equal(traversal.status, 404);
  const badJson = await call('POST', '/api/vendor/P01/entries', '{ไม่ใช่ json');
  assert.equal(badJson.status, 400);
  const unknown = await call('GET', '/api/vendor/P999');
  assert.equal(unknown.status, 404);
});
