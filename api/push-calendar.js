import { google } from "googleapis";
import admin from "firebase-admin";

// Inicializar Firebase Admin con credenciales del Service Account
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Configuración de Google Calendar API
const calendar = google.calendar({
  version: "v3",
  auth: new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar.readonly"]
  ),
});

export default async function handler(req, res) {
  try {
    // ID de tu calendario (puede ser el público de tu iglesia)
    const calendarId = process.env.CALENDAR_ID;

    // Obtener eventos recientes
    const events = await calendar.events.list({
      calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
    });

    const snapshot = await db.collection("fcm_tokens").get();
    const tokens = snapshot.docs.map(doc => doc.id);

    if (!tokens.length) {
      return res.status(200).json({ ok: true, message: "No hay tokens registrados" });
    }

    // Preparar notificación
    const message = {
      notification: {
        title: "📅 Calendario actualizado",
        body: `Hay ${events.data.items.length} eventos próximos`,
      },
      tokens,
    };

    // Enviar notificación a todos los tokens
    const response = await admin.messaging().sendMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: response.successCount,
      failed: response.failureCount,
    });
  } catch (error) {
    console.error("Error en push-calendar:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
