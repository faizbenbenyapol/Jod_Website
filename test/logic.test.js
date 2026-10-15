'use strict';

// ทดสอบกติกาทางธุรกิจใน src/logic.js โดยตรง (ไม่ผ่านเซิร์ฟเวอร์)
// รันด้วย: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/logic');

const TODAY = '2026-10-15';

test('แปลงจำนวนเงิน: รับ "1,500" ได้ และปฏิเสธค่าที่ผิดพร้อมบอกเหตุผล', () => {
  assert.deepEqual(logic.parseAmount('1,500'), { ok: true, value: 1500 });
  assert.deepEqual(logic.parseAmount(' 99.50 '), { ok: true, value: 99.5 });
  assert.equal(logic.parseAmount('').reason, 'missing');
  assert.equal(logic.parseAmount('-50').reason, 'negative');
  assert.equal(logic.parseAmount('สองร้อย').reason, 'not_number');
  assert.equal(logic.parseAmount('1.234').reason, 'not_number');
  assert.equal(logic.parseAmount('5000000').reason, 'too_large');
});

test('คำนวณกำไร: ปัดทศนิยมเงินถูกต้อง ไม่เพี้ยนแบบ 0.1 + 0.2', () => {
  assert.deepEqual(logic.computeProfit(1500, [{ amount: 600 }, { amount: 60 }]), { totalCost: 660, profit: 840 });
  assert.deepEqual(logic.computeProfit(0.3, [{ amount: 0.1 }, { amount: 0.2 }]), { totalCost: 0.3, profit: 0 });
  assert.equal(logic.computeProfit(400, [{ amount: 470 }]).profit, -70);
});

test('ตรวจข้อมูล: จดล่วงหน้าไม่ได้ และวันที่ที่ไม่มีจริง (30 ก.พ.) ไม่ผ่าน', () => {
  assert.match(logic.validateEntry({ date: '2026-10-16', sales: 100 }, TODAY).errors.date, /ล่วงหน้า/);
  assert.ok(logic.validateEntry({ date: '2026-02-30', sales: 100 }, TODAY).errors.date);
  assert.ok(logic.validateEntry({ date: TODAY, sales: 100 }, TODAY).ok);
});

test('ตรวจข้อมูล: ไม่ใส่ต้นทุนเลยบันทึกได้ แต่มีคำเตือนให้ทบทวน', () => {
  const r = logic.validateEntry({ date: TODAY, sales: 800, costs: [] }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
});

test('จัดลำดับความเร่งด่วน: ใช้กติกาที่ตกลงกันไว้ (ขาดจด 3 วันขึ้นไป = โทร)', () => {
  const base = { recordedDays: 10, zeroCostStreak: 0, lossStreak: 0, openHelp: 0 };
  const level = (s) => logic.classifyPriority({ ...base, ...s }).level;

  assert.equal(level({ daysSinceLast: null }), 'red', 'ยังไม่เคยจด');
  assert.equal(level({ daysSinceLast: 4 }), 'red', 'ขาด 3 วัน');
  assert.equal(level({ daysSinceLast: 3 }), 'yellow', 'ขาด 2 วัน');
  assert.equal(level({ daysSinceLast: 2 }), 'yellow', 'ขาด 1 วัน');
  assert.equal(level({ daysSinceLast: 1 }), 'green', 'จดล่าสุดเมื่อวาน = ปกติ เพราะวันนี้ยังขายไม่จบ');
  assert.equal(level({ daysSinceLast: 1, zeroCostStreak: 3 }), 'yellow', 'ไม่ใส่ต้นทุน 3 วันติด');
  assert.equal(level({ daysSinceLast: 1, lossStreak: 3 }), 'yellow', 'ขาดทุน 3 วันติด');
  assert.equal(level({ daysSinceLast: 1, openHelp: 2 }), 'green', 'คำขอค้างไม่นับซ้ำ เพราะมีคิวแยกอยู่แล้ว');

  const r = logic.classifyPriority({ ...base, daysSinceLast: 5, lossStreak: 3 });
  assert.deepEqual(r.reasons, ['ไม่ได้จดมา 4 วัน', 'ขาดทุน 3 วันติด'], 'แดงแสดงเหตุผลรองด้วย');
});

test('สรุป 14 วัน: นับวันที่ขาดจดไม่รวมวันนี้ (วันนี้ยังขายไม่จบ)', () => {
  const entries = [
    { date: '2026-10-14', sales: 1000, costs: [{ amount: 400 }] },
    { date: '2026-10-12', sales: 500, costs: [] },
  ];
  const s = logic.summarizeWindow(entries, TODAY);
  assert.equal(s.from, '2026-10-02');
  assert.equal(s.daysRecorded, 2);
  assert.equal(s.missingDates.length, 11);
  assert.ok(!s.missingDates.includes(TODAY));
  assert.equal(s.totalProfit, 1100);
});
