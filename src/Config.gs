/**
 * Config.gs
 * ค่าคงที่ + helper functions กลางของระบบวางบิลร้านไวนิล
 */

// Spreadsheet ID ของฐานข้อมูลหลัก อ่านจาก Script Properties (key: SS_ID)
// ถ้ายังไม่ตั้งค่า property ใช้ค่า default ของโปรเจกต์ (ระบุใน AGENTS.md)
var SS_ID = PropertiesService.getScriptProperties().getProperty('SS_ID') || '1g8PjB6A-IKZyRFhrvSu-YeSMEFHD3zBJ1z_G77eBoLs';

// Spreadsheet ID ของไฟล์ AuditLog แยกต่างหาก อ่านจาก Script Properties (key: AUDIT_SS_ID)
// default ใช้ไฟล์เดียวกับ SS_ID (ใช้ไฟล์เดียวกันชั่วคราว อาจแยกภายหลัง)
var AUDIT_SS_ID = PropertiesService.getScriptProperties().getProperty('AUDIT_SS_ID') || SS_ID;

// Folder ID สำหรับสำรองข้อมูล (key: BACKUP_FOLDER_ID) — ใช้ค่า default จาก AGENTS.md
var BACKUP_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID') || '1Sg1AN_Rc6wcB2q7Ry9tAzjw1vjwviF7D';

/**
 * object SH เก็บชื่อชีตทั้งหมดที่ใช้ในระบบ
 * - ชีตที่อยู่ในไฟล์หลัก (SS_ID) ใช้รายชื่อตามข้อ 4 ของ AGENTS.md
 * - AuditLog อยู่ในไฟล์แยก (AUDIT_SS_ID)
 */
var SH = {
  CUSTOMERS: 'Customers',
  PRODUCTS: 'Products',
  ORDERS: 'Orders',
  ORDER_ITEMS: 'OrderItems',
  DOCUMENTS: 'Documents',
  PAYMENTS: 'Payments',
  AUDIT_LOG: 'AuditLog',
  CANCEL_LOG: 'CancelLog',
  COUNTERS: 'Counters',
  USERS: 'Users'
};

// สถานะที่ยังแก้ไข/ยกเลิกได้โดยไม่ต้องเหตุผลขั้นต่ำ (RULE-02)
var LOCKABLE_STATUS = {
  DRAFT: 'DRAFT',
  QUOTED: 'QUOTED',
  CONFIRMED: 'CONFIRMED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  DELIVERED: 'DELIVERED'
};

// ความยาวขั้นต่ำของเหตุผลยกเลิก (RULE-04)
var MIN_REASON_LEN = 10;

// อัตราภาษีมูลค่าเพิ่ม %
var VAT_RATE = 7;

// สถานะของใบสั่งจ้าง (ใช้ในหลายไฟล์)
var ORDER_STATUS = {
  DRAFT: 'DRAFT',
  QUOTED: 'QUOTED',
  CONFIRMED: 'CONFIRMED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  DELIVERED: 'DELIVERED',
  BILLED: 'BILLED',
  PARTIAL_PAID: 'PARTIAL_PAID',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED'
};

// ชนิดเอกสาร
var DOC_TYPES = {
  QUOTATION: 'QUOTATION',
  DELIVERY: 'DELIVERY',
  BILLING: 'BILLING',
  RECEIPT: 'RECEIPT',
  TAX_INVOICE: 'TAX_INVOICE'
};

// Prefix ของเอกสาร
var DOC_PREFIX = {
  ORDER: 'OD',
  QUOTATION: 'QT',
  DELIVERY: 'DO',
  BILLING: 'BN',
  RECEIPT: 'RC',
  PAYMENT: 'PM'
};

// วิธีชำระเงิน
var PAYMENT_METHODS = {
  CASH: 'CASH',
  TRANSFER: 'TRANSFER',
  CHEQUE: 'CHEQUE',
  CREDIT_CARD: 'CREDIT_CARD',
  QR: 'QR'
};

