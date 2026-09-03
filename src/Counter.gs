/**
 * Counter.gs
 * รันเลขที่เอกสารอัตโนมัติด้วย LockService กันเลขชน
 *
 * รูปแบบเลขที่: {PREFIX}-{YY พ.ศ. 2 หลัก}-{NNNN}
 * ตัวอย่าง: OD-69-0125 โดย YY มาจาก buddhistYY_() เช่น 2569 → '69'
 */

/**
 * สร้างเลขที่เอกสารใหม่ (เพิ่ม counter อัตโนมัติ)
 * @param {string} prefix ตัวย่อ เช่น 'OD', 'QT', 'DO', 'BN', 'RC', 'PM'
 * @returns {string} เลขที่เอกสาร เช่น 'OD-69-0125'
 */
function nextDocNo_(prefix) {
  // ครอบด้วย LockService เพื่อกันเลขชนเมื่อหลายคนใช้พร้อมกัน
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);

  try {
    var yy = buddhistYY_(); // ปี พ.ศ. 2 หลัก
    var key = prefix + '-' + yy; // เช่น 'OD-69'

    // หา key ที่มีอยู่แล้วในชีต Counters
    var counterRow = findBy_(SH.COUNTERS, 'key', key);

    var nextNo;
    if (counterRow) {
      // มี key อยู่แล้ว → เพิ่มเลขถัดไป และอัปเดตตาม _row
      nextNo = Number(counterRow.last_no) + 1;
      updateRow_(SH.COUNTERS, counterRow._row, { last_no: nextNo });
    } else {
      // ยังไม่มี key → สร้างใหม่เริ่มที่ 1
      nextNo = 1;
      insertRow_(SH.COUNTERS, { key: key, last_no: nextNo });
    }

    var padded = ('0000' + nextNo).slice(-4);
    return key + '-' + padded;
  } finally {
    lock.releaseLock();
  }
}
