/**
 * Setup.gs
 * สร้างชีตทั้งหมด 10 ชีตอัตโนมัติ + seed ข้อมูลเริ่มต้น
 *
 * เรียก setupAll() หลัง push ครั้งแรก โดยต้องตั้งค่า Script Property ก่อน:
 *   - SS_ID      = ID ของ Spreadsheet ฐานข้อมูลหลัก
 *   - AUDIT_SS_ID = ID ของ Spreadsheet ที่ใช้เก็บ AuditLog
 *
 * - ถ้าชีตมีอยู่แล้วให้ข้าม ไม่เขียนทับข้อมูลเดิม
 * - freeze แถว 1, header พื้นหลังเทาเข้ม ตัวขาว ตัวหนา
 * - RULE-05: ไม่มีการลบข้อมูลใดๆ
 */

/**
 * โครงสร้างชีตทั้งหมด + หัวคอลัมน์ (ตามข้อ 4 ของ AGENTS.md)
 * @type {Object<string, Array<string>>}
 */
var SETUP_SHEETS = {
  'Customers': ['id', 'code', 'name', 'customer_type', 'phone', 'tax_id', 'address', 'credit_days', 'is_active'],
  'Products': ['id', 'code', 'name', 'unit', 'price_retail', 'price_wholesale', 'min_area_sqm', 'is_active'],
  'Orders': ['id', 'doc_no', 'customer_id', 'customer_name', 'order_date', 'due_date', 'sale_mode', 'status',
    'revision_no', 'subtotal', 'discount_amt', 'vat_mode', 'vat_rate', 'vat_amount', 'wht_amount', 'grand_total',
    'paid_total', 'balance', 'locked', 'note', 'cancel_reason', 'ref_cancelled_order', 'created_by', 'created_at',
    'updated_by', 'updated_at'],
  'OrderItems': ['id', 'order_id', 'line_no', 'product_id', 'description', 'width_m', 'height_m', 'qty',
    'area_sqm', 'price_mode', 'unit_price', 'extra_charge', 'extra_note', 'line_total'],
  'Documents': ['id', 'doc_type', 'doc_no', 'order_id', 'payment_id', 'issue_date', 'due_date', 'snapshot_json',
    'total_amount', 'status', 'void_reason', 'void_by', 'void_at', 'print_count', 'issued_by', 'created_at'],
  'Payments': ['id', 'doc_no', 'order_id', 'customer_id', 'pay_date', 'method', 'bank_ref', 'amount',
    'wht_deducted', 'slip_url', 'note', 'status', 'void_reason', 'created_by', 'created_at'],
  'AuditLog': ['id', 'ts', 'user_email', 'action', 'entity', 'entity_id', 'doc_no',
    'before_json', 'after_json', 'changed_fields', 'reason', 'batch_id'],
  'CancelLog': ['id', 'ts', 'user_email', 'root_order_id', 'root_doc_no', 'trigger_doc_no', 'reason',
    'affected_docs_json', 'batch_id'],
  'Counters': ['key', 'last_no'],
  'Users': ['email', 'name', 'role', 'is_active', 'password']
};

/**
 * Seed สินค้าไวนิลจริง 5 รายการ
 * @type {Array<Object>}
 */
var SEED_PRODUCTS = [
  { code: 'VNL-WALL-001', name: 'ไวนิลติดผนัง (Wall Vinyl)', unit: 'SQM', price_retail: 350, price_wholesale: 280, min_area_sqm: 1 },
  { code: 'VNL-FLOOR-001', name: 'ไวนิลพื้น (Floor Vinyl)', unit: 'SQM', price_retail: 450, price_wholesale: 360, min_area_sqm: 1 },
  { code: 'VNL-ONE-001', name: 'ไวนิล One Way Vision (เจาะรู)', unit: 'SQM', price_retail: 380, price_wholesale: 300, min_area_sqm: 1 },
  { code: 'VNL-BACK-001', name: 'ไวนิล Backlit (ไฟหลัง)', unit: 'SQM', price_retail: 420, price_wholesale: 340, min_area_sqm: 1 },
  { code: 'VNL-CUT-001', name: 'ไวนิลตัดตัวอักษร (Cutting)', unit: 'SQM', price_retail: 280, price_wholesale: 220, min_area_sqm: 0.5 }
];

/**
 * Seed ผู้ใช้ 3 คน (ADMIN / MANAGER / STAFF)
 * @type {Array<Object>}
 */
var SEED_USERS = [
  { email: 'admin@pro-nara.com', name: 'ผู้ดูแลระบบ', role: 'ADMIN', is_active: 'TRUE', password: 'admin123' },
  { email: 'manager@pro-nara.com', name: 'ผู้จัดการ', role: 'MANAGER', is_active: 'TRUE', password: 'manager123' },
  { email: 'staff@pro-nara.com', name: 'พนักงาน', role: 'STAFF', is_active: 'TRUE', password: 'staff123' }
];

/**
 * Seed ลูกค้า 2 ราย (ค้าส่ง + ค้าปลีก)
 * @type {Array<Object>}
 */
var SEED_CUSTOMERS = [
  { code: 'C-0001', name: 'ร้านบิวตี้กรุ๊ป', customer_type: 'WHOLESALE', phone: '081-234-5678', tax_id: '', address: 'กรุงเทพฯ', credit_days: 30, is_active: 'TRUE' },
  { code: 'C-0002', name: 'คุณสมชาย โชคดี', customer_type: 'RETAIL', phone: '089-123-4567', tax_id: '', address: 'นนทบุรี', credit_days: 0, is_active: 'TRUE' }
];

