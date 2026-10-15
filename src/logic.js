'use strict';

// กติกาทางธุรกิจทั้งหมดของแอป (ไม่ยุ่งกับ HTTP หรือไฟล์) จึงทดสอบแยกได้ง่าย:
// ตรวจข้อมูลที่กรอก คำนวณกำไร รวมรายการซ้ำ สรุปช่วง 14 วัน และจัดลำดับว่าใครต้องติดตามก่อน

// ประเภทต้นทุนที่แสดงเป็นปุ่มลัด เรียงจากที่ใช้บ่อยไปน้อย พร้อมตัวอย่างให้ผู้ใช้เทียบได้ว่าของที่จ่ายไปอยู่หมวดไหน
const COST_CATEGORIES = [
  { name: 'วัตถุดิบ', examples: 'ของสด เนื้อ ผัก ข้าว เครื่องปรุง' },
  { name: 'แก๊ส/ถ่าน/ไฟฟ้า', examples: 'เชื้อเพลิงหุงต้ม ค่าไฟที่แผง' },
  { name: 'ภาชนะ', examples: 'ถุง กล่อง แก้ว ช้อน หลอด หนังยาง' },
  { name: 'ค่าที่/ค่าแผง', examples: 'ค่าเช่าที่ ค่าเก็บขยะ ค่าน้ำตลาด' },
  { name: 'น้ำแข็ง/น้ำดื่ม', examples: 'น้ำแข็งแช่ของ น้ำดื่ม' },
  { name: 'ค่าเดินทาง/ขนส่ง', examples: 'น้ำมันรถ ค่าวิน ค่าส่งของ' },
  { name: 'ค่าแรงคนช่วย', examples: 'ค่าจ้างลูกมือรายวัน' },
  { name: 'อื่นๆ', examples: 'พิมพ์บอกว่าเป็นค่าอะไร' },
];
const CATEGORY_NAMES = COST_CATEGORIES.map((c) => c.name);
// หมวด "อื่นๆ" ต้องมีคำอธิบายสั้น ๆ ว่าเป็นค่าอะไร (ยาวพอสำหรับ "ค่าซ่อมรถเข็น" แต่ไม่ให้เขียนเป็นย่อหน้า)
const OTHER_CATEGORY = 'อื่นๆ';
const MAX_NOTE_LENGTH = 40;

// ต้นทุนที่แม่ค้ามักลืมนับ (สมมติฐานหลักของโครงการ) ใช้แสดงคำเตือนก่อนกดบันทึก
const OFTEN_FORGOTTEN = ['แก๊ส/ถ่าน/ไฟฟ้า', 'ภาชนะ', 'ค่าที่/ค่าแผง', 'น้ำแข็ง/น้ำดื่ม'];

// หัวข้อขอความช่วยเหลือ ผู้ใช้กดเลือกได้โดยไม่ต้องพิมพ์
const HELP_TOPICS = {
  cost: 'ไม่แน่ใจว่าอะไรนับเป็นต้นทุน',
  app: 'ใช้หน้าจอนี้ไม่เป็น',
  call: 'อยากให้โทรกลับ',
};

// สถานะคำขอความช่วยเหลือ: รอรับเรื่อง → ทีมกำลังช่วย → ช่วยเสร็จแล้ว
const HELP_STATUSES = ['waiting', 'in_progress', 'done'];

// เพดานยอดเงินต่อช่อง กันกดเลข 0 เกิน (แผงตลาดรายวันไม่น่าเกินหลักแสน)
const MAX_AMOUNT = 1000000;

// ช่วงติดตามผลตามเงื่อนไขโครงการ (อย่างน้อย 14 วัน)
const FOLLOW_UP_DAYS = 14;

