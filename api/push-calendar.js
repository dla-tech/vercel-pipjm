import { google } from "googleapis";
import admin from "firebase-admin";

// --- Firebase Admin ---
const svcEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!admin.apps.length && svcEnv) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svcEnv)) });
}
const db = () => admin.firestore();

// Helpers
const ok   = (res, data) => res.status(200).json({ ok: true, ...data });
const fail = (res, err, extra={}) => res.status(500).json({ ok: false, error: String(err), ...extra });

// Divide un array en trozos de n elementos (FCM máx. 500 tokens por envío)
function chunk(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Fecha/hora local Puerto Rico
const fmtPR = new Intl.DateTimeFormat("es-PR", { dateStyle: "short", timeStyle: "short", hour12: true });
const whenStr = (ev) => {
  const s = ev.start?.dateTime || ev.start?.date;
  if (!s) return "";
  const d = ev.start?.dateTime ? new Date(s) : new Date(s + "T00:00:00-04:00");
  return fmtPR.format(d);
};

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
    const jwt = new google.auth.JWT(EMAIL, undefined, KEY, ["https://www.googleapis.com/auth/calendar.readonly"]);
    const calendar = google.calendar({ version: "v3", auth: jwt });

    // --- Última sync ---
    const metaRef  = db().collection("meta").doc("calendar");
    const metaSnap = await metaRef.get();
    const lastSync = metaSnap.exists ? metaSnap.data().last_sync_ts : null;

    // --- Traer eventos próximos (hoy → +30 días) ---
    const now  = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { data } = await calendar.events.list({
      calendarId: CAL_ID,
      timeMin: now.toISOString(),
      timeMax: in30.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      maxResults: 100,
    });
    const items = data.items || [];

    // --- Filtrar por cambios desde la última sync ---
    let changed = items;
    if (lastSync) {
      const since = new Date(lastSync).toISOString();
      changed = items.filter(ev => {
        const upd = ev.updated || ev.created || ev.start?.dateTime || ev.start?.date;
        return upd && upd > since;
      });
    }

    // Si no hay cambios → actualiza timestamp y sal
    if (changed.length === 0) {
      await metaRef.set({ last_sync_ts: now.toISOString() }, { merge: true });
      return ok(res, { message: "Sin cambios", changed: 0 });
    }

    // --- Tokens registrados ---
    const tokSnap = await db().collection("fcm_tokens").get();
    const tokens = tokSnap.docs.map(d => d.id).filter(Boolean);
    if (tokens.length === 0) {
      await metaRef.set({ last_sync_ts: now.toISOString() }, { merge: true });
      return ok(res, { message: "No hay tokens registrados", changed: changed.length, sent: 0 });
    }

    // --- Enviar una notificación por evento ---
    let sentTotal = 0, failedTotal = 0, cleaned = 0;
    const tokenChunks = chunk(tokens, 500);

    for (const ev of changed) {
      const title = ev.summary || "Evento";
      const body  = whenStr(ev);

      for (const group of tokenChunks) {
        const resp = await admin.messaging().sendEachForMulticast({
          tokens: group,
          notification: { title, body },
          data: {
            type: "calendar_update",
            eventId: ev.id || "",
            start: ev.start?.dateTime || ev.start?.date || "",
            location: ev.location || "",
          },
        });

        sentTotal   += resp.successCount;
        failedTotal += resp.failureCount;

        // Limpia tokens inválidos
        const invalid = [];
        resp.responses.forEach((r, i) => {
          if (!r.success) {
            const code = r.error?.errorInfo?.code || r.error?.code || "";
            if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
              invalid.push(group[i]);
            }
          }
        });
        if (invalid.length) {
          const batch = db().batch();
          invalid.forEach(t => batch.delete(db().collection("fcm_tokens").doc(t)));
          await batch.commit();
          cleaned += invalid.length;
        }
      }
    }

    // Guardar timestamp de sync
    await metaRef.set({ last_sync_ts: now.toISOString() }, { merge: true });

    return ok(res, {
      changed: changed.length,
      sent: sentTotal,
      failed: failedTotal,
      cleaned
    });

  } catch (err) {
    return fail(res, err?.message || err);
  }
}
