/**
 * Customer.gs
 * ค้นหา / สร้าง / แก้ไขลูกค้า
 */

/**
 * ค้นหาลูกค้า (ตามชื่อ หรือเบอร์โทร หรือ tax_id)
 * @param {string} keyword คำค้นหา
 * @returns {{ok:boolean, data:Array, message:string}}
 */
function searchCustomers(keyword) {
  assertRole_();
  try {
    keyword = (keyword || '').trim();
    var rows = repoRows_('Customers', false);
    var result = rows.filter(function (c) {
      if (!c.is_active && c.is_active !== true && c.is_active !== 'TRUE' && c.is_active !== 'true') {
        // ยังแสดงทั้งหมดในรายชื่อ ก็ได้ แต่น้องอาจมา filter ด้านหน้า
      }
      if (!keyword) return true;
      var hay = String(c.name || '') + ' ' + String(c.phone || '') + ' ' + String(c.code || '') + ' ' + String(c.tax_id || '');
      return hay.toLowerCase().indexOf(keyword.toLowerCase()) >= 0;
    });
    return { ok: true, data: result, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * สร้างลูกค้าใหม่
 * @param {Object} payload ข้อมูลลูกค้า
 */
function createCustomer(payload) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    payload = payload || {};
    if (!payload.name) throw new Error('กรุณากรอกชื่อลูกค้า');

    var customers = repoRows_('Customers', true);
    var lastCode = 0;
    for (var i = 0; i < customers.length; i++) {
      var m = String(customers[i].code || '').match(/^C-(\d+)$/);
      if (m) lastCode = Math.max(lastCode, Number(m[1]));
    }
    var code = 'C-' + ('0000' + (lastCode + 1)).slice(-4);

    var customer = {
      id: uid_(),
      code: code,
      name: payload.name,
      customer_type: payload.customer_type || 'RETAIL',
      phone: payload.phone || '',
      tax_id: payload.tax_id || '',
      address: payload.address || '',
      credit_days: payload.credit_days || 0,
      is_active: 'TRUE'
    };
    repoInsert_('Customers', customer);
    writeAudit_('CREATE', 'Customers', customer.id, null, null, customer, ['name', 'phone', 'customer_type'], 'สร้างลูกค้า');
    return { ok: true, data: customer, message: 'สร้างลูกค้าสำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ลบลูกค้า (soft delete — ตั้ง is_active = FALSE)
 * RULE-05: ไม่มี hard delete
 */
function deleteCustomer(customerId, reason) {
  assertRole_('ADMIN');
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    if (!reason || String(reason).trim().length < MIN_REASON_LEN) {
      throw new Error('เหตุผลการลบต้องมีความยาวอย่างน้อย ' + MIN_REASON_LEN + ' ตัวอักษร');
    }
    var before = repoFindById_('Customers', customerId, true);
    if (!before) throw new Error('ไม่พบลูกค้า');
    if (before.is_active === 'FALSE') throw new Error('ลูกค้าถูกปิดใช้งานแล้ว');

    var merged = {};
    var keys = Object.keys(before);
    for (var j = 0; j < keys.length; j++) merged[keys[j]] = before[keys[j]];
    merged.is_active = 'FALSE';

    repoUpdate_('Customers', customerId, merged);
    writeAudit_('DELETE', 'Customers', customerId, null, before, merged, ['is_active'], reason);
    return { ok: true, data: merged, message: 'ลบลูกค้าสำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * แก้ไขลูกค้า
 */
function updateCustomer(customerId, payload) {
  assertRole_();
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var before = repoFindById_('Customers', customerId, true);
    if (!before) throw new Error('ไม่พบลูกค้า');

    var merged = {};
    var keys = Object.keys(before);
    for (var j = 0; j < keys.length; j++) merged[keys[j]] = before[keys[j]];
    var changed = [];
    for (var k in payload) {
      if (payload[k] !== undefined && payload[k] !== merged[k]) {
        changed.push(k);
        merged[k] = payload[k];
      }
    }
    if (changed.length === 0) {
      return { ok: true, data: before, message: 'ไม่มีข้อมูลเปลี่ยนแปลง' };
    }

    repoUpdate_('Customers', customerId, merged);
    writeAudit_('UPDATE', 'Customers', customerId, null, before, merged, changed, 'แก้ไขลูกค้า');
    return { ok: true, data: merged, message: 'แก้ไขลูกค้าสำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}
