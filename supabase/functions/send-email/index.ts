import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY     = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_ADDRESS       = Deno.env.get('FROM_EMAIL') ?? 'Kutz <no-reply@kutz.io>';
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY  = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  // Allow service role key (internal edge-function-to-edge-function calls)
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true;
  // Allow valid user JWTs
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': SUPABASE_ANON_KEY },
  });
  return res.ok;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { to, subject, html, text } = await req.json();

    if (!to || !subject) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!RESEND_API_KEY) {
      console.error('[send-email] RESEND_API_KEY is not set');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html ?? text ?? '',
        text: text ?? '',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[send-email] Resend error:', data);
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
    console.error('[send-email] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
