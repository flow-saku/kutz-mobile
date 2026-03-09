import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, CreditCard, Clock, ChevronDown, ChevronUp } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/lib/theme';
import ProgressRing from './ProgressRing';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const orange = '#f97316';
const green  = '#16a34a';
const blue   = '#2563eb';
const stripeColor = '#635bff';

interface SessionTimerPillProps {
  visible: boolean;
  startedAt: string;                // ISO 8601 timestamp
  clientName: string;
  serviceName?: string;
  servicePrice?: number;
  estimatedMinutes?: number;        // from services.duration_minutes
  isWalkIn?: boolean;
  needsCharge?: boolean;            // show "Complete & Charge" vs "Complete"
  onComplete: () => void;
  onExpandToggle?: (expanded: boolean) => void;
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function avatarColor(name: string): string {
  const colors = ['#6366f1','#f97316','#06b6d4','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#ef4444'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function SessionTimerPill({
  visible,
  startedAt,
  clientName,
  serviceName,
  servicePrice,
  estimatedMinutes,
  isWalkIn,
  needsCharge,
  onComplete,
  onExpandToggle,
}: SessionTimerPillProps) {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();

  // ── Animated values ──────────────────────────────────────────
  const enterAnim   = useRef(new Animated.Value(0)).current;   // 0→1
  const pulseAnim   = useRef(new Animated.Value(1)).current;   // pulsing dot
  const scaleAnim   = useRef(new Animated.Value(0.8)).current; // enter scale
  const slideAnim   = useRef(new Animated.Value(-30)).current; // translateY

  // ── State ────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed]   = useState(0); // seconds
  const prevVisible = useRef(false);

  // ── Timer (1-second tick from started_at timestamp) ──────────
  useEffect(() => {
    if (!visible || !startedAt) { setElapsed(0); return; }
    const start = new Date(startedAt).getTime();
    if (isNaN(start)) return;

    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [visible, startedAt]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  // Progress percent (elapsed vs estimated)
  const progressPct = estimatedMinutes && estimatedMinutes > 0
    ? Math.min(120, (elapsed / 60 / estimatedMinutes) * 100)
    : 0;
  const isOvertime = estimatedMinutes ? elapsed / 60 > estimatedMinutes : false;

  // ── Enter / Exit animations ──────────────────────────────────
  useEffect(() => {
    if (visible && !prevVisible.current) {
      // Enter
      enterAnim.setValue(0);
      scaleAnim.setValue(0.85);
      slideAnim.setValue(-30);
      Animated.parallel([
        Animated.spring(enterAnim,  { toValue: 1, tension: 180, friction: 14, useNativeDriver: true }),
        Animated.spring(scaleAnim,  { toValue: 1, tension: 200, friction: 16, useNativeDriver: true }),
        Animated.spring(slideAnim,  { toValue: 0, tension: 180, friction: 18, useNativeDriver: true }),
      ]).start();
    } else if (!visible && prevVisible.current) {
      // Exit
      Animated.parallel([
        Animated.timing(enterAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 0.85, tension: 200, friction: 14, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: -30, duration: 200, useNativeDriver: true }),
      ]).start();
    }
    prevVisible.current = visible;
  }, [visible]);

  // ── Pulse animation (looping) ────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible]);

  // ── Expand / Collapse ────────────────────────────────────────
  const toggleExpand = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.create(
      280,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    setExpanded(prev => {
      const next = !prev;
      onExpandToggle?.(next);
      return next;
    });
  }, [onExpandToggle]);

  // ── Don't render if never visible ────────────────────────────
  if (!visible && !prevVisible.current) return null;

  const ac = avatarColor(clientName);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        S.wrapper,
        {
          top: insets.top + 8,
          opacity: enterAnim,
          transform: [{ scale: scaleAnim }, { translateY: slideAnim }],
        },
      ]}
    >
      <Pressable onPress={toggleExpand} style={{ flex: 1 }}>
        <View style={[
          S.pill,
          {
            backgroundColor: isDark ? '#1a1206' : '#fff8f0',
            borderColor: `${orange}30`,
          },
        ]}>
          {/* ── Collapsed row (always visible) ── */}
          <View style={S.collapsedRow}>
            {/* Pulsing dot */}
            <Animated.View style={[S.pulseDot, { backgroundColor: orange, opacity: pulseAnim }]} />

            {/* Avatar */}
            <View style={[S.miniAvatar, { backgroundColor: `${ac}18` }]}>
              <Text style={[S.miniAvatarTxt, { color: ac }]}>{initials(clientName)}</Text>
            </View>

            {/* Timer */}
            <View style={S.timerWrap}>
              <Text style={[S.timerText, { color: isOvertime ? '#dc2626' : orange }]}>
                {mm}:{ss}
              </Text>
            </View>

            {/* Client name (truncated) */}
            <Text numberOfLines={1} style={[S.clientNameSmall, { color: C.text }]}>
              {clientName}
            </Text>

            {/* Expand chevron */}
            <View style={S.chevron}>
              {expanded
                ? <ChevronUp color={C.text3} size={16} />
                : <ChevronDown color={C.text3} size={16} />}
            </View>
          </View>

          {/* ── Expanded content ── */}
          {expanded && (
            <View style={S.expandedContent}>
              <View style={S.separator} />

              <View style={S.expandedBody}>
                {/* Left: details */}
                <View style={S.expandedDetails}>
                  <Text style={[S.expandedName, { color: C.text }]}>{clientName}</Text>

                  <View style={S.metaRow}>
                    {serviceName && (
                      <Text style={[S.metaText, { color: C.text2 }]}>{serviceName}</Text>
                    )}
                    {servicePrice != null && servicePrice > 0 && (
                      <Text style={[S.metaText, { color: C.text3 }]}>
                        · ${Number(servicePrice).toFixed(0)}
                      </Text>
                    )}
                  </View>

                  <View style={S.badgeRow}>
                    {/* Walk-in / Booked */}
                    <View style={[
                      S.badge,
                      { backgroundColor: isWalkIn ? `${orange}12` : `${blue}10` },
                    ]}>
                      <Text style={[S.badgeText, { color: isWalkIn ? orange : blue }]}>
                        {isWalkIn ? 'Walk-in' : 'Booked'}
                      </Text>
                    </View>

                    {/* Estimated */}
                    {estimatedMinutes && (
                      <View style={[S.badge, { backgroundColor: `${C.text3}10` }]}>
                        <Clock color={C.text3} size={10} strokeWidth={2} />
                        <Text style={[S.badgeText, { color: C.text3 }]}>
                          Est. {estimatedMinutes}m
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Right: progress ring */}
                {estimatedMinutes && estimatedMinutes > 0 ? (
                  <View style={S.ringWrap}>
                    <ProgressRing
                      percent={progressPct}
                      size={60}
                      strokeWidth={5}
                      color={isOvertime ? '#dc2626' : orange}
                      trackColor={isDark ? '#2e2e2e' : '#e5e5e5'}
                    >
                      <Text style={[S.ringTimer, { color: isOvertime ? '#dc2626' : orange }]}>
                        {mm}:{ss}
                      </Text>
                    </ProgressRing>
                  </View>
                ) : (
                  <View style={S.bigTimerWrap}>
                    <Text style={[S.bigTimer, { color: isOvertime ? '#dc2626' : orange }]}>
                      {mm}:{ss}
                    </Text>
                  </View>
                )}
              </View>

              {/* Complete button */}
              <Pressable
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  onComplete();
                }}
                style={({ pressed }) => [
                  S.completeBtn,
                  { backgroundColor: needsCharge ? stripeColor : green, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                {needsCharge ? (
                  <>
                    <CreditCard color="#fff" size={15} strokeWidth={2} />
                    <Text style={S.completeBtnTxt}>
                      Complete & Charge{servicePrice ? ` $${Number(servicePrice).toFixed(0)}` : ''}
                    </Text>
                  </>
                ) : (
                  <>
                    <CheckCircle2 color="#fff" size={15} strokeWidth={2} />
                    <Text style={S.completeBtnTxt}>Complete Session</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const S = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 998,
  },
  pill: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16 },
      android: { elevation: 10 },
    }),
  },

  // ── Collapsed ──
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  miniAvatar: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarTxt: {
    fontSize: 11,
    fontWeight: '800',
  },
  timerWrap: {
    minWidth: 58,
  },
  timerText: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  clientNameSmall: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  chevron: {
    paddingLeft: 4,
  },

  // ── Expanded ──
  expandedContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(249,115,22,0.12)',
    marginBottom: 14,
  },
  expandedBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  expandedDetails: {
    flex: 1,
    gap: 4,
  },
  expandedName: {
    fontSize: 17,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    fontWeight: '500',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTimer: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  bigTimerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  bigTimer: {
    fontSize: 28,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },

  // ── Complete button ──
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 14,
  },
  completeBtnTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
