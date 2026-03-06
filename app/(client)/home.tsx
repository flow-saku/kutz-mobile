import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, TouchableOpacity,
  RefreshControl, StyleSheet, StatusBar, Animated, Pressable, Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  Star, CalendarCheck, MessageCircle,
  ChevronRight, Gift, Clock, MapPin, Settings, Zap, ArrowRight, History,
  PartyPopper, Sparkles,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { getBarberProfile } from '@/lib/barber';
import { getActiveClientBinding } from '@/lib/clientSync';
import { format, isToday, differenceInMinutes, differenceInDays, isTomorrow } from 'date-fns';
import type { User } from '@supabase/supabase-js';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

// Keep in sync with _layout.tsx BAR_HEIGHT + bottom offset
const TAB_BAR_HEIGHT = 72;

const TIERS = [
  // New — neutral (0 visits, no tier yet)
  { tier: 'new',      label: 'New',      sym: '○', minVisits: 0,
    inkL: '#6b7280', bgL: '#f4f4f5', borderL: '#d1d5db',
    inkD: '#9ca3af', bgD: '#18181b',  borderD: '#3f3f46',
    glowL: 'rgba(107,114,128,0.06)', glowD: 'rgba(156,163,175,0.08)' },
  // Bronze — copper/brown (1–4 visits)
  { tier: 'bronze',   label: 'Bronze',   sym: '◆', minVisits: 1,
    inkL: '#78350f', bgL: '#fde8c8', borderL: '#c2692a',
    inkD: '#fb923c', bgD: '#1f0e00',  borderD: '#92400e',
    glowL: 'rgba(194,105,42,0.14)',  glowD: 'rgba(251,146,60,0.16)' },
  // Silver — slate  (5–11 visits)
  { tier: 'silver',   label: 'Silver',   sym: '◈', minVisits: 5,
    inkL: '#64748b', bgL: '#f8fafc', borderL: '#94a3b8',
    inkD: '#94a3b8', bgD: '#0f172a',  borderD: '#475569',
    glowL: 'rgba(148,163,184,0.12)', glowD: 'rgba(148,163,184,0.14)' },
  // Gold — yellow   (12–24 visits)
  { tier: 'gold',     label: 'Gold',     sym: '★', minVisits: 12,
    inkL: '#ca8a04', bgL: '#fefce8', borderL: '#eab308',
    inkD: '#eab308', bgD: '#1a1100',  borderD: '#a16207',
    glowL: 'rgba(234,179,8,0.13)',   glowD: 'rgba(234,179,8,0.18)' },
  // Platinum — violet (25–49 visits)
  { tier: 'platinum', label: 'Platinum', sym: '◉', minVisits: 25,
    inkL: '#7c3aed', bgL: '#f5f3ff', borderL: '#7c3aed',
    inkD: '#a78bfa', bgD: '#130d2e',  borderD: '#6d28d9',
    glowL: 'rgba(124,58,237,0.12)',  glowD: 'rgba(167,139,250,0.16)' },
  // Diamond — cyan   (50+ visits)
  { tier: 'diamond',  label: 'Diamond',  sym: '◇', minVisits: 50,
    inkL: '#0891b2', bgL: '#ecfeff', borderL: '#06b6d4',
    inkD: '#22d3ee', bgD: '#031a1f',  borderD: '#0891b2',
    glowL: 'rgba(6,182,212,0.14)',   glowD: 'rgba(34,211,238,0.20)' },
];

