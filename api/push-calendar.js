// api/push-calendar.js
import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    // Variables de entorno de Vercel
    const clientEmail = process.env.CALENDAR_CLIENT_EMAIL;
    const privateKey = process.env.CALENDAR_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!clientEmail || !privateKey || !calendarId) {
      return res.status(500).json({ ok: false, error: "Faltan credenciales en variables de entorno" });
    }

    // Autenticación con Service Account
    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    // Leer eventos desde ahora hasta 30 días adelante
    const now = new Date();
    const eventsResponse = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = eventsResponse.data.items || [];

    return res.status(200).json({
      ok: true,
      count: events.length,
      events: events.map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
      })),
    });
  } catch (err) {
    console.error("Error en push-calendar:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
