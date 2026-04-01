import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { google } from "googleapis"

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!

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
      range: "Counters!A2:B",
    })
    const counters: Record<string, number> = {}
    const rows = res.data.values || []
    rows.forEach(([type, count]) => { counters[type] = parseInt(count) || 1 })
    return NextResponse.json({ counters })
  } catch {
    return NextResponse.json({ counters: {} })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { type, value } = await req.json()
  const sheets = await getSheets(session.accessToken)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Counters!A:B",
  })
  const rows = res.data.values || []
  const rowIndex = rows.findIndex(r => r[0] === type)
  if (rowIndex >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Counters!B${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    })
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Counters!A:B",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[type, value]] },
    })
  }
  return NextResponse.json({ success: true })
}
