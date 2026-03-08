/**
 * create-payment-intent
 *
 * Creates a Stripe PaymentIntent on the barber's connected account.
 * Used for BOTH online bookings (client pays) and POS charges (barber charges).
 *
 * POST body:
 *   appointment_id : string  (optional — can create intent before appointment)
 *   barber_id      : string  (barber whose Stripe account gets charged to)
 *   amount_cents   : number  (amount in cents, e.g. 3500 for $35.00)
 *   currency       : string  (default: "usd")
 *   payment_type   : "online" | "pos" | "tap_to_pay"
 *   client_id      : string  (optional, for record keeping)
 *   description    : string  (optional, shown on Stripe dashboard)
 *
 * Returns: { client_secret, payment_intent_id, payment_record_id }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY         = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Platform fee: 1%
const PLATFORM_FEE_PERCENT = 0.01;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function stripePost(path: string, params: Record<string, string | number>, stripeAccount?: string) {
  const body = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers,
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'Stripe error');
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Require authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      appointment_id,
      barber_id,
      amount_cents,
      currency = 'usd',
      payment_type = 'online',
      client_id,
      description,
      tip_cents = 0,
      subtotal_cents,
    } = await req.json();

    if (!barber_id)    throw new Error('barber_id is required');
    if (!amount_cents) throw new Error('amount_cents is required');
    if (amount_cents < 50) throw new Error('Minimum charge is $0.50');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // For POS / tap_to_pay payments, verify the caller IS the barber or a staff member
    if (payment_type === 'pos' || payment_type === 'tap_to_pay') {
      const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await anonClient.auth.getUser();
      if (authErr || !user) throw new Error('Unauthorized');

      const { data: callerProfile } = await supabase
        .from('profiles')
        .select('id')
        .or(`id.eq.${user.id},user_id.eq.${user.id}`)
        .limit(1)
        .maybeSingle();

      const { data: barberProfile } = await supabase
        .from('profiles')
        .select('id')
        .or(`id.eq.${barber_id},user_id.eq.${barber_id}`)
        .limit(1)
        .maybeSingle();

      if (!callerProfile || !barberProfile) {
        throw new Error('Forbidden: POS charges must be initiated by the barber');
      }

      // Allow if caller IS the barber, or if caller is a team member of the barber
      if (callerProfile.id !== barberProfile.id) {
        const { data: teamLink } = await supabase
          .from('team_members')
          .select('id')
          .eq('user_id', user.id)
          .eq('shop_owner_id', barber_id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (!teamLink) {
          throw new Error('Forbidden: POS charges must be initiated by the barber');
        }
      }
    }

    // 1. Get barber's Stripe account ID
    // barber_id may be auth UID (user_id) or profile id — query both
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, stripe_account_id, stripe_charges_enabled, shop_name, display_name')
      .or(`id.eq.${barber_id},user_id.eq.${barber_id}`)
      .limit(1)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.stripe_account_id) {
      throw new Error('Barber has not connected their Stripe account yet');
    }
    if (!profile.stripe_charges_enabled) {
      throw new Error('Barber Stripe account is not yet fully verified. Please complete onboarding.');
    }

    // 2. Calculate platform fee
    const platformFeeCents = Math.round(amount_cents * PLATFORM_FEE_PERCENT);

    // 3. Create PaymentIntent on the connected account
    const piParams: Record<string, string | number> = {
      amount:                amount_cents,
      currency,
      application_fee_amount: platformFeeCents,
      description:                   description ?? `Kutz appointment`,
      'metadata[barber_id]':         barber_id,
      'metadata[client_id]':         client_id ?? '',
      'metadata[appointment_id]':    appointment_id ?? '',
      'metadata[payment_type]':      payment_type,
      'metadata[tip_cents]':         String(tip_cents ?? 0),
      'metadata[subtotal_cents]':    String(subtotal_cents ?? amount_cents),
    };

    // Tap to Pay requires card_present; everything else uses automatic_payment_methods
    if (payment_type === 'tap_to_pay') {
      piParams['payment_method_types[0]'] = 'card_present';
      piParams['capture_method'] = 'automatic';
    } else {
      piParams['automatic_payment_methods[enabled]'] = 'true';
    }

    const pi = await stripePost(
      '/payment_intents',
      piParams,
      profile.stripe_account_id,
    );

    // 4. Record the payment in our DB
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        appointment_id:            appointment_id ?? null,
        barber_id:                 profile.id,
        client_id:                 client_id ?? null,
        amount_cents,
        currency,
        stripe_payment_intent_id:  pi.id,
        status:                    'pending',
        payment_type,
        platform_fee_cents:        platformFeeCents,
      })
      .select('id')
      .single();

    if (paymentError) throw paymentError;

    // 5. If appointment_id provided, link payment to appointment
    if (appointment_id && paymentRecord?.id) {
      await supabase
        .from('appointments')
        .update({ payment_id: paymentRecord.id })
        .eq('id', appointment_id);
    }

    return new Response(
      JSON.stringify({
        client_secret:     pi.client_secret,
        payment_intent_id: pi.id,
        payment_record_id: paymentRecord?.id,
        publishable_key:   Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? '',
        stripe_account_id: profile.stripe_account_id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('create-payment-intent error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
