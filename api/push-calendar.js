import admin from "firebase-admin";
import { google } from "googleapis";

// Inicializar Firebase Admin solo una vez
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  try {
    // Autenticación con Google Calendar usando Service Account
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    // ID de tu calendario público (pon el correcto aquí)
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    // Leer eventos del calendario
    const now = new Date();
    const events = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    const items = events.data.items || [];

    let changes = 0;
    let sent = 0;
    let failed = 0;

    // Revisa si hubo cambios (aquí podrías guardar "último estado" en Firestore si quieres más precisión)
    for (const ev of items) {
      changes++;
      const payload = {
        notification: {
          title: "📅 Calendario actualizado",
          body: `Evento: ${ev.summary || "Sin título"}`,
        },
        data: {
          eventId: ev.id || "",
          link: ev.htmlLink || "",
        },
      };

      // Enviar notificación a todos los tokens registrados
      const tokensSnap = await db.collection("fcm_tokens").get();
      for (const doc of tokensSnap.docs) {
        const token = doc.id;
        try {
          await admin.messaging().sendToDevice(token, payload);
          sent++;
        } catch (e) {
          failed++;
          console.error("Error enviando a token:", token, e.message);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      message: "Push-calendar ejecutado",
      count: items.length,
      changed: changes,
      sent,
      failed,
    });
  } catch (error) {
    console.error("Error en push-calendar:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
