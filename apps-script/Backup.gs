/**
 * Backup.gs
 * Trigger สำรองไฟล์รายวันเวลาประมาณ 02:00 เข้า Drive
 */

/**
 * ตั้งค่า time-driven trigger สำรองข้อมูลรายวันเวลา 02:00
 * เรียกครั้งเดียวหลัง Setup
 */
function setupBackupTrigger() {
  assertRole_('ADMIN');
  ScriptApp.newTrigger('doDailyBackup')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();
  writeAudit_('CREATE', 'System', 'BACKUP_TRIGGER', null, null, { hour: 2 }, ['hour'], 'ตั้งค่า Backup รายวัน 02:00');
  return { ok: true, data: null, message: 'ตั้งค่า Backup รายวันเวลา 02:00 สำเร็จ' };
}

/**
 * ลบ trigger สำรองข้อมูลเดิมทั้งหมด
 */
function clearBackupTriggers() {
  assertRole_('ADMIN');
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'doDailyBackup') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  writeAudit_('UPDATE', 'System', 'BACKUP_TRIGGER', null, null, { removed: removed }, ['removed'], 'ล้าง Backup trigger');
  return { ok: true, data: null, message: 'ล้าง Backup trigger เรียบร้อย (' + removed + ' ตัว)' };
}

/**
 * สำรองไฟล์ Spreadsheet ไปยัง Drive folder ที่กำหนด
 * ฟังก์ชันนี้รันจาก trigger เป็นหลัก (ไม่ใช้ public API)
 */
function doDailyBackup() {
  try {
    var folder = getBackupFolder_();
    var today = dateStr_();
    var source = DriveApp.getFileById(SPREADSHEET_ID);
    var copy = source.makeCopy('BACKUP_' + today + '_' + source.getName(), folder);
    Logger.log('Backup created: ' + copy.getId() + ' at ' + today);
    return true;
  } catch (e) {
    Logger.log('Backup failed: ' + e.message);
    return false;
  }
}

/**
 * เรียก manual backup ได้จาก Web App (ต้องการสิทธิ์พนักงานขึ้นไป)
 */
function manualBackup() {
  assertRole_();
  var ok = doDailyBackup();
  writeAudit_('CREATE', 'Backup', 'DAILY', null, null, { ok: ok }, ['ok'], 'สำรองข้อมูลด้วยตนเอง');
  return { ok: ok, data: null, message: ok ? 'สำรองข้อมูลสำเร็จ' : 'สำรองข้อมูลล้มเหลว' };
}

/**
 * หา/สร้างโฟลเดอร์สำรอง
 */
function getBackupFolder_() {
  var folder;
  try {
    folder = DriveApp.getFolderById(BACKUP_FOLDER_ID);
  } catch (e) {
    folder = DriveApp.createFolder('Vinyl_Billing_Backup');
  }
  return folder;
}
