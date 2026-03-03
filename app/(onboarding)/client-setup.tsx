import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Animated,
  StyleSheet, Dimensions, Platform, KeyboardAvoidingView,
  ScrollView, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  User, Cake, Bell, ChevronRight, ChevronLeft,
  Sparkles, Check,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { registerForPushNotifications, savePushTokenToSupabase } from '@/lib/notifications';

const { width } = Dimensions.get('window');

const ACCENT = '#10b981';
const STEPS = ['name', 'birthday', 'notifications', 'done'] as const;
type Step = (typeof STEPS)[number];

export default function ClientSetupScreen() {
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [birthdayYear, setBirthdayYear] = useState('');
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;

  // Pre-fill name from auth metadata
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const fullName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
        const parts = fullName.split(' ');
        if (parts[0]) setFirstName(parts[0]);
        if (parts.length > 1) setLastName(parts.slice(1).join(' '));
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

  const handleEnableNotifications = async () => {
    const token = await registerForPushNotifications();
    if (token) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) await savePushTokenToSupabase(session.user.id, token);
      setNotifEnabled(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated');

      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

      // Update auth metadata
      await supabase.auth.updateUser({
        data: { full_name: fullName },
      });

      // Build birthday if provided
      let birthday: string | null = null;
      if (birthdayMonth && birthdayDay && birthdayYear) {
        const m = birthdayMonth.padStart(2, '0');
        const d = birthdayDay.padStart(2, '0');
        birthday = `${birthdayYear}-${m}-${d}`;
      }

      // Update client row if exists
      const { data: clientRow } = await supabase
        .from('clients')
        .select('id')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

      if (clientRow) {
        const updateData: any = { name: fullName };
        if (birthday) updateData.birthday = birthday;
        await supabase.from('clients').update(updateData).eq('id', clientRow.id);
      }

      // Mark onboarding complete
      await AsyncStorage.setItem('client_onboarding_complete', 'true');

      // Animate success
      Animated.sequence([
        Animated.spring(checkScale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
        Animated.timing(confettiAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]).start();

      // Navigate after brief celebration — go directly, never loop through index
      setTimeout(() => {
        router.replace('/(client)/discover');
      }, 1200);
    } catch (err) {
      console.error('Onboarding save failed:', err);
      router.replace('/(client)/discover');
    }
    setSaving(false);
  };

  const currentStep = STEPS[step];
  const canProceedName = firstName.trim().length >= 1;

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

          {step < STEPS.length - 1 && currentStep !== 'name' ? (
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

            {/* ── Step: Name ── */}
            {currentStep === 'name' && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#10b98118' }]}>
                  <User color={ACCENT} size={32} strokeWidth={1.8} />
                </View>
                <Text style={styles.heading}>What's your name?</Text>
                <Text style={styles.subheading}>
                  So your barber knows who's coming in
                </Text>

                <View style={styles.fieldGroup}>
                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>First name</Text>
                    <TextInput
                      value={firstName}
                      onChangeText={setFirstName}
                      placeholder="Marcus"
                      placeholderTextColor="#3f3f46"
                      style={styles.input}
                      autoCapitalize="words"
                      autoFocus
                      returnKeyType="next"
                    />
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>Last name</Text>
                    <TextInput
                      value={lastName}
                      onChangeText={setLastName}
                      placeholder="Jordan"
                      placeholderTextColor="#3f3f46"
                      style={styles.input}
                      autoCapitalize="words"
                      returnKeyType="done"
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.cta, { opacity: canProceedName ? 1 : 0.4 }]}
                  onPress={goNext}
                  disabled={!canProceedName}
                  activeOpacity={0.88}
                >
                  <Text style={styles.ctaText}>Continue</Text>
                  <ChevronRight color="#fff" size={18} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: Birthday ── */}
            {currentStep === 'birthday' && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#f59e0b18' }]}>
                  <Cake color="#f59e0b" size={32} strokeWidth={1.8} />
                </View>
                <Text style={styles.heading}>When's your birthday?</Text>
                <Text style={styles.subheading}>
                  Get a special birthday treat from your barber 🎁
                </Text>

                <View style={styles.birthdayRow}>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Month</Text>
                    <TextInput
                      value={birthdayMonth}
                      onChangeText={(t) => {
                        const cleaned = t.replace(/[^0-9]/g, '').slice(0, 2);
                        setBirthdayMonth(cleaned);
                      }}
                      placeholder="MM"
                      placeholderTextColor="#3f3f46"
                      style={[styles.input, styles.dateInput]}
                      keyboardType="number-pad"
                      maxLength={2}
                      autoFocus
                    />
                  </View>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Day</Text>
                    <TextInput
                      value={birthdayDay}
                      onChangeText={(t) => {
                        const cleaned = t.replace(/[^0-9]/g, '').slice(0, 2);
                        setBirthdayDay(cleaned);
                      }}
                      placeholder="DD"
                      placeholderTextColor="#3f3f46"
                      style={[styles.input, styles.dateInput]}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </View>
                  <View style={[styles.fieldWrap, { flex: 1.4 }]}>
                    <Text style={styles.fieldLabel}>Year</Text>
                    <TextInput
                      value={birthdayYear}
                      onChangeText={(t) => {
                        const cleaned = t.replace(/[^0-9]/g, '').slice(0, 4);
                        setBirthdayYear(cleaned);
                      }}
                      placeholder="YYYY"
                      placeholderTextColor="#3f3f46"
                      style={[styles.input, styles.dateInput]}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                  </View>
                </View>

                <View style={styles.birthdayHint}>
                  <Sparkles color="#f59e0b" size={14} strokeWidth={2} />
                  <Text style={styles.hintText}>
                    Your barber can send you a birthday discount!
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.cta}
                  onPress={goNext}
                  activeOpacity={0.88}
                >
                  <Text style={styles.ctaText}>
                    {birthdayMonth && birthdayDay ? 'Continue' : 'Skip for now'}
                  </Text>
                  <ChevronRight color="#fff" size={18} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: Notifications ── */}
            {currentStep === 'notifications' && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#6366f118' }]}>
                  <Bell color="#6366f1" size={32} strokeWidth={1.8} />
                </View>
                <Text style={styles.heading}>Stay in the loop</Text>
                <Text style={styles.subheading}>
                  Get reminders before your cut and messages from your barber
                </Text>

                <View style={styles.notifFeatures}>
                  {[
                    { icon: '📅', title: 'Appointment reminders', desc: '24h and 1h before your cut' },
                    { icon: '💬', title: 'Messages', desc: 'Chat with your barber' },
                    { icon: '🎁', title: 'Rewards & offers', desc: 'Loyalty points and birthday treats' },
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

                {notifEnabled ? (
                  <View style={styles.enabledBanner}>
                    <Check color="#10b981" size={20} strokeWidth={2.5} />
                    <Text style={styles.enabledText}>Notifications enabled!</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.cta, { backgroundColor: '#6366f1' }]}
                    onPress={handleEnableNotifications}
                    activeOpacity={0.88}
                  >
                    <Bell color="#fff" size={18} strokeWidth={2} />
                    <Text style={styles.ctaText}>Enable Notifications</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.cta, { marginTop: 10 }]}
                  onPress={handleFinish}
                  activeOpacity={0.88}
                >
                  <Text style={styles.ctaText}>
                    {notifEnabled ? "Let's go!" : 'Continue without'}
                  </Text>
                  <ChevronRight color="#fff" size={18} strokeWidth={2.5} />
                </TouchableOpacity>
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
                  You're all set!
                </Animated.Text>
                <Animated.Text style={[styles.doneSubheading, { opacity: confettiAnim }]}>
                  Time to find your barber
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
  dateInput: {
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  birthdayRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  birthdayHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f59e0b10',
    borderRadius: 12,
    padding: 12,
    marginBottom: 32,
  },
  hintText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  notifFeatures: {
    gap: 16,
    marginBottom: 32,
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
    backgroundColor: '#10b98118',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#10b98130',
    marginBottom: 12,
  },
  enabledText: {
    color: '#10b981',
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
