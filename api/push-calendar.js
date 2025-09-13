// /api/push-calendar.js (CommonJS + API KEY)
const admin = require("firebase-admin");
const { google } = require("googleapis");

// Firebase Admin singleton
function initAdmin() {
  if (admin.apps.length) return admin.app();
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new Error("Falta FIREBASE_SERVICE_ACCOUNT (JSON)");
  return admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
}

const nowIso = () => new Date().toISOString();
const addDaysIso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

module.exports = async (req, res) => {
  try {
    const CAL_ID = process.env.GCAL_CALENDAR_ID;
    const API_KEY = process.env.GCAL_API_KEY;
    if (!CAL_ID || !API_KEY) {
      return res.status(500).json({ ok:false, error:"Faltan GCAL_CALENDAR_ID o GCAL_API_KEY" });
    }

    const app = initAdmin();
    const db = admin.firestore(app);

    const force = String(req.query?.force || "") === "1";
    const metaRef = db.collection("meta").doc("calendar");
    const metaSnap = await metaRef.get();
    const lastSync = (!force && metaSnap.exists) ? metaSnap.get("last_sync_ts") : null;

    // Ventana de consulta
    const timeMin = addDaysIso(-1);
    const timeMax = addDaysIso(30);

    // Google Calendar usando API KEY (NO requiere compartir con service account)
    const calendar = google.calendar({ version: "v3" });
    const params = {
      calendarId: CAL_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "updated",
      key: API_KEY
    };
    if (lastSync && !force) params.updatedMin = new Date(lastSync).toISOString();

    const { data } = await calendar.events.list(params);
    const items = data.items || [];

    if (!force && items.length === 0) {
      await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });
      return res.json({ ok:true, message:"Sin cambios", changed:0 });
    }

    // Tokens
    const tokSnap = await db.collection("fcm_tokens").get();
    const tokens = Array.from(new Set(tokSnap.docs.map(d => d.id).filter(Boolean)));
    if (tokens.length === 0) {
      await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });
      return res.json({ ok:true, message:"No hay tokens registrados", changed: items.length, sent:0 });
    }

    const title = "Calendario actualizado";
    const body = force
      ? "Notificación forzada del calendario."
      : `Se detectaron ${items.length} cambio(s) en el calendario.`;

    const payload = {
      notification: { title, body },
      data: { type: "calendar_update", count: String(items.length), ts: String(Date.now()) }
    };

    const resp = await admin.messaging().sendMulticast({ tokens, ...payload });

    // Limpieza de tokens inválidos
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
  } catch (e) {
    console.error("push-calendar ERROR:", e?.response?.data || e);
    // Si Google API trae error, lo exponemos para diagnóstico
    const details = e?.response?.data || { message: e.message };
    res.status(500).json({ ok:false, error:"Google Calendar/Push error", details });
  }
};