// ข้อความแจ้งเตือนช่องจำนวนเงิน แยกตามรหัสเหตุผลที่ parseAmount คืนมา
const AMOUNT_MESSAGES = {
  missing: 'กรุณาใส่จำนวนเงิน',
  not_number: 'ใส่ได้เฉพาะตัวเลข เช่น 1500',
  negative: 'จำนวนเงินติดลบไม่ได้',
  too_large: 'ตัวเลขสูงผิดปกติ ลองดูว่ากดเลข 0 เกินหรือเปล่า',
};

/**
 * หาวันที่ปัจจุบันตามเวลาประเทศไทย เพื่อไม่ให้วันเพี้ยนเมื่อเซิร์ฟเวอร์อยู่คนละโซนเวลา
 *
 * @param {Date} [now] - เวลาที่ต้องการแปลง (ค่าเริ่มต้นคือเวลาปัจจุบัน)
 * @returns {string} วันที่รูปแบบ YYYY-MM-DD
 */
function todayInBangkok(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/**
 * ตรวจว่าข้อความเป็นวันที่ที่มีอยู่จริงในรูปแบบ YYYY-MM-DD หรือไม่ (เช่น 2026-02-30 ไม่ผ่าน)
 *
 * @param {string} text - ข้อความที่ต้องการตรวจ
 * @returns {boolean} true เมื่อเป็นวันที่ถูกต้อง
 */
function isValidDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/**
 * บวกหรือลบจำนวนวันจากวันที่ที่กำหนด
 *
 * @param {string} dateStr - วันที่ตั้งต้น รูปแบบ YYYY-MM-DD
 * @param {number} n - จำนวนวันที่ต้องการบวก (ติดลบคือย้อนหลัง)
 * @returns {string} วันที่ใหม่ รูปแบบ YYYY-MM-DD
 */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * นับจำนวนวันจากวันที่ a ไปถึงวันที่ b
 *
 * @param {string} a - วันที่เริ่ม รูปแบบ YYYY-MM-DD
 * @param {string} b - วันที่สิ้นสุด รูปแบบ YYYY-MM-DD
 * @returns {number} จำนวนวัน (ติดลบถ้า b อยู่ก่อน a)
 */
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/**
 * ปัดเงินเป็นทศนิยม 2 ตำแหน่ง กันปัญหา 0.1 + 0.2 = 0.30000000000000004
 *
 * @param {number} n - จำนวนเงิน
 * @returns {number} จำนวนเงินที่ปัดแล้ว
 */
function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

/**
 * แปลงค่าที่ผู้ใช้กรอกเป็นจำนวนเงิน รับได้ทั้งตัวเลขและข้อความที่มีจุลภาค เช่น "1,500"
 *
 * @param {unknown} raw - ค่าที่ได้รับจากฟอร์ม
 * @returns {{ok: true, value: number} | {ok: false, reason: 'missing'|'not_number'|'negative'|'too_large'}}
 *   ผลการแปลง ถ้าไม่ผ่านจะบอกเหตุผลเป็นรหัสเพื่อใช้เลือกข้อความแจ้งเตือน
 */
function parseAmount(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: false, reason: 'missing' };
  const text = String(raw).replace(/[,\s]/g, '');
  if (/^-\d/.test(text)) return { ok: false, reason: 'negative' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, reason: 'not_number' };
  const value = Number(text);
  if (value > MAX_AMOUNT) return { ok: false, reason: 'too_large' };
  return { ok: true, value };
}

/**
 * ตรวจข้อมูลบันทึกประจำวันก่อนบันทึก และแปลงให้อยู่ในรูปแบบมาตรฐาน
 *
 * @param {{date?: string, sales?: unknown, costs?: Array<{category?: string, amount?: unknown, note?: string}>}} input
 *   ข้อมูลจากฟอร์ม (note = คำอธิบาย ใช้กับหมวด "อื่นๆ" เท่านั้น)
 * @param {string} today - วันที่วันนี้ รูปแบบ YYYY-MM-DD ใช้กันการจดล่วงหน้า
 * @returns {{ok: boolean, errors: Object<string,string>, warnings: string[],
 *   value: {date: string, sales: number, costs: Array<{category: string, amount: number}>} | null}}
 *   errors ใช้ชื่อช่องเป็นคีย์ (เช่น "sales", "costs.0.amount") เพื่อให้หน้าจอแสดงข้อความใต้ช่องที่ผิด
 *   warnings คือข้อสังเกตที่ไม่บล็อกการบันทึก
 */
