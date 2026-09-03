/**
 * Document.gs
 * ออกเอกสาร QT/DO/BN/RC + snapshot_json (RULE-06)
 *
 * doc_type = QUOTATION | DELIVERY | BILLING | RECEIPT | TAX_INVOICE
 */

/**
 * สร้าง snapshot ของเอกสาร (ข้อมูลหัวบิล + รายการทั้งหมด ณ วินาทีนั้น)
 * @param {Object} order ใบสั่งจ้าง
 * @param {Array} items รายการ
 */
function buildSnapshot_(order, items) {
  return {
    order: {
      id: order.id,
      doc_no: order.doc_no,
      customer_id: order.customer_id,
      customer_name: order.customer_name,
      order_date: order.order_date,
      due_date: order.due_date,
      sale_mode: order.sale_mode,
      subtotal: order.subtotal,
      discount_amt: order.discount_amt,
      vat_mode: order.vat_mode,
      vat_amount: order.vat_amount,
      wht_amount: order.wht_amount,
      grand_total: order.grand_total
    },
    items: items.map(function (it) {
      return {
        line_no: it.line_no,
        description: it.description,
        width_m: it.width_m,
        height_m: it.height_m,
        qty: it.qty,
        area_sqm: it.area_sqm,
        unit_price: it.unit_price,
        extra_charge: it.extra_charge,
        extra_note: it.extra_note,
        line_total: it.line_total
      };
    })
  };
}

/**
 * ออกเอกสารจากใบสั่งจ้าง
 * @param {string} orderId
 * @param {string} docType เช่น QUOTATION / DELIVERY / BILLING / RECEIPT / TAX_INVOICE
 */
function issueDocument(orderId, docType) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    return issueDocumentUnderLock_(orderId, docType);
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * (ภายใน) ออกเอกสาร โดยสมมติว่าผู้เรียกถือ LockService ไว้แล้ว
 * ใช้โดย issueDocument() และ recordPayment() เพื่อไม่ให้ lock ซ้อนกัน (deadlock)
 * @param {string} orderId
 * @param {string} docType เช่น QUOTATION / DELIVERY / BILLING / RECEIPT / TAX_INVOICE
 * @returns {{ok:boolean, data:Object, message:string}}
 */
