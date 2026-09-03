# AGENTS.md

คำแนะนำสำหรับ AI agents ที่ทำงานในโปรเจกต์นี้

## โครงสร้างโปรเจกต์

```
pro-nara/
├─ index.html              # SPA เดียว (GitHub Pages) — หน้าใช้งานหลัก เรียก GAS REST API
├─ apps-script/
│  ├─ appsscript.json      # REST scopes + webapp config
│  ├─ Config.gs            # ค่าคงที่, helper ss_/sh_/now_/uid_/me_ + CURRENT_SESSION
│  ├─ Repo.gs              # CRUD กลาง อ่าน/เขียน Sheet + cache
│  ├─ Guard.gs             # assertRole_ / assertStatusPermitted_ / assertReason_
│  ├─ Counter.gs           # nextDocNo_
│  ├─ Audit.gs             # writeAudit_ / listAuditLogs
│  ├─ Auth.gs             # login / changePassword / saveUser / listUsers / whoAmI
│  ├─ Customer.gs          # ค้นหา/สร้าง/แก้ไขลูกค้า
│  ├─ Order.gs             # สร้าง/แก้ไข/คำนวณ ตร.ม./เปลี่ยนสถานะ
│  ├─ Document.gs          # ออก QT/DO/BN/RC + snapshot
│  ├─ Payment.gs           # รับชำระ + allocate + ออกใบเสร็จ
│  ├─ Cancel.gs            # cancelChain (cascade)
│  ├─ Report.gs            # dashboard, aging report
│  ├─ Setup.gs             # สร้างชีตทั้งหมดอัตโนมัติ + seed data
│  ├─ Backup.gs            # trigger สำรองไฟล์รายวัน
│  ├─ Test.gs              # ชุดทดสอบ (รันผ่าน runTestsAsAdmin)
│  └─ Api.gs               # doGet / doPost (REST dispatch ตาม ACTION_MAP)
├─ .github/workflows/deploy.yml
├─ .clasp.json             # rootDir = apps-script
├─ .claspignore
├─ deploy.ps1              # push GitHub + clasp push + redeploy (URL คงเดิม)
├─ AGENTS.md
└─ README.md
```

## สถาปัตยกรรม (REST API — สำคัญ)

- **หน้าเว็บ:** `index.html` static บน GitHub Pages — เรียก GAS ผ่าน `fetch`
- Client ส่ง `{ action, payload, session:{email} }` → Server `doPost` ตั้ง `CURRENT_SESSION` → dispatch ตาม `action` ใน `ACTION_MAP` (Api.gs) → คืน `{ ok, data, message }`
- **ทุก action ต้องมีใน `ACTION_MAP`** ก่อน client จะเรียกได้
- auth ทำผ่าน `Auth.gs` (login ด้วย email + password เก็บในตาราง Users คอลัมน์ password) — client เก็บ email ไว้ใน `localStorage` แล้วส่งทุกครั้งผ่าน `session()`
- เปิดหน้า GAS URL ตรงๆ ด้วย `doGet` จะได้ landing หน้า API เท่านั้น (ระบบหลักคือ GitHub Pages)

## Coding Convention (สำคัญ)

- **ภาษา backend:** JavaScript ES5-compatible (Apps Script V8) ในไฟล์ `.gs`
- **ภาษา client:** `index.html` ใช้ ES6+ (`async`/`await`, arrow) ได้ตามปกติ
- **ฟังก์ชัน private** ลงท้ายด้วย `_` (Apps Script จะไม่ expose ให้ client เรียก)
- **ฟังก์ชันธุรกิจ** ต้อง:
  1. เรียก `assertRole_()` ก่อนเสมอ (อ่านผู้ใช้จาก `CURRENT_SESSION` ผ่าน `me_()`)
  2. ครอบด้วย `LockService` ถ้ามีการเขียนข้อมูล
  3. return object รูปแบบ `{ ok: boolean, data: any, message: string }`
  4. throw `Error` พร้อมข้อความภาษาไทยที่ผู้ใช้อ่านเข้าใจ
- **ห้าม** เรียก `getDataRange()` ซ้ำๆ ใน loop — อ่านครั้งเดียวเก็บ array
- **ทุกฟังก์ชันเขียนข้อมูล** ต้องเรียก `writeAudit_()` เสมอ ไม่มีข้อยกเว้น
- **CSS:** ใช้ CSS variable, mobile-first, มีเทมเพลตพิมพ์ A4 (ใน `renderPrint`)
- **ฟอนต์ไทย:** Sarabun (Google Fonts) สำหรับเอกสารพิมพ์

## การตั้งค่า

- Spreadsheet ID: กำหนดใน `Config.gs` (หรือ Script Property `SS_ID`)
- Script ID: `1U9qqk-8g33KPcZkuPmyxuD625XVMnKns26YHSiextzKX_CJpAWo3oXKD` (ใน `.clasp.json`)
- Folder ID: `1Sg1AN_Rc6wcB2q7Ry9tAzjw1vjwviF7D`
- Deployment ID: `AKfycbxLoXZYwzNwfNCKtjcRafSMVAt-QCCEYHXs3NBDTVjpVGcrJSCTWmLmpWVFH0ijPx98` (ใช้ใน `deploy.ps1`)

## Deploy

- `powershell -ExecutionPolicy Bypass -File deploy.ps1` — ตรวจ syntax → push GitHub → `clasp push` → version → `clasp redeploy` (URL คงเดิม)
- หลัง setup ครั้งแรก: รัน `setupAll` ใน Apps Script editor

## กฎธุรกิจที่ต้องรักษาเสมอ

- RULE-01: จุดล็อกเอกสาร — ออกใบเสร็จแล้วแก้ไม่ได้
- RULE-02: ตารางสิทธิ์ตามสถานะ
- RULE-03: Cascade cancel — VOID ทั้งสายในทรานแซกชันเดียว
- RULE-04: เหตุผลยกเลิกขั้นต่ำ 10 ตัวอักษร
- RULE-05: ห้าม hard delete
- RULE-06: Snapshot ทุกเอกสาร
- RULE-07: พิมพ์ซ้ำได้ไม่จำกัด + AuditLog
- ใช้ `LockService` ทุกฟังก์ชันเขียนข้อมูลเพื่อกันเลขชน
