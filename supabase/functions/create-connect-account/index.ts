/**
 * create-connect-account
 *
 * Creates (or retrieves) a Stripe Connect Express account for a barber,
 * then returns an Account Link URL so they can complete onboarding.
 *
 * POST body: { barber_id: string, return_url: string, refresh_url: string }
 * Returns:   { url: string, account_id: string }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function stripePost(path: string, params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'Stripe error');
  return data;
}

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'Stripe error');
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { barber_id, return_url, refresh_url } = await req.json();
    if (!barber_id) throw new Error('barber_id is required');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Check if barber already has a Stripe account
    // barber_id may be auth UID (user_id) or profiles.id — query both
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, stripe_account_id, stripe_onboarding_complete, email')
      .or(`id.eq.${barber_id},user_id.eq.${barber_id}`)
      .limit(1)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) throw new Error('Barber profile not found');

    // Use the actual profiles.id (not barber_id which may be auth UID)
    const profileId = profile.id;
    let accountId: string = profile?.stripe_account_id ?? '';

    // 2. Create Stripe Express account if none exists
    if (!accountId) {
      const account = await stripePost('/accounts', {
        type:                     'express',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]':     'true',
        ...(profile?.email ? { email: profile.email } : {}),
        'business_type': 'individual',
        'settings[payouts][schedule][interval]': 'weekly',
      });

      accountId = account.id;

      // Save to profiles using the real profile.id
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', profileId);

      if (updateError) throw updateError;
    } else if (profile?.stripe_onboarding_complete) {
      // Already fully onboarded — return the dashboard link instead
      const loginLink = await stripePost(`/accounts/${accountId}/login_links`, {});
      return new Response(
        JSON.stringify({ url: loginLink.url, account_id: accountId, already_connected: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Create Account Link for onboarding
    const accountLink = await stripePost('/account_links', {
      account:     accountId,
      refresh_url: refresh_url ?? `${SUPABASE_URL}/functions/v1/barber-dashboard`,
      return_url:  return_url  ?? `${SUPABASE_URL}/functions/v1/barber-dashboard`,
      type:        'account_onboarding',
    });

    return new Response(
      JSON.stringify({ url: accountLink.url, account_id: accountId, already_connected: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('create-connect-account error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
