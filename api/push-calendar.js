// /api/push-calendar.js
import admin from "firebase-admin";
import { google } from "googleapis";

// ---- CORS básico (GET/OPTIONS) ----
function setCORS(req, res) {
  const o = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

// ---- Firebase Admin singleton ----
function initAdmin() {
  if (admin.apps.length) return admin.app();
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new Error("Falta FIREBASE_SERVICE_ACCOUNT (JSON del proyecto Firebase)");
  const cred = JSON.parse(sa);
  return admin.initializeApp({ credential: admin.credential.cert(cred) });
}

// ---- Utils ----
const nowIso = () => new Date().toISOString();
const addDaysIso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

// ---- Handler ----
export default async function handler(req, res) {
  try {
    if (setCORS(req, res)) return;

    const CAL_ID = process.env.GCAL_CALENDAR_ID;
    const API_KEY = process.env.GCAL_API_KEY;
    if (!CAL_ID || !API_KEY) {
      return res.status(500).json({ ok:false, error:"Faltan GCAL_CALENDAR_ID o GCAL_API_KEY" });
    }

    const app = initAdmin();
    const db = admin.firestore(app);

    // Lectura de meta (para delta por updated)
    const force = String(req.query?.force || "") === "1";
    const metaRef = db.collection("meta").doc("calendar");
    const metaSnap = await metaRef.get();
    const lastSync = (!force && metaSnap.exists) ? metaSnap.get("last_sync_ts") : null;

    // Ventana: ayer -> +30 días
    const timeMin = addDaysIso(-1);
    const timeMax = addDaysIso(30);

    // Google Calendar con API KEY (cal público)
    const calendar = google.calendar({ version: "v3", auth: API_KEY });
    const params = {
      calendarId: CAL_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "updated"
    };
    if (lastSync && !force) params.updatedMin = new Date(lastSync).toISOString();

    const { data } = await calendar.events.list(params);
    const items = data.items || [];

    // Si no hay cambios (sin force), salimos rápido
    if (!force && items.length === 0) {
      await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });
      return res.json({ ok:true, message:"Sin cambios", changed:0 });
    }

    // Cargar tokens y deduplicar
    const tokSnap = await db.collection("fcm_tokens").get();
    const tokens = Array.from(new Set(tokSnap.docs.map(d => d.id).filter(Boolean)));
    if (tokens.length === 0) {
      await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });
      return res.json({ ok:true, message:"No hay tokens registrados", changed: items.length, sent:0 });
    }

    // Notificación simple (una por corrida)
    const title = "Calendario actualizado";
    const body = force
      ? "Se envió notificación forzada del calendario."
      : `Se detectaron ${items.length} cambio(s) en el calendario.`;

    const msg = {
      notification: { title, body },
      data: {
        type: "calendar_update",
        count: String(items.length),
        ts: String(Date.now())
      }
    };

    const resp = await admin.messaging().sendMulticast({ tokens, ...msg });

    // Limpiar tokens inválidos
    let cleaned = 0;
    await Promise.all(resp.responses.map(async (r, i) => {
      if (!r.success) {
        const code = r.error?.code || "";
        if (code.includes("registration-token-not-registered") || code.includes("messaging/invalid-registration-token")) {
          cleaned++;
          try { await db.collection("fcm_tokens").doc(tokens[i]).delete(); } catch {}
        }
      }
    }));

    await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });

    res.json({ ok:true, changed: items.length, sent: resp.successCount, failed: resp.failureCount, cleaned });
  } catch (err) {
    console.error("push-calendar ERROR:", err);
    res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
}
