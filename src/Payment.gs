/**
 * Payment.gs
 * รับชำระเงิน + allocate (จ่ายบางส่วน) + ออกใบเสร็จ
 */

/**
 * รับชำระเงินสำหรับ order
 * @param {Object} payload { order_id, amount, method, bank_ref, slip_url, note, wht_deducted }
 */
function recordPayment(payload) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    payload = payload || {};
    if (!payload.order_id) throw new Error('กรุณาระบุใบสั่งจ้าง');
    var order = repoFindById_('Orders', payload.order_id, true);
    if (!order) throw new Error('ไม่พบใบสั่งจ้าง');
    if (order.status === 'CANCELLED') throw new Error('ใบสั่งจ้างนี้ถูกยกเลิกแล้ว');

    var amount = Number(payload.amount || 0);
    var balance = Number(order.balance || 0);
    if (amount <= 0) throw new Error('จำนวนเงินต้องมากกว่า 0');
    if (amount > balance + 0.01) {
      throw new Error('จำนวนเงินเกินยอดคงค้าง (' + money_(balance) + ')');
    }

    var docNo = nextDocNo_(DOC_PREFIX.PAYMENT);
    var payment = {
      id: uid_(),
      doc_no: docNo,
      order_id: order.id,
      customer_id: order.customer_id,
      pay_date: dateStr_(),
      method: payload.method || 'CASH',
      bank_ref: payload.bank_ref || '',
      amount: amount,
      wht_deducted: Number(payload.wht_deducted || 0),
      slip_url: payload.slip_url || '',
      note: payload.note || '',
      status: 'ACTIVE',
      void_reason: '',
      created_by: me_(),
      created_at: nowIso_()
    };
    repoInsert_('Payments', payment);

    // อัปเดต paid_total / balance / สถานะ
    var newPaid = round2_(Number(order.paid_total || 0) + amount);
    var newBalance = round2_(Number(order.grand_total || 0) - newPaid);
    var newStatus = newBalance <= 0.01 ? ORDER_STATUS.PAID : ORDER_STATUS.PARTIAL_PAID;

    var orderUpdate = {
      paid_total: newPaid,
      balance: newBalance,
      status: newStatus,
      locked: (newBalance <= 0.01) ? 'TRUE' : 'FALSE',
      updated_by: me_(),
      updated_at: nowIso_()
    };
    repoUpdate_('Orders', order.id, orderUpdate);
    writeAudit_('PAYMENT', 'Payments', payment.id, docNo, null, payment, ['amount', 'method'], 'รับชำระเงิน ' + amount);

    // ถ้ายอดครบ → ออกใบเสร็จให้อัตโนมัติ
    // เรียก issueDocumentUnderLock_ เพราะเรายังถือ lock อยู่ (กัน deadlock จากการขอ lock ซ้อน)
    var receipt = null;
    if (newStatus === ORDER_STATUS.PAID) {
      var issueRes = issueDocumentUnderLock_(order.id, DOC_TYPES.RECEIPT);
      if (issueRes.ok) {
        receipt = issueRes.data;
      }
    }

    return {
      ok: true,
      data: { payment: payment, order: orderUpdate, receipt: receipt },
      message: 'รับชำระเงิน ' + money_(amount) + ' สำเร็จ'
    };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงรายการใบสั่งจ้างที่ค้างชำระของลูกค้า
 */
function listDueOrders(customerId) {
  assertRole_();
  try {
    var rows = repoRows_('Orders', false);
    var result = rows.filter(function (o) {
      if (customerId && String(o.customer_id) !== String(customerId)) return false;
      var st = String(o.status || '');
      var due = ['BILLED', 'PARTIAL_PAID', 'CONFIRMED', 'DELIVERED'];
      return due.indexOf(st) >= 0 && Number(o.balance || 0) > 0.01;
    });
    return { ok: true, data: result, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}
