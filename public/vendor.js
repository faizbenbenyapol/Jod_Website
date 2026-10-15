'use strict';

// หน้าแม่ค้า (index.html): หน้าเข้าใช้งาน + 3 เมนู คือ จดวันนี้ / ดูย้อนหลังรายเดือน / ขอให้ทีมช่วย

// รหัสร้านจาก URL เช่น /?p=P01 (ไม่มี = แสดงหน้าเข้าใช้งาน)
const pid = new URLSearchParams(location.search).get('p');
const $ = (id) => document.getElementById(id);
// ชื่อเมนูตรงกับ hash ใน URL (#jod, #history, #help)
const VIEWS = ['jod', 'history', 'help'];
const OTHER_CATEGORY = 'อื่นๆ';
const SVG_NS = 'http://www.w3.org/2000/svg';
// สถานะของหน้า: data = ข้อมูลจากเซิร์ฟเวอร์, costs = แถวต้นทุนที่กำลังกรอก, sending = กำลังส่ง (กันกดซ้ำ),
// selectedDay = วันที่เลือกในเมนูย้อนหลัง, month = เดือนที่กำลังดู (YYYY-MM)
const state = { data: null, costs: [], sending: false, selectedDay: null, month: null };

/**
 * จัดรูปแบบจำนวนเงินให้อ่านง่าย เช่น 1500 → "1,500"
 *
 * @param {number} n - จำนวนเงิน
 * @returns {string} ข้อความตัวเลขมีจุลภาค
 */
