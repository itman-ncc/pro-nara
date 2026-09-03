/**
 * Api.gs
 * entry point ของ Web App — doGet / include_ / Prisma
 */

/**
 * doGet — ส่งหน้า SPA กลับไป
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ระบบวางบิลร้านไวนิล')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * include_ — นำ Google Script Template ของไฟล์ HTML มาแทรก
 */
function include_(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

/**
 * สร้าง URL ของ Web App เพื่อใช้ฝังในหน้า
 */
function getScriptUrl_() {
  return ScriptApp.getService().getUrl();
}
