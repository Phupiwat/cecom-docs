import { handlers } from "@/auth"
import type { NextRequest } from "next/server"

type Context = { params: Promise<{ nextauth: string[] }> }

export async function GET(req: NextRequest, _ctx: Context) {
  return handlers.GET(req)
}

export async function POST(req: NextRequest, _ctx: Context) {
  return handlers.POST!(req)
}
