import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, TextInput, ActivityIndicator,
  StyleSheet, Switch, StatusBar, Platform, Animated, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  LogOut, ChevronRight, ChevronLeft, MapPin, Scissors, Star,
  Sun, Moon, Save, ArrowLeftRight,
  Bell, Calendar, MessageCircle, Gift, Megaphone, BellRing,
  User, History, Shield, Sparkles, Trash2, Cake,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/lib/theme';
import { getBarberProfile } from '@/lib/barber';
import { getActiveClientBinding } from '@/lib/clientSync';
import { useToast } from '@/lib/toast';
import {
  getNotificationSettings,
  saveNotificationSettings,
  registerForPushNotifications,
  savePushTokenToSupabase,
  NotificationSettings,
  DEFAULT_NOTIF_SETTINGS,
} from '@/lib/notifications';

const TIERS = [
  { tier: 'new',     label: 'New',     minVisits: 0  },
  { tier: 'bronze',  label: 'Bronze',  minVisits: 1  },
  { tier: 'silver',  label: 'Silver',  minVisits: 5  },
  { tier: 'gold',    label: 'Gold',    minVisits: 10 },
  { tier: 'diamond', label: 'Diamond', minVisits: 20 },
];
function getTier(v: number) {
  let t = TIERS[0];
  for (const tier of TIERS) { if (v >= tier.minVisits) t = tier; }
  return t;
}

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

