# ระบบวางบิลร้านไวนิล (Vinyl Shop Billing System)

ระบบจัดการงานรับจ้างพิมพ์ไวนิล ครอบคลุมตั้งแต่ รับออเดอร์ → เสนอราคา → ส่งของ → วางบิล → รับชำระเงิน → ออกใบเสร็จ พร้อมระบบตรวจสอบย้อนหลัง (Audit Trail) ทุกการกระทำ

**Stack:** Google Apps Script (REST API) + Vanilla JS + SweetAlert2 + Google Sheets (DB) + GitHub Pages (หน้าเว็บ)
**สถาปัตยกรรม:** `index.html` (static บน GitHub Pages) เรียก GAS REST API ผ่าน `fetch` — ไม่ใช้ `google.script.run`
**ภาษาในระบบ:** ไทย 100% | **Timezone:** Asia/Bangkok | **สกุลเงิน:** THB

---

## ฟีเจอร์หลัก

- เข้าสู่ระบบ + ควบคุมสิทธิ์ (STAFF / MANAGER / ADMIN)
- บันทึกรายการสั่งจ้างไวนิล (คำนวณพื้นที่ตร.ม. + ราคาค้าส่ง/ค้าปลีกอัตโนมัติ)
- ออกเอกสาร QT / DO / BN / RC / TAX_INVOICE + snapshot ทุกครั้ง (RULE-06)
- รับชำระเงิน (เงินสด / โอน / เช็ค / บัตร / QR) — ออกใบเสร็จอัตโนมัติเมื่อจ่ายครบ
- พิมพ์เอกสารซ้ำได้ไม่จำกัด (RULE-07) + AuditLog
- การยกเลิกแบบ Cascade — VOID ทั้งสายเอกสารในทรานแซกชันเดียว (RULE-03)
- Dashboard ยอดขาย + รายงานอายุหนี้ + ตรวจสอบย้อนหลัง

---

## โครงสร้างโปรเจกต์

```
pro-nara/
├─ index.html              # SPA เดียว (GitHub Pages) — หน้าใช้งานหลัก
├─ apps-script/
│  ├─ appsscript.json      # REST scopes + webapp config
│  ├─ Config.gs            # ค่าคงที่ + helper + CURRENT_SESSION
│  ├─ Repo.gs              # CRUD กลาง อ่าน/เขียน Sheet + cache
│  ├─ Guard.gs             # assertRole_ / assertStatusPermitted_
│  ├─ Counter.gs           # nextDocNo_
│  ├─ Audit.gs             # writeAudit_
│  ├─ Auth.gs              # login / changePassword / saveUser / listUsers
│  ├─ Customer.gs  Order.gs  Document.gs  Payment.gs  Cancel.gs
│  ├─ Report.gs  Setup.gs  Backup.gs
│  └─ Api.gs               # doGet + doPost (REST dispatch)
├─ .clasp.json             # rootDir = apps-script
├─ .claspignore
├─ deploy.ps1              # push GitHub + clasp push + redeploy (URL คงเดิม)
├─ AGENTS.md
└─ README.md
```

### กลไก REST API

Client เรียก `fetch(API_URL, {method:'POST', body: JSON.stringify({action, payload, session})})`
เซิร์ฟเวอร์ `doPost` ตั้ง `CURRENT_SESSION` จาก `session.email` → dispatch ตาม `action` (ใน `ACTION_MAP` ของ `Api.gs`) → คืน `{ ok, data, message }`

---

## วิธีติดตั้ง (Installation)

### ข้อกำหนดเบื้องต้น

- บัญชี Google ที่มีสิทธิ์เข้าถึง Google Sheets / Drive
- Node.js (แนะนำ 18+) + clasp
- GitHub repo สำหรับโฮสต์หน้าเว็บ (`itman-ncc.github.io/pro-nara` ตัวอย่าง)

### ขั้นตอนที่ 1 — ติดตั้ง clasp

```bash
npm install -g @google/clasp
clasp login
```

### ขั้นตอนที่ 2 — Clone + ตั้งค่า

```bash
git clone https://github.com/itman-ncc/pro-nara.git
cd pro-nara
```

- Spreadsheet ID (DB): กำหนดใน `apps-script/Config.gs` (หรือ Script Property `SS_ID`)
- Folder ID (Backup): `BACKUP_FOLDER_ID` ใน `Config.gs`

### ขั้นตอนที่ 3 — Push ขึ้น Apps Script + Deploy

```bash
clasp push -f
clasp deploy   # พิมพ์ Web App URL ที่ได้ (executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS)
```

### ขั้นตอนที่ 4 — รัน Setup (ครั้งแรก)

เปิดโปรเจกต์ใน Apps Script (`clasp open`) → เลือกฟังก์ชัน `setupAll` → Run → อนุญาตสิทธิ์
ระบบจะสร้างชีตทั้งหมด (10 ชีต) + seed สินค้า/ลูกค้า/ผู้ใช้เริ่มต้น และเพิ่มคอลัมน์ `password`

