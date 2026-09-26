import { detectTelegramChats } from "@/lib/notify/telegram";

export const runtime = "nodejs";

export async function POST() {
  const r = await detectTelegramChats();
  if (!r.ok) return Response.json({ ok: false, message: r.error ?? "Telegram API error." });
  if (!r.chats || r.chats.length === 0) {
    return Response.json({
      ok: false,
      message: "No chats found yet.",
      hint: "Open Telegram, search for your bot (@notifyocibot), send it /start, then click Detect again.",
    });
  }
  return Response.json({ ok: true, chats: r.chats });
}
