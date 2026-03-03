import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, TextInput,
  Switch, StyleSheet, StatusBar, Animated, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LogOut, Scissors, Clock, ChevronRight, Sun, Moon,
  CalendarDays, Users, MessageCircle,
  Save, User, CreditCard, CheckCircle, ExternalLink, MapPin,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DAYS = [
  { num: 1, short: 'Mon' }, { num: 2, short: 'Tue' }, { num: 3, short: 'Wed' },
  { num: 4, short: 'Thu' }, { num: 5, short: 'Fri' }, { num: 6, short: 'Sat' },
  { num: 0, short: 'Sun' },
];

type DaySchedule = { available: boolean; start: string; end: string };

const TAB_BAR_HEIGHT = 68;

// ─────────────────────────────────────────
// Animated row (matching client settings)
// ─────────────────────────────────────────
function Row({ C, Icon, label, onPress, right, hasBorder = true, destructive = false, accentIcon = false }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  const accent = C.accent;
  return (
    <Pressable
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, tension: 600, friction: 32 }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 400, friction: 26 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[
        S.row,
        hasBorder && { borderBottomWidth: 1, borderBottomColor: C.border },
        { transform: [{ scale }] },
      ]}>
        <View style={[S.rowIcon, {
          backgroundColor: destructive ? 'rgba(239,68,68,0.1)' : accentIcon ? `${accent}18` : C.bg2,
        }]}>
          <Icon
            color={destructive ? '#ef4444' : accentIcon ? accent : C.text2}
            size={17} strokeWidth={1.9}
          />
        </View>
        <Text style={[S.rowLabel, { color: destructive ? '#ef4444' : C.text }]}>{label}</Text>
        {right ?? (!destructive && <ChevronRight color={C.text3} size={15} strokeWidth={1.8} />)}
      </Animated.View>
    </Pressable>
  );
}

