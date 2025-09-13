// api/calendar.js — lee eventos usando Service Account (JWT), sin API key
import { google } from "googleapis";

export default async function handler(req, res) {
  // CORS básico (opcional)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // Vars de entorno (mismas que usas en push-calendar)
    const clientEmail = process.env.CALENDAR_CLIENT_EMAIL;
    const privateKey  = (process.env.CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const calendarId  = process.env.GOOGLE_CALENDAR_ID;

    if (!clientEmail || !privateKey || !calendarId) {
      return res.status(500).json({
        ok: false,
        error: "Faltan CALENDAR_CLIENT_EMAIL / CALENDAR_PRIVATE_KEY / GOOGLE_CALENDAR_ID",
      });
    }

    // Auth con Service Account
    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );
    const calendar = google.calendar({ version: "v3", auth });

    // Parámetros (opcionales) ?days=30&max=20
    const days = Math.max(1, Math.min(parseInt(req.query.days || "30", 10), 90));
    const maxResults = Math.max(1, Math.min(parseInt(req.query.max || "50", 10), 250));

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

    // Consulta
    const r = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults,
    });

    const items = (r.data.items || []).map(e => ({
      id: e.id,
      status: e.status,
      updated: e.updated,
      summary: e.summary || "",
      description: e.description || "",
      location: e.location || "",
      start: e.start,
      end: e.end,
      htmlLink: e.htmlLink,
    }));

    return res.status(200).json({
      ok: true,
      count: items.length,
      items,
      _sig: "calendar:jwt", // firmita para que confirmes qué versión corre
    });
  } catch (err) {
    console.error("calendar.js error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
