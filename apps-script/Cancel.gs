/**
 * Cancel.gs
 * การยกเลิกแบบ Cascade (RULE-03) — VOID ทั้งสายในทรานแซกชันเดียว
 *
 * ยกเลิกเอกสารใบใดก็ตาม → ระบบไล่ย้อนหา order_id ต้นทาง แล้ว VOID ทั้งสาย
 */

/**
 * ยกเลิกใบสั่งจ้างต้นทาง (RULE-03, RULE-04, RULE-05)
 * @param {string} orderId id ของใบสั่งจ้าง
 * @param {string} reason เหตุผล (ขั้นต่ำ 10 ตัวอักษร ยกเว้น DRAFT)
 */
function cancelOrder(orderId, reason) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    return cancelOrderUnderLock_(orderId, reason);
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * (ภายใน) ยกเลิกใบสั่งจ้างต้นทางแบบ cascade โดยสมมติว่าผู้เรียกถือ LockService ไว้แล้ว
 * ใช้โดย cancelOrder() และ cancelFromDocument() เพื่อไม่ให้ lock ซ้อนกัน (deadlock)
 * @param {string} orderId id ของใบสั่งจ้าง
 * @param {string} reason เหตุผล (ขั้นต่ำ 10 ตัวอักษร ยกเว้น DRAFT)
 * @returns {{ok:boolean, data:Array, message:string}}
 */
function cancelOrderUnderLock_(orderId, reason) {
  var order = repoFindById_('Orders', orderId, true);
  if (!order) throw new Error('ไม่พบใบสั่งจ้าง');

  var allowEmpty = order.status === 'DRAFT';
  reason = assertReason_(reason, allowEmpty);

  var batchId = uid_();
  var affected = [];

  // VOID เอกสารทั้งหมดที่ผูกกับ order นี้ (ที่เป็น ACTIVE)
  var docs = repoRows_('Documents', true);
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    if (String(d.order_id) === String(order.id) && d.status === 'ACTIVE') {
      var voidUpdate = {
        status: 'VOID',
        void_reason: reason,
        void_by: me_(),
        void_at: nowIso_()
      };
      repoUpdate_('Documents', d.id, voidUpdate);
      writeAudit_('VOID', 'Documents', d.id, d.doc_no, { status: 'ACTIVE' }, voidUpdate, ['status'], reason, batchId);
      affected.push({ type: 'DOCUMENT', id: d.id, doc_no: d.doc_no });
    }
  }

  // VOID Payment ที่ผูกกับ order นี้ (คืน paid_total = 0)
  var payments = repoRows_('Payments', true);
  for (var p = 0; p < payments.length; p++) {
    var pay = payments[p];
    if (String(pay.order_id) === String(order.id) && pay.status === 'ACTIVE') {
      var payVoid = {
        status: 'VOID',
        void_reason: reason,
        void_by: me_(),
        void_at: nowIso_()
      };
      repoUpdate_('Payments', pay.id, payVoid);
      writeAudit_('VOID', 'Payments', pay.id, pay.doc_no, { status: 'ACTIVE' }, payVoid, ['status'], reason, batchId);
      affected.push({ type: 'PAYMENT', id: pay.id, doc_no: pay.doc_no });
    }
  }

  // อัปเดต order เป็น CANCELLED + คืนยอด
  var orderUpdate = {
    status: ORDER_STATUS.CANCELLED,
    cancel_reason: reason,
    locked: 'FALSE',
    paid_total: 0,
    balance: Number(order.grand_total || 0),
    updated_by: me_(),
    updated_at: nowIso_()
  };
  repoUpdate_('Orders', order.id, orderUpdate);
  writeAudit_('CANCEL', 'Orders', order.id, order.doc_no, order, orderUpdate, ['status', 'cancel_reason'], reason, batchId);
  affected.push({ type: 'ORDER', id: order.id, doc_no: order.doc_no });

  // เขียน CancelLog (ผูก batch_id เดียวกัน)
  writeCancelLog_(order.id, order.doc_no, order.doc_no, reason, affected, batchId);

  return { ok: true, data: affected, message: 'ยกเลิก ' + order.doc_no + ' สำเร็จ (VOID ทั้งสาย)' };
}

/**
 * ยกเลิกโดยยิงจากเอกสารใดเอกสารหนึ่ง → ไล่ย้อนหา order ต้นทาง แล้ว cascade
 * @param {string} docId id ของเอกสารต้นเหตุ
 * @param {string} reason เหตุผล
 */
function cancelFromDocument(docId, reason) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var doc = repoFindById_('Documents', docId, true);
    if (!doc) throw new Error('ไม่พบเอกสาร');
    if (!doc.order_id) throw new Error('เอกสารนี้ไม่มีใบสั่งจ้างต้นทาง');
    var order = repoFindById_('Orders', doc.order_id, true);
    if (!order) throw new Error('ไม่พบใบสั่งจ้างต้นทาง');

    var allowEmpty = order.status === 'DRAFT';
    reason = assertReason_(reason, allowEmpty);

    // เรียก cancelOrderUnderLock_ เพราะเรายังถือ lock อยู่ (กัน deadlock จากการขอ lock ซ้อน)
    return cancelOrderUnderLock_(order.id, reason);
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * เขียน CancelLog
 */
function writeCancelLog_(rootOrderId, rootDocNo, triggerDocNo, reason, affectedDocs, batchId) {
  var log = {
    id: uid_(),
    ts: nowIso_(),
    user_email: me_(),
    root_order_id: rootOrderId,
    root_doc_no: rootDocNo,
    trigger_doc_no: triggerDocNo,
    reason: reason,
    affected_docs_json: JSON.stringify(affectedDocs),
    batch_id: batchId
  };
  repoInsert_('CancelLog', log);
}
