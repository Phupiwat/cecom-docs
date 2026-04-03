import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { google } from "googleapis"
import { documentToRow, rowToDocument } from "@/lib/types"

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!
const SHEET = "Documents"

async function getSheets(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })
  return google.sheets({ version: "v4", auth: oauth2Client })
}

async function findRowIndex(sheets: ReturnType<typeof google.sheets>, id: string): Promise<number> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A:A`,
  })
  const rows = res.data.values || []
  // row 0 is header, so actual sheet row = index + 2
  return rows.findIndex((r, i) => i > 0 && r[0] === id)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sheets = await getSheets(session.accessToken)
  const idx = await findRowIndex(sheets, id)
  if (idx < 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const sheetRow = idx + 1 // rows[idx] → sheet row idx+1 (header is row 1, data starts row 2)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A${sheetRow}:P${sheetRow}`,
  })
  const row = res.data.values?.[0]
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ document: rowToDocument(row) })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const sheets = await getSheets(session.accessToken)
  const idx = await findRowIndex(sheets, id)
  if (idx < 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const sheetRow = idx + 1 // rows[idx] → sheet row idx+1
  const doc = { ...body, id }
  const row = documentToRow(doc)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A${sheetRow}:P${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  })
  return NextResponse.json({ success: true })
}