function validateEntry(input, today) {
  const errors = {};
  const warnings = [];
  const body = input || {};

  if (!body.date) errors.date = 'กรุณาเลือกวันที่';
  else if (!isValidDate(body.date)) errors.date = 'วันที่ไม่ถูกต้อง';
  else if (body.date > today) errors.date = 'ยังจดล่วงหน้าไม่ได้ เลือกวันนี้หรือวันที่ผ่านมาแล้ว';

  const sales = parseAmount(body.sales);
  if (!sales.ok) {
    errors.sales = sales.reason === 'missing'
      ? 'กรุณาใส่ยอดขาย (ถ้าวันนี้ขายไม่ได้เลย ใส่ 0)'
      : AMOUNT_MESSAGES[sales.reason];
  }

  const rawCosts = body.costs === undefined ? [] : body.costs;
  const costs = [];
  if (!Array.isArray(rawCosts)) {
    errors.costs = 'รูปแบบรายการต้นทุนไม่ถูกต้อง';
  } else {
    rawCosts.forEach((row, i) => {
      const category = row && typeof row.category === 'string' ? row.category.trim() : '';
      if (!CATEGORY_NAMES.includes(category)) errors[`costs.${i}.category`] = 'เลือกประเภทต้นทุนจากปุ่มด้านบน';
      const amount = parseAmount(row && row.amount);
      if (!amount.ok) errors[`costs.${i}.amount`] = AMOUNT_MESSAGES[amount.reason];
      else if (amount.value === 0) errors[`costs.${i}.amount`] = 'ต้นทุนต้องมากกว่า 0 ถ้าไม่มีให้ลบรายการนี้';

      // หมวด "อื่นๆ" ต้องบอกว่าเป็นค่าอะไร ไม่อย่างนั้นทีมและเจ้าของร้านจะย้อนดูไม่ออกว่าเงินหายไปไหน
      const note = row && typeof row.note === 'string' ? row.note.trim() : '';
      if (category === OTHER_CATEGORY && !note) errors[`costs.${i}.note`] = 'บอกหน่อยว่าเป็นค่าอะไร เช่น ค่าซ่อมรถเข็น';
      else if (note.length > MAX_NOTE_LENGTH) errors[`costs.${i}.note`] = `เขียนสั้น ๆ ไม่เกิน ${MAX_NOTE_LENGTH} ตัวอักษร`;

      if (!Object.keys(errors).some((k) => k.startsWith(`costs.${i}.`))) {
        costs.push(category === OTHER_CATEGORY ? { category, amount: amount.value, note } : { category, amount: amount.value });
      }
    });
    if (rawCosts.length === 0) {
      warnings.push('ยังไม่ได้ใส่ต้นทุนเลย ถ้าวันนี้มีค่าวัตถุดิบ แก๊ส หรือถุง กดแก้ไขแล้วเพิ่มได้');
    }
  }

  const ok = Object.keys(errors).length === 0;
  return { ok, errors, warnings, value: ok ? { date: body.date, sales: sales.value, costs } : null };
}

/**
 * คำนวณต้นทุนรวมและกำไรของหนึ่งวัน
 *
 * @param {number} sales - ยอดขาย (บาท)
 * @param {Array<{amount: number}>} costs - รายการต้นทุน
 * @returns {{totalCost: number, profit: number}} ต้นทุนรวมและกำไร (ติดลบคือขาดทุน)
 */
