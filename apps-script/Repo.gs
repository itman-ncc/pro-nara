/**
 * Repo.gs
 * CRUD กลางสำหรับอ่าน/เขียนชีตฐานข้อมูล
 *
 * - อ่านข้อมูลทั้งหมดครั้งเดียวในแต่ละครั้ง ไม่เรียก getDataRange ซ้ำใน loop
 * - cache header map ผ่าน CacheService อายุ 300 วินาที
 * - RULE-05: ห้ามมีฟังก์ชัน delete ใดๆ ทั้งสิ้น
 */

var HEADER_CACHE_TTL = 300; // วินาที

// per-request cache สำหรับ readAll_() — อ่านซ้ำใน request เดียวกันไม่ต้องอ่านชีตใหม่
// ตัวแปร module ถูกสร้างใหม่ทุก HTTP request จึงปลอดภัย
var _READ_ALL_CACHE = {};

/**
 * อ่าน header ของชีต (พร้อม cache 300 วินาที)
 * @param {string} sheetName ชื่อชีต
 * @returns {Array<string>} array ของชื่อคอลัมน์
 */
function readHeaders_(sheetName) {
  var cacheKey = 'hdr_' + sheetName;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // ข้อมูล cache เสีย ให้อ่านใหม่
    }
  }

  var sh = sh_(sheetName);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  try {
    cache.put(cacheKey, JSON.stringify(headers), HEADER_CACHE_TTL);
  } catch (e) {
    // cache ไม่ควรทำให้ล่ม
  }
  return headers;
}

/**
 * อ่านทุกแถวในชีต แล้วแปลงเป็น array ของ object โดยใช้แถว 1 (header) เป็น key
 * แต่ละ object จะแนบไฟล์ _row เก็บเลขแถวจริงในชีต (1-based) ไว้สำหรับอัปเดต
 * อ่าน data range แค่ครั้งเดียว ไม่ใช่ใน loop
 * @param {string} sheetName ชื่อชีต
 * @returns {Array<Object>} array ของ object (แถวข้อมูล ไม่รวม header)
 */
function readAll_(sheetName) {
  if (_READ_ALL_CACHE[sheetName]) return _READ_ALL_CACHE[sheetName];

  var sh = sh_(sheetName);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) { _READ_ALL_CACHE[sheetName] = []; return []; }

  var headers = readHeaders_(sheetName);
  var data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();

  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var obj = { _row: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  _READ_ALL_CACHE[sheetName] = rows;
  return rows;
}

/**
 * ล้าง per-request cache ของ readAll_() — เรียกหลังเขียนข้อมูลเพื่อกัน stale
 * @param {string} [sheetName] ชื่อชีตที่ต้องการล้าง (ละเว้น = ล้างทั้งหมด)
 */
function flushReadCache_(sheetName) {
  if (sheetName) { delete _READ_ALL_CACHE[sheetName]; }
  else { _READ_ALL_CACHE = {}; }
}

/**
 * ค้นหาวัตถุแรกที่ field == value (ใช้ค่าแรกที่เจอ)
 * @param {string} sheetName ชื่อชีต
 * @param {string} field ชื่อคอลัมน์
 * @param {*} value ค่าที่ต้องการค้น
 * @returns {Object|null} object ที่พบ หรือ null ถ้าไม่พบ
 */
function findBy_(sheetName, field, value) {
  var rows = readAll_(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) return rows[i];
  }
  return null;
}

/**
 * กรองแถวตามฟังก์ชันเงื่อนไข (predicate)
 * @param {string} sheetName ชื่อชีต
 * @param {Function} predicateFn ฟังก์ชันคืน boolean โดยรับ object แต่ละแถว
 * @returns {Array<Object>} array ของ object ที่ผ่านเงื่อนไข
 */
function filterBy_(sheetName, predicateFn) {
  var rows = readAll_(sheetName);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (predicateFn(rows[i])) out.push(rows[i]);
  }
  return out;
}

/**
 * เพิ่มแถวใหม่ลงชีต โดยเขียนตาม header จริง (เรียงตามคอลัมน์ในชีต ไม่ยึดลำดับ object)
 * @param {string} sheetName ชื่อชีต
 * @param {Object} obj ข้อมูลแถว (key ตรงกับ header)
 * @returns {string} id ของแถวที่สร้างขึ้น (สร้าง UUID ให้ถ้าไม่มี)
 */