/**
 * ตรวจสอบว่าได้ตั้งค่า Script Property SS_ID และ AUDIT_SS_ID แล้วหรือยัง
 * @returns {boolean} true ถ้าตั้งค่าครบ
 */
function isConfigured_() {
  return !!(SS_ID && AUDIT_SS_ID);
}

/**
 * สร้างชีตทั้งหมด 10 ชีต (ถ้ามีอยู่แล้วข้าม ไม่เขียนทับ) + format header + seed data
 * @returns {{ok: boolean, data: Object, message: string}}
 */
function setupAll() {
  // ตรวจ Script Property ก่อน
  if (!isConfigured_()) {
    return {
      ok: false,
      data: null,
      message: 'ยังไม่ได้ตั้งค่า Script Property SS_ID และ/หรือ AUDIT_SS_ID กรุณาตั้งค่าก่อน'
    };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var summary = {
      created_sheets: [],
      skipped_sheets: [],
      seeded: 0,
      seeded_products: 0,
      seeded_users: 0,
      seeded_customers: 0
    };

    // สร้างชีตใน Spreadsheet หลัก (ยกเว้น AuditLog ซึ่งอยู่ในไฟล์แยก)
    var ss = ss_();
    for (var name in SETUP_SHEETS) {
      if (name === SH.AUDIT_LOG) continue; // AuditLog สร้างแยกใน auditSS_
      var headers = SETUP_SHEETS[name];
      var existing = ss.getSheetByName(name);
      if (existing) {
        summary.skipped_sheets.push(name);
        continue; // มีอยู่แล้ว → ข้าม ไม่เขียนทับข้อมูลเดิม
      }
      var sh = ss.insertSheet(name);
      createSheet_(sh, headers);
      summary.created_sheets.push(name);
    }

    // สร้างชีต AuditLog ในไฟล์แยก
    var auditSs = auditSS_();
    var auditSh = auditSs.getSheetByName(SH.AUDIT_LOG);
    if (auditSh) {
      summary.skipped_sheets.push(SH.AUDIT_LOG);
    } else {
      auditSh = auditSs.insertSheet(SH.AUDIT_LOG);
      createSheet_(auditSh, SETUP_SHEETS[SH.AUDIT_LOG]);
      summary.created_sheets.push(SH.AUDIT_LOG);
    }

    // Seed ข้อมูล (เฉพาะชีตที่ยังว่าง ไม่มีข้อมูล)
    summary.seeded_products = seedProducts_();
    summary.seeded_users = seedUsers_();
    summary.seeded_customers = seedCustomers_();
    summary.seeded = summary.seeded_products + summary.seeded_users + summary.seeded_customers;

    var message = 'สร้างชีต ' + summary.created_sheets.length + ' ชีต, ข้าม ' +
      summary.skipped_sheets.length + ' ชีต, seed ข้อมูล ' + summary.seeded + ' รายการ';

    return { ok: true, data: summary, message: message };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * สร้างชีตใหม่พร้อม header + format (freeze แถว 1, พื้นเทาเข้ม ขาว หนา)
 * @param {Sheet} sh ชีตที่สร้างใหม่
 * @param {Array<string>} headers หัวคอลัมน์
 */
function createSheet_(sh, headers) {
  sh.appendRow(headers);
  sh.setFrozenRows(1);

  var headerRange = sh.getRange(1, 1, 1, headers.length);
  headerRange
    .setBackground('#374151')       // เทาเข้ม
    .setFontColor('#FFFFFF')        // ตัวขาว
    .setFontWeight('bold');         // ตัวหนา
}

/**
 * Seed สินค้า (เฉพาะถ้าชีต Products ยังไม่มีข้อมูล row ข้อมูล)
 * @returns {number} จำนวนที่สร้าง
 */
function seedProducts_() {
  var existing = readAll_(SH.PRODUCTS);
  if (existing.length > 0) return 0; // มีข้อมูลแล้ว → ข้าม

  var count = 0;
  for (var i = 0; i < SEED_PRODUCTS.length; i++) {
    var p = SEED_PRODUCTS[i];
    var obj = {};
    for (var k in p) obj[k] = p[k];
    obj.id = uid_();
    obj.is_active = 'TRUE';
    insertRow_(SH.PRODUCTS, obj);
    count++;
  }
  return count;
}

/**
 * Seed ผู้ใช้ (เฉพาะถ้าชีต Users ยังไม่มีข้อมูล row)
 * @returns {number} จำนวนที่สร้าง
 */
function seedUsers_() {
  var existing = readAll_(SH.USERS);
  if (existing.length > 0) return 0;

  var count = 0;
  for (var i = 0; i < SEED_USERS.length; i++) {
    var u = SEED_USERS[i];
    var obj = {};
    for (var k in u) obj[k] = u[k];
    obj.id = uid_();
    insertRow_(SH.USERS, obj);
    count++;
  }
  return count;
}

/**
 * Seed ลูกค้า (เฉพาะถ้าชีต Customers ยังไม่มีข้อมูล row)
 * @returns {number} จำนวนที่สร้าง
 */
function seedCustomers_() {
  var existing = readAll_(SH.CUSTOMERS);
  if (existing.length > 0) return 0;

  var count = 0;
  for (var i = 0; i < SEED_CUSTOMERS.length; i++) {
    var c = SEED_CUSTOMERS[i];
    var obj = {};
    for (var k in c) obj[k] = c[k];
    obj.id = uid_();
    insertRow_(SH.CUSTOMERS, obj);
    count++;
  }
  return count;
}
