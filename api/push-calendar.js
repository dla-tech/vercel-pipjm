// /api/push-calendar.js
// Lee eventos de Google Calendar (sin batch) y envía notificaciones FCM a los tokens guardados.

import admin from "firebase-admin";
import { google } from "googleapis";

const {
  GCAL_API_KEY,
  GCAL_CALENDAR_ID,
  FIREBASE_SERVICE_ACCOUNT,
} = process.env;

// ——— Inicializar Firebase Admin (una sola vez) ———
if (!admin.apps.length) {
  const serviceJson = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceJson),
  });
}
const db = admin.firestore();

// Utilidad: leer eventos próximos (24h por defecto)
async function fetchCalendarEvents() {
  if (!GCAL_CALENDAR_ID) throw new Error("Falta GCAL_CALENDAR_ID");
  if (!GCAL_API_KEY) throw new Error("Falta GCAL_API_KEY");

  const calendar = google.calendar("v3");

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  const resp = await calendar.events.list({
    calendarId: GCAL_CALENDAR_ID,
    key: GCAL_API_KEY,              // <- SIN OAuth, con API key pública
    singleEvents: true,
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: 50,
  });

  return {
    items: resp.data.items ?? [],
    urlUsed: resp.config?.url || "calendar.events.list",
  };
}

// Utilidad: enviar push a un token
async function sendToToken(token, payload) {
  try {
    await admin.messaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export default async function handler(req, res) {
  try {
    // CORS básico
    const o = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();

    // 1) Leer eventos (SIN batch)
    const { items, urlUsed } = await fetchCalendarEvents();

    // 2) Leer tokens FCM de Firestore
    const snap = await db.collection("fcm_tokens").get();
    const tokens = [];
    snap.forEach((d) => {
      const t = d.get("token");
      if (t) tokens.push(t);
    });

    // 3) Crear el mensaje a enviar (ejemplo simple con primer evento)
    let sent = 0, failed = 0, cleaned = 0;
    let title = "Actualización del calendario";
    let body = "Se han actualizado los eventos.";
    if (items.length) {
      const ev = items[0];
      title = ev.summary || "Evento actualizado";
      const start =
        ev.start?.dateTime || ev.start?.date || "";
      body = start ? `Inicio: ${start}` : "Revisa el calendario";
    }

    // 4) Enviar a cada token
    for (const t of tokens) {
      const r = await sendToToken(t, {
        title,
        body,
        data: {
          type: "calendar_update",
          count: String(items.length),
        },
      });
      if (r.ok) sent++;
      else {
        failed++;
        // Marcar tokens inválidos
        if (r.error?.includes("registration-token-not-registered") ||
            r.error?.includes("Requested entity was not found")) {
          await db.collection("fcm_tokens").doc(t).delete().catch(() => {});
          cleaned++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      urlUsed,
      tokens: tokens.length,
      items: items.length,
      sent,
      failed,
      cleaned,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
