/**
 * create-connection-token
 *
 * Creates a short-lived Stripe Terminal connection token scoped
 * to a barber's connected Stripe account.
 *
 * POST body: { barber_id: string }
 * Returns:   { secret: string }
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

    // Verify caller is authenticated
    const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) throw new Error('Unauthorized');

    // Verify caller is the barber or a team member
    const { data: teamLink } = await supabase
      .from('team_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('shop_owner_id', barber_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (user.id !== barber_id && !teamLink) {
      throw new Error('Forbidden');
    }

    // Get barber's Stripe account
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_account_id, stripe_charges_enabled')
      .or(`id.eq.${barber_id},user_id.eq.${barber_id}`)
      .limit(1)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.stripe_account_id) throw new Error('Barber has not connected Stripe');
    if (!profile.stripe_charges_enabled) throw new Error('Stripe account not fully verified');

    // Create connection token on the connected account
    const res = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Account': profile.stripe_account_id,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? 'Failed to create connection token');

    return new Response(
      JSON.stringify({ secret: data.secret }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('create-connection-token error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
