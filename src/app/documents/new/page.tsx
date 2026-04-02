"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { DocType, DOC_TYPE_LABELS, LineItem } from "@/lib/types"
import { buildDocNo, formatNumber } from "@/lib/utils"

const INITIAL_ITEM: LineItem = { description: "", qty: 1, unit: "ชิ้น", unitPrice: 0, amount: 0 }

const DOC_TYPES: DocType[] = ["QT", "SO", "DO", "BN", "INV", "REC", "TAX"]
const UNITS = ["ชิ้น", "อัน", "เครื่อง", "ชุด", "งาน", "เดือน", "ครั้ง", "วัน", "ปี"]

// ─── PDF.js CDN ────────────────────────────────────────────────────────────────
const PDFJS_VERSION = "3.11.174"
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfjsLib: any
  }
}

// ─── PO Text Parser ────────────────────────────────────────────────────────────
interface ParsedPO {
  customer: string
  customerAddress: string
  customerTaxId: string
  date: string
  poRef: string
  items: LineItem[]
}

function parsePOText(text: string): ParsedPO {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)

  // 1. Tax ID (13 digits)
  let customerTaxId = ""
  const taxPatterns = [
    /(?:เลขผู้เสียภาษี|เลขประจำตัวผู้เสียภาษี|Tax\s*ID|TAX\s*ID)[:\s]+(\d[\d\-]{11,15}\d)/i,
    /(\d{1}-\d{4}-\d{5}-\d{2}-\d{1})/,
    /\b(\d{13})\b/,
  ]
  for (const pattern of taxPatterns) {
    const match = text.match(pattern)
    if (match) {
      const cleaned = match[1].replace(/[-\s]/g, "")
      if (cleaned.length === 13) { customerTaxId = cleaned; break }
    }
  }

  // 2. Company / customer name
  let customer = ""
  for (const line of lines) {
    if (/^บริษัท|^ห้างหุ้นส่วน|^ร้าน/.test(line)) {
      customer = line.replace(/\s*\(.*\)\s*$/, "").trim()
      break
    }
  }
  if (!customer) {
    const m = text.match(/(บริษัท[^\n,]+(?:จำกัด|จก\.|Ltd\.?))/i)
    if (m) customer = m[1].trim()
  }

  // 3. Address
  const addrKeywords = /ถนน|ซอย|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|ถ\.|ซ\.|อ\.|จ\.|กรุงเทพ|Bangkok|นนทบุรี|ปทุมธานี|เชียงใหม่|ชลบุรี/
  const addressLines: string[] = []
  let pastCompany = false
  for (const line of lines) {
    if (line === customer) { pastCompany = true; continue }
    if (pastCompany && addressLines.length < 3) {
      if (addrKeywords.test(line) && line.length > 5) addressLines.push(line)
      else if (addressLines.length > 0 && /\d{5}/.test(line)) { addressLines.push(line); break }
    }
  }
  if (addressLines.length === 0) {
    for (const line of lines) {
      if (addrKeywords.test(line) && line.length > 10) {
        addressLines.push(line)
        if (addressLines.length >= 2) break
      }
    }
  }
  const customerAddress = addressLines.join(" ")

  // 4. Date
  let date = new Date().toISOString().split("T")[0]
  const datePatterns = [
    /(?:วันที่|Date|DATE)[:\s]+(\d{1,2})[\/\-\. ](\d{1,2})[\/\-\. ](\d{2,4})/i,
    /(\d{1,2})[\/](\d{1,2})[\/](\d{4})/,
  ]
  for (const pat of datePatterns) {
    const m = text.match(pat)
    if (m) {
      let year = parseInt(m[3])
      const month = parseInt(m[2])
      const day = parseInt(m[1])
      if (year > 2500) year -= 543
      if (year < 100) year += 2000
      if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        break
      }
    }
  }

  // 5. PO reference number
  let poRef = ""
  const poRefMatch = text.match(/(?:เลขที่|PO\s*No\.?|P\.O\.)[:\s#]+([\w\-\/]+\d[\w\-\/]*)/i)
  if (poRefMatch) poRef = poRefMatch[1].trim()

  // 6. Line items (best-effort)
  const items = extractLineItems(lines)

  return { customer, customerAddress, customerTaxId, date, poRef, items }
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0
}

function extractLineItems(lines: string[]): LineItem[] {
  const items: LineItem[] = []
  const skipPattern = /รวม|ยอดรวม|vat|ภาษี|total|subtotal|รายการ|ลำดับ|description|qty|unit.*price|amount|หน่วย|จำนวน|ราคา/i

  for (const line of lines) {
    if (skipPattern.test(line)) continue

    // Pattern A: "1. รายการสินค้า 10 ชิ้น 1,000 10,000"
    const pA = line.match(
      /^\d+[\.\)]\s*(.+?)\s+(\d+(?:\.\d+)?)\s*(ชิ้น|อัน|เครื่อง|ชุด|งาน|เดือน|ครั้ง|วัน|ปี|sets?|pcs?|units?|ea\.?|box|lot)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/i
    )
    if (pA) {
      const qty = parseFloat(pA[2])
      const unitPrice = parseNum(pA[4])
      const amount = parseNum(pA[5])
      if (qty > 0 && unitPrice >= 0) {
        items.push({ description: pA[1].trim(), qty, unit: pA[3] || "ชิ้น", unitPrice, amount: amount || qty * unitPrice })
        continue
      }
    }

    // Pattern B: "รายการสินค้า 10 1,000.00 10,000.00"
    const pB = line.match(/^(.{3,60}?)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/)
    if (pB) {
      const qty = parseFloat(pB[2])
      const unitPrice = parseNum(pB[3])
      const amount = parseNum(pB[4])
      const ratio = qty > 0 ? Math.abs(qty * unitPrice - amount) / Math.max(amount, 1) : 1
      if (ratio < 0.05 && qty > 0 && unitPrice > 0) {
        items.push({ description: pB[1].trim(), qty, unit: "ชิ้น", unitPrice, amount })
        continue
      }
    }
  }
  return items
}

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function NewDocumentPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [docType, setDocType] = useState<DocType>("QT")
  const [customer, setCustomer] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [customerTaxId, setCustomerTaxId] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [vatRate] = useState(7)
  const [items, setItems] = useState<LineItem[]>([{ ...INITIAL_ITEM }])
  const [docNo, setDocNo] = useState("")

  // PO import state
  const [pdfJsReady, setPdfJsReady] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; fields: string[] } | null>(null)
  const [showRawText, setShowRawText] = useState(false)
  const [rawPdfText, setRawPdfText] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load PDF.js from CDN
  useEffect(() => {
    if (typeof window !== "undefined" && !window.pdfjsLib) {
      const script = document.createElement("script")
      script.src = PDFJS_CDN
      script.async = true
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
          setPdfJsReady(true)
        }
      }
      document.head.appendChild(script)
    } else if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
      setPdfJsReady(true)
    }
  }, [])

  useEffect(() => {
    fetch("/api/counter")
      .then((r) => r.json())
      .then((data) => {
        const counter = data.counters?.[docType] ?? 1
        const year = new Date().getFullYear() + 543
        setDocNo(buildDocNo(docType, counter, year))
      })
      .catch(() => setDocNo(`${docType}-${new Date().getFullYear() + 543}-0001`))
  }, [docType])

  // ─── PDF Import ────────────────────────────────────────────────────────────────
  const extractTextFromPDF = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
    let fullText = ""
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      // Group items by Y position to reconstruct rows
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: Map<number, any[]> = new Map()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of content.items as any[]) {
        const y = Math.round(item.transform[5])
        if (!rows.has(y)) rows.set(y, [])
        rows.get(y)!.push(item)
      }
      // Sort rows by Y descending (top to bottom), items within row by X
      const sortedYs = Array.from(rows.keys()).sort((a, b) => b - a)
      for (const y of sortedYs) {
        const rowItems = rows.get(y)!.sort((a, b) => a.transform[4] - b.transform[4])
        const rowText = rowItems.map((i) => i.str).join(" ").trim()
        if (rowText) fullText += rowText + "\n"
      }
    }
    return fullText
  }, [])

  const handleImportPO = useCallback(async (file: File) => {
    if (!pdfJsReady || !window.pdfjsLib) {
      setImportResult({ success: false, message: "PDF.js ยังโหลดไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่", fields: [] })
      return
    }
    setImportLoading(true)
    setImportResult(null)
    try {
      const text = await extractTextFromPDF(file)
      setRawPdfText(text)
      const parsed = parsePOText(text)

      const appliedFields: string[] = []
      if (parsed.customer) { setCustomer(parsed.customer); appliedFields.push("ชื่อลูกค้า") }
      if (parsed.customerAddress) { setCustomerAddress(parsed.customerAddress); appliedFields.push("ที่อยู่") }
      if (parsed.customerTaxId) { setCustomerTaxId(parsed.customerTaxId); appliedFields.push("เลขผู้เสียภาษี") }
      if (parsed.date) { setDate(parsed.date) }
      if (parsed.poRef) {
        setNotes((prev) => prev ? prev : `อ้างอิง PO: ${parsed.poRef}`)
        appliedFields.push("เลขที่ PO")
      }
      if (parsed.items.length > 0) {
        setItems(parsed.items)
        appliedFields.push(`${parsed.items.length} รายการสินค้า`)
      }

      setImportResult({
        success: true,
        message: appliedFields.length > 0
          ? `นำเข้าสำเร็จ: ${appliedFields.join(", ")}`
          : "อ่านไฟล์ได้แต่ไม่พบข้อมูลที่จะนำเข้า — ดูข้อความดิบเพื่อกรอกเอง",
        fields: appliedFields,
      })
    } catch (err) {
      console.error(err)
      setImportResult({ success: false, message: "ไม่สามารถอ่าน PDF ได้ กรุณาตรวจสอบไฟล์", fields: [] })
    } finally {
      setImportLoading(false)
    }
  }, [pdfJsReady, extractTextFromPDF])

  // ─── Form helpers ───────────────────────────────────────────────────────────────
  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    setItems((prev) => {
      const next = [...prev]
      const item = { ...next[index], [field]: value }
      if (field === "qty" || field === "unitPrice") {
        item.amount = Number(item.qty) * Number(item.unitPrice)
      }
      next[index] = item
      return next
    })
  }

  function addItem() {
    setItems((prev) => [...prev, { ...INITIAL_ITEM }])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const vat = Math.round((subtotal * vatRate) / 100 * 100) / 100
  const grandTotal = subtotal + vat

  async function handleSubmit(status: "draft" | "sent") {
    if (!customer.trim()) { alert("กรุณากรอกชื่อลูกค้า"); return }
    setSaving(true)
    try {
      const counterRes = await fetch("/api/counter")
      const counterData = await counterRes.json()
      const currentCounter = counterData.counters?.[docType] ?? 1
      const year = new Date().getFullYear() + 543

      const doc = {
        docNo: buildDocNo(docType, currentCounter, year),
        type: docType,
        customer,
        customerAddress,
        customerTaxId,
        date,
        dueDate,
        items,
        subtotal,
        vatRate,
        vat,
        grandTotal,
        status,
        notes,
      }

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      })

      if (!res.ok) throw new Error("Save failed")
      const saved = await res.json()

      await fetch("/api/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: docType, value: currentCounter + 1 }),
      })

      router.push(`/documents/${saved.id}`)
    } catch (e) {
      alert("เกิดข้อผิดพลาด กรุณาลองใหม่")
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
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

          {/* Header + Import button */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">สร้างเอกสารใหม่</h2>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleImportPO(file)
                  e.target.value = ""
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                {importLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    กำลังอ่าน PDF...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                    </svg>
                    📎 นำเข้าจากใบสั่งซื้อ (PO)
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Import result banner */}
          {importResult && (
            <div className={`mb-6 rounded-lg border p-4 ${importResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <span className="text-lg">{importResult.success ? "✅" : "❌"}</span>
                  <div>
                    <p className={`text-sm font-medium ${importResult.success ? "text-green-800" : "text-red-800"}`}>
                      {importResult.message}
                    </p>
                    {importResult.success && rawPdfText && (
                      <button
                        onClick={() => setShowRawText(!showRawText)}
                        className="mt-1 text-xs text-green-700 underline hover:text-green-900"
                      >
                        {showRawText ? "ซ่อนข้อความดิบ" : "ดูข้อความดิบจาก PDF"}
                      </button>
                    )}
                  </div>
                </div>
                <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>

              {/* Raw text panel */}
              {showRawText && rawPdfText && (
                <div className="mt-3">
                  <textarea
                    readOnly
                    value={rawPdfText}
                    rows={10}
                    className="w-full text-xs font-mono border border-green-200 rounded p-2 bg-white text-gray-700 resize-y"
                  />
                </div>
              )}
            </div>
          )}

          {/* Doc Type */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">ประเภทเอกสารที่จะออก</label>
            <div className="flex flex-wrap gap-2">
              {DOC_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setDocType(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${docType === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}
                >
                  {t} — {DOC_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Doc No (preview) */}
          <div className="mb-6 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <span className="text-sm text-gray-500">เลขที่เอกสาร: </span>
            <span className="font-mono font-semibold text-gray-900">{docNo}</span>
          </div>

          {/* Customer Info */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อลูกค้า / บริษัท <span className="text-red-500">*</span></label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="บริษัท / ชื่อลูกค้า"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ที่อยู่</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="ที่อยู่ลูกค้า"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เลขผู้เสียภาษี</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={customerTaxId}
                onChange={(e) => setCustomerTaxId(e.target.value)}
                placeholder="0000000000000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่ครบกำหนด</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">รายการสินค้า / บริการ</label>
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
                        <input
                          className="w-full border-0 outline-none text-sm"
                          value={item.description}
                          onChange={(e) => updateItem(idx, "description", e.target.value)}
                          placeholder="รายละเอียด"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          className="w-full border-0 outline-none text-sm text-center"
                          value={item.qty}
                          onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="w-full border-0 outline-none text-sm text-center bg-transparent"
                          value={item.unit}
                          onChange={(e) => updateItem(idx, "unit", e.target.value)}
                        >
                          {UNITS.map((u) => <option key={u}>{u}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          className="w-full border-0 outline-none text-sm text-right"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">
                        {formatNumber(item.amount)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {items.length > 1 && (
                          <button onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-gray-100 px-3 py-2">
                <button onClick={addItem} className="text-blue-600 text-sm hover:text-blue-800">+ เพิ่มรายการ</button>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end mb-6">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>ยอดรวมก่อนภาษี</span>
                <span>฿{formatNumber(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>ภาษีมูลค่าเพิ่ม {vatRate}%</span>
                <span>฿{formatNumber(vat)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200">
                <span>ยอดรวมทั้งสิ้น</span>
                <span>฿{formatNumber(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="หมายเหตุ (ถ้ามี)"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <Link href="/" className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">ยกเลิก</Link>
            <button
              onClick={() => handleSubmit("draft")}
              disabled={saving}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              บันทึกเป็นร่าง
            </button>
            <button
              onClick={() => handleSubmit("sent")}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "กำลังบันทึก..." : "บันทึกและส่ง"}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
