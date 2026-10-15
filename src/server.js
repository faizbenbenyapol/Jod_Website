'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const logic = require('./logic');
const { buildSeedData, writeSeed } = require('../scripts/seed');

// เซิร์ฟเวอร์ของต้นแบบ "จดกำไร": ส่งหน้าเว็บในโฟลเดอร์ public และให้บริการ API
//   GET  /api/vendor/:id          ข้อมูลหน้าแม่ค้า
//   POST /api/vendor/:id/entries  บันทึกยอดประจำวัน (ตรวจข้อมูล + จัดการจดซ้ำ)
//   POST /api/vendor/:id/help     ส่งคำขอความช่วยเหลือ
//   GET  /api/team                ข้อมูลหน้าทีม (จัดลำดับความเร่งด่วน + คิวคำขอ)
//   PATCH /api/help/:id           เปลี่ยนสถานะคำขอ
//   POST /api/demo/reset          รีเซ็ตเป็นข้อมูลเดโมชุดแรก (ต้นแบบเท่านั้น)

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_DB = path.join(__dirname, '..', 'data', 'db.json');
// จำกัดขนาดข้อมูลที่ส่งเข้ามา กันคนส่งข้อมูลก้อนใหญ่จนเซิร์ฟเวอร์ช้า (ฟอร์มจดจริงไม่ถึง 2 KB)
const MAX_BODY_BYTES = 10 * 1024;
// จำนวนคำขอที่ "ช่วยเสร็จแล้ว" ที่แสดงในหน้าทีม ให้เห็นงานล่าสุดโดยไม่ยาวเกิน
const RECENT_DONE_LIMIT = 10;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/**
 * ส่งผลลัพธ์กลับเป็น JSON
 *
 * @param {http.ServerResponse} res - response ของ Node
 * @param {number} status - HTTP status code
 * @param {object} body - ข้อมูลที่จะส่ง
 */
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * อ่าน body ของ request แล้วแปลงเป็น JSON
 *
 * @param {http.IncomingMessage} req - request ของ Node
 * @returns {Promise<object>} ข้อมูลที่ส่งมา (body ว่างจะได้ {})
 * @throws {Error} code = 'BAD_JSON' เมื่ออ่าน JSON ไม่ได้, 'TOO_LARGE' เมื่อเกิน 10 KB
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('bad json'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * ส่งไฟล์หน้าเว็บจากโฟลเดอร์ public โดยกันไม่ให้ขอไฟล์นอกโฟลเดอร์ (เช่น ../data/db.json)
 *
 * @param {http.ServerResponse} res - response ของ Node
 * @param {string} urlPath - path ที่ขอ เช่น "/style.css"
 */
function serveStatic(res, urlPath) {
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  const type = CONTENT_TYPES[path.extname(file)];
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !type || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ไม่พบหน้านี้');
    return;
  }
  // no-cache = ให้เบราว์เซอร์ถามเซิร์ฟเวอร์ทุกครั้ง กันกรณี HTML ใหม่แต่ใช้ CSS/JS เก่าที่จำไว้ จนหน้าเพี้ยน
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

/**
 * สร้างข้อมูลสำหรับหน้าแม่ค้า: ข้อมูลร้าน บันทึกทั้งหมด (ใช้ดูย้อนหลังรายเดือน)
 * สรุปช่วงติดตาม 14 วัน (ใช้เตือนวันที่ลืมจด) และคำขอที่ค้างอยู่
 *
 * @param {Store} store - ที่เก็บข้อมูล
 * @param {object} participant - ผู้เข้าร่วม
 * @param {string} today - วันที่วันนี้ รูปแบบ YYYY-MM-DD
 * @returns {object} ข้อมูลพร้อมส่งให้หน้าเว็บ
 */
function vendorView(store, participant, today) {
  const all = store.entriesOf(participant.id);
  const summary = logic.summarizeWindow(all, today);
  const entries = all
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) => ({ date: e.date, sales: e.sales, costs: e.costs, ...logic.computeProfit(e.sales, e.costs) }));
  return {
    participant,
    today,
    categories: logic.COST_CATEGORIES,
    oftenForgotten: logic.OFTEN_FORGOTTEN,
    helpTopics: logic.HELP_TOPICS,
    entries,
    summary,
    openHelp: store.openHelpRequests(participant.id),
  };
}

