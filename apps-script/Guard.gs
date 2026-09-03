/**
 * Guard.gs
 * ระบบตรวจสอบสิทธิ์ + สถานะล็อกเอกสาร (RULE-01, RULE-02, RULE-04)
 */

/**
 * ตรวจสอบว่าผู้ใช้ปัจจุบันมีสิทธิ์อย่างน้อยตาม role ที่กำหนด
 * ถ้าไม่มี จะ throw Error
 */
function assertRole_(minRole) {
  var email = me_();
  var user = findUserByEmail_(email);
  var role = user && user.role ? user.role : null;

  if (!user || !user.is_active) {
    throw new Error('ไม่พบผู้ใช้หรือผู้ใช้ถูกปิดใช้งาน');
  }

  if (!minRole) return role; // ไม่ต้องการสิทธิ์ขั้นต่ำ

  var order = { STAFF: 1, MANAGER: 2, ADMIN: 3 };
  var need = order[minRole] || 0;
  var have = order[role] || 0;

  if (have < need) {
    throw new Error('สิทธิ์ไม่เพียงพอ ต้องมีสิทธิ์ระดับ ' + minRole + ' ขึ้นไป');
  }

  return role;
}

/**
 * ค้นหาผู้ใช้ตาม email
 */
function findUserByEmail_(email) {
  var rows = repoRows_('Users', true);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email).toLowerCase() === String(email).toLowerCase()) {
      return rows[i];
    }
  }
  return null;
}

/**
 * ตรวจสอบสิทธิ์แก้ไข/ยกเลิกใบสั่งจ้างตามสถานะ (RULE-02)
 * @param {Object} order ใบสั่งจ้าง
 * @param {string} mode 'EDIT' | 'CANCEL'
 */
function assertStatusPermitted_(order, mode) {
  if (!order) throw new Error('ไม่พบใบสั่งจ้าง');

  var status = order.status || 'DRAFT';

  if (status === 'CANCELLED') {
    throw new Error('ใบสั่งจ้างนี้ถูกยกเลิกแล้ว ไม่สามารถดำเนินการใดๆ ได้');
  }

  if (mode === 'EDIT') {
    // RULE-01: ถ้าออกใบเสร็จแล้วห้ามแก้ไข
    var docs = repoRows_('Documents', true);
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (String(d.order_id) === String(order.id) &&
          d.status === 'ACTIVE' &&
          LOCK_DOC_TYPES.indexOf(d.doc_type) >= 0) {
        throw new Error('ใบสั่งจ้างนี้ถูกออกใบเสร็จแล้ว ไม่สามารถแก้ไขได้');
      }
    }
    if (status === 'PARTIAL_PAID' || status === 'PAID') {
      throw new Error('ใบสั่งจ้างสถานะ ' + status + ' ไม่สามารถแก้ไขได้');
    }
    assertRole_(STATUS_ROLE[status] || ROLES.STAFF);
  } else if (mode === 'CANCEL') {
    var minRole = STATUS_ROLE[status] || ROLES.MANAGER;
    assertRole_(minRole);
  }

  return true;
}

/**
 * ตรวจสอบว่าเอกสารสามารถแก้ไขได้หรือไม่ ตัดสินด้วย RULE-01
 * @param {Object} doc เอกสาร
 */
function assertEditable_(doc) {
  if (!doc) return true;
  if (doc.doc_type === 'RECEIPT' || doc.doc_type === 'TAX_INVOICE') {
    if (doc.status === 'ACTIVE') {
      throw new Error('เอกสารนี้ถูกออกใบเสร็จแล้ว ไม่สามารถแก้ไขได้');
    }
  }
  return true;
}

/**
 * ตรวจสอบเหตุผลการยกเลิก (RULE-04)
 * @param {string} reason เหตุผล
 * @param {boolean} allowEmpty อนุญาตให้ว่างได้ (กรณี DRAFT)
 */
function assertReason_(reason, allowEmpty) {
  reason = (reason || '').trim();
  if (allowEmpty && reason === '') return reason;
  if (reason.length < 10) {
    throw new Error('เหตุผลการยกเลิกต้องมีความยาวอย่างน้อย 10 ตัวอักษร');
  }
  if (reason.length > 300) {
    throw new Error('เหตุผลการยกเลิกต้องไม่เกิน 300 ตัวอักษร');
  }
  return reason;
}
