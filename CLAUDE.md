@AGENTS.md

# Cecom Document System — Project Context

> อ่านไฟล์นี้ก่อนทำงานทุกครั้ง เพื่อไม่ต้องอาศัย conversation history
> อัปเดตล่าสุด: เมษายน 2569

---

## 1. ข้อมูลบริษัท (Static)

```
บริษัท ซีคอม ดับเบิ้ลพลัส จำกัด
Cecom Double Plus Co., Ltd.
ที่อยู่ : 888/103 ถนนสุขาภิบาล 5 แขวงออเงิน เขตสายไหม กรุงเทพมหานคร 10220
เลขประจำตัวผู้เสียภาษี : 0215555002082
สาขา : 00000
โลโก้ : /public/logo.png
```

ใน code: `src/lib/utils.ts` → `COMPANY` object

---

## 2. ภาพรวมระบบ

ระบบจัดการเอกสารธุรกิจ: รับ PO PDF จากลูกค้า → parse ข้อมูล → สร้างเอกสาร (BN/INV/REC/TAX) → บันทึกลง Google Sheets + Drive

Live URL: https://cecom-docs.vercel.app
Repo: https://github.com/Phupiwat/cecom-docs
Local: `/Users/mac/cecom-docs`

---

## 3. Tech Stack (Implemented)

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.2 (App Router, Turbopack) |
| Language | TypeScript strict |
| Styling | Tailwind CSS v4 |
| Auth | NextAuth v5 (beta.30) + Google OAuth |
| Database | Google Sheets API v4 (googleapis ^171) |
| File storage | Google Drive API |
| PDF generation | jsPDF ^4.2.1 (client-side) |
| PDF parsing | PDF.js 3.11.174 (CDN, client-side) |
| Deploy | Vercel (auto-deploy on git push) |

### ⚠️ Next.js 16 Breaking Changes

1. `middleware.ts` ถูก deprecated → ใช้ `src/proxy.ts` แทน, export เป็น `auth as proxy`
2. `params` เป็น Promise → `type Context = { params: Promise<{ id: string }> }` ทุก dynamic route
3. NextAuth route → ต้อง wrap handlers เป็น function ธรรมดา ไม่ใช่ export ตรง
4. `trustHost: true` → บังคับสำหรับ Vercel ใน `src/auth.ts`

---

## 4. โครงสร้างไฟล์

```
src/
├── auth.ts                          # NextAuth config + Google token auto-refresh
├── proxy.ts                         # Route protection middleware (Next.js 16)
├── types/next-auth.d.ts             # Session type (accessToken, error, expiresAt)
├── lib/
│   ├── types.ts                     # DocType, Document, LineItem, rowToDocument, documentToRow
│   └── utils.ts                     # formatDate, formatNumber, buildDocNo, COMPANY, generateId
└── app/
    ├── layout.tsx / globals.css / favicon.ico
    ├── page.tsx                     # Dashboard (stats + document list)
    ├── login/page.tsx               # Google sign-in page
    ├── documents/
    │   ├── new/page.tsx             # สร้างเอกสารใหม่ + นำเข้า PO PDF
    │   └── [id]/page.tsx           # ดูเอกสาร + เปลี่ยน status + สร้าง PDF
    └── api/
        ├── auth/[...nextauth]/route.ts  # NextAuth handler
        ├── counter/route.ts         # GET/POST running number (Counters sheet)
        ├── documents/route.ts       # GET all / POST new document
        ├── documents/[id]/route.ts  # GET one / PUT update document
        └── pdf/route.ts            # POST: upload base64 PDF to Google Drive
```

---

## 5. Google Services

| บริการ | ID |
|---|---|
| Spreadsheet | `1V5aAPWoNQrpY10HwnnWvFJ3ASQUfMXatBGzorfBf_sw` |
| Drive Folder | `1p04xv2rd2kuuFqifLzIaEHKkzf0LdLMv` |

### Google Sheets — Schema ปัจจุบัน

