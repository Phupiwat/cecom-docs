"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { DocType, DOC_TYPE_LABELS, LineItem } from "@/lib/types"
import { buildDocNo, formatNumber } from "@/lib/utils"

// ─── Constants ─────────────────────────────────────────────────────────────────
const INITIAL_ITEM: LineItem = { description: "", qty: 1, unit: "ชิ้น", unitPrice: 0, amount: 0 }
const UNITS = ["ชิ้น", "อัน", "เครื่อง", "ชุด", "งาน", "เดือน", "ครั้ง", "วัน", "ปี"]

// ─── Document type groups ───────────────────────────────────────────────────────
const DOC_GROUPS: { label: string; color: string; types: { type: DocType; label: string }[] }[] = [
  {
    label: "เอกสารขาย",
    color: "blue",
    types: [
      { type: "QT", label: "ใบเสนอราคา" },
    ],
  },
  {
    label: "เอกสารซื้อ",
    color: "green",
    types: [
      { type: "SO", label: "ใบสั่งขาย (Sales Order)" },
    ],
  },
  {
    label: "เอกสารทางบัญชี",
    color: "purple",
    types: [
      { type: "DO", label: "ใบส่งของ" },
      { type: "BN", label: "ใบวางบิล" },
      { type: "INV", label: "ใบแจ้งหนี้ (Invoice)" },
      { type: "REC", label: "ใบเสร็จรับเงิน" },
      { type: "TAX", label: "ใบกำกับภาษี" },
    ],
  },
]

// ─── PDF.js setup ───────────────────────────────────────────────────────────────
const PDFJS_VERSION = "3.11.174"
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { pdfjsLib: any }
}

// ─── Structured PDF extraction ─────────────────────────────────────────────────
interface PDFCell { x: number; y: number; text: string }
interface ExtractedPDF {
  text: string
  rows: string[][]        // cells left→right per Y-row
  rawCells: PDFCell[]     // all cells with exact positions
}

async function extractFromPDF(file: File): Promise<ExtractedPDF> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const allCells: PDFCell[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of content.items as any[]) {
      const s = item.str.trim()
      if (!s) continue
      allCells.push({ x: item.transform[4], y: item.transform[5], text: s })
    }
  }

  // Group into rows by Y (round to nearest 2px to merge same-line items)
  const rowMap = new Map<number, PDFCell[]>()
  for (const cell of allCells) {
    const y = Math.round(cell.y / 2) * 2
    if (!rowMap.has(y)) rowMap.set(y, [])
    rowMap.get(y)!.push(cell)
  }

  const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a) // top→bottom
  const rows: string[][] = []
  for (const y of sortedYs) {
    const sorted = rowMap.get(y)!.sort((a, b) => a.x - b.x)
    rows.push(sorted.map((c) => c.text))
  }

  const text = rows.map((r) => r.join("  ")).join("\n")
  return { text, rows, rawCells: allCells }
}

// ─── PO Parser ─────────────────────────────────────────────────────────────────
interface ParsedPO {
  customer: string
  customerAddress: string
  customerTaxId: string
  date: string
  dueDate: string
  poRef: string
  items: LineItem[]
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0
}

function isNumericCell(s: string): boolean {
  return /^[\d,]+(\.\d+)?$/.test(s.trim())
}

const MONTHS: Record<string, number> = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
}
function parseMonthDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (!m) return null
  const mo = MONTHS[m[2].toLowerCase()]
  if (!mo) return null
  return `${m[3]}-${String(mo).padStart(2,"0")}-${String(parseInt(m[1])).padStart(2,"0")}`
}

