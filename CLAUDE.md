@AGENTS.md

# Cecom Document System — Project Context

> อ่านไฟล์นี้ก่อนทำงานทุกครั้ง เพื่อไม่ต้องอาศัย conversation history

## ภาพรวม

ระบบจัดการเอกสารธุรกิจของ **บริษัท ซีคอม ดับเบิ้ลพลัส จำกัด**
Live URL: https://cecom-docs.vercel.app
Repo: https://github.com/Phupiwat/cecom-docs
Local: `/Users/mac/cecom-docs`

## Tech Stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| Framework | Next.js 16.2.2 (App Router, Turbopack) |
| Auth | NextAuth v5 (beta.30) + Google OAuth |
| Database | Google Sheets API v4 (googleapis ^171) |
| File storage | Google Drive API |
| PDF generation | jsPDF ^4.2.1 (client-side) |
| PDF parsing | PDF.js 3.11.174 (CDN, client-side) |
| Styling | Tailwind CSS v4 |
| Language | TypeScript strict |
| Deploy | Vercel (auto-deploy on git push) |

## ⚠️ Next.js 16 Breaking Changes (สำคัญมาก)

1. **`middleware.ts` ถูก deprecated** → ใช้ `src/proxy.ts` แทน, export เป็น `auth as proxy`
2. **`params` เป็น Promise** → `type Context = { params: Promise<{ id: string }> }` ทุก dynamic route
3. **NextAuth route** → ต้อง wrap handlers เป็น function ธรรมดา ไม่ใช่ export ตรง
4. **`trustHost: true`** → บังคับสำหรับ Vercel ใน `src/auth.ts`

## โครงสร้างไฟล์

```
src/
├── auth.ts                          # NextAuth config (Google OAuth + token callbacks)
├── proxy.ts                         # Route protection middleware (Next.js 16 style)
├── types/next-auth.d.ts             # Session type extension (accessToken)
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
        ├── auth/[...nextauth]/route.ts  # NextAuth handler (wrapped for Next.js 16)
        ├── counter/route.ts         # GET/POST running number (Counters sheet)
        ├── documents/route.ts       # GET all / POST new document
        ├── documents/[id]/route.ts  # GET one / PUT update document
        └── pdf/route.ts            # POST: upload base64 PDF to Google Drive
```

## Google Services

| บริการ | ID |
|--------|-----|
| Spreadsheet | `1V5aAPWoNQrpY10HwnnWvFJ3ASQUfMXatBGzorfBf_sw` |
| Drive Folder | `1p04xv2rd2kuuFqifLzIaEHKkzf0LdLMv` |

### Google Sheets Structure

**Sheet "Documents"** (row 1 = header):
```
A=id | B=docNo | C=type | D=customer | E=date | F=dueDate |
G=subtotal | H=vat | I=grandTotal | J=status | K=createdBy |
L=items(JSON) | M=customerAddress | N=customerTaxId | O=notes | P=driveFileId
```

**Sheet "Counters"** (row 1 = header):
```
A=type | B=count
QT | 1
SO | 1
DO | 1
BN | 1
INV | 1
REC | 1
TAX | 1
```

## ประเภทเอกสาร (DocType) และ Group

```
เอกสารขาย:    QT = ใบเสนอราคา
เอกสารซื้อ:   SO = ใบสั่งขาย (Sales Order)
เอกสารบัญชี: DO = ใบส่งของ, BN = ใบวางบิล, INV = ใบแจ้งหนี้,
              REC = ใบเสร็จรับเงิน, TAX = ใบกำกับภาษี
```

## Environment Variables (Vercel)

```
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  → จาก Google Cloud Console
NEXTAUTH_SECRET                         → random string
NEXTAUTH_URL                            → https://cecom-docs.vercel.app
SPREADSHEET_ID                          → 1V5aAPWoNQrpY10HwnnWvFJ3ASQUfMXatBGzorfBf_sw
DRIVE_FOLDER_ID                         → 1p04xv2rd2kuuFqifLzIaEHKkzf0LdLMv
```

## ข้อมูลบริษัท Cecom (ใน src/lib/utils.ts COMPANY)

