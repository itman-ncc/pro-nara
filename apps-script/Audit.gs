/**
 * Audit.gs
 * ระบบบันทึกการทำงาน (Audit Trail) + log การพิมพ์
 *
 * action: CREATE | UPDATE | STATUS_CHANGE | ISSUE_DOC | PAYMENT | VOID | CANCEL | PRINT | LOGIN
 */

/**
 * เขียน AuditLog
 * @param {string} action action
 * @param {string} entity ชื่อชีต/เอนทิตี้ เช่น 'Orders'
 * @param {string} entityId id ของเอนทิตี้
 * @param {string} docNo เลขที่เอกสาร (ถ้ามี)
 * @param {Object|string|null} before ก่อนแก้
 * @param {Object|string|null} after หลังแก้
 * @param {Array} changedFields รายการฟิลด์ที่เปลี่ยน
 * @param {string} reason เหตุผล
 * @param {string} batchId กลุ่มเดียวกัน
 */
function writeAudit_(action, entity, entityId, docNo, before, after, changedFields, reason, batchId) {
  var audit = {
    id: uid_(),
    ts: nowIso_(),
    user_email: me_(),
    action: action,
    entity: entity,
    entity_id: entityId || '',
    doc_no: docNo || '',
    before_json: before !== undefined && before !== null ? JSON.stringify(before) : '',
    after_json: after !== undefined && after !== null ? JSON.stringify(after) : '',
    changed_fields: changedFields && changedFields.length ? JSON.stringify(changedFields) : '',
    reason: reason || '',
    batch_id: batchId || ''
  };

  var auditSs = SpreadsheetApp.openById(AUDIT_SPREADSHEET_ID);
  var sh = auditSs.getSheetByName('AuditLog');
  if (!sh) {
    sh = auditSs.insertSheet('AuditLog');
    sh.appendRow(['id', 'ts', 'user_email', 'action', 'entity', 'entity_id', 'doc_no',
      'before_json', 'after_json', 'changed_fields', 'reason', 'batch_id']);
  }
  sh.appendRow([
    audit.id, audit.ts, audit.user_email, audit.action, audit.entity, audit.entity_id,
    audit.doc_no, audit.before_json, audit.after_json, audit.changed_fields,
    audit.reason, audit.batch_id
  ]);
}

/**
 * log เหตุการณ์พิมพ์เอกสาร (RULE-07)
 * @param {Object} doc เอกสารที่พิมพ์
 */
function logPrint(doc) {
  writeAudit_('PRINT', 'Documents', doc.id, doc.doc_no, null,
    { print_count: doc.print_count }, ['print_count'], 'พิมพ์เอกสาร');
}

/**
 * ดึงประวัติการทำงาน (AuditLog) ล่าสุด — สำหรับหน้า "ตรวจสอบย้อนหลัง"
 * @param {Object} opts { limit, action, entity, keyword, from_date, to_date }
 * @returns {{ok:boolean, data:Array, message:string}}
 */
function listAuditLogs(opts) {
  assertRole_();
  try {
    opts = opts || {};
    var limit = Math.min(Number(opts.limit) || 100, 500);

    var auditSs = auditSS_();
    var sh = auditSs.getSheetByName(SH.AUDIT_LOG);
    var logs = [];
    if (sh) {
      var lastRow = sh.getLastRow();
      if (lastRow > 1) {
        var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
        for (var i = 0; i < values.length; i++) {
          var row = {};
          for (var j = 0; j < headers.length; j++) row[headers[j]] = values[i][j];
          logs.push(row);
        }
      }
    }

    // กรอง
    logs = logs.filter(function (l) {
      if (opts.action && String(l.action) !== String(opts.action)) return false;
      if (opts.entity && String(l.entity) !== String(opts.entity)) return false;
      if (opts.keyword) {
        var hay = String(l.doc_no) + ' ' + String(l.user_email) + ' ' + String(l.reason);
        if (hay.toLowerCase().indexOf(String(opts.keyword).toLowerCase()) < 0) return false;
      }
      if (opts.from_date && String(l.ts).slice(0, 10) < opts.from_date) return false;
      if (opts.to_date && String(l.ts).slice(0, 10) > opts.to_date) return false;
      return true;
    });

    logs.reverse(); // ใหม่สุดก่อน
    logs = logs.slice(0, limit);

    // เปลี่ยน JSON field ให้อ่านง่าย
    for (var k = 0; k < logs.length; k++) {
      if (logs[k].changed_fields) {
        try { logs[k].changed_fields_arr = JSON.parse(logs[k].changed_fields); } catch (e) { logs[k].changed_fields_arr = []; }
      }
    }

    return { ok: true, data: logs, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * ดึงประวัติการยกเลิกแบบ cascade (CancelLog) ล่าสุด
 * @param {Object} opts { limit, keyword }
 * @returns {{ok:boolean, data:Array, message:string}}
 */
function listCancelLogs(opts) {
  assertRole_();
  try {
    opts = opts || {};
    var limit = Math.min(Number(opts.limit) || 50, 300);
    var all = repoRows_(SH.CANCEL_LOG, false);

    all = all.filter(function (l) {
      if (opts.keyword) {
        var hay = String(l.root_doc_no) + ' ' + String(l.trigger_doc_no) + ' ' + String(l.reason);
        if (hay.toLowerCase().indexOf(String(opts.keyword).toLowerCase()) < 0) return false;
      }
      return true;
    });

    all.reverse();
    all = all.slice(0, limit);

    for (var i = 0; i < all.length; i++) {
      if (all[i].affected_docs_json) {
        try { all[i].affected_docs = JSON.parse(all[i].affected_docs_json); } catch (e) { all[i].affected_docs = []; }
      }
    }

    return { ok: true, data: all, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}