// Extract line items using structured row data (much more accurate than regex-only)
function extractLineItemsFromRows(rows: string[][]): LineItem[] {
  const UNIT_WORDS = /^(ชิ้น|อัน|เครื่อง|ชุด|งาน|เดือน|ครั้ง|วัน|ปี|sets?|pcs?|units?|ea\.?|box|lot|pack)$/i
  const SKIP_ROW = /^(รวม|ยอดรวม|vat|ภาษี|total|grand\s*total|sub\s*total|รายการที่|ลำดับ|description|qty|quantity|unit\s*price|amount|หน่วย|จำนวน|ราคา.*หน่วย|เลขที่|วันที่|ชื่อ|ที่อยู่|โทร|หมายเหตุ|เงื่อนไข|กำหนด|ผู้|บริษัท|สาขา)/i

  const items: LineItem[] = []

  // Try to find header row to determine column layout
  let headerRow: string[] | null = null
  let headerIdx = -1
  let qtyColIdx = -1
  let unitPriceColIdx = -1
  let totalColIdx = -1

  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].join(" ").toLowerCase()
    const hasQty = /จำนวน|qty|quantity/.test(joined)
    const hasPrice = /ราคา|price/.test(joined)
    const hasTotal = /รวม|total|amount/.test(joined)
    if (hasQty && (hasPrice || hasTotal)) {
      headerRow = rows[i]
      headerIdx = i
      for (let j = 0; j < headerRow.length; j++) {
        const h = headerRow[j].toLowerCase()
        if (/จำนวน|^qty|^quantity/.test(h)) qtyColIdx = j
        else if (/ราคา\/|price\/|unit.*price|ราคาต่อหน่วย/.test(h)) unitPriceColIdx = j
        else if (/รวม|total|amount/.test(h) && unitPriceColIdx >= 0) totalColIdx = j
      }
      break
    }
  }

  const startIdx = headerIdx >= 0 ? headerIdx + 1 : 0

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i]
    if (row.length === 0) continue
    const rowText = row.join(" ")
    if (SKIP_ROW.test(rowText.trim().split(/\s+/)[0])) continue
    if (SKIP_ROW.test(rowText)) continue

    // ── Strategy 1: use detected header columns ────────────────────────────────
    if (headerRow && qtyColIdx >= 0 && totalColIdx >= 0 && row.length >= totalColIdx + 1) {
      const qty = parseNum(row[qtyColIdx] || "1")
      const unitPrice = unitPriceColIdx >= 0 ? parseNum(row[unitPriceColIdx] || "0") : 0
      const total = parseNum(row[totalColIdx] || "0")
      const descCells = row.slice(0, qtyColIdx).join(" ").replace(/^\d+[\.\)]\s*/, "").trim()

      const ratio = total > 0 && qty > 0 && unitPrice > 0
        ? Math.abs(qty * unitPrice - total) / total
        : 1
      if (descCells.length >= 2 && total > 0 && qty > 0 && ratio < 0.05) {
        const uMatch = descCells.match(new RegExp(`(${UNIT_WORDS.source})\\s*$`, "i"))
        const desc = uMatch ? descCells.replace(uMatch[0], "").trim() : descCells
        const unit = uMatch ? uMatch[1] : "ชิ้น"
        items.push({ description: desc, qty, unit, unitPrice: unitPrice || total / qty, amount: total })
        continue
      }
    }

    // ── Strategy 2: right-to-left scan ─────────────────────────────────────────
    // Layout (right→left): total | unitPrice | [unit word] | qty | description...
    {
      const last = row.length - 1
      if (last >= 2 && isNumericCell(row[last]) && isNumericCell(row[last - 1])) {
        const s2total = parseNum(row[last])
        const s2unitPrice = parseNum(row[last - 1])
        if (s2total > 0 && s2unitPrice > 0) {
          let cursor = last - 2
          let s2unit = "ชิ้น"
          // unit word between unitPrice and qty (e.g. "EA")
          if (cursor >= 0 && UNIT_WORDS.test(row[cursor])) { s2unit = row[cursor]; cursor-- }
          let s2qty = 0
          if (cursor >= 0 && isNumericCell(row[cursor])) { s2qty = parseNum(row[cursor]); cursor-- }
          else { s2qty = s2unitPrice > 0 ? Math.round((s2total / s2unitPrice) * 100) / 100 : 1 }
          if (s2qty > 0) {
            const s2ratio = s2total > 0 ? Math.abs(s2qty * s2unitPrice - s2total) / s2total : 1
            if (s2ratio <= 0.05) {
              const s2desc = row.slice(0, cursor + 1).join(" ").replace(/^\d+[\.\)]\s*/, "").trim()
              if (s2desc.length >= 2) {
                items.push({ description: s2desc, qty: s2qty, unit: s2unit, unitPrice: s2unitPrice, amount: s2total })
                continue
              }
            }
          }
        }
      }
    }

    // ── Continuation row: neither strategy parsed an item ───────────────────────
    // Append non-header text to the description of the previous item
    const SKIP_CONTINUATION = /^(Delivery Date|Storeroom|หมายเหตุ|Remark)/i
    if (items.length > 0 && !SKIP_CONTINUATION.test(rowText.trim())) {
      const continuation = rowText.replace(/^\d+[\.\)]\s*/, "").trim()
      if (continuation.length > 2) {
        const prev = items[items.length - 1]
        items[items.length - 1] = { ...prev, description: prev.description + " " + continuation }
      }
    }
  }

  return items
}

