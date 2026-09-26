import { NextRequest } from "next/server";
import { getTelegramSettings, updateTelegramSettings, maskToken } from "@/lib/notify/telegram";

export const runtime = "nodejs";

export async function GET() {
  const s = getTelegramSettings();
  return Response.json({
    ok: true,
    enabled: s.enabled,
    chatId: s.chatId,
    heartbeatMin: s.heartbeatMin,
    botConfigured: Boolean(s.botToken),
    botMask: maskToken(s.botToken),
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const s = updateTelegramSettings({
    enabled: Boolean(body?.enabled),
    chatId: String(body?.chatId ?? ""),
    heartbeatMin: Number(body?.heartbeatMin) || 30,
    botToken: typeof body?.botToken === "string" ? body.botToken : undefined,
  });
  return Response.json({
    ok: true,
    enabled: s.enabled,
    chatId: s.chatId,
    heartbeatMin: s.heartbeatMin,
    botConfigured: Boolean(s.botToken),
    botMask: maskToken(s.botToken),
  });
}
