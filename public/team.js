'use strict';

// หน้าทีมงาน (team.html): แท็บกรองตามความเร่งด่วน รายชื่อผู้เข้าร่วม และคิวคำขอความช่วยเหลือ

const $ = (id) => document.getElementById(id);
// ข้อความบนป้ายระดับ และสถานะคำขอ
const LEVEL_TEXT = { red: 'โทร', yellow: 'เตือน', green: 'ปกติ' };
const STATUS_TEXT = { waiting: 'รอรับเรื่อง', in_progress: 'กำลังช่วย' };
// คำอธิบายใต้แท็บ บอกทีมว่ากลุ่มนี้ควรทำอะไร
const FILTER_HINT = {
  red: 'ไม่ได้จดหลายวัน หรือยังไม่เคยจด — ควรโทรหาวันนี้',
  yellow: 'เริ่มหลุด ไม่ใส่ต้นทุน หรือขาดทุนติดกัน — ส่งข้อความ LINE เตือนก่อน',
  green: 'จดสม่ำเสมอ ไม่ต้องติดต่อ',
};
// สถานะของหน้า: data = ข้อมูลจาก /api/team, filter = แท็บที่เลือก, query = คำค้นหา
const state = { data: null, filter: null, query: '' };

/**
 * สร้าง element พร้อมข้อความ (ใช้ textContent เสมอ)
 *
 * @param {string} tag - ชื่อแท็ก
 * @param {string} [className] - class
 * @param {string} [text] - ข้อความ
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * จัดรูปแบบจำนวนเงิน เช่น 1500 → "1,500"
 *
 * @param {number} n - จำนวนเงิน
 * @returns {string}
 */
function fmt(n) {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 0 });
}

/**
 * แปลงเวลาเป็นข้อความไทยสั้น ๆ เช่น "15 ต.ค. 09:12 น." ให้ทีมรู้ว่าคำขอค้างมานานแค่ไหน
 *
 * @param {string} iso - เวลารูปแบบ ISO
 * @returns {string}
 */
function timeText(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  return `${date} ${time} น.`;
}

/**
 * โหลดข้อมูลหน้าทีมจากเซิร์ฟเวอร์แล้ววาดใหม่ทั้งหมด
 */
async function load() {
  try {
    const res = await fetch('/api/team');
    render(await res.json());
    $('err').textContent = '';
  } catch {
    $('err').textContent = 'โหลดข้อมูลไม่ได้ ตรวจว่าเซิร์ฟเวอร์ทำงานอยู่ แล้วรีเฟรชหน้านี้';
  }
}

/**
 * วาดตัวเลขสรุป (ซึ่งเป็นแท็บกรองด้วย) แล้ววาดเฉพาะแผงที่เลือกอยู่
 * เปิดครั้งแรกจะเลือกกลุ่มที่เร่งด่วนที่สุดที่มีคนอยู่ ตามลำดับ โทร → เตือน → คำขอ → ปกติ
 *
 * @param {{today: string, counts: object, participants: Array, helpRequests: Array, recentDone: Array}} data - ข้อมูลจาก /api/team
 */
function render(data) {
  state.data = data;
  $('today').textContent = 'ข้อมูล ณ ' + new Date(data.today + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'full' });
  $('c-red').textContent = data.counts.red;
  $('c-yellow').textContent = data.counts.yellow;
  $('c-green').textContent = data.counts.green;
  $('c-help').textContent = data.helpRequests.length;

  if (!state.filter) {
    state.filter = data.counts.red ? 'red' : data.counts.yellow ? 'yellow' : data.helpRequests.length ? 'help' : 'green';
  }
  renderFilters();
  renderHelpPanel(data);
  renderPeople();
}

/**
 * ทำให้แท็บที่เลือกดูต่างจากแท็บอื่น และสลับแผงรายชื่อ/แผงคำขอ
 */
function renderFilters() {
  document.querySelectorAll('#filters button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.filter === state.filter));
  });
  $('panel-help').hidden = state.filter !== 'help';
  $('panel-people').hidden = state.filter === 'help';
}

/**
 * วาดคิวคำขอความช่วยเหลือที่ยังไม่เสร็จ และรายการที่ช่วยเสร็จแล้วล่าสุด
 *
 * @param {{helpRequests: Array, recentDone: Array}} data - ข้อมูลจาก /api/team
 */
