import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { google } from "googleapis"

const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID!

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { pdfBase64, filename } = await req.json()
  if (!pdfBase64 || !filename) {
    return NextResponse.json({ error: "Missing pdfBase64 or filename" }, { status: 400 })
  }

  try {
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: session.accessToken })
    const drive = google.drive({ version: "v3", auth: oauth2Client })

    const buffer = Buffer.from(pdfBase64, "base64")

    const file = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: "application/pdf",
        parents: [DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "application/pdf",
        body: require("stream").Readable.from(buffer),
      },
      fields: "id,webViewLink",
    })

    return NextResponse.json({
      success: true,
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("Drive upload error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