export default function BarberSettings() {
  const { C, theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const toast  = useToast();
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 16;

  const [email, setEmail]             = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameInput, setNameInput]     = useState('');
  const [editingName, setEditingName] = useState(false);
  const [shopName, setShopName]       = useState('');
  const [shopInput, setShopInput]     = useState('');
  const [editingShop, setEditingShop] = useState(false);
  const [schedule, setSchedule]       = useState<Record<number, DaySchedule>>({});
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [barberId, setBarberId]       = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  // Staff detection — if user is in team_members they are staff (not owner)
  const [isStaffMember, setIsStaffMember] = useState(false);

  // Stripe Connect state
  const [stripeAccountId, setStripeAccountId]               = useState<string | null>(null);
  const [stripeOnboardingComplete, setStripeOnboardingComplete] = useState(false);
  const [stripeChargesEnabled, setStripeChargesEnabled]     = useState(false);
  const [stripeConnecting, setStripeConnecting]             = useState(false);
  const [passFeesToClient, setPassFeesToClient]             = useState(true);

  // Location
  const [shopAddress, setShopAddress] = useState('');
  const [shopCity, setShopCity]       = useState('');
  const [shopCountry, setShopCountry] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  const fade  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: any) => {
      if (!session?.user) return;
      const uid = session.user.id;
      setBarberId(uid);
      setEmail(session.user.email ?? '');

      const [profileRes, schedRes, clientRes, staffRes] = await Promise.all([
        supabase.from('profiles').select('display_name, shop_name, stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled, pass_fees_to_client, address, city, country').or(`id.eq.${uid},user_id.eq.${uid}`).limit(1).maybeSingle(),
        supabase.from('barber_schedule').select('day_of_week, start_time, end_time, is_active').eq('barber_id', uid),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('barber_id', uid),
        // Fetch team_members row — includes working_hours for staff
        supabase.from('team_members').select('id, working_hours').eq('user_id', uid).eq('is_active', true).maybeSingle(),
      ]);

      const isStaff = !!(staffRes as any).data;
      setIsStaffMember(isStaff);

      const name = (profileRes.data as any)?.display_name || '';
      const shop = (profileRes.data as any)?.shop_name || '';
      setDisplayName(name); setNameInput(name);
      setShopName(shop);    setShopInput(shop);
      setTotalClients((clientRes as any).count ?? 0);

      // Stripe Connect status
      setStripeAccountId((profileRes.data as any)?.stripe_account_id ?? null);
      setStripeOnboardingComplete((profileRes.data as any)?.stripe_onboarding_complete ?? false);
      setStripeChargesEnabled((profileRes.data as any)?.stripe_charges_enabled ?? false);
      setPassFeesToClient((profileRes.data as any)?.pass_fees_to_client ?? true);
      setShopAddress((profileRes.data as any)?.address || '');
      setShopCity((profileRes.data as any)?.city || '');
      setShopCountry((profileRes.data as any)?.country || '');

      const sched: Record<number, DaySchedule> = {};

      if (isStaff) {
        // ── Staff: hours live in team_members.working_hours (JSON) ──
        // This is the same source the web dashboard reads/writes, so they stay in sync.
        const wh: any[] = (staffRes as any).data?.working_hours ?? [];
        for (const day of DAYS) {
          const row = wh.find((r: any) => r.day_of_week === day.num);
          sched[day.num] = {
            available: row?.is_active ?? false,
            start: row?.start_time?.slice(0, 5) ?? '09:00',
            end:   row?.end_time?.slice(0, 5)   ?? '18:00',
          };
        }
      } else {
        // ── Owner: hours live in barber_schedule table ──
        for (const day of DAYS) {
          const row = ((schedRes.data as any[]) ?? []).find((r: any) => r.day_of_week === day.num);
          sched[day.num] = {
            available: row?.is_active ?? false,
            start: row?.start_time?.slice(0, 5) ?? '09:00',
            end:   row?.end_time?.slice(0, 5)   ?? '18:00',
          };
        }
      }

      setSchedule(sched);
      setScheduleLoaded(true);
    });

    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 360, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, tension: 200, friction: 18, useNativeDriver: true }),
    ]).start();
  }, []);

  const saveProfile = async () => {
    if (!barberId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').upsert(
        { id: barberId, display_name: nameInput.trim(), shop_name: shopInput.trim() },
        { onConflict: 'id' }
      );
      if (error) throw error;
      setDisplayName(nameInput.trim());
      setShopName(shopInput.trim());
      setEditingName(false);
      setEditingShop(false);
      toast.success('Profile saved!');
    } catch (err: any) { toast.error(err.message || 'Failed to save'); }
    setSaving(false);
  };

  const saveLocation = async () => {
    if (!barberId) return;
    setSavingLocation(true);
    try {
      const addressQuery = [shopAddress.trim(), shopCity.trim(), shopCountry.trim()].filter(Boolean).join(', ');
      let latitude: number | null = null;
      let longitude: number | null = null;
      if (addressQuery) {
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addressQuery)}&format=json&limit=1`,
            { headers: { 'User-Agent': 'Kutz-Barbershop-App/1.0' } }
          );
          const geoData = await geoRes.json();
          if (geoData?.[0]) {
            latitude = parseFloat(geoData[0].lat);
            longitude = parseFloat(geoData[0].lon);
          }
        } catch { /* non-fatal */ }
      }
      const { error } = await supabase.from('profiles')
        .update({
          address: shopAddress.trim() || null,
          city: shopCity.trim() || null,
          country: shopCountry.trim() || null,
          ...(latitude !== null && longitude !== null ? { latitude, longitude } : {}),
        })
        .or(`id.eq.${barberId},user_id.eq.${barberId}`);
      if (error) throw error;
      toast.success(latitude ? 'Location saved & pinned on map!' : 'Location saved. Address not found on map — check the spelling.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save location');
    }
    setSavingLocation(false);
  };

  // Working hours are read-only on mobile — edit them on the web dashboard

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert('Sign Out', 'Sign out of barber dashboard?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('user_mode');
          await supabase.auth.signOut();
          router.replace('/(onboarding)/welcome');
        },
      },
    ]);
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
          barber_id:   barberId,
          // Use the already-live Supabase barber dashboard URL.
          // expo-web-browser opens a modal — when Stripe redirects here the user
          // just taps Done to close it. No custom domain needed.
          return_url:  `${SUPABASE_URL}/functions/v1/barber-dashboard`,
          refresh_url: `${SUPABASE_URL}/functions/v1/barber-dashboard`,
        }),
      });

      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Failed to connect Stripe');

      // Update local state with returned account ID
      if (result.account_id) setStripeAccountId(result.account_id);

      // Open Stripe onboarding (or dashboard link)
      await WebBrowser.openBrowserAsync(result.url);

      // Re-fetch Stripe status after returning
      // Use .or() because barberId is auth UID which may differ from profiles.id
      const { data: refreshed } = await supabase
        .from('profiles')
        .select('stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled')
        .or(`id.eq.${barberId},user_id.eq.${barberId}`)
        .limit(1)
        .maybeSingle();

      if (refreshed) {
        setStripeAccountId(refreshed.stripe_account_id ?? null);
        setStripeOnboardingComplete(refreshed.stripe_onboarding_complete ?? false);
        setStripeChargesEnabled(refreshed.stripe_charges_enabled ?? false);
      }
    } catch (err: any) {
      toast.error(err.message || 'Stripe connection failed');
    }
    setStripeConnecting(false);
  };

  const initials = displayName
    ? displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : email.slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Header */}
      <View style={[S.header, { borderBottomColor: C.border }]}>
        <Text style={[S.title, { color: C.text }]}>Settings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[S.scroll, { paddingBottom: tabBarClearance }]}
      >
        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }], gap: 24 }}>

          {/* ── Profile hero ── */}
          <View style={[S.profileHero, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={[S.avatarRing, { borderColor: `${C.accent}40` }]}>
              <View style={[S.avatar, { backgroundColor: `${C.accent}18` }]}>
                <Text style={[S.avatarTxt, { color: C.accent }]}>{initials}</Text>
              </View>
            </View>

            {/* Name */}
            {editingName ? (
              <View style={S.editWrap}>
                <TextInput
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="Your name"
                  placeholderTextColor={C.text3}
                  style={[S.nameInput, { backgroundColor: C.bg2, borderColor: C.border, color: C.text }]}
                  autoCapitalize="words"
                  autoFocus
                />
                <View style={S.editBtns}>
                  <TouchableOpacity
                    onPress={() => { setNameInput(displayName); setEditingName(false); }}
                    style={[S.editCancel, { borderColor: C.border }]}
                    activeOpacity={0.8}
                  >
                    <Text style={[S.editCancelTxt, { color: C.text2 }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={saveProfile}
                    disabled={saving || !nameInput.trim()}
                    style={[S.editSave, { backgroundColor: C.accent, opacity: saving ? 0.7 : 1 }]}
                    activeOpacity={0.85}
                  >
                    {saving
                      ? <ActivityIndicator color={C.accentText} size="small" />
                      : <Text style={[S.editSaveTxt, { color: C.accentText }]}>Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingName(true)} activeOpacity={0.8} style={S.nameRow}>
                <Text style={[S.heroName, { color: C.text }]}>{displayName || 'Your Name'}</Text>
                <View style={[S.editChip, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <User color={C.text3} size={11} strokeWidth={2} />
                  <Text style={[S.editChipTxt, { color: C.text3 }]}>Edit</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Shop name */}
            {editingShop ? (
              <View style={[S.editWrap, { marginTop: 8 }]}>
                <TextInput
                  value={shopInput}
                  onChangeText={setShopInput}
                  placeholder="Shop name"
                  placeholderTextColor={C.text3}
                  style={[S.nameInput, { backgroundColor: C.bg2, borderColor: C.border, color: C.text }]}
                  autoCapitalize="words"
                  autoFocus
                />
                <View style={S.editBtns}>
                  <TouchableOpacity
                    onPress={() => { setShopInput(shopName); setEditingShop(false); }}
                    style={[S.editCancel, { borderColor: C.border }]}
                    activeOpacity={0.8}
                  >
                    <Text style={[S.editCancelTxt, { color: C.text2 }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={saveProfile}
                    disabled={saving}
                    style={[S.editSave, { backgroundColor: C.accent, opacity: saving ? 0.7 : 1 }]}
                    activeOpacity={0.85}
                  >
                    {saving
                      ? <ActivityIndicator color={C.accentText} size="small" />
                      : <Text style={[S.editSaveTxt, { color: C.accentText }]}>Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingShop(true)} activeOpacity={0.8} style={[S.shopRow]}>
                <Scissors color={C.text3} size={12} strokeWidth={1.8} />
                <Text style={[S.shopTxt, { color: C.text3 }]}>{shopName || 'Add shop name'}</Text>
                <View style={[S.editChip, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <Text style={[S.editChipTxt, { color: C.text3 }]}>Edit</Text>
                </View>
              </TouchableOpacity>
            )}

            <Text style={[S.heroEmail, { color: C.text3 }]}>{email}</Text>

            {/* Divider */}
            <View style={[S.heroDivider, { backgroundColor: C.border }]} />

            {/* Stats */}
            <View style={S.heroStats}>
              <View style={S.heroStat}>
                <Text style={[S.heroStatNum, { color: C.text }]}>{totalClients}</Text>
                <Text style={[S.heroStatLbl, { color: C.text3 }]}>Clients</Text>
              </View>
              <View style={[S.heroStatDivider, { backgroundColor: C.border }]} />
              <View style={S.heroStat}>
                <Text style={[S.heroStatNum, { color: C.text }]} numberOfLines={1}>{shopName || '—'}</Text>
                <Text style={[S.heroStatLbl, { color: C.text3 }]}>Shop</Text>
              </View>
            </View>
          </View>

          {/* ── Appearance ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>APPEARANCE</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={[S.row, { borderBottomWidth: 0 }]}>
                <View style={[S.rowIcon, { backgroundColor: C.bg2 }]}>
                  {isDark
                    ? <Moon color={C.text2} size={17} strokeWidth={1.9} />
                    : <Sun  color={C.text2} size={17} strokeWidth={1.9} />}
                </View>
                <Text style={[S.rowLabel, { color: C.text }]}>Dark Mode</Text>
                <Switch
                  value={isDark}
                  onValueChange={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggle(); }}
                  trackColor={{ true: C.accent, false: C.bg3 }}
                  thumbColor={Platform.OS === 'android' ? (isDark ? C.accent : '#fff') : undefined}
                />
              </View>
            </View>
          </View>

          {/* ── Working Hours (read-only — edit on web dashboard) ── */}
          {scheduleLoaded && (
            <View>
              <Text style={[S.secLabel, { color: C.text3 }]}>WORKING HOURS</Text>
              <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                {/* Info banner */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
                  <Clock color={C.text3} size={13} strokeWidth={1.8} />
                  <Text style={{ fontSize: 12, color: C.text3, flex: 1 }}>Manage your hours on the web dashboard</Text>
                </View>
                {DAYS.map((day, idx) => {
                  const d = schedule[day.num] ?? { available: false, start: '09:00', end: '18:00' };
                  return (
                    <View key={day.num} style={[
                      S.dayRow,
                      idx < DAYS.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border },
                    ]}>
                      {/* Simple dot instead of interactive switch */}
                      <View style={{
                        width: 8, height: 8, borderRadius: 4,
                        backgroundColor: d.available ? C.accent : C.bg3,
                        marginRight: 4,
                      }} />
                      <Text style={[S.dayLabel, { color: d.available ? C.text : C.text3 }]}>{day.short}</Text>
                      <Text style={[S.dayHours, { color: d.available ? C.text2 : C.text3 }]}>
                        {d.available ? `${d.start} – ${d.end}` : 'Closed'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── Stripe Connect (owner only) ── */}
          {!isStaffMember && <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>PAYMENTS</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              {/* Pass fees to client toggle */}
              <View style={[S.row, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                <View style={[S.rowIcon, { backgroundColor: C.bg2 }]}>
                  <CreditCard color={C.text2} size={17} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.rowLabel, { color: C.text }]}>Pass fees to client</Text>
                  <Text style={{ fontSize: 11, color: C.text3, marginTop: 1 }}>
                    {passFeesToClient ? 'Booking fee added to client total' : 'Fees deducted from your payout'}
                  </Text>
                </View>
                <Switch
                  value={passFeesToClient}
                  onValueChange={async (val) => {
                    setPassFeesToClient(val);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (barberId) {
                      await supabase.from('profiles')
                        .update({ pass_fees_to_client: val })
                        .or(`id.eq.${barberId},user_id.eq.${barberId}`);
                    }
                  }}
                  trackColor={{ true: C.accent, false: C.bg3 }}
                  thumbColor={Platform.OS === 'android' ? (passFeesToClient ? C.accent : '#fff') : undefined}
                />
              </View>
              {stripeChargesEnabled ? (
                /* Already fully connected */
                <TouchableOpacity
                  onPress={connectStripe}
                  activeOpacity={0.8}
                  style={[S.stripeRow, { borderBottomWidth: 0 }]}
                >
                  <View style={[S.stripeIconWrap, { backgroundColor: 'rgba(99,91,255,0.12)' }]}>
                    <CreditCard color="#635bff" size={17} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.stripeTitle, { color: C.text }]}>Stripe Connected</Text>
                    <Text style={[S.stripeSub, { color: '#22c55e' }]}>✓ Payments active</Text>
                  </View>
                  <View style={[S.stripeChip, { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' }]}>
                    <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700' }}>Dashboard</Text>
                    <ExternalLink color="#22c55e" size={11} strokeWidth={2} />
                  </View>
                </TouchableOpacity>
              ) : stripeAccountId && !stripeOnboardingComplete ? (
                /* Account created but onboarding not finished */
                <TouchableOpacity
                  onPress={connectStripe}
                  activeOpacity={0.8}
                  style={[S.stripeRow, { borderBottomWidth: 0 }]}
                  disabled={stripeConnecting}
                >
                  <View style={[S.stripeIconWrap, { backgroundColor: 'rgba(251,191,36,0.12)' }]}>
                    <CreditCard color="#f59e0b" size={17} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.stripeTitle, { color: C.text }]}>Stripe — Finish Setup</Text>
                    <Text style={[S.stripeSub, { color: '#f59e0b' }]}>Onboarding incomplete</Text>
                  </View>
                  {stripeConnecting
                    ? <ActivityIndicator size="small" color="#f59e0b" />
                    : <ChevronRight color={C.text3} size={15} strokeWidth={1.8} />
                  }
                </TouchableOpacity>
              ) : (
                /* Not connected yet */
                <TouchableOpacity
                  onPress={connectStripe}
                  activeOpacity={0.8}
                  style={[S.stripeRow, { borderBottomWidth: 0 }]}
                  disabled={stripeConnecting}
                >
                  <View style={[S.stripeIconWrap, { backgroundColor: 'rgba(99,91,255,0.12)' }]}>
                    <CreditCard color="#635bff" size={17} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.stripeTitle, { color: C.text }]}>Connect Stripe</Text>
                    <Text style={[S.stripeSub, { color: C.text3 }]}>Accept online & in-person payments</Text>
                  </View>
                  {stripeConnecting
                    ? <ActivityIndicator size="small" color="#635bff" />
                    : <ChevronRight color={C.text3} size={15} strokeWidth={1.8} />
                  }
                </TouchableOpacity>
              )}
            </View>
          </View>}

          {/* ── Shop Location (owner only) ── */}
          {!isStaffMember && <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>SHOP LOCATION</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder, padding: 16, gap: 12 }]}>
              <View style={S.locRow}>
                <MapPin color={C.accent} size={14} strokeWidth={2} />
                <Text style={{ color: C.text3, fontSize: 12, flex: 1 }}>
                  Your address will show on the client map. Make sure the spelling is correct so it gets pinned accurately.
                </Text>
              </View>
              <View style={S.locField}>
                <Text style={[S.locLabel, { color: C.text3 }]}>Street Address</Text>
                <TextInput
                  value={shopAddress}
                  onChangeText={setShopAddress}
                  placeholder="e.g. 123 Main Street"
                  placeholderTextColor={C.text3}
                  style={[S.locInput, { backgroundColor: C.bg2, borderColor: C.border, color: C.text }]}
                  autoCapitalize="words"
                />
              </View>
              <View style={S.locRow}>
                <View style={[S.locField, { flex: 1 }]}>
                  <Text style={[S.locLabel, { color: C.text3 }]}>City</Text>
                  <TextInput
                    value={shopCity}
                    onChangeText={setShopCity}
                    placeholder="Helsinki"
                    placeholderTextColor={C.text3}
                    style={[S.locInput, { backgroundColor: C.bg2, borderColor: C.border, color: C.text }]}
                    autoCapitalize="words"
                  />
                </View>
                <View style={[S.locField, { flex: 1 }]}>
                  <Text style={[S.locLabel, { color: C.text3 }]}>Country</Text>
                  <TextInput
                    value={shopCountry}
                    onChangeText={setShopCountry}
                    placeholder="Finland"
                    placeholderTextColor={C.text3}
                    style={[S.locInput, { backgroundColor: C.bg2, borderColor: C.border, color: C.text }]}
                    autoCapitalize="words"
                  />
                </View>
              </View>
              <TouchableOpacity
                style={[S.locSaveBtn, { backgroundColor: C.accent, opacity: savingLocation ? 0.7 : 1 }]}
                onPress={saveLocation}
                disabled={savingLocation}
                activeOpacity={0.85}
              >
                {savingLocation
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <MapPin color="#fff" size={15} strokeWidth={2} />
                      <Text style={S.locSaveTxt}>Save & Pin on Map</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          </View>}

          {/* ── Web Dashboard ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>WEB DASHBOARD</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Row
                C={C} Icon={ExternalLink}
                label="Open Web Dashboard"
                onPress={() => WebBrowser.openBrowserAsync('https://kutz.io')}
                accentIcon
                hasBorder={false}
              />
            </View>
          </View>

          {/* ── Quick Links ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>QUICK LINKS</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Row C={C} Icon={CalendarDays}  label="Appointments" onPress={() => router.push('/(barber)/appointments')} />
              <Row C={C} Icon={Users}         label="Clients"      onPress={() => router.push('/(barber)/clients')} />
              <Row C={C} Icon={MessageCircle} label="Messages"     onPress={() => router.push('/(barber)/messages')} hasBorder={false} />
            </View>
          </View>

          {/* ── Account ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>ACCOUNT</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Row C={C} Icon={LogOut} label="Sign Out" onPress={handleLogout} hasBorder={false} destructive />
            </View>
          </View>

          <Text style={[S.version, { color: C.text3 }]}>Kutz · Barber v1.0.0</Text>

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1,
    flexDirection: 'row', alignItems: 'center',
  },
  title:  { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  scroll: { paddingHorizontal: 18, paddingTop: 20 },
  secLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9, marginBottom: 8, marginLeft: 2 },

  // Location
  locRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  locField:  { gap: 5 },
  locLabel:  { fontSize: 12, fontWeight: '600', marginLeft: 2 },
  locInput:  { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 13, fontSize: 14, fontWeight: '500' },
  locSaveBtn: { height: 48, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 4 },
  locSaveTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Profile hero
  profileHero: {
    borderRadius: 22, borderWidth: 1, padding: 20, alignItems: 'center',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12 },
      android: { elevation: 3 },
    }),
  },
  avatarRing: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  avatar:    { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 26, fontWeight: '900' },

  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  heroName: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  shopRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  shopTxt:  { fontSize: 13, fontWeight: '500' },
  heroEmail:{ fontSize: 13, marginTop: 4 },

  editChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  editChipTxt: { fontSize: 11, fontWeight: '600' },

  editWrap:      { width: '100%', gap: 10, marginBottom: 4 },
  nameInput: {
    height: 46, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15, fontWeight: '600',
  },
  editBtns:      { flexDirection: 'row', gap: 10 },
  editCancel: {
    flex: 1, height: 42, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  editCancelTxt: { fontSize: 14, fontWeight: '600' },
  editSave: {
    flex: 1, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  editSaveTxt: { fontSize: 14, fontWeight: '700' },

  heroDivider: { width: '100%', height: 1, marginVertical: 18 },
  heroStats:       { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' },
  heroStat:        { flex: 1, alignItems: 'center', gap: 6 },
  heroStatNum:     { fontSize: 18, fontWeight: '900', letterSpacing: -0.4 },
  heroStatLbl:     { fontSize: 11, fontWeight: '500' },
  heroStatDivider: { width: 1, height: 36 },

  // Section card
  section: {
    borderRadius: 18, borderWidth: 1, overflow: 'hidden',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },

  // Row
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowIcon:  { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600' },

  // Working hours
  dayRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 16, gap: 12 },
  dayLabel: { fontWeight: '700', fontSize: 13, width: 34 },
  dayHours: { fontSize: 12, flex: 1 },

  version: { textAlign: 'center', fontSize: 12, paddingTop: 4 },

  // Stripe Connect
  stripeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  stripeIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stripeTitle: { fontSize: 15, fontWeight: '600' },
  stripeSub: { fontSize: 12, marginTop: 2 },
  stripeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
});
