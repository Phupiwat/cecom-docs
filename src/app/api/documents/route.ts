import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { google } from "googleapis"
import { documentToRow, rowToDocument } from "@/lib/types"
import { generateId } from "@/lib/utils"

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!
const SHEET = "Documents"

async function getSheets(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })
  return google.sheets({ version: "v4", auth: oauth2Client })
}

export async function GET() {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const sheets = await getSheets(session.accessToken)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A2:P`,
    })
    const rows = res.data.values || []
    const documents = rows.filter((r) => r[0]).map(rowToDocument)
    return NextResponse.json({ documents })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ documents: [] })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.error === "RefreshAccessTokenError")
    return NextResponse.json({ error: "SessionExpired" }, { status: 401 })
  try {
    const body = await req.json()
    const id = generateId()
    const doc = { ...body, id, createdBy: session.user?.email || "unknown" }
    const row = documentToRow(doc)
    const sheets = await getSheets(session.accessToken)
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A:P`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    })
    return NextResponse.json({ success: true, id, docNo: doc.docNo })
  } catch (e) {
    console.error("POST /api/documents error:", e)
    return NextResponse.json({ error: "InternalError" }, { status: 500 })
  }
}
