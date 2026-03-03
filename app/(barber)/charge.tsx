import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  Animated, ActivityIndicator, Alert, Vibration, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft, DollarSign, CreditCard, CheckCircle, X, Trash2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';

const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

export default function ChargeScreen() {
  const { C, theme } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{
    client_name?: string;
    client_id?: string;
    appointment_id?: string;
    prefill_amount?: string;
  }>();

  const [amount, setAmount] = useState(params.prefill_amount || '');
  const [charging, setCharging] = useState(false);
  const [success, setSuccess] = useState(false);
  const [barberId, setBarberId] = useState<string | null>(null);

  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 280, friction: 22, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setBarberId(session.user.id);
    });
  }, []);

  const displayAmount = amount ? `$${amount}` : '$0';
  const amountCents = Math.round(parseFloat(amount || '0') * 100);
  const platformFee = (amountCents * 0.01 / 100).toFixed(2);
  const isValid = amountCents >= 50; // Stripe minimum $0.50

  const handleKey = useCallback((key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (key === 'del') {
      setAmount(prev => prev.slice(0, -1));
      return;
    }

    if (key === '.') {
      if (amount.includes('.')) return;
      setAmount(prev => prev + '.');
      return;
    }

    setAmount(prev => {
      const next = prev + key;
      // Max 2 decimal places
      if (next.includes('.') && next.split('.')[1].length > 2) return prev;
      // Max $99,999
      if (parseFloat(next) > 99999) return prev;
      return next;
    });
  }, [amount]);

  const handleCharge = async () => {
    if (!isValid || !barberId || charging) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setCharging(true);

    try {
      // Use raw fetch so we can read the actual error body (supabase.functions.invoke
      // swallows the real error message with a generic "non-2xx" wrapper)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          barber_id:      barberId,
          amount_cents:   amountCents,
          currency:       'usd',
          payment_type:   'pos',
          client_id:      params.client_id   || null,
          appointment_id: params.appointment_id || null,
          description:    params.client_name
            ? `POS charge for ${params.client_name}`
            : 'POS charge',
        }),
      });

      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);

      // Mark appointment as paid if we have one
      if (params.appointment_id && data?.payment_record_id) {
        await supabase.from('appointments').update({
          paid:          true,
          payment_id:    data.payment_record_id,
          price_charged: parseFloat(amount),
        }).eq('id', params.appointment_id);
      }

      // Success!
      setSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.spring(successScale, {
        toValue: 1, tension: 200, friction: 12, useNativeDriver: true,
      }).start();

      toast.success(`Charged $${amount} successfully`);

      // Go back after delay
      setTimeout(() => router.back(), 2000);
    } catch (err: any) {
      console.error('POS charge error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.error(err.message || 'Charge failed');
      setCharging(false);
    }
  };

  const green = '#16a34a';

  if (success) {
    return (
      <SafeAreaView style={[S.container, { backgroundColor: C.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={S.successWrap}>
          <Animated.View style={[S.successCircle, {
            backgroundColor: green + '18',
            transform: [{ scale: successScale }],
          }]}>
            <CheckCircle color={green} size={64} strokeWidth={1.5} />
          </Animated.View>
          <Text style={[S.successAmount, { color: C.text }]}>${amount}</Text>
          <Text style={[S.successLabel, { color: C.text2 }]}>Payment charged</Text>
          {params.client_name && (
            <Text style={[S.successClient, { color: C.text3 }]}>{params.client_name}</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <Animated.View style={[S.header, { opacity: fadeAnim }]}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <ArrowLeft color={C.text} size={22} />
        </TouchableOpacity>
        <Text style={[S.headerTitle, { color: C.text }]}>Charge Client</Text>
        <View style={{ width: 40 }} />
      </Animated.View>

      {/* Client info */}
      {params.client_name && (
        <Animated.View style={[S.clientBanner, {
          backgroundColor: C.card, borderColor: C.cardBorder, opacity: fadeAnim,
        }]}>
          <Text style={[S.clientName, { color: C.text }]}>{params.client_name}</Text>
        </Animated.View>
      )}

      {/* Amount display */}
      <Animated.View style={[S.amountSection, { transform: [{ scale: scaleAnim }], opacity: fadeAnim }]}>
        <Text style={[S.amountText, {
          color: isValid ? C.text : C.text3,
          fontSize: amount.length > 6 ? 48 : amount.length > 4 ? 56 : 64,
        }]}>
          {displayAmount}
        </Text>
        {amountCents > 0 && (
          <Text style={[S.feeText, { color: C.text3 }]}>
            Kutz fee: ${platformFee}
          </Text>
        )}
      </Animated.View>

      {/* Numpad */}
      <View style={S.numpad}>
        {NUM_KEYS.map(key => (
          <TouchableOpacity
            key={key}
            onPress={() => handleKey(key)}
            activeOpacity={0.6}
            style={[S.numKey, { backgroundColor: key === 'del' ? 'transparent' : C.card, borderColor: C.cardBorder }]}
          >
            {key === 'del' ? (
              <Trash2 color={C.text3} size={20} />
            ) : (
              <Text style={[S.numKeyText, { color: C.text }]}>{key}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Charge button */}
      <View style={S.bottomSection}>
        <TouchableOpacity
          onPress={handleCharge}
          disabled={!isValid || charging}
          activeOpacity={0.85}
          style={[S.chargeBtn, {
            backgroundColor: isValid ? C.accent : C.card,
            opacity: isValid ? 1 : 0.5,
          }]}
        >
          {charging ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <CreditCard color={isValid ? '#fff' : C.text3} size={20} />
              <Text style={[S.chargeBtnText, { color: isValid ? '#fff' : C.text3 }]}>
                {isValid ? `Charge $${amount}` : 'Enter amount'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  clientBanner: {
    marginHorizontal: 20, paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 14, borderWidth: 1, alignItems: 'center',
  },
  clientName: { fontSize: 15, fontWeight: '700' },
  amountSection: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 140 },
  amountText: { fontWeight: '900', letterSpacing: -2 },
  feeText: { fontSize: 12, marginTop: 8 },
  numpad: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24,
    gap: 10, justifyContent: 'center',
  },
  numKey: {
    width: '30%', height: 60, borderRadius: 16, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  numKeyText: { fontSize: 24, fontWeight: '600' },
  bottomSection: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === 'ios' ? 16 : 24 },
  chargeBtn: {
    height: 56, borderRadius: 18, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  chargeBtnText: { fontSize: 17, fontWeight: '800' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  successCircle: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  successAmount: { fontSize: 48, fontWeight: '900', letterSpacing: -1 },
  successLabel: { fontSize: 16, fontWeight: '600' },
  successClient: { fontSize: 14 },
});
