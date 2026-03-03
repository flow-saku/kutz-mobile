/**
 * stripe-webhook
 *
 * Handles Stripe webhook events:
 *   - account.updated            → sync barber's stripe status to profiles
 *   - payment_intent.succeeded   → mark payment + appointment as paid
 *   - payment_intent.payment_failed → mark payment as failed
 *   - charge.refunded            → mark payment as refunded
 *
 * Register this URL in your Stripe Dashboard → Webhooks:
 *   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY         = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET     = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Stripe webhook signature verification (using the Stripe-Signature header)
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts    = sigHeader.split(',');
    const tPart    = parts.find((p) => p.startsWith('t='));
    const v1Part   = parts.find((p) => p.startsWith('v1='));
    if (!tPart || !v1Part) return false;

    const timestamp  = tPart.slice(2);
    const signature  = v1Part.slice(3);
    const signedPayload = `${timestamp}.${payload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const expectedSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return signature === expectedSig;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const payload   = await req.text();
  const sigHeader = req.headers.get('stripe-signature') ?? '';

  // Reject if webhook secret is not configured — never skip verification
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting request');
    return new Response('Webhook not configured', { status: 500 });
  }
  const valid = await verifyStripeSignature(payload, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response('Invalid signature', { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log('Stripe webhook:', event.type);

  try {
    switch (event.type) {
      // ── Barber onboarding status sync ──────────────────────────────────
      case 'account.updated': {
        const account = event.data.object;
        const { error } = await supabase
          .from('profiles')
          .update({
            stripe_charges_enabled:     account.charges_enabled,
            stripe_payouts_enabled:     account.payouts_enabled,
            stripe_onboarding_complete: account.details_submitted,
          })
          .eq('stripe_account_id', account.id);
        if (error) console.error('account.updated error:', error);
        break;
      }

      // ── Payment succeeded ───────────────────────────────────────────────
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        // Get charge id
        const chargeId = pi.latest_charge ?? null;

        // Update our payment record
        const { data: payment, error: payError } = await supabase
          .from('payments')
          .update({
            status:           'succeeded',
            stripe_charge_id: chargeId,
            updated_at:       new Date().toISOString(),
          })
          .eq('stripe_payment_intent_id', pi.id)
          .select('appointment_id')
          .single();

        if (payError) { console.error('payment update error:', payError); break; }

        // Mark appointment as paid
        if (payment?.appointment_id) {
          await supabase
            .from('appointments')
            .update({ paid: true, status: 'confirmed' })
            .eq('id', payment.appointment_id);
        }
        break;
      }

      // ── Payment failed ──────────────────────────────────────────────────
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        await supabase
          .from('payments')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', pi.id);
        break;
      }

      // ── Refund ─────────────────────────────────────────────────────────
      case 'charge.refunded': {
        const charge = event.data.object;
        const { data: payment } = await supabase
          .from('payments')
          .update({ status: 'refunded', updated_at: new Date().toISOString() })
          .eq('stripe_charge_id', charge.id)
          .select('appointment_id')
          .single();

        if (payment?.appointment_id) {
          await supabase
            .from('appointments')
            .update({ paid: false })
            .eq('id', payment.appointment_id);
        }
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }
  } catch (err: any) {
    console.error('Webhook handler error:', err);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
