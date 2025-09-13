// /api/calendar.js  — SOLO JWT, sin API key
import { google } from "googleapis";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const clientEmail = process.env.CALENDAR_CLIENT_EMAIL;
    const privateKey  = (process.env.CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const calendarId  = process.env.GOOGLE_CALENDAR_ID;

    if (!clientEmail || !privateKey || !calendarId) {
      return res.status(500).json({ ok:false, error:"Faltan CALENDAR_CLIENT_EMAIL / CALENDAR_PRIVATE_KEY / GOOGLE_CALENDAR_ID" });
    }

    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const timeMin = new Date(now.getTime() - 24*60*60*1000).toISOString();
    const timeMax = new Date(now.getTime() + 60*24*60*1000).toISOString();

    const r = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });

    const items = r.data.items || [];
    return res.status(200).json({ ok:true, source:"calendar-jwt", itemsCount: items.length, items });
  } catch (err) {
    return res.status(500).json({ ok:false, source:"calendar-jwt", error: err.message });
  }
}

