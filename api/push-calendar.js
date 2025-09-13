// DIAG v3 — sin batch, sin API key, solo JWT con service account
import { google } from "googleapis";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  const clientEmail = process.env.CALENDAR_CLIENT_EMAIL || "";
  const priv = (process.env.CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const calId = process.env.GOOGLE_CALENDAR_ID || "";

  const sig = { source: "push-calendar:diag-v3", clientEmail, hasKey: !!priv, calId };

  try {
    if (!clientEmail || !priv || !calId) {
      return res.status(500).json({ ok:false, ...sig, error:"Faltan env vars CALENDAR_* o GOOGLE_CALENDAR_ID" });
    }

    const jwt = new google.auth.JWT(clientEmail, null, priv, [
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    const calendar = google.calendar({ version: "v3", auth: jwt });

    const now = new Date();
    const events = await calendar.events.list({
      calendarId: calId,
      timeMin: new Date(now.getTime() - 24*60*60*1000).toISOString(),
      timeMax: new Date(now.getTime() + 24*60*60*1000).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 10,
    });

    const items = events.data.items || [];
    return res.status(200).json({ ok:true, ...sig, itemsCount: items.length });
  } catch (err) {
    return res.status(500).json({ ok:false, ...sig, error: err?.message || String(err) });
  }
}
