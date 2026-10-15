'use strict';

// ชั้นเก็บข้อมูล: อ่าน/เขียนไฟล์ JSON ส่วนอื่นของแอปไม่ต้องรู้ว่าข้อมูลเก็บที่ไหน (เปลี่ยนเป็นฐานข้อมูลจริงได้ที่ไฟล์นี้ไฟล์เดียว)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * ที่เก็บข้อมูลแบบไฟล์ JSON ไฟล์เดียว เหมาะกับต้นแบบที่มีผู้ใช้ไม่กี่สิบคนและรันบนเครื่องเดียว
 * โครงสร้างไฟล์: { participants: [], entries: [], helpRequests: [] }
 */
class Store {
  /**
   * เปิดไฟล์ข้อมูล ถ้ายังไม่มีไฟล์จะเริ่มจากข้อมูลว่าง (ยังไม่สร้างไฟล์จนกว่าจะมีการบันทึก)
   *
   * @param {string} filePath - path ของไฟล์ JSON
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.data = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
      : { participants: [], entries: [], helpRequests: [] };
  }

  /**
   * เขียนข้อมูลลงไฟล์ โดยเขียนไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อทับ
   * เพื่อไม่ให้ไฟล์เสียครึ่ง ๆ กลาง ๆ ถ้าโปรแกรมดับระหว่างเขียน
   */
  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  /**
   * แทนที่ข้อมูลทั้งหมดในหน่วยความจำและในไฟล์ (ใช้ตอนล้างข้อมูลกลับเป็นชุดเดโม)
   *
   * @param {{participants: Array, entries: Array, helpRequests: Array}} data - ข้อมูลชุดใหม่
   */
  replaceAll(data) {
    this.data = data;
    this.save();
  }

  /**
   * หาผู้เข้าร่วมจากรหัส
   *
   * @param {string} id - รหัสผู้เข้าร่วม เช่น "P01"
   * @returns {object|undefined} ข้อมูลผู้เข้าร่วม หรือ undefined เมื่อไม่พบ
   */
  getParticipant(id) {
    return this.data.participants.find((p) => p.id === id);
  }

  /**
   * ดึงบันทึกประจำวันทั้งหมดของผู้เข้าร่วมหนึ่งคน
   *
   * @param {string} participantId - รหัสผู้เข้าร่วม
   * @returns {Array<object>} รายการบันทึก (ไม่เรียงลำดับ)
   */
  entriesOf(participantId) {
    return this.data.entries.filter((e) => e.participantId === participantId);
  }

  /**
   * หาบันทึกของผู้เข้าร่วมในวันที่กำหนด ใช้ตรวจการจดซ้ำ (1 คนมีได้ 1 บันทึกต่อวัน)
   *
   * @param {string} participantId - รหัสผู้เข้าร่วม
   * @param {string} date - วันที่ รูปแบบ YYYY-MM-DD
   * @returns {object|undefined} บันทึกของวันนั้น หรือ undefined เมื่อยังไม่เคยจด
   */
  findEntry(participantId, date) {
    return this.data.entries.find((e) => e.participantId === participantId && e.date === date);
  }

  /**
   * เพิ่มบันทึกใหม่หรือแก้บันทึกเดิมของวันนั้น แล้วเขียนลงไฟล์ทันที
   *
   * @param {string} participantId - รหัสผู้เข้าร่วม
   * @param {{date: string, sales: number, costs: Array}} value - ข้อมูลที่ตรวจแล้ว
   * @returns {object} บันทึกที่ถูกเก็บ
   */
  upsertEntry(participantId, value) {
    const now = new Date().toISOString();
    let entry = this.findEntry(participantId, value.date);
    if (entry) {
      Object.assign(entry, { sales: value.sales, costs: value.costs, updatedAt: now });
    } else {
      entry = { id: crypto.randomUUID(), participantId, ...value, createdAt: now, updatedAt: now };
      this.data.entries.push(entry);
    }
    this.save();
    return entry;
  }

  /**
   * ดึงคำขอความช่วยเหลือที่ยังไม่เสร็จ (สถานะ waiting หรือ in_progress)
   *
   * @param {string} [participantId] - ถ้าระบุจะกรองเฉพาะของคนนั้น
   * @returns {Array<object>} รายการคำขอ
   */
  openHelpRequests(participantId) {
    return this.data.helpRequests.filter(
      (h) => h.status !== 'done' && (!participantId || h.participantId === participantId),
    );
  }

  /**
   * สร้างคำขอความช่วยเหลือใหม่ แล้วเขียนลงไฟล์
   *
   * @param {string} participantId - รหัสผู้เข้าร่วม
   * @param {string} topic - รหัสหัวข้อ เช่น "cost"
   * @returns {object} คำขอที่สร้าง สถานะเริ่มต้นคือ waiting
   */
  addHelpRequest(participantId, topic) {
    const now = new Date().toISOString();
    const req = { id: crypto.randomUUID(), participantId, topic, status: 'waiting', createdAt: now, updatedAt: now };
    this.data.helpRequests.push(req);
    this.save();
    return req;
  }

  /**
   * เปลี่ยนสถานะคำขอความช่วยเหลือ แล้วเขียนลงไฟล์
   *
   * @param {string} id - รหัสคำขอ
   * @param {string} status - สถานะใหม่ (waiting, in_progress, done)
   * @returns {object|undefined} คำขอที่แก้แล้ว หรือ undefined เมื่อไม่พบ
   */
  setHelpStatus(id, status) {
    const req = this.data.helpRequests.find((h) => h.id === id);
    if (!req) return undefined;
    req.status = status;
    req.updatedAt = new Date().toISOString();
    this.save();
    return req;
  }
}

module.exports = { Store };
