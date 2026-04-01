import { DocType } from "./types"

export function formatDate(dateStr: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
}

export function formatNumber(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function buildDocNo(type: DocType, counter: number, year?: number): string {
  const y = year ?? new Date().getFullYear() + 543 // Buddhist year
  const num = String(counter).padStart(4, "0")
  return `${type}-${y}-${num}`
}

export const COMPANY = {
  name: "บริษัท ซีคอม ดับเบิ้ลพลัส จำกัด",
  nameEn: "Cecom Double Plus Co., Ltd.",
  address: "กรุงเทพมหานคร",
  taxId: "",
  phone: "",
  email: "",
}