function NotifRow({ C, Icon, title, subtitle, value, onChange, hasBorder = true }: any) {
  return (
    <View style={[S.row, hasBorder && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
      <View style={[S.rowIcon, { backgroundColor: C.bg2 }]}>
        <Icon color={C.text2} size={17} strokeWidth={1.9} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[S.rowLabel, { color: C.text, flex: 0 }]}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(v); }}
        trackColor={{ true: C.accent, false: C.bg3 }}
        thumbColor={Platform.OS === 'android' ? (value ? C.accent : '#fff') : undefined}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { C, theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const toast = useToast();

  const [userName, setUserName]     = useState('');
  const [userEmail, setUserEmail]   = useState('');
  const [nameInput, setNameInput]   = useState('');
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [userMode, setUserMode]     = useState<'client' | 'barber'>('client');
  const [savingProfile, setSavingProfile] = useState(false);
  const [shopName, setShopName]     = useState('');
  const [shopCity, setShopCity]     = useState('');
  const [visitCount, setVisitCount] = useState(0);
  const [birthday, setBirthday]           = useState<string | null>(null);
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(DEFAULT_NOTIF_SETTINGS);
  const [notifEnabled, setNotifEnabled]   = useState(false);
  const [editingName, setEditingName]     = useState(false);
  const [tierGlowEnabled, setTierGlowEnabled] = useState(false);

  const fade  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session?.user) {
        const fullName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || 'Client';
        setAuthUserId(session.user.id);
        setUserName(fullName);
        setNameInput(fullName);
        setUserEmail(session.user.email || '');
        fetchShopDetails(session.user.id);
      }
    });
    AsyncStorage.getItem('user_mode').then((m: string | null) => {
      if (m === 'client' || m === 'barber') setUserMode(m);
    });
    AsyncStorage.getItem('tier_glow_enabled').then((v: string | null) => {
      setTierGlowEnabled(v === 'true');
    });
    loadNotifSettings();
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 360, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, tension: 200, friction: 18, useNativeDriver: true }),
    ]).start();
  }, []);

  const loadNotifSettings = async () => {
    const settings = await getNotificationSettings();
    setNotifSettings(settings);
    setNotifEnabled(Object.values(settings).some(Boolean));
  };

  const fetchShopDetails = async (authId: string) => {
    try {
      const [binding, clientRow] = await Promise.all([
        getActiveClientBinding(authId),
        supabase.from('clients').select('birthday').eq('auth_user_id', authId).maybeSingle(),
      ]);
      if (binding) {
        setVisitCount(binding.visitCount ?? 0);
        const shop = await getBarberProfile(binding.barberId);
        if (shop) {
          const s = shop as any;
          setShopName(s.shop_name || s.display_name || '');
          setShopCity(s.city || '');
        }
      }
      if (clientRow.data?.birthday) setBirthday(clientRow.data.birthday);
    } catch (e) { console.error(e); }
  };

  const handleLogout = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await AsyncStorage.removeItem('supabase.auth.token');
          await supabase.auth.signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all your data — appointments, loyalty points, and referrals. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account', style: 'destructive', onPress: () => {
            // Second confirmation
            Alert.alert(
              'Are you absolutely sure?',
              'Type "DELETE" to confirm. Your account will be gone forever.',
              [
                { text: 'No, keep it', style: 'cancel' },
                {
                  text: 'Yes, delete everything', style: 'destructive', onPress: async () => {
                    try {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                      const { data: { session } } = await supabase.auth.getSession();
                      if (!session?.user) return;
                      const uid = session.user.id;

                      // Delete client rows (cascades loyalty_points, appointments etc.)
                      try { await supabase.from('clients').delete().eq('auth_user_id', uid); } catch (_) {}
                      // Delete push tokens (best effort — table may not exist)
                      try { await supabase.from('push_tokens').delete().eq('user_id', uid); } catch (_) {}
                      // Delete auth user via SECURITY DEFINER RPC
                      try { await supabase.rpc('delete_own_account'); } catch (_) {}

                      // Clear all local storage
                      await AsyncStorage.multiRemove([
                        'user_mode', 'client_onboarding_complete',
                        'client_selected_barber_id', 'tier_glow_enabled',
                        'app_theme',
                      ]);
                      await supabase.auth.signOut();
                      toast.success('Account deleted.');
                      router.replace('/(onboarding)/welcome');
                    } catch (e: any) {
                      toast.error(e?.message || 'Could not delete account. Contact support.');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleSaveProfile = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || !authUserId) return;
    setSavingProfile(true);
    try {
      const { error: authErr } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
      if (authErr) throw authErr;
      await supabase.from('clients').update({ name: trimmed }).eq('auth_user_id', authUserId);
      setUserName(trimmed);
      setEditingName(false);
      toast.success('Profile updated!');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save profile. Try again.');
    }
    setSavingProfile(false);
  };

  const switchMode = async (nextMode: 'client' | 'barber') => {
    await AsyncStorage.setItem('user_mode', nextMode);
    setUserMode(nextMode);
    router.replace('/');
  };

  const updateNotifSetting = useCallback(async (key: keyof NotificationSettings, value: boolean) => {
    const next = { ...notifSettings, [key]: value };
    setNotifSettings(next);
    await saveNotificationSettings(next);
  }, [notifSettings]);

  const handleEnableNotifications = async () => {
    const token = await registerForPushNotifications();
    if (token) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) await savePushTokenToSupabase(session.user.id, token);
      const allOn: NotificationSettings = { appointments: true, reminders: true, messages: true, loyalty: true, marketing: false };
      setNotifSettings(allOn);
      setNotifEnabled(true);
      await saveNotificationSettings(allOn);
      toast.success('Push notifications enabled!');
    } else {
      toast.error('Permission denied. Enable notifications in your device Settings.');
    }
  };

  const tier = getTier(visitCount);
  const initials = userName ? userName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Header */}
      <View style={[S.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[S.backBtn, { backgroundColor: C.bg2, borderColor: C.border }]}
          activeOpacity={0.8}
        >
          <ChevronLeft color={C.text2} size={18} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={[S.title, { color: C.text }]}>Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scroll}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }], gap: 24 }}>

          {/* ── Profile hero ── */}
          <View style={[S.profileHero, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {/* Avatar */}
            <View style={[S.avatarRing, { borderColor: `${C.accent}40` }]}>
              <View style={[S.avatar, { backgroundColor: `${C.accent}18` }]}>
                <Text style={[S.avatarTxt, { color: C.accent }]}>{initials}</Text>
              </View>
            </View>

            {/* Name / email */}
            {editingName ? (
              <View style={S.nameEditWrap}>
                <TextInput
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="Your name"
                  placeholderTextColor={C.text3}
                  style={[S.nameInput, { backgroundColor: C.bg2, borderColor: C.border, color: C.text }]}
                  autoCapitalize="words"
                  autoFocus
                />
                <View style={S.nameEditBtns}>
                  <TouchableOpacity
                    onPress={() => { setNameInput(userName); setEditingName(false); }}
                    style={[S.nameEditCancel, { borderColor: C.border }]}
                    activeOpacity={0.8}
                  >
                    <Text style={[S.nameEditCancelTxt, { color: C.text2 }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSaveProfile}
                    disabled={savingProfile || !nameInput.trim()}
                    style={[S.nameEditSave, { backgroundColor: C.accent, opacity: savingProfile ? 0.7 : 1 }]}
                    activeOpacity={0.85}
                  >
                    {savingProfile
                      ? <ActivityIndicator color={C.accentText} size="small" />
                      : <Text style={[S.nameEditSaveTxt, { color: C.accentText }]}>Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingName(true)} activeOpacity={0.8} style={S.nameRow}>
                <Text style={[S.heroName, { color: C.text }]}>{userName}</Text>
                <View style={[S.editChip, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <User color={C.text3} size={11} strokeWidth={2} />
                  <Text style={[S.editChipTxt, { color: C.text3 }]}>Edit</Text>
                </View>
              </TouchableOpacity>
            )}
            <Text style={[S.heroEmail, { color: C.text3 }]}>{userEmail}</Text>

            {birthday ? (
              <View style={[S.birthdayRow, { backgroundColor: `${C.accent}10`, borderColor: `${C.accent}20` }]}>
                <Cake color={C.accent} size={13} strokeWidth={2} />
                <Text style={[S.birthdayTxt, { color: C.accent }]}>
                  {(() => {
                    const d = new Date(birthday + 'T12:00:00');
                    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                  })()}
                </Text>
              </View>
            ) : null}

            {/* Divider */}
            <View style={[S.heroDivider, { backgroundColor: C.border }]} />

            {/* Stats row */}
            <View style={S.heroStats}>
              <View style={S.heroStat}>
                <Text style={[S.heroStatNum, { color: C.text }]}>{visitCount}</Text>
                <Text style={[S.heroStatLbl, { color: C.text3 }]}>Visits</Text>
              </View>
              <View style={[S.heroStatDivider, { backgroundColor: C.border }]} />
              <View style={S.heroStat}>
                <View style={[S.tierPill, { backgroundColor: `${C.accent}18`, borderColor: `${C.accent}30` }]}>
                  <Text style={[S.tierPillTxt, { color: C.accent }]}>{tier.label}</Text>
                </View>
                <Text style={[S.heroStatLbl, { color: C.text3 }]}>Tier</Text>
              </View>
              {shopName ? (
                <>
                  <View style={[S.heroStatDivider, { backgroundColor: C.border }]} />
                  <View style={[S.heroStat, { flex: 2 }]}>
                    <Text style={[S.heroStatNum, { color: C.text }]} numberOfLines={1}>{shopName}</Text>
                    <Text style={[S.heroStatLbl, { color: C.text3 }]}>{shopCity || 'My shop'}</Text>
                  </View>
                </>
              ) : null}
            </View>
          </View>

          {/* ── My shop (if not linked) ── */}
          {!shopName && (
            <View>
              <Text style={[S.secLabel, { color: C.text3 }]}>MY BARBERSHOP</Text>
              <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <Row
                  C={C} Icon={MapPin}
                  label="Find & connect a shop"
                  onPress={() => router.push('/(client)/discover')}
                  accentIcon hasBorder={false}
                />
              </View>
            </View>
          )}

          {/* ── Appearance ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>APPEARANCE</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={[S.row, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
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
              <View style={[S.row, { borderBottomWidth: 0 }]}>
                <View style={[S.rowIcon, { backgroundColor: C.bg2 }]}>
                  <Sparkles color={C.text2} size={17} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.rowLabel, { color: C.text, flex: 0 }]}>Tier Glow</Text>
                  <Text style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>Tint the home screen with your tier color</Text>
                </View>
                <Switch
                  value={tierGlowEnabled}
                  onValueChange={async (v) => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTierGlowEnabled(v);
                    await AsyncStorage.setItem('tier_glow_enabled', v ? 'true' : 'false');
                  }}
                  trackColor={{ true: C.accent, false: C.bg3 }}
                  thumbColor={Platform.OS === 'android' ? (tierGlowEnabled ? C.accent : '#fff') : undefined}
                />
              </View>
            </View>
          </View>

          {/* ── Notifications ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>NOTIFICATIONS</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              {!notifEnabled ? (
                <TouchableOpacity
                  style={[S.notifBanner, { backgroundColor: `${C.accent}10`, borderColor: `${C.accent}30` }]}
                  onPress={handleEnableNotifications}
                  activeOpacity={0.8}
                >
                  <View style={[S.rowIcon, { backgroundColor: `${C.accent}18` }]}>
                    <BellRing color={C.accent} size={17} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.accent, fontWeight: '700', fontSize: 14 }}>Enable Push Notifications</Text>
                    <Text style={{ color: C.text3, fontSize: 12, marginTop: 2 }}>Booking updates, reminders & messages</Text>
                  </View>
                  <ChevronRight color={C.accent} size={15} strokeWidth={1.8} />
                </TouchableOpacity>
              ) : (
                <>
                  <NotifRow C={C} Icon={Calendar}       title="Appointment Updates" subtitle="Confirmations & changes"           value={notifSettings.appointments} onChange={(v: boolean) => updateNotifSetting('appointments', v)} />
                  <NotifRow C={C} Icon={Bell}            title="Reminders"           subtitle="1h and 24h before your cut"        value={notifSettings.reminders}    onChange={(v: boolean) => updateNotifSetting('reminders', v)} />
                  <NotifRow C={C} Icon={MessageCircle}   title="Messages"            subtitle="New messages from your barber"     value={notifSettings.messages}     onChange={(v: boolean) => updateNotifSetting('messages', v)} />
                  <NotifRow C={C} Icon={Gift}            title="Loyalty & Rewards"   subtitle="Points earned, tier upgrades"      value={notifSettings.loyalty}      onChange={(v: boolean) => updateNotifSetting('loyalty', v)} />
                  <NotifRow C={C} Icon={Megaphone}       title="Promotions"          subtitle="Special offers and news"           value={notifSettings.marketing}    onChange={(v: boolean) => updateNotifSetting('marketing', v)} hasBorder={false} />
                </>
              )}
            </View>
          </View>

          {/* ── Account ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>ACCOUNT</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Row
                C={C} Icon={ArrowLeftRight}
                label={`Switch to ${userMode === 'client' ? 'Barber' : 'Client'} Mode`}
                onPress={() => switchMode(userMode === 'client' ? 'barber' : 'client')}
              />
              <Row
                C={C} Icon={MapPin}
                label="Find Barbershops"
                onPress={() => router.push('/(client)/discover')}
                accentIcon
              />
              <Row
                C={C} Icon={History}
                label="Appointment History"
                onPress={() => router.push('/(client)/history')}
              />
              <Row
                C={C} Icon={Star}
                label="Loyalty & Rewards"
                onPress={() => router.push('/(client)/loyalty')}
              />
              <Row
                C={C} Icon={Shield}
                label="Privacy & Terms"
                onPress={() => {}}
                hasBorder={false}
              />
            </View>
          </View>

          {/* ── Sign out ── */}
          <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Row C={C} Icon={LogOut} label="Sign Out" onPress={handleLogout} hasBorder={false} destructive />
          </View>

          {/* ── Danger zone ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>DANGER ZONE</Text>
            <View style={[S.section, { backgroundColor: C.card, borderColor: 'rgba(239,68,68,0.2)' }]}>
              <Row C={C} Icon={Trash2} label="Delete Account" onPress={handleDeleteAccount} hasBorder={false} destructive />
            </View>
            <Text style={[S.dangerNote, { color: C.text3 }]}>
              Permanently deletes your account, loyalty points, and all data. Cannot be undone.
            </Text>
          </View>

          <Text style={[S.version, { color: C.text3 }]}>Kutz · v1.0.0</Text>

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  title:  { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  scroll: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 120 },
  secLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9, marginBottom: 8, marginLeft: 2 },

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

  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  heroName:   { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  editChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  editChipTxt: { fontSize: 11, fontWeight: '600' },
  heroEmail:   { fontSize: 13, marginBottom: 0 },

  nameEditWrap: { width: '100%', gap: 10, marginBottom: 4 },
  nameInput: {
    height: 46, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15, fontWeight: '600',
  },
  nameEditBtns:      { flexDirection: 'row', gap: 10 },
  nameEditCancel: {
    flex: 1, height: 42, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  nameEditCancelTxt: { fontSize: 14, fontWeight: '600' },
  nameEditSave: {
    flex: 1, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  nameEditSaveTxt: { fontSize: 14, fontWeight: '700' },

  birthdayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  birthdayTxt: { fontSize: 13, fontWeight: '600' },

  heroDivider: { width: '100%', height: 1, marginVertical: 18 },

  heroStats:       { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' },
  heroStat:        { flex: 1, alignItems: 'center', gap: 6 },
  heroStatNum:     { fontSize: 18, fontWeight: '900', letterSpacing: -0.4 },
  heroStatLbl:     { fontSize: 11, fontWeight: '500' },
  heroStatDivider: { width: 1, height: 36 },

  tierPill: {
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1,
  },
  tierPillTxt: { fontSize: 13, fontWeight: '800' },

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

  // Notif banner
  notifBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 18, borderWidth: 1,
  },

  dangerNote: { fontSize: 11, marginTop: 8, marginLeft: 2, lineHeight: 16 },
  version: { textAlign: 'center', fontSize: 12, paddingTop: 4 },
});
