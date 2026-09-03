/**
 * Api.gs
 * REST API entry point — doGet / doPost dispatcher
 *
 * Client เรียกผ่าน fetch POST ไปยัง URL ของ Web App:
 *   body = { action: string, payload: object, session: { email } }
 *
 * doPost จะตั้ง CURRENT_SESSION จาก req.session แล้ว dispatch ไปยังฟังก์ชันธุรกิจ
 * ฟังก์ชันธุรกิจทั้งหมดคืน { ok, data, message } โดยทำ assertRole_ เอง
 */

/**
 * doGet — หน้า landing เพื่อให้เปิด URL ใน browser ได้ (ระบบหลักคือ GitHub Pages)
 */
function doGet() {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>ระบบวางบิลร้านไวนิล</title>' +
    '<style>body{font-family:"Sarabun",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9;color:#0f172a}.box{text-align:center;background:#fff;padding:48px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08)}a{display:inline-block;margin-top:16px;padding:12px 24px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:10px}</style>' +
    '</head><body><div class="box">' +
    '<h1>📐 ระบบวางบิลร้านไวนิล</h1>' +
    '<p>บริการนี้เป็น REST API ของระบบวางบิลร้านไวนิล</p>' +
    '<p style="color:#64748b;font-size:14px">หน้าใช้งานหลักเปิดผ่าน GitHub Pages</p>' +
    '</div></body></html>'
  );
}

/**
 * แผนที่ action → ฟังก์ชัน (dispatch route)
 */
var ACTION_MAP = {
  // auth + users
  'login': login,
  'changePassword': changePassword,
  'saveUser': saveUser,
  'listUsers': listUsers,
  'whoAmI': whoAmI,

  // setup / backup
  'setupAll': setupAll,
  'manualBackup': manualBackup,
  'setupBackupTrigger': setupBackupTrigger,
  'clearBackupTriggers': clearBackupTriggers,

  // customer
  'searchCustomers': customer_searchCustomers,
  'createCustomer': customer_createCustomer,
  'updateCustomer': customer_updateCustomer,
  'deleteCustomer': customer_deleteCustomer,

  // settings
  'getSettings': getSettings,
  'saveSettings': saveSettings,

  // order
  'createOrder': order_createOrder,
  'updateOrder': order_updateOrder,
  'getOrderDetail': order_getOrderDetail,
  'listOrders': order_listOrders,
  'changeOrderStatus': order_changeOrderStatus,
  'listDueOrders': order_listDueOrders,

  // document
  'issueDocument': doc_issueDocument,
  'printDocument': doc_printDocument,
  'getDocument': doc_getDocument,
  'listDocuments': doc_listDocuments,

  // payment
  'recordPayment': payment_recordPayment,

  // cancel
  'cancelOrder': cancel_cancelOrder,
  'cancelFromDocument': cancel_cancelFromDocument,

  // report / audit
  'getDashboard': report_getDashboard,
  'getAgingReport': report_getAgingReport,
  'listAuditLogs': audit_listAuditLogs,
  'listCancelLogs': audit_listCancelLogs,

  // lookup
  'getProducts': getProducts,
  'getConfig': getConfig
};

// ===== wrappers ที่รับ payload เดียว (dispatch ผ่าน ACTION_MAP) =====

function customer_searchCustomers(payload) { return searchCustomers(payload && payload.keyword); }
function customer_createCustomer(payload) { return createCustomer(payload); }
function customer_updateCustomer(payload) {
  return updateCustomer(payload && payload.id, payload);
}
function customer_deleteCustomer(payload) {
  return deleteCustomer(payload && payload.id, payload && payload.reason);
}

function order_createOrder(payload) { return createOrder(payload); }
function order_updateOrder(payload) { return updateOrder(payload && payload.id, payload); }
function order_getOrderDetail(payload) { return getOrderDetail(payload && payload.id); }
function order_listOrders(payload) { return listOrders(payload || {}); }
function order_changeOrderStatus(payload) {
  return changeOrderStatus(payload && payload.id, payload && payload.status, payload && payload.reason);
}
function order_listDueOrders(payload) { return listDueOrders(payload && payload.customer_id); }

function doc_issueDocument(payload) { return issueDocument(payload && payload.order_id, payload && payload.doc_type); }
function doc_printDocument(payload) { return printDocument(payload && payload.id); }
function doc_getDocument(payload) { return getDocument(payload && payload.id); }
function doc_listDocuments(payload) { return listDocuments(payload || {}); }

function payment_recordPayment(payload) { return recordPayment(payload); }

function cancel_cancelOrder(payload) { return cancelOrder(payload && payload.id, payload && payload.reason); }
function cancel_cancelFromDocument(payload) { return cancelFromDocument(payload && payload.id, payload && payload.reason); }

function report_getDashboard() { return getDashboard(); }
function report_getAgingReport() { return getAgingReport(); }
function audit_listAuditLogs(payload) { return listAuditLogs(payload || {}); }
function audit_listCancelLogs(payload) { return listCancelLogs(payload || {}); }

/**
 * ดึงรายการสินค้า (สำหรับหน้าใบสั่งจ้าง/คำนวณราคา)
 */
function getProducts(payload) {
  assertRole_();
  try {
    var rows = repoRows_(SH.PRODUCTS, false);
    return { ok: true, data: rows, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * ดึงค่าคงที่/เมตาดาต้าของระบบ (สถานะ, ประเภทเอกสาร, วิธีชำระ ฯลฯ)
 */
function getConfig(payload) {
  try {
    return {
      ok: true,
      data: {
        order_status: ORDER_STATUS,
        doc_types: DOC_TYPES,
        payment_methods: PAYMENT_METHODS,
        vat_modes: VAT_MODES,
        sale_modes: SALE_MODES,
        roles: ROLES
      },
      message: ''
    };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * doPost — รับ { action, payload, session } แล้ว dispatch
 */
function doPost(e) {
  var req = {};
  try {
    req = JSON.parse(e && e.postData && e.postData.contents);
  } catch (err) {
    return json_({ ok: false, data: null, message: 'JSON ไม่ถูกต้อง' });
  }

  var action = req.action;
  var payload = req.payload || {};

  // ตั้ง session (ผู้ใช้ปัจจุบัน) สำหรับคำขอนี้
  var session = req.session || payload.session || null;
  if (session && session.email) {
    setCurrentUser_({
      email: String(session.email).toLowerCase(),
      role: session.role || '',
      name: session.name || ''
    });
  }

  try {
    var handler = ACTION_MAP[action];
    var res;
    if (handler) {
      res = handler(payload);
    } else {
      res = { ok: false, data: null, message: 'ไม่รู้จัก action: ' + action };
    }
    // ตรวจให้เป็น { ok, data, message } เสมอ
    if (!res || typeof res !== 'object' || res.ok === undefined) {
      res = { ok: true, data: res, message: '' };
    }
    return json_(res);
  } catch (err) {
    return json_({ ok: false, data: null, message: err.message });
  } finally {
    setCurrentUser_(null); // ล้าง session หลังคำขอเสมอ
  }
}

/**
 * สร้าง JSON output สำหรับ REST
 */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
