/**
 * create-terminal-location
 *
 * Creates (or retrieves) a Stripe Terminal Location on the barber's
 * connected account. Required for Tap to Pay on iPhone.
 *
 * POST body: { barber_id: string }
 * Returns:   { location_id: string }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY         = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function stripePost(
  path: string,
  params: Record<string, string>,
  stripeAccount: string,
) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Account': stripeAccount,
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'Stripe error');
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { barber_id } = await req.json();
    if (!barber_id) throw new Error('barber_id is required');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller
    const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) throw new Error('Unauthorized');

    // Get barber profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, stripe_account_id, stripe_charges_enabled, stripe_terminal_location_id, shop_name, display_name, city, country')
      .or(`id.eq.${barber_id},user_id.eq.${barber_id}`)
      .limit(1)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.stripe_account_id) throw new Error('Barber has not connected Stripe');
    if (!profile.stripe_charges_enabled) throw new Error('Stripe account not fully verified');

    // Return cached location if exists
    if (profile.stripe_terminal_location_id) {
      return new Response(
        JSON.stringify({ location_id: profile.stripe_terminal_location_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create a new Terminal Location on the connected account
    const displayName = profile.shop_name || profile.display_name || 'Kutz Shop';
    const location = await stripePost('/terminal/locations', {
      display_name: displayName,
      'address[country]': profile.country || 'US',
      'address[city]': profile.city || 'Unknown',
      'address[line1]': 'N/A',
      'address[postal_code]': '00000',
      'address[state]': 'NA',
    }, profile.stripe_account_id);

    // Cache the location ID
    await supabase
      .from('profiles')
      .update({ stripe_terminal_location_id: location.id })
      .eq('id', profile.id);

    return new Response(
      JSON.stringify({ location_id: location.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('create-terminal-location error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