**Sheet "Documents"** (row 1 = header):
```
A=id | B=docNo | C=type | D=customer | E=date | F=dueDate |
G=subtotal | H=vat | I=grandTotal | J=status | K=createdBy |
L=items(JSON) | M=customerAddress | N=customerTaxId | O=notes | P=driveFileId
```

`items` เก็บเป็น JSON array ของ `LineItem[]` ใน column L

**Sheet "Counters"** (row 1 = header):
```
A=type | B=count
QT | 1 / SO | 1 / DO | 1 / BN | 1 / INV | 1 / REC | 1 / TAX | 1
```

### Google Sheets — Schema เป้าหมาย (ยังไม่ implement)

เป้าหมายระยะยาวคือแยก sheet ให้ชัดขึ้น:

**Customers**: customer_id, name_th, name_en, address, tax_id, branch_code

**Documents**: doc_id, doc_type, doc_number, doc_date, po_reference, customer_id, subtotal, vat, grand_total, payment_term, due_date, drive_file_id, status

**DocumentItems**: doc_id, line_no, item_code, description_th, description_en, qty, unit, unit_price, line_total

**RunningNumbers**: prefix, year (พ.ศ. 2 หลัก), last_number

---

## 6. ประเภทเอกสาร

| DocType | ชื่อไทย | ชื่ออังกฤษ | Prefix | หมายเหตุ |
|---|---|---|---|---|
| QT | ใบเสนอราคา | QUOTATION | QT | input จากฟอร์ม ไม่ได้มาจาก PO |
| SO | ใบสั่งขาย | SALES ORDER | SO | — |
| DO | ใบส่งของ | DELIVERY ORDER | DO | — |
| BN | ใบวางบิล | BILLING NOTE | BN | — |
| INV | ใบแจ้งหนี้ | INVOICE | INV | มี field "ครบกำหนด" |
| REC | ใบเสร็จรับเงิน | RECEIPT | REC | payment_term = "ชำระเงินแล้ว / Paid" |
| TAX | ใบกำกับภาษี | TAX INVOICE | INV | ใช้เลขเดียวกับ INV, ออก 2 สำเนา |

**รูปแบบเลขเอกสาร**: `{PREFIX}-{ปี พ.ศ. 2 หลักท้าย}-{running 4 หลัก}`
ตัวอย่าง: ปี 2569 → `BN-69-0001`

---

## 7. Environment Variables (Vercel)

```
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  → จาก Google Cloud Console
NEXTAUTH_SECRET                         → random string
NEXTAUTH_URL                            → https://cecom-docs.vercel.app
SPREADSHEET_ID                          → 1V5aAPWoNQrpY10HwnnWvFJ3ASQUfMXatBGzorfBf_sw
DRIVE_FOLDER_ID                         → 1p04xv2rd2kuuFqifLzIaEHKkzf0LdLMv
```

---

## 8. User Flow: PO → เอกสาร

```
[1] Upload PO PDF
        ↓
[2] Parse ด้วย PDF.js (client-side) → extractFromPDF() → parsePO()
    → ดึง fields ตาม PO Field Mapping (ดูข้อ 9)
        ↓
[3] Pre-fill Form ให้ตรวจ/แก้ไขข้อมูล
    - ข้อมูลลูกค้า (ชื่อ, ที่อยู่, เลขผู้เสียภาษี)
    - PO Reference, วันที่, ครบกำหนด
    - Items table (แก้ได้ทุก field)
        ↓
[4] เลือกประเภทเอกสาร (checkbox หลายประเภทพร้อมกันได้)
        ↓
[5] กด "บันทึก" / "บันทึกและส่ง"
    → generate docNo จาก Counters sheet
    → POST /api/documents → บันทึกลง Sheets
    → increment counter
    → navigate ไปหน้าเอกสาร
        ↓
[6] หน้าเอกสาร: ดู, เปลี่ยน status, สร้าง PDF (jsPDF)
```

