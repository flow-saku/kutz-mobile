import React, { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { Tabs } from 'expo-router';
import { LayoutDashboard, CalendarDays, Users, MessageCircle, Settings, Lock } from 'lucide-react-native';
import {
  Animated, Platform, Pressable, StyleSheet,
  useWindowDimensions, View, Text, PanResponder,
  ActivityIndicator, TouchableOpacity, Linking,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { resolveBarberScope } from '@/lib/barber';
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native';

// ── Payments live ────────────────────────────────────────────────────────────
const PAYMENTS_LIVE = true;

let ExpoBlurView: any = null;
try { ExpoBlurView = require('expo-blur').BlurView; } catch {}

const VISIBLE_TABS = ['dashboard', 'appointments', 'clients', 'messages', 'settings'];
const TAB_ICONS: Record<string, any> = {
  dashboard:    LayoutDashboard,
  appointments: CalendarDays,
  clients:      Users,
  messages:     MessageCircle,
  settings:     Settings,
};
const TAB_LABELS: Record<string, string> = {
  dashboard:    'Home',
  appointments: 'Schedule',
  clients:      'Clients',
  messages:     'Chat',
  settings:     'Settings',
};

function AnimatedTabIcon({ Icon, focused, color, size, strokeWidth }: {
  Icon: any; focused: boolean; color: string; size: number; strokeWidth: number;
}) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.88)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0.88,
      useNativeDriver: true,
      tension: 480,
      friction: 28,
    }).start();
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon color={color} size={size} strokeWidth={strokeWidth} />
    </Animated.View>
  );
}

