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
