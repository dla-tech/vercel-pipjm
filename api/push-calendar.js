import { google } from "googleapis";
import admin from "firebase-admin";

// Inicializar Firebase solo una vez
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Autenticación con Service Account de Calendar
const auth = new google.auth.JWT(
  process.env.CALENDAR_CLIENT_EMAIL,
  null,
  process.env.CALENDAR_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/calendar.readonly"]
);

const calendar = google.calendar({ version: "v3", auth });

export default async function handler(req, res) {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    // Leer próximos eventos
    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = eventsRes.data.items || [];

    // (Opcional) enviar notificaciones a los tokens en Firestore
    if (events.length > 0) {
      const tokensSnap = await admin.firestore().collection("fcm_tokens").get();
      const tokens = tokensSnap.docs.map((doc) => doc.id);

      if (tokens.length > 0) {
        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: "Calendario actualizado",
            body: `Se detectaron ${events.length} eventos próximos.`,
          },
        });
      }
    }

    res.status(200).json({
      ok: true,
      message: events.length ? "Eventos encontrados" : "Sin cambios",
      changed: events.length,
    });
  } catch (err) {
    console.error("Error en push-calendar:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