function insertRow_(sheetName, obj) {
  var headers = readHeaders_(sheetName);
  if (!obj.id) obj.id = uid_();

  var values = [];
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    values.push(obj[h] !== undefined ? obj[h] : '');
  }

  sh_(sheetName).appendRow(values);
  flushReadCache_(sheetName);
  return obj.id;
}

/**
 * อัปเดตเฉพาะคอลัมน์ที่อยู่ใน patchObj ของแถวที่ rowNum ระบุ
 * อ่านเฉพาะแถวนั้นมา patch แล้วเขียนกลับทั้งแถวแบบ setValues ครั้งเดียว (batch)
 * @param {string} sheetName ชื่อชีต
 * @param {number} rowNum เลขแถว (1-based) ที่ต้องการอัปเดต
 * @param {Object} patchObj object ที่มีเฉพาะคอลัมน์ที่ต้องการเปลี่ยนแปลง
 */
function updateRow_(sheetName, rowNum, patchObj) {
  var headers = readHeaders_(sheetName);
  var sh = sh_(sheetName);

  // อ่านแถวป้อนจ่ายค่าปัจจุบันมาเป็น base
  var row = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];

  // patch เฉพาะคอลัมน์ที่ส่งมา
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (patchObj[h] !== undefined) {
      row[j] = patchObj[h];
    }
  }

  // เขียนกลับทั้งแถวแบบ batch (setValues ครั้งเดียว)
  sh.getRange(rowNum, 1, 1, headers.length).setValues([row]);
  flushReadCache_(sheetName);
}

// =========================================================================
// Backward-compat adapters
// ฟังก์ชันต่อไปนี้ map API เดิมของไฟล์ Phase 2-3 (repoRows_, repoFindById_,
// repoUpdate_, repoInsert_) ไปยัง API ใหม่ (readAll_/findBy_/updateRow_/insertRow_)
// เพื่อให้ Web App ยังทำงานได้โดยไม่ต้องแก้ไฟล์ Phase 2-3 ในตอนนี้
// =========================================================================

/**
 * (compat) อ่านทุกแถวเป็น array ของ object (เทียบเท่า readAll_)
 * @param {string} sheetName ชื่อชีต
 * @param {boolean} fresh (ละเว้น — API ใหม่ไม่มี cache ตอนนี้อ่านสดเสมอ)
 * @returns {Array<Object>}
 */
function repoRows_(sheetName, fresh) {
  return readAll_(sheetName);
}

/**
 * (compat) ค้นหา object ตาม id
 * @param {string} sheetName ชื่อชีต
 * @param {string} id ค่า id
 * @param {boolean} fresh (ละเว้น)
 * @returns {Object|null}
 */
function repoFindById_(sheetName, id, fresh) {
  return findBy_(sheetName, 'id', id);
}

/**
 * (compat) เพิ่มแถวใหม่ (เทียบเท่า insertRow_)
 * @param {string} sheetName ชื่อชีต
 * @param {Object} obj ข้อมูลแถว
 * @returns {string} id ที่สร้าง
 */
function repoInsert_(sheetName, obj) {
  return insertRow_(sheetName, obj);
}

/**
 * (compat) อัปเดตแถวตาม id
 * @param {string} sheetName ชื่อชีต
 * @param {string} id ค่า id ของแถวที่ต้องการอัปเดต
 * @param {Object} patchObj ข้อมูลคอลัมน์ที่ต้องการเปลี่ยน
 * @returns {boolean} true ถ้าอัปเดตสำเร็จ, false ถ้าไม่พบ id
 */
function repoUpdate_(sheetName, id, patchObj) {
  var row = findBy_(sheetName, 'id', id);
  if (!row || !row._row) return false;
  updateRow_(sheetName, row._row, patchObj);
  return true;
}

/**
 * (compat) อ่าน header ของชีต (เทียบเท่า readHeaders_)
 * @param {string} sheetName ชื่อชีต
 * @returns {Array<string>}
 */
function repoHeaders_(sheetName) {
  return readHeaders_(sheetName);
}