### ขั้นตอนที่ 5 — ตั้งค่าหน้าเว็บบน GitHub Pages

1. เปิด **GitHub Pages** ของ repo (Settings → Pages → ตั้ง `main` / root)
2. แก้ `API_URL` ใน `index.html` (บรรทัดบนสุดของ script) ให้ชี้ไปที่ Web App URL ที่ deploy ในขั้นตอน 3
3. เข้าถึงระบบผ่าน URL ของ GitHub Pages เช่น `https://itman-ncc.github.io/pro-nara/`

### บัญชีเริ่มต้น (หลัง setup)

| บทบาท | อีเมล | รหัสผ่าน |
|---|---|---|
| ผู้ดูแลระบบ | `admin@pro-nara.com` | `admin123` |
| ผู้จัดการ | `manager@pro-nara.com` | `manager123` |
| พนักงาน | `staff@pro-nara.com` | `staff123` |

> ควรเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก (ผ่านเมนู ตั้งค่า → เปลี่ยนรหัสผ่าน)

---

## วิธี deploy (อัตโนมัติ)

เมื่อแก้โค้ดเสร็จ รันสคริปต์เดียว:

```bash
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

จะทำงาน: ตรวจสอบ syntax → commit + push GitHub → `clasp push` → สร้าง version → `clasp redeploy` (URL คงเดิม ไม่ต้องแก้ `index.html`)

---

## กฎธุรกิจสำคัญ (Business Rules)

- **RULE-01:** จุดล็อกเอกสาร — หลังออกใบเสร็จ (`RECEIPT`/`TAX_INVOICE` + ACTIVE) แก้ไขไม่ได้ ทำได้แค่ยกเลิก
- **RULE-02:** ตารางสิทธิ์ตามสถานะ — `DRAFT`–`BILLED` = STAFF+ แก้ไขได้; `PARTIAL_PAID`–`PAID` = แก้ไขไม่ได้, MANAGER+ ยกเลิกได้; `CANCELLED` = ทำอะไรไม่ได้
- **RULE-03:** Cascade cancel — ยกเลิกที่ใดก็ตาม VOID ทั้งสายในทรานแซกชันเดียว
- **RULE-04:** เหตุผลยกเลิกขั้นต่ำ 10 ตัวอักษร (ยกเว้น DRAFT)
- **RULE-05:** ห้าม hard delete — ใช้สถานะ `VOID` / `CANCELLED` เท่านั้น
- **RULE-06:** Snapshot ทุกเอกสาร — พิมพ์ซ้ำได้ผลลัพธ์เหมือนเดิม
- **RULE-07:** พิมพ์ซ้ำได้ไม่จำกัด + AuditLog + เอกสาร VOID มีลายน้ำ "ยกเลิก"
- ใช้ `LockService` ทุกฟังก์ชันเขียนข้อมูล เพื่อกันเลขเอกสารชน

---

## โครงสร้างฐานข้อมูล (Google Sheets)

| ชีต | คำอธิบาย |
|---|---|
| `Customers` | ลูกค้า (ค้าปลีก/ค้าส่ง, เครดิตรายวัน) |
| `Products` | สินค้า + ราคา 2 ระดับ (ขายปลีก/ขายส่ง) + min_area |
| `Orders` | ใบสั่งจ้าง (รวม total/paid/balance/สถานะ) |
| `OrderItems` | รายการในใบสั่งจ้าง (ตร.ม. ต่อบรรทัด) |
| `Documents` | เอกสาร QT/DO/BN/RC + `snapshot_json` |
| `Payments` | การรับชำระเงิน |
| `AuditLog` | Log การทำงาน (เก็บในไฟล์ `AUDIT_SS_ID` หรือไฟล์เดียวกับ DB) |
| `CancelLog` | ประวัติการยกเลิก cascade |
| `Counters` | เลขลำดับเอกสาร |
| `Users` | ผู้ใช้ + บทบาท + สถานะ + รหัสผ่าน |

**รูปแบบเลขที่เอกสาร:** `{PREFIX}-{YY พ.ศ. 2 หลัก}-{NNNN}` เช่น `OD-69-0125`

---

## การตั้งค่า CI/CD (GitHub Actions)

1. GitHub → Settings → Secrets → New repository secret
2. ตั้งชื่อ `CLASPRC_JSON` เนื้อหา = เนื้อหา `~/.clasprc.json` (หลัง `clasp login`)
3. Push ไป `main` → Workflow (`deploy.yml`) จะ deploy อัตโนมัติ

---

## การสำรองข้อมูล (Backup)

Trigger รายวันเวลา 02:00 สำรอง Spreadsheet เข้า Drive ผ่าน `Backup.gs`
- เปิด: `setupBackupTrigger` | ปิด: `clearBackupTriggers` | สั่งทันที: เมนู ตั้งค่า → สำรองข้อมูลตอนนี้

---

## License

MIT
