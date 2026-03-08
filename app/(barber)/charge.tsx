import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  Animated, ActivityIndicator, Platform, Pressable,
  Dimensions, TextInput, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft, CheckCircle, Trash2, Sparkles,
  ChevronRight, Banknote, Smartphone, CreditCard,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import {
  initStripe,
  initPaymentSheet,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';
import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { resolveBarberScope } from '@/lib/barber';
import { useToast } from '@/lib/toast';
import AnimatedCounter from '@/components/ui/AnimatedCounter';
import ConfettiPop from '@/components/ui/ConfettiPop';
import TapToPayOverlay from '@/components/ui/TapToPayOverlay';

const { width: SW } = Dimensions.get('window');
const KEY_W = Math.floor((SW - 72) / 3);
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
const QUICK = [15, 20, 25, 30, 35, 40, 50, 60];
const TIPS = [
  { label: 'No tip', pct: 0 },
  { label: '5%', pct: 5 },
  { label: '10%', pct: 10 },
  { label: '15%', pct: 15 },
  { label: '20%', pct: 20 },
];

/* ── Springy numpad key ───────────────────────────────────────────────────── */
function NumKey({ k, onPress, C }: { k: string; onPress: (k: string) => void; C: any }) {
  const s = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => Animated.spring(s, { toValue: 0.88, tension: 600, friction: 20, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(s, { toValue: 1, tension: 300, friction: 14, useNativeDriver: true }).start()}
      onPress={() => onPress(k)}
    >
      <Animated.View style={[S.key, {
        width: KEY_W,
        backgroundColor: k === 'del' ? 'transparent' : C.card,
        borderColor: k === 'del' ? 'transparent' : C.cardBorder,
        transform: [{ scale: s }],
      }]}>
        {k === 'del'
          ? <Trash2 color={C.text3} size={18} />
          : <Text style={[S.keyText, { color: C.text }]}>{k}</Text>
        }
      </Animated.View>
    </Pressable>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
export default function ChargeScreen() {
  const { C, theme } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{
    client_name?: string;
    client_id?: string;
    appointment_id?: string;
    prefill_amount?: string;
  }>();

  /* ── state ────────────────────────────────────────────────────────────── */
  const [step, setStep] = useState<'amount' | 'tip' | 'success'>('amount');
  const [amount, setAmount] = useState(params.prefill_amount || '');
  const [tipIdx, setTipIdx] = useState(0);       // index in TIPS, -1 = custom
  const [customTip, setCustomTip] = useState('');
  const [charging, setCharging] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const [todayTotal, setTodayTotal] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [paidMethod, setPaidMethod] = useState<'card' | 'cash' | 'tap'>('card');
  const [tapLoading, setTapLoading] = useState(false);
  const [tapStatus, setTapStatus] = useState('');
  const [terminalReady, setTerminalReady] = useState(false);

  /* ── animations ───────────────────────────────────────────────────────── */
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const successFade = useRef(new Animated.Value(0)).current;
  const checkSpin = useRef(new Animated.Value(0)).current;
  const todaySlide = useRef(new Animated.Value(30)).current;

  /* ── Stripe Terminal hooks ────────────────────────────────────────────── */
  const {
    initialize: initTerminal,
    easyConnect,
    disconnectReader,
    connectedReader,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelCollectPaymentMethod,
  } = useStripeTerminal();

  /* ── init ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    // Initialize Terminal SDK (must be called from a nested component)
    if (Platform.OS === 'ios') {
      initTerminal().then(({ error }) => {
        if (error) {
          console.warn('Terminal init error:', error.code, error.message);
        } else {
          console.log('Terminal SDK initialized');
          setTerminalReady(true);
        }
      }).catch((e) => console.warn('Terminal init exception:', e));
    }
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, tension: 280, friction: 22, useNativeDriver: true }),
    ]).start();

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const scope = await resolveBarberScope(session.user.id);
      setBarberId(scope.ownerUid);

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_charges_enabled')
        .or(`id.eq.${scope.ownerUid},user_id.eq.${scope.ownerUid}`)
        .maybeSingle();
      setStripeReady((profile as any)?.stripe_charges_enabled === true);

      const today = new Date().toISOString().split('T')[0];
      const { data: apts } = await supabase
        .from('appointments')
        .select('price_charged')
        .in('barber_id', scope.scopeIds)
        .eq('date', today)
        .eq('status', 'completed');
      setTodayTotal(
        ((apts as any[]) ?? []).reduce((s: number, a: any) => s + Number(a.price_charged ?? 0), 0),
      );
    });
  }, []);

  /* ── computed ─────────────────────────────────────────────────────────── */
  const subtotal = parseFloat(amount || '0');
  const subtotalCents = Math.round(subtotal * 100);
  const isValidAmount = subtotalCents >= 50;

  const tipAmount = tipIdx === -1
    ? parseFloat(customTip || '0')
    : subtotal * ((TIPS[tipIdx]?.pct ?? 0) / 100);
  const total = subtotal + tipAmount;
  const totalCents = Math.round(total * 100);
  const fee = (totalCents * 0.01 / 100);

  /* ── keypad handler ───────────────────────────────────────────────────── */
  const handleKey = useCallback((key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === 'del') { setAmount(p => p.slice(0, -1)); return; }
    if (key === '.') { if (amount.includes('.')) return; setAmount(p => p + '.'); return; }
    setAmount(prev => {
      const next = prev + key;
      if (next.includes('.') && next.split('.')[1].length > 2) return prev;
      if (parseFloat(next) > 99999) return prev;
      return next;
    });
  }, [amount]);

  /* ── quick amount ─────────────────────────────────────────────────────── */
  const handleQuick = (val: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAmount(String(val));
  };

  /* ── tip select ───────────────────────────────────────────────────────── */
  const selectTip = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTipIdx(idx);
    if (idx !== -1) setCustomTip('');
  };

  /* ── collect via Stripe Payment Sheet ─────────────────────────────────── */
  const handleCollect = async () => {
    if (charging || totalCents < 50 || !barberId) return;
    if (!stripeReady) {
      Alert.alert('Stripe Not Connected', 'Go to Settings → Payments to connect Stripe first.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setCharging(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const tipCents = Math.round(tipAmount * 100);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          barber_id: barberId,
          amount_cents: totalCents,
          currency: 'usd',
          payment_type: 'pos',
          client_id: params.client_id || null,
          appointment_id: params.appointment_id || null,
          tip_cents: tipCents,
          subtotal_cents: subtotalCents,
          description: params.client_name
            ? `POS — ${params.client_name}${tipCents > 0 ? ` (incl. $${tipAmount.toFixed(2)} tip)` : ''}`
            : `POS charge $${total.toFixed(2)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);

      // Init Stripe
      await initStripe({
        publishableKey: data.publishable_key,
        stripeAccountId: data.stripe_account_id,
        merchantIdentifier: 'merchant.com.sakuholma.kutz',
      });

      // Init Payment Sheet
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: data.client_secret,
        merchantDisplayName: 'Kutz',
        style: theme === 'dark' ? 'alwaysDark' : 'alwaysLight',
        applePay: { merchantCountryCode: 'US' },
        googlePay: { merchantCountryCode: 'US', testEnv: __DEV__ },
      });
      if (initError) throw new Error(initError.message);

      // Present
      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        if (payError.code === 'Canceled') { toast.info('Payment cancelled'); setCharging(false); return; }
        throw new Error(payError.message);
      }

      // Paid!
      if (params.appointment_id && data?.payment_record_id) {
        await supabase.from('appointments').update({
          paid: true,
          payment_id: data.payment_record_id,
          price_charged: total,
        }).eq('id', params.appointment_id);
      }

      setPaidMethod('card');
      showSuccessScreen();
    } catch (err: any) {
      console.error('POS charge error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.error(err.message || 'Charge failed');
      setCharging(false);
    }
  };

  /* ── Tap to Pay on iPhone ─────────────────────────────────────────────── */
  const handleTapToPay = async () => {
    if (tapLoading || totalCents < 50 || !barberId) return;
    if (!stripeReady) {
      Alert.alert('Stripe Not Connected', 'Go to Settings → Payments to connect Stripe first.');
      return;
    }
    if (!terminalReady) {
      Alert.alert('Terminal Not Ready', 'Tap to Pay is initializing. Please try again in a moment.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTapLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // 0. Disconnect any existing reader connection
      if (connectedReader) {
        try { await disconnectReader(); } catch { }
      }

      // 1. Ensure terminal location exists
      setTapStatus('Setting up...');
      const locRes = await fetch(`${SUPABASE_URL}/functions/v1/create-terminal-location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ barber_id: barberId }),
      });
      const locData = await locRes.json();
      if (!locRes.ok || locData.error) throw new Error(locData.error || 'Location setup failed');

      // 2. Discover + connect to Tap to Pay reader in one step
      setTapStatus('Connecting reader...');
      const { error: connectError } = await easyConnect({
        discoveryMethod: 'tapToPay',
        simulated: __DEV__,
        locationId: locData.location_id,
      });
      if (connectError) throw new Error(connectError.message);

      // 3. Create PaymentIntent with card_present
      setTapStatus('Creating charge...');
      const tipCents = Math.round(tipAmount * 100);
      const piRes = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          barber_id: barberId,
          amount_cents: totalCents,
          currency: 'usd',
          payment_type: 'tap_to_pay',
          client_id: params.client_id || null,
          appointment_id: params.appointment_id || null,
          tip_cents: tipCents,
          subtotal_cents: subtotalCents,
          description: params.client_name
            ? `Tap to Pay — ${params.client_name}${tipCents > 0 ? ` (incl. $${tipAmount.toFixed(2)} tip)` : ''}`
            : `Tap to Pay $${total.toFixed(2)}`,
        }),
      });
      const piData = await piRes.json();
      if (!piRes.ok || piData.error) throw new Error(piData.error || 'Payment creation failed');

      // 4. Retrieve the PaymentIntent object for the Terminal SDK
      const { paymentIntent: pi, error: retrieveError } = await retrievePaymentIntent(piData.client_secret);
      if (retrieveError || !pi) throw new Error(retrieveError?.message || 'Failed to retrieve payment intent');

      // 5. Collect payment — shows native "Ready to Tap" UI
      setTapStatus('Ready — Tap card now');
      const { paymentIntent: collectedPI, error: collectError } = await collectPaymentMethod({
        paymentIntent: pi,
      });
      if (collectError) {
        if (collectError.code === 'CANCELED') {
          toast.info('Tap to Pay cancelled');
          setTapLoading(false);
          setTapStatus('');
          return;
        }
        throw new Error(collectError.message);
      }

      // 6. Confirm the payment
      setTapStatus('Processing...');
      const { error: confirmError } = await confirmPaymentIntent({
        paymentIntent: collectedPI ?? pi,
      });
      if (confirmError) throw new Error(confirmError.message);

      // 7. Success — update appointment
      if (params.appointment_id && piData.payment_record_id) {
        await supabase.from('appointments').update({
          paid: true,
          payment_id: piData.payment_record_id,
          price_charged: total,
        }).eq('id', params.appointment_id);
      }

      setPaidMethod('tap');
      showSuccessScreen();
    } catch (err: any) {
      console.error('Tap to Pay error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.error(err.message || 'Tap to Pay failed');
    } finally {
      setTapLoading(false);
      setTapStatus('');
    }
  };

  const handleCancelTap = async () => {
    try { await cancelCollectPaymentMethod(); } catch { }
    setTapLoading(false);
    setTapStatus('');
  };

  /* ── cash payment ─────────────────────────────────────────────────────── */
  const handleCash = () => {
    if (cashLoading || totalCents < 50) return;
    Alert.alert(
      'Cash Payment',
      `Record $${total.toFixed(2)} as paid with cash?${tipAmount > 0 ? `\n(includes $${tipAmount.toFixed(2)} tip)` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setCashLoading(true);
            try {
              if (params.appointment_id) {
                await supabase.from('appointments').update({
                  paid: true,
                  price_charged: total,
                }).eq('id', params.appointment_id);
              }
              setPaidMethod('cash');
              showSuccessScreen();
            } catch {
              toast.error('Failed to record payment');
              setCashLoading(false);
            }
          },
        },
      ],
    );
  };

  /* ── show success ─────────────────────────────────────────────────────── */
  const showSuccessScreen = () => {
    setTodayTotal(prev => prev + total);
    setStep('success');
    setCharging(false);
    setCashLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Animated.sequence([
      Animated.parallel([
        Animated.spring(successScale, { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }),
        Animated.timing(successFade, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(checkSpin, { toValue: 1, tension: 250, friction: 18, useNativeDriver: true }),
        Animated.spring(todaySlide, { toValue: 0, tension: 200, friction: 20, useNativeDriver: true }),
      ]),
    ]).start();

    setTimeout(() => setShowConfetti(true), 200);
    toast.success(`$${total.toFixed(2)} collected`);
    setTimeout(() => router.back(), 2800);
  };

  /* ════════════════════════════ RENDER ═════════════════════════════════ */

  /* ── SUCCESS ──────────────────────────────────────────────────────────── */
  if (step === 'success') {
    const spin = checkSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <SafeAreaView style={[S.container, { backgroundColor: C.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <TapToPayOverlay
          visible={tapLoading}
          status={tapStatus}
          amount={`$${total.toFixed(2)}`}
          clientName={params.client_name}
          onCancel={handleCancelTap}
        />
        <View style={S.confettiWrap}><ConfettiPop trigger={showConfetti} count={28} /></View>

        <Animated.View style={[S.successWrap, { opacity: successFade }]}>
          <Animated.View style={[S.successCircle, {
            backgroundColor: C.success + '18',
            transform: [{ scale: successScale }, { rotate: spin }],
          }]}>
            <CheckCircle color={C.success} size={64} strokeWidth={1.5} />
          </Animated.View>

          <AnimatedCounter
            value={total}
            prefix="$"
            decimals={2}
            style={{ fontSize: 48, color: C.text, fontWeight: '900', letterSpacing: -1 }}
          />
          <Text style={[S.successLabel, { color: C.text2 }]}>
            {paidMethod === 'cash' ? 'Cash collected' : paidMethod === 'tap' ? 'Tap to Pay collected' : 'Payment collected'}
          </Text>
          {tipAmount > 0 && (
            <Text style={[S.successTip, { color: C.success }]}>
              includes ${tipAmount.toFixed(2)} tip
            </Text>
          )}
          {params.client_name && (
            <Text style={[S.successClient, { color: C.text3 }]}>{params.client_name}</Text>
          )}

          <Animated.View style={[S.todayCard, {
            backgroundColor: C.card, borderColor: C.cardBorder,
            transform: [{ translateY: todaySlide }], opacity: successFade,
          }]}>
            <Sparkles color={C.accent} size={16} strokeWidth={2} />
            <Text style={[S.todayLabel, { color: C.text3 }]}>Today's total</Text>
            <AnimatedCounter
              value={todayTotal}
              prefix="$"
              style={{ fontSize: 22, color: C.success, fontWeight: '900', letterSpacing: -0.5 }}
            />
          </Animated.View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  /* ── TIP + PAYMENT STEP ───────────────────────────────────────────────── */
  if (step === 'tip') {
    const tipChipW = (SW - 60) / 3;
    return (
      <SafeAreaView style={[S.container, { backgroundColor: C.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <TapToPayOverlay
          visible={tapLoading}
          status={tapStatus}
          amount={`$${total.toFixed(2)}`}
          clientName={params.client_name}
          onCancel={handleCancelTap}
        />

        {/* header */}
        <View style={S.header}>
          <TouchableOpacity onPress={() => setStep('amount')} style={S.backBtn}>
            <ArrowLeft color={C.text} size={22} />
          </TouchableOpacity>
          <Text style={[S.headerTitle, { color: C.text }]}>Add Tip</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={S.tipScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* client */}
          {params.client_name && (
            <View style={[S.clientChip, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Text style={[S.clientText, { color: C.text2 }]}>{params.client_name}</Text>
            </View>
          )}

          {/* subtotal */}
          <Text style={[S.tipLabel, { color: C.text3 }]}>Subtotal</Text>
          <Text style={[S.tipSubtotal, { color: C.text }]}>${subtotal.toFixed(2)}</Text>

          {/* tip chips */}
          <View style={S.tipGrid}>
            {TIPS.map((t, i) => {
              const active = tipIdx === i;
              const val = subtotal * (t.pct / 100);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => selectTip(i)}
                  activeOpacity={0.8}
                  style={[S.tipChip, {
                    width: tipChipW,
                    backgroundColor: active ? C.accent : C.card,
                    borderColor: active ? C.accent : C.cardBorder,
                  }]}
                >
                  <Text style={[S.tipChipLabel, { color: active ? C.accentText : C.text }]}>
                    {t.label}
                  </Text>
                  {t.pct > 0 && (
                    <Text style={[S.tipChipAmt, { color: active ? C.accentText + '99' : C.text3 }]}>
                      +${val.toFixed(2)}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
            {/* custom */}
            <TouchableOpacity
              onPress={() => selectTip(-1)}
              activeOpacity={0.8}
              style={[S.tipChip, {
                width: tipChipW,
                backgroundColor: tipIdx === -1 ? C.accent : C.card,
                borderColor: tipIdx === -1 ? C.accent : C.cardBorder,
              }]}
            >
              <Text style={[S.tipChipLabel, { color: tipIdx === -1 ? C.accentText : C.text }]}>
                Custom
              </Text>
            </TouchableOpacity>
          </View>

          {/* custom tip input */}
          {tipIdx === -1 && (
            <View style={[S.customRow, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Text style={[S.customDollar, { color: C.text3 }]}>$</Text>
              <TextInput
                value={customTip}
                onChangeText={t => {
                  const c = t.replace(/[^0-9.]/g, '');
                  if (c.split('.').length > 2) return;
                  if (c.includes('.') && c.split('.')[1]?.length > 2) return;
                  setCustomTip(c);
                }}
                placeholder="0.00"
                placeholderTextColor={C.text3}
                keyboardType="decimal-pad"
                style={[S.customInput, { color: C.text }]}
                autoFocus
              />
            </View>
          )}

          {/* breakdown */}
          <View style={[S.breakdown, { borderColor: C.cardBorder }]}>
            <View style={S.breakRow}>
              <Text style={[S.breakLabel, { color: C.text3 }]}>Subtotal</Text>
              <Text style={[S.breakValue, { color: C.text2 }]}>${subtotal.toFixed(2)}</Text>
            </View>
            {tipAmount > 0 && (
              <View style={S.breakRow}>
                <Text style={[S.breakLabel, { color: C.text3 }]}>Tip</Text>
                <Text style={[S.breakValue, { color: C.success }]}>+${tipAmount.toFixed(2)}</Text>
              </View>
            )}
            <View style={[S.breakRow, S.totalRow, { borderTopColor: C.cardBorder }]}>
              <Text style={[S.totalLabel, { color: C.text }]}>Total</Text>
              <Text style={[S.totalValue, { color: C.text }]}>${total.toFixed(2)}</Text>
            </View>
            <View style={S.breakRow}>
              <Text style={[S.feeLabel, { color: C.text3 }]}>Platform fee (1%)</Text>
              <Text style={[S.feeValue, { color: C.text3 }]}>${fee.toFixed(2)}</Text>
            </View>
          </View>
        </ScrollView>

        {/* bottom buttons */}
        <View style={S.tipBottomBtns}>
          {/* Tap to Pay — iOS only */}
          {Platform.OS === 'ios' && terminalReady && (
            <TouchableOpacity
              onPress={tapLoading ? handleCancelTap : handleTapToPay}
              disabled={!tapLoading && (charging || totalCents < 50)}
              activeOpacity={0.85}
              style={[S.collectBtn, {
                backgroundColor: C.accent,
                opacity: (charging && !tapLoading) ? 0.7 : 1,
              }]}
            >
              {tapLoading ? (
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <ActivityIndicator color={C.accentText} size="small" />
                  <Text style={[S.collectText, { color: C.accentText, fontSize: 13 }]}>
                    {tapStatus || 'Setting up...'}
                  </Text>
                  {tapStatus === 'Ready — Tap card now' && (
                    <Text style={{ color: C.accentText + '88', fontSize: 12 }}>Tap to cancel</Text>
                  )}
                </View>
              ) : (
                <>
                  <Smartphone color={C.accentText} size={20} />
                  <Text style={[S.collectText, { color: C.accentText }]}>
                    Tap to Pay ${total.toFixed(2)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Card (Payment Sheet) */}
          <TouchableOpacity
            onPress={handleCollect}
            disabled={charging || tapLoading || totalCents < 50}
            activeOpacity={0.85}
            style={[S.collectBtn, {
              backgroundColor: (Platform.OS === 'ios' && terminalReady) ? C.card : C.accent,
              borderWidth: (Platform.OS === 'ios' && terminalReady) ? 1 : 0,
              borderColor: C.cardBorder,
              opacity: (charging || tapLoading) ? 0.7 : 1,
            }]}
          >
            {charging ? (
              <ActivityIndicator color={(Platform.OS === 'ios' && terminalReady) ? C.text2 : C.accentText} size="small" />
            ) : (
              <>
                <CreditCard color={(Platform.OS === 'ios' && terminalReady) ? C.text2 : C.accentText} size={20} />
                <Text style={[S.collectText, {
                  color: (Platform.OS === 'ios' && terminalReady) ? C.text2 : C.accentText,
                }]}>
                  {(Platform.OS === 'ios' && terminalReady) ? `Card ${total.toFixed(2)}` : `Collect $${total.toFixed(2)}`}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Cash */}
          <TouchableOpacity
            onPress={handleCash}
            disabled={cashLoading || tapLoading || totalCents < 50}
            activeOpacity={0.85}
            style={[S.cashBtn, { backgroundColor: C.card, borderColor: C.cardBorder }]}
          >
            {cashLoading ? (
              <ActivityIndicator color={C.text3} size="small" />
            ) : (
              <>
                <Banknote color={C.text2} size={18} />
                <Text style={[S.cashText, { color: C.text2 }]}>Paid with Cash</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  /* ── AMOUNT STEP ──────────────────────────────────────────────────────── */
  const displayAmt = amount ? `$${amount}` : '$0';

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <TapToPayOverlay
        visible={tapLoading}
        status={tapStatus}
        amount={`$${total.toFixed(2)}`}
        clientName={params.client_name}
        onCancel={handleCancelTap}
      />

      {/* header */}
      <Animated.View style={[S.header, { opacity: fadeIn }]}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <ArrowLeft color={C.text} size={22} />
        </TouchableOpacity>
        <Text style={[S.headerTitle, { color: C.text }]}>Point of Sale</Text>
        <View style={{ width: 40 }} />
      </Animated.View>

      {/* client chip */}
      {params.client_name && (
        <Animated.View style={[S.clientChip, { backgroundColor: C.card, borderColor: C.cardBorder, opacity: fadeIn }]}>
          <Text style={[S.clientText, { color: C.text2 }]}>{params.client_name}</Text>
        </Animated.View>
      )}

      {/* amount display */}
      <Animated.View style={[S.amountArea, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
        <Text style={[S.amountText, {
          color: isValidAmount ? C.text : C.text3,
          fontSize: amount.length > 6 ? 42 : amount.length > 4 ? 52 : 62,
        }]}>
          {displayAmt}
        </Text>
        {subtotalCents > 0 && !isValidAmount && (
          <Text style={[S.minHint, { color: C.text3 }]}>Min $0.50</Text>
        )}
      </Animated.View>

      {/* quick amounts */}
      <Animated.View style={{ opacity: fadeIn }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={S.quickScroll}
        >
          {QUICK.map(q => (
            <TouchableOpacity
              key={q}
              onPress={() => handleQuick(q)}
              activeOpacity={0.8}
              style={[S.quickChip, {
                backgroundColor: amount === String(q) ? C.accent : C.card,
                borderColor: amount === String(q) ? C.accent : C.cardBorder,
              }]}
            >
              <Text style={[S.quickText, {
                color: amount === String(q) ? C.accentText : C.text2,
              }]}>
                ${q}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>

      {/* numpad */}
      <View style={S.numpad}>
        {KEYS.map(k => <NumKey key={k} k={k} onPress={handleKey} C={C} />)}
      </View>

      {/* continue */}
      <View style={S.bottom}>
        <TouchableOpacity
          onPress={() => { if (isValidAmount) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setStep('tip'); } }}
          disabled={!isValidAmount}
          activeOpacity={0.85}
          style={[S.continueBtn, {
            backgroundColor: isValidAmount ? C.accent : C.card,
            opacity: isValidAmount ? 1 : 0.5,
          }]}
        >
          <Text style={[S.continueText, { color: isValidAmount ? C.accentText : C.text3 }]}>
            Continue
          </Text>
          {isValidAmount && <ChevronRight color={C.accentText} size={20} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ═══════════════════════════════ STYLES ═══════════════════════════════════ */
const S = StyleSheet.create({
  container: { flex: 1 },

  /* header */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },

  /* client chip */
  clientChip: {
    alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, marginBottom: 4,
  },
  clientText: { fontSize: 14, fontWeight: '600' },

  /* amount */
  amountArea: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 90 },
  amountText: { fontWeight: '900', letterSpacing: -2 },
  minHint: { fontSize: 12, marginTop: 6 },

  /* quick amounts */
  quickScroll: { paddingHorizontal: 20, gap: 8, paddingBottom: 14 },
  quickChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  quickText: { fontSize: 14, fontWeight: '700' },

  /* numpad */
  numpad: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    gap: 8, paddingHorizontal: 24,
  },
  key: {
    height: 54, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  keyText: { fontSize: 22, fontWeight: '600' },

  /* bottom */
  bottom: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: Platform.OS === 'ios' ? 12 : 20 },
  continueBtn: {
    height: 54, borderRadius: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  continueText: { fontSize: 17, fontWeight: '800' },

  /* ── tip step ─────────────────────────────────────────────── */
  tipScroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 },
  tipLabel: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  tipSubtotal: {
    fontSize: 40, fontWeight: '900', letterSpacing: -1.5,
    textAlign: 'center', marginBottom: 24,
  },
  tipGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center',
    marginBottom: 16,
  },
  tipChip: {
    paddingVertical: 14, borderRadius: 14, borderWidth: 1,
    alignItems: 'center',
  },
  tipChipLabel: { fontSize: 15, fontWeight: '700' },
  tipChipAmt: { fontSize: 12, fontWeight: '500', marginTop: 2 },

  customRow: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 16, marginBottom: 16, height: 50,
  },
  customDollar: { fontSize: 20, fontWeight: '700', marginRight: 4 },
  customInput: { flex: 1, fontSize: 20, fontWeight: '700' },

  breakdown: { borderTopWidth: 1, paddingTop: 16, marginTop: 4 },
  breakRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  breakLabel: { fontSize: 14, fontWeight: '500' },
  breakValue: { fontSize: 14, fontWeight: '600' },
  totalRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  totalLabel: { fontSize: 20, fontWeight: '800' },
  totalValue: { fontSize: 20, fontWeight: '900' },
  feeLabel: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  feeValue: { fontSize: 11, fontWeight: '500', marginTop: 2 },

  tipBottomBtns: { paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 12 : 20, gap: 10 },
  collectBtn: {
    height: 56, borderRadius: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  collectText: { fontSize: 17, fontWeight: '800' },
  cashBtn: {
    height: 48, borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1,
  },
  cashText: { fontSize: 15, fontWeight: '700' },

  /* ── success ──────────────────────────────────────────────── */
  confettiWrap: { position: 'absolute', top: '35%', left: '50%', zIndex: 10 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  successCircle: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  successLabel: { fontSize: 16, fontWeight: '600' },
  successTip: { fontSize: 14, fontWeight: '600' },
  successClient: { fontSize: 14 },
  todayCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16,
    borderWidth: 1, marginTop: 20,
  },
  todayLabel: { fontSize: 13, fontWeight: '600' },
});
