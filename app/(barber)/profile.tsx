import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, StatusBar, ActivityIndicator, Alert, Animated,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft, Check, MapPin, Scissors, Building2, Pencil, X, Sparkles,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { format } from 'date-fns';

const AVATAR_PALETTE = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#0891b2', '#db2777', '#ea580c'];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(word => word[0]).join('').slice(0, 2).toUpperCase() || '?';
}

const TAB_BAR_HEIGHT = 68;

interface ProfileData {
  display_name: string;
  shop_name: string;
  tagline: string;
  shop_bio: string;
  address: string;
  city: string;
  country: string;
  avatar_url: string | null;
  created_at: string | null;
}

export default function BarberProfile() {
  const { C, theme } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 16;

  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [barberId, setBarberId] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileData>({
    display_name: '',
    shop_name: '',
    tagline: '',
    shop_bio: '',
    address: '',
    city: '',
    country: '',
    avatar_url: null,
    created_at: null,
  });
  const [draft, setDraft] = useState<ProfileData>(profile);
  const [totalClients, setTotalClients] = useState(0);
  const [weekAppts, setWeekAppts] = useState(0);
  const [services, setServices] = useState<Array<{ name: string; price: number }>>([]);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

      const uid = session.user.id;
      setBarberId(uid);

      const today = format(new Date(), 'yyyy-MM-dd');
      const weekAgo = format(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd');

      const [profileRes, clientRes, weekRes, servicesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name, shop_name, tagline, shop_bio, address, city, country, avatar_url, created_at')
          .or(`id.eq.${uid},user_id.eq.${uid}`)
          .maybeSingle(),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('barber_id', uid),
        supabase.from('appointments').select('id', { count: 'exact', head: true })
          .eq('barber_id', uid)
          .gte('date', weekAgo)
          .lte('date', today)
          .in('status', ['confirmed', 'completed']),
        supabase.from('services').select('name, price').eq('barber_id', uid).eq('is_active', true).order('name'),
      ]);

      const p = profileRes.data as any;
      const loaded: ProfileData = {
        display_name: p?.display_name || '',
        shop_name: p?.shop_name || '',
        tagline: p?.tagline || '',
        shop_bio: p?.shop_bio || '',
        address: p?.address || '',
        city: p?.city || '',
        country: p?.country || '',
        avatar_url: p?.avatar_url || null,
        created_at: p?.created_at || null,
      };

      setProfile(loaded);
      setDraft(loaded);
      setTotalClients((clientRes as any).count ?? 0);
      setWeekAppts((weekRes as any).count ?? 0);
      setServices(((servicesRes.data as any[]) ?? []).map(service => ({ name: service.name, price: service.price })));

      setLoading(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 380, useNativeDriver: true }).start();
    })();
  }, [fadeAnim]);

  const startEdit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft({ ...profile });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft({ ...profile });
    setEditing(false);
  };

  const saveProfile = async () => {
    if (!barberId) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: barberId,
        display_name: draft.display_name.trim(),
        shop_name: draft.shop_name.trim(),
        tagline: draft.tagline.trim(),
        shop_bio: draft.shop_bio.trim(),
        address: draft.address.trim(),
        city: draft.city.trim(),
        country: draft.country.trim(),
      }, { onConflict: 'id' });
      if (error) throw error;
      setProfile({ ...draft });
      setEditing(false);
      toast.show('Profile updated', 'success');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <View style={[S.loader, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  const activeProfile = editing ? draft : profile;
  const aColor = avatarColor(activeProfile.display_name || 'Barber');
  const memberSince = profile.created_at ? format(new Date(profile.created_at), 'MMM yyyy') : null;
  const location = [activeProfile.address, activeProfile.city, activeProfile.country].filter(Boolean).join(', ');

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      <View style={[S.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[S.headerBtn, { backgroundColor: C.bg2, borderColor: C.border }]}
          activeOpacity={0.8}
        >
          <ArrowLeft color={C.text} size={18} />
        </TouchableOpacity>
        <Text style={[S.headerTitle, { color: C.text }]}>{editing ? 'Edit profile' : 'Profile'}</Text>
        {!editing ? (
          <TouchableOpacity
            onPress={startEdit}
            style={[S.headerBtn, { backgroundColor: C.accent + '14', borderColor: C.accent + '25' }]}
            activeOpacity={0.8}
          >
            <Pencil color={C.accent} size={16} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={cancelEdit}
            style={[S.headerBtn, { backgroundColor: C.bg2, borderColor: C.border }]}
            activeOpacity={0.8}
          >
            <X color={C.text2} size={18} />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[S.scroll, { paddingBottom: tabBarClearance }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={[S.heroShell, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={[S.heroGlow, { backgroundColor: aColor + '16' }]} />
              <View style={[S.heroTopRow, { borderBottomColor: C.border }]}>
                <View style={[S.previewPill, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <Sparkles color={C.accent} size={12} />
                  <Text style={[S.previewPillTxt, { color: C.text2 }]}>Client-facing profile</Text>
                </View>
                {memberSince ? (
                  <Text style={[S.memberSince, { color: C.text3 }]}>Since {memberSince}</Text>
                ) : <View />}
              </View>

              <View style={[S.heroAvatar, { backgroundColor: aColor + '20', borderColor: aColor + '45' }]}>
                <Text style={[S.heroAvatarTxt, { color: aColor }]}>{initials(activeProfile.display_name || 'B')}</Text>
              </View>

              {editing ? (
                <>
                  <TextInput
                    value={draft.display_name}
                    onChangeText={value => setDraft(current => ({ ...current, display_name: value }))}
                    style={[S.heroNameInput, { color: C.text, borderColor: C.border, backgroundColor: C.bg }]}
                    placeholder="Your name"
                    placeholderTextColor={C.text3}
                    autoFocus
                  />
                  <TextInput
                    value={draft.shop_name}
                    onChangeText={value => setDraft(current => ({ ...current, shop_name: value }))}
                    style={[S.heroShopInput, { color: C.text2, borderColor: C.border, backgroundColor: C.bg }]}
                    placeholder="Shop name"
                    placeholderTextColor={C.text3}
                  />
                  <TextInput
                    value={draft.tagline}
                    onChangeText={value => setDraft(current => ({ ...current, tagline: value }))}
                    style={[S.heroTaglineInput, { color: C.text3, borderColor: C.border, backgroundColor: C.bg }]}
                    placeholder="Short positioning line"
                    placeholderTextColor={C.text3}
                    maxLength={80}
                  />
                </>
              ) : (
                <>
                  <Text style={[S.heroName, { color: C.text }]}>{profile.display_name || 'No name set'}</Text>
                  {!!profile.shop_name && (
                    <View style={[S.shopChip, { backgroundColor: C.bg2, borderColor: C.border }]}>
                      <Building2 color={C.text3} size={13} />
                      <Text style={[S.shopChipTxt, { color: C.text2 }]}>{profile.shop_name}</Text>
                    </View>
                  )}
                  <Text style={[S.heroTagline, { color: profile.tagline ? C.text2 : C.text3 }]}>
                    {profile.tagline || 'Add a tagline so clients instantly understand your style.'}
                  </Text>
                </>
              )}

              <View style={S.statsRow}>
                {[
                  { label: 'Clients', value: String(totalClients) },
                  { label: 'This week', value: String(weekAppts) },
                  { label: 'Services', value: String(services.length) },
                ].map(item => (
                  <View key={item.label} style={[S.statCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
                    <Text style={[S.statValue, { color: C.text }]}>{item.value}</Text>
                    <Text style={[S.statLabel, { color: C.text3 }]}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Text style={[S.sectionEyebrow, { color: C.text3 }]}>ABOUT</Text>
              <Text style={[S.sectionTitle, { color: C.text }]}>How your page reads to clients</Text>
              {editing ? (
                <TextInput
                  value={draft.shop_bio}
                  onChangeText={value => setDraft(current => ({ ...current, shop_bio: value }))}
                  style={[S.bioInput, { color: C.text, borderColor: C.border, backgroundColor: C.bg }]}
                  placeholder="Describe your cuts, your vibe, and what clients should expect."
                  placeholderTextColor={C.text3}
                  multiline
                  maxLength={400}
                />
              ) : (
                <Text style={[S.bioText, { color: profile.shop_bio ? C.text2 : C.text3 }]}>
                  {profile.shop_bio || 'No bio yet. Add a short pitch that feels premium and specific.'}
                </Text>
              )}
            </View>

            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Text style={[S.sectionEyebrow, { color: C.text3 }]}>LOCATION</Text>
              <Text style={[S.sectionTitle, { color: C.text }]}>Make the shop easy to trust</Text>
              {editing ? (
                <View style={S.inputStack}>
                  <TextInput
                    value={draft.address}
                    onChangeText={value => setDraft(current => ({ ...current, address: value }))}
                    style={[S.input, { color: C.text, borderColor: C.border, backgroundColor: C.bg }]}
                    placeholder="Street address"
                    placeholderTextColor={C.text3}
                  />
                  <View style={S.row}>
                    <TextInput
                      value={draft.city}
                      onChangeText={value => setDraft(current => ({ ...current, city: value }))}
                      style={[S.input, S.rowInput, { color: C.text, borderColor: C.border, backgroundColor: C.bg }]}
                      placeholder="City"
                      placeholderTextColor={C.text3}
                    />
                    <TextInput
                      value={draft.country}
                      onChangeText={value => setDraft(current => ({ ...current, country: value }))}
                      style={[S.input, S.rowInput, { color: C.text, borderColor: C.border, backgroundColor: C.bg }]}
                      placeholder="Country"
                      placeholderTextColor={C.text3}
                    />
                  </View>
                </View>
              ) : (
                <View style={[S.locationCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <View style={[S.locationIcon, { backgroundColor: C.accent + '12' }]}>
                    <MapPin color={C.accent} size={16} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.locationTitle, { color: C.text }]}>Shop location</Text>
                    <Text style={[S.locationText, { color: location ? C.text2 : C.text3 }]}>
                      {location || 'No location set'}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Text style={[S.sectionEyebrow, { color: C.text3 }]}>SERVICES</Text>
              <Text style={[S.sectionTitle, { color: C.text }]}>Your offer snapshot</Text>
              {services.length > 0 ? (
                <View style={S.servicesGrid}>
                  {services.map(service => (
                    <View key={service.name} style={[S.serviceCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
                      <Scissors color={C.accent} size={16} />
                      <Text style={[S.serviceName, { color: C.text }]} numberOfLines={1}>{service.name}</Text>
                      <Text style={[S.servicePrice, { color: C.accent }]}>
                        {service.price > 0 ? `$${service.price}` : 'Custom'}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[S.bioText, { color: C.text3 }]}>No active services yet.</Text>
              )}
            </View>

            {editing && (
              <TouchableOpacity
                onPress={saveProfile}
                disabled={saving}
                style={[S.saveBtn, { backgroundColor: C.accent }]}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color={C.accentText} size="small" />
                ) : (
                  <>
                    <Check color={C.accentText} size={18} strokeWidth={2.5} />
                    <Text style={[S.saveBtnTxt, { color: C.accentText }]}>Save profile</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  scroll: { paddingHorizontal: 16, paddingTop: 18, gap: 14 },
  heroShell: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
    marginBottom: 14,
  },
  heroGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    top: -60,
    right: -40,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    marginBottom: 18,
    borderBottomWidth: 1,
  },
  previewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  previewPillTxt: { fontSize: 12, fontWeight: '700' },
  memberSince: { fontSize: 12, fontWeight: '600' },
  heroAvatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  heroAvatarTxt: { fontSize: 34, fontWeight: '900' },
  heroName: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  heroNameInput: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  heroShopInput: {
    fontSize: 15,
    textAlign: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  heroTaglineInput: {
    fontSize: 14,
    textAlign: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 18,
  },
  shopChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'center',
    marginTop: 10,
  },
  shopChipTxt: { fontSize: 13, fontWeight: '700' },
  heroTagline: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 18,
    paddingHorizontal: 10,
  },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '900', letterSpacing: -0.6 },
  statLabel: { fontSize: 11, marginTop: 3 },
  section: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  sectionEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginTop: 8, marginBottom: 14 },
  bioText: { fontSize: 14, lineHeight: 22 },
  bioInput: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    lineHeight: 22,
    minHeight: 108,
    textAlignVertical: 'top',
  },
  inputStack: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  rowInput: { flex: 1 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  locationCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  locationText: { fontSize: 13, lineHeight: 19 },
  servicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  serviceCard: {
    width: '48%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  serviceName: { fontSize: 14, fontWeight: '700' },
  servicePrice: { fontSize: 16, fontWeight: '900' },
  saveBtn: {
    height: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveBtnTxt: { fontSize: 16, fontWeight: '800' },
});
