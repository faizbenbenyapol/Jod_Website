'use strict';

/**
 * ผูกปุ่ม "รีเซ็ตข้อมูลเดโม" ในแถบโหมดทดลองที่อยู่บนทุกหน้า
 * ใช้หลังจากทดลองจดหรือกดอะไรไปแล้ว อยากกลับไปเป็นข้อมูลเดโมชุดแรก
 * ถามยืนยันด้วยป๊อปอัปของแอป (ไม่ใช้ confirm ของเบราว์เซอร์) แล้วโหลดหน้าใหม่พร้อมข้อความยืนยันว่ารีเซ็ตแล้ว
 */
(function bindDemoReset() {
  const btn = document.getElementById('reset-demo');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ok = await window.ui.confirm({
      tone: 'danger',
      title: 'รีเซ็ตข้อมูลเดโม?',
      text: 'ทุกอย่างที่ทดลองจดหรือกดไว้จะหายไป และกลับเป็นข้อมูลเดโมชุดแรก',
      confirmText: 'รีเซ็ตเลย',
    });
    if (!ok) return;

    btn.disabled = true;
    btn.textContent = 'กำลังรีเซ็ต…';
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      if (!res.ok) throw new Error('reset failed');
      window.ui.toastAfterReload('รีเซ็ตเป็นข้อมูลเดโมชุดแรกแล้ว');
      location.reload();
    } catch {
      btn.disabled = false;
      btn.textContent = 'รีเซ็ตข้อมูลเดโม';
      window.ui.alert({
        tone: 'warn',
        title: 'รีเซ็ตไม่สำเร็จ',
        text: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่าเซิร์ฟเวอร์ยังทำงานอยู่ แล้วลองกดอีกครั้ง',
      });
    }
  });
})();
