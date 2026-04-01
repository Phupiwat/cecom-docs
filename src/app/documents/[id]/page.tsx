"use client"

import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Document, DOC_TYPE_LABELS, DOC_STATUS_LABELS } from "@/lib/types"
import { formatDate, formatNumber, COMPANY } from "@/lib/utils"
import jsPDF from "jspdf"

const STATUS_OPTIONS = ["draft", "sent", "approved", "paid", "cancelled"]
const STATUS_LABELS = DOC_STATUS_LABELS

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [doc, setDoc] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then((r) => r.json())
      .then((data) => { setDoc(data.document); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function updateStatus(newStatus: string) {
    if (!doc) return
    setUpdatingStatus(true)
    try {
      await fetch(`/api/documents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...doc, status: newStatus }),
      })
      setDoc({ ...doc, status: newStatus })
    } finally {
      setUpdatingStatus(false)
    }
  }

  async function generateAndUploadPdf() {
    if (!doc) return
    setGeneratingPdf(true)
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

      // Use built-in font (no Thai support in base jsPDF — will render Latin chars)
      pdf.setFont("helvetica")

      const pageW = 210
      const margin = 15
      let y = margin

      // Header box
      pdf.setFillColor(37, 99, 235)
      pdf.rect(margin, y, pageW - margin * 2, 20, "F")
      pdf.setTextColor(255, 255, 255)
      pdf.setFontSize(14)
      pdf.setFont("helvetica", "bold")
      pdf.text(COMPANY.nameEn, margin + 4, y + 8)
      pdf.setFontSize(8)
      pdf.setFont("helvetica", "normal")
      pdf.text(DOC_TYPE_LABELS[doc.type] || doc.type, margin + 4, y + 15)
      // Doc no on right
      pdf.setFontSize(10)
      pdf.text(doc.docNo, pageW - margin - 4, y + 8, { align: "right" })
      pdf.setFontSize(8)
      pdf.text(`Date: ${formatDate(doc.date)}`, pageW - margin - 4, y + 15, { align: "right" })
      y += 25

      pdf.setTextColor(0, 0, 0)

      // Customer section
      pdf.setFontSize(8)
      pdf.setFont("helvetica", "bold")
      pdf.text("To:", margin, y + 5)
      pdf.setFont("helvetica", "normal")
      pdf.text(doc.customer, margin + 10, y + 5)
      if (doc.customerAddress) pdf.text(doc.customerAddress, margin + 10, y + 10)
      if (doc.customerTaxId) pdf.text(`Tax ID: ${doc.customerTaxId}`, margin + 10, y + 15)
      if (doc.dueDate) {
        pdf.text(`Due: ${formatDate(doc.dueDate)}`, pageW - margin - 4, y + 5, { align: "right" })
      }
      y += 22

      // Table header
      pdf.setFillColor(243, 244, 246)
      pdf.rect(margin, y, pageW - margin * 2, 7, "F")
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(8)
      const col = { desc: margin + 2, qty: margin + 95, unit: margin + 115, price: margin + 140, amount: pageW - margin - 2 }
      pdf.text("Description", col.desc, y + 5)
      pdf.text("Qty", col.qty, y + 5)
      pdf.text("Unit", col.unit, y + 5)
      pdf.text("Unit Price", col.price, y + 5)
      pdf.text("Amount", col.amount, y + 5, { align: "right" })
      y += 8

      // Table rows
      pdf.setFont("helvetica", "normal")
      doc.items.forEach((item, i) => {
        if (i % 2 === 0) {
          pdf.setFillColor(249, 250, 251)
          pdf.rect(margin, y, pageW - margin * 2, 7, "F")
        }
        pdf.text(item.description.substring(0, 45), col.desc, y + 5)
        pdf.text(String(item.qty), col.qty, y + 5)
        pdf.text(item.unit, col.unit, y + 5)
        pdf.text(formatNumber(item.unitPrice), col.price, y + 5)
        pdf.text(formatNumber(item.amount), col.amount, y + 5, { align: "right" })
        y += 7
      })

      // Totals
      y += 4
      pdf.setDrawColor(200, 200, 200)
      pdf.line(margin + 100, y, pageW - margin, y)
      y += 4
      pdf.setFontSize(8)
      const totX = pageW - margin - 50
      pdf.text("Subtotal:", totX, y)
      pdf.text(`฿${formatNumber(doc.subtotal)}`, pageW - margin - 2, y, { align: "right" })
      y += 6
      pdf.text(`VAT ${doc.vatRate}%:`, totX, y)
      pdf.text(`฿${formatNumber(doc.vat)}`, pageW - margin - 2, y, { align: "right" })
      y += 6
      pdf.setFont("helvetica", "bold")
      pdf.text("Total:", totX, y)
      pdf.text(`฿${formatNumber(doc.grandTotal)}`, pageW - margin - 2, y, { align: "right" })
      y += 10

      // Notes
      if (doc.notes) {
        pdf.setFont("helvetica", "normal")
        pdf.setFontSize(8)
        pdf.text(`Notes: ${doc.notes}`, margin, y)
        y += 6
      }

      // Footer
      pdf.setFontSize(7)
      pdf.setTextColor(150, 150, 150)
      pdf.text("Generated by Cecom Document System", pageW / 2, 285, { align: "center" })

      const pdfBase64 = pdf.output("datauristring").split(",")[1]
      const filename = `${doc.docNo}.pdf`

      // Upload to Drive
      const uploadRes = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64, filename }),
      })

      if (uploadRes.ok) {
        const { fileId, webViewLink } = await uploadRes.json()
        // Update document with drive file id
        await fetch(`/api/documents/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...doc, driveFileId: fileId }),
        })
        setDoc((prev) => prev ? { ...prev, driveFileId: fileId } : prev)
        // Also download locally
        pdf.save(filename)
        if (webViewLink) window.open(webViewLink, "_blank")
      } else {
        // Download locally only
        pdf.save(filename)
      }
    } catch (e) {
      console.error(e)
      alert("เกิดข้อผิดพลาดในการสร้าง PDF")
    } finally {
      setGeneratingPdf(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">กำลังโหลด...</div>
    </div>
  )

  if (!doc) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
      <div className="text-gray-500">ไม่พบเอกสาร</div>
      <Link href="/" className="text-blue-600 text-sm hover:underline">← กลับหน้าหลัก</Link>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">C</div>
        <div className="font-semibold text-gray-900 text-sm">Cecom Document System</div>
        <span className="text-gray-300 mx-1">/</span>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-800">เอกสาร</Link>
        <span className="text-gray-300 mx-1">/</span>
        <span className="text-sm text-gray-800 font-mono">{doc.docNo}</span>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Actions bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 font-mono">{doc.docNo}</h1>
            <span className="text-sm text-gray-500">{DOC_TYPE_LABELS[doc.type]}</span>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={doc.status}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={updatingStatus}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
              ))}
            </select>
            <button
              onClick={generateAndUploadPdf}
              disabled={generatingPdf}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              {generatingPdf ? "กำลังสร้าง..." : "ดาวน์โหลด PDF"}
            </button>
          </div>
        </div>

        {/* Document preview */}
        <div ref={printRef} className="bg-white rounded-xl border border-gray-200 p-10">
          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg mb-2">C</div>
              <div className="font-bold text-gray-900">{COMPANY.name}</div>
              <div className="text-sm text-gray-500">{COMPANY.nameEn}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-600 mb-1">{DOC_TYPE_LABELS[doc.type]}</div>
              <div className="font-mono text-gray-900 font-semibold">{doc.docNo}</div>
              <div className="text-sm text-gray-500 mt-1">วันที่: {formatDate(doc.date)}</div>
              {doc.dueDate && <div className="text-sm text-gray-500">ครบกำหนด: {formatDate(doc.dueDate)}</div>}
            </div>
          </div>

          {/* Customer info */}
          <div className="bg-gray-50 rounded-lg p-4 mb-8">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ลูกค้า</div>
            <div className="font-semibold text-gray-900">{doc.customer}</div>
            {doc.customerAddress && <div className="text-sm text-gray-600 mt-1">{doc.customerAddress}</div>}
            {doc.customerTaxId && <div className="text-sm text-gray-500 mt-1">เลขผู้เสียภาษี: {doc.customerTaxId}</div>}
          </div>

          {/* Items table */}
          <table className="w-full text-sm mb-8">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left pb-2 font-semibold text-gray-600">รายการ</th>
                <th className="text-center pb-2 font-semibold text-gray-600 w-16">จำนวน</th>
                <th className="text-center pb-2 font-semibold text-gray-600 w-16">หน่วย</th>
                <th className="text-right pb-2 font-semibold text-gray-600 w-28">ราคา/หน่วย</th>
                <th className="text-right pb-2 font-semibold text-gray-600 w-28">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {doc.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-2.5 text-gray-800">{item.description}</td>
                  <td className="py-2.5 text-center text-gray-600">{item.qty}</td>
                  <td className="py-2.5 text-center text-gray-600">{item.unit}</td>
                  <td className="py-2.5 text-right text-gray-600">฿{formatNumber(item.unitPrice)}</td>
                  <td className="py-2.5 text-right font-medium text-gray-900">฿{formatNumber(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mb-8">
            <div className="w-56 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>ยอดรวมก่อนภาษี</span>
                <span>฿{formatNumber(doc.subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>ภาษีมูลค่าเพิ่ม {doc.vatRate}%</span>
                <span>฿{formatNumber(doc.vat)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200 text-base">
                <span>ยอดรวมทั้งสิ้น</span>
                <span>฿{formatNumber(doc.grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Notes + signature */}
          <div className="flex justify-between items-end">
            <div className="flex-1">
              {doc.notes && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">หมายเหตุ</div>
                  <div className="text-sm text-gray-600">{doc.notes}</div>
                </div>
              )}
            </div>
            <div className="text-center ml-16">
              <div className="w-40 border-b border-dashed border-gray-400 mb-1 h-10"></div>
              <div className="text-xs text-gray-500">ผู้มีอำนาจลงนาม</div>
            </div>
          </div>

          {/* Drive link */}
          {doc.driveFileId && (
            <div className="mt-6 pt-4 border-t border-gray-100">
              <a
                href={`https://drive.google.com/file/d/${doc.driveFileId}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline flex items-center gap-1"
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                ดูไฟล์ใน Google Drive
              </a>
            </div>
          )}
        </div>

        {/* Meta info */}
        <div className="mt-4 text-xs text-gray-400 text-right">
          สร้างโดย {doc.createdBy}
        </div>
      </main>
    </div>
  )
}
