import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Animated, StyleSheet, Alert, StatusBar, Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { MapPin, Search, Scissors, CheckCircle2, X, ArrowRight, Navigation2, ArrowLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { resolveBarberOwnerId } from '@/lib/barber';
import { getActiveClientBinding, saveSelectedBarberId } from '@/lib/clientSync';
import { router } from 'expo-router';
import { useTheme } from '@/lib/theme';

interface Barbershop {
  id: string;
  display_name: string | null;
  shop_name: string | null;
  shop_bio: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  avatar_url: string | null;
  tagline: string | null;
  barber_slug: string | null;
}

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_PEEK   = 200;
const SHEET_OPEN   = SCREEN_H * 0.55;
const DEFAULT_REGION: Region = { latitude: 60.1699, longitude: 24.9384, latitudeDelta: 0.08, longitudeDelta: 0.08 };

const AVATAR_COLORS = ['#171717', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#404040'];
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]; }
function shopDisplay(s: Barbershop) { return s.shop_name || s.display_name || 'Barbershop'; }

export default function DiscoverScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const mapRef = useRef<MapView>(null);

  const [shops, setShops]               = useState<Barbershop[]>([]);
  const [filtered, setFiltered]         = useState<Barbershop[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [myBarberId, setMyBarberId]     = useState<string | null>(null);
  const [connecting, setConnecting]     = useState<string | null>(null);
  const [successId, setSuccessId]       = useState<string | null>(null);
  const [shopOwnerIds, setShopOwnerIds] = useState<Record<string, string>>({});
  const [selectedShop, setSelectedShop] = useState<Barbershop | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating]         = useState(false);
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [mapReady, setMapReady]         = useState(false);

  const sheetAnim  = useRef(new Animated.Value(SHEET_PEEK)).current;
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const debounce   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animate sheet height
  const animateSheet = (open: boolean) => {
    Animated.spring(sheetAnim, {
      toValue: open ? SHEET_OPEN : SHEET_PEEK,
      useNativeDriver: false,
      tension: 200,
      friction: 22,
    }).start();
    setSheetOpen(open);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const binding = await getActiveClientBinding(session.user.id);
      if (!binding) return;
      setMyBarberId(binding.barberId);
      await saveSelectedBarberId(binding.barberId, session.user.id);
    });
  }, []);

  const fetchShops = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_barbershops', { p_limit: 50, p_offset: 0 });
      if (error) throw error;
      const list = (data as Barbershop[]) ?? [];
      setShops(list); setFiltered(list);
      const ownerPairs = await Promise.all(
        list.map(async (s) => [s.id, (await resolveBarberOwnerId(s.id)) || s.id] as const),
      );
      setShopOwnerIds(Object.fromEntries(ownerPairs));
    } catch {
      const { data } = await supabase.from('profiles')
        .select('id, display_name, shop_name, shop_bio, tagline, address, city, country, latitude, longitude, avatar_url, barber_slug')
        .or('shop_name.not.is.null,barber_slug.not.is.null')
        .order('created_at', { ascending: false }).limit(50);
      const list = (data as Barbershop[]) ?? [];
      setShops(list); setFiltered(list);
      const ownerPairs = await Promise.all(
        list.map(async (s) => [s.id, (await resolveBarberOwnerId(s.id)) || s.id] as const),
      );
      setShopOwnerIds(Object.fromEntries(ownerPairs));
    }
    setLoading(false);
    Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, []);

  useEffect(() => { fetchShops(); }, [fetchShops]);

  // After shops load, fit map to show all pins
  useEffect(() => {
    if (!mapReady || shops.length === 0) return;
    const withCoords = shops.filter(s => s.latitude && s.longitude);
    if (withCoords.length === 0) return;
    const coords = withCoords.map(s => ({ latitude: s.latitude!, longitude: s.longitude! }));
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: SHEET_PEEK + 40, left: 40 },
      animated: true,
    });
  }, [shops, mapReady]);

  const handleNearMe = async () => {
    setLocating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Enable location access in Settings to find shops near you.');
        setLocating(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 800);
    } catch {
      Alert.alert('Could not get location', 'Try again.');
    }
    setLocating(false);
  };

  const handleSearch = (text: string) => {
    setSearch(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (!text.trim()) { setFiltered(shops); return; }
    debounce.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('search_barbershops', { p_query: text.trim(), p_limit: 20 });
        setFiltered((data as Barbershop[]) ?? []);
      } catch {
        const q = text.toLowerCase();
        setFiltered(shops.filter(s =>
          shopDisplay(s).toLowerCase().includes(q) ||
          (s.city ?? '').toLowerCase().includes(q) ||
          (s.address ?? '').toLowerCase().includes(q)
        ));
      }
    }, 320);
  };

  const handleSelectShop = (shop: Barbershop) => {
    setSelectedShop(shop);
    if (shop.latitude && shop.longitude) {
      mapRef.current?.animateToRegion({
        latitude: shop.latitude - 0.01,
        longitude: shop.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }, 600);
    }
    animateSheet(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleJoin = async (shop: Barbershop) => {
    const ownerId = shopOwnerIds[shop.id] || (await resolveBarberOwnerId(shop.id)) || shop.id;
    if (connecting || ownerId === myBarberId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { Alert.alert('Sign in required'); return; }
    const name = shopDisplay(shop);
    Alert.alert(
      `Join ${name}?`,
      `Your loyalty points and tier will be tracked here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Join', onPress: async () => {
            setConnecting(shop.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              const { error } = await supabase.rpc('link_client_account', {
                p_barber_id: ownerId,
                p_auth_user_id: session.user.id,
                p_email: session.user.email ?? '',
                p_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Client',
              });
              if (error) throw error;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setMyBarberId(ownerId);
              // Scope to this user so switching shops on one account doesn't affect others
              await saveSelectedBarberId(ownerId, session.user.id);
              setSuccessId(ownerId);
              setTimeout(() => { router.replace('/(client)/home'); }, 1200);
            } catch (err: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Failed to join', err.message || 'Please try again');
            }
            setConnecting(null);
          },
        },
      ]
    );
  };

  const shopsWithCoords  = shops.filter(s => s.latitude && s.longitude);
  const listShops        = search.trim() ? filtered : shops;

  const successChip  = isDark ? 'rgba(34,197,94,0.1)' : '#f0fdf4';
  const successBdr   = isDark ? 'rgba(34,197,94,0.3)' : '#bbf7d0';
  const successColor = isDark ? '#22c55e' : '#16a34a';

  return (
    <View style={S.root}>
      <StatusBar barStyle="light-content" />

      {/* ── Map ── */}
      <MapView
        ref={mapRef}
        style={S.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={DEFAULT_REGION}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        showsUserLocation={!!userLocation}
        showsMyLocationButton={false}
        onMapReady={() => setMapReady(true)}
        onPress={() => { if (sheetOpen) animateSheet(false); }}
      >
        {shopsWithCoords.map(shop => {
          const ownerId  = shopOwnerIds[shop.id] || shop.id;
          const isMine   = ownerId === myBarberId;
          const color    = avatarColor(shopDisplay(shop));
          const initials = shopDisplay(shop).charAt(0).toUpperCase();
          return (
            <Marker
              key={shop.id}
              coordinate={{ latitude: shop.latitude!, longitude: shop.longitude! }}
              onPress={() => handleSelectShop(shop)}
            >
              <View style={[S.pin, isMine && S.pinMine, { borderColor: isMine ? successColor : color }]}>
                <View style={[S.pinInner, { backgroundColor: isMine ? successColor : color }]}>
                  <Text style={S.pinTxt}>{initials}</Text>
                </View>
                {isMine && (
                  <View style={S.pinCheck}>
                    <CheckCircle2 color={successColor} size={12} />
                  </View>
                )}
              </View>
              <View style={[S.pinTail, { borderTopColor: isMine ? successColor : color }]} />
            </Marker>
          );
        })}
      </MapView>

      {/* ── Search bar overlay ── */}
      <SafeAreaView style={S.overlay} edges={['top']} pointerEvents="box-none">
        <View style={S.topRow}>
          {/* Back button — only show if we can go back */}
          {router.canGoBack() && (
            <TouchableOpacity
              style={[S.backBtn, { backgroundColor: isDark ? 'rgba(12,17,23,0.95)' : 'rgba(255,255,255,0.96)', borderColor: isDark ? '#2a2a2a' : '#e5e5e5' }]}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <ArrowLeft color={isDark ? '#fafafa' : '#0a0a0a'} size={18} strokeWidth={2} />
            </TouchableOpacity>
          )}
          <View style={[S.searchRow, { backgroundColor: isDark ? 'rgba(12,17,23,0.95)' : 'rgba(255,255,255,0.96)', borderColor: isDark ? '#2a2a2a' : '#e5e5e5', flex: 1 }]}>
          <Search color={isDark ? '#71717a' : '#a1a1aa'} size={15} />
          <TextInput
            value={search}
            onChangeText={handleSearch}
            placeholder="Search barbershops…"
            placeholderTextColor={isDark ? '#52525b' : '#a1a1aa'}
            style={[S.searchInput, { color: isDark ? '#fafafa' : '#0a0a0a' }]}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => animateSheet(true)}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => { setSearch(''); setFiltered(shops); }}>
              <X color={isDark ? '#71717a' : '#a1a1aa'} size={14} />
            </TouchableOpacity>
          )}
          </View>
        </View>

        {/* Near Me button */}
        <TouchableOpacity
          style={[S.nearBtn, { backgroundColor: isDark ? 'rgba(12,17,23,0.95)' : 'rgba(255,255,255,0.96)', borderColor: isDark ? '#2a2a2a' : '#e5e5e5' }]}
          onPress={handleNearMe}
          activeOpacity={0.8}
        >
          {locating
            ? <ActivityIndicator color={C.accent} size="small" />
            : <Navigation2 color={C.accent} size={17} strokeWidth={2} />
          }
          <Text style={[S.nearTxt, { color: C.accent }]}>Near me</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* ── Bottom sheet ── */}
      <Animated.View pointerEvents="box-none" style={[S.sheet, { height: sheetAnim }]}>
        <View style={[S.sheetInner, { backgroundColor: C.bg, borderColor: isDark ? '#27272a' : '#e5e5e5' }]}>
        {/* Handle */}
        <TouchableOpacity style={S.handleWrap} onPress={() => animateSheet(!sheetOpen)} activeOpacity={0.9}>
          <View style={[S.handle, { backgroundColor: isDark ? '#3f3f46' : '#d4d4d4' }]} />
        </TouchableOpacity>

        {/* Sheet header */}
        <View style={S.sheetHeader}>
          <Text style={[S.sheetTitle, { color: isDark ? '#fafafa' : '#0a0a0a' }]}>
            {myBarberId ? 'Barbershops' : 'Find your barbershop'}
          </Text>
          {myBarberId && (
            <View style={[S.connectedBadge, { backgroundColor: successChip, borderColor: successBdr }]}>
              <CheckCircle2 color={successColor} size={11} />
              <Text style={[S.connectedTxt, { color: successColor }]}>Connected</Text>
            </View>
          )}
        </View>

        {loading ? (
          <View style={S.loaderWrap}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={S.sheetScroll}
            keyboardShouldPersistTaps="handled"
          >
            {listShops.length === 0 ? (
              <View style={S.empty}>
                <Scissors color={isDark ? '#3f3f46' : '#d4d4d4'} size={28} />
                <Text style={[S.emptyTxt, { color: isDark ? '#52525b' : '#a1a1aa' }]}>
                  {search.trim() ? 'No results found' : 'No barbershops yet'}
                </Text>
              </View>
            ) : (
              listShops.map(shop => {
                const ownerId     = shopOwnerIds[shop.id] || shop.id;
                const isMine      = ownerId === myBarberId;
                const isSuccess   = ownerId === successId;
                const isConnecting = shop.id === connecting;
                const color       = avatarColor(shopDisplay(shop));
                const isSelected  = selectedShop?.id === shop.id;
                return (
                  <TouchableOpacity
                    key={shop.id}
                    onPress={() => handleSelectShop(shop)}
                    activeOpacity={0.75}
                    style={[
                      S.shopCard,
                      { backgroundColor: C.card, borderColor: C.cardBorder },
                      isMine   && { borderColor: successBdr, backgroundColor: successChip },
                      isSelected && !isMine && { borderColor: C.accent + '55' },
                    ]}
                  >
                    <View style={[S.avatar, { backgroundColor: color + '18' }]}>
                      <Text style={[S.avatarTxt, { color }]}>{shopDisplay(shop).charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={S.shopBody}>
                      <Text style={[S.shopName, { color: isDark ? '#fafafa' : '#0a0a0a' }]} numberOfLines={1}>
                        {shopDisplay(shop)}
                      </Text>
                      {(shop.address || shop.city) ? (
                        <View style={S.locRow}>
                          <MapPin color={isMine ? successColor : isDark ? '#52525b' : '#a1a1aa'} size={10} />
                          <Text style={[S.locTxt, { color: isMine ? successColor : isDark ? '#71717a' : '#737373' }]} numberOfLines={1}>
                            {[shop.address, shop.city].filter(Boolean).join(', ')}
                          </Text>
                        </View>
                      ) : null}
                      {shop.shop_bio ? (
                        <Text style={[S.shopBio, { color: isDark ? '#71717a' : '#737373' }]} numberOfLines={1}>{shop.shop_bio}</Text>
                      ) : null}
                    </View>
                    {isConnecting ? (
                      <ActivityIndicator color={C.accent} size="small" />
                    ) : isMine || isSuccess ? (
                      <View style={[S.joinBtn, { backgroundColor: successChip, borderColor: successBdr }]}>
                        <CheckCircle2 color={successColor} size={14} />
                        <Text style={[S.joinTxt, { color: successColor }]}>Joined</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[S.joinBtn, { backgroundColor: C.bg2, borderColor: C.border }]}
                        onPress={() => handleJoin(shop)}
                        activeOpacity={0.8}
                      >
                        <Text style={[S.joinTxt, { color: C.accent }]}>Join</Text>
                        <ArrowRight color={C.accent} size={12} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        )}
        </View>
      </Animated.View>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  map:  { ...StyleSheet.absoluteFillObject },

  // Map pin
  pin: {
    width: 42, height: 42, borderRadius: 21,
    borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 6 },
      android: { elevation: 5 },
    }),
  },
  pinMine:  { width: 46, height: 46, borderRadius: 23, borderWidth: 3 },
  pinInner: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pinTxt:   { color: '#fff', fontSize: 14, fontWeight: '900' },
  pinTail:  {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    alignSelf: 'center', marginTop: -1,
  },
  pinCheck: { position: 'absolute', bottom: -3, right: -3, backgroundColor: '#fff', borderRadius: 8 },

  // Search overlay
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 14, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: {
    width: 44, height: 44, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10 },
      android: { elevation: 4 },
    }),
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderRadius: 16, paddingHorizontal: 13, paddingVertical: 11,
    borderWidth: 1,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10 },
      android: { elevation: 4 },
    }),
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0, fontWeight: '500' },
  nearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8 },
      android: { elevation: 3 },
    }),
  },
  nearTxt: { fontSize: 13, fontWeight: '700' },

  // Sheet — outer wrapper is pointer-transparent so map stays interactive above it
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
  },
  sheetInner: {
    flex: 1,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderTopWidth: 1,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 12 },
      android: { elevation: 10 },
    }),
  },
  handleWrap:  { alignItems: 'center', paddingVertical: 10 },
  handle:      { width: 38, height: 4, borderRadius: 2 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.4 },
  connectedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1,
  },
  connectedTxt: { fontSize: 11, fontWeight: '700' },
  loaderWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  sheetScroll: { paddingHorizontal: 14, paddingBottom: 120 },

  // Shop card
  shopCard: {
    borderRadius: 14, padding: 13,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, marginBottom: 8,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  avatar:    { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 18, fontWeight: '900' },
  shopBody:  { flex: 1, gap: 3 },
  shopName:  { fontSize: 14, fontWeight: '700' },
  shopBio:   { fontSize: 12, lineHeight: 16 },
  locRow:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  locTxt:    { fontSize: 11 },
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1,
  },
  joinTxt:   { fontSize: 12, fontWeight: '700' },

  empty:    { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyTxt: { fontSize: 14, fontWeight: '500' },
});