function parsePO(extracted: ExtractedPDF): ParsedPO {
  const { text, rows } = extracted
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)

  // Tax ID
  let customerTaxId = ""
  const taxPatterns = [
    /(?:เลขผู้เสียภาษี|เลขประจำตัวผู้เสียภาษี|Tax\s*ID)[:\s]+(\d[\d\-]{11,15}\d)/i,
    /(\d{1}-\d{4}-\d{5}-\d{2}-\d{1})/,
    /\b(\d{13})\b/,
  ]
  for (const p of taxPatterns) {
    const m = text.match(p)
    if (m) {
      const c = m[1].replace(/[-\s]/g, "")
      if (c.length === 13) { customerTaxId = c; break }
    }
  }

  // Company name
  let customer = ""
  for (const line of lines) {
    if (/^บริษัท|^ห้างหุ้นส่วน|^ร้าน/.test(line)) {
      customer = line.replace(/\s*\(.*?\)\s*$/, "").trim(); break
    }
  }
  if (!customer) {
    const m = text.match(/(บริษัท[^\n,]{2,50}(?:จำกัด|จก\.|Ltd\.?))/i)
    if (m) customer = m[1].trim()
  }

  // Address
  const addrKeywords = /ถนน|ซอย|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|ถ\.|ซ\.|กรุงเทพ|Bangkok|นนทบุรี|ปทุมธานี|เชียงใหม่|ชลบุรี/
  const addrLines: string[] = []
  let pastCompany = false
  for (const line of lines) {
    if (line === customer) { pastCompany = true; continue }
    if (pastCompany && addrLines.length < 3) {
      if (addrKeywords.test(line) && line.length > 5) addrLines.push(line)
      else if (addrLines.length > 0 && /\d{5}/.test(line)) { addrLines.push(line); break }
    }
  }
  if (addrLines.length === 0) {
    for (const line of lines) {
      if (addrKeywords.test(line) && line.length > 10) { addrLines.push(line); if (addrLines.length >= 2) break }
    }
  }
  const customerAddress = addrLines.join(" ")

  // APPROVED DATE → date; DELIVERY DATE → dueDate
  let date = new Date().toISOString().split("T")[0]
  let dueDate = ""
  const approvedM = text.match(/APPROVED DATE[^:\n]*:\s*(\d{1,2}\s+\w+\s+\d{4})/i)
  if (approvedM) { const p = parseMonthDate(approvedM[1]); if (p) date = p }
  const deliveryM = text.match(/DELIVERY DATE[^:\n]*:\s*(\d{1,2}\s+\w+\s+\d{4})/i)
  if (deliveryM) { const p = parseMonthDate(deliveryM[1]); if (p) dueDate = p }
  // Fallback numeric date patterns when no APPROVED DATE found
  if (!approvedM) {
    const datePats = [
      /(?:วันที่|Date)[:\s]+(\d{1,2})[\/\-\. ](\d{1,2})[\/\-\. ](\d{2,4})/i,
      /(\d{1,2})[\/](\d{1,2})[\/](\d{4})/,
    ]
    for (const p of datePats) {
      const m = text.match(p)
      if (m) {
        let y = parseInt(m[3]); const mo = parseInt(m[2]); const d = parseInt(m[1])
        if (y > 2500) y -= 543; if (y < 100) y += 2000
        if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          date = `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`; break
        }
      }
    }
  }

  // PO reference
  let poRef = ""
  const refM = text.match(/(?:เลขที่|PO\s*No\.?|P\.O\.)[:\s#]+([\w\-\/]+\d[\w\-\/]*)/i)
  if (refM) poRef = refM[1].trim()

  // Line items — use structured row data for best results
  const items = extractLineItemsFromRows(rows)

  return { customer, customerAddress, customerTaxId, date, dueDate, poRef, items }
}

// ─── Main Component ─────────────────────────────────────────────────────────────
interface CreatedDoc { id: string; docNo: string; type: DocType }

export default function NewDocumentPage() {
  const router = useRouter()

  // Form state
  const [customer, setCustomer] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [customerTaxId, setCustomerTaxId] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<LineItem[]>([{ ...INITIAL_ITEM }])
  const vatRate = 7

  // Multi-doc type selection
  const [selectedTypes, setSelectedTypes] = useState<Set<DocType>>(new Set(["QT"]))

  // Preview of doc numbers per selected type
  const [counters, setCounters] = useState<Record<string, number>>({})
  useEffect(() => {
    fetch("/api/counter").then((r) => r.json()).then((d) => setCounters(d.counters || {})).catch(() => {})
  }, [])

  // PDF import state
  const [pdfJsReady, setPdfJsReady] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null)
  const [rawPdfText, setRawPdfText] = useState("")
  const [showRaw, setShowRaw] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Submit state
  const [saving, setSaving] = useState(false)
  const [createdDocs, setCreatedDocs] = useState<CreatedDoc[]>([])

  // Load PDF.js
  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; setPdfJsReady(true); return }
    const s = document.createElement("script")
    s.src = PDFJS_CDN; s.async = true
    s.onload = () => { if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; setPdfJsReady(true) } }
    document.head.appendChild(s)
  }, [])

  // Toggle doc type selection
  function toggleType(t: DocType) {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) { if (next.size > 1) next.delete(t) } else next.add(t)
      return next
    })
  }

  // PDF import
  const handleImportPO = useCallback(async (file: File) => {
    if (!pdfJsReady || !window.pdfjsLib) {
      setImportResult({ success: false, message: "PDF.js ยังโหลดไม่เสร็จ กรุณารอแล้วลองใหม่" }); return
    }
    setImportLoading(true); setImportResult(null)
    try {
      const extracted = await extractFromPDF(file)
      setRawPdfText(extracted.text)
      const parsed = parsePO(extracted)
      const applied: string[] = []
      if (parsed.customer) { setCustomer(parsed.customer); applied.push("ชื่อลูกค้า") }
      if (parsed.customerAddress) { setCustomerAddress(parsed.customerAddress); applied.push("ที่อยู่") }
      if (parsed.customerTaxId) { setCustomerTaxId(parsed.customerTaxId); applied.push("เลขผู้เสียภาษี") }
      if (parsed.date) setDate(parsed.date)
      if (parsed.dueDate) { setDueDate(parsed.dueDate); applied.push("วันครบกำหนด") }
      if (parsed.poRef) { setNotes(`อ้างอิง PO: ${parsed.poRef}`); applied.push("เลขที่ PO") }
      if (parsed.items.length > 0) { setItems(parsed.items); applied.push(`${parsed.items.length} รายการสินค้า`) }
      setImportResult({
        success: true,
        message: applied.length > 0 ? `นำเข้าสำเร็จ: ${applied.join(", ")}` : "อ่านไฟล์ได้ แต่ไม่พบข้อมูลที่จะนำเข้า — ดูข้อความดิบเพื่อกรอกเอง",
      })
    } catch (err) {
      console.error(err)
      setImportResult({ success: false, message: "ไม่สามารถอ่าน PDF ได้ กรุณาตรวจสอบไฟล์" })
    } finally {
      setImportLoading(false)
    }
  }, [pdfJsReady])

  // Form helpers
  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    setItems((prev) => {
      const next = [...prev]
      const item = { ...next[index], [field]: value }
      if (field === "qty" || field === "unitPrice") item.amount = Number(item.qty) * Number(item.unitPrice)
      next[index] = item
      return next
    })
  }

  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const vat = Math.round(subtotal * vatRate) / 100
  const grandTotal = subtotal + vat

  // Submit: create one document per selected type
  async function handleSubmit(status: "draft" | "sent") {
    if (!customer.trim()) { alert("กรุณากรอกชื่อลูกค้า"); return }
    if (selectedTypes.size === 0) { alert("กรุณาเลือกประเภทเอกสารอย่างน้อย 1 ประเภท"); return }
    setSaving(true)

    try {
      // Fetch all counters once
      const counterRes = await fetch("/api/counter")
      const counterData = await counterRes.json()
      const allCounters: Record<string, number> = counterData.counters || {}
      const year = new Date().getFullYear() + 543
      const created: CreatedDoc[] = []

      for (const docType of selectedTypes) {
        const counter = allCounters[docType] ?? 1
        const doc = {
          docNo: buildDocNo(docType, counter, year),
          type: docType,
          customer, customerAddress, customerTaxId,
          date, dueDate, items,
          subtotal, vatRate, vat, grandTotal,
          status, notes,
        }

        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(doc),
        })
        if (!res.ok) throw new Error(`Failed to save ${docType}`)
        const saved = await res.json()

        await fetch("/api/counter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: docType, value: counter + 1 }),
        })

        created.push({ id: saved.id, docNo: doc.docNo, type: docType })
      }

      setCreatedDocs(created)

      // Navigate to the document if only one was created
      if (created.length === 1) router.push(`/documents/${created[0].id}`)

    } catch (e) {
      alert("เกิดข้อผิดพลาด กรุณาลองใหม่")
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  // ─── Success screen (multiple docs created) ──────────────────────────────────
  if (createdDocs.length > 1) {
    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">C</div>
          <Link href="/" className="font-semibold text-gray-900 text-sm hover:text-blue-600">Cecom Document System</Link>
        </nav>
        <main className="max-w-xl mx-auto px-6 py-16 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">สร้างเอกสารสำเร็จ</h2>
          <p className="text-gray-500 mb-8">สร้าง {createdDocs.length} เอกสารจากใบสั่งซื้อเดียวกัน</p>
          <div className="space-y-3 text-left mb-8">
            {createdDocs.map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition-all"
              >
                <div>
                  <span className="font-mono font-semibold text-gray-900">{doc.docNo}</span>
                  <span className="ml-2 text-sm text-gray-500">{DOC_TYPE_LABELS[doc.type]}</span>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
          <Link href="/" className="text-sm text-blue-600 hover:underline">← กลับหน้าหลัก</Link>
        </main>
      </div>
    )
  }

  // ─── Main form ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">C</div>
        <div className="font-semibold text-gray-900 text-sm">Cecom Document System</div>
        <span className="text-gray-300 mx-1">/</span>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-800">เอกสาร</Link>
        <span className="text-gray-300 mx-1">/</span>
        <span className="text-sm text-gray-800 font-medium">สร้างใหม่</span>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white rounded-xl border border-gray-200 p-8">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">สร้างเอกสารใหม่</h2>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportPO(f); e.target.value = "" }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                {importLoading ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>กำลังอ่าน PDF...</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>📎 นำเข้าจากใบสั่งซื้อ (PO)</>
                )}
              </button>
            </div>
          </div>

          {/* Import result */}
          {importResult && (
            <div className={`mb-6 rounded-lg border p-4 ${importResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <span className="text-lg">{importResult.success ? "✅" : "❌"}</span>
                  <div>
                    <p className={`text-sm font-medium ${importResult.success ? "text-green-800" : "text-red-800"}`}>{importResult.message}</p>
                    {importResult.success && rawPdfText && (
                      <button onClick={() => setShowRaw(!showRaw)} className="mt-1 text-xs text-green-700 underline">
                        {showRaw ? "ซ่อนข้อความดิบ" : "ดูข้อความดิบจาก PDF"}
                      </button>
                    )}
                  </div>
                </div>
                <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>
              {showRaw && rawPdfText && (
                <textarea readOnly value={rawPdfText} rows={10}
                  className="mt-3 w-full text-xs font-mono border border-green-200 rounded p-2 bg-white text-gray-700 resize-y" />
              )}
            </div>
          )}

          {/* ── SECTION 1: Document type selection ── */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              เลือกเอกสารที่จะออก
              <span className="ml-2 text-xs font-normal text-gray-400">(เลือกได้มากกว่า 1)</span>
            </label>
            <div className="grid grid-cols-1 gap-4">
              {DOC_GROUPS.map((group) => {
                const colorMap: Record<string, string> = {
                  blue: "border-blue-200 bg-blue-50",
                  green: "border-green-200 bg-green-50",
                  purple: "border-purple-200 bg-purple-50",
                }
                const labelMap: Record<string, string> = {
                  blue: "text-blue-700 bg-blue-100",
                  green: "text-green-700 bg-green-100",
                  purple: "text-purple-700 bg-purple-100",
                }
                const checkMap: Record<string, string> = {
                  blue: "border-blue-400 bg-blue-600",
                  green: "border-green-400 bg-green-600",
                  purple: "border-purple-400 bg-purple-600",
                }
                return (
                  <div key={group.label} className={`border rounded-xl p-4 ${colorMap[group.color]}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${labelMap[group.color]}`}>{group.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {group.types.map(({ type, label }) => {
                        const selected = selectedTypes.has(type)
                        const counter = counters[type] ?? 1
                        const year = new Date().getFullYear() + 543
                        const preview = buildDocNo(type, counter, year)
                        return (
                          <label
                            key={type}
                            className={`flex items-start gap-3 cursor-pointer p-3 rounded-lg border-2 bg-white transition-all min-w-52 ${selected ? `${checkMap[group.color].replace("bg-", "border-").split(" ")[0]} shadow-sm` : "border-gray-200 hover:border-gray-300"}`}
                          >
                            <div className="relative mt-0.5">
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={selected}
                                onChange={() => toggleType(type)}
                              />
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${selected ? checkMap[group.color] : "border-gray-300 bg-white"}`}>
                                {selected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                              </div>
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-gray-900">{type}</div>
                              <div className="text-xs text-gray-600">{label}</div>
                              <div className="text-xs font-mono text-gray-400 mt-0.5">{preview}</div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── SECTION 2: Customer info ── */}
          <div className="border-t border-gray-100 pt-6 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">ข้อมูลลูกค้า</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อลูกค้า / บริษัท <span className="text-red-500">*</span></label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="บริษัท / ชื่อลูกค้า" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">ที่อยู่</label>
                <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="ที่อยู่ลูกค้า" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">เลขผู้เสียภาษี</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={customerTaxId} onChange={(e) => setCustomerTaxId(e.target.value)} placeholder="0000000000000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
                <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">วันที่ครบกำหนด</label>
                <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── SECTION 3: Line items ── */}
          <div className="border-t border-gray-100 pt-6 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">รายการสินค้า / บริการ</h3>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 w-1/2">รายการ</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-16">จำนวน</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">หน่วย</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">ราคา/หน่วย</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">จำนวนเงิน</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <input className="w-full border-0 outline-none text-sm" value={item.description}
                          onChange={(e) => updateItem(idx, "description", e.target.value)} placeholder="รายละเอียด" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" className="w-full border-0 outline-none text-sm text-center"
                          value={item.qty} onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="px-3 py-2">
                        <select className="w-full border-0 outline-none text-sm text-center bg-transparent"
                          value={item.unit} onChange={(e) => updateItem(idx, "unit", e.target.value)}>
                          {UNITS.map((u) => <option key={u}>{u}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" className="w-full border-0 outline-none text-sm text-right"
                          value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">{formatNumber(item.amount)}</td>
                      <td className="px-2 py-2 text-center">
                        {items.length > 1 && (
                          <button onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-gray-100 px-3 py-2">
                <button onClick={() => setItems((prev) => [...prev, { ...INITIAL_ITEM }])}
                  className="text-blue-600 text-sm hover:text-blue-800">+ เพิ่มรายการ</button>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end mb-6">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>ยอดรวมก่อนภาษี</span><span>฿{formatNumber(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>ภาษีมูลค่าเพิ่ม {vatRate}%</span><span>฿{formatNumber(vat)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200">
                <span>ยอดรวมทั้งสิ้น</span><span>฿{formatNumber(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" />
          </div>

          {/* Selected summary + Actions */}
          {selectedTypes.size > 1 && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-800">
              จะสร้าง <strong>{selectedTypes.size} เอกสาร</strong> พร้อมกัน: {Array.from(selectedTypes).map((t) => DOC_TYPE_LABELS[t]).join(", ")}
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <Link href="/" className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">ยกเลิก</Link>
            <button onClick={() => handleSubmit("draft")} disabled={saving}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              บันทึกเป็นร่าง
            </button>
            <button onClick={() => handleSubmit("sent")} disabled={saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "กำลังบันทึก..." : selectedTypes.size > 1 ? `บันทึก ${selectedTypes.size} เอกสาร` : "บันทึกและส่ง"}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
