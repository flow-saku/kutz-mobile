import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_ADDRESS      = Deno.env.get('FROM_EMAIL') ?? 'Kutz <no-reply@kutz.io>';
const _SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? '';
const _SUPABASE_ANON    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const _SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  if (_SERVICE_ROLE_KEY && token === _SERVICE_ROLE_KEY) return true;
  const res = await fetch(`${_SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': _SUPABASE_ANON },
  });
  return res.ok;
}

function fmt12(t: string) {
  try {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}

function formatDate(dateStr: string) {
  try {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const date = new Date(y, mo - 1, d);
    return `${days[date.getDay()]}, ${months[mo - 1]} ${d}, ${y}`;
  } catch { return dateStr; }
}

// This function is designed to be called two ways:
// 1. Directly with a single appointment's data (from the app)
// 2. By a pg_cron job — in that case it queries Supabase itself for
//    all appointments starting in ~24h and emails them all.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));

    // ── Single appointment mode (called directly) ─────────────────────────────
    if (body.to && body.appointmentDate) {
      return await sendSingle(body);
    }

    // ── Batch mode (called by pg_cron via Supabase) ───────────────────────────
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Supabase env vars not set for batch mode' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find appointments starting in 23–25 hours (24h window)
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // Format as date strings for querying
    const startDate = windowStart.toISOString().slice(0, 10);
    const endDate   = windowEnd.toISOString().slice(0, 10);

    const apptRes = await fetch(
      `${SUPABASE_URL}/rest/v1/appointments?select=id,client_name,client_id,service_name,date,start_time,price,barber_id&status=eq.confirmed&date=gte.${startDate}&date=lte.${endDate}`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const appointments = await apptRes.json();
    if (!Array.isArray(appointments) || !appointments.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    for (const apt of appointments) {
      // Filter to only appointments within the 24h window based on time
      const aptDateTime = new Date(`${apt.date}T${apt.start_time}`);
      if (aptDateTime < windowStart || aptDateTime > windowEnd) continue;

      // Fetch client email from profiles
      if (!apt.client_id) continue;
      const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=email&id=eq.${apt.client_id}`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const profiles = await profileRes.json();
      const clientEmail = profiles?.[0]?.email;
      if (!clientEmail) continue;

      // Fetch shop name from barber profile
      const barberRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=shop_name,email&id=eq.${apt.barber_id}`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const barbers = await barberRes.json();
      const shopName   = barbers?.[0]?.shop_name ?? 'your barber';
      const barberEmail = barbers?.[0]?.email ?? null;

      await sendSingle({
        to: clientEmail,
        clientName: apt.client_name,
        shopName,
        serviceName: apt.service_name,
        appointmentDate: apt.date,
        appointmentTime: apt.start_time,
        barberEmail,
        bookingLink: `https://app.kutz.io/c/${apt.barber_id}`,
      });
      sent++;
    }

    return new Response(JSON.stringify({ sent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-reminder] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function sendSingle(params: {
  to: string;
  clientName: string;
  shopName: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  barberEmail?: string | null;
  bookingLink?: string;
}) {
  const { to, clientName, shopName, serviceName, appointmentDate, appointmentTime, barberEmail, bookingLink } = params;

  const dateFormatted = formatDate(appointmentDate);
  const timeFormatted = fmt12(appointmentTime.slice(0, 5));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Tomorrow</title>
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#111827;border-radius:12px 12px 0 0;padding:32px;text-align:center;">
              <p style="margin:0 0 8px;color:#9ca3af;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Kutz</p>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">You're up tomorrow ✂️</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px;border-radius:0 0 12px 12px;">
              <p style="margin:0 0 24px;color:#374151;font-size:16px;line-height:1.6;">
                Hey ${clientName}, just a reminder — you've got an appointment at <strong>${shopName}</strong> tomorrow.
              </p>

              <!-- Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f3f4f6;">
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;width:40%;">Date</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${dateFormatted}</td>
                </tr>
                <tr><td colspan="2" style="border-bottom:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;">Time</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${timeFormatted}</td>
                </tr>
                <tr><td colspan="2" style="border-bottom:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;">Service</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${serviceName}</td>
                </tr>
              </table>

              ${bookingLink ? `
              <div style="text-align:center;margin-top:32px;">
                <a href="${bookingLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
                  Manage Booking
                </a>
              </div>` : ''}

              <p style="margin:32px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                Need to cancel or reschedule? Open the Kutz app as soon as possible.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                © ${new Date().getFullYear()} Kutz · <a href="https://kutz.io" style="color:#9ca3af;">kutz.io</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `You're up tomorrow — ${shopName}

Hey ${clientName}, reminder about your appointment tomorrow.

Date: ${dateFormatted}
Time: ${timeFormatted}
Service: ${serviceName}

Need to cancel? Open the Kutz app ASAP.

© ${new Date().getFullYear()} Kutz`;

  const payload: any = {
    from: FROM_ADDRESS,
    to: Array.isArray(to) ? to : [to],
    subject: `Tomorrow: ${serviceName} at ${shopName} — ${timeFormatted}`,
    html,
    text,
  };
  if (barberEmail) payload.reply_to = barberEmail;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) console.error('[send-reminder] Resend error:', data);
  return new Response(JSON.stringify({ id: data.id }), {
    status: res.ok ? 200 : res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
