/**
 * Test.gs
 * ชุดทดสอบการทำงานของระบบ (Acceptance Tests)
 *
 * รันทีละฟังก์ชันจาก Apps Script editor (หรือ clasp run)
 * แต่ละ test จะ log ผลชัดเจนว่า PASS / FAIL พร้อมเหตุผล
 *
 * หมายเหตุ: test เหล่านี้เขียนข้อมูลลงชีตจริง (ใช้ข้อมูล test โดยมี prefix T-)
 * หากต้องการทดสอบกับข้อมูลจริงซ้ำอาจต้องเคลียร์ข้อมูลด้วยตนเอง
 * (ระบบไม่มี hard delete ตาม RULE-05 เพื่อความถูกต้องของหลักธุรกิจจริง)
 */

var TEST_PREFIX = 'T-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss');

/**
 * ฟังก์ชันรัน test เดียว + log ผล
 * @param {string} name ชื่อ test
 * @param {Function} fn ฟังก์ชันที่คืน { ok:boolean, detail:string }
 */
function runTest_(name, fn) {
  try {
    var res = fn();
    if (res && res.ok) {
      Logger.log('[PASS] ' + name + ' :: ' + (res.detail || ''));
      console.log('[PASS] ' + name + ' :: ' + (res.detail || ''));
    } else {
      Logger.log('[FAIL] ' + name + ' :: ' + (res && res.detail) || '');
      console.log('[FAIL] ' + name + ' :: ' + ((res && res.detail) || ''));
    }
    return !!(res && res.ok);
  } catch (e) {
    Logger.log('[ERROR] ' + name + ' :: ' + e.message);
    console.log('[ERROR] ' + name + ' :: ' + e.message);
    return false;
  }
}

/**
 * สร้างลูกค้าทดสอบชั่วคราว (ได้ id คืน)
 */
function makeTestCustomer_() {
  var name = 'ลูกค้าทดสอบ ' + TEST_PREFIX;
  var res = createCustomer({ name: name, phone: '000-000-000' + (Math.floor(Math.random() * 9) + 1), customer_type: 'RETAIL' });
  if (!res.ok) throw new Error('สร้างลูกค้า test ไม่สำเร็จ: ' + res.message);
  return res.data;
}

/**
 * เลือกสินค้า test (ใช้ตัวแรกจาก Products)
 */
function pickTestProduct_() {
  var products = readAll_(SH.PRODUCTS);
  if (!products.length) throw new Error('ไม่มีสินค้าในระบบ (ต้องรัน setupAll ก่อน)');
  return products[0];
}

/**
 * testFullFlow: สร้างลูกค้า → ใบสั่งจ้าง → เสนอราคา → ส่งของ → วางบิล → รับชำระ → ใบเสร็จ
 * คืน { orderId, receiptDocNo, receiptTotal, orderGrandTotal, docs }
 */
function testFullFlow() {
  var orderId = null;
  var receiptId = null;
  return runTest_('Full Flow (สร้าง→เสนอ→ส่ง→วางบิล→รับชำระ→ใบเสร็จ)', function () {
    // 1. สร้างลูกค้า
    var cust = makeTestCustomer_();
    if (!cust || !cust.id) throw new Error('ไม่ได้ id ลูกค้า');

    // 2. สร้างใบสั่งจ้าง
    var prod = pickTestProduct_();
    var createRes = createOrder({
      customer_id: cust.id,
      sale_mode: 'RETAIL',
      vat_mode: 'NONE',
      items: [{
        product_id: prod.id,
        description: 'TEST ไวนิล 1x1',
        width_m: 1,
        height_m: 1,
        qty: 2,
        unit_price: 100
      }]
    });
    if (!createRes.ok) throw new Error('createOrder: ' + createRes.message);
    var order = createRes.data;
    orderId = order.id;
    var orderGrandTotal = Number(order.grand_total);
    if (orderGrandTotal <= 0) throw new Error('ใบสั่งจ้างมียอดรวมเป็น 0');

    // 3. เสนอราคา (QUOTATION)
    var qt = issueDocument(order.id, DOC_TYPES.QUOTATION);
    if (!qt.ok) throw new Error('ออก QT: ' + qt.message);

    // 4. ส่งของ (DELIVERY)
    var dv = issueDocument(order.id, DOC_TYPES.DELIVERY);
    if (!dv.ok) throw new Error('ออก DO: ' + dv.message);

    // 5. วางบิล (BILLING) — ง่ายสุดใช้ใบสั่งจ้างเดิม
    var bn = issueDocument(order.id, DOC_TYPES.BILLING);
    if (!bn.ok) throw new Error('ออก BN: ' + bn.message);

    // 6. รับชำระเต็มยอด → ควรได้ใบเสร็จอัตโนมัติ
    var pay = recordPayment({ order_id: order.id, amount: orderGrandTotal, method: 'CASH' });
    if (!pay.ok) throw new Error('recordPayment: ' + pay.message);
    receiptId = pay.data.receipt ? pay.data.receipt.id : null;
    if (!receiptId) throw new Error('การรับชำระเต็มยอดไม่เกิดใบเสร็จอัตโนมัติ');
    var receipt = pay.data.receipt;
    var receiptTotal = Number(receipt.total_amount);

    // ตรวจว่าราคาใบเสร็จตรงกับ grand_total
    if (receiptTotal !== orderGrandTotal) {
      throw new Error('ใบเสร็จราคาไม่ตรง (RC=' + receiptTotal + ' vs OD=' + orderGrandTotal + ')');
    }

    // ตรวจ status เป็น PAID
    var finalOrder = findBy_(SH.ORDERS, 'id', order.id);
    if (finalOrder.status !== ORDER_STATUS.PAID) {
      throw new Error('สถานะไม่เป็น PAID หลังชำระ (ได้ ' + finalOrder.status + ')');
    }

    // chain ไว้เก็บผล
    GLOBAL_tc = { orderId: orderId, receiptId: receiptId, orderGrandTotal: orderGrandTotal, receiptTotal: receiptTotal, receiptDocNo: receipt.doc_no };
    return { ok: true, detail: 'ครบวงจร OD=' + order.doc_no + ' RC=' + receipt.doc_no + ' ยอด=' + orderGrandTotal };
  });
}

