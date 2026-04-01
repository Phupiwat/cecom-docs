export type DocType = "QT" | "SO" | "DO" | "BN" | "INV" | "REC" | "TAX"

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  QT: "ใบเสนอราคา",
  SO: "ใบสั่งขาย",
  DO: "ใบส่งของ",
  BN: "ใบวางบิล",
  INV: "ใบแจ้งหนี้",
  REC: "ใบเสร็จรับเงิน",
  TAX: "ใบกำกับภาษี",
}

export const DOC_STATUS_LABELS: Record<string, string> = {
  draft: "ร่าง",
  sent: "ส่งแล้ว",
  approved: "อนุมัติ",
  paid: "ชำระแล้ว",
  cancelled: "ยกเลิก",
}

export interface LineItem {
  description: string
  qty: number
  unit: string
  unitPrice: number
  amount: number
}

export interface Document {
  id: string
  docNo: string
  type: DocType
  customer: string
  customerAddress?: string
  customerTaxId?: string
  date: string
  dueDate?: string
  items: LineItem[]
  subtotal: number
  vatRate: number
  vat: number
  grandTotal: number
  status: string
  createdBy: string
  notes?: string
  driveFileId?: string
}

// Google Sheets row format: [id, docNo, type, customer, date, dueDate, subtotal, vat, grandTotal, status, createdBy, itemsJson, customerAddress, customerTaxId, notes, driveFileId]
export function rowToDocument(row: string[]): Document {
  let items: LineItem[] = []
  try { items = JSON.parse(row[11] || "[]") } catch { items = [] }
  return {
    id: row[0] || "",
    docNo: row[1] || "",
    type: (row[2] as DocType) || "QT",
    customer: row[3] || "",
    date: row[4] || "",
    dueDate: row[5] || "",
    subtotal: parseFloat(row[6]) || 0,
    vat: parseFloat(row[7]) || 0,
    grandTotal: parseFloat(row[8]) || 0,
    status: row[9] || "draft",
    createdBy: row[10] || "",
    items,
    vatRate: 7,
    customerAddress: row[12] || "",
    customerTaxId: row[13] || "",
    notes: row[14] || "",
    driveFileId: row[15] || "",
  }
}

export function documentToRow(doc: Document): string[] {
  return [
    doc.id,
    doc.docNo,
    doc.type,
    doc.customer,
    doc.date,
    doc.dueDate || "",
    String(doc.subtotal),
    String(doc.vat),
    String(doc.grandTotal),
    doc.status,
    doc.createdBy,
    JSON.stringify(doc.items),
    doc.customerAddress || "",
    doc.customerTaxId || "",
    doc.notes || "",
    doc.driveFileId || "",
  ]
}
