/**
 * Auth.gs
 * ระบบตรวจสอบสิทธิ์เข้าสู่ระบบ (login/logout) + จัดการคอลัมน์ password ในชีต Users
 *
 * ระบบเป็น REST API แบบ stateless: client เก็บ email ไว้ใน localStorage
 * แล้วส่ง { action, payload, session:{email} } มาทุกครั้ง
 * doPost จะตั้ง CURRENT_SESSION ให้ผู้ใช้ปัจจุบันก่อน dispatch action
 */

// คอลัมน์ของชีต Users (ต้องตรงกับตัวนี้—Auth.gs เป็นคนปรับ)
var USERS_FIELDS = ['email', 'name', 'role', 'is_active', 'password'];

// ผู้ใช้เริ่มต้น (bootstrap) — ระบบจะสร้างให้อัตโนมัติถ้ายังไม่มี
var DEFAULT_USERS = [
  { email: 'admin@pro-nara.com', name: 'ผู้ดูแลระบบ', role: 'ADMIN', is_active: 'TRUE', password: 'admin123' },
  { email: 'manager@pro-nara.com', name: 'ผู้จัดการ', role: 'MANAGER', is_active: 'TRUE', password: 'manager123' },
  { email: 'staff@pro-nara.com', name: 'พนักงาน', role: 'STAFF', is_active: 'TRUE', password: 'staff123' }
];

/**
 * ตรวจ/เพิ่มคอลัมน์ password ในชีต Users (ถ้ายังไม่มี)
 * seed รหัสผ่านเริ่มต้นให้ผู้ใช้เดิมที่ยังไม่มี password
 * และสร้างผู้ใช้เริ่มต้น (admin/manager/staff) ให้ถ้ายังไม่มี
 * เรียกจาก doLogin และ doPost ก่อนทำงานอื่นที่ต้อง auth
 * @returns {boolean} true ถ้าพร้อมใช้
 */
function ensureUsersSchema_() {
  var ss = ss_();
  var sh;
  try {
    sh = ss.getSheetByName(SH.USERS);
  } catch (e) {
    return false;
  }
  if (!sh) return false;

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var hasEmail = headers.indexOf('email') >= 0;
  if (!hasEmail) return false; // ยังไม่ได้ setup → ให้ setupAll จัดการ

  var hasPassword = headers.indexOf('password') >= 0;
  if (!hasPassword) {
    var pwdCol = sh.getLastColumn() + 1;
    sh.getRange(1, pwdCol).setValue('password');

    // seed รหัสผ่านเริ่มต้น = lower ชื่อจริง ให้ผู้ใช้เดิมที่ยังไม่มีรหัส
    var lastRow = sh.getLastRow();
    if (lastRow > 1) {
      var names = sh.getRange(2, 2, lastRow - 1, 1).getValues();
      var defaultPwd = [];
      for (var i = 0; i < names.length; i++) {
        defaultPwd.push([String(names[i][0] || '').toLowerCase() || '1234']);
      }
      sh.getRange(2, pwdCol, defaultPwd.length, 1).setValues(defaultPwd);
    }
  }

  // Bootstrap: สร้างผู้ใช้เริ่มต้นถ้ายังไม่มี (สำคัญสำหรับทำงานกับ DB เดิม)
  // ถ้ามีอยู่แล้วแต่ password ยังเป็นค่า fallback อัตโนมัติ (lower ชื่อ) → ตั้งเป็นค่า default ที่กำหนด
  var dataAll = sh.getDataRange().getValues();
  for (var d = 0; d < DEFAULT_USERS.length; d++) {
    var du = DEFAULT_USERS[d];
    var foundRow = -1;
    var foundPwd = '';
    for (var r2 = 1; r2 < dataAll.length; r2++) {
      if (String(dataAll[r2][0] || '').trim().toLowerCase() === du.email) {
        foundRow = r2;
        foundPwd = String(dataAll[r2][4] || '');
        break;
      }
    }
    if (foundRow < 0) {
      sh.appendRow([du.email, du.name, du.role, du.is_active, du.password]);
    } else {
      var fallback = String(du.name).toLowerCase();
      if (foundPwd === '' || foundPwd === fallback) {
        sh.getRange(foundRow + 1, 5).setValue(du.password);
      }
    }
  }

  return true;
}

/**
 * ตรวจสอบสิทธิ์เข้าสู่ระบบ (login)
 * @param {Object} payload { email, password }
 * @returns {{ok:boolean, data:Object, message:string}} data = { email, name, role }
 */