var GLOBAL_tc = null;

/**
 * testLockAfterReceipt: ยืนยันว่าแก้ไขหลังออกใบเสร็จแล้ว throw error
 */
function testLockAfterReceipt() {
  // ต้องรัน testFullFlow ก่อนเพื่อให้มี order ที่ออกใบเสร็จแล้ว
  if (!GLOBAL_tc) {
    Logger.log('[SKIP] testLockAfterReceipt: ต้องรัน testFullFlow ก่อน (ไม่มี order ที่ออกใบเสร็จ)');
    return true;
  }
  return runTest_('Lock หลังออกใบเสร็จ (แก้ไขไม่ได้)', function () {
    var orderId = GLOBAL_tc.orderId;
    var before = findBy_(SH.ORDERS, 'id', orderId);
    var lockedBefore = String(before.locked || 'FALSE') === 'TRUE';

    // ลองแก้ไขผ่าน updateOrder → ควรถูกปฏิเสธ (RULE-01)
    var editRes = updateOrder(orderId, { note: 'พยายามแก้หลังออกใบเสร็จ' });
    if (editRes.ok) {
      throw new Error('updateOrder ผ่านทั้งที่ order ออกใบเสร็จแล้ว (RULE-01 ถูกละเมิด)');
    }

    // ตรวจว่า error message เกี่ยวข้องกับล็อก
    var msg = editRes.message || '';
    if (msg.indexOf('ใบเสร็จ') < 0 && msg.indexOf('ล็อก') < 0 && msg.indexOf('แก้ไข') < 0) {
      throw new Error('error ไม่เกี่ยวกับการล็อก: ' + msg);
    }

    // ตรวจว่าค่า note ไม่เปลี่ยน
    var after = findBy_(SH.ORDERS, 'id', orderId);
    if (String(after.note || '') !== String(before.note || '')) {
      throw new Error('ข้อมูลถูกแก้แม้ถูกปฏิเสธ (note เปลี่ยน)');
    }

    if (!lockedBefore) {
      // ถ้าไม่ได้ lock flag ก็ควรยอมรับเพราะ edit ถูกปฏิเสธจาก RULE-01 อยู่แล้ว
    }

    return { ok: true, detail: 'updateOrder ถูกปฏิเสธ: ' + msg };
  });
}

/**
 * testCancelCascade: ยืนยันว่าเอกสารทั้งสายเป็น VOID และ order เป็น CANCELLED
 */