function computeProfit(sales, costs) {
  const totalCost = roundMoney(costs.reduce((sum, c) => sum + c.amount, 0));
  return { totalCost, profit: roundMoney(sales - totalCost) };
}

/**
 * รวมข้อมูลใหม่เข้ากับบันทึกเดิมของวันเดียวกัน ตามที่ผู้ใช้เลือกเมื่อระบบแจ้งว่าจดซ้ำ
 *
 * @param {{sales: number, costs: Array}} existing - บันทึกเดิมของวันนั้น
 * @param {{sales: number, costs: Array}} incoming - ข้อมูลที่เพิ่งกรอก
 * @param {'add'|'replace'} mode - add = บวกเพิ่ม (เช่น ขายรอบเย็นเพิ่ม), replace = แทนที่ของเดิม (แก้ที่จดผิด)
 * @returns {{sales: number, costs: Array}} ข้อมูลหลังรวม
 * @throws {Error} เมื่อ mode ไม่ใช่ add หรือ replace
 */
function mergeEntry(existing, incoming, mode) {
  if (mode === 'replace') return { sales: incoming.sales, costs: incoming.costs };
  if (mode === 'add') {
    return {
      sales: roundMoney(existing.sales + incoming.sales),
      costs: existing.costs.concat(incoming.costs),
    };
  }
  throw new Error('unknown merge mode: ' + mode);
}

/**
 * สรุปผลช่วงติดตาม 14 วันล่าสุด (นับรวมวันนี้) ของผู้เข้าร่วมหนึ่งคน
 *
 * @param {Array<{date: string, sales: number, costs: Array}>} entries - บันทึกทั้งหมดของคนนั้น
 * @param {string} today - วันที่วันนี้ รูปแบบ YYYY-MM-DD
 * @returns {{from: string, to: string, daysRecorded: number, missingDates: string[],
 *   totalSales: number, totalCost: number, totalProfit: number}}
 *   missingDates ไม่นับวันนี้ เพราะวันยังไม่จบ
 */
function summarizeWindow(entries, today) {
  const from = addDays(today, -(FOLLOW_UP_DAYS - 1));
  const inWindow = entries.filter((e) => e.date >= from && e.date <= today);
  const recorded = new Set(inWindow.map((e) => e.date));
  const missingDates = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    if (!recorded.has(d)) missingDates.push(d);
  }
  let totalSales = 0;
  let totalCost = 0;
  for (const e of inWindow) {
    totalSales += e.sales;
    totalCost += computeProfit(e.sales, e.costs).totalCost;
  }
  return {
    from,
    to: today,
    daysRecorded: recorded.size,
    missingDates,
    totalSales: roundMoney(totalSales),
    totalCost: roundMoney(totalCost),
    totalProfit: roundMoney(totalSales - totalCost),
  };
}

/**
 * แปลงข้อมูลดิบของผู้เข้าร่วมหนึ่งคนเป็น "สัญญาณ" ที่ทีมใช้ตัดสินใจว่าควรติดตามก่อนหรือไม่
 *
 * @param {Array<{date: string, sales: number, costs: Array}>} entries - บันทึกทั้งหมดของคนนั้น
 * @param {number} openHelpCount - จำนวนคำขอความช่วยเหลือที่ยังไม่เสร็จ
 * @param {string} today - วันที่วันนี้ รูปแบบ YYYY-MM-DD
 * @returns {{daysSinceLast: number|null, recordedDays: number, zeroCostStreak: number,
 *   lossStreak: number, openHelp: number}}
 *   daysSinceLast = null เมื่อยังไม่เคยจดเลย; streak นับจากบันทึกล่าสุดย้อนกลับไปจนกว่าจะเจอวันที่ไม่เข้าเงื่อนไข
 */