function issueDocumentUnderLock_(orderId, docType) {
  try {
    var order = repoFindById_('Orders', orderId, true);
    if (!order) throw new Error('ไม่พบใบสั่งจ้าง');
    if (order.status === 'CANCELLED') throw new Error('ใบสั่งจ้างนี้ถูกยกเลิกแล้ว');

    // RULE-01: ถ้าเป็น RECEIPT/TAX_INVOICE ให้ตรวจว่า order ยังถูกล็อก (มี ACTIVE ใบเสร็จอยู่แล้ว)
    // กันการออกใบเสร็จซ้ำ หรือแก้ไขหลังออกใบเสร็จโดยตรง
    if (LOCK_DOC_TYPES.indexOf(docType) >= 0) {
      var existing = filterBy_(SH.DOCUMENTS, function (d) {
        return String(d.order_id) === String(orderId) && d.status === 'ACTIVE' && LOCK_DOC_TYPES.indexOf(d.doc_type) >= 0;
      });
      if (existing.length > 0) {
        throw new Error('ใบสั่งจ้างนี้ออกใบเสร็จแล้ว (' + existing[0].doc_no + ') ไม่สามารถออกซ้ำได้');
      }
      assertRole_(ROLES.MANAGER); // RULE-02: ใบเสร็จต้องออกโดยสิทธิ์ขั้นต่ำ
    }

    // ใบส่งของ (DO) กับ ใบวางบิล (BN) เป็นเอกสารเดียวกัน — ออกได้ครั้งเดียวต่อใบสั่งจ้าง
    if (docType === DOC_TYPES.DELIVERY || docType === DOC_TYPES.BILLING) {
      var shippingDoc = filterBy_(SH.DOCUMENTS, function (d) {
        return String(d.order_id) === String(orderId) && d.status === 'ACTIVE'
          && (d.doc_type === DOC_TYPES.DELIVERY || d.doc_type === DOC_TYPES.BILLING);
      });
      if (shippingDoc.length > 0) {
        throw new Error('ใบสั่งจ้างนี้ออกใบส่งของ/ใบวางบิลแล้ว (' + shippingDoc[0].doc_no + ') ไม่สามารถออกซ้ำได้');
      }
    }

    var items = getOrderItems_(orderId);
    var snapshot = buildSnapshot_(order, items);

    var docNo = nextDocNo_(DOC_PREFIX[docType] || docType);

    var doc = {
      id: uid_(),
      doc_type: docType,
      doc_no: docNo,
      order_id: order.id,
      payment_id: '',
      issue_date: dateStr_(),
      due_date: order.due_date,
      snapshot_json: JSON.stringify(snapshot),
      total_amount: order.grand_total,
      status: 'ACTIVE',
      void_reason: '',
      void_by: '',
      void_at: '',
      print_count: 0,
      issued_by: me_(),
      created_at: nowIso_()
    };
    repoInsert_('Documents', doc);
    writeAudit_('ISSUE_DOC', 'Documents', doc.id, docNo, null, doc, ['doc_no', 'doc_type'], 'ออกเอกสาร ' + docType);
    return { ok: true, data: doc, message: 'ออกเอกสาร ' + docNo + ' สำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * เพิ่ม print_count + เขียน AuditLog PRINT (RULE-07)
 * @param {string} docId
 */
function printDocument(docId) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var doc = repoFindById_('Documents', docId, true);
    if (!doc) throw new Error('ไม่พบเอกสาร');

    var newCount = Number(doc.print_count || 0) + 1;
    repoUpdate_('Documents', docId, { print_count: newCount });
    writeAudit_('PRINT', 'Documents', docId, doc.doc_no, null, { print_count: newCount }, ['print_count'], 'พิมพ์เอกสารครั้งที่ ' + newCount);
    doc.print_count = newCount;
    return { ok: true, data: doc, message: 'พิมพ์ครั้งที่ ' + newCount + ' เรียบร้อย' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงเอกสาร (พร้อม snapshot ที่ถอด JSON แล้ว)
 */
function getDocument(docId) {
  assertRole_();
  try {
    var doc = repoFindById_('Documents', docId, false);
    if (!doc) throw new Error('ไม่พบเอกสาร');
    if (doc.snapshot_json) {
      try {
        doc.snapshot = JSON.parse(doc.snapshot_json);
      } catch (e) {
        doc.snapshot = null;
      }
    }
    return { ok: true, data: doc, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * รายชื่อเอกสารทั้งหมด — สำหรับหน้า วางบิล / ตรวจสอบ
 * @param {Object} opts { doc_type, order_id, status, keyword, limit }
 * @returns {{ok:boolean, data:Array, message:string}}
 */
function listDocuments(opts) {
  assertRole_();
  try {
    opts = opts || {};
    var limit = Math.min(Number(opts.limit) || 200, 500);
    var all = repoRows_(SH.DOCUMENTS, false);

    all = all.filter(function (d) {
      if (opts.doc_type && String(d.doc_type) !== String(opts.doc_type)) return false;
      if (opts.order_id && String(d.order_id) !== String(opts.order_id)) return false;
      if (opts.status && String(d.status) !== String(opts.status)) return false;
      if (opts.keyword) {
        var hay = String(d.doc_no) + ' ' + String(d.doc_type);
        if (hay.toLowerCase().indexOf(String(opts.keyword).toLowerCase()) < 0) return false;
      }
      return true;
    });

    all.reverse(); // ใหม่สุดก่อน
    all = all.slice(0, limit);

    return { ok: true, data: all, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}
