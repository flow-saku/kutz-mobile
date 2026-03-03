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
  } catch {
    return t;
  }
}

function formatDate(dateStr: string) {
  try {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const date = new Date(y, mo - 1, d);
    return `${days[date.getDay()]}, ${months[mo - 1]} ${d}, ${y}`;
  } catch {
    return dateStr;
  }
}

function buildConfirmationEmail(params: {
  clientName: string;
  shopName: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  duration?: number;
  price?: number | null;
  barberName?: string;
  bookingLink?: string;
}) {
  const {
    clientName,
    shopName,
    serviceName,
    appointmentDate,
    appointmentTime,
    duration,
    price,
    barberName,
    bookingLink,
  } = params;

  const dateFormatted = formatDate(appointmentDate);
  const timeFormatted = fmt12(appointmentTime.slice(0, 5));
  const priceText = price != null ? `$${Number(price).toFixed(2)}` : null;
  const durationText = duration ? `${duration} min` : null;

  const detailRows = [
    { label: 'Date', value: dateFormatted },
    { label: 'Time', value: timeFormatted },
    { label: 'Service', value: serviceName },
    barberName ? { label: 'Stylist', value: barberName } : null,
    durationText ? { label: 'Duration', value: durationText } : null,
    priceText ? { label: 'Price', value: priceText } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const detailRowsHtml = detailRows
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:14px;width:40%;">${r.label}</td>
        <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;">${r.value}</td>
      </tr>
      <tr><td colspan="2" style="border-bottom:1px solid #f3f4f6;"></td></tr>`
    )
    .join('');

  const manageSection = bookingLink
    ? `<div style="text-align:center;margin-top:32px;">
        <a href="${bookingLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.3px;">
          Manage Booking
        </a>
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Booking Confirmed</title>
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
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Booking Confirmed ✓</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px;border-radius:0 0 12px 12px;">
              <p style="margin:0 0 24px;color:#374151;font-size:16px;line-height:1.6;">
                Hey ${clientName}, you're all set! Here are your appointment details at <strong>${shopName}</strong>.
              </p>

              <!-- Details table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f3f4f6;">
                ${detailRowsHtml}
              </table>

              ${manageSection}

              <p style="margin:32px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                Need to reschedule or cancel? Open the Kutz app or reply to this email and we'll help you out.
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

  const text = `Booking Confirmed — ${shopName}

Hey ${clientName}, you're all set!

${detailRows.map((r) => `${r.label}: ${r.value}`).join('\n')}

Need to reschedule or cancel? Open the Kutz app.

© ${new Date().getFullYear()} Kutz`;

  return { html, text };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const {
      to,
      clientName,
      shopName,
      serviceName,
      appointmentDate,
      appointmentTime,
      duration,
      price,
      barberName,
      barberEmail,
      bookingLink,
    } = body;

    if (!to || !clientName || !shopName || !serviceName || !appointmentDate || !appointmentTime) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, clientName, shopName, serviceName, appointmentDate, appointmentTime' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!RESEND_API_KEY) {
      console.error('[send-appointment-confirmation] RESEND_API_KEY is not set');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { html, text } = buildConfirmationEmail({
      clientName,
      shopName,
      serviceName,
      appointmentDate,
      appointmentTime,
      duration,
      price,
      barberName,
      bookingLink,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: Array.isArray(to) ? to : [to],
        subject: `Booking confirmed at ${shopName} — ${fmt12(appointmentTime.slice(0, 5))}`,
        html,
        text,
        ...(barberEmail ? { reply_to: barberEmail } : {}),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[send-appointment-confirmation] Resend error:', data);
      return new Response(JSON.stringify({ error: data }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id: data.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-appointment-confirmation] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
