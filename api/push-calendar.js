import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const clientEmail = process.env.CALENDAR_CLIENT_EMAIL;
    const privateKey  = (process.env.CALENDAR_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const calendarId  = process.env.GOOGLE_CALENDAR_ID;

    if (!clientEmail || !privateKey || !calendarId) {
      return res.status(500).json({ ok:false, error:"Faltan CALENDAR_CLIENT_EMAIL / CALENDAR_PRIVATE_KEY / GOOGLE_CALENDAR_ID" });
    }

    const auth = new google.auth.JWT(
      clientEmail, null, privateKey, ["https://www.googleapis.com/auth/calendar.readonly"]
    );
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const r = await calendar.events.list({
      calendarId,
      timeMin: new Date(now.getTime() - 24*60*60*1000).toISOString(),
      timeMax: new Date(now.getTime() + 24*60*60*1000).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 10,
    });

    return res.status(200).json({ ok:true, source:"jwt-only", itemsCount:(r.data.items||[]).length });
  } catch (err) {
    return res.status(500).json({ ok:false, error:err.message });
  }
}