function BarberGlassTabBar({ state, navigation }: any) {
  const { C, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDark = theme === 'dark';

  const PAD        = 5;
  const H_MARGIN   = 12;
  const barWidth   = Math.min(width - H_MARGIN * 2, 560);
  const innerWidth = barWidth - PAD * 2;
  const BAR_HEIGHT = 68;

  const routes = useMemo(
    () => state.routes.filter((r: any) => VISIBLE_TABS.includes(r.name)),
    [state.routes],
  );

  const activeRouteName = state.routes[state.index]?.name;
  const isVisible   = VISIBLE_TABS.includes(activeRouteName);
  const activeIndex = Math.max(0, routes.findIndex((r: any) => r.name === activeRouteName));
  const tabCount    = routes.length || 1;
  const tabWidth    = innerWidth / tabCount;
  const dragX       = useRef(new Animated.Value(0)).current;
  const barScale    = useRef(new Animated.Value(0.94)).current;
  const barOpacity  = useRef(new Animated.Value(0)).current;

  const activeIndexRef   = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const lastDragNavRef   = useRef(-1);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(barScale, { toValue: 1, useNativeDriver: true, tension: 260, friction: 22, delay: 100 }),
      Animated.timing(barOpacity, { toValue: 1, duration: 340, useNativeDriver: true, delay: 60 }),
    ]).start();
  }, []);

  const navigateToIndex = useCallback((idx: number) => {
    if (idx >= 0 && idx < routes.length) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate(routes[idx].name);
    }
  }, [routes, navigation]);

  const tabBarSwipe = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dy) < 25,
    onPanResponderGrant: () => {
      dragX.setValue(0);
      lastDragNavRef.current = activeIndexRef.current;
    },
    onPanResponderMove: (_, g) => {
      const ai      = activeIndexRef.current;
      const clamped = Math.max(-ai * tabWidth, Math.min((tabCount - 1 - ai) * tabWidth, g.dx));
      dragX.setValue(clamped);
      const pillCenter   = ai * tabWidth + tabWidth / 2 + clamped;
      const hoveredIndex = Math.max(0, Math.min(tabCount - 1, Math.floor(pillCenter / tabWidth)));
      if (hoveredIndex !== lastDragNavRef.current) {
        lastDragNavRef.current = hoveredIndex;
        navigateToIndex(hoveredIndex);
      }
    },
    onPanResponderRelease: () => {
      Animated.spring(dragX, { toValue: 0, useNativeDriver: true, tension: 440, friction: 30 }).start();
    },
  }), [tabWidth, tabCount, navigateToIndex, dragX]);


  if (!isVisible) return null;

  const bottomOffset  = Math.max(18, insets.bottom + 10);
  const accentColor   = C.accent;
  const inactiveColor = C.text3;
  const isAndroid     = Platform.OS === 'android';

  const glassBg     = isAndroid ? C.tabBar : isDark ? 'rgba(12,17,23,0.93)' : 'rgba(255,255,255,0.92)';
  const glassBorder = C.tabBarBorder;
  const BlurContainer = ExpoBlurView || View;
  const blurProps = ExpoBlurView
    ? { intensity: isDark ? 38 : 32, tint: (isDark ? 'dark' : 'light') as 'dark' | 'light' }
    : {};

  return (
    <View style={[S.wrap, { bottom: bottomOffset }]}>
      <Animated.View style={{ transform: [{ scale: barScale }], opacity: barOpacity, alignItems: 'center' }}>
        <View
          {...tabBarSwipe.panHandlers}
          style={[S.barOuter, { width: barWidth }]}
        >
          <BlurContainer
            {...blurProps}
            style={[S.barInner, {
              backgroundColor: glassBg,
              borderColor: glassBorder,
              height: BAR_HEIGHT,
              paddingHorizontal: PAD,
            }]}
          >
            {/* Tab buttons */}
            {routes.map((route: any, idx: number) => {
              const focused = idx === activeIndex;
              const Icon    = TAB_ICONS[route.name] || Settings;
              const label   = TAB_LABELS[route.name] || route.name;
              const color   = focused ? accentColor : inactiveColor;

              return (
                <Pressable
                  key={route.key}
                  onPress={() => {
                    if (!focused) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    navigation.navigate(route.name);
                  }}
                  style={[S.tabBtn, { width: tabWidth }]}
                >
                  <View style={S.tabContent}>
                    <AnimatedTabIcon
                      Icon={Icon}
                      focused={focused}
                      color={color}
                      size={22}
                      strokeWidth={focused ? 2.2 : 1.7}
                    />
                    <Text style={[S.tabTxt, {
                      color,
                      fontWeight: focused ? '700' : '500',
                      fontSize: 10.5,
                      opacity: focused ? 1 : 0.7,
                    }]}>
                      {label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </BlurContainer>
        </View>
      </Animated.View>
    </View>
  );
}

// ── Subscription expired screen ──────────────────────────────────────────────

function SubscriptionExpiredScreen({ isStaff }: { isStaff: boolean }) {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[SS.root, { backgroundColor: C.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={[SS.iconWrap, { backgroundColor: C.accent + '15' }]}>
        <Lock color={C.accent} size={38} strokeWidth={1.8} />
      </View>
      <Text style={[SS.heading, { color: C.text }]}>Subscription Inactive</Text>
      <Text style={[SS.body, { color: C.text2 }]}>
        {isStaff
          ? "Your shop's Kutz subscription has expired.\nContact your shop owner to restore access."
          : "Your Kutz subscription has expired.\nRenew to get back to work."
        }
      </Text>
      {!isStaff && (
        <TouchableOpacity
          onPress={() => Linking.openURL('https://kutz.io/subscribe')}
          style={[SS.btn, { backgroundColor: C.accent }]}
          activeOpacity={0.85}
        >
          <Text style={SS.btnTxt}>Renew Now</Text>
        </TouchableOpacity>
      )}
      <Text style={[SS.hint, { color: C.text3 }]}>
        Already renewed? Restart the app to refresh.
      </Text>
    </View>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

type SubState = 'loading' | 'active' | 'inactive' | 'staff_inactive';

export default function BarberLayout() {
  const [subState, setSubState] = useState<SubState>('loading');
  const [ownerUid, setOwnerUid] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Gate is off — skip the DB check entirely
      if (!PAYMENTS_LIVE) { setSubState('active'); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setSubState('active'); return; }

      const { ownerUid: uid, isStaff } = await resolveBarberScope(session.user.id);
      setOwnerUid(uid);

      const { data } = await supabase
        .from('profiles')
        .select('subscription_status')
        .or(`id.eq.${uid},user_id.eq.${uid}`)
        .limit(1)
        .maybeSingle();

      const status = (data as any)?.subscription_status as string | undefined;
      const active = status === 'active' || status === 'trialing';

      if (!active) {
        setSubState(isStaff ? 'staff_inactive' : 'inactive');
      } else {
        setSubState('active');
      }
    })();
  }, []);

  // Stripe Terminal: fetch connection token scoped to barber's connected account
  const fetchTokenProvider = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !ownerUid) throw new Error('Not authenticated');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-connection-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ barber_id: ownerUid }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Token fetch failed');
    return data.secret;
  }, [ownerUid]);

  if (subState === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' }}>
        <ActivityIndicator color="#a855f7" size="large" />
      </View>
    );
  }

  if (subState === 'inactive' || subState === 'staff_inactive') {
    return <SubscriptionExpiredScreen isStaff={subState === 'staff_inactive'} />;
  }

  return (
    <View style={S.root}>
      <StripeTerminalProvider tokenProvider={fetchTokenProvider}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { display: 'none' },
            tabBarShowLabel: false,
          }}
          tabBar={(props: any) => <BarberGlassTabBar {...props} />}
        >
          <Tabs.Screen name="dashboard"    options={{ title: 'Home' }} />
          <Tabs.Screen name="appointments" options={{ title: 'Schedule' }} />
          <Tabs.Screen name="clients"      options={{ title: 'Clients' }} />
          <Tabs.Screen name="messages"     options={{ title: 'Chat' }} />
          <Tabs.Screen name="settings"     options={{ title: 'Settings' }} />
          <Tabs.Screen name="charge"       options={{ title: 'Charge', href: null }} />
          <Tabs.Screen name="profile"      options={{ title: 'Profile', href: null }} />
        </Tabs>
      </StripeTerminalProvider>
    </View>
  );
}

const SS = StyleSheet.create({
  root:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrap:{ width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  heading: { fontSize: 26, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5, marginBottom: 14 },
  body:    { fontSize: 15, textAlign: 'center', lineHeight: 23, marginBottom: 36 },
  btn:     { paddingHorizontal: 40, paddingVertical: 17, borderRadius: 18, marginBottom: 20 },
  btnTxt:  { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  hint:    { fontSize: 12, textAlign: 'center' },
});

const S = StyleSheet.create({
  root: { flex: 1 },
  wrap: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', zIndex: 999,
  },
  barOuter: {
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: Platform.OS === 'ios' ? 0.08 : 0,
    shadowRadius: 12,
    elevation: 8,
  },
  barInner: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 36, borderWidth: 1,
    overflow: 'hidden', width: '100%',
    position: 'relative',
  },
  tabBtn: {
    height: '100%', alignItems: 'center',
    justifyContent: 'center', zIndex: 3,
  },
  tabContent: {
    alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 6,
  },
  tabTxt: { letterSpacing: 0.1 },
});
