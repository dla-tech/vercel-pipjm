// /api/push-calendar.js
// Lee eventos de Google Calendar y envía push a todos los tokens en Firestore
import { google } from "googleapis";
import admin from "firebase-admin";

// --- Init Firebase Admin (usa tu env var con el JSON de Firebase) ---
const svcEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!admin.apps.length && svcEnv) {
  const creds = JSON.parse(svcEnv);
  admin.initializeApp({
    credential: admin.credential.cert(creds),
  });
}
const db = () => admin.firestore();

function ok(res, data) { return res.status(200).json({ ok: true, ...data }); }
function fail(res, error, extra={}) { return res.status(500).json({ ok:false, error: String(error), ...extra }); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const CAL_ID = process.env.GCAL_CALENDAR_ID;
  const EMAIL  = process.env.GOOGLE_CLIENT_EMAIL;
  const KEY    = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!CAL_ID || !EMAIL || !KEY) {
    return fail(res, "Faltan GCAL_CALENDAR_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY");
  }
  if (!svcEnv) {
    return fail(res, "Falta FIREBASE_SERVICE_ACCOUNT (JSON del proyecto Firebase)");
  }

  try {
    // --- Auth Google Calendar ---
    const jwt = new google.auth.JWT(
      EMAIL, undefined, KEY,
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );
    const calendar = google.calendar({ version: "v3", auth: jwt });

    // --- Carga última sincronización ---
    const metaRef = db().collection("meta").doc("calendar");
    const metaSnap = await metaRef.get();
    const lastSync = metaSnap.exists ? metaSnap.data().last_sync_ts : null;

    // Trae próximos eventos (hoy → +30 días)
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { data } = await calendar.events.list({
      calendarId: CAL_ID,
      timeMin: now.toISOString(),
      timeMax: in30.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      maxResults: 50,
    });

    const items = data.items || [];

    // --- Filtra eventos nuevos/editados desde lastSync ---
    let changed = items;
    if (lastSync) {
      const last = new Date(lastSync).toISOString();
      changed = items.filter(ev => {
        const upd = ev.updated || ev.created || ev.start?.dateTime || ev.start?.date;
        return upd && upd > last;
      });
    }

    if (changed.length === 0) {
      await metaRef.set({ last_sync_ts: now.toISOString() }, { merge: true });
      return ok(res, { message: "Sin cambios", count: 0 });
    }

    // --- Prepara notificación ---
    const title = "Calendario actualizado";
    const body  = changed.length === 1
      ? `${changed[0].summary || "Evento"} — ${changed[0].start?.dateTime || changed[0].start?.date}`
      : `${changed.length} eventos nuevos o editados`;

    // --- Lee tokens ---
    const tokSnap = await db().collection("fcm_tokens").get();
    const tokens = tokSnap.docs.map(d => d.id).filter(Boolean);

    if (tokens.length === 0) {
      await metaRef.set({ last_sync_ts: now.toISOString() }, { merge: true });
      return ok(res, { message: "No hay tokens registrados", changed: changed.length });
    }

    // --- Envía push ---
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { type: "calendar_update", count: String(changed.length) },
    });

    // Limpia tokens inválidos
    const invalid = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.errorInfo?.code || r.error?.code || "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          invalid.push(tokens[i]);
        }
      }
    });
    if (invalid.length) {
      const batch = db().batch();
      invalid.forEach(t => batch.delete(db().collection("fcm_tokens").doc(t)));
      await batch.commit();
    }

    await metaRef.set({ last_sync_ts: now.toISOString() }, { merge: true });

    return ok(res, { changed: changed.length, sent: resp.successCount, failed: resp.failureCount, cleaned: invalid.length });

  } catch (err) {
    return fail(res, err?.message || err);
  }
}