---

## 9. PO Field Mapping

### Header ลูกค้า

| PO Field | Output Field | หมายเหตุ |
|---|---|---|
| ชื่อบรรทัด TH | `customer` (name_th) | เช่น "บริษัท กรีนไฟเบอร์ จำกัด" |
| ชื่อในวงเล็บ EN | `customer` ส่วน EN | เช่น "GREEN FIBER CO.,LTD." |
| ที่อยู่ | `customerAddress` | — |
| เลขผู้เสียภาษี | `customerTaxId` | 13 หลัก (ของลูกค้า ไม่ใช่ของ Cecom) |

### Meta เอกสาร

| PO Field | Output Field | หมายเหตุ |
|---|---|---|
| PO NUMBER | `notes` (อ้างอิง PO: ...) | เช่น "AAH260312160" |
| APPROVED DATE | `date` | format "DD Mon YYYY" → YYYY-MM-DD |
| DELIVERY DATE | `dueDate` | format "DD Mon YYYY" → YYYY-MM-DD |
| Payment Term | (แสดงใน notes) | เช่น "T/T 30 DAYS After Delivery" |

### Items (loop ทุกแถว)

| PO Field | Output Field | หมายเหตุ |
|---|---|---|
| รหัสสินค้า (Item Number) | (strip ออก ไม่เก็บแยก) | เช่น "11011811" — ปัจจุบัน strip ออกจาก description |
| รายละเอียด EN | `description` (ส่วนแรก) | เช่น "WEAR PLATE FOR HOT PRESS" |
| รายละเอียด TH | `description` (ต่อท้าย) | เช่น "แผ่นเหล็กเรียบรีดเย็น SPCC..." |
| จำนวน (Qt'y) | `qty` | — |
| หน่วยนับ (Unit) | `unit` | เช่น "EA" |
| ราคา/หน่วย | `unitPrice` | — |
| จำนวนเงินรวม | `amount` | verify: qty × unitPrice ≤ 5% error |

### Totals

| PO Field | Output Field |
|---|---|
| NET PRICE / Sub Total | `subtotal` |
| VAT N% | `vatRate` + `vatAmount` |
| GRAND TOTAL | `grandTotal` |

---

## 10. PO Parser Implementation

**ไฟล์:** `src/app/documents/new/page.tsx`

### extractFromPDF()
PDF.js แยก text cells ตาม X/Y coordinate → group เป็น rows (round Y ±2px) → sort top→bottom

### parsePO()
ดึง: taxId (13 หลัก), customer name, address, APPROVED DATE, DELIVERY DATE, PO ref, tax totals

### extractLineItemsFromRows()

**Strategy 1**: ใช้ header row columns (ถ้าเจอ qty/price header)

**Strategy 2**: Right-to-left scan (primary สำหรับ PO ภาษาอังกฤษ)
```
row[last]   = total (numeric)
row[last-1] = unitPrice (numeric)
row[last-2] = unit word ถ้าตรง UNIT_WORDS เช่น "EA" → cursor--
row[cursor] = qty (numeric) → cursor--
row[0..cursor] = description (strip leading pure-numeric cells: seq, item code)
```

**Continuation rows**: แถวที่ parse ไม่ได้ → append ต่อ description item ก่อนหน้า
ยกเว้น: `Delivery Date | Storeroom | หมายเหตุ | Remark`

### ตัวอย่าง PO จริง: Green Fiber PO AAH260312160

```
ลูกค้า:  บริษัท กรีนไฟเบอร์ จำกัด (GREEN FIBER CO.,LTD.)
ที่อยู่:  99 หมู่ 3 ต.เขาหินซ้อน อ.พนมสารคาม จ.ฉะเชิงเทรา 24120
เลขภาษี: 0105558105495
date:    2026-03-05  (APPROVED DATE: "05 Mar 2026")
dueDate: 2026-06-03  (DELIVERY DATE: "03 Jun 2026")
poRef:   AAH260312160
items:
  1. description="WEAR PLATE FOR HOT PRESS, แผ่นเหล็กเรียบรีดเย็น SPCC 1350X5760X2.00MM LINE2ตามแบบ"
     qty=70, unit=EA, unitPrice=14525, amount=1016750
  2. description="WEAR PLATE FOR HOT PRESS, แผ่นเหล็กเรียบรีดเย็น SPCC 1540X5160X2.00MM LINE1ตามแบบ"
     qty=100, unit=EA, unitPrice=14060, amount=1406000
subtotal=2422750, vatRate=7, vatAmount=169592.50, grandTotal=2592342.50
```

raw cell structure ต่อ item:
```
["1", "11011811", "WEAR PLATE... LINE2ตามแบบ", "70.00", "EA", "14,525.00", "1,016,750.00"]
  ↑ seq  ↑ item code (strip)  ↑ description           ↑qty  ↑unit ↑unitPrice  ↑total
```

---

## 11. Output Document Layout (A4)

```
┌─────────────────────────────────────────────────────────┐
│ [โลโก้]  บริษัท ซีคอม ดับเบิ้ลพลัส จำกัด              │ bold ใหญ่
│          Cecom Double Plus Co., Ltd.                    │ เล็ก
│          888/103 ถ.สุขาภิบาล 5 ...                     │
│          เลขผู้เสียภาษี : 0215555002082                 │
├────────────────────────────┬────────────────────────────┤
│                            │  [ชื่อเอกสาร TH ใหญ่]     │
│                            │  [ชื่อเอกสาร EN เล็ก]     │
│                            │  เลขที่ : BN-69-0001       │
│                            │  วันที่ : 31 มี.ค. 69      │
│                            │  อ้างอิง PO : AAH...       │
│                            │  ครบกำหนด : ... (INV only) │
│                            │  ต้นฉบับ/สำเนา (TAX only)  │
├────────────────────────────┴────────────────────────────┤
│ ลูกค้า : บริษัท กรีนไฟเบอร์ จำกัด                      │
│ ที่อยู่ : 99 หมู่ 3 ต.เขาหินซ้อน ...                   │
│ เลขผู้เสียภาษี : 0105558105495  สาขา: 000              │
├──┬────────┬─────────────────────────┬────┬───┬──────┬──────┤
│ลำ│รหัสสค.│ รายละเอียดสินค้า/บริการ  │จำนวน│หน่วย│ราคา/หน่วย│จำนวนเงิน│
├──┼────────┼─────────────────────────┼────┼───┼──────┼──────┤
│1 │11011811│ WEAR PLATE FOR HOT PRESS│ 70 │EA │14,525│1,016,750│
│  │        │ แผ่นเหล็กเรียบรีดเย็น...│    │   │      │      │
├──┴────────┴─────────────────────────┴────┴───┴──────┼──────┤
│                            มูลค่าก่อน VAT :          │2,422,750│
│                            ภาษีมูลค่าเพิ่ม 7% :      │  169,593│
│                            จำนวนเงินรวมทั้งสิ้น :    │2,592,343│
├──────────────────────────────────────────────────────┴──────┤
│ (สองล้านห้าแสนเก้าหมื่นสองพันสามร้อยสี่สิบสามบาทถ้วน)      │
│ เงื่อนไขการชำระเงิน : T/T 30 วัน หลังส่งมอบสินค้า         │
├─────────────────────────┬───────────────────────────────────┤
│  ผู้รับเงิน / Received  │  ผู้อนุมัติ / Authorized          │
│  ________________       │  ________________                 │
│  วันที่ .../.../...     │  วันที่ .../.../...               │
└─────────────────────────┴───────────────────────────────────┘
```

### Items Table Column Widths

| Col | Field | Width |
|---|---|---|
| A | ลำดับ | 30px |
| B | รหัสสินค้า | 80px |
| C | รายละเอียด | flex (ใหญ่สุด) |
| D | จำนวน | 50px |
| E | หน่วย | 45px |
| F | ราคา/หน่วย | 90px |
| G | จำนวนเงิน | 90px |

### Document-Specific Differences

| Field | BN | INV | REC | TAX |
|---|---|---|---|---|
| ชื่อ TH | ใบวางบิล | ใบแจ้งหนี้ | ใบเสร็จรับเงิน | ใบกำกับภาษี |
| ชื่อ EN | BILLING NOTE | INVOICE | RECEIPT | TAX INVOICE |
| Prefix | BN | INV | REC | INV (เลขเดียวกับ INV) |
| ครบกำหนด | ✗ | ✓ | ✗ | ✗ |
| ต้นฉบับ/สำเนา | ✗ | ✗ | ✗ | ✓ (2 copies) |
| payment_term | ปกติ | ปกติ | "ชำระเงินแล้ว / Paid" | ปกติ |

**การคำนวณ "ครบกำหนด" (INV)**: extract จำนวนวันจาก payment term → บวกกับ doc_date → ให้ user แก้ได้

---

## 12. Auth: Token Refresh

`src/auth.ts` จัดการ Google OAuth token อัตโนมัติ:
- เก็บ `expiresAt` ตอน login
- ทุก JWT callback ตรวจ expiry (buffer 60 s)
- ถ้าหมดอายุ → POST `https://oauth2.googleapis.com/token` ด้วย `refresh_token`
- ถ้า refresh ล้มเหลว → `token.error = "RefreshAccessTokenError"`
- API routes ตรวจ `session.error` → return 401 SessionExpired → frontend redirect `/login`

---

## 13. Known Issues & Decisions

| Issue | Resolution |
|---|---|
| Thai tone mark overlap (วรรณยุกต์ซ้อน) ใน PDF | Target: ใช้ MitrP font (patched OS/2 metrics) + TOPPADDING=6 — ยังไม่ implement ใน jsPDF |
| ตัวเลขยาวหลุดคอลัมน์ | กำหนด column width ตายตัว (ดูข้อ 11) |
| TAX ใช้เลขเดียวกับ INV | ไม่ increment counter แยก ดึงเลข INV ล่าสุดมาใช้ |
| item_code แยกเป็น field | ปัจจุบัน strip ออก ยังไม่เก็บแยก — เป้าหมายเก็บใน DocumentItems.item_code |
| description_th / description_en แยก field | ปัจจุบัน combine ใน `description` เดียว — เป้าหมายแยกใน schema ใหม่ |

---

## 14. Backlog

- [ ] แยก `description_th` / `description_en` / `item_code` ใน LineItem
- [ ] ย้ายไปใช้ schema ใหม่ (Customers + DocumentItems + RunningNumbers sheets)
- [ ] PDF ที่ถูกต้อง: ใช้ MitrP font สำหรับ Thai, Google Sans สำหรับ Latin/ตัวเลข
- [ ] PDF preview ในหน้าเว็บ (iframe)
- [ ] Download ทั้งชุดเป็น ZIP
- [ ] ใบกำกับภาษี: generate 2 สำเนา (ต้นฉบับ + สำเนา) ใน PDF เดียว
- [ ] Error handling ใน `PUT /api/documents/[id]` (ยังไม่มี try/catch)
- [ ] Validate grandTotal จาก PO กับ computed value จาก items

---

## 15. วิธี Deploy

```bash
cd /Users/mac/cecom-docs
git add -A
git commit -m "message"
git push origin main
# Vercel auto-deploys ทันที
```

## 16. แนวทางประหยัด Token

- เริ่ม conversation ใหม่ทุกครั้ง — Claude อ่าน CLAUDE.md นี้แล้วรู้ context ทั้งหมด
- ถามทีละ task ที่ชัดเจน เช่น "แก้ X ใน Y ตาม spec ใน CLAUDE.md"
- ไม่ต้องส่งรูปหรืออธิบาย background ซ้ำ
