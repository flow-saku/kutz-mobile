import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, MapPin, Scissors, MessageCircle, Clock3, Sparkles } from 'lucide-react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

interface BarberProfileData {
  display_name: string;
  shop_name: string | null;
  bio: string | null;
  city: string | null;
  address: string | null;
  avatar_url: string | null;
}

interface Service {
  id: string;
  name: string;
  price: number;
  duration_minutes: number | null;
  description: string | null;
}

const AVATAR_PALETTE = ['#0f766e', '#1d4ed8', '#b45309', '#be123c', '#7c3aed', '#0891b2'];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export default function BarberProfileScreen() {
  const { C, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isDark = theme === 'dark';

  const { barberId, barberName, isShopChannel } = useLocalSearchParams<{
    barberId: string;
    barberName: string;
    isShopChannel?: string;
  }>();

  const [profile, setProfile] = useState<BarberProfileData | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  const bg = isDark ? C.bg : '#ffffff';
  const bg2 = isDark ? C.bg2 : '#f5f5f5';
  const border = isDark ? C.border : '#e6e6e6';
  const textCol = isDark ? C.text : '#161616';
  const text2 = isDark ? C.text2 : '#737373';
  const text3 = isDark ? C.text3 : '#a3a3a3';
  const accent = C.accent;

  useEffect(() => {
    if (!barberId) return;
    (async () => {
      const [profileRes, servicesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name, shop_name, bio, city, address, avatar_url')
          .or(`id.eq.${barberId},user_id.eq.${barberId}`)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('services')
          .select('id, name, price, duration_minutes, description')
          .eq('barber_id', barberId)
          .eq('is_active', true)
          .order('price', { ascending: true }),
      ]);

      setProfile(profileRes.data as BarberProfileData | null);
      setServices((servicesRes.data as Service[]) ?? []);
      setLoading(false);
    })();
  }, [barberId]);

  const displayName = profile?.display_name || barberName || 'Barber';
  const initials = displayName.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2);
  const accentTone = avatarColor(displayName);
  const shopName = profile?.shop_name || '';
  const location = [profile?.city, profile?.address].filter(Boolean).join(' · ');
  const cheapestService = services.length > 0 ? Math.min(...services.map(service => service.price)) : null;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={[S.container, { backgroundColor: bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bg} />

      <View style={[S.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[S.iconBtn, { backgroundColor: bg2, borderColor: border }]} activeOpacity={0.8}>
          <ChevronLeft color={textCol} size={20} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={[S.headerTxt, { color: textCol }]}>Profile</Text>
        <View style={S.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 124 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[S.heroCard, { backgroundColor: bg2, borderColor: border }]}>
          <View style={[S.heroGlow, { backgroundColor: accentTone + '16' }]} />
          <View style={[S.heroBadge, { backgroundColor: bg, borderColor: border }]}>
            <Sparkles color={accent} size={12} />
            <Text style={[S.heroBadgeTxt, { color: text2 }]}>
              {isShopChannel === 'true' ? 'Shop channel' : 'Direct barber chat'}
            </Text>
          </View>

          <View style={[S.avatarRing, { backgroundColor: accentTone + '18', borderColor: accentTone + '45' }]}>
            <Text style={[S.avatarTxt, { color: accentTone }]}>{initials}</Text>
          </View>
          <Text style={[S.name, { color: textCol }]}>{displayName}</Text>

          {shopName ? (
            <View style={[S.shopPill, { backgroundColor: bg, borderColor: border }]}>
              <Scissors color={accent} size={12} strokeWidth={2.5} />
              <Text style={[S.shopPillTxt, { color: text2 }]}>{shopName}</Text>
            </View>
          ) : null}

          {location ? (
            <View style={S.locationRow}>
              <MapPin color={text3} size={13} strokeWidth={2} />
              <Text style={[S.locationTxt, { color: text3 }]}>{location}</Text>
            </View>
          ) : null}

          <View style={S.metricRow}>
            <View style={[S.metricCard, { backgroundColor: bg, borderColor: border }]}>
              <Text style={[S.metricValue, { color: textCol }]}>{services.length}</Text>
              <Text style={[S.metricLabel, { color: text3 }]}>Services</Text>
            </View>
            <View style={[S.metricCard, { backgroundColor: bg, borderColor: border }]}>
              <Text style={[S.metricValue, { color: textCol }]}>{cheapestService != null ? `$${cheapestService}` : '--'}</Text>
              <Text style={[S.metricLabel, { color: text3 }]}>Starting at</Text>
            </View>
          </View>
        </View>

        <View style={[S.section, { backgroundColor: bg2, borderColor: border }]}>
          <Text style={[S.sectionEyebrow, { color: text3 }]}>ABOUT</Text>
          <Text style={[S.sectionTitle, { color: textCol }]}>What to expect</Text>
          <Text style={[S.bio, { color: profile?.bio ? text2 : text3 }]}>
            {profile?.bio || 'No bio yet.'}
          </Text>
        </View>

        <View style={[S.section, { backgroundColor: bg2, borderColor: border }]}>
          <Text style={[S.sectionEyebrow, { color: text3 }]}>SERVICES</Text>
          <Text style={[S.sectionTitle, { color: textCol }]}>Book with confidence</Text>
          {services.length > 0 ? (
            <View style={S.servicesList}>
              {services.map(service => (
                <View key={service.id} style={[S.serviceCard, { backgroundColor: bg, borderColor: border }]}>
                  <View style={S.serviceTop}>
                    <Text style={[S.serviceName, { color: textCol }]}>{service.name}</Text>
                    <Text style={[S.servicePrice, { color: accent }]}>{`$${service.price}`}</Text>
                  </View>
                  {!!service.description && (
                    <Text style={[S.serviceDesc, { color: text3 }]} numberOfLines={2}>{service.description}</Text>
                  )}
                  {service.duration_minutes ? (
                    <View style={S.durationRow}>
                      <Clock3 color={text3} size={12} />
                      <Text style={[S.durationTxt, { color: text3 }]}>{service.duration_minutes} min</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <Text style={[S.bio, { color: text3 }]}>No active services yet.</Text>
          )}
        </View>
      </ScrollView>

      <View style={[S.footer, { backgroundColor: bg + 'F2', borderTopColor: border, paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity
          style={[S.msgBtn, { backgroundColor: accent }]}
          onPress={() => router.back()}
          activeOpacity={0.88}
        >
          <MessageCircle color={C.accentText} size={18} strokeWidth={2.2} />
          <Text style={[S.msgBtnTxt, { color: C.accentText }]}>
            Message {isShopChannel === 'true' ? shopName || displayName : displayName}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerTxt: { fontSize: 16, fontWeight: '700' },
  headerSpacer: { width: 38 },
  scroll: { paddingHorizontal: 16, paddingTop: 18 },
  heroCard: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
    marginBottom: 14,
  },
  heroGlow: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    right: -50,
    top: -70,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 18,
  },
  heroBadgeTxt: { fontSize: 12, fontWeight: '700' },
  avatarRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  avatarTxt: { fontSize: 34, fontWeight: '900' },
  name: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
    textAlign: 'center',
    marginBottom: 10,
  },
  shopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 10,
  },
  shopPillTxt: { fontSize: 13, fontWeight: '700' },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 18,
  },
  locationTxt: { fontSize: 13 },
  metricRow: { flexDirection: 'row', gap: 10 },
  metricCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  metricValue: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  metricLabel: { fontSize: 11, marginTop: 4 },
  section: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  sectionEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginTop: 8, marginBottom: 12 },
  bio: { fontSize: 14, lineHeight: 22 },
  servicesList: { gap: 10 },
  serviceCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  serviceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  serviceName: { fontSize: 15, fontWeight: '800', flex: 1 },
  servicePrice: { fontSize: 16, fontWeight: '900' },
  serviceDesc: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  durationTxt: { fontSize: 12, fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 18,
    paddingVertical: 17,
  },
  msgBtnTxt: { fontSize: 15, fontWeight: '800' },
});
