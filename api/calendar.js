// /api/calendar.js
export default async function handler(req, res) {
  // CORS simple para que puedas llamar desde el navegador si quieres
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const API_KEY = process.env.GCAL_API_KEY;          // ya la creaste en Vercel
    const CAL_ID  = process.env.GCAL_CALENDAR_ID;      // tu calendar ID
    if (!API_KEY || !CAL_ID) {
      return res.status(500).json({ error: 'Faltan variables de entorno' });
    }

    // Parámetros opcionales (?max=10&timeMin=ISO)
    const urlParams = new URLSearchParams(req.query || {});
    const maxResults = Number(urlParams.get('max')) || 10;
    const timeMin = urlParams.get('timeMin') || new Date().toISOString(); // desde ahora

    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events`
    );
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('timeMin', timeMin);

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`Google Calendar HTTP ${r.status}`);
    const data = await r.json();

    // Respuesta compacta (puedes devolver data tal cual si prefieres)
    const items = (data.items || []).map(ev => ({
      id: ev.id,
      status: ev.status,
      summary: ev.summary || '',
      location: ev.location || '',
      start: ev.start?.dateTime || ev.start?.date || null,
      end: ev.end?.dateTime || ev.end?.date || null,
      updated: ev.updated || null,
    }));

    res.status(200).json({ ok: true, count: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
