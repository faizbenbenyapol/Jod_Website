'use strict';

// สร้างข้อมูลสมมติ 60 ร้านสำหรับทดลองใช้ (ไม่ใช่ข้อมูลของบุคคลจริง)
// รูปแบบพฤติกรรมถูกกำหนดตายตัวตามลำดับร้าน เพื่อให้ผลลัพธ์ซ้ำได้ทุกครั้งที่รัน

const fs = require('node:fs');
const path = require('node:path');
const { addDays, todayInBangkok } = require('../src/logic');

// ประเภทร้านและยอดขายตั้งต้นต่อวัน ใช้วนตามลำดับร้าน (ตัวเลขสมมติ ไม่ได้มาจากข้อมูลจริง)
const STALLS =['ส้มตำ', 'ข้าวแกง', 'ผลไม้ตัด', 'ลูกชิ้นทอด', 'น้ำปั่น', 'ขนมครก', 'ผักสด', 'ไก่ทอด', 'โจ๊ก', 'หมูปิ้ง'];
const BASE_SALES = [1800, 2600, 1500, 1200, 1400, 900, 2000, 2400, 1300, 1700];

/**
 * สร้างรายการต้นทุนของหนึ่งวันแบบที่แม่ค้าทั่วไปน่าจะมี
 *
 * @param {number} sales - ยอดขายของวันนั้น
 * @param {number} seed - ตัวเลขสำหรับทำให้แต่ละวันต่างกันเล็กน้อย
 * @param {boolean} losing - true = ทำให้ต้นทุนสูงกว่ายอดขาย (จำลองร้านที่ขาดทุน)
 * @returns {Array<{category: string, amount: number}>}
 */
function makeCosts(sales, seed, losing) {
  const raw = Math.round(sales * (losing ? 1.05 : 0.45 + (seed % 10) / 100));
  const costs = [{ category: 'วัตถุดิบ', amount: raw }, { category: 'แก๊ส/ถ่าน/ไฟฟ้า', amount: 60 }];
  if (seed % 3 !== 0) costs.push({ category: 'ภาชนะ', amount: 40 });
  if (seed % 2 === 0) costs.push({ category: 'ค่าที่/ค่าแผง', amount: 50 });
  if (seed % 11 === 0) costs.push({ category: 'อื่นๆ', amount: 80, note: 'ค่าซ่อมรถเข็น' });
  return costs;
}

// ระยะโครงการ 6 สัปดาห์ = 42 วัน (นับรวมวันนี้) ข้อมูลเดโมจึงย้อนหลัง 41 วัน ทำให้คร่อม 2 เดือนและลองดูรายเดือนได้
const PROJECT_DAYS = 42;

// ร้านเดโมหลัก (ปุ่ม "ทดลองเป็นแม่ค้า") จงใจให้มีวันที่ลืมจดและวันที่ขาดทุน เพื่อให้เห็นทุกหน้าจอ
const SHOWCASE_ID = 'P01';
const SHOWCASE_SKIPPED = [1, 20, 27];
const SHOWCASE_RAIN_DAY = 15;

/**
 * คืนเวลาย้อนหลังจากตอนนี้ตามจำนวนนาทีที่กำหนด ใช้ตั้งเวลาส่งคำขอความช่วยเหลือในข้อมูลเดโม
 *
 * @param {number} minutes - จำนวนนาทีย้อนหลัง
 * @returns {string} เวลารูปแบบ ISO
 */
function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

/**
 * สร้างข้อมูลเดโมทั้งหมด ย้อนหลัง 41 วันจากวันที่กำหนด (วันนี้ยังไม่มีใครจด)
 *
 * แบ่งพฤติกรรมตามเลขหลักหน่วยของลำดับร้าน:
 *   0–5 = จดสม่ำเสมอ, 6 = หยุดจดมา 5 วัน, 7 = เริ่มหลุด (หยุด 3 วัน),
 *   8 = 4 วันหลังสุดไม่ใส่ต้นทุนเลย, 9 = ขาดทุน 3 วันติด; ร้านสุดท้าย (P60) ยังไม่เคยจด
 *   ร้าน P01 เป็นร้านเดโมหลัก: ลืมจดเมื่อวานและอีก 2 วันในอดีต และมีวันฝนตกที่ขาดทุน 1 วัน
 *
 * @param {string} today - วันที่อ้างอิง รูปแบบ YYYY-MM-DD
 * @returns {{participants: Array, entries: Array, helpRequests: Array}}
 */
function buildSeedData(today) {
  const participants = [];
  const entries = [];
  const now = new Date().toISOString();

  for (let i = 0; i < 60; i++) {
    const id = 'P' + String(i + 1).padStart(2, '0');
    const kind = i % 10;
    participants.push({ id, name: `แผง ${String(i + 1).padStart(2, '0')}`, stall: STALLS[kind], market: 'ตลาดนัดตัวอย่าง' });
    if (i === 59) continue;

    const lastOffset = kind === 6 ? 5 : kind === 7 ? 3 : 1;
    for (let offset = PROJECT_DAYS - 1; offset >= lastOffset; offset--) {
      if (id === SHOWCASE_ID && SHOWCASE_SKIPPED.includes(offset)) continue;
      const seed = i * 7 + offset;
      let sales = BASE_SALES[kind] + ((i * 37 + offset * 53) % 500);
      let costs = makeCosts(sales, seed, kind === 9 && offset <= 3);
      if (id === SHOWCASE_ID && offset === SHOWCASE_RAIN_DAY) sales = 400;
      if (kind === 8 && offset <= 4) costs = [];
      entries.push({ id: `seed-${id}-${offset}`, participantId: id, date: addDays(today, -offset), sales, costs, createdAt: now, updatedAt: now });
    }
  }

  const helpRequests = [
    { id: 'seed-h1', participantId: 'P08', topic: 'cost', status: 'waiting', createdAt: minutesAgo(130), updatedAt: minutesAgo(130) },
    { id: 'seed-h2', participantId: 'P10', topic: 'call', status: 'in_progress', createdAt: minutesAgo(300), updatedAt: minutesAgo(45) },
    { id: 'seed-h3', participantId: 'P27', topic: 'app', status: 'waiting', createdAt: minutesAgo(40), updatedAt: minutesAgo(40) },
    { id: 'seed-h4', participantId: 'P01', topic: 'cost', status: 'done', createdAt: minutesAgo(4400), updatedAt: minutesAgo(4300) },
    { id: 'seed-h5', participantId: 'P33', topic: 'app', status: 'done', createdAt: minutesAgo(2900), updatedAt: minutesAgo(2850) },
  ];
  return { participants, entries, helpRequests };
}

/**
 * เขียนข้อมูลตัวอย่างลงไฟล์ (ทับของเดิมทั้งหมด)
 *
 * @param {string} filePath - path ของไฟล์ JSON ปลายทาง
 * @param {string} today - วันที่อ้างอิง รูปแบบ YYYY-MM-DD
 */
function writeSeed(filePath, today) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(buildSeedData(today), null, 2), 'utf8');
}

if (require.main === module) {
  const file = path.join(__dirname, '..', 'data', 'db.json');
  writeSeed(file, todayInBangkok());
  console.log('รีเซ็ตข้อมูลตัวอย่าง 60 ร้านแล้ว → data/db.json');
}

module.exports = { buildSeedData, writeSeed };