/**
 * สร้างข้อมูลสำหรับหน้าทีม: ประเมินทุกคน เรียงตามความเร่งด่วน และคิวคำขอความช่วยเหลือ
 *
 * @param {Store} store - ที่เก็บข้อมูล
 * @param {string} today - วันที่วันนี้ รูปแบบ YYYY-MM-DD
 * @returns {object} ข้อมูลพร้อมส่งให้หน้าทีม
 */
function teamView(store, today) {
  const rows = store.data.participants.map((p) => {
    const entries = store.entriesOf(p.id);
    const signals = logic.computeSignals(entries, store.openHelpRequests(p.id).length, today);
    const { level, reasons } = logic.classifyPriority(signals);
    return { ...p, level, reasons, signals, summary: logic.summarizeWindow(entries, today) };
  });
  const sorted = logic.sortByPriority(rows);
  const counts = { red: 0, yellow: 0, green: 0 };
  for (const r of sorted) counts[r.level]++;
  const names = Object.fromEntries(store.data.participants.map((p) => [p.id, p.name]));
  const withNames = (h) => ({ ...h, participantName: names[h.participantId], topicText: logic.HELP_TOPICS[h.topic] });
  const helpRequests = store
    .openHelpRequests()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map(withNames);
  const recentDone = store.data.helpRequests
    .filter((h) => h.status === 'done')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, RECENT_DONE_LIMIT)
    .map(withNames);
  return { today, counts, participants: sorted, helpRequests, recentDone };
}

/**
 * จัดการคำขอบันทึกยอดประจำวัน รวมการตรวจข้อมูลและการจดซ้ำ
 *
 * @param {Store} store - ที่เก็บข้อมูล
 * @param {object} participant - ผู้เข้าร่วมที่กำลังจด
 * @param {object} body - ข้อมูลจากฟอร์ม {date, sales, costs, mode?}
 * @param {string} today - วันที่วันนี้
 * @returns {{status: number, body: object}}
 *   400 = ข้อมูลผิด, 409 = วันนั้นจดไปแล้วและยังไม่ได้เลือก mode, 201 = จดใหม่, 200 = รวม/แทนที่ของเดิม
 */
function handleSaveEntry(store, participant, body, today) {
  const check = logic.validateEntry(body, today);
  if (!check.ok) {
    return { status: 400, body: { error: 'invalid', message: 'ยังบันทึกไม่ได้ มีบางช่องต้องแก้', errors: check.errors } };
  }
  if (body.mode !== undefined && body.mode !== 'add' && body.mode !== 'replace') {
    return { status: 400, body: { error: 'invalid', message: 'ไม่รู้จักวิธีบันทึกที่เลือก', errors: {} } };
  }

  const existing = store.findEntry(participant.id, check.value.date);
  if (existing && !body.mode) {
    return {
      status: 409,
      body: {
        error: 'duplicate',
        message: 'วันนี้จดไว้แล้ว จะบวกเพิ่ม หรือแทนที่ของเดิม?',
        existing: { date: existing.date, sales: existing.sales, costs: existing.costs, ...logic.computeProfit(existing.sales, existing.costs) },
      },
    };
  }

  const value = existing ? { date: existing.date, ...logic.mergeEntry(existing, check.value, body.mode) } : check.value;
  const entry = store.upsertEntry(participant.id, value);
  const result = logic.computeProfit(entry.sales, entry.costs);
  const summary = logic.summarizeWindow(store.entriesOf(participant.id), today);
  return {
    status: existing ? 200 : 201,
    body: {
      entry: { date: entry.date, sales: entry.sales, costs: entry.costs, ...result },
      summary,
      warnings: check.warnings,
      action: existing ? body.mode : 'created',
    },
  };
}

/**
 * สร้าง HTTP server ของแอป แยกจากการ listen เพื่อให้ชุดทดสอบเรียกใช้ได้
 *
 * @param {{dbPath?: string, today?: () => string}} [options]
 *   dbPath = ไฟล์ข้อมูล, today = ฟังก์ชันคืนวันที่วันนี้ (ใช้ล็อกวันในการทดสอบ)
 * @returns {{server: http.Server, store: Store}}
 */