function fmt(n) {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

/**
 * แปลงวันที่เป็นภาษาไทยแบบสั้น เช่น "2026-10-15" → "พฤ. 15 ต.ค."
 *
 * @param {string} d - วันที่รูปแบบ YYYY-MM-DD
 * @returns {string} วันที่ภาษาไทย
 */
function thDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * แปลงวันที่เป็นภาษาไทยแบบเต็ม เช่น "2026-10-15" → "วันพฤหัสบดีที่ 15 ตุลาคม"
 *
 * @param {string} d - วันที่รูปแบบ YYYY-MM-DD
 * @returns {string} วันที่ภาษาไทยแบบเต็ม
 */
function thDateLong(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * บวกหรือลบจำนวนวันจากวันที่ที่กำหนด
 *
 * @param {string} date - วันที่ตั้งต้น รูปแบบ YYYY-MM-DD
 * @param {number} n - จำนวนวัน (ติดลบคือย้อนหลัง)
 * @returns {string} วันที่ใหม่ รูปแบบ YYYY-MM-DD
 */
function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * แปลงข้อความในช่องเงินเป็นตัวเลขเพื่อแสดงยอดรวมระหว่างพิมพ์ (ไม่ใช่การตรวจจริง การตรวจจริงทำที่เซิร์ฟเวอร์)
 *
 * @param {string} v - ข้อความในช่อง
 * @returns {number} ตัวเลข หรือ 0 ถ้ายังอ่านไม่ได้
 */
function looseNumber(v) {
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * สร้าง element พร้อมข้อความ (ใช้ textContent เสมอ กันข้อความแปลก ๆ กลายเป็น HTML)
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
 * สร้าง element ของ SVG พร้อมกำหนด attribute
 *
 * @param {string} tag - ชื่อแท็ก SVG เช่น "rect", "path"
 * @param {Object<string, string|number>} attrs - attribute ที่ต้องการตั้ง
 * @returns {SVGElement}
 */
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * สลับเมนูตาม hash ของ URL (#jod, #history, #help) ปุ่มย้อนกลับของมือถือจึงพากลับเมนูก่อนหน้าได้
 */
function showView() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'jod';
  for (const v of VIEWS) $('view-' + v).hidden = !state.data || v !== name;
  document.querySelectorAll('#tabs a').forEach((a) => {
    if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

/**
 * โหลดข้อมูลร้านจากเซิร์ฟเวอร์แล้ววาดทุกเมนูใหม่ (ฟอร์มที่กำลังกรอกยังอยู่)
 */
async function load() {
  if (!pid) {
    $('status-msg').hidden = true;
    $('login').hidden = false;
    return;
  }
  try {
    const res = await fetch('/api/vendor/' + encodeURIComponent(pid));
    const body = await res.json();
    if (!res.ok) {
      $('status-msg').textContent = body.message;
      return;
    }
    state.data = body;
  } catch {
    $('status-msg').textContent = 'เปิดสมุดไม่ได้ ตรวจว่ามีสัญญาณเน็ต แล้วลองรีเฟรชหน้านี้';
    return;
  }
  $('status-msg').hidden = true;
  const firstLoad = $('tabs').hidden;
  $('tabs').hidden = false;
  renderShop();
  renderHistory();
  renderHelp();
  if (firstLoad) showView();
}

/**
 * วาดหัวหน้าร้าน รายการวันที่ให้เลือก และปุ่มประเภทต้นทุน
 */
function renderShop() {
  const { participant, today } = state.data;
  $('shop').hidden = false;
  $('shop-name').textContent = participant.name + ' · ' + participant.stall;
  $('shop-meta').textContent = participant.market + ' — ' + thDateLong(today);
  renderDayPick();
  renderMissed();
  renderChips();
  renderRows();
}

/**
 * เตือนวันที่ลืมจดทันทีที่เปิดเมนูจด (คนที่ลืมมักไม่รู้ตัวว่าลืม) พร้อมปุ่มกดจดวันนั้นได้เลย
 * แสดงปุ่มไม่เกิน 3 วันล่าสุดเพื่อไม่ให้รก ที่เหลือให้ไปดูในเมนูย้อนหลัง
 */
function renderMissed() {
  const { summary, today, entries } = state.data;
  const box = $('missed');
  // นับวันที่ลืมจดตั้งแต่วันแรกที่เริ่มจดเท่านั้น คนที่เพิ่งเริ่มไม่ควรเห็นว่า "ลืม" วันที่ตัวเองยังไม่ได้เข้าร่วม
  // (entries เรียงจากใหม่ไปเก่า ตัวสุดท้ายจึงเป็นวันแรกที่จด) ยังไม่เคยจดเลย = ไม่มีวันที่ลืม
  const firstDate = entries.length ? entries[entries.length - 1].date : null;
  const missing = firstDate ? summary.missingDates.filter((d) => d > firstDate).reverse() : [];
  box.hidden = missing.length === 0;
  box.replaceChildren();
  if (!missing.length) return;

  const yesterday = addDays(today, -1);
  const headline = missing.length === 1 && missing[0] === yesterday
    ? 'เมื่อวานยังไม่ได้จด'
    : `ยังไม่ได้จด ${missing.length} วัน`;
  box.append(el('strong', '', headline), el('p', '', 'ลืมไม่เป็นไร จดย้อนหลังได้ จำยอดคร่าว ๆ ได้ก็ใส่ไปก่อน'));

  const actions = el('div', 'row-actions');
  for (const date of missing.slice(0, 3)) {
    const b = el('button', 'secondary', date === yesterday ? 'จดของเมื่อวาน' : 'จดของ ' + thDate(date));
    b.type = 'button';
    b.addEventListener('click', () => startEntry(date));
    actions.append(b);
  }
  if (missing.length > 3) {
    const more = el('a', '', `ดูอีก ${missing.length - 3} วันในเมนูย้อนหลัง`);
    more.href = '#history';
    actions.append(more);
  }
  box.append(actions);
}

/**
 * วาดปุ่มเลือกวันที่จด: "วันนี้" (ค่าเริ่มต้น) กับ "เมื่อวาน" เพราะเกือบทุกครั้งแม่ค้าจดของวันนี้
 * ถ้าเข้ามาจากปฏิทินย้อนหลังด้วยวันที่เก่ากว่านั้น จะมีปุ่มที่สามของวันนั้นเพิ่มขึ้นมาและถูกเลือกไว้
 */
function renderDayPick() {
  const { today } = state.data;
  const input = $('date');
  if (!input.value) input.value = today;
  const choices = [
    { date: today, label: 'วันนี้' },
    { date: addDays(today, -1), label: 'เมื่อวาน' },
  ];
  if (!choices.some((c) => c.date === input.value)) choices.push({ date: input.value, label: 'จดย้อนหลัง' });

  const box = $('day-pick');
  box.replaceChildren();
  for (const c of choices) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c.date === input.value));
    b.append(el('strong', '', c.label), el('small', '', thDate(c.date)));
    b.addEventListener('click', () => {
      input.value = c.date;
      renderDayPick();
    });
    box.append(b);
  }
}

/**
 * วาดปุ่มประเภทต้นทุนพร้อมตัวอย่าง ปุ่มที่เพิ่มแล้วจะเป็นสีทึบ
 */
function renderChips() {
  const box = $('chips');
  box.replaceChildren();
  for (const cat of state.data.categories) {
    const used = state.costs.some((c) => c.category === cat.name);
    const b = el('button', 'chip');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(used));
    b.append(el('strong', '', (used ? '✓ ' : '+ ') + cat.name), el('small', '', cat.examples));
    b.addEventListener('click', () => addCost(cat.name));
    box.append(b);
  }
}

/**
 * เพิ่มแถวต้นทุนตามประเภทที่กด แล้วเลื่อนเคอร์เซอร์ไปช่องแรกที่ต้องกรอก
 * (หมวด "อื่นๆ" ไปที่ช่องบอกว่าเป็นค่าอะไร หมวดอื่นไปที่ช่องจำนวนเงิน)
 *
 * @param {string} category - ชื่อประเภทต้นทุน
 */
function addCost(category) {
  state.costs.push({ category, amount: '', note: '' });
  renderRows();
  renderChips();
  const rows = $('cost-rows').children;
  const last = rows[rows.length - 1];
  (last.querySelector('.note-input') || last.querySelector('.amount-input')).focus();
}

/**
 * วาดรายการต้นทุนที่กรอกอยู่ แถว "อื่นๆ" มีช่องให้พิมพ์ว่าเป็นค่าอะไรเพิ่ม
 */
function renderRows() {
  const list = $('cost-rows');
  list.replaceChildren();
  state.costs.forEach((row, i) => {
    const li = el('li', 'cost-row');
    const amount = el('input', 'amount-input');
    amount.inputMode = 'decimal';
    amount.autocomplete = 'off';
    amount.placeholder = '0';
    amount.value = row.amount;
    amount.setAttribute('aria-label', 'จำนวนเงินค่า' + row.category);
    amount.addEventListener('input', () => {
      row.amount = amount.value;
      updateTally();
    });
    const remove = el('button', 'remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'ลบค่า' + row.category);
    remove.addEventListener('click', () => {
      state.costs.splice(i, 1);
      renderRows();
      renderChips();
    });
    li.append(el('span', 'name', row.category), amount, remove);

    if (row.category === OTHER_CATEGORY) {
      const note = el('input', 'note-input');
      note.placeholder = 'ค่าอะไร เช่น ค่าซ่อมรถเข็น';
      note.maxLength = 40;
      note.value = row.note;
      note.setAttribute('aria-label', 'บอกว่าค่าอื่นๆ นี้คือค่าอะไร');
      note.addEventListener('input', () => (row.note = note.value));
      const noteErr = el('p', 'err');
      noteErr.dataset.for = `costs.${i}.note`;
      li.append(note, noteErr);
    }
    const err = el('p', 'err');
    err.dataset.for = `costs.${i}.amount`;
    li.append(err);
    list.append(li);
  });
  renderForgot();
  updateTally();
}

/**
 * เตือนต้นทุนที่คนมักลืม (แก๊ส ภาชนะ ค่าที่ น้ำแข็ง) ที่ยังไม่ได้ใส่ ซึ่งเป็นปัญหาหลักที่ต้นแบบนี้ตั้งใจแก้
 */
function renderForgot() {
  const missing = state.data.oftenForgotten.filter((cat) => !state.costs.some((c) => c.category === cat));
  $('forgot').textContent = missing.length
    ? 'มักถูกลืม: ' + missing.join(', ') + ' — วันนี้มีจ่ายไหม? ถ้ามี กดปุ่มด้านบนเพิ่มได้'
    : '';
}

/**
 * คำนวณยอดขาย ต้นทุน และกำไรระหว่างพิมพ์ ให้ผู้ใช้เห็นผลก่อนกดบันทึก
 */
function updateTally() {
  const sales = looseNumber($('sales').value);
  const cost = state.costs.reduce((s, c) => s + looseNumber(c.amount), 0);
  const profit = sales - cost;
  $('t-sales').textContent = fmt(sales);
  $('t-cost').textContent = fmt(cost);
  $('t-label').textContent = profit < 0 ? 'ขาดทุน' : 'กำไร';
  $('t-profit').textContent = fmt(Math.abs(profit));
  $('t-profit').style.color = profit < 0 ? 'var(--loss)' : 'var(--profit)';
}

/**
 * ล้างข้อความแจ้งข้อผิดพลาดทั้งหมดในฟอร์ม
 */
function clearErrors() {
  document.querySelectorAll('#entry .err').forEach((p) => (p.textContent = ''));
  document.querySelectorAll('#entry input, #entry select').forEach((i) => i.removeAttribute('aria-invalid'));
}

/**
 * แสดงข้อผิดพลาดจากเซิร์ฟเวอร์ใต้ช่องที่ผิด แล้วเลื่อนเคอร์เซอร์ไปช่องแรกที่ผิด
 *
 * @param {Object<string,string>} errors - ข้อความผิดพลาด คีย์คือชื่อช่อง เช่น "sales", "costs.0.amount", "costs.2.note"
 */
function showErrors(errors) {
  let first = null;
  for (const [field, msg] of Object.entries(errors)) {
    const p = document.querySelector(`#entry .err[data-for="${field}"]`);
    if (!p) continue;
    p.textContent = msg;
    let input = $(field);
    if (field.startsWith('costs.')) {
      input = p.parentElement.querySelector(field.endsWith('.note') ? '.note-input' : '.amount-input');
    }
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      first = first || input;
    }
  }
  if (first) first.focus();
}

/**
 * ส่งข้อมูลบันทึกไปเซิร์ฟเวอร์ และจัดการผลทุกแบบ: สำเร็จ, ข้อมูลผิด, จดซ้ำ, เน็ตหลุด
 * ปุ่มบันทึกถูกล็อกระหว่างส่ง กันกดสองครั้งแล้วเกิดรายการซ้ำ
 *
 * @param {'add'|'replace'} [mode] - ส่งมาเฉพาะตอนผู้ใช้เลือกวิธีจัดการรายการซ้ำแล้ว
 */
async function submit(mode) {
  if (state.sending) return;
  state.sending = true;
  const btn = $('save');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก…';
  clearErrors();
  $('form-err').textContent = '';

  const payload = { date: $('date').value, sales: $('sales').value, costs: state.costs, mode };
  try {
    const res = await fetch(`/api/vendor/${encodeURIComponent(pid)}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (res.status === 409) openDuplicate(body.existing);
    else if (!res.ok) {
      $('form-err').textContent = body.message;
      if (body.errors) showErrors(body.errors);
    } else {
      showResult(body);
      await load();
    }
  } catch {
    $('form-err').textContent = 'ส่งไม่สำเร็จ ตรวจว่ามีสัญญาณเน็ต แล้วกดบันทึกอีกครั้ง (ตัวเลขที่กรอกยังอยู่)';
  } finally {
    state.sending = false;
    btn.disabled = false;
    btn.textContent = 'บันทึก';
  }
}

/**
 * เปิดกล่องถามเมื่อวันนั้นจดไว้แล้ว เทียบของเดิมกับที่เพิ่งกรอกให้ผู้ใช้ตัดสินใจเอง
 *
 * @param {{date: string, sales: number, totalCost: number}} existing - บันทึกเดิมของวันนั้น
 */
function openDuplicate(existing) {
  const newCost = state.costs.reduce((s, c) => s + looseNumber(c.amount), 0);
  $('dup-title').textContent = (existing.date === state.data.today ? 'วันนี้' : thDate(existing.date)) + ' จดไว้แล้ว';
  $('dup-old').textContent = `ที่จดไว้แล้ว: ขาย ${fmt(existing.sales)} ต้นทุน ${fmt(existing.totalCost)} บาท`;
  $('dup-new').textContent = `ที่เพิ่งกรอก: ขาย ${fmt(looseNumber($('sales').value))} ต้นทุน ${fmt(newCost)} บาท`;
  $('dup').showModal();
}

/**
 * แสดงผลหลังบันทึกสำเร็จ: กำไร/ขาดทุนตัวใหญ่ ความคืบหน้า 14 วัน และสิ่งที่ควรทำต่อ
 *
 * @param {{entry: object, summary: object, warnings: string[], action: string}} body - ผลจากเซิร์ฟเวอร์
 */
function showResult(body) {
  const { entry, summary, warnings, action } = body;
  const actionText = { created: 'บันทึกแล้ว', add: 'บวกเพิ่มเข้าบันทึกเดิมแล้ว', replace: 'แทนที่บันทึกเดิมแล้ว' }[action];
  $('r-action').textContent = `${actionText} — ${thDateLong(entry.date)}`;
  const big = $('r-big');
  big.textContent = entry.profit < 0 ? `ขาดทุน ${fmt(-entry.profit)} บาท` : `กำไร ${fmt(entry.profit)} บาท`;
  big.className = 'big ' + (entry.profit < 0 ? 'loss' : 'profit');
  $('r-detail').textContent = `ขายได้ ${fmt(entry.sales)} − ต้นทุน ${fmt(entry.totalCost)}`;
  $('r-warn').hidden = warnings.length === 0;
  $('r-warn').textContent = warnings.join(' ');
  $('r-progress').textContent = `ช่วงติดตาม 14 วันล่าสุด จดแล้ว ${summary.daysRecorded} วัน`;
  $('r-next').textContent = summary.missingDates.length
    ? `ยังขาด ${summary.missingDates.length} วัน กด "ดูย้อนหลัง" แล้วแตะวันที่ขาดเพื่อจดย้อนหลังได้`
    : 'ครบทุกวันแล้ว พรุ่งนี้หลังเก็บร้าน มาจดอีกครั้งนะ';
  state.selectedDay = entry.date;
  state.month = entry.date.slice(0, 7);
  $('entry').hidden = true;
  $('result').hidden = false;
  window.scrollTo(0, 0);
}

/**
 * ล้างฟอร์มและเปิดเมนูจดตามวันที่ที่กำหนด
 *
 * @param {string} date - วันที่ที่จะจด รูปแบบ YYYY-MM-DD
 */
function startEntry(date) {
  $('date').value = date;
  renderDayPick();
  $('sales').value = '';
  state.costs = [];
  clearErrors();
  $('form-err').textContent = '';
  $('result').hidden = true;
  $('entry').hidden = false;
  renderRows();
  renderChips();
  location.hash = '#jod';
  $('sales').focus();
}

/**
 * หาวันสุดท้ายของเดือน
 *
 * @param {string} month - เดือนรูปแบบ YYYY-MM
 * @returns {string} วันที่สุดท้ายของเดือน รูปแบบ YYYY-MM-DD
 */
function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * เลื่อนเดือนที่ดูในเมนูย้อนหลัง
 *
 * @param {number} step - -1 = เดือนก่อน, +1 = เดือนถัดไป
 */
function changeMonth(step) {
  const [y, m] = state.month.split('-').map(Number);
  state.month = new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 7);
  state.selectedDay = null;
  renderHistory();
}

/**
 * วาดเมนูดูย้อนหลังของเดือนที่เลือก: ยอดรวมทั้งเดือน ค่าเฉลี่ยต่อวันที่ขาย กราฟกำไรรายวัน ปฏิทินเดือน
 * รายละเอียดวันที่เลือก และกราฟต้นทุนแยกประเภท เดือนใหม่เริ่มนับจากศูนย์
 * ถ้าเป็นเดือนปัจจุบันจะนับถึงวันนี้ (เดือนยังไม่จบ) ถ้าเป็นเดือนที่ผ่านมาแล้วนับทั้งเดือน
 */
function renderHistory() {
  const { entries, today } = state.data;
  const thisMonth = today.slice(0, 7);
  const firstMonth = entries.length ? entries[entries.length - 1].date.slice(0, 7) : thisMonth;
  if (!state.month) state.month = thisMonth;
  const month = state.month;
  const isCurrent = month === thisMonth;
  const lastDate = isCurrent ? today : lastDayOfMonth(month);

  const days = [];
  for (let d = month + '-01'; d <= lastDate; d = addDays(d, 1)) days.push(d);
  const monthEntries = entries.filter((e) => e.date.startsWith(month));
  const byDate = Object.fromEntries(monthEntries.map((e) => [e.date, e]));
  const recorded = monthEntries.length;
  const totalSales = monthEntries.reduce((s, e) => s + e.sales, 0);
  const totalCost = monthEntries.reduce((s, e) => s + e.totalCost, 0);
  const totalProfit = totalSales - totalCost;

  $('month-label').textContent = new Date(month + '-01T00:00:00').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  $('month-prev').disabled = month <= firstMonth;
  $('month-next').disabled = isCurrent;
  $('progress').textContent = isCurrent
    ? `เดือนนี้ยังไม่จบ — จดแล้ว ${recorded} จาก ${days.length} วันที่ผ่านมา`
    : `ทั้งเดือน จดแล้ว ${recorded} จาก ${days.length} วัน`;

  $('h-sales').textContent = fmt(totalSales);
  $('h-cost').textContent = fmt(totalCost);
  $('h-profit-label').textContent = totalProfit < 0 ? 'ขาดทุนรวม' : 'กำไรรวม';
  $('h-profit').textContent = fmt(Math.abs(totalProfit));

  // เฉลี่ยจากวันที่จดจริง ไม่ใช่ทุกวันในปฏิทิน เพราะวันที่ไม่ได้จดไม่รู้ว่าขายหรือหยุดร้าน
  const avgProfit = recorded ? totalProfit / recorded : 0;
  $('avg-sales').textContent = recorded ? fmt(Math.round(totalSales / recorded)) : '–';
  $('avg-profit').textContent = recorded ? fmt(Math.round(Math.abs(avgProfit))) : '–';
  $('avg-profit-label').textContent = avgProfit < 0 ? 'ขาดทุน' : 'กำไร';

  if (!state.selectedDay || !state.selectedDay.startsWith(month)) state.selectedDay = lastDate;
  renderProfitChart(days, byDate);
  renderCalendar(month, byDate, today);
  renderDayDetail(byDate[state.selectedDay], state.selectedDay, today);
  renderCostBreakdown(monthEntries);
}

/**
 * เลือกวันที่ในเมนูย้อนหลัง แล้ววาดใหม่ให้กราฟ ปฏิทิน และรายละเอียดตรงกัน
 *
 * @param {string} date - วันที่ที่เลือก รูปแบบ YYYY-MM-DD
 */
function selectDay(date) {
  state.selectedDay = date;
  renderHistory();
}

/**
 * วาดกราฟแท่งกำไรรายวันของเดือน: แท่งขึ้นจากเส้นศูนย์ = กำไร (เขียว) แท่งลงใต้เส้น = ขาดทุน (แดง)
 * วันที่ยังไม่จดแสดงเป็นขีดสั้นบนเส้นศูนย์ ใส่ตัวเลขเฉพาะวันที่กำไรสูงสุดและขาดทุนมากสุด เพื่อไม่ให้รก
 * ใต้กราฟแสดงเลขวันที่ทุก 5 วันพอ (1, 5, 10, …) เพราะ 30 ตัวเลขบนจอมือถือจะชนกัน
 *
 * @param {string[]} days - วันที่ในเดือน เรียงจากเก่าไปใหม่ (เดือนปัจจุบันถึงแค่วันนี้)
 * @param {Object<string, object>} byDate - บันทึกแยกตามวันที่
 */
function renderProfitChart(days, byDate) {
  const W = 350, H = 170, top = 22, bottom = 26, band = W / days.length, barW = Math.min(14, band * 0.6);
  const profits = days.map((d) => (byDate[d] ? byDate[d].profit : null));
  const known = profits.filter((p) => p !== null);
  const maxUp = Math.max(0, ...known);
  const maxDown = Math.max(0, ...known.map((p) => -p));
  const span = maxUp + maxDown || 1;
  const plotH = H - top - bottom;
  const zeroY = top + (plotH * maxUp) / span;
  const yOf = (v) => zeroY - (plotH * v) / span;
  const best = known.length ? Math.max(...known) : null;
  const worst = known.length ? Math.min(...known) : null;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'กราฟกำไรรายวันของเดือน' });
  days.forEach((date, i) => {
    const x = i * band + (band - barW) / 2;
    const p = profits[i];
    const g = svgEl('g', { class: 'col' + (date === state.selectedDay ? ' selected' : ''), tabindex: 0 });
    g.append(svgEl('rect', { class: 'hit', x: i * band, y: 0, width: band, height: H }));

    if (p === null) {
      g.append(svgEl('line', { class: 'missing', x1: x, x2: x + barW, y1: zeroY, y2: zeroY }));
    } else if (p !== 0) {
      const y1 = yOf(p);
      const h = Math.abs(zeroY - y1);
      const r = Math.min(4, h, barW / 2);
      const up = p > 0;
      // ปลายแท่งฝั่งข้อมูลมน 4px ฝั่งเส้นศูนย์เหลี่ยม
      const d = up
        ? `M${x},${zeroY} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${zeroY} Z`
        : `M${x},${zeroY} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 - r} V${zeroY} Z`;
      g.append(svgEl('path', { class: up ? 'bar profit' : 'bar loss', d }));
      if (p === best || (p === worst && p < 0)) {
        const label = svgEl('text', { class: 'val', x: x + barW / 2, y: up ? y1 - 6 : y1 + 14, 'text-anchor': 'middle' });
        label.textContent = (p < 0 ? '−' : '') + fmt(Math.abs(p));
        g.append(label);
      }
    }
    const dayNum = Number(date.slice(8));
    if (dayNum === 1 || dayNum % 5 === 0) {
      const day = svgEl('text', { class: 'day', x: x + barW / 2, y: H - 6, 'text-anchor': 'middle' });
      day.textContent = String(dayNum);
      g.append(day);
    }

    const title = svgEl('title', {});
    title.textContent = `${thDate(date)}: ${p === null ? 'ยังไม่ได้จด' : (p < 0 ? 'ขาดทุน ' : 'กำไร ') + fmt(Math.abs(p)) + ' บาท'}`;
    g.append(title);
    g.addEventListener('click', () => selectDay(date));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') selectDay(date);
    });
    svg.append(g);
  });
  svg.append(svgEl('line', { class: 'zero', x1: 0, x2: W, y1: zeroY, y2: zeroY }));
  $('profit-chart').replaceChildren(svg);
}

/**
 * วาดปฏิทินทั้งเดือนแบบปฏิทินแขวนผนัง (คอลัมน์ อา–ส) วันในอนาคตกดไม่ได้
 *
 * @param {string} month - เดือนรูปแบบ YYYY-MM
 * @param {Object<string, object>} byDate - บันทึกแยกตามวันที่
 * @param {string} today - วันที่วันนี้
 */
function renderCalendar(month, byDate, today) {
  const grid = $('days');
  grid.replaceChildren();
  const offset = new Date(month + '-01T00:00:00Z').getUTCDay();
  for (let i = 0; i < offset; i++) grid.append(el('span'));

  for (let date = month + '-01'; date <= lastDayOfMonth(month); date = addDays(date, 1)) {
    const dayNum = String(Number(date.slice(8)));
    if (date > today) {
      const future = el('span', 'future');
      future.append(el('b', '', dayNum));
      grid.append(future);
      continue;
    }
    const e = byDate[date];
    const kind = !e ? 'missing' : e.profit < 0 ? 'loss' : 'profit';
    const b = el('button', kind + (date === today ? ' today' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(date === state.selectedDay));
    b.append(el('b', '', dayNum), el('span', 'mark', { profit: '✓', loss: '▼', missing: '–' }[kind]));
    b.setAttribute('aria-label', `${thDate(date)} ${{ profit: 'กำไร', loss: 'ขาดทุน', missing: 'ยังไม่ได้จด' }[kind]}`);
    b.addEventListener('click', () => selectDay(date));
    grid.append(b);
  }
}

/**
 * แสดงรายละเอียดของวันที่เลือก: กำไร/ขาดทุน หรือปุ่มให้จดถ้ายังไม่ได้จด
 *
 * @param {object|undefined} entry - บันทึกของวันนั้น (undefined = ยังไม่ได้จด)
 * @param {string} date - วันที่ที่เลือก รูปแบบ YYYY-MM-DD
 * @param {string} today - วันที่วันนี้ รูปแบบ YYYY-MM-DD
 */
function renderDayDetail(entry, date, today) {
  const box = $('day-detail');
  box.replaceChildren();
  const label = date === today ? 'วันนี้' : thDate(date);
  if (entry) {
    const loss = entry.profit < 0;
    const text = el('span', '', `${label}: `);
    text.append(el('span', 'money ' + (loss ? 'loss' : 'profit'), `${loss ? 'ขาดทุน' : 'กำไร'} ${fmt(Math.abs(entry.profit))} บาท`));
    box.append(text, el('span', 'meta money', `ขาย ${fmt(entry.sales)} − ต้นทุน ${fmt(entry.totalCost)}`));
  } else {
    const b = el('button', 'secondary', date === today ? 'จดวันนี้' : 'จดย้อนหลังวันนี้');
    b.type = 'button';
    b.addEventListener('click', () => startEntry(date));
    box.append(el('span', '', `${label}: ยังไม่ได้จด`), b);
  }
}

/**
 * วาดกราฟแท่งแนวนอนต้นทุนรวม 14 วันแยกตามประเภท เรียงจากมากไปน้อย
 * ให้เจ้าของร้านเห็นว่าเงินออกไปทางไหนมากที่สุด (ใช้สีเดียว เพราะเทียบขนาด ไม่ได้แยกกลุ่ม)
 *
 * @param {Array<{costs: Array<{category: string, amount: number}>}>} entries - บันทึกในช่วง 14 วัน
 */
function renderCostBreakdown(entries) {
  const totals = {};
  for (const e of entries) for (const c of e.costs) totals[c.category] = (totals[c.category] || 0) + c.amount;
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const sum = rows.reduce((s, [, v]) => s + v, 0);
  const list = $('cost-bars');
  list.replaceChildren();

  if (!rows.length) {
    $('cost-headline').textContent = 'ยังไม่มีต้นทุนให้แสดง เริ่มจดต้นทุนในเมนู "จดวันนี้" แล้วกราฟจะขึ้นที่นี่';
    return;
  }
  const [topName, topValue] = rows[0];
  $('cost-headline').textContent = `จ่ายค่า${topName}มากที่สุด ${Math.round((topValue / sum) * 100)}% ของต้นทุนทั้งหมด`;
  for (const [name, value] of rows) {
    const li = el('li');
    const track = el('span', 'track');
    const bar = el('span', 'fill');
    bar.style.width = Math.max(2, (value / rows[0][1]) * 100) + '%';
    track.append(bar);
    li.append(el('span', 'label', name), track, el('span', 'money value', fmt(value)));
    list.append(li);
  }
}

/**
 * วาดปุ่มขอความช่วยเหลือ หัวข้อที่ส่งไปแล้วและยังไม่เสร็จจะแสดงสถานะใต้ปุ่ม
 */
function renderHelp() {
  const { helpTopics, openHelp } = state.data;
  const box = $('help-buttons');
  box.replaceChildren();
  for (const [topic, text] of Object.entries(helpTopics)) {
    const open = openHelp.find((h) => h.topic === topic);
    const b = el('button', 'secondary', text);
    b.type = 'button';
    if (open) b.append(el('span', 'status', open.status === 'waiting' ? 'ส่งแล้ว รอทีมติดต่อ' : 'ทีมกำลังช่วยอยู่'));
    b.addEventListener('click', () => askHelp(topic));
    box.append(b);
  }
}

/**
 * ส่งคำขอความช่วยเหลือไปให้ทีม ถ้าเคยส่งเรื่องเดียวกันแล้วเซิร์ฟเวอร์จะไม่สร้างซ้ำ
 *
 * @param {string} topic - รหัสหัวข้อ เช่น "cost"
 */
async function askHelp(topic) {
  try {
    const res = await fetch(`/api/vendor/${encodeURIComponent(pid)}/help`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
    });
    const body = await res.json();
    $('help-msg').textContent = body.message;
    if (res.ok) await load();
  } catch {
    $('help-msg').textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณเน็ตแล้วลองอีกครั้ง';
  }
}

$('entry').addEventListener('submit', (ev) => {
  ev.preventDefault();
  submit();
});
$('sales').addEventListener('input', updateTally);
$('again').addEventListener('click', () => startEntry(state.data.today));
$('to-history').addEventListener('click', () => (location.hash = '#history'));
$('dup-add').addEventListener('click', () => { $('dup').close(); submit('add'); });
$('dup-replace').addEventListener('click', () => { $('dup').close(); submit('replace'); });
$('dup-cancel').addEventListener('click', () => $('dup').close());
$('month-prev').addEventListener('click', () => changeMonth(-1));
$('month-next').addEventListener('click', () => changeMonth(1));
window.addEventListener('hashchange', showView);

showView();
load();