```
name:    บริษัท ซีคอม ดับเบิ้ลพลัส จำกัด
nameEn:  Cecom Double Plus Co., Ltd.
address: 888/103 ถนนสุขาภิบาล 5 แขวงออเงิน เขตสายไหม กรุงเทพมหานคร 10220
taxId:   0215555002082
สาขา:   00000
```

## Feature: นำเข้า PO PDF → สร้างเอกสาร

**ไฟล์:** `src/app/documents/new/page.tsx` (Client Component, "use client")

Flow: อัปโหลด PDF → PDF.js แยก text ตาม X/Y → parser ดึง fields → pre-fill form → เลือก doc type (checkbox) → save ทีเดียวได้หลาย type

### ตัวอย่าง PO จริงที่ใช้ทดสอบ: Green Fiber PO AAH260312160

**ข้อมูลที่ต้องดึงได้:**
```
ลูกค้า:  บริษัท กรีนไฟเบอร์ จำกัด (GREEN FIBER CO.,LTD.)
ที่อยู่:  99 หมู่ 3 ต.เขาหินซ้อน อ.พนมสารคาม จ.ฉะเชิงเทรา 24120
เลขภาษี: 0105558105495  (ของลูกค้า — ไม่ใช่ของ Cecom)
date:    2026-03-05      (APPROVED DATE: "05 Mar 2026")
dueDate: 2026-06-03      (DELIVERY DATE: "03 Jun 2026")
poRef:   AAH260312160
items:
  1. WEAR PLATE FOR HOT PRESS, แผ่นเหล็กเรียบรีดเย็น SPCC 1350X5760X2.00MM LINE2ตามแบบ
     qty=70, unit=EA, unitPrice=14525, amount=1016750
  2. WEAR PLATE FOR HOT PRESS, แผ่นเหล็กเรียบรีดเย็น SPCC 1540X5160X2.00MM LINE1ตามแบบ
     qty=100, unit=EA, unitPrice=14060, amount=1406000
subtotal=2422750, VAT7%=169592.50, grandTotal=2592342.50
```

### ปัญหาของ PO Parser (ค้างแก้)

โครงสร้างแต่ละ item row ใน PDF หลังจาก PDF.js extract:
```
["1", "11011811", "WEAR PLATE... LINE2ตามแบบ", "70.00", "EA", "14,525.00", "1,016,750.00"]
```

ปัญหา: unit word "EA" อยู่ระหว่าง qty กับ unitPrice ทำให้ trailing-numeric scan หยุดก่อนกำหนด

**แนวทางแก้ที่ถูก:**
```typescript
// scan from right:
// cells[last]   = "1,016,750.00" → total
// cells[last-1] = "14,525.00"    → unitPrice
// cells[last-2] = "EA"           → unit word (ต้องตรวจ isUnitWord)
// cells[last-3] = "70.00"        → qty
// cells[0..last-4] = description (ลบ leading seq number ออก)
```

วันที่รูปแบบ "05 Mar 2026" → ต้องแปลง month name:
```typescript
const MONTHS: Record<string,number> = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
}
```

ดึง 2 วันที่จาก PO:
- `/APPROVED DATE[^:]*:\s*(\d{1,2}\s+\w+\s+\d{4})/i` → `date`
- `/DELIVERY DATE[^:]*:\s*(\d{1,2}\s+\w+\s+\d{4})/i` → `dueDate`

Description continuation rows (ไม่มี qty/price/total) ที่ไม่ใช่ skip pattern → append ต่อ item ก่อนหน้า:
```typescript
const SKIP_CONTINUATION = /^(Delivery Date|Storeroom|หมายเหตุ|Remark)/i
```

## วิธี Deploy

```bash
cd /Users/mac/cecom-docs
git add -A
git commit -m "message"
git push origin main
# Vercel auto-deploys ทันที
```

## แนวทางประหยัด Token

- **เริ่ม conversation ใหม่** — Claude อ่าน CLAUDE.md นี้แล้วรู้ context ทั้งหมด
- ถามทีละ task ที่ชัดเจน เช่น "แก้ PO parser ใน new/page.tsx ตาม spec ใน CLAUDE.md"
- ไม่ต้องส่งรูปหรืออธิบาย background ซ้ำ
