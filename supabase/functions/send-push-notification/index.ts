import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const {
      barber_id,   // UUID of the barber's auth user
      title,
      body,
      data,        // optional extra payload (e.g. { screen: '/(barber)/appointments' })
    } = await req.json();

    if (!barber_id || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing barber_id, title, or body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Look up the barber's push token
    const { data: row, error: tokenErr } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', barber_id)
      .maybeSingle();

    if (tokenErr) {
      console.error('[send-push] Token lookup error:', tokenErr);
      return new Response(JSON.stringify({ error: 'Token lookup failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!row?.token) {
      // No token registered — barber hasn't enabled push on their device yet. Not an error.
      return new Response(JSON.stringify({ skipped: true, reason: 'no_token' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = row.token;

    // Only send to valid Expo push tokens
    if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
      return new Response(JSON.stringify({ skipped: true, reason: 'invalid_token_format' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const message = {
      to: token,
      title,
      body,
      sound: 'default',
      priority: 'high',
      channelId: 'bookings',
      data: data ?? {},
    };

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await res.json();

    if (!res.ok || result?.data?.status === 'error') {
      console.error('[send-push] Expo error:', result);
      return new Response(JSON.stringify({ error: result }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-push] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
