import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Animated,
  StyleSheet, Dimensions, Platform, KeyboardAvoidingView,
  ScrollView, StatusBar, Switch, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  User, Scissors, Clock, ChevronRight, ChevronLeft,
  Check, CreditCard, ExternalLink,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, SUPABASE_URL } from '@/lib/supabase';

const { width } = Dimensions.get('window');

const ACCENT = '#a855f7';
const STEPS = ['profile', 'shop', 'schedule', 'stripe', 'done'] as const;
type Step = (typeof STEPS)[number];

const DAYS = [
  { num: 1, short: 'Mon', full: 'Monday' },
  { num: 2, short: 'Tue', full: 'Tuesday' },
  { num: 3, short: 'Wed', full: 'Wednesday' },
  { num: 4, short: 'Thu', full: 'Thursday' },
  { num: 5, short: 'Fri', full: 'Friday' },
  { num: 6, short: 'Sat', full: 'Saturday' },
  { num: 0, short: 'Sun', full: 'Sunday' },
];

type DaySched = { active: boolean; start: string; end: string };

export default function BarberSetupScreen() {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopBio, setShopBio] = useState('');
  const [schedule, setSchedule] = useState<Record<number, DaySched>>(() => {
    const s: Record<number, DaySched> = {};
    for (const d of DAYS) {
      s[d.num] = { active: d.num >= 1 && d.num <= 5, start: '09:00', end: '18:00' };
    }
    return s;
  });
  const [stripeConnecting, setStripeConnecting] = useState(false);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [barberId, setBarberId] = useState<string | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setBarberId(session.user.id);
        const fullName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
        if (fullName) setDisplayName(fullName);
      }
    });
  }, []);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: step / (STEPS.length - 1),
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [step]);

  const animateTransition = (direction: 'forward' | 'back', callback: () => void) => {
    const offset = direction === 'forward' ? 40 : -40;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -offset, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      callback();
      slideAnim.setValue(offset);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 200, friction: 16, useNativeDriver: true }),
      ]).start();
    });
  };

  const goNext = () => {
    if (step >= STEPS.length - 1) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition('forward', () => setStep(s => s + 1));
  };

  const goBack = () => {
    if (step === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition('back', () => setStep(s => s - 1));
  };

  const toggleDay = (dayNum: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSchedule(prev => ({
      ...prev,
      [dayNum]: { ...prev[dayNum], active: !prev[dayNum].active },
    }));
  };

  const connectStripe = async () => {
    if (!barberId) return;
    setStripeConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-connect-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          barber_id: barberId,
          return_url: 'kutz://stripe-return',
          refresh_url: 'kutz://stripe-refresh',
        }),
      });

      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Failed');

      await WebBrowser.openBrowserAsync(result.url);

      // Check if completed after return
      const { data: refreshed } = await supabase
        .from('profiles')
        .select('stripe_charges_enabled')
        .eq('id', barberId)
        .single();

      if (refreshed?.stripe_charges_enabled) {
        setStripeConnected(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: any) {
      console.error('Stripe connect error:', err);
    }
    setStripeConnecting(false);
  };

  const handleFinish = async () => {
    setSaving(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated');
      const uid = session.user.id;

      // Save profile
      await supabase.from('profiles').upsert({
        id: uid,
        display_name: displayName.trim(),
        shop_name: shopName.trim() || null,
        shop_bio: shopBio.trim() || null,
        onboarding_complete: true,
      }, { onConflict: 'id' });

      // Update auth metadata
      await supabase.auth.updateUser({
        data: { full_name: displayName.trim() },
      });

      // Save schedule
      const schedUpserts = DAYS.map(day => ({
        barber_id: uid,
        day_of_week: day.num,
        is_active: schedule[day.num].active,
        start_time: schedule[day.num].start,
        end_time: schedule[day.num].end,
      }));
      await supabase.from('barber_schedule').upsert(schedUpserts, {
        onConflict: 'barber_id,day_of_week',
      });

      // Animate success then go directly to dashboard (never back through index)
      Animated.sequence([
        Animated.spring(checkScale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
        Animated.timing(confettiAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]).start();

      setTimeout(() => {
        router.replace('/(barber)/dashboard');
      }, 1200);
    } catch (err) {
      console.error('Barber onboarding save failed:', err);
      router.replace('/(barber)/dashboard');
    }
    setSaving(false);
  };

  const currentStep = STEPS[step];
  const canProceedProfile = displayName.trim().length >= 1;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>

        {/* Top bar */}
        <View style={styles.topBar}>
          {step > 0 && step < STEPS.length - 1 ? (
            <TouchableOpacity onPress={goBack} style={styles.backBtn} activeOpacity={0.7}>
              <ChevronLeft color="#71717a" size={20} strokeWidth={2} />
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}

          <Text style={styles.stepIndicator}>
            {step < STEPS.length - 1 ? `${step + 1} of ${STEPS.length - 1}` : ''}
          </Text>

          {step < STEPS.length - 1 && currentStep !== 'profile' ? (
            <TouchableOpacity onPress={goNext} activeOpacity={0.7}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{
            opacity: fadeAnim,
            transform: [{ translateX: slideAnim }],
            flex: 1,
          }}>

            {/* ── Step: Profile ── */}
            {currentStep === 'profile' && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#a855f718' }]}>
                  <User color={ACCENT} size={32} strokeWidth={1.8} />
                </View>
                <Text style={styles.heading}>Let's set you up</Text>
                <Text style={styles.subheading}>
                  What should your clients call you?
                </Text>

                <View style={styles.fieldGroup}>
                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>Your name</Text>
                    <TextInput
                      value={displayName}
                      onChangeText={setDisplayName}
                      placeholder="e.g. Marcus The Barber"
                      placeholderTextColor="#3f3f46"
                      style={styles.input}
                      autoCapitalize="words"
                      autoFocus
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.cta, { opacity: canProceedProfile ? 1 : 0.4 }]}
                  onPress={goNext}
                  disabled={!canProceedProfile}
                  activeOpacity={0.88}
                >
                  <Text style={styles.ctaText}>Continue</Text>
                  <ChevronRight color="#fff" size={18} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: Shop ── */}
            {currentStep === 'shop' && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#a855f718' }]}>
                  <Scissors color={ACCENT} size={32} strokeWidth={1.8} />
                </View>
                <Text style={styles.heading}>Your shop</Text>
                <Text style={styles.subheading}>
                  Tell clients about your barbershop
                </Text>

                <View style={styles.fieldGroup}>
                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>Shop name</Text>
                    <TextInput
                      value={shopName}
                      onChangeText={setShopName}
                      placeholder="e.g. Fresh Cuts Studio"
                      placeholderTextColor="#3f3f46"
                      style={styles.input}
                      autoCapitalize="words"
                      autoFocus
                    />
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>Short bio (optional)</Text>
                    <TextInput
                      value={shopBio}
                      onChangeText={setShopBio}
                      placeholder="Premium cuts in downtown..."
                      placeholderTextColor="#3f3f46"
                      style={[styles.input, styles.textArea]}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.cta}
                  onPress={goNext}
                  activeOpacity={0.88}
                >
                  <Text style={styles.ctaText}>
                    {shopName.trim() ? 'Continue' : 'Skip for now'}
                  </Text>
                  <ChevronRight color="#fff" size={18} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: Schedule ── */}
            {currentStep === 'schedule' && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#a855f718' }]}>
                  <Clock color={ACCENT} size={32} strokeWidth={1.8} />
                </View>
                <Text style={styles.heading}>Working hours</Text>
                <Text style={styles.subheading}>
                  Which days are you available? You can fine-tune times later.
                </Text>

                <View style={styles.scheduleCard}>
                  {DAYS.map((day, idx) => (
                    <TouchableOpacity
                      key={day.num}
                      style={[
                        styles.dayRow,
                        idx < DAYS.length - 1 && styles.dayRowBorder,
                      ]}
                      onPress={() => toggleDay(day.num)}
                      activeOpacity={0.8}
                    >
                      <View style={[
                        styles.dayToggle,
                        schedule[day.num].active && styles.dayToggleActive,
                      ]}>
                        {schedule[day.num].active && (
                          <Check color="#fff" size={12} strokeWidth={3} />
                        )}
                      </View>
                      <Text style={[
                        styles.dayName,
                        !schedule[day.num].active && styles.dayNameOff,
                      ]}>
                        {day.full}
                      </Text>
                      <Text style={[
                        styles.dayHours,
                        !schedule[day.num].active && styles.dayHoursOff,
                      ]}>
                        {schedule[day.num].active ? '9:00 AM - 6:00 PM' : 'Closed'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={styles.cta}
                  onPress={goNext}
                  activeOpacity={0.88}
                >
                  <Text style={styles.ctaText}>Continue</Text>
                  <ChevronRight color="#fff" size={18} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: Stripe ── */}
            {currentStep === 'stripe' && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#635bff18' }]}>
                  <CreditCard color="#635bff" size={32} strokeWidth={1.8} />
                </View>
                <Text style={styles.heading}>Accept payments</Text>
                <Text style={styles.subheading}>
                  Connect Stripe to take payments online and in-person. You can also do this later from Settings.
                </Text>

                <View style={styles.stripeFeatures}>
                  {[
                    { icon: '💳', title: 'Card payments', desc: 'Clients pay when they book' },
                    { icon: '📱', title: 'In-person POS', desc: 'Charge at the chair from your phone' },
                    { icon: '🔒', title: 'Secure payouts', desc: 'Direct to your bank account' },
                  ].map((f, i) => (
                    <View key={i} style={styles.featureRow}>
                      <Text style={styles.featureIcon}>{f.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.featureTitle}>{f.title}</Text>
                        <Text style={styles.featureDesc}>{f.desc}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {stripeConnected ? (
                  <View style={styles.enabledBanner}>
                    <Check color="#22c55e" size={20} strokeWidth={2.5} />
                    <Text style={[styles.enabledText, { color: '#22c55e' }]}>Stripe connected!</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.cta, { backgroundColor: '#635bff' }]}
                    onPress={connectStripe}
                    disabled={stripeConnecting}
                    activeOpacity={0.88}
                  >
                    {stripeConnecting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <CreditCard color="#fff" size={18} strokeWidth={2} />
                        <Text style={styles.ctaText}>Connect Stripe</Text>
                        <ExternalLink color="#fff" size={14} strokeWidth={2} />
                      </>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.cta, { marginTop: 10 }]}
                  onPress={handleFinish}
                  activeOpacity={0.88}
                >
                  <Text style={styles.ctaText}>
                    {stripeConnected ? "Let's go!" : "I'll do this later"}
                  </Text>
                  <ChevronRight color="#fff" size={18} strokeWidth={2.5} />
                </TouchableOpacity>

                <Text style={styles.stripeNote}>
                  Stripe setup opens in your browser. It takes about 5 minutes.
                </Text>
              </View>
            )}

            {/* ── Step: Done ── */}
            {currentStep === 'done' && (
              <View style={[styles.stepContainer, { justifyContent: 'center' }]}>
                <Animated.View style={[
                  styles.doneCircle,
                  { transform: [{ scale: checkScale }] },
                ]}>
                  <Check color="#fff" size={48} strokeWidth={2.5} />
                </Animated.View>
                <Animated.Text style={[styles.doneHeading, { opacity: confettiAnim }]}>
                  You're ready!
                </Animated.Text>
                <Animated.Text style={[styles.doneSubheading, { opacity: confettiAnim }]}>
                  Your barbershop is live
                </Animated.Text>
              </View>
            )}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#1a1a1e',
    borderRadius: 1.5,
    marginHorizontal: 20,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 1.5,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicator: {
    color: '#52525b',
    fontSize: 13,
    fontWeight: '600',
  },
  skipText: {
    color: '#71717a',
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 8,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  stepContainer: {
    flex: 1,
    paddingTop: 24,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  heading: {
    color: '#fafafa',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  subheading: {
    color: '#71717a',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
    marginBottom: 32,
  },
  fieldGroup: {
    gap: 16,
    marginBottom: 32,
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 2,
  },
  input: {
    height: 54,
    backgroundColor: '#141416',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#fafafa',
  },
  textArea: {
    height: 90,
    paddingTop: 14,
    fontSize: 15,
    fontWeight: '500',
  },
  scheduleCard: {
    backgroundColor: '#141416',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e1e22',
    overflow: 'hidden',
    marginBottom: 24,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  dayRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e22',
  },
  dayToggle: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayToggleActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  dayName: {
    flex: 1,
    color: '#fafafa',
    fontSize: 15,
    fontWeight: '600',
  },
  dayNameOff: {
    color: '#52525b',
  },
  dayHours: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '500',
  },
  dayHoursOff: {
    color: '#3f3f46',
  },
  stripeFeatures: {
    gap: 12,
    marginBottom: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#141416',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e1e22',
  },
  featureIcon: {
    fontSize: 24,
  },
  featureTitle: {
    color: '#fafafa',
    fontSize: 15,
    fontWeight: '700',
  },
  featureDesc: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  enabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#22c55e18',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#22c55e30',
    marginBottom: 12,
  },
  enabledText: {
    fontSize: 15,
    fontWeight: '700',
  },
  cta: {
    height: 56,
    backgroundColor: ACCENT,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  stripeNote: {
    color: '#52525b',
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 12,
  },
  doneCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
  },
  doneHeading: {
    color: '#fafafa',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
    textAlign: 'center',
    marginBottom: 8,
  },
  doneSubheading: {
    color: '#71717a',
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'center',
  },
});
