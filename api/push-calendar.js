// api/push-calendar.js
import admin from "firebase-admin";

// --- Firebase Admin (desde env con JSON en una sola línea) ---
if (!admin.apps.length) {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) {
    console.error("FIREBASE_SERVICE_ACCOUNT missing");
  } else {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(svc)),
    });
  }
}
const db = admin.firestore();

// --- Helpers ---
const ISO = (d) => new Date(d).toISOString();

// Construye URL segura a events.list
function buildEventsUrl({ calendarId, apiKey, timeMin, timeMax, maxResults = 25 }) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId
  )}/events`;
  const params = new URLSearchParams({
    key: apiKey,
    singleEvents: "true",
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: String(maxResults),
  });
  return `${base}?${params.toString()}`;
}

// --- Handler ---
export default async function handler(req, res) {
  try {
    // CORS simple
    const o = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();

    const CAL_ID = process.env.GCAL_CALENDAR_ID;
    const API_KEY = process.env.GCAL_API_KEY;
    if (!CAL_ID || !API_KEY) {
      return res.status(500).json({ ok: false, error: "Missing GCAL_CALENDAR_ID or GCAL_API_KEY" });
    }

    // Ventana de consulta: hoy → +14 días (o force ⇒ +30 minutos hacia atrás para detectar cambios recientes)
    const now = new Date();
    const force = String(req.query.force || "") === "1";
    const timeMin = force ? ISO(new Date(now.getTime() - 30 * 60 * 1000)) : ISO(now);
    const timeMax = ISO(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));

    // Llama Google Calendar v3 /events
    const url = buildEventsUrl({ calendarId: CAL_ID, apiKey: API_KEY, timeMin, timeMax, maxResults: 50 });
    const rsp = await fetch(url);
    const text = await rsp.text();

    if (!rsp.ok) {
      // Devuelve el error crudo para diagnóstico
      return res.status(502).json({
        ok: false,
        error: "Google Calendar error",
        status: rsp.status,
        raw: text.slice(0, 500),
        url,
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({ ok: false, error: "Non-JSON response from Google", raw: text.slice(0, 500) });
    }

    const items = Array.isArray(data.items) ? data.items : [];

    // Lee tokens
    const snap = await db.collection("fcm_tokens").get();
    const tokens = [];
    snap.forEach((doc) => {
      const t = doc.get("token");
      if (typeof t === "string" && t.length > 0) tokens.push(t);
    });

    // Si no hay tokens o eventos, responde informativo
    if (!tokens.length) {
      return res.status(200).json({ ok: true, sent: 0, changed: 0, tokens: 0, items: items.length, note: "No tokens" });
    }
    if (!items.length) {
      return res.status(200).json({ ok: true, sent: 0, changed: 0, tokens: tokens.length, items: 0, note: "No upcoming events" });
    }

    // Arma un mensaje simple (título + fecha del próximo evento)
    const next = items[0];
    const summary = next.summary || "Nuevo evento";
    const startIso = next.start?.dateTime || next.start?.date || "";
    const when = startIso ? new Date(startIso).toLocaleString("es-PR", { dateStyle: "medium", timeStyle: "short" }) : "";

    const payload = {
      notification: {
        title: "Calendario actualizado",
        body: when ? `${summary} • ${when}` : summary,
      },
      data: {
        kind: "calendar_update",
        summary: summary || "",
        start: startIso || "",
        id: next.id || "",
      },
    };

    // Envía multicast
    const resp = await admin.messaging().sendEachForMulticast({ tokens, ...payload });

    // Limpia tokens inválidos (opcional)
    let cleaned = 0;
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.errorInfo?.code || r.error?.code || "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          const tok = tokens[idx];
          db.collection("fcm_tokens").doc(tok).delete().catch(() => {});
          cleaned++;
        }
      }
    });

    const sent = resp.responses.filter((r) => r.success).length;
    return res.status(200).json({
      ok: true,
      urlUsed: url,
      tokens: tokens.length,
      items: items.length,
      sent,
      failed: resp.responses.length - sent,
      cleaned,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
