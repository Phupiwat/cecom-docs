"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { DocType, DOC_TYPE_LABELS, LineItem } from "@/lib/types"
import { buildDocNo, formatNumber } from "@/lib/utils"

const INITIAL_ITEM: LineItem = { description: "", qty: 1, unit: "ชิ้น", unitPrice: 0, amount: 0 }

const DOC_TYPES: DocType[] = ["QT", "SO", "DO", "BN", "INV", "REC", "TAX"]
const UNITS = ["ชิ้น", "อัน", "เครื่อง", "ชุด", "งาน", "เดือน", "ครั้ง", "วัน", "ปี"]

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

  useEffect(() => {
    // Fetch next counter for this type
    fetch("/api/counter")
      .then((r) => r.json())
      .then((data) => {
        const counter = data.counters?.[docType] ?? 1
        const year = new Date().getFullYear() + 543
        setDocNo(buildDocNo(docType, counter, year))
      })
      .catch(() => setDocNo(`${docType}-${new Date().getFullYear() + 543}-0001`))
  }, [docType])

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
      // Update counter
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

      // Increment counter
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
          <h2 className="text-xl font-bold text-gray-900 mb-6">สร้างเอกสารใหม่</h2>

          {/* Doc Type */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">ประเภทเอกสาร</label>
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
