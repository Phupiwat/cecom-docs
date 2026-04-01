import { auth, signOut } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { DOC_TYPE_LABELS, DOC_STATUS_LABELS, Document } from "@/lib/types"
import { formatDate, formatNumber } from "@/lib/utils"

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
}

const TYPE_COLORS: Record<string, string> = {
  QT: "bg-purple-100 text-purple-700",
  SO: "bg-indigo-100 text-indigo-700",
  DO: "bg-orange-100 text-orange-700",
  BN: "bg-yellow-100 text-yellow-700",
  INV: "bg-blue-100 text-blue-700",
  REC: "bg-green-100 text-green-700",
  TAX: "bg-red-100 text-red-700",
}

export default async function Home() {
  const session = await auth()
  if (!session) redirect("/login")

  let documents: Document[] = []
  try {
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
    const res = await fetch(`${baseUrl}/api/documents`, { cache: "no-store" })
    const data = await res.json()
    documents = data.documents || []
  } catch {
    documents = []
  }

  documents.sort((a, b) => (b.date > a.date ? 1 : -1))

  const totalDocs = documents.length
  const totalValue = documents.reduce((s, d) => s + d.grandTotal, 0)
  const draftCount = documents.filter((d) => d.status === "draft").length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">C</div>
          <div>
            <div className="font-semibold text-gray-900 text-sm leading-tight">Cecom Document System</div>
            <div className="text-xs text-gray-400">บริษัท ซีคอม ดับเบิ้ลพลัส จำกัด</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{session.user?.email}</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }) }}>
            <button type="submit" className="text-sm text-red-500 hover:text-red-700 font-medium">ออกจากระบบ</button>
          </form>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">เอกสารทั้งหมด</h1>
          <Link
            href="/documents/new"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + สร้างเอกสารใหม่
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm text-gray-500 mb-1">เอกสารทั้งหมด</div>
            <div className="text-3xl font-bold text-gray-900">{totalDocs}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm text-gray-500 mb-1">มูลค่ารวม</div>
            <div className="text-3xl font-bold text-gray-900">฿{formatNumber(totalValue)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm text-gray-500 mb-1">ร่างที่ค้างอยู่</div>
            <div className="text-3xl font-bold text-gray-900">{draftCount}</div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="mb-3 opacity-30"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="text-sm">ยังไม่มีเอกสาร</p>
              <Link href="/documents/new" className="mt-3 text-blue-600 text-sm hover:underline">สร้างเอกสารแรก →</Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">เลขที่</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ประเภท</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ลูกค้า</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">วันที่</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">มูลค่า</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">สถานะ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-gray-900">{doc.docNo}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[doc.type] || "bg-gray-100 text-gray-600"}`}>
                        {DOC_TYPE_LABELS[doc.type] || doc.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{doc.customer}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(doc.date)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">฿{formatNumber(doc.grandTotal)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[doc.status] || "bg-gray-100 text-gray-600"}`}>
                        {DOC_STATUS_LABELS[doc.status] || doc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/documents/${doc.id}`} className="text-blue-600 hover:text-blue-800 font-medium">ดู →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}