function computeSignals(entries, openHelpCount, today) {
  const sorted = entries.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const daysSinceLast = sorted.length ? daysBetween(sorted[0].date, today) : null;

  let zeroCostStreak = 0;
  for (const e of sorted) {
    if (e.costs.length === 0) zeroCostStreak++;
    else break;
  }
  let lossStreak = 0;
  for (const e of sorted) {
    if (computeProfit(e.sales, e.costs).profit < 0) lossStreak++;
    else break;
  }

  return {
    daysSinceLast,
    recordedDays: summarizeWindow(entries, today).daysRecorded,
    zeroCostStreak,
    lossStreak,
    openHelp: openHelpCount,
  };
}

/**
 * ตัดสินระดับความเร่งด่วนในการติดตามผู้เข้าร่วมหนึ่งคน จากสัญญาณที่ computeSignals คำนวณไว้
 *
 * @param {{daysSinceLast: number|null, recordedDays: number, zeroCostStreak: number,
 *   lossStreak: number, openHelp: number}} signals
 * @returns {{level: 'red'|'yellow'|'green', reasons: string[]}}
 *   red = ควรโทรวันนี้, yellow = ส่งข้อความเตือน, green = ปกติ
 *   reasons คือเหตุผลภาษาไทยสั้น ๆ ที่ทีมจะเห็นในหน้าทีม เช่น "ไม่ได้จดมา 4 วัน"
 */
function classifyPriority(signals) {
  const { daysSinceLast, zeroCostStreak, lossStreak } = signals;
  const red = [];
  const yellow = [];

  // จดล่าสุดเมื่อวาน (daysSinceLast = 1) ถือว่าปกติ เพราะวันนี้ยังขายไม่จบ วันที่ขาดจริงจึงเป็น daysSinceLast - 1
  if (daysSinceLast === null) red.push('ยังไม่เคยจดเลย');
  else if (daysSinceLast - 1 >= 3) red.push(`ไม่ได้จดมา ${daysSinceLast - 1} วัน`);
  else if (daysSinceLast - 1 >= 1) yellow.push(`ไม่ได้จดมา ${daysSinceLast - 1} วัน`);

  if (zeroCostStreak >= 3) yellow.push(`ไม่ใส่ต้นทุน ${zeroCostStreak} วันติด`);
  if (lossStreak >= 3) yellow.push(`ขาดทุน ${lossStreak} วันติด`);

  // openHelp ไม่นำมานับระดับ เพราะหน้าทีมมีคิวคำขอแยกอยู่แล้ว จะได้ไม่นับเรื่องเดียวซ้ำสองที่
  if (red.length) return { level: 'red', reasons: red.concat(yellow) };
  if (yellow.length) return { level: 'yellow', reasons: yellow };
  return { level: 'green', reasons: [] };
}

// ลำดับความเร่งด่วนสำหรับเรียงรายชื่อ (เลขน้อย = ขึ้นก่อน)
const LEVEL_RANK = { red: 0, yellow: 1, green: 2 };

/**
 * เรียงรายชื่อให้คนที่เร่งด่วนที่สุดขึ้นก่อน ถ้าระดับเท่ากันให้คนที่หายไปนานกว่าขึ้นก่อน
 *
 * @param {Array<{level: string, signals: {daysSinceLast: number|null}}>} rows - รายชื่อที่ประเมินแล้ว
 * @returns {Array} อาร์เรย์ใหม่ที่เรียงแล้ว (ไม่แก้ของเดิม)
 */
function sortByPriority(rows) {
  const gap = (r) => (r.signals.daysSinceLast === null ? Infinity : r.signals.daysSinceLast);
  return rows.slice().sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || gap(b) - gap(a));
}

module.exports = {
  COST_CATEGORIES,
  OFTEN_FORGOTTEN,
  HELP_TOPICS,
  HELP_STATUSES,
  FOLLOW_UP_DAYS,
  todayInBangkok,
  isValidDate,
  addDays,
  daysBetween,
  parseAmount,
  validateEntry,
  computeProfit,
  mergeEntry,
  summarizeWindow,
  computeSignals,
  classifyPriority,
  sortByPriority,
};
