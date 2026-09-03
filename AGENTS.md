# AGENTS.md

คำแนะนำสำหรับ AI agents ที่ทำงานในโปรเจกต์นี้

## โครงสร้างโปรเจกต์

```
vinyl-billing/
├─ src/
│  ├─ appsscript.json
│  ├─ Config.gs          # ค่าคงที่, helper ss_/sh_/now_/uid_/me_
│  ├─ Repo.gs            # CRUD กลาง อ่าน/เขียน Sheet + cache
│  ├─ Guard.gs           # assertEditable_ / assertRole_ / assertReason_
│  ├─ Counter.gs         # nextDocNo_
│  ├─ Audit.gs           # writeAudit_ / logPrint
│  ├─ Customer.gs        # ค้นหา/สร้าง/แก้ไขลูกค้า
│  ├─ Order.gs           # สร้าง/แก้ไข/คำนวณ ตร.ม./เปลี่ยนสถานะ
│  ├─ Document.gs        # ออก QT/DO/BN/RC + snapshot
│  ├─ Payment.gs         # รับชำระ + allocate + ออกใบเสร็จ
│  ├─ Cancel.gs          # cancelChain (cascade)
│  ├─ Report.gs          # dashboard, aging report
│  ├─ Setup.gs           # สร้างชีตทั้งหมดอัตโนมัติ + seed data
│  ├─ Backup.gs          # trigger สำรองไฟล์รายวัน
│  ├─ Api.gs             # doGet / include_ / entry point
│  ├─ Index.html         # SPA shell
│  ├─ Style.html         # CSS ทั้งหมด
│  ├─ Script.html        # JS ฝั่ง client
│  ├─ P_Order.html       # หน้าใบสั่งจ้าง
│  ├─ P_Billing.html     # หน้าวางบิล
│  ├─ P_Payment.html     # หน้ารับชำระ
│  ├─ P_Audit.html       # หน้าตรวจสอบ log
│  ├─ M_Cancel.html      # modal ยกเลิก
│  ├─ T_Quotation.html   # เทมเพลตพิมพ์ A4
│  ├─ T_Billing.html
│  └─ T_Receipt.html
├─ .github/workflows/deploy.yml
├─ .clasp.json
├─ .claspignore
├─ AGENTS.md
└─ README.md
```

## Coding Convention (สำคัญ)

- **ภาษา:** JavaScript ES5-compatible (Apps Script V8)
- **ฟังก์ชัน private** ลงท้ายด้วย `_` (Apps Script จะไม่ expose ให้ client เรียก)
- **ฟังก์ชัน public** (เรียกจาก `google.script.run`) ต้อง:
  1. เรียก `assertRole_()` ก่อนเสมอ
  2. ครอบด้วย `LockService` ถ้ามีการเขียนข้อมูล
  3. return object รูปแบบ `{ ok: boolean, data: any, message: string }`
  4. throw `Error` พร้อมข้อความภาษาไทยที่ผู้ใช้อ่านเข้าใจ
- **ห้าม** เรียก `getDataRange()` ซ้ำๆ ใน loop — อ่านครั้งเดียวเก็บ array
- **ทุกฟังก์ชันเขียนข้อมูล** ต้องเรียก `writeAudit_()` เสมอ ไม่มีข้อยกเว้น
- **CSS:** ใช้ CSS variable, mobile-first, มี `@media print` สำหรับเทมเพลต A4
- **ฟอนต์ไทย:** Sarabun (Google Fonts) สำหรับเอกสารพิมพ์

## การตั้งค่า

- Spreadsheet ID: กำหนดใน `Config.gs`
- Script ID: `1U9qqk-8g33KPcZkuPmyxuD625XVMnKns26YHSiextzKX_CJpAWo3oXKD` (ใน `.clasp.json`)
- Folder ID: `1Sg1AN_Rc6wcB2q7Ry9tAzjw1vjwviF7D`

## กฎธุรกิจที่ต้องรักษาเสมอ

- RULE-01: จุดล็อกเอกสาร — ออกใบเสร็จแล้วแก้ไม่ได้
- RULE-02: ตารางสิทธิ์ตามสถานะ
- RULE-03: Cascade cancel — VOID ทั้งสายในทรานแซกชันเดียว
- RULE-04: เหตุผลยกเลิกขั้นต่ำ 10 ตัวอักษร
- RULE-05: ห้าม hard delete
- RULE-06: Snapshot ทุกเอกสาร
- RULE-07: พิมพ์ซ้ำได้ไม่จำกัด + AuditLog
- ใช้ `LockService` ทุกฟังก์ชันเขียนข้อมูลเพื่อกันเลขชน