function getTier(v: number) {
  let t = TIERS[0];
  for (const tier of TIERS) { if (v >= tier.minVisits) t = tier; }
  return t;
}
function getNextTier(v: number) {
  const idx = TIERS.findLastIndex(t => v >= t.minVisits);
  return idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
}
function fmt12(t: string) {
  try {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}
function getCountdown(apt: any) {
  try {
    const [h, m] = apt.start_time.split(':').map(Number);
    const d = new Date(apt.date + 'T00:00:00');
    d.setHours(h, m, 0, 0);
    const mins = differenceInMinutes(d, new Date());
    if (mins < 0) return { label: "It's time!", sub: 'Head over now' };
    if (isToday(d)) {
      if (mins < 60) return { label: `${mins}m`, sub: 'away' };
      const hrs = Math.floor(mins / 60);
      return { label: `${hrs}h ${mins % 60}m`, sub: 'until your cut' };
    }
    if (isTomorrow(d)) return { label: 'Tomorrow', sub: fmt12(apt.start_time) };
    const days = differenceInDays(d, new Date());
    if (days <= 7) return { label: `${days}d`, sub: format(d, 'EEE MMM d') };
    return { label: format(d, 'MMM d'), sub: fmt12(apt.start_time) };
  } catch { return { label: 'Upcoming', sub: '' }; }
}

function Tap({ onPress, style, children }: { onPress: () => void; style?: any; children: React.ReactNode }) {
  const s = useRef(new Animated.Value(1)).current;
  // Pull layout-affecting props onto Pressable, visual props onto Animated.View
  // This ensures flex/width constraints work while backgroundColor etc. are visible
  const { width, height, flex, margin, marginBottom, marginTop, marginHorizontal, marginVertical, ...visualStyle } = StyleSheet.flatten(style) || {};
  const layoutStyle = { width, height, flex, margin, marginBottom, marginTop, marginHorizontal, marginVertical };
  return (
    <Pressable
      style={layoutStyle}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(s, { toValue: 0.968, useNativeDriver: true, tension: 600, friction: 32 }).start();
      }}
      onPressOut={() => Animated.spring(s, { toValue: 1, useNativeDriver: true, tension: 400, friction: 26 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[visualStyle, { flex: 1, transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  // Clearance = bar height + bottom safe area + a little breathing room
  const tabClearance = TAB_BAR_HEIGHT + Math.max(18, insets.bottom + 10) + 20;

  const [authUser, setAuthUser]             = useState<User | null>(null);
  const [isLoading, setIsLoading]           = useState(true);
  const [displayName, setDisplayName]       = useState('');
  const [visitCount, setVisitCount]         = useState(0);
  const [pointsBalance, setPointsBalance]   = useState(0);
  const [rewards, setRewards]               = useState<any[]>([]);
  const [upcomingAppt, setUpcomingAppt]     = useState<any>(null);
  const [refreshing, setRefreshing]         = useState(false);
  const [barbershopName, setBarbershopName] = useState<string | null>(null);
  const [tierGlowEnabled, setTierGlowEnabled] = useState(false);
  const [birthdayOffer, setBirthdayOffer]   = useState<{ message: string; offerType: string; offerValue: string } | null>(null);
  const [birthdayOpened, setBirthdayOpened] = useState(false);
  const birthdayAnim   = useRef(new Animated.Value(0)).current;
  // Gift-box animations
  const giftWiggle     = useRef(new Animated.Value(0)).current;
  const giftExit       = useRef(new Animated.Value(1)).current;
  const revealEnter    = useRef(new Animated.Value(0)).current;
  const wiggleRef      = useRef<Animated.CompositeAnimation | null>(null);
  const CONFETTI_COLORS = ['#f472b6','#fbbf24','#a78bfa','#34d399','#60a5fa','#f97316','#e879f9','#fff'];
  const confetti = useRef(Array.from({ length: 8 }, () => ({
    x: new Animated.Value(0), y: new Animated.Value(0),
    opacity: new Animated.Value(0), scale: new Animated.Value(0),
  }))).current;

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const animateIn = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 200, friction: 20, useNativeDriver: true }),
    ]).start();
  }, []);

  // Subtle periodic wiggle — present gently shakes to invite a tap
  useEffect(() => {
    if (!birthdayOffer) return;
    setBirthdayOpened(false);
    giftExit.setValue(1);
    revealEnter.setValue(0);
    giftWiggle.setValue(0);

    // Long rest → quick shake → long rest (repeat)
    wiggleRef.current = Animated.loop(Animated.sequence([
      Animated.timing(giftWiggle, { toValue: 0,    duration: 2400, useNativeDriver: true }),
      Animated.timing(giftWiggle, { toValue: 1,    duration: 100,  useNativeDriver: true }),
      Animated.timing(giftWiggle, { toValue: -1,   duration: 100,  useNativeDriver: true }),
      Animated.timing(giftWiggle, { toValue: 0.6,  duration: 85,   useNativeDriver: true }),
      Animated.timing(giftWiggle, { toValue: -0.6, duration: 85,   useNativeDriver: true }),
      Animated.timing(giftWiggle, { toValue: 0,    duration: 70,   useNativeDriver: true }),
    ]));
    wiggleRef.current.start();
    return () => { wiggleRef.current?.stop(); };
  }, [birthdayOffer]);

  const handleOpenGift = useCallback(() => {
    wiggleRef.current?.stop();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Fire confetti
    confetti.forEach((c, i) => {
      const angle = (i / confetti.length) * Math.PI * 2 + 0.3;
      const dist  = 55 + (i % 3) * 26;
      c.x.setValue(0); c.y.setValue(0); c.opacity.setValue(0); c.scale.setValue(0.4);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(c.opacity, { toValue: 1,   duration: 70,  useNativeDriver: true }),
          Animated.timing(c.scale,   { toValue: 1.5, duration: 70,  useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(c.x,       { toValue: Math.cos(angle) * dist,       duration: 680, useNativeDriver: true }),
          Animated.timing(c.y,       { toValue: Math.sin(angle) * dist - 65,  duration: 680, useNativeDriver: true }),
          Animated.timing(c.opacity, { toValue: 0,   duration: 480, delay: 200, useNativeDriver: true }),
          Animated.timing(c.scale,   { toValue: 0.2, duration: 680, useNativeDriver: true }),
        ]),
      ]).start();
    });

    // Gift card: micro-bounce then shrink
    Animated.sequence([
      Animated.spring(giftExit, { toValue: 1.12, tension: 700, friction: 5, useNativeDriver: true }),
      Animated.timing(giftExit, { toValue: 0, duration: 170, useNativeDriver: true }),
    ]).start(() => setBirthdayOpened(true));

    // Reveal springs in after gift disappears
    setTimeout(() => {
      Animated.spring(revealEnter, { toValue: 1, tension: 110, friction: 12, useNativeDriver: true }).start();
    }, 310);
  }, [confetti, giftExit, revealEnter]);

  const fetchData = useCallback(async (user: User) => {
    try {
      const binding = await getActiveClientBinding(user.id);
      if (!binding) {
        setVisitCount(0);
        setPointsBalance(0);
        setRewards([]);
        setUpcomingAppt(null);
        setBarbershopName(null);
        setIsLoading(false);
        animateIn();
        return;
      }

      setVisitCount(binding.visitCount ?? 0);

      const profile = await getBarberProfile(binding.barberId);
      // Collect all possible barber_id values stored in appointments
      // (web app may write user.id which could be profiles.id OR profiles.user_id)
      const scopeIds = Array.from(
        new Set([binding.barberId, binding.rawBarberId, (profile as any)?.id, (profile as any)?.user_id].filter(Boolean))
      ) as string[];

      const [pts, appt, rwds, clientRow, bdayConfig] = await Promise.all([
        supabase.from('loyalty_points').select('points_balance')
          .eq('client_id', binding.clientId).eq('barber_id', binding.barberId).maybeSingle(),
        supabase.from('appointments')
          .select('id, date, start_time, end_time, status, service_id, services(name)')
          .eq('client_id', binding.clientId)
          .in('barber_id', scopeIds)
          .in('status', ['confirmed', 'pending'])
          .gte('date', format(new Date(), 'yyyy-MM-dd'))
          .order('date', { ascending: true }).order('start_time', { ascending: true })
          .limit(1).maybeSingle(),
        supabase.from('loyalty_rewards').select('id, name, points_required, is_active')
          .eq('barber_id', binding.barberId).eq('is_active', true)
          .order('points_required', { ascending: true }),
        supabase.from('clients').select('birthday').eq('id', binding.clientId).maybeSingle(),
        supabase.from('birthday_config').select('is_active, offer_type, offer_value, message, valid_days')
          .eq('barber_id', binding.barberId).maybeSingle(),
      ]);

      setPointsBalance((pts.data as any)?.points_balance ?? 0);
      setUpcomingAppt((appt.data as any) ?? null);
      setRewards((rwds.data as any[]) ?? []);

      // Birthday offer logic
      const bday = (clientRow.data as any)?.birthday as string | null;
      const bconf = bdayConfig.data as any;
      if (bday && bconf?.is_active) {
        const today = new Date();
        const bdayDate = new Date(bday + 'T00:00:00');
        const thisYearBday = new Date(today.getFullYear(), bdayDate.getMonth(), bdayDate.getDate());
        const diffMs = today.getTime() - thisYearBday.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        // Show only on birthday and the day after (in case they didn't open the app that day)
        const isInWindow = diffDays >= 0 && diffDays <= 1;
        if (isInWindow) {
          setBirthdayOffer({
            message: bconf.message || 'Happy Birthday! Here\'s a special gift for you 🎁',
            offerType: bconf.offer_type || 'custom',
            offerValue: bconf.offer_value || '',
          });
          Animated.spring(birthdayAnim, { toValue: 1, tension: 120, friction: 14, useNativeDriver: true }).start();
        } else {
          setBirthdayOffer(null);
        }
      } else {
        setBirthdayOffer(null);
      }
      setBarbershopName((profile as any)?.shop_name || (profile as any)?.display_name || null);
    } catch (e) { console.warn(e); }
    finally { setIsLoading(false); animateIn(); }
  }, [animateIn]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session?.user) {
        setAuthUser(session.user);
        setDisplayName(session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'there');
        fetchData(session.user);
      } else { router.replace('/(auth)/login'); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e: any, session: any) => {
      if (session?.user) {
        setAuthUser(session.user);
        setDisplayName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'there');
        fetchData(session.user);
      } else { router.replace('/(auth)/login'); }
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchData]);

  // Re-fetch whenever this screen comes into focus (e.g. returning from booking or settings)
  useFocusEffect(
    useCallback(() => {
      if (authUser) fetchData(authUser);
      AsyncStorage.getItem('tier_glow_enabled').then((v) => setTierGlowEnabled(v === 'true'));
    }, [authUser, fetchData])
  );

  const onRefresh = useCallback(async () => {
    if (!authUser) return;
    setRefreshing(true);
    await fetchData(authUser);
    setRefreshing(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [authUser, fetchData]);

  if (isLoading) {
    return <View style={[S.center, { backgroundColor: C.bg }]}><ActivityIndicator color={C.accent} size="large" /></View>;
  }

  // ── Tier calculations ──
  const tier        = getTier(visitCount);
  const nextTier    = getNextTier(visitCount);
  const tierInk     = isDark ? tier.inkD    : tier.inkL;
  const tierBg      = isDark ? tier.bgD    : tier.bgL;
  const tierBorder  = isDark ? tier.borderD : tier.borderL;
  const tierGlow    = isDark ? tier.glowD  : tier.glowL;

  const visitsLeft     = nextTier ? nextTier.minVisits - visitCount : 0;
  const tierPct        = nextTier
    ? Math.max(4, Math.min(100, ((visitCount - tier.minVisits) / Math.max(1, nextTier.minVisits - tier.minVisits)) * 100))
    : 100;
  const nextReward     = rewards.find(r => pointsBalance < r.points_required) ?? null;
  const rewardPct      = nextReward ? Math.min(100, (pointsBalance / Math.max(1, nextReward.points_required)) * 100) : 100;

  const countdown = upcomingAppt ? getCountdown(upcomingAppt) : null;
  const firstName = displayName.split(' ')[0];
  const hour      = new Date().getHours();
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Accent-tinted bg for chips
  const accentChip   = C.bg2;
  const accentBorder = C.border;
  const TONES = {
    blue: {
      icon: '#3b82f6',
      bg: isDark ? 'rgba(59,130,246,0.16)' : 'rgba(59,130,246,0.10)',
      border: isDark ? 'rgba(59,130,246,0.28)' : 'rgba(59,130,246,0.20)',
    },
    emerald: {
      icon: '#10b981',
      bg: isDark ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.10)',
      border: isDark ? 'rgba(16,185,129,0.28)' : 'rgba(16,185,129,0.20)',
    },
    amber: {
      icon: '#f59e0b',
      bg: isDark ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.10)',
      border: isDark ? 'rgba(245,158,11,0.28)' : 'rgba(245,158,11,0.20)',
    },
    violet: {
      icon: '#8b5cf6',
      bg: isDark ? 'rgba(139,92,246,0.16)' : 'rgba(139,92,246,0.10)',
      border: isDark ? 'rgba(139,92,246,0.28)' : 'rgba(139,92,246,0.20)',
    },
  };

  return (
    <SafeAreaView style={[S.safe, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Full-screen tier tint — only shown when user enables it in settings */}
      {tierGlowEnabled && (
        <View style={[S.tierGlow, { backgroundColor: tierGlow }]} pointerEvents="none" />
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: 'transparent' }}
        contentContainerStyle={[S.scroll, { paddingBottom: tabClearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.text3} />}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── TINTED HEADER ZONE (removed wrapper, tint is full screen now) ── */}
          <View>

          {/* ── HEADER ─────────────────────────────── */}
          <View style={S.header}>
            <View style={{ flex: 1 }}>
              <Text style={[S.greeting, { color: C.text3 }]}>{greeting}</Text>
              <Text style={[S.name, { color: C.text }]} numberOfLines={1}>
                {firstName}
              </Text>
            </View>
            <Tap onPress={() => router.push('/(client)/settings')}
              style={[S.settingsBtn, { backgroundColor: C.bg2, borderColor: C.border }]}>
              <Settings color={C.text3} size={18} strokeWidth={1.7} />
            </Tap>
          </View>

          {/* Barbershop pill — tappable to switch shops */}
          {barbershopName && (
            <TouchableOpacity
              onPress={() => router.push('/(client)/discover')}
              style={[S.shopPill, { backgroundColor: C.bg2, borderColor: C.border }]}
              activeOpacity={0.7}
            >
              <MapPin color={C.accent} size={11} />
              <Text style={[S.shopPillTxt, { color: C.text2 }]}>{barbershopName}</Text>
              <ChevronRight color={C.text3} size={10} strokeWidth={2} />
            </TouchableOpacity>
          )}

          {/* ── TIER HERO CARD ──────────────────────
               Its own card above the booking section,
               like the web Client Hub.
          ─────────────────────────────────────────── */}
          <Tap onPress={() => router.push('/(client)/loyalty')}
            style={[S.tierCard, { backgroundColor: tierBg, borderColor: tierBorder }]}>

            <View style={S.tierRow}>
              {/* Left: badge + label */}
              <View style={[S.tierBadge, {
                backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.6)',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : tierBorder,
              }]}>
                <Text style={[S.tierSym, { color: tierInk }]}>{tier.sym}</Text>
                <Text style={[S.tierLabel, { color: tierInk }]}>{tier.label} Member</Text>
              </View>

              {/* Right: points */}
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[S.tierPts, { color: tierInk }]}>{pointsBalance}</Text>
                <Text style={[S.tierPtsLbl, { color: tierInk, opacity: 0.6 }]}>points</Text>
              </View>
            </View>

            {/* Tier progress */}
            {nextTier && (
              <View style={S.progSection}>
                <View style={S.progLabels}>
                  <Text style={[S.progLbl, { color: tierInk, opacity: 0.65 }]}>{tier.label}</Text>
                  <Text style={[S.progLbl, { color: tierInk, opacity: 0.65 }]}>
                    {visitsLeft} visit{visitsLeft !== 1 ? 's' : ''} to {nextTier.label}
                  </Text>
                </View>
                <View style={[S.track, { backgroundColor: isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.1)' }]}>
                  <View style={[S.fill, { width: `${tierPct}%` as any, backgroundColor: tierInk }]} />
                </View>
              </View>
            )}

            {/* Next reward chip */}
            {nextReward && (
              <View style={[S.rewardChip, {
                backgroundColor: isDark ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.55)',
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
              }]}>
                <Zap color={tierInk} size={11} />
                <Text style={[S.rewardChipTxt, { color: tierInk }]} numberOfLines={1}>
                  {Math.max(0, nextReward.points_required - pointsBalance)} pts away from{' '}
                  <Text style={{ fontWeight: '700' }}>{nextReward.name}</Text>
                </Text>
                <View style={[S.miniTrack, { backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.12)' }]}>
                  <View style={[S.miniFill, { width: `${rewardPct}%` as any, backgroundColor: tierInk }]} />
                </View>
              </View>
            )}

            {/* Footer tap hint */}
            <View style={S.tierFooter}>
              <Text style={[S.tierFooterTxt, { color: tierInk, opacity: 0.5 }]}>
                {visitCount} lifetime visit{visitCount !== 1 ? 's' : ''}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={[S.tierFooterTxt, { color: tierInk, opacity: 0.5 }]}>View rewards</Text>
                <ChevronRight color={tierInk} size={11} opacity={0.5} />
              </View>
            </View>
          </Tap>

          </View>

          {/* ── BIRTHDAY OFFER CARD ──────────────── */}
          {birthdayOffer && (
            <View style={{ marginBottom: 14, position: 'relative' }}>

              {/* Confetti particles burst out on open */}
              {confetti.map((c, i) => (
                <Animated.View key={`cp${i}`} style={{
                  position: 'absolute', zIndex: 30,
                  left: '46%', top: '44%',
                  width: i % 2 === 0 ? 11 : 8,
                  height: i % 2 === 0 ? 11 : 8,
                  borderRadius: i % 3 === 0 ? 6 : 2,
                  backgroundColor: CONFETTI_COLORS[i],
                  transform: [{ translateX: c.x }, { translateY: c.y }, { scale: c.scale }],
                  opacity: c.opacity,
                }} />
              ))}

              {!birthdayOpened ? (
                /* ─── GIFT BOX (tap to open) ─── */
                <Animated.View style={{ opacity: birthdayAnim, transform: [{ scale: giftExit }] }}>
                  <Pressable
                    onPress={handleOpenGift}
                    onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
                  >
                    <View style={S.giftCard}>
                      {/* Dark background layers */}
                      <View style={S.bdayBg} />
                      <View style={[S.bdayShine, { opacity: 0.10, top: -60, right: -60, width: 180, height: 180, borderRadius: 90 }]} />

                      {/* Very subtle corner accents */}
                      <Text style={{ position: 'absolute', top: 16, right: 16, fontSize: 15, opacity: 0.25 }}>✨</Text>
                      <Text style={{ position: 'absolute', bottom: 18, left: 16, fontSize: 12, opacity: 0.18 }}>⭐</Text>

                      {/* Centered gift content */}
                      <View style={S.giftInner}>

                        {/* ── REAL PRESENT BOX — wiggles subtly ── */}
                        <Animated.View style={{
                          alignItems: 'center',
                          transform: [{ rotate: giftWiggle.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-5deg', '0deg', '5deg'] }) }],
                        }}>
                          {/* BOW — absolutely positioned loops + knot */}
                          <View style={S.bowWrap}>
                            <View style={[S.bowLoop, S.bowLoopL]} />
                            <View style={[S.bowLoop, S.bowLoopR]} />
                            <View style={S.bowKnot} />
                          </View>

                          {/* LID */}
                          <View style={S.presentLid}>
                            <View style={S.presentRibbon} />
                          </View>

                          {/* BOX BODY */}
                          <View style={S.presentBody}>
                            <View style={S.presentRibbon} />
                            <View style={S.presentRibbonH} />
                          </View>
                        </Animated.View>

                        <Text style={S.giftTitle}>You have a{'\n'}birthday surprise!</Text>
                        <Text style={S.giftSub}>Tap to unwrap your gift 🎀</Text>

                        {/* Tap-hint dots */}
                        <View style={S.tapRow}>
                          <View style={[S.tapDot, { opacity: 0.9 }]} />
                          <View style={[S.tapDot, { opacity: 0.5 }]} />
                          <View style={[S.tapDot, { opacity: 0.25 }]} />
                        </View>

                      </View>
                    </View>
                  </Pressable>
                </Animated.View>
              ) : (
                /* ─── REVEALED OFFER ─── */
                <Animated.View style={{
                  opacity: revealEnter,
                  transform: [{ scale: revealEnter.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
                }}>
                  <View style={[S.bdayCard, { overflow: 'hidden' }]}>
                    <View style={S.bdayBg} />
                    <View style={[S.bdayShine, { opacity: isDark ? 0.06 : 0.18 }]} />
                    <Text style={S.bdayEmoji1}>🎉</Text>
                    <Text style={S.bdayEmoji2}>✨</Text>
                    <Text style={S.bdayEmoji3}>🎂</Text>
                    <View style={{ zIndex: 1 }}>
                      <View style={S.bdayHeader}>
                        <View style={S.bdayIconWrap}>
                          <PartyPopper color="#fff" size={20} strokeWidth={2} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={S.bdayEyebrow}>🎁 BIRTHDAY GIFT UNLOCKED</Text>
                          <Text style={S.bdayTitle}>Happy Birthday! 🎂</Text>
                        </View>
                      </View>
                      <Text style={S.bdayMessage}>{birthdayOffer.message}</Text>
                      {birthdayOffer.offerValue ? (
                        <View style={S.bdayPill}>
                          <Sparkles color="#f59e0b" size={13} strokeWidth={2} />
                          <Text style={S.bdayPillTxt}>
                            {birthdayOffer.offerType === 'discount' && `${birthdayOffer.offerValue} off your next visit`}
                            {birthdayOffer.offerType === 'free_service' && `Free: ${birthdayOffer.offerValue}`}
                            {birthdayOffer.offerType === 'points' && `${birthdayOffer.offerValue} bonus points`}
                            {birthdayOffer.offerType === 'custom' && birthdayOffer.offerValue}
                          </Text>
                        </View>
                      ) : null}
                      <Pressable onPress={() => router.push('/(client)/rebook')} style={S.bdayBtn}>
                        <Text style={S.bdayBtnTxt}>Book now to redeem</Text>
                        <ArrowRight color="#fff" size={14} strokeWidth={2.5} />
                      </Pressable>
                    </View>
                  </View>
                </Animated.View>
              )}
            </View>
          )}

          {/* ── APPOINTMENT / BOOK CTA ───────────── */}
          {upcomingAppt ? (
            <Tap onPress={() => router.push('/(client)/messages')}
              style={[S.card, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={S.apptTop}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[S.apptEyebrow, { color: C.text3 }]}>NEXT APPOINTMENT</Text>
                  <Text style={[S.apptService, { color: C.text }]} numberOfLines={1}>
                    {(upcomingAppt.services as any)?.name || upcomingAppt.service_name || 'Haircut'}
                  </Text>
                  <Text style={[S.apptTime, { color: C.text2 }]}>
                    {format(new Date(upcomingAppt.date + 'T00:00:00'), 'EEE, MMM d')}
                    {'  ·  '}{fmt12(upcomingAppt.start_time)}
                  </Text>
                </View>
                <View style={[S.countdownBadge, { backgroundColor: TONES.blue.bg, borderColor: TONES.blue.border }]}>
                  <Clock color={TONES.blue.icon} size={12} />
                  <Text style={[S.countdownVal, { color: TONES.blue.icon }]}>{countdown?.label}</Text>
                  {countdown?.sub ? <Text style={[S.countdownSub, { color: TONES.blue.icon }]}>{countdown.sub}</Text> : null}
                </View>
              </View>
              <View style={[S.cardFooter, { borderTopColor: C.border }]}>
                <MessageCircle color={C.text3} size={13} />
                <Text style={[S.cardFooterTxt, { color: C.text3 }]}>Tap to message your barber</Text>
                <ArrowRight color={C.text3} size={13} />
              </View>
            </Tap>
          ) : (
            <Tap onPress={() => router.push('/(client)/rebook')}
              style={[S.card, S.bookCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={[S.bookIcon, { backgroundColor: TONES.blue.bg, borderColor: TONES.blue.border, borderWidth: 1 }]}>
                <CalendarCheck color={TONES.blue.icon} size={22} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.bookTitle, { color: C.text }]}>Book your next cut</Text>
                <Text style={[S.bookSub, { color: C.text3 }]}>Schedule and earn loyalty points</Text>
              </View>
              <ChevronRight color={C.text3} size={17} />
            </Tap>
          )}

          {/* ── QUICK ACTIONS ────────────────────── */}
          <View style={S.grid}>
            {([
              { Icon: Gift,          label: 'Refer',    sub: 'Earn together',   route: '/(client)/refer',    tone: TONES.violet },
              { Icon: Star,          label: 'Rewards',  sub: 'Redeem points',   route: '/(client)/loyalty',  tone: TONES.amber },
              { Icon: MessageCircle, label: 'Chat',     sub: 'Message barber',  route: '/(client)/messages', tone: TONES.emerald },
              { Icon: History,       label: 'History',  sub: 'Past visits',     route: '/(client)/history',  tone: TONES.violet },
            ] as const).map(({ Icon, label, sub, route, tone }) => (
              <Tap key={label} onPress={() => router.push(route as any)}
                style={[S.gridItem, { backgroundColor: C.card, borderColor: C.border }]}>
                <View style={[S.gridIcon, { backgroundColor: tone.bg, borderColor: tone.border, borderWidth: 1 }]}>
                  <Icon color={tone.icon} size={20} strokeWidth={1.7} />
                </View>
                <Text style={[S.gridLabel, { color: C.text }]}>{label}</Text>
                <Text style={[S.gridSub, { color: C.text3 }]}>{sub}</Text>
              </Tap>
            ))}
          </View>

          {/* ── DISCOVER (no shop) ───────────────── */}
          {!barbershopName && (
            <Tap onPress={() => router.push('/(client)/discover')}
              style={[S.card, S.bookCard, { backgroundColor: C.card, borderColor: C.border, marginTop: 0 }]}>
              <View style={[S.bookIcon, { backgroundColor: TONES.blue.bg, borderColor: TONES.blue.border, borderWidth: 1 }]}>
                <MapPin color={TONES.blue.icon} size={20} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.bookTitle, { color: C.text }]}>Find your barbershop</Text>
                <Text style={[S.bookSub, { color: C.text3 }]}>Connect to book and earn rewards</Text>
              </View>
              <ChevronRight color={C.text3} size={17} />
            </Tap>
          )}

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 10 },

  // Full-screen tier tint
  tierGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  greeting:    { fontSize: 13, fontWeight: '500', letterSpacing: 0.1 },
  name:        { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, marginTop: 1 },
  settingsBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginLeft: 12 },

  shopPill:    { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, marginBottom: 16 },
  shopPillTxt: { fontSize: 12, fontWeight: '600' },

  // Tier card
  tierCard: {
    borderRadius: 22, borderWidth: 1, padding: 18, marginBottom: 14,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 16 },
      android: { elevation: 5 },
    }),
  },
  tierRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  tierBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1 },
  tierSym:    { fontSize: 15, fontWeight: '800' },
  tierLabel:  { fontSize: 13, fontWeight: '700' },
  tierPts:    { fontSize: 36, fontWeight: '900', letterSpacing: -1.5 },
  tierPtsLbl: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },

  progSection: { gap: 7, marginBottom: 12 },
  progLabels:  { flexDirection: 'row', justifyContent: 'space-between' },
  progLbl:     { fontSize: 11, fontWeight: '600' },
  track:       { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill:        { height: '100%', borderRadius: 3 },

  rewardChip:    { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, borderWidth: 1, marginBottom: 14 },
  rewardChipTxt: { fontSize: 12, fontWeight: '500', flex: 1 },
  miniTrack:     { height: 3, width: 44, borderRadius: 2, overflow: 'hidden' },
  miniFill:      { height: '100%', borderRadius: 2 },

  tierFooter:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tierFooterTxt: { fontSize: 11, fontWeight: '500' },

  // Generic card
  card: {
    borderRadius: 20, borderWidth: 1, marginBottom: 14, overflow: 'hidden',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10 },
      android: { elevation: 3 },
    }),
  },
  bookCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginBottom: 14 },
  bookIcon:  { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  bookTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  bookSub:   { fontSize: 12 },

  // Appointment
  apptTop:      { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  apptEyebrow:  { fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
  apptService:  { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  apptTime:     { fontSize: 13, fontWeight: '500' },
  countdownBadge: { alignItems: 'center', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, gap: 1, minWidth: 68 },
  countdownVal:   { fontSize: 16, fontWeight: '900', letterSpacing: -0.5 },
  countdownSub:   { fontSize: 9, fontWeight: '600', opacity: 0.65, textAlign: 'center' },
  cardFooter:     { flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, paddingHorizontal: 18, paddingVertical: 12 },
  cardFooterTxt:  { fontSize: 12, fontWeight: '500', flex: 1 },

  // Birthday offer card
  bdayCard: {
    borderRadius: 24, padding: 20,
    backgroundColor: '#0f0a1e',
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.35)',
    ...Platform.select({
      ios:     { shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 24 },
      android: { elevation: 12 },
    }),
  },
  bdayBg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24,
    backgroundColor: '#1a0a3e',
  },
  bdayShine: {
    position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: 80,
    backgroundColor: '#7c3aed',
  },
  bdayEmoji1: { position: 'absolute', top: 12,  right: 52, fontSize: 22, opacity: 0.7 },
  bdayEmoji2: { position: 'absolute', top: 44,  right: 18, fontSize: 16, opacity: 0.5 },
  bdayEmoji3: { position: 'absolute', top: 10,  right: 14, fontSize: 26, opacity: 0.85 },

  bdayHeader:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  bdayIconWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(167,139,250,0.25)',
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  bdayEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: 'rgba(167,139,250,0.8)', marginBottom: 2 },
  bdayTitle:   { fontSize: 22, fontWeight: '900', color: '#ffffff', letterSpacing: -0.5 },
  bdayMessage: { fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 20, marginBottom: 14, fontWeight: '400' },

  bdayPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 16,
  },
  bdayPillTxt: { fontSize: 13, fontWeight: '700', color: '#fbbf24' },

  bdayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(167,139,250,0.9)',
    borderRadius: 14, paddingVertical: 13,
  },
  bdayBtnTxt: { fontSize: 14, fontWeight: '800', color: '#fff', letterSpacing: 0.1 },

  // Gift box (closed state)
  giftCard: {
    borderRadius: 26, padding: 24,
    backgroundColor: '#080514',
    borderWidth: 1.5, borderColor: 'rgba(167,139,250,0.45)',
    alignItems: 'center',
    ...Platform.select({
      ios:     { shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.5, shadowRadius: 32 },
      android: { elevation: 16 },
    }),
  },
  giftInner: { alignItems: 'center', gap: 14, paddingVertical: 4 },

  // ── Bow ──
  bowWrap: {
    width: 108, height: 38,
    position: 'relative',
    marginBottom: -6,
    zIndex: 2,
  },
  bowLoop: {
    position: 'absolute',
    bottom: 4,
    width: 32, height: 22, borderRadius: 16,
    backgroundColor: '#fbbf24',
    borderWidth: 1.5, borderColor: '#d97706',
  },
  bowLoopL: { left: 10, transform: [{ rotate: '-28deg' }] },
  bowLoopR: { right: 10, transform: [{ rotate: '28deg' }] },
  bowKnot: {
    position: 'absolute', bottom: 4, left: 45,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#f59e0b',
    borderWidth: 1.5, borderColor: '#b45309',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3 },
      android: { elevation: 2 },
    }),
  },

  // ── Lid ──
  presentLid: {
    width: 108, height: 30,
    backgroundColor: '#e74c3c',
    borderTopLeftRadius: 9, borderTopRightRadius: 9,
    overflow: 'hidden',
    borderWidth: 1.5, borderBottomWidth: 0, borderColor: 'rgba(0,0,0,0.22)',
  },

  // ── Body ──
  presentBody: {
    width: 108, height: 76,
    backgroundColor: '#c0392b',
    borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5, borderTopWidth: 0, borderColor: 'rgba(0,0,0,0.22)',
    ...Platform.select({
      ios:     { shadowColor: '#c0392b', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 18 },
      android: { elevation: 8 },
    }),
  },

  // ── Ribbons ──
  // Vertical ribbon — used in both lid and body (overflow:hidden clips it to each box)
  presentRibbon: {
    position: 'absolute', top: 0, bottom: 0,
    left: 46, width: 16,
    backgroundColor: '#fbbf24',
  },
  // Horizontal ribbon — body only
  presentRibbonH: {
    position: 'absolute', left: 0, right: 0,
    top: 26, height: 16,
    backgroundColor: '#fbbf24',
  },

  giftTitle: {
    fontSize: 21, fontWeight: '900', color: '#fff',
    letterSpacing: -0.5, textAlign: 'center', lineHeight: 27,
  },
  giftSub:  { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', fontWeight: '500' },
  tapRow:   { flexDirection: 'row', gap: 7, marginTop: 2, alignItems: 'center' },
  tapDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(167,139,250,0.9)' },

  // 2×2 quick actions
  grid:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 14 },
  gridItem:  {
    width: '48.5%', borderRadius: 18, borderWidth: 1, padding: 16,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6 },
      android: { elevation: 1 },
    }),
  },
  gridIcon:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  gridLabel: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  gridSub:   { fontSize: 12 },
});