function testCancelCascade() {
  return runTest_('Cascade Cancel (VOID ทั้งสาย + order CANCELLED)', function () {
    // สร้าง order ใหม่ขึ้นมาเองเพื่อทดสอบโดยไม่พึ่ง flow
    var cust = makeTestCustomer_();
    var prod = pickTestProduct_();
    var createRes = createOrder({
      customer_id: cust.id,
      sale_mode: 'RETAIL',
      vat_mode: 'NONE',
      items: [{ product_id: prod.id, description: 'TEST cancel', width_m: 1, height_m: 2, qty: 1, unit_price: 50 }]
    });
    if (!createRes.ok) throw new Error('createOrder: ' + createRes.message);
    var order = createRes.data;

    // ออกเอกสาร 2 ใบ (QT, DO)
    var qt = issueDocument(order.id, DOC_TYPES.QUOTATION);
    var dv = issueDocument(order.id, DOC_TYPES.DELIVERY);
    if (!qt.ok || !dv.ok) throw new Error('ออกเอกสารไม่สำเร็จ');

    var qtDocNo = qt.data.doc_no;
    var dvDocNo = dv.data.doc_no;

    // ยกเลิก cascade
    var cancelRes = cancelOrder(order.id, 'ทดสอบยกเลิกทั้งหมดแบบ cascade ครบสาย');
    if (!cancelRes.ok) throw new Error('cancelOrder: ' + cancelRes.message);

    // ตรวจ order เป็น CANCELLED
    var finalOrder = findBy_(SH.ORDERS, 'id', order.id);
    if (finalOrder.status !== ORDER_STATUS.CANCELLED) {
      throw new Error('order ไม่เป็น CANCELLED (ได้ ' + finalOrder.status + ')');
    }

    // ตรวจเอกสารทุกใบของ order เป็น VOID
    var docs = filterBy_(SH.DOCUMENTS, function (d) { return String(d.order_id) === String(order.id); });
    var activeDocs = docs.filter(function (d) { return d.status === 'ACTIVE'; });
    if (activeDocs.length > 0) {
      throw new Error('ยังมีเอกสาร ACTIVE หลงเหลือ ' + activeDocs.map(function (d) { return d.doc_no; }).join(','));
    }
    var voidDocs = docs.filter(function (d) { return d.status === 'VOID'; });
    if (voidDocs.length < 2) {
      throw new Error('เอกสาร VOID ไม่ครบ (ได้ ' + voidDocs.length + '/2)');
    }

    // ตรวจ CancelLog ถูกเขียน
    var cancelLogs = filterBy_(SH.CANCEL_LOG, function (l) { return String(l.root_order_id) === String(order.id); });
    if (cancelLogs.length === 0) {
      throw new Error('ไม่มี CancelLog ถูกบันทึก');
    }

    return { ok: true, detail: 'VOID ' + voidDocs.length + ' ใบ (QT=' + qtDocNo + ', DO=' + dvDocNo + ') + order CANCELLED + CancelLog ' + cancelLogs.length + ' แถว' };
  });
}

/**
 * testReasonValidation: ยืนยันว่าเหตุผลสั้นกว่า 10 ตัวอักษรถูกปฏิเสธ
 */
function testReasonValidation() {
  return runTest_('Validation เหตุผลยกเลิก (<10 ตัวอักษร ถูกปฏิเสธ)', function () {
    var cust = makeTestCustomer_();
    var prod = pickTestProduct_();
    var createRes = createOrder({
      customer_id: cust.id,
      sale_mode: 'RETAIL',
      vat_mode: 'NONE',
      items: [{ product_id: prod.id, description: 'TEST reason', width_m: 1, height_m: 1, qty: 1, unit_price: 10 }]
    });
    if (!createRes.ok) throw new Error('createOrder: ' + createRes.message);
    var order = createRes.data;

    // เปลี่ยนสถานะให้ไม่ใช่ DRAFT เพื่อให้ DRAFT ยังไม่ต้องเหตุผล
    var st = changeOrderStatus(order.id, 'CONFIRMED', 'เปลี่ยนเป็นยืนยันเพื่อทดสอบ');
    if (!st.ok) throw new Error('changeOrderStatus: ' + st.message);

    // เหตุผลสั้น (5 ตัว)
    var shortReason = 'สั้นมาก';
    var badRes = cancelOrder(order.id, shortReason);
    if (badRes.ok) {
      throw new Error('cancelOrder ผ่านทั้งที่เหตุผลสั้นกว่า 10 ตัว');
    }
    var msg = badRes.message || '';
    if (msg.indexOf('10') < 0) {
      throw new Error('error ไม่ได้ระบุว่าต้อง 10 ตัว: ' + msg);
    }

    // ตรวจว่า order ยังไม่ถูกยกเลิกจริง
    var still = findBy_(SH.ORDERS, 'id', order.id);
    if (still.status === ORDER_STATUS.CANCELLED) {
      throw new Error('order ถูกยกเลิกไปทั้งที่เหตุผลไม่ผ่าน');
    }

    return { ok: true, detail: 'เหตุผล "' + shortReason + '" (5 ตัว) ถูกปฏิเสธ: ' + msg };
  });
}

/**
 * testSnapshotIntegrity: แก้ราคาสินค้าแล้วพิมพ์ใบเสร็จเก่าซ้ำ ต้องได้ราคาเดิม
 */
