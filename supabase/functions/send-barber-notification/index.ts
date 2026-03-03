import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_ADDRESS = Deno.env.get('FROM_EMAIL') ?? 'Kutz <no-reply@kutz.io>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const {
      to,           // barber's email
      barberName,   // barber's name / shop name
      clientName,
      serviceName,
      appointmentDate,
      appointmentTime,
      price,
      clientEmail,  // so barber can reply to client
    } = await req.json();

    if (!to || !clientName || !serviceName || !appointmentDate || !appointmentTime) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dateFormatted = formatDate(appointmentDate);
    const timeFormatted = fmt12(appointmentTime.slice(0, 5));
    const priceText = price != null ? `$${Number(price).toFixed(2)}` : null;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Booking</title>
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
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">New Booking 🎉</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px;border-radius:0 0 12px 12px;">
              <p style="margin:0 0 24px;color:#374151;font-size:16px;line-height:1.6;">
                Hey${barberName ? ` ${barberName}` : ''}, you've got a new booking!
              </p>

              <!-- Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f3f4f6;">
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;width:40%;">Client</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${clientName}</td>
                </tr>
                <tr><td colspan="2" style="border-bottom:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;">Service</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${serviceName}</td>
                </tr>
                <tr><td colspan="2" style="border-bottom:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;">Date</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${dateFormatted}</td>
                </tr>
                <tr><td colspan="2" style="border-bottom:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;">Time</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${timeFormatted}</td>
                </tr>
                ${priceText ? `
                <tr><td colspan="2" style="border-bottom:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-size:14px;">Price</td>
                  <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${priceText}</td>
                </tr>` : ''}
              </table>

              <p style="margin:32px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                Open the Kutz app to manage your schedule.${clientEmail ? ` Reply to this email to contact ${clientName} directly.` : ''}
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

    const text = `New Booking — Kutz

Hey${barberName ? ` ${barberName}` : ''}, you've got a new booking!

Client: ${clientName}
Service: ${serviceName}
Date: ${dateFormatted}
Time: ${timeFormatted}${priceText ? `\nPrice: ${priceText}` : ''}

Open the Kutz app to manage your schedule.

© ${new Date().getFullYear()} Kutz`;

    const payload: any = {
      from: FROM_ADDRESS,
      to: Array.isArray(to) ? to : [to],
      subject: `New booking: ${clientName} — ${timeFormatted} ${dateFormatted}`,
      html,
      text,
    };
    if (clientEmail) payload.reply_to = clientEmail;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[send-barber-notification] Resend error:', data);
      return new Response(JSON.stringify({ error: data }), {
        status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id: data.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-barber-notification] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
