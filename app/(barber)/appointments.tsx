import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, StyleSheet, StatusBar, Animated,
  Pressable, FlatList, PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CalendarDays, Clock, Check, X, Play, ChevronLeft, ChevronRight,
  Scissors, DollarSign, Users, TrendingUp, CheckCircle2, Timer, CreditCard,
  Globe, UserCircle2, UserPlus,
} from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { resolveBarberScope } from '@/lib/barber';
import { useToast } from '@/lib/toast';
import AnimatedCounter from '@/components/ui/AnimatedCounter';
import {
  format, addDays, subDays, startOfWeek, isSameDay, isToday,
  addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek as swk, endOfWeek as ewk, isSameMonth,
} from 'date-fns';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt12(t: string) {
  try {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const TAB_BAR_HEIGHT = 68;

// Avatar colors by name hash
const AVATAR_COLORS = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#7c3aed'];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// Pressable with spring feedback
function Tap({ onPress, style, children, disabled = false }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 500, friction: 28 }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 400, friction: 26 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function BarberAppointments() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 16;

  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [scopeIds, setScopeIds]         = useState<string[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calMonth, setCalMonth]         = useState(new Date());
  const [view, setView]                 = useState<'day' | 'calendar'>('day');
  const [dotMap, setDotMap]             = useState<Record<string, number>>({});
  const [barberEmail, setBarberEmail]   = useState<string | null>(null);
  const [shopName, setShopName]         = useState<string>('');
  const [barberId, setBarberId]         = useState<string | null>(null);
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null);
  const [stripeReady, setStripeReady]   = useState(false);
  const [chargingId, setChargingId]     = useState<string | null>(null);

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  const green  = '#16a34a';
  const blue   = '#3b82f6';
  const yellow = '#f59e0b';
  const red    = '#ef4444';
  const orange = '#f97316';

  const STATUS: Record<string, { label: string; color: string; bg: string }> = {
    pending:   { label: 'Pending',    color: yellow, bg: `${yellow}18` },
    confirmed: { label: 'Confirmed',  color: C.accent, bg: `${C.accent}18` },
    in_chair:  { label: 'In Chair',   color: orange,  bg: `${orange}18` },
    completed: { label: 'Done',       color: green,   bg: `${green}15` },
    cancelled: { label: 'Cancelled',  color: C.text3, bg: `${C.text3}12` },
    no_show:   { label: 'No Show',    color: red,     bg: `${red}12` },
  };

  // ── Day swipe navigation (PanResponder) ─────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 60 && Math.abs(gs.dy) < 40,
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 60) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedDate(d => subDays(d, 1));
        } else if (gs.dx < -60) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedDate(d => addDays(d, 1));
        }
      },
    })
  ).current;

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAppointments = useCallback(async (ids: string[], date: Date, tmId?: string | null) => {
    if (!ids.length) return;
    try {
      let q = supabase
        .from('appointments')
        .select('id, client_name, client_id, start_time, end_time, status, price_charged, date, service_id, notes, team_member_id, paid, payment_method, is_walk_in, services(name)')
        .in('barber_id', ids)
        .eq('date', format(date, 'yyyy-MM-dd'))
        .order('start_time', { ascending: true });
      if (tmId) q = (q as any).eq('team_member_id', tmId);
      const { data } = await q;
      const mapped = ((data as any[]) ?? []).map((a) => ({
        ...a,
        price: a.price_charged,
        service_name: a.services?.name ?? null,
        paid: a.paid ?? false,
      }));
      setAppointments(mapped);
    } catch (err) { console.error('fetchAppointments:', err); }
    setLoading(false);
  }, []);

  // Fetch dot counts for entire visible month
  const fetchMonthDots = useCallback(async (ids: string[], month: Date, tmId?: string | null) => {
    if (!ids.length) return;
    try {
      const start = format(startOfMonth(month), 'yyyy-MM-dd');
      const end   = format(endOfMonth(month),   'yyyy-MM-dd');
      let q = supabase
        .from('appointments')
        .select('date, status')
        .in('barber_id', ids)
        .gte('date', start)
        .lte('date', end)
        .not('status', 'eq', 'cancelled');
      if (tmId) q = (q as any).eq('team_member_id', tmId);
      const { data } = await q;
      const map: Record<string, number> = {};
      for (const r of (data as any[]) ?? []) {
        map[r.date] = (map[r.date] ?? 0) + 1;
      }
      setDotMap(map);
    } catch {}
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setLoading(false); return; }
      const uid = session.user.id;
      const scope = await resolveBarberScope(uid);
      const { scopeIds: ids, ownerUid, staffMemberId: tmId, shopName: sName } = scope;

      // Fetch stripe info from owner profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, stripe_charges_enabled')
        .or(`id.eq.${ownerUid},user_id.eq.${ownerUid}`)
        .maybeSingle();

      setBarberEmail(session.user.email ?? (profile as any)?.email ?? null);
      setShopName(sName);
      setBarberId(ownerUid);
      setStaffMemberId(tmId);
      setStripeReady((profile as any)?.stripe_charges_enabled === true);
      setScopeIds(ids);
      fetchAppointments(ids, selectedDate, tmId);
      fetchMonthDots(ids, calMonth, tmId);
    });
  }, []);

  useEffect(() => { if (scopeIds.length) fetchAppointments(scopeIds, selectedDate, staffMemberId); }, [selectedDate, scopeIds]);
  useEffect(() => { if (scopeIds.length) fetchMonthDots(scopeIds, calMonth, staffMemberId); }, [calMonth, scopeIds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (scopeIds.length) {
      await Promise.all([
        fetchAppointments(scopeIds, selectedDate, staffMemberId),
        fetchMonthDots(scopeIds, calMonth, staffMemberId),
      ]);
    }
    setRefreshing(false);
  }, [scopeIds, selectedDate, calMonth, staffMemberId]);

  const addWalkIn = () => {
    Alert.prompt(
      'Add Walk-in',
      'Enter the client\'s name to add them to the queue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add to Queue',
          onPress: async (name?: string) => {
            if (!name?.trim()) return;
            const trimmed = name.trim();
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const now = new Date();
              const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
              const { error } = await supabase.from('appointments').insert({
                barber_id: scopeIds[0],
                client_name: trimmed,
                date: format(isToday(selectedDate) ? now : selectedDate, 'yyyy-MM-dd'),
                start_time: timeStr,
                end_time: timeStr,
                status: 'confirmed',
                is_walk_in: true,
                ...(staffMemberId ? { team_member_id: staffMemberId } : {}),
              });
              if (error) throw error;
              toast.success(`${trimmed} added to queue`);
              if (scopeIds.length) {
                fetchAppointments(scopeIds, selectedDate, staffMemberId);
                fetchMonthDots(scopeIds, calMonth, staffMemberId);
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to add walk-in');
            }
          },
        },
      ],
      'plain-text',
      '',
      'default',
    );
  };

  const updateStatus = async (aptId: string, newStatus: string) => {
    try {
      Haptics.impactAsync(
        newStatus === 'in_chair' ? Haptics.ImpactFeedbackStyle.Heavy :
        newStatus === 'cancelled' ? Haptics.ImpactFeedbackStyle.Medium :
        Haptics.ImpactFeedbackStyle.Medium
      );
      if (newStatus === 'completed') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await supabase.from('appointments').update({ status: newStatus }).eq('id', aptId);

      // ── Send cancellation email to client ───────────────────────────────────
      if (newStatus === 'cancelled') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        const apt = appointments.find((a) => a.id === aptId);
        if (apt?.client_id) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', apt.client_id)
            .maybeSingle();
          const clientEmail = (profileData as any)?.email;
          if (clientEmail) {
            supabase.functions.invoke('send-cancellation', {
              body: {
                to: clientEmail,
                clientName: apt.client_name,
                shopName,
                serviceName: apt.service_name,
                appointmentDate: apt.date,
                appointmentTime: apt.start_time,
                barberEmail: barberEmail ?? undefined,
                bookingLink: `https://app.kutz.io`,
              },
            }).catch(() => {});
          }
        }
      }

      if (scopeIds.length) fetchAppointments(scopeIds, selectedDate, staffMemberId);
    } catch (err: any) { Alert.alert('Error', err.message || 'Failed to update'); }
  };

  // ── POS Charge ─────────────────────────────────────────────────────────────
  const chargePOS = async (apt: any) => {
    if (!barberId) return;

    const priceNum = Number(apt.price ?? 0);
    if (!priceNum || priceNum <= 0) {
      Alert.alert('No price set', 'This appointment has no price to charge.');
      return;
    }

    if (!stripeReady) {
      Alert.alert(
        'Stripe not connected',
        'Go to Settings → Payments to connect your Stripe account before charging clients.',
      );
      return;
    }

    const displayPrice = `$${priceNum.toFixed(2)}`;
    Alert.alert(
      'Charge Client',
      `Charge ${apt.client_name} ${displayPrice} for ${apt.service_name || 'service'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Charge ${displayPrice}`,
          onPress: async () => {
            setChargingId(apt.id);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) throw new Error('Not authenticated');

              const res = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-intent`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                  appointment_id: apt.id,
                  barber_id:      barberId,
                  amount_cents:   Math.round(priceNum * 100),
                  payment_type:   'pos',
                  client_id:      apt.client_id ?? undefined,
                  description:    `${apt.service_name || 'Service'} — ${apt.client_name}`,
                }),
              });

              const result = await res.json();
              if (!res.ok || result.error) throw new Error(result.error || 'Payment failed');

              // Mark appointment as paid
              await supabase
                .from('appointments')
                .update({ paid: true })
                .eq('id', apt.id);

              // Refresh list
              if (scopeIds.length) fetchAppointments(scopeIds, selectedDate, staffMemberId);

              Alert.alert(
                '✅ Payment Created',
                `Payment link ready for ${apt.client_name}.\n\nThe charge has been recorded. Share the payment link with your client or use a card reader.`,
              );
            } catch (err: any) {
              Alert.alert('Payment Failed', err.message || 'Something went wrong');
            }
            setChargingId(null);
          },
        },
      ],
    );
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const weekStart = startOfWeek(selectedDate);
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const calStart  = swk(startOfMonth(calMonth));
  const calEnd    = ewk(endOfMonth(calMonth));
  const calDays   = eachDayOfInterval({ start: calStart, end: calEnd });

  const todayApts     = appointments.filter(a => a.status !== 'cancelled');
  const confirmedApts = appointments.filter(a => a.status === 'confirmed');
  const inChairApts   = appointments.filter(a => a.status === 'in_chair');
  const completedApts = appointments.filter(a => a.status === 'completed');
  const totalRevenue  = completedApts.reduce((s, a) => s + Number(a.price ?? 0), 0);

  if (loading) return (
    <View style={[S.loader, { backgroundColor: C.bg }]}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  // ── Swipe actions ─────────────────────────────────────────────────────────
  const renderRightAction = (apt: any, label: string, color: string, icon: React.ReactNode, onPress: () => void) => (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({ inputRange: [-80, 0], outputRange: [1, 0.6], extrapolate: 'clamp' });
    return (
      <TouchableOpacity onPress={() => { swipeableRefs.current[apt.id]?.close(); onPress(); }}
        style={[S.swipeAction, { backgroundColor: color }]} activeOpacity={0.85}>
        <Animated.View style={[S.swipeInner, { transform: [{ scale }] }]}>
          {icon}
          <Text style={S.swipeTxt}>{label}</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderLeftAction = (apt: any, label: string, color: string, icon: React.ReactNode, onPress: () => void) => (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({ inputRange: [0, 80], outputRange: [0.6, 1], extrapolate: 'clamp' });
    return (
      <TouchableOpacity onPress={() => { swipeableRefs.current[apt.id]?.close(); onPress(); }}
        style={[S.swipeAction, { backgroundColor: color }]} activeOpacity={0.85}>
        <Animated.View style={[S.swipeInner, { transform: [{ scale }] }]}>
          {icon}
          <Text style={S.swipeTxt}>{label}</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const getSwipeProps = (apt: any) => {
    const props: any = {};
    const stripeColor = '#635bff';

    if (apt.status === 'pending') {
      props.renderLeftActions = renderLeftAction(apt, 'Confirm', green, <Check color="#fff" size={22} />,
        () => updateStatus(apt.id, 'confirmed'));
      props.renderRightActions = renderRightAction(apt, 'Decline', red, <X color="#fff" size={22} />,
        () => Alert.alert('Decline', 'Decline this appointment?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Decline', style: 'destructive', onPress: () => updateStatus(apt.id, 'cancelled') },
        ]));
    } else if (apt.status === 'confirmed') {
      props.renderLeftActions = renderLeftAction(apt, 'Start', orange, <Play color="#fff" size={22} />,
        () => updateStatus(apt.id, 'in_chair'));
      props.renderRightActions = renderRightAction(apt, 'Cancel', red, <X color="#fff" size={22} />,
        () => Alert.alert('Cancel', 'Cancel this appointment?', [
          { text: 'Keep', style: 'cancel' },
          { text: 'Cancel', style: 'destructive', onPress: () => updateStatus(apt.id, 'cancelled') },
        ]));
    } else if (apt.status === 'in_chair') {
      props.renderLeftActions = renderLeftAction(apt, 'Complete', green, <CheckCircle2 color="#fff" size={22} />,
        () => updateStatus(apt.id, 'completed'));
    } else if (apt.status === 'completed' && !apt.paid && Number(apt.price) > 0) {
      props.renderLeftActions = renderLeftAction(apt, 'Charge', stripeColor, <CreditCard color="#fff" size={22} />,
        () => router.push({
          pathname: '/(barber)/charge',
          params: {
            client_name: apt.client_name ?? '',
            client_id: apt.client_id ?? '',
            appointment_id: apt.id,
            prefill_amount: apt.price ? String(Number(apt.price).toFixed(2)) : '',
          },
        }));
    }

    return props;
  };

  // ── Appointment card ───────────────────────────────────────────────────────
  const renderCard = (apt: any) => {
    const cfg      = STATUS[apt.status] ?? STATUS.confirmed;
    const aColor   = avatarColor(apt.client_name || 'C');
    const isActive = apt.status === 'in_chair';
    const isDone   = apt.status === 'completed';
    const isCancelled = apt.status === 'cancelled';
    const swipeProps = getSwipeProps(apt);
    const hasSwipe = swipeProps.renderLeftActions || swipeProps.renderRightActions;

    const card = (
      <View
        style={[S.aptCard, {
          backgroundColor: C.card,
          borderColor: isActive ? `${orange}50` : isDone ? `${green}30` : C.cardBorder,
          borderWidth: isActive ? 1.5 : 1,
          opacity: isCancelled ? 0.5 : 1,
        }]}
      >
        {/* Accent left bar */}
        <View style={[S.timeBar, { backgroundColor: cfg.color }]} />

        <View style={{ flex: 1, paddingLeft: 14, paddingRight: 4 }}>

          {/* Time + price row — top */}
          <View style={[S.timePriceRow, { marginBottom: 10 }]}>
            <View style={S.metaChip}>
              <Clock color={cfg.color} size={13} strokeWidth={2.5} />
              <Text style={[S.timeText, { color: cfg.color }]}>{fmt12(apt.start_time)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {Number(apt.price) > 0 && (
                <Text style={[S.priceText, { color: green }]}>${Number(apt.price).toFixed(0)}</Text>
              )}
              <View style={[S.badge, { backgroundColor: cfg.bg }]}>
                <Text style={[S.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            </View>
          </View>

          {/* Client + service */}
          <View style={S.aptTop}>
            <View style={[S.avatar, { backgroundColor: `${aColor}20` }]}>
              <Text style={[S.avatarTxt, { color: aColor }]}>{initials(apt.client_name || 'C')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.aptName, { color: C.text }]} numberOfLines={1}>{apt.client_name || 'Client'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                {!!apt.service_name && (
                  <View style={S.serviceRow}>
                    <Scissors color={C.text3} size={11} strokeWidth={2} />
                    <Text style={[S.aptService, { color: C.text2 }]} numberOfLines={1}>{apt.service_name}</Text>
                  </View>
                )}
                <View style={[S.typeBadge, { backgroundColor: apt.is_walk_in ? `${orange}12` : `${blue}10` }]}>
                  {apt.is_walk_in
                    ? <UserCircle2 color={orange} size={10} strokeWidth={2.5} />
                    : <Globe color={blue} size={10} strokeWidth={2.5} />}
                  <Text style={[S.typeBadgeText, { color: apt.is_walk_in ? orange : blue }]}>
                    {apt.is_walk_in ? 'Walk-in' : 'Booked'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Swipe hint */}
          {hasSwipe && !isCancelled && (
            <Text style={[S.swipeHint, { color: C.text3 }]}>
              {apt.status === 'pending' ? '← Swipe right to confirm' :
               apt.status === 'confirmed' ? '← Swipe right to start' :
               apt.status === 'in_chair' ? '← Swipe right to complete' :
               apt.status === 'completed' && !apt.paid ? '← Swipe to charge' : ''}
            </Text>
          )}

          {/* Notes */}
          {!!apt.notes && (
            <Text style={[S.aptNotes, { color: C.text3, borderColor: C.border }]} numberOfLines={1}>
              {apt.notes}
            </Text>
          )}

          {/* Actions */}
          {apt.status === 'pending' && (
            <View style={S.actions}>
              <Tap
                onPress={() => updateStatus(apt.id, 'confirmed')}
                style={[S.actionBtn, { backgroundColor: green, flex: 1 }]}>
                <Check color="#fff" size={15} strokeWidth={2.5} />
                <Text style={[S.actionTxt, { color: '#fff' }]}>Confirm</Text>
              </Tap>
              <Tap
                onPress={() => Alert.alert('Decline Booking', 'Decline this appointment?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Decline', style: 'destructive', onPress: () => updateStatus(apt.id, 'cancelled') },
                ])}
                style={[S.actionSmall, { backgroundColor: `${red}15`, borderColor: `${red}30`, borderWidth: 1 }]}>
                <X color={red} size={16} strokeWidth={2.5} />
              </Tap>
            </View>
          )}

          {apt.status === 'confirmed' && (
            <View style={S.actions}>
              <Tap
                onPress={() => updateStatus(apt.id, 'in_chair')}
                style={[S.actionBtn, { backgroundColor: orange, flex: 1 }]}>
                <Play color="#fff" size={14} strokeWidth={2.5} />
                <Text style={[S.actionTxt, { color: '#fff' }]}>Start Session</Text>
              </Tap>
              <Tap
                onPress={() => Alert.alert('Cancel Appointment', 'Cancel this appointment?', [
                  { text: 'Keep', style: 'cancel' },
                  { text: 'Cancel', style: 'destructive', onPress: () => updateStatus(apt.id, 'cancelled') },
                ])}
                style={[S.actionSmall, { backgroundColor: `${red}12`, borderColor: `${red}25`, borderWidth: 1 }]}>
                <X color={red} size={16} strokeWidth={2.5} />
              </Tap>
            </View>
          )}

          {apt.status === 'in_chair' && (() => {
            const paysAtShop = apt.payment_method === 'at_shop' || !apt.payment_method;
            const needsCharge = paysAtShop && !apt.paid;
            const stripeColor = '#635bff';
            return (
              <View style={S.actions}>
                <Tap
                  onPress={async () => {
                    await updateStatus(apt.id, 'completed');
                    if (needsCharge) {
                      router.push({
                        pathname: '/(barber)/charge',
                        params: {
                          client_name:    apt.client_name ?? '',
                          client_id:      apt.client_id ?? '',
                          appointment_id: apt.id,
                          prefill_amount: apt.price ? String(Number(apt.price).toFixed(2)) : '',
                        },
                      });
                    }
                  }}
                  style={[S.actionBtn, { backgroundColor: needsCharge ? stripeColor : green, flex: 1 }]}>
                  {needsCharge ? (
                    <>
                      <CreditCard color="#fff" size={15} strokeWidth={2.2} />
                      <Text style={[S.actionTxt, { color: '#fff' }]}>{Number(apt.price) > 0 ? `Complete & Charge $${Number(apt.price).toFixed(0)}` : 'Complete & Charge'}</Text>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 color="#fff" size={15} strokeWidth={2.2} />
                      <Text style={[S.actionTxt, { color: '#fff' }]}>Complete</Text>
                    </>
                  )}
                </Tap>
                {apt.paid && (
                  <View style={[S.actionBtn, { backgroundColor: `${green}18`, flex: 1 }]}>
                    <CheckCircle2 color={green} size={14} strokeWidth={2.2} />
                    <Text style={[S.actionTxt, { color: green }]}>Paid</Text>
                  </View>
                )}
              </View>
            );
          })()}

          {apt.status === 'completed' && (() => {
            const paysAtShop = apt.payment_method === 'at_shop' || !apt.payment_method;
            const needsCharge = paysAtShop && !apt.paid;
            if (needsCharge) return (
              <Tap
                onPress={() => router.push({
                  pathname: '/(barber)/charge',
                  params: {
                    client_name:    apt.client_name ?? '',
                    client_id:      apt.client_id ?? '',
                    appointment_id: apt.id,
                    prefill_amount: apt.price ? String(Number(apt.price).toFixed(2)) : '',
                  },
                })}
                style={[S.actionFullWide, { backgroundColor: '#635bff', marginTop: 8 }]}>
                <CreditCard color="#fff" size={16} strokeWidth={2.5} />
                <Text style={[S.actionTxt, { color: '#fff', fontSize: 14 }]}>{Number(apt.price) > 0 ? `Charge $${Number(apt.price).toFixed(0)}` : 'Charge'}</Text>
              </Tap>
            );
            if (apt.paid) return (
              <View style={[S.paidBadge, { backgroundColor: `${green}12`, borderColor: `${green}25` }]}>
                <CheckCircle2 color={green} size={13} strokeWidth={2.2} />
                <Text style={[S.paidTxt, { color: green }]}>Paid</Text>
              </View>
            );
            return null;
          })()}
        </View>
      </View>
    );

    if (!hasSwipe) return <View key={apt.id}>{card}</View>;

    return (
      <Swipeable
        key={apt.id}
        ref={ref => { swipeableRefs.current[apt.id] = ref; }}
        friction={2}
        overshootLeft={false}
        overshootRight={false}
        {...swipeProps}
      >
        {card}
      </Swipeable>
    );
  };

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* ── Header ── */}
      <View style={[S.header, { borderBottomColor: C.border }]}>
        <View>
          <Text style={[S.title, { color: C.text }]}>Schedule</Text>
          <Text style={[S.subtitle, { color: C.text3 }]}>
            {isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEE, MMM d')}
          </Text>
        </View>
        <View style={S.headerRight}>
          <Tap onPress={addWalkIn}
            style={[S.todayBtn, { backgroundColor: `${orange}12`, borderColor: `${orange}30`, flexDirection: 'row', gap: 4 }]}>
            <UserPlus color={orange} size={14} strokeWidth={2.5} />
            <Text style={[S.todayTxt, { color: orange }]}>Walk-in</Text>
          </Tap>
          <Tap onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedDate(new Date()); setCalMonth(new Date()); }}
            style={[S.todayBtn, { backgroundColor: C.bg2, borderColor: C.border }]}>
            <Text style={[S.todayTxt, { color: C.accent }]}>Today</Text>
          </Tap>
          <Tap onPress={() => setView(v => v === 'day' ? 'calendar' : 'day')}
            style={[S.viewToggle, { backgroundColor: view === 'calendar' ? C.accent : C.bg2, borderColor: view === 'calendar' ? C.accent : C.border }]}>
            <CalendarDays color={view === 'calendar' ? '#fff' : C.text2} size={18} strokeWidth={2} />
          </Tap>
        </View>
      </View>

      {view === 'day' ? (
        <View style={{ flex: 1 }} {...panResponder.panHandlers}>
          {/* ── Week strip ── */}
          <View style={[S.weekWrap, { borderBottomColor: C.border }]}>
            <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedDate(d => subDays(d, 7)); }} style={S.weekArrow}>
              <ChevronLeft color={C.text2} size={18} />
            </TouchableOpacity>
            <View style={S.weekDays}>
              {weekDays.map(day => {
                const sel = isSameDay(day, selectedDate);
                const tod = isToday(day);
                const key = format(day, 'yyyy-MM-dd');
                const hasDots = (dotMap[key] ?? 0) > 0;
                return (
                  <TouchableOpacity key={day.toISOString()} onPress={() => { Haptics.selectionAsync(); setSelectedDate(day); }}
                    style={[S.dayChip, sel && { backgroundColor: C.accent }, tod && !sel && { borderColor: C.accent, borderWidth: 1.5 }]}>
                    <Text style={[S.dayLbl, { color: sel ? '#fff' : C.text3 }, tod && !sel && { color: C.accent }]}>
                      {DAY_SHORT[day.getDay()]}
                    </Text>
                    <Text style={[S.dayNum, { color: sel ? '#fff' : C.text }, tod && !sel && { color: C.accent, fontWeight: '800' }]}>
                      {format(day, 'd')}
                    </Text>
                    {hasDots && !sel && <View style={[S.dot, { backgroundColor: C.accent }]} />}
                    {hasDots && sel && <View style={[S.dot, { backgroundColor: 'rgba(255,255,255,0.7)' }]} />}
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedDate(d => addDays(d, 7)); }} style={S.weekArrow}>
              <ChevronRight color={C.text2} size={18} />
            </TouchableOpacity>
          </View>

          {/* ── Animated Stats strip ── */}
          {todayApts.length > 0 && (
            <View style={[S.statsStrip, { borderBottomColor: C.border }]}>
              {[
                { val: todayApts.length,     lbl: 'Total',     color: C.text },
                { val: confirmedApts.length, lbl: 'Confirmed', color: C.accent },
                { val: inChairApts.length,   lbl: 'In Chair',  color: orange },
                { val: completedApts.length, lbl: 'Done',      color: green },
              ].map(({ val, lbl, color }, i, arr) => (
                <React.Fragment key={lbl}>
                  <View style={S.statItem}>
                    <AnimatedCounter value={val} style={{ fontSize: 16, color }} />
                    <Text style={[S.statLbl, { color: C.text3 }]}>{lbl}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[S.statDivider, { backgroundColor: C.border }]} />}
                </React.Fragment>
              ))}
              {totalRevenue > 0 && (
                <>
                  <View style={[S.statDivider, { backgroundColor: C.border }]} />
                  <View style={S.statItem}>
                    <AnimatedCounter value={totalRevenue} prefix="$" style={{ fontSize: 16, color: green }} />
                    <Text style={[S.statLbl, { color: C.text3 }]}>Revenue</Text>
                  </View>
                </>
              )}
            </View>
          )}

          {/* ── Appointment list ── */}
          <FlatList
            data={appointments}
            keyExtractor={a => a.id}
            contentContainerStyle={[S.listContent, { paddingBottom: tabBarClearance }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
            ListHeaderComponent={
              appointments.length > 0 ? (
                <Text style={[S.dayHeading, { color: C.text2 }]}>
                  {isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEEE, MMMM d')}
                  {' · '}{appointments.length} appointment{appointments.length !== 1 ? 's' : ''}
                </Text>
              ) : null
            }
            ListEmptyComponent={
              <View style={[S.empty, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <View style={[S.emptyIcon, { backgroundColor: C.bg2 }]}>
                  <CalendarDays color={C.text3} size={28} strokeWidth={1.5} />
                </View>
                <Text style={[S.emptyTitle, { color: C.text }]}>No appointments</Text>
                <Text style={[S.emptySub, { color: C.text3 }]}>
                  {isToday(selectedDate) ? 'Your schedule is clear today' : `Nothing booked for ${format(selectedDate, 'MMM d')}`}
                </Text>
              </View>
            }
            renderItem={({ item }) => renderCard(item)}
          />
        </View>
      ) : (
        /* ── Calendar view ── */
        <ScrollView
          contentContainerStyle={[S.calScroll, { paddingBottom: tabBarClearance }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={[S.calCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {/* Month nav */}
            <View style={S.calHeader}>
              <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setCalMonth(m => subMonths(m, 1)); }}
                style={[S.calNavBtn, { backgroundColor: C.bg2, borderColor: C.border }]}>
                <ChevronLeft color={C.text2} size={18} />
              </TouchableOpacity>
              <Text style={[S.calMonthTxt, { color: C.text }]}>{format(calMonth, 'MMMM yyyy')}</Text>
              <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setCalMonth(m => addMonths(m, 1)); }}
                style={[S.calNavBtn, { backgroundColor: C.bg2, borderColor: C.border }]}>
                <ChevronRight color={C.text2} size={18} />
              </TouchableOpacity>
            </View>
            {/* Day labels */}
            <View style={S.calDayRow}>
              {DAY_SHORT.map(d => <Text key={d} style={[S.calDayLbl, { color: C.text3 }]}>{d}</Text>)}
            </View>
            {/* Grid */}
            <View style={S.calGrid}>
              {calDays.map(day => {
                const sel  = isSameDay(day, selectedDate);
                const tod  = isToday(day);
                const inM  = isSameMonth(day, calMonth);
                const key  = format(day, 'yyyy-MM-dd');
                const cnt  = dotMap[key] ?? 0;
                return (
                  <TouchableOpacity key={day.toISOString()}
                    onPress={() => { Haptics.selectionAsync(); setSelectedDate(day); setView('day'); }}
                    style={[
                      S.calDay,
                      sel && { backgroundColor: C.accent },
                      tod && !sel && { borderColor: C.accent, borderWidth: 1.5 },
                      !inM && { opacity: 0.2 },
                    ]}
                  >
                    <Text style={[
                      S.calDayNum,
                      { color: sel ? '#fff' : C.text },
                      tod && !sel && { color: C.accent, fontWeight: '800' },
                    ]}>
                      {format(day, 'd')}
                    </Text>
                    {cnt > 0 && (
                      <View style={[S.calDot, { backgroundColor: sel ? 'rgba(255,255,255,0.8)' : C.accent }]} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Month summary */}
          <View style={[S.monthSummary, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[S.monthSummaryTitle, { color: C.text }]}>{format(calMonth, 'MMMM')} Overview</Text>
            <View style={S.monthStats}>
              {[
                { icon: Users,      val: Object.values(dotMap).reduce((a, b) => a + b, 0), lbl: 'Appointments', color: C.accent },
                { icon: TrendingUp, val: Object.keys(dotMap).length, lbl: 'Active Days', color: green },
              ].map(({ icon: Icon, val, lbl, color }) => (
                <View key={lbl} style={[S.monthStat, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <View style={[S.monthStatIcon, { backgroundColor: `${color}18` }]}>
                    <Icon color={color} size={18} strokeWidth={2} />
                  </View>
                  <AnimatedCounter value={val} style={{ fontSize: 22, color: C.text }} />
                  <Text style={[S.monthStatLbl, { color: C.text3 }]}>{lbl}</Text>
                </View>
              ))}
            </View>
          </View>

          <Tap onPress={() => setView('day')}
            style={[S.viewDayBtn, { backgroundColor: C.accent }]}>
            <CalendarDays color="#fff" size={16} strokeWidth={2} />
            <Text style={S.viewDayTxt}>View {format(selectedDate, 'MMM d')} Schedule</Text>
          </Tap>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container:   { flex: 1 },
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1 },
  title:       { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle:    { fontSize: 12, marginTop: 2, fontWeight: '500' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  todayBtn:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  todayTxt:    { fontSize: 12, fontWeight: '700' },
  viewToggle:  { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  // Week strip
  weekWrap:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, gap: 2 },
  weekArrow:   { padding: 6 },
  weekDays:    { flex: 1, flexDirection: 'row', gap: 3 },
  dayChip:     { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14, gap: 2 },
  dayLbl:      { fontSize: 10, fontWeight: '600' },
  dayNum:      { fontSize: 15, fontWeight: '700' },
  dot:         { width: 4, height: 4, borderRadius: 2, marginTop: 2 },

  // Stats strip
  statsStrip:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
  statItem:    { flex: 1, alignItems: 'center' },
  statVal:     { fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  statLbl:     { fontSize: 10, fontWeight: '600', marginTop: 1 },
  statDivider: { width: 1, height: 28, marginHorizontal: 4 },

  // List
  listContent: { paddingHorizontal: 16, paddingTop: 10 },
  dayHeading:  { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginBottom: 12, textTransform: 'uppercase' },

  // Empty
  empty:      { alignItems: 'center', paddingVertical: 52, borderRadius: 24, borderWidth: 1, gap: 10, marginTop: 8 },
  emptyIcon:  { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptySub:   { fontSize: 13 },

  // Appointment card
  aptCard:      { borderRadius: 20, marginBottom: 12, flexDirection: 'row', overflow: 'hidden', paddingVertical: 16, paddingRight: 16 },
  timeBar:      { width: 4, borderRadius: 4, marginVertical: 2, marginLeft: 3 },
  timePriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeText:     { fontSize: 13, fontWeight: '700', letterSpacing: -0.2 },
  priceText:    { fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
  aptTop:       { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatar:       { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarTxt:    { fontSize: 15, fontWeight: '800' },
  aptName:      { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  serviceRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aptService:   { fontSize: 12, fontWeight: '500' },
  typeBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText:{ fontSize: 10, fontWeight: '700' },
  badge:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeTxt:     { fontSize: 11, fontWeight: '700' },
  metaChip:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaTxt:      { fontSize: 12, fontWeight: '600' },
  aptNotes:     { fontSize: 11, paddingTop: 8, marginTop: 4, borderTopWidth: 1, paddingBottom: 2, fontStyle: 'italic' },
  swipeHint:    { fontSize: 10, fontWeight: '500', marginTop: 2, fontStyle: 'italic' },

  // Actions
  actions:        { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 14 },
  actionSmall:    { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  actionFullWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, marginTop: 12 },
  actionTxt:      { fontSize: 14, fontWeight: '800' },

  // Swipe actions
  swipeAction: { width: 80, justifyContent: 'center', alignItems: 'center', borderRadius: 20, marginBottom: 12 },
  swipeInner:  { alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeTxt:    { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Calendar
  calScroll:    { paddingHorizontal: 16, paddingTop: 16 },
  calCard:      { borderRadius: 24, padding: 20, borderWidth: 1, marginBottom: 14 },
  calHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  calNavBtn:    { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  calMonthTxt:  { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  calDayRow:    { flexDirection: 'row', marginBottom: 10 },
  calDayLbl:    { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700' },
  calGrid:      { flexDirection: 'row', flexWrap: 'wrap' },
  calDay:       { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 100 },
  calDayNum:    { fontSize: 14, fontWeight: '500' },
  calDot:       { width: 4, height: 4, borderRadius: 2, marginTop: 1 },

  // Month summary
  monthSummary:     { borderRadius: 20, padding: 18, borderWidth: 1, marginBottom: 14 },
  monthSummaryTitle:{ fontSize: 15, fontWeight: '800', marginBottom: 14, letterSpacing: -0.2 },
  monthStats:       { flexDirection: 'row', gap: 10 },
  monthStat:        { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, alignItems: 'center', gap: 6 },
  monthStatIcon:    { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  monthStatVal:     { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  monthStatLbl:     { fontSize: 11, fontWeight: '600' },

  viewDayBtn:  { borderRadius: 16, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  viewDayTxt:  { color: '#fff', fontWeight: '800', fontSize: 15 },

  // Paid badge
  paidBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1, marginTop: 8, alignSelf: 'flex-start' },
  paidTxt:     { fontSize: 12, fontWeight: '700' },
});