function login(payload) {
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  var password = String(payload.password || '');

  if (!email || !password) {
    return { ok: false, data: null, message: 'กรุณากรอกอีเมลและรหัสผ่าน' };
  }

  ensureUsersSchema_();

  var rows = repoRows_(SH.USERS, true);
  for (var i = 0; i < rows.length; i++) {
    var u = rows[i];
    if (String(u.email || '').trim().toLowerCase() !== email) continue;

    var sheetPwd = String(u.password || '');
    if (sheetPwd === '' && password === String(u.name || '').toLowerCase()) {
      sheetPwd = password; // รหัสเริ่มต้น = ชื่อ (รองรับกรณียังไม่ตั้ง)
    }

    if (sheetPwd !== password) {
      writeAudit_('LOGIN', 'Users', u.id || email, '', null, { action: 'FAIL', email: email }, [], 'เข้าสู่ระบบไม่สำเร็จ (รหัสผิด)');
      return { ok: false, data: null, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
    }

    if (String(u.is_active !== undefined ? u.is_active : 'TRUE') !== 'TRUE' && u.is_active !== true) {
      return { ok: false, data: null, message: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
    }

    var role = u.role || 'STAFF';
    writeAudit_('LOGIN', 'Users', u.id || email, '', null, { action: 'SUCCESS', email: email }, [], 'เข้าสู่ระบบสำเร็จ');
    return {
      ok: true,
      data: { email: email, name: u.name || '', role: role },
      message: 'เข้าสู่ระบบสำเร็จ'
    };
  }

  writeAudit_('LOGIN', 'Users', email, '', null, { action: 'FAIL', email: email }, [], 'เข้าสู่ระบบไม่สำเร็จ (ไม่พบผู้ใช้)');
  return { ok: false, data: null, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
}

/**
 * เปลี่ยนรหัสผ่านของผู้ใช้ปัจจุบัน (session)
 * @param {Object} payload { session:{email}, old_password, new_password }
 */
function changePassword(payload) {
  assertRole_();
  payload = payload || {};
  var email = String(payload.email || me_()).trim().toLowerCase();
  var oldPwd = String(payload.old_password || '');
  var newPwd = String(payload.new_password || '');

  if (newPwd.length < 4) {
    return { ok: false, data: null, message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัวอักษร' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var rows = repoRows_(SH.USERS, true);
    for (var i = 0; i < rows.length; i++) {
      var u = rows[i];
      if (String(u.email || '').trim().toLowerCase() !== email) continue;

      var currentPwd = String(u.password || '');
      if (currentPwd === '' && oldPwd === String(u.name || '').toLowerCase()) currentPwd = oldPwd;

      if (currentPwd !== oldPwd) {
        return { ok: false, data: null, message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
      }

      repoUpdate_(SH.USERS, u.id, { password: newPwd });
      writeAudit_('UPDATE', 'Users', u.id, '', null, { changed: 'password' }, ['password'], 'เปลี่ยนรหัสผ่าน');
      return { ok: true, data: null, message: 'เปลี่ยนรหัสผ่านสำเร็จ' };
    }
    return { ok: false, data: null, message: 'ไม่พบผู้ใช้' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * สร้าง/แก้ไขผู้ใช้ (ผู้ดูแลระบบเท่านั้น)
 * @param {Object} payload { email, name, role, is_active, password }
 */
function saveUser(payload) {
  assertRole_(ROLES.ADMIN);
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, data: null, message: 'กรุณากรอกอีเมล' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    ensureUsersSchema_();
    var existing = findBy_(SH.USERS, 'email', email);

    if (existing) {
      var patch = {};
      if (payload.name !== undefined) patch.name = payload.name;
      if (payload.role !== undefined) patch.role = payload.role;
      if (payload.is_active !== undefined) patch.is_active = payload.is_active;
      if (payload.password) patch.password = payload.password;
      if (!Object.keys(patch).length) {
        return { ok: true, data: existing, message: 'ไม่มีข้อมูลเปลี่ยนแปลง' };
      }
      repoUpdate_(SH.USERS, existing.id, patch);
      writeAudit_('UPDATE', 'Users', existing.id, '', null, patch, Object.keys(patch), 'แก้ไขผู้ใช้ ' + email);
      return { ok: true, data: null, message: 'แก้ไขผู้ใช้ ' + email + ' สำเร็จ' };
    }

    var user = {
      email: email,
      name: payload.name || email,
      role: payload.role || 'STAFF',
      is_active: payload.is_active !== undefined ? payload.is_active : 'TRUE',
      password: payload.password || email.split('@')[0]
    };
    repoInsert_(SH.USERS, user);
    writeAudit_('CREATE', 'Users', user.id, '', null, user, ['email', 'role'], 'สร้างผู้ใช้ ' + email);
    return { ok: true, data: null, message: 'สร้างผู้ใช้ ' + email + ' สำเร็จ' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * รายชื่อผู้ใช้ทั้งหมด (ผู้ดูแลระบบเท่านั้น)
 * @param {Object} payload { session }
 */
function listUsers(payload) {
  assertRole_(ROLES.ADMIN);
  try {
    ensureUsersSchema_();
    var rows = repoRows_(SH.USERS, false);
    var clean = rows.map(function (u) {
      return {
        email: u.email,
        name: u.name,
        role: u.role,
        is_active: u.is_active,
        has_password: !!u.password
      };
    });
    return { ok: true, data: clean, message: '' };
  } catch (e) {
    return { ok: false, data: null, message: e.message };
  }
}

/**
 * ตรวจสอบ session ปัจจุบัน (client ใช้เช็คว่ายังล็อกอินอยู่ไหม)
 * @param {Object} payload { email }
 */
function whoAmI(payload) {
  payload = payload || {};
  var email = String(payload.email || (payload.session && payload.session.email) || me_()).trim().toLowerCase();
  if (!email || email === 'anonymous') {
    return { ok: false, data: null, message: 'ยังไม่ได้เข้าสู่ระบบ' };
  }
  var user = findBy_(SH.USERS, 'email', email);
  if (!user) {
    return { ok: false, data: null, message: 'ไม่พบผู้ใช้' };
  }
  return {
    ok: true,
    data: { email: user.email, name: user.name, role: user.role, is_active: user.is_active },
    message: ''
  };
}