function createApp(options = {}) {
  const store = new Store(options.dbPath || DEFAULT_DB);
  const today = options.today || (() => logic.todayInBangkok());

  /**
   * จับคู่ URL กับการทำงาน (router ของแอป)
   *
   * @param {http.IncomingMessage} req - request
   * @param {http.ServerResponse} res - response
   */
  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    let m;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(res, '/index.html');
    if (req.method === 'GET' && p === '/team') return serveStatic(res, '/team.html');

    if ((m = p.match(/^\/api\/vendor\/([\w-]+)$/)) && req.method === 'GET') {
      const participant = store.getParticipant(m[1]);
      if (!participant) return sendJson(res, 404, { error: 'not_found', message: 'ไม่พบรหัสร้านนี้ ลองเปิดลิงก์ที่ทีมส่งให้อีกครั้ง' });
      return sendJson(res, 200, vendorView(store, participant, today()));
    }

    if ((m = p.match(/^\/api\/vendor\/([\w-]+)\/entries$/)) && req.method === 'POST') {
      const participant = store.getParticipant(m[1]);
      if (!participant) return sendJson(res, 404, { error: 'not_found', message: 'ไม่พบรหัสร้านนี้' });
      const result = handleSaveEntry(store, participant, await readJson(req), today());
      return sendJson(res, result.status, result.body);
    }

    if ((m = p.match(/^\/api\/vendor\/([\w-]+)\/help$/)) && req.method === 'POST') {
      const participant = store.getParticipant(m[1]);
      if (!participant) return sendJson(res, 404, { error: 'not_found', message: 'ไม่พบรหัสร้านนี้' });
      const { topic } = await readJson(req);
      if (!logic.HELP_TOPICS[topic]) return sendJson(res, 400, { error: 'invalid', message: 'กรุณาเลือกเรื่องที่ต้องการให้ช่วย' });
      const already = store.openHelpRequests(participant.id).find((h) => h.topic === topic);
      if (already) {
        return sendJson(res, 200, { request: already, alreadyOpen: true, message: 'ส่งเรื่องนี้ไปแล้ว ทีมกำลังดูให้อยู่ ไม่ต้องกดซ้ำ' });
      }
      const request = store.addHelpRequest(participant.id, topic);
      return sendJson(res, 201, { request, alreadyOpen: false, message: 'ทีมได้รับเรื่องแล้ว จะติดต่อกลับภายในวันนี้' });
    }

    if (req.method === 'GET' && p === '/api/team') return sendJson(res, 200, teamView(store, today()));

    // ล้างข้อมูลทั้งหมดกลับเป็นชุดเดโม ใช้ในต้นแบบเท่านั้น (ระบบจริงต้องไม่มี endpoint นี้)
    if (req.method === 'POST' && p === '/api/demo/reset') {
      store.replaceAll(buildSeedData(today()));
      return sendJson(res, 200, { message: 'รีเซ็ตเป็นข้อมูลเดโมชุดแรกแล้ว' });
    }

    if ((m = p.match(/^\/api\/help\/([\w-]+)$/)) && req.method === 'PATCH') {
      const { status } = await readJson(req);
      if (!logic.HELP_STATUSES.includes(status)) return sendJson(res, 400, { error: 'invalid', message: 'สถานะไม่ถูกต้อง' });
      const updated = store.setHelpStatus(m[1], status);
      if (!updated) return sendJson(res, 404, { error: 'not_found', message: 'ไม่พบคำขอนี้' });
      return sendJson(res, 200, { request: updated });
    }

    if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);
    return sendJson(res, 404, { error: 'not_found', message: 'ไม่พบ API นี้' });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (err.code === 'BAD_JSON') return sendJson(res, 400, { error: 'bad_json', message: 'ข้อมูลที่ส่งมาอ่านไม่ได้' });
      if (err.code === 'TOO_LARGE') return sendJson(res, 413, { error: 'too_large', message: 'ข้อมูลยาวเกินไป' });
      console.error(err);
      sendJson(res, 500, { error: 'server', message: 'ระบบขัดข้อง ข้อมูลที่กรอกยังอยู่ ลองกดบันทึกอีกครั้ง' });
    });
  });
  return { server, store };
}

if (require.main === module) {
  if (!fs.existsSync(DEFAULT_DB)) {
    writeSeed(DEFAULT_DB, logic.todayInBangkok());
    console.log('สร้างข้อมูลตัวอย่าง 60 ร้านไว้ที่ data/db.json');
  }
  const port = Number(process.env.PORT) || 3000;
  createApp().server.listen(port, () => {
    console.log(`หน้าแม่ค้า : http://localhost:${port}/?p=P01`);
    console.log(`หน้าทีม    : http://localhost:${port}/team`);
  });
}

module.exports = { createApp };
