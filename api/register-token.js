import admin from 'firebase-admin';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!admin.apps.length) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token requerido' });

    await admin.messaging().subscribeToTopic([token], 'org_all');
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
