// api/push-calendar.js — JWT ONLY (sin API key, sin /batch)
import { google } from "googleapis";
import admin from "firebase-admin";

// Inicializa Firebase Admin una sola vez con FIREBASE_SERVICE_ACCOUNT (JSON)
if (!admin.apps.length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

export default async function handler(req, res) {
  try {
    const clientEmail = process.env.CALENDAR_CLIENT_EMAIL;
    const privateKey  = (process.env.CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const calendarId  = process.env.GOOGLE_CALENDAR_ID; // NO usar GCAL_API_KEY

    if (!clientEmail || !privateKey || !calendarId) {
      return res.status(500).json({
        ok: false,
        error: "Faltan CALENDAR_CLIENT_EMAIL / CALENDAR_PRIVATE_KEY / GOOGLE_CALENDAR_ID",
        _sig: "push:jwt-only"
      });
    }

    // Auth JWT (Service Account)
    const auth = new google.auth.JWT(
      clientEmail, null, privateKey, ["https://www.googleapis.com/auth/calendar.readonly"]
    );
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin: new Date(now.getTime() - 10 * 60 * 1000).toISOString(), // últimos 10 min
      timeMax: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 días
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });

    const items = eventsRes.data.items || [];

    // Enviar notificación (si hay tokens)
    const snap = await admin.firestore().collection("fcm_tokens").get();
    const tokens = snap.docs.map(d => d.id);
    if (tokens.length) {
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: "Calendario actualizado",
          body: `Hay ${items.length} evento(s) próximo(s).`,
        },
        data: { _src: "push-calendar" }
      });
    }

    return res.status(200).json({
      ok: true,
      changed: items.length,
      _sig: "push:jwt-only"
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, _sig: "push:jwt-