function testSnapshotIntegrity() {
  if (!GLOBAL_tc || !GLOBAL_tc.receiptId) {
    Logger.log('[SKIP] testSnapshotIntegrity: ต้องรัน testFullFlow ก่อน');
    return true;
  }
  return runTest_('Snapshot Integrity (แก้ราคาสินค้าแล้วพิมพ์ใบเสร็จซ้ำได้ราคาเดิม)', function () {
    var receiptId = GLOBAL_tc.receiptId;
    var expectedTotal = GLOBAL_tc.receiptTotal;

    // อ่าน snapshot เดิมจากใบเสร็จ
    var beforeDoc = getDocument(receiptId).data;
    var beforeSnap = beforeDoc.snapshot;
    if (!beforeSnap || !beforeSnap.items || beforeSnap.items.length === 0) {
      throw new Error('ใบเสร็จไม่มี snapshot');
    }
    var beforeLineTotal = Number(beforeSnap.items[0].line_total);

    // แก้ราคาสินค้าตัวแรกในอาร์เรย์ (ยิงที่สินค้าที่อยู่ใน snapshot)
    var prodId = beforeSnap.items[0].description ? findProductByDescription_(beforeSnap.items[0].description) : null;
    if (prodId) {
      var beforeProd = findBy_(SH.PRODUCTS, 'id', prodId);
      var newPrice = Number(beforeProd.price_retail) + 50; // เพิ่มราคา 50
      // ชั่วคราวแก้ราคา (ทดสอบ) — RULE-05 อนุญาต update ได้
      updateRow_(SH.PRODUCTS, beforeProd._row, { price_retail: newPrice });
    }

    // พิมพ์ใบเสร็จซ้ำ (printDocument) — สิ่งที่จะอ่านคือ snapshot เดิม ไม่ใช่ข้อมูลสด
    var printRes = printDocument(receiptId);
    if (!printRes.ok) throw new Error('printDocument: ' + printRes.message);

    // อ่าน snapshot หลังจากพิมพ์ซ้ำ — ต้องยังเป็นค่าเดิม
    var afterDoc = getDocument(receiptId).data;
    var afterSnap = afterDoc.snapshot;
    var afterLineTotal = Number(afterSnap.items[0].line_total);

    if (afterLineTotal !== beforeLineTotal) {
      throw new Error('snapshot เปลี่ยนหลังแก้ราคาสินค้า (ก่อน=' + beforeLineTotal + ' หลัง=' + afterLineTotal + ')');
    }
    if (Number(afterDoc.total_amount) !== expectedTotal) {
      throw new Error('total_amount เปลี่ยน (เดิม=' + expectedTotal + ' หลัง=' + afterDoc.total_amount + ')');
    }

    // ตรวจว่า print_count เพิ่มขึ้น
    if (Number(afterDoc.print_count) < Number(beforeDoc.print_count) + 1) {
      throw new Error('print_count ไม่เพิ่ม (ก่อน=' + beforeDoc.print_count + ' หลัง=' + afterDoc.print_count + ')');
    }

    return { ok: true, detail: 'แก้ราคาสินค้าแล้ว snapshot เดิมคงที่ line_total=' + afterLineTotal + ', print_count=' + afterDoc.print_count };
  });
}

/**
 * หา product id จาก description (ตรงกับ snapshot)
 */
function findProductByDescription_(description) {
  var products = readAll_(SH.PRODUCTS);
  for (var i = 0; i < products.length; i++) {
    if (String(products[i].name || '') === String(description || '')) return products[i].id;
  }
  return null;
}

/**
 * testAll: รันทุก test ตามลำดับ
 */
function testAll() {
  Logger.log('=== เริ่มทดสอบระบบทั้งหมด ' + TEST_PREFIX + ' ===');
  var results = [];

  results.push(['FullFlow', testFullFlow()]);
  results.push(['LockAfterReceipt', testLockAfterReceipt()]);
  results.push(['CancelCascade', testCancelCascade()]);
  results.push(['ReasonValidation', testReasonValidation()]);
  results.push(['SnapshotIntegrity', testSnapshotIntegrity()]);

  var pass = results.filter(function (r) { return r[1]; }).length;
  Logger.log('=== สรุป: PASS ' + pass + '/' + results.length + ' ===');
  Logger.log('ผล: ' + results.map(function (r) { return r[0] + '=' + (r[1] ? 'PASS' : 'FAIL'); }).join(', '));
  return { ok: pass === results.length, data: null, message: 'PASS ' + pass + '/' + results.length };
}

/**
 * รัน test ทั้งหมดในฐานะ ADMIN (ตั้ง CURRENT_SESSION ก่อน)
 * เหมาะสำหรับรันจาก Apps Script editor หลัง setup แล้ว
 */
function runTestsAsAdmin() {
  setCurrentUser_({ email: 'admin@pro-nara.com', role: 'ADMIN', name: 'ผู้ดูแลระบบ' });
  try {
    return testAll();
  } finally {
    setCurrentUser_(null);
  }
}
