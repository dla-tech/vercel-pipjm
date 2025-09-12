// /api/push-calendar.js
import { google } from 'googleapis';
import admin from 'firebase-admin';

// ---------- CORS sencillo ----------
function setCORS(req, res) {
  const o = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// ---------- Firebase Admin (singleton) ----------
function initAdmin() {
  if (admin.apps.length) return admin.app();
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT (JSON)');

  const conf = JSON.parse(sa);
  return admin.initializeApp({
    credential: admin.credential.cert(conf)
  });
}

// ---------- Helpers ----------
const nowIso = () => new Date().toISOString();
const addDays = (d) => {
  const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString();
};

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    if (setCORS(req, res)) return;

    // Env vars requeridas
    const CAL_ID = process.env.GCAL_CALENDAR_ID;
    const API_KEY = process.env.GCAL_API_KEY;
    if (!CAL_ID || !API_KEY) {
      return res.status(500).json({ ok:false, error:'Faltan GCAL_CALENDAR_ID o GCAL_API_KEY' });
    }

    // Firebase
    const app = initAdmin();
    const db = admin.firestore(app);

    // Leer last_sync_ts (o forzar)
    const force = String(req.query.force || '') === '1';
    const metaRef = db.collection('meta').doc('calendar');
    const metaSnap = await metaRef.get();
    let lastSync = null;
    if (!force && metaSnap.exists) lastSync = metaSnap.get('last_sync_ts');

    // Ventana de eventos (hoy-1d a hoy+30d)
    const timeMin = addDays(-1);
    const timeMax = addDays(30);

    // Llamada a Google Calendar con API KEY (cal público)
    const calendar = google.calendar({ version: 'v3', auth: API_KEY });
    const listParams = {
      calendarId: CAL_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'updated'
    };
    if (lastSync && !force) listParams.updatedMin = new Date(lastSync).toISOString();

    const { data } = await calendar.events.list(listParams);
    const items = data.items || [];

    // Detectar cambios "relevantes" (creados/actualizados dentro de ventana)
    const changed = items.length;

    // Si no hay cambios y no forzamos, salir rápido
    if (!force && changed === 0) {
      // Actualiza last_sync_ts por si acaso
      await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });
      return res.json({ ok:true, message:'Sin cambios', changed:0 });
    }

    // Cargar tokens
    const tokSnap = await db.collection('fcm_tokens').get();
    const tokens = tokSnap.docs.map(d => d.id).filter(Boolean);

    if (tokens.length === 0) {
      await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });
      return res.json({ ok:true, message:'No hay tokens registrados', changed, sent:0 });
    }

    // Construir notificación (muy simple y clara)
    const title = 'Calendario actualizado';
    const body = force
      ? 'Se enviaron notificaciones de calendario.'
      : `Se detectaron ${changed} cambio(s) en el calendario.`;

    // Enviar multicast
    const msg = {
      notification: { title, body },
      data: {
        type: 'calendar_update',
        count: String(changed || 0),
        ts: String(Date.now())
      }
    };

    const resp = await admin.messaging().sendMulticast({ tokens, ...msg });

    // Limpiar tokens inválidos
    let cleaned = 0;
    await Promise.all(resp.responses.map(async (r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (code.includes('registration-token-not-registered') || code.includes('messaging/invalid-registration-token')) {
          cleaned++;
          try { await db.collection('fcm_tokens').doc(tokens[i]).delete(); } catch {}
        }
      }
    }));

    // Guardar nuevo last_sync_ts
    await metaRef.set({ last_sync_ts: nowIso() }, { merge: true });

    return res.json({
      ok: true,
      changed,
      sent: resp.successCount,
      failed: resp.failureCount,
      cleaned
    });
  } catch (err) {
    console.error('push-calendar ERROR:', err);
    return res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
}
