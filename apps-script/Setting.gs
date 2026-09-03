/**
 * Setting.gs
 * จัดการข้อมูลร้านค้า / ค่าคงที่ระบบ (ชีต Setting: key-value)
 */

var SETTING_DEFAULTS = {
  logoUrl: '',
  shopName: 'ร้านไวนิล',
  shopAddress: '',
  shopPhone: '',
  shopEmail: '',
  shopTaxId: '',
  managerName: '',
  signatoryName: '',
  vatRate: '7',
  pdfFolderName: 'ใบเสร็จร้านไวนิล',
  pdfFolderId: '',
  sampleImported: 'FALSE',
  ivClaimDays: '0',
  fiscalMode: 'NONE',
  fiscalStartMonth: '1',
  fiscalStartDay: '1'
};

var SETTING_CACHE_KEY = 'SETTING_CACHE';
var SETTING_CACHE_TTL = 300; // 5 นาที

function getSettings_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(SETTING_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }
  var settings = {};
  for (var k in SETTING_DEFAULTS) settings[k] = SETTING_DEFAULTS[k];
  try {
    var rows = repoRows_(SH.SETTING, true);
    for (var i = 0; i < rows.length; i++) {
      var key = String(rows[i].key || '').trim();
      if (key && SETTING_DEFAULTS.hasOwnProperty(key)) {
        settings[key] = String(rows[i].value || '');
      }
    }
  } catch (e) {
    // ชีต Setting ยังไม่มี — ใช้ค่า default
  }
  cache.put(SETTING_CACHE_KEY, JSON.stringify(settings), SETTING_CACHE_TTL);
  return settings;
}

function getSettings(payload) {
  assertRole_();
  try {
    var settings = getSettings_();
    return { ok: true, data: settings, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

function saveSettings(payload) {
  assertRole_('ADMIN');
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    payload = payload || {};
    var before = getSettings_();
    var changed = [];
    for (var k in SETTING_DEFAULTS) {
      if (payload.hasOwnProperty(k) && String(payload[k]) !== before[k]) {
        changed.push(k);
      }
    }
    if (changed.length === 0) {
      return { ok: true, data: before, message: 'ไม่มีข้อมูลเปลี่ยนแปลง' };
    }
    var sh = sh_(SH.SETTING);
    var existing = {};
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var key = String(rows[i][0] || '').trim();
      if (key) existing[key] = i + 1; // row number (1-based)
    }
    for (var j = 0; j < changed.length; j++) {
      var ck = changed[j];
      var val = String(payload[ck] != null ? payload[ck] : SETTING_DEFAULTS[ck]);
      if (existing[ck]) {
        sh.getRange(existing[ck], 2).setValue(val);
      } else {
        sh.appendRow([ck, val]);
      }
    }
    var merged = {};
    for (var mk in SETTING_DEFAULTS) merged[mk] = val = payload.hasOwnProperty(mk) ? String(payload[mk]) : before[mk];
    writeAudit_('UPDATE', 'Setting', null, null, before, merged, changed, 'แก้ไขตั้งค่าระบบ');
    // ล้าง cache
    CacheService.getScriptCache().remove(SETTING_CACHE_KEY);
    return { ok: true, data: merged, message: 'บันทึกตั้งค่าสำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function seedSettings() {
  try {
    var sh = sh_(SH.SETTING);
    var rows = sh.getDataRange().getValues();
    if (rows.length > 1) return 0;
    var count = 0;
    for (var k in SETTING_DEFAULTS) {
      sh.appendRow([k, SETTING_DEFAULTS[k]]);
      count++;
    }
    return count;
  } catch (e) {
    return 0;
  }
}
