'use strict';

/**
 * ป๊อปอัปแจ้งเตือน/ยืนยัน และข้อความเด้งสั้น ๆ (toast) ที่ใช้แทน alert()/confirm() ของเบราว์เซอร์
 * หน้าตาเหมือนกันทุกเครื่อง เป็นภาษาไทยทั้งหมด และใช้สีเดียวกับแอป
 * ใช้ผ่าน window.ui.confirm(...), window.ui.alert(...), window.ui.toast(...)
 */
(function createUi() {
  const ICONS = { warn: '!', danger: '!', success: '✓', info: 'i' };
  const TOAST_KEY = 'jod-kamrai-toast';
  let dialog = null;

  /**
   * สร้างโครงป๊อปอัปครั้งเดียวแล้วใช้ซ้ำ
   *
   * @returns {HTMLDialogElement}
   */
  function getDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'alert';
    dialog.setAttribute('aria-labelledby', 'alert-title');
    dialog.setAttribute('aria-describedby', 'alert-text');
    dialog.innerHTML =
      '<div class="alert-icon" aria-hidden="true"></div>' +
      '<h2 id="alert-title"></h2>' +
      '<p id="alert-text"></p>' +
      '<div class="alert-actions"></div>';
    // คลิกพื้นหลังนอกกล่อง = ยกเลิก
    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog) dialog.close('cancel');
    });
    document.body.append(dialog);
    return dialog;
  }

  /**
   * สร้างปุ่มในป๊อปอัป
   *
   * @param {string} label - ข้อความบนปุ่ม
   * @param {string} className - class ของปุ่ม
   * @param {string} value - ค่าที่ dialog.returnValue จะได้เมื่อกดปุ่มนี้
   * @returns {HTMLButtonElement}
   */
  function makeButton(label, className, value) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', () => dialog.close(value));
    return b;
  }

  /**
   * เปิดป๊อปอัปแล้วรอจนผู้ใช้กดปุ่ม กด Esc หรือคลิกนอกกล่อง
   *
   * @param {{title: string, text?: string, tone?: 'warn'|'danger'|'success'|'info',
   *   confirmText: string, cancelText?: string}} opts
   *   cancelText ไม่ใส่ = ป๊อปอัปแบบปุ่มเดียว (แจ้งเตือนอย่างเดียว)
   * @returns {Promise<boolean>} true เมื่อกดปุ่มยืนยัน, false เมื่อยกเลิกด้วยวิธีใดก็ตาม
   */
  function open(opts) {
    const d = getDialog();
    const tone = opts.tone || 'info';
    d.dataset.tone = tone;
    d.querySelector('.alert-icon').textContent = ICONS[tone];
    d.querySelector('#alert-title').textContent = opts.title;
    const text = d.querySelector('#alert-text');
    text.textContent = opts.text || '';
    text.hidden = !opts.text;

    const actions = d.querySelector('.alert-actions');
    actions.replaceChildren();
    if (opts.cancelText) actions.append(makeButton(opts.cancelText, 'secondary', 'cancel'));
    const ok = makeButton(opts.confirmText, tone === 'danger' ? 'primary danger' : 'primary', 'ok');
    actions.append(ok);

    d.returnValue = '';
    d.showModal();
    // ปุ่มที่ปลอดภัยกว่าได้โฟกัสก่อน กันกด Enter แล้วลบข้อมูลโดยไม่ตั้งใจ
    (opts.cancelText ? actions.firstChild : ok).focus();
    return new Promise((resolve) => {
      d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    });
  }

  /**
   * แสดงข้อความเด้งสั้น ๆ มุมล่าง หายเองใน 3 วินาที (ไม่ต้องกดปิด)
   *
   * @param {string} message - ข้อความ
   * @param {'success'|'info'} [tone] - ใช้เลือกสัญลักษณ์หน้าข้อความ
   */
  function toast(message, tone = 'success') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = (tone === 'success' ? '✓ ' : '') + message;
    document.body.append(t);
    setTimeout(() => t.remove(), 3000);
  }

  /**
   * เก็บข้อความไว้แสดงหลังโหลดหน้าใหม่ (เช่น หลังรีเซ็ตข้อมูลแล้วรีเฟรช)
   *
   * @param {string} message - ข้อความที่จะแสดงเมื่อหน้าโหลดเสร็จ
   */
  function toastAfterReload(message) {
    try {
      sessionStorage.setItem(TOAST_KEY, message);
    } catch {
      // เบราว์เซอร์บางตัวปิด sessionStorage ไว้ ไม่แสดงก็ไม่เสียหาย
    }
  }

  try {
    const pending = sessionStorage.getItem(TOAST_KEY);
    if (pending) {
      sessionStorage.removeItem(TOAST_KEY);
      toast(pending);
    }
  } catch {
    // ไม่มี sessionStorage ก็ข้ามไป
  }

  window.ui = {
    confirm: (opts) => open({ cancelText: 'ยกเลิก', ...opts }),
    alert: (opts) => open({ confirmText: 'ตกลง', ...opts, cancelText: undefined }),
    toast,
    toastAfterReload,
  };
})();
