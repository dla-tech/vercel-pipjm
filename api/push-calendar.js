// /api/push-calendar.js
// Empuja notificaciones tomando eventos desde TU endpoint /api/calendar,
// evitando cualquier uso del /batch de Google.

import admin from "firebase-admin";

const { FIREBASE_SERVICE_ACCOUNT } = process.env;

// Init Firebase Admin una sola vez
if (!admin.apps.length) {
  const svc = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}
const db = admin.firestore();

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
  // CORS básico
  const o = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // 1) Leer eventos desde tu propio endpoint /api/calendar
    const base = `https://${req.headers.host}`;
    const r = await fetch(`${base}/api/calendar`);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`calendar endpoint failed: ${r.status} ${txt.slice(0,200)}`);
    }
    const cal = await r.json();
    const items = Array.isArray(cal.items) ? cal.items : [];

    // 2) Leer tokens de Firestore
    const snap = await db.collection("fcm_tokens").get();
    const tokens = [];
    snap.forEach(d => { const t = d.get("token"); if (t) tokens.push(t); });

    // 3) Preparar mensaje (usa el primer evento si existe)
    let title = "Actualización del calendario";
    let body  = "Se han actualizado los eventos.";
    if (items.length) {
      const ev = items[0];
      title = ev.summary || title;
      const start = ev.start?.dateTime || ev.start?.date || "";
      if (start) body = `Inicio: ${start}`;
    }

    // 4) Enviar
    let sent = 0, failed = 0, cleaned = 0;
    for (const t of tokens) {
      const r = await sendToToken(t, {
        title,
        body,
        data: { type: "calendar_update", count: String(items.length) },
      });
      if (r.ok) sent++;
      else {
        failed++;
        if (r.error?.includes("registration-token-not-registered")
         || r.error?.includes("Requested entity was not found")) {
          await db.collection("fcm_tokens").doc(t).delete().catch(()=>{});
          cleaned++;
        }
      }
    }

    res.status(200).json({
      ok: true,
      via: "/api/calendar",
      tokens: tokens.length,
      items: items.length,
      sent, failed, cleaned,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
