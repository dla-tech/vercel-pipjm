import { google } from "googleapis";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const CAL_ID = process.env.GCAL_CALENDAR_ID;
  const EMAIL  = process.env.GOOGLE_CLIENT_EMAIL;
  const KEYRAW = process.env.GOOGLE_PRIVATE_KEY;

  const dbg = { has_CAL_ID: !!CAL_ID, has_EMAIL: !!EMAIL, has_KEY: !!KEYRAW };

  try {
    if (!CAL_ID || !EMAIL || !KEYRAW) {
      return res.status(500).json({
        ok: false, where: "env",
        error: "Faltan GCAL_CALENDAR_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY",
        dbg
      });
    }

    const KEY = KEYRAW.replace(/\\n/g, "\n");

    const jwt = new google.auth.JWT(
      EMAIL, undefined, KEY,
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );
    const calendar = google.calendar({ version: "v3", auth: jwt });

    const { data } = await calendar.events.list({
      calendarId: CAL_ID,
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 10,
      showDeleted: false
    });

    return res.status(200).json({
      ok: true,
      count: (data.items || []).length,
      items: (data.items || []).map(ev => ({
        id: ev.id,
        summary: ev.summary || "",
        start: ev.start?.dateTime || ev.start?.date || null,
        end:   ev.end?.dateTime   || ev.end?.date   || null
      }))
    });
  } catch (err) {
    return res.status(500).json({
      ok: false, where: "google",
      error: String(err?.message || err),
      dbg
    });
  }
}
