import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { Tabs } from 'expo-router';
import { Home, Star, MessageCircle, CalendarCheck, Gift, Settings } from 'lucide-react-native';
import {
  Animated, Platform, Pressable, StyleSheet,
  useWindowDimensions, View, Text, PanResponder,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

let ExpoBlurView: any = null;
try { ExpoBlurView = require('expo-blur').BlurView; } catch {}

const VISIBLE_TABS = ['home', 'messages', 'rebook', 'refer', 'loyalty'];
const TAB_ICONS: Record<string, any> = {
  home:     Home,
  rebook:   CalendarCheck,
  refer:    Gift,
  loyalty:  Star,
  messages: MessageCircle,
};
const TAB_LABELS: Record<string, string> = {
  home:     'Home',
  rebook:   'Book',
  refer:    'Refer',
  loyalty:  'Rewards',
  messages: 'Chat',
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

function ClientGlassTabBar({ state, navigation }: any) {
  const { C, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDark = theme === 'dark';

  const PAD          = 5;
  const H_MARGIN     = 12;
  const barWidth     = Math.min(width - H_MARGIN * 2, 560);
  const innerWidth   = barWidth - PAD * 2;
  const BAR_HEIGHT   = 68;

  const routes = useMemo(
    () => state.routes.filter((r: any) => VISIBLE_TABS.includes(r.name)),
    [state.routes],
  );

  const activeRouteName = state.routes[state.index]?.name;
  const isVisible   = VISIBLE_TABS.includes(activeRouteName);
  const activeIndex = Math.max(0, routes.findIndex((r: any) => r.name === activeRouteName));
  const tabCount    = routes.length || 1;
  const tabWidth    = innerWidth / tabCount;
  const dragX      = useRef(new Animated.Value(0)).current;
  const barScale   = useRef(new Animated.Value(0.94)).current;
  const barOpacity = useRef(new Animated.Value(0)).current;

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

export default function ClientLayout() {
  return (
    <View style={S.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          tabBarShowLabel: false,
        }}
        tabBar={(props) => <ClientGlassTabBar {...props} />}
      >
        <Tabs.Screen name="home"     options={{ title: 'Home' }} />
        <Tabs.Screen name="rebook"   options={{ title: 'Book' }} />
        <Tabs.Screen name="refer"    options={{ title: 'Refer' }} />
        <Tabs.Screen name="loyalty"  options={{ title: 'Rewards' }} />
        <Tabs.Screen name="messages" options={{ title: 'Chat' }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="discover" options={{ href: null }} />
        <Tabs.Screen name="history"  options={{ href: null }} />
      </Tabs>
    </View>
  );
}

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