// โหมดการขาย
var SALE_MODES = {
  RETAIL: 'RETAIL',
  WHOLESALE: 'WHOLESALE'
};

// โหมดภาษี
var VAT_MODES = {
  EXCLUDE: 'EXCLUDE',
  INCLUDE: 'INCLUDE',
  NONE: 'NONE'
};

// สิทธิ์ผู้ใช้
var ROLES = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF'
};

// ระยะเวลา lock (ตัวเลขดังกล่าวต้องการให้เป็นหน่วย ms แต่ LockService ใช้ ms)
var LOCK_TIMEOUT_MS = 20000;

// ===== Backward-compat aliases =====
// ตัวแปร/ฟังก์ชันต่อไปนี้ถูกใช้โดยไฟล์ Phase 2-3 เดิม (Customer/Order/Document/Payment/Cancel/Report/Guard/Audit/Backup)
// เก็บไว้เพื่อไม่ให้ runtime reference error จนกว่าจะ migrate ไฟล์เหล่านั้นไปใช้ API ใหม่
var SPREADSHEET_ID = SS_ID;
var AUDIT_SPREADSHEET_ID = AUDIT_SS_ID;

/**
 * (compat) วันที่เป็น string YYYY-MM-DD
 * @param {Date} d
 * @returns {string}
 */
function dateStr_(d) {
  return Utilities.formatDate(d || now_(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

/**
 * (compat) DateTime เป็น string ISO
 * @returns {string}
 */
function nowIso_() {
  return now_().toISOString();
}

/**
 * เข้าถึง Spreadsheet หลัก (SS_ID)
 * @returns {SpreadsheetApp.Spreadsheet}
 */
function ss_() {
  return SpreadsheetApp.openById(SS_ID);
}

/**
 * เข้าถึง Spreadsheet ของ AuditLog (AUDIT_SS_ID)
 * @returns {SpreadsheetApp.Spreadsheet}
 */
function auditSS_() {
  return SpreadsheetApp.openById(AUDIT_SS_ID);
}

/**
 * เข้าถึงชีตภายใน Spreadsheet หลักตามชื่อ
 * @param {string} name ชื่อชีต
 * @returns {Sheet}
 */
function sh_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต: ' + name);
  return sh;
}

/**
 * เวลาปัจจุบัน (Date object)
 * @returns {Date}
 */
function now_() {
  return new Date();
}

/**
 * วันที่ปัจจุบันเป็น string YYYY-MM-DD (โซน Asia/Bangkok)
 * @returns {string}
 */
function today_() {
  return Utilities.formatDate(now_(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

/**
 * สร้าง UUID ใหม่
 * @returns {string}
 */
function uid_() {
  return Utilities.getUuid();
}

/**
 * อีเมลของผู้ใช้ที่เรียก Web App (หรือ 'anonymous' ถ้าไม่รู้จัก)
 * @returns {string}
 */
function me_() {
  var email = Session.getActiveUser().getEmail();
  return email && email !== '' ? email : 'anonymous';
}

/**
 * คืนปี พ.ศ. 2 หลัก เช่น 2569 → '69'
 * @returns {string}
 */
function buddhistYY_() {
  var yy = String((new Date().getFullYear() + 543) % 100);
  return yy.length === 1 ? '0' + yy : yy;
}

/**
 * ปัดเศษทศนิยม 2 ตำแหน่ง (ปกติ)
 * @param {number} n
 * @returns {number}
 */
function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * ปัดเศษทศนิยม 2 ตำแหน่ง (ปัดขึ้น) ใช้กับพื้นที่ตร.ม.
 * @param {number} n
 * @returns {number}
 */
function roundUp2_(n) {
  return Math.ceil((Number(n) || 0) * 100) / 100;
}

/**
 * ฟอร์แมตตัวเลขเป็นสตริงเงิน 2 ตำแหน่ง (THB)
 * @param {number} n
 * @returns {string}
 */
function money_(n) {
  return (Number(n) || 0).toFixed(2);
}
