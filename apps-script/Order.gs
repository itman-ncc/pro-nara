/**
 * Order.gs
 * สร้าง / แก้ไข / คำนวณตร.ม. / เปลี่ยนสถานะใบสั่งจ้าง
 *
 * พื้นที่ต่อชิ้น (area_sqm) = MAX(width_m × height_m, product.min_area_sqm)
 * line_total = area_sqm × qty × unit_price + extra_charge
 */

// per-request cache ของข้อมูล Products — อ่านครั้งเดียวต่อ request เพื่อกัน N+1
// (ตัวแปร module ถูกสร้างใหม่ทุก HTTP request จึงปลอดภัย)
var _PRODUCTS_BY_ID = null;
function productsById_() {
  if (!_PRODUCTS_BY_ID) {
    _PRODUCTS_BY_ID = {};
    var rows = repoRows_(SH.PRODUCTS, false);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id) _PRODUCTS_BY_ID[String(rows[i].id)] = rows[i];
    }
  }
  return _PRODUCTS_BY_ID;
}


/**
 * คำนวณพื้นที่ของรายการเดียว
 * @param {Object} item { product_id, width_m, height_m, qty }
 * @returns {number} area_sqm
 */
function calcAreaSqm_(item) {
  var prod = item.product_id ? productsById_()[String(item.product_id)] : null;
  var minArea = prod ? Number(prod.min_area_sqm || 0) : 0;
  var width = Number(item.width_m || 0);
  var height = Number(item.height_m || 0);
  var area = width * height;
  return roundUp2_(Math.max(area, minArea));
}

/**
 * คำนวณยอดรวมของใบสั่งจ้างทั้งหมด (ตามสูตรข้อ 3)
 * @param {Array} items รายการ
 * @param {Object} orderMeta { sale_mode, discount_amt, vat_mode, wht_amount }
 * @returns {Object} { subtotal, discount_amt, vat_amount, grand_total }
 */
function calcOrderTotals_(items, orderMeta) {
  var subtotal = 0;
  for (var i = 0; i < items.length; i++) {
    subtotal += Number(items[i].line_total || 0);
  }
  subtotal = round2_(subtotal);

  var discount = round2_(orderMeta.discount_amt || 0);
  var vatMode = orderMeta.vat_mode || 'NONE';
  var vatAmount = 0;
  if (vatMode === 'EXCLUDE') {
    vatAmount = round2_(subtotal * 0.07);
  } else if (vatMode === 'INCLUDE') {
    vatAmount = round2_(subtotal * 7 / 107);
  }
  var wht = round2_(orderMeta.wht_amount || 0);
  var grandTotal = round2_(subtotal - discount + vatAmount - wht);

  return { subtotal: subtotal, discount_amt: discount, vat_amount: vatAmount, grand_total: grandTotal };
}

/**
 * สร้างใบสั่งจ้างพร้อมรายการ
 * @param {Object} payload { customer_id, sale_mode, items:[...], ... }
 */
