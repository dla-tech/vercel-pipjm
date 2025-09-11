// /api/calendar.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const API_KEY = process.env.GCAL_API_KEY;
    const CAL_ID  = process.env.GCAL_CALENDAR_ID;

    if (!API_KEY || !CAL_ID) {
      return res.status(500).json({ error: "Faltan variables de entorno" });
    }

    // Endpoint de Google Calendar API
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      CAL_ID
    )}/events?singleEvents=true&orderBy=startTime&timeMin=${new Date().toISOString()}&key=${API_KEY}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
    const data = await r.json();

    res.status(200).json(data);
  } catch (err) {
    console.error("Error en /api/calendar:", err);
    res.status(500).json({ error: "No se pudieron obtener los eventos" });
  }
}

