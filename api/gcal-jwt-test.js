// api/gcal-jwt-test.js
import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const clientEmail = process.env.CALENDAR_CLIENT_EMAIL;
    const privateKey  = (process.env.CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const calendarId  = process.env.GOOGLE_CALENDAR_ID;

    if (!clientEmail || !privateKey || !calendarId) {
      return res.status(500).json({ ok:false, where:"env", error:"Faltan CALENDAR_* envs" });
    }

    const auth = new google.auth.JWT(
      clientEmail, null, privateKey, ["https://www.googleapis.com/auth/calendar.readonly"]
    );
    // prueba de token sin pedir eventos
    await auth.authorize();

    const calendar = google.calendar({ version: "v3", auth });
    const r = await calendar.events.list({
      calendarId,
      timeMin: new Date(Date.now() - 3600e3).toISOString(),
      timeMax: new Date(Date.now() + 3600e3).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 1,
    });

    return res.status(200).json({
      ok:true, source:"jwt-test", itemsCount:(r.data.items||[]).length
    });
  } catch (err) {
    return res.status(500).json({ ok:false, source:"jwt-test", error: String(err) });
  }
}