function createOrder(payload) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    payload = payload || {};
    if (!payload.customer_id) throw new Error('กรุณาเลือกลูกค้า');
    var customer = repoFindById_('Customers', payload.customer_id, true);
    if (!customer) throw new Error('ไม่พบลูกค้า');

    var items = payload.items || [];
    if (!items.length) throw new Error('กรุณาเพิ่มรายการสินค้า');

    var saleMode = payload.sale_mode || customer.customer_type === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';

    // เตรียมรายการพร้อมคำนวณ
    var prepared = [];
    for (var i = 0; i < items.length; i++) {
      prepared.push(prepareOrderItem_(items[i], saleMode, i + 1));
    }

    var totals = calcOrderTotals_(prepared, {
      discount_amt: payload.discount_amt,
      vat_mode: payload.vat_mode,
      wht_amount: payload.wht_amount
    });

    var dueDate = payload.due_date || dateStr_(new Date(Date.now() + Number(customer.credit_days || 0) * 86400000));
    var docNo = nextDocNo_(DOC_PREFIX.ORDER);

    var order = {
      id: uid_(),
      doc_no: docNo,
      customer_id: customer.id,
      customer_name: customer.name,
      order_date: dateStr_(),
      due_date: dueDate,
      sale_mode: saleMode,
      status: ORDER_STATUS.DRAFT,
      revision_no: 1,
      subtotal: totals.subtotal,
      discount_amt: totals.discount_amt,
      vat_mode: payload.vat_mode || 'NONE',
      vat_rate: totals.vat_amount > 0 ? 7 : 0,
      vat_amount: totals.vat_amount,
      wht_amount: totals.wht_amount || 0,
      grand_total: totals.grand_total,
      paid_total: 0,
      balance: totals.grand_total,
      locked: 'FALSE',
      note: payload.note || '',
      cancel_reason: '',
      ref_cancelled_order: '',
      created_by: me_(),
      created_at: nowIso_(),
      updated_by: me_(),
      updated_at: nowIso_()
    };
    repoInsert_('Orders', order);

    // เก็บรายการ
    for (var j = 0; j < prepared.length; j++) {
      prepared[j].order_id = order.id;
      prepared[j].id = uid_();
      repoInsert_('OrderItems', prepared[j]);
    }

    writeAudit_('CREATE', 'Orders', order.id, docNo, null, order, ['doc_no', 'grand_total'], 'สร้างใบสั่งจ้าง');
    return { ok: true, data: order, message: 'สร้างใบสั่งจ้าง ' + docNo + ' สำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * เตรียมรายการเดียวให้พร้อมเก็บ (คำนวณ area + line_total)
 */
function prepareOrderItem_(item, saleMode, lineNo) {
  var prod = item.product_id ? productsById_()[String(item.product_id)] : null;
  var areaSqm = calcAreaSqm_({ product_id: item.product_id, width_m: item.width_m, height_m: item.height_m });

  // unit_price: ดึงจาก sale_mode แต่แก้ไขรายรายการได้
  var defaultPrice = 0;
  if (saleMode === 'WHOLESALE') {
    defaultPrice = prod ? Number(prod.price_wholesale || 0) : 0;
  } else {
    defaultPrice = prod ? Number(prod.price_retail || 0) : 0;
  }
  var unitPrice = item.unit_price !== undefined ? Number(item.unit_price) : defaultPrice;

  var qty = Number(item.qty || 1);
  var extra = Number(item.extra_charge || 0);
  var lineTotal = round2_(areaSqm * qty * unitPrice + extra);

  return {
    product_id: item.product_id || '',
    line_no: lineNo,
    description: item.description || (prod ? prod.name : ''),
    width_m: item.width_m || 0,
    height_m: item.height_m || 0,
    qty: qty,
    area_sqm: areaSqm,
    price_mode: saleMode,
    unit_price: unitPrice,
    extra_charge: extra,
    extra_note: item.extra_note || '',
    line_total: lineTotal
  };
}

/**
 * อัปเดตใบสั่งจ้าง (ตรวจสอบสถานะล็อกก่อน)
 */
function updateOrder(orderId, payload) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var before = repoFindById_('Orders', orderId, true);
    if (!before) throw new Error('ไม่พบใบสั่งจ้าง');

    assertStatusPermitted_(before, 'EDIT'); // RULE-01, RULE-02

    payload = payload || {};
    var merged = {};
    var keys = Object.keys(before);
    for (var j = 0; j < keys.length; j++) merged[keys[j]] = before[keys[j]];

    var changed = [];

    if (payload.note !== undefined && payload.note !== before.note) {
      merged.note = payload.note;
      changed.push('note');
    }
    if (payload.due_date !== undefined && payload.due_date !== before.due_date) {
      merged.due_date = payload.due_date;
      changed.push('due_date');
    }

    // ถ้ามีรายการใหม่ ให้บันทึกเป็น revision ใหม่ (RULE-05: ไม่ลบแถวเดิม)
    // ลดความเสี่ยงโดยให้เก็บ OrderItems ชุดเดิมไว้ และเพิ่มชุดใหม่พร้อม revision ที่ raised ขึ้น
    if (payload.items && payload.items.length) {
      var prepared = [];
      for (var m = 0; m < payload.items.length; m++) {
        prepared.push(prepareOrderItem_(payload.items[m], merged.sale_mode, m + 1));
      }
      for (var n = 0; n < prepared.length; n++) {
        prepared[n].order_id = orderId;
        prepared[n].id = uid_();
        repoInsert_('OrderItems', prepared[n]);
      }
      merged.revision_no = (Number(merged.revision_no) || 1) + 1;
      changed.push('items');
    }

    if (payload.discount_amt !== undefined || payload.vat_mode !== undefined || payload.wht_amount !== undefined) {
      var newItems = getOrderItems_(orderId);
      var totals = calcOrderTotals_(newItems, {
        discount_amt: payload.discount_amt !== undefined ? payload.discount_amt : merged.discount_amt,
        vat_mode: payload.vat_mode !== undefined ? payload.vat_mode : merged.vat_mode,
        wht_amount: payload.wht_amount !== undefined ? payload.wht_amount : merged.wht_amount
      });
      if (payload.discount_amt !== undefined && payload.discount_amt !== merged.discount_amt) changed.push('discount_amt');
      if (payload.vat_mode !== undefined && payload.vat_mode !== merged.vat_mode) changed.push('vat_mode');
      if (payload.wht_amount !== undefined && payload.wht_amount !== merged.wht_amount) changed.push('wht_amount');
      merged.discount_amt = totals.discount_amt;
      merged.vat_mode = payload.vat_mode !== undefined ? payload.vat_mode : merged.vat_mode;
      merged.vat_amount = totals.vat_amount;
      merged.vat_rate = totals.vat_amount > 0 ? 7 : 0;
      merged.wht_amount = totals.wht_amount;
      merged.subtotal = totals.subtotal;
      merged.grand_total = totals.grand_total;
      if (merged.status === 'DRAFT') {
        merged.balance = round2_(totals.grand_total - Number(before.paid_total || 0));
      }
    }

    merged.updated_by = me_();
    merged.updated_at = nowIso_();
    changed.push('updated_by', 'updated_at');

    repoUpdate_('Orders', orderId, merged);
    writeAudit_('UPDATE', 'Orders', orderId, merged.doc_no, before, merged, changed, 'แก้ไขใบสั่งจ้าง');
    return { ok: true, data: merged, message: 'แก้ไขใบสั่งจ้างสำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * อ่านรายการสินค้าทั้งหมดของ order
 */
function getOrderItems_(orderId) {
  var rows = repoRows_('OrderItems', true);
  return rows.filter(function (r) { return String(r.order_id) === String(orderId); });
}

/**
 * ดึงใบสั่งจ้างพร้อมรายการ
 */
function getOrderDetail(orderId) {
  assertRole_();
  try {
    var order = repoFindById_('Orders', orderId, false);
    if (!order) throw new Error('ไม่พบใบสั่งจ้าง');
    var items = getOrderItems_(orderId);
    return { ok: true, data: { order: order, items: items }, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * เปลี่ยนสถานะใบสั่งจ้าง
 */
function changeOrderStatus(orderId, newStatus, reason) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var before = repoFindById_('Orders', orderId, true);
    if (!before) throw new Error('ไม่พบใบสั่งจ้าง');

    if (newStatus === 'CANCELLED') {
      // เรียก cancelOrderUnderLock_ เพราะเรายังถือ lock อยู่ (กัน deadlock)
      return cancelOrderUnderLock_(orderId, reason);
    }

    assertStatusPermitted_(before, 'EDIT');

    var allowed = ['QUOTED', 'CONFIRMED', 'IN_PRODUCTION', 'DELIVERED', 'BILLED'];
    if (allowed.indexOf(newStatus) < 0) {
      throw new Error('ไม่สามารถเปลี่ยนสถานะเป็น ' + newStatus);
    }

    var merged = JSON.parse(JSON.stringify(before));
    merged.status = newStatus;
    merged.updated_by = me_();
    merged.updated_at = nowIso_();

    repoUpdate_('Orders', orderId, merged);
    writeAudit_('STATUS_CHANGE', 'Orders', orderId, before.doc_no, before, merged, ['status'], reason || 'เปลี่ยนสถานะเป็น ' + newStatus);
    return { ok: true, data: merged, message: 'เปลี่ยนสถานะเป็น ' + newStatus + ' สำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * รายชื่อใบสั่งจ้าง (ค้นหา/กรอง)
 */
function listOrders(filter) {
  assertRole_();
  try {
    filter = filter || {};
    var rows = repoRows_('Orders', false).slice().reverse(); // ใหม่สุดก่อน
    var result = rows.filter(function (o) {
      if (filter.status && o.status !== filter.status) return false;
      if (filter.customer_id && String(o.customer_id) !== String(filter.customer_id)) return false;
      if (filter.from_date && String(o.order_date) < filter.from_date) return false;
      if (filter.to_date && String(o.order_date) > filter.to_date) return false;
      if (filter.keyword) {
        var hay = String(o.doc_no) + ' ' + String(o.customer_name);
        if (hay.toLowerCase().indexOf(String(filter.keyword).toLowerCase()) < 0) return false;
      }
      return true;
    });
    return { ok: true, data: result, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}