function renderHelpPanel(data) {
  const queue = $('queue');
  queue.replaceChildren();
  $('queue-empty').hidden = data.helpRequests.length > 0;
  for (const h of data.helpRequests) {
    const li = el('li');
    const statusLine = h.status === 'waiting'
      ? `${STATUS_TEXT.waiting} — ส่งเมื่อ ${timeText(h.createdAt)}`
      : `${STATUS_TEXT.in_progress} — รับเรื่องเมื่อ ${timeText(h.updatedAt)}`;
    li.append(el('strong', '', `${h.participantName} — ${h.topicText}`), el('span', 'status', statusLine));
    const actions = el('div', 'row-actions');
    if (h.status === 'waiting') actions.append(statusButton(h.id, 'in_progress', 'รับเรื่อง'));
    actions.append(statusButton(h.id, 'done', 'ช่วยเสร็จแล้ว'));
    li.append(actions);
    queue.append(li);
  }

  $('done-summary').textContent = `ช่วยเสร็จแล้วล่าสุด (${data.recentDone.length})`;
  const done = $('done');
  done.replaceChildren();
  for (const h of data.recentDone) {
    const li = el('li');
    li.append(el('span', '', `${h.participantName} — ${h.topicText}`), el('span', 'status', `เสร็จเมื่อ ${timeText(h.updatedAt)}`));
    done.append(li);
  }
}

/**
 * วาดรายชื่อเฉพาะกลุ่มที่เลือก ถ้าพิมพ์ค้นหา จะค้นจากทุกกลุ่ม (ทีมอาจถูกแม่ค้าโทรมาถามและต้องหาชื่อเร็ว ๆ)
 */
function renderPeople() {
  const q = state.query.trim();
  const rows = q
    ? state.data.participants.filter((p) => `${p.name} ${p.stall} ${p.id}`.includes(q))
    : state.data.participants.filter((p) => p.level === state.filter);

  $('people-hint').textContent = q ? `ผลค้นหา "${q}" จากทุกกลุ่ม: ${rows.length} แผง` : FILTER_HINT[state.filter];
  $('people-empty').hidden = rows.length > 0;
  $('people-empty').textContent = q ? 'ไม่พบแผงที่ค้นหา ลองพิมพ์แค่ตัวเลข เช่น 07' : 'ไม่มีใครอยู่ในกลุ่มนี้';

  const people = $('people');
  people.replaceChildren();
  for (const p of rows) {
    const li = el('li');
    const top = el('div', 'person-top');
    // ป้ายระดับแสดงเฉพาะตอนค้นหา เพราะตอนกรองตามแท็บ ทุกแถวอยู่ระดับเดียวกันอยู่แล้ว
    if (q) top.append(el('span', 'level ' + p.level, LEVEL_TEXT[p.level]));
    const link = el('a', '', `${p.name} · ${p.stall}`);
    link.href = '/?p=' + encodeURIComponent(p.id);
    top.append(link);
    li.append(top);
    if (p.reasons.length) li.append(el('p', 'reason', p.reasons.join(' และ ')));

    const s = p.signals;
    const last = s.daysSinceLast === null ? 'ยังไม่เคยจด'
      : s.daysSinceLast === 0 ? 'จดล่าสุดวันนี้'
      : s.daysSinceLast === 1 ? 'จดล่าสุดเมื่อวาน'
      : `จดล่าสุด ${s.daysSinceLast} วันก่อน`;
    const profit = `${p.summary.totalProfit < 0 ? 'ขาดทุน' : 'กำไร'} ${fmt(Math.abs(p.summary.totalProfit))}`;
    li.append(el('p', 'stats money', `จด ${p.summary.daysRecorded}/14 วัน · ${last} · ${profit}`));
    people.append(li);
  }
}

/**
 * สร้างปุ่มเปลี่ยนสถานะคำขอความช่วยเหลือ
 *
 * @param {string} id - รหัสคำขอ
 * @param {string} status - สถานะใหม่
 * @param {string} label - ข้อความบนปุ่ม
 * @returns {HTMLButtonElement}
 */
function statusButton(id, status, label) {
  const b = el('button', 'secondary', label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await fetch('/api/help/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch {
      $('err').textContent = 'เปลี่ยนสถานะไม่สำเร็จ ลองอีกครั้ง';
      b.disabled = false;
    }
  });
  return b;
}

document.querySelectorAll('#filters button').forEach((b) => {
  b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    state.query = '';
    $('search').value = '';
    renderFilters();
    renderPeople();
  });
});
$('search').addEventListener('input', () => {
  state.query = $('search').value;
  renderPeople();
});

load();
