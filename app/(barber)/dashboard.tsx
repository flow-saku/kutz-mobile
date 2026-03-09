import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Animated, StyleSheet, StatusBar, Pressable,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Scissors, DollarSign, Users, CalendarCheck, Clock,
  ChevronRight, TrendingUp, Check, X, AlertCircle, MessageCircle, CreditCard,
  Smartphone, Globe, CheckCircle2, Timer, UserCircle2, Flame, Target,
  Play, Bell, User,
} from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { resolveBarberScope } from '@/lib/barber';
import { useTheme } from '@/lib/theme';
import { format, startOfWeek, subDays, addDays, isToday, isSameDay } from 'date-fns';
import * as Haptics from 'expo-haptics';
import AnimatedCounter from '@/components/ui/AnimatedCounter';
import ConfettiPop from '@/components/ui/ConfettiPop';
import ProgressRing from '@/components/ui/ProgressRing';
import { useToast } from '@/lib/toast';

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt12(t: string) {
  try {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}
function initials(name: string) {
  return name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
}
const AVATAR_COLORS = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#db2777'];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function elapsedSince(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const mins = (now.getHours() * 60 + now.getMinutes()) - (h * 60 + m);
    if (mins < 1) return 'Just started';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  } catch { return ''; }
}

const TAB_BAR_HEIGHT = 68;
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const green = '#16a34a', blue = '#2563eb', yellow = '#d97706', red = '#dc2626', orange = '#f97316';
const stripeColor = '#635bff';

// ── Pressable with spring ───────────────────────────────────────────────────
function Tap({ onPress, style, children, disabled = false }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, tension: 500, friction: 28 }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 400, friction: 26 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ── Big CTA Button with spring ──────────────────────────────────────────────
function BigCTA({ onPress, label, sub, color, icon, disabled = false }: {
  onPress: () => void; label: string; sub?: string; color: string;
  icon: React.ReactNode; disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 400, friction: 20 }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 14 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[S.bigCTA, { backgroundColor: color, transform: [{ scale }] }]}>
        <View style={{ flex: 1 }}>
          <Text style={S.bigCTALabel}>{label}</Text>
          {sub && <Text style={S.bigCTASub}>{sub}</Text>}
        </View>
        <View style={S.bigCTAIcon}>{icon}</View>
      </Animated.View>
    </Pressable>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function BarberDashboard() {
  const { C, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 16;

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [scopeIds, setScopeIds]           = useState<string[]>([]);
  const [primaryId, setPrimaryId]         = useState<string | null>(null);
  const [shopName, setShopName]           = useState('My Shop');
  const [isOwner, setIsOwner]             = useState(false);
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null);
  const [todayApts, setTodayApts]         = useState<any[]>([]);
  const [staffMap, setStaffMap]           = useState<Record<string, string>>({});
  const [pendingCount, setPendingCount]   = useState(0);
  const [todayRevenue, setTodayRevenue]   = useState(0);
  const [weekRevenue, setWeekRevenue]     = useState(0);
  const [totalClients, setTotalClients]   = useState(0);
  const [updatingId, setUpdatingId]       = useState<string | null>(null);
  const [dailyGoal, setDailyGoal]         = useState<number | null>(null);
  const [dayStreak, setDayStreak]         = useState(0);
  const [timerTick, setTimerTick]         = useState(0);
  const [weekActivity, setWeekActivity]   = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);

  // Celebration overlay
  const [celebration, setCelebration] = useState<{ name: string; amount: number } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const celebScale = useRef(new Animated.Value(0)).current;
  const celebOpacity = useRef(new Animated.Value(0)).current;

  // Milestone tracking
  const prevRevRef = useRef(0);
  const prevCompletedRef = useRef(0);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;
  const scopeRef  = useRef<string[]>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Session start animation
  const sessionStartScale = useRef(new Animated.Value(1)).current;
  const sessionStartGlow = useRef(new Animated.Value(0)).current;

  // In-chair pulsing dot
  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Live timer tick (every 30s)
  useEffect(() => {
    const iv = setInterval(() => setTimerTick(t => t + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  function animateIn() {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 200, friction: 13, useNativeDriver: true }),
    ]).start();
  }

  // ── Data Fetching ──────────────────────────────────────────────────────────
  async function loadStaffNames(ownerUid: string) {
    try {
      const { data } = await supabase.rpc('get_all_shop_staff', { p_barber_id: ownerUid });
      const map: Record<string, string> = {};
      for (const tm of ((data as any[]) ?? [])) {
        if (tm.id) map[tm.id] = tm.display_name ?? tm.name ?? 'Unknown';
      }
      if (!map[ownerUid]) {
        const { data: p } = await supabase.from('profiles')
          .select('display_name, shop_name').eq('id', ownerUid).maybeSingle();
        map[ownerUid] = (p as any)?.display_name || 'Owner';
      }
      setStaffMap(map);
    } catch { /* non-critical */ }
  }

  async function fetchStreak(ids: string[], tmId?: string | null) {
    try {
      let streak = 0;
      for (let d = 1; d <= 30; d++) {
        const dateStr = format(subDays(new Date(), d), 'yyyy-MM-dd');
        let q = supabase.from('appointments')
          .select('id', { count: 'exact', head: true })
          .in('barber_id', ids).eq('date', dateStr).eq('status', 'completed');
        if (tmId) q = q.eq('team_member_id', tmId) as any;
        const { count } = await q;
        if ((count ?? 0) > 0) streak++;
        else break;
      }
      setDayStreak(streak);
    } catch { /* non-critical */ }
  }

  async function fetchWeekActivity(ids: string[], tmId?: string | null) {
    try {
      const now = new Date();
      const ws = startOfWeek(now);
      const counts: number[] = [];
      for (let i = 0; i < 7; i++) {
        const dateStr = format(addDays(ws, i), 'yyyy-MM-dd');
        let q = supabase.from('appointments')
          .select('id', { count: 'exact', head: true })
          .in('barber_id', ids).eq('date', dateStr)
          .not('status', 'eq', 'cancelled');
        if (tmId) q = q.eq('team_member_id', tmId) as any;
        const { count } = await q;
        counts.push(count ?? 0);
      }
      setWeekActivity(counts);
    } catch { /* non-critical */ }
  }

  async function fetchData(ids: string[], uid: string, tmId?: string | null) {
    try {
      const now = new Date();
      const today = format(now, 'yyyy-MM-dd');
      const weekStartStr = format(startOfWeek(now), 'yyyy-MM-dd');

      const profileRes = await supabase.from('profiles').select('display_name, shop_name')
        .or(`id.eq.${uid},user_id.eq.${uid}`).limit(1).maybeSingle();

      let todayQ = supabase.from('appointments')
        .select('id, client_name, client_id, start_time, end_time, status, price_charged, date, service_id, notes, team_member_id, paid, payment_id, payment_method, is_walk_in, services(name)')
        .in('barber_id', ids).eq('date', today).order('start_time', { ascending: true });
      if (tmId) todayQ = (todayQ as any).eq('team_member_id', tmId);
      const todayRes = await todayQ;

      let weekQ = supabase.from('appointments')
        .select('price_charged')
        .in('barber_id', ids).eq('status', 'completed').gte('date', weekStartStr);
      if (tmId) weekQ = (weekQ as any).eq('team_member_id', tmId);
      const weekRes = await weekQ;

      const clientCountRes = await supabase.from('clients')
        .select('*', { count: 'exact', head: true }).in('barber_id', ids);

      setShopName((profileRes.data as any)?.shop_name || (profileRes.data as any)?.display_name || 'My Shop');

      const rawApts = (todayRes.data as any[]) ?? [];
      const paymentIds = rawApts.map(a => a.payment_id).filter(Boolean);
      let paymentMap: Record<string, string> = {};
      if (paymentIds.length > 0) {
        const { data: payments } = await supabase
          .from('payments').select('id, payment_type').in('id', paymentIds);
        for (const p of (payments ?? [])) paymentMap[p.id] = p.payment_type;
      }

      const apts = rawApts.map((a) => ({
        ...a,
        price: a.price_charged,
        service_name: a.services?.name ?? null,
        payment_type: a.payment_id ? (paymentMap[a.payment_id] || 'online') : null,
      }));

      const newRevenue = apts.filter((a: any) => a.status === 'completed').reduce((s: number, a: any) => s + (a.price || 0), 0);
      const newCompleted = apts.filter((a: any) => a.status === 'completed').length;

      // Milestone checks
      const prev = prevRevRef.current;
      const prevC = prevCompletedRef.current;
      if (prev > 0) {
        if (newRevenue >= 100 && prev < 100)  { toast.success('$100 day! 💪');  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
        if (newRevenue >= 500 && prev < 500)  { toast.success('$500 day! 🔥');  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
        if (newRevenue >= 1000 && prev < 1000){ toast.success('$1,000 day! 👑'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
        if (newCompleted >= 5 && prevC < 5)   { toast.success('5 clients served!'); }
        if (newCompleted >= 10 && prevC < 10) { toast.success('10 clients! Machine mode'); }
      }
      prevRevRef.current = newRevenue;
      prevCompletedRef.current = newCompleted;

      setTodayApts(apts);
      setPendingCount(apts.filter((a: any) => a.status === 'pending').length);
      setTodayRevenue(newRevenue);
      setWeekRevenue(((weekRes.data as any[]) ?? []).reduce((s, a) => s + (a.price_charged || 0), 0));
      setTotalClients(clientCountRes.count ?? 0);
    } catch (err) { console.error('Dashboard fetchData error:', err); }
  }

  async function fetchDailyGoal(ownerUid: string, tmId?: string | null, isStaff?: boolean) {
    try {
      if (isStaff && tmId) {
        const { data } = await supabase.from('team_members')
          .select('daily_revenue_goal').eq('id', tmId).maybeSingle();
        if ((data as any)?.daily_revenue_goal) setDailyGoal(Number((data as any).daily_revenue_goal));
      } else {
        const { data } = await supabase.from('profiles')
          .select('monthly_revenue_goal')
          .or(`id.eq.${ownerUid},user_id.eq.${ownerUid}`).maybeSingle();
        const monthly = (data as any)?.monthly_revenue_goal;
        if (monthly && Number(monthly) > 0) setDailyGoal(Math.round(Number(monthly) / 22));
      }
    } catch { /* non-critical */ }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); router.replace('/(auth)/login'); return; }
      const uid = session.user.id;
      const scope = await resolveBarberScope(uid);
      const { scopeIds: ids, ownerUid, staffMemberId: tmId, shopName: sName, isStaff } = scope;

      setPrimaryId(uid);
      setScopeIds(ids);
      setStaffMemberId(tmId);
      scopeRef.current = ids;
      setShopName(sName);
      setIsOwner(!isStaff);

      await fetchData(ids, ownerUid, tmId);
      loadStaffNames(ownerUid);
      fetchDailyGoal(ownerUid, tmId, isStaff);
      fetchStreak(ids, tmId);
      fetchWeekActivity(ids, tmId);

      setLoading(false);
      animateIn();
    })();
  }, []);

  // ── Real-time ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scopeIds.length) return;
    const ch = supabase.channel('barber_dash_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments',
        filter: `barber_id=eq.${scopeIds[0]}` },
        (payload: any) => {
          if (!scopeRef.current.length) return;
          if (payload.eventType === 'INSERT' && payload.new?.status === 'pending') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Notifications.setBadgeCountAsync(1).catch(() => {});
          }
          fetchData(scopeRef.current, scopeIds[0], staffMemberId);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [scopeIds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (scopeRef.current.length && primaryId) {
      await fetchData(scopeRef.current, primaryId, staffMemberId);
      fetchWeekActivity(scopeRef.current, staffMemberId);
    }
    setRefreshing(false);
  }, [primaryId, staffMemberId]);

  // ── Add Walk-in to Queue ──────────────────────────────────────────────────
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
                date: format(now, 'yyyy-MM-dd'),
                start_time: timeStr,
                end_time: timeStr,
                status: 'confirmed',
                is_walk_in: true,
                ...(staffMemberId ? { team_member_id: staffMemberId } : {}),
              });
              if (error) throw error;
              toast.success(`${trimmed} added to queue`);
              if (scopeRef.current.length && primaryId) {
                await fetchData(scopeRef.current, primaryId, staffMemberId);
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

  // ── Status Update with Celebrations ────────────────────────────────────────
  const updateStatus = async (aptId: string, newStatus: string) => {
    setUpdatingId(aptId);
    try {
      if (newStatus === 'confirmed') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (newStatus === 'in_chair') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        // Session start animation
        Animated.sequence([
          Animated.spring(sessionStartScale, { toValue: 1.03, tension: 500, friction: 10, useNativeDriver: true }),
          Animated.spring(sessionStartScale, { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }),
        ]).start();
      }
      else if (newStatus === 'completed') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else if (newStatus === 'cancelled') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      const { error } = await supabase.from('appointments').update({ status: newStatus }).eq('id', aptId);
      if (error) throw error;

      if (newStatus === 'completed') {
        const apt = todayApts.find(a => a.id === aptId);
        if (apt) fireCelebration(apt.client_name || 'Client', Number(apt.price) || 0);
      }

      if (scopeRef.current.length && primaryId) await fetchData(scopeRef.current, primaryId, staffMemberId);
    } catch (err: any) { Alert.alert('Error', err.message || 'Failed to update'); }
    setUpdatingId(null);
  };

  // ── Celebration Overlay ────────────────────────────────────────────────────
  const fireCelebration = (name: string, amount: number) => {
    setCelebration({ name, amount });
    setShowConfetti(false);
    celebScale.setValue(0);
    celebOpacity.setValue(0);

    Animated.parallel([
      Animated.spring(celebScale, { toValue: 1, tension: 180, friction: 10, useNativeDriver: true }),
      Animated.timing(celebOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => setShowConfetti(true), 100);
    });

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(celebOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(celebScale, { toValue: 0.8, duration: 300, useNativeDriver: true }),
      ]).start(() => { setCelebration(null); setShowConfetti(false); });
    }, 2500);
  };

  const dismissCelebration = () => {
    Animated.parallel([
      Animated.timing(celebOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(celebScale, { toValue: 0.8, duration: 200, useNativeDriver: true }),
    ]).start(() => { setCelebration(null); setShowConfetti(false); });
  };

  // ── Swipe Actions ──────────────────────────────────────────────────────────
  const renderSwipeRight = (status: string, aptId: string) => {
    const configs: Record<string, { bg: string; label: string; newStatus: string }> = {
      pending:   { bg: green,  label: 'Confirm',  newStatus: 'confirmed' },
      confirmed: { bg: orange, label: 'Start',    newStatus: 'in_chair' },
      in_chair:  { bg: green,  label: 'Complete', newStatus: 'completed' },
    };
    const cfg = configs[status];
    if (!cfg) return undefined;
    return () => (
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); updateStatus(aptId, cfg.newStatus); }}
        style={[S.swipeAction, { backgroundColor: cfg.bg }]} activeOpacity={0.85}>
        <Text style={S.swipeActionText}>{cfg.label}</Text>
      </TouchableOpacity>
    );
  };

  const renderSwipeLeft = (status: string, aptId: string) => {
    if (status !== 'pending' && status !== 'confirmed') return undefined;
    const label = status === 'pending' ? 'Decline' : 'Cancel';
    return () => (
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Alert.alert(label, `${label} this appointment?`, [
            { text: 'Keep', style: 'cancel' },
            { text: label, style: 'destructive', onPress: () => updateStatus(aptId, 'cancelled') },
          ]);
        }}
        style={[S.swipeAction, { backgroundColor: red }]} activeOpacity={0.85}>
        <Text style={S.swipeActionText}>{label}</Text>
      </TouchableOpacity>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <View style={[S.loader, { backgroundColor: C.bg }]}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  const completedToday = todayApts.filter(a => a.status === 'completed').length;
  const inChairApts    = todayApts.filter(a => a.status === 'in_chair');
  const confirmedApts  = todayApts.filter(a => a.status === 'confirmed');
  const pendingApts    = todayApts.filter(a => a.status === 'pending');
  const goalPct = dailyGoal && dailyGoal > 0 ? Math.min((todayRevenue / dailyGoal) * 100, 100) : 0;
  const goalReached = dailyGoal ? todayRevenue >= dailyGoal : false;

  // Next actionable appointment
  const nextUp = inChairApts[0] || confirmedApts[0] || pendingApts[0] || null;

  // Week strip dates
  const now = new Date();
  const ws = startOfWeek(now);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const maxActivity = Math.max(...weekActivity, 1);

  const renderAppointment = (apt: any) => {
    const isActive = apt.status === 'in_chair';
    const isDone   = apt.status === 'completed';
    const isCancel = apt.status === 'cancelled';
    const aColor   = avatarColor(apt.client_name || 'C');
    const isUpdating = updatingId === apt.id;
    const isPOS    = apt.payment_type === 'pos';
    const isOnline = apt.payment_type === 'online';
    const assignedStaffName = apt.team_member_id ? (staffMap[apt.team_member_id] ?? null) : null;

    const statusColor = isActive ? orange : isDone ? green : apt.status === 'pending' ? yellow : C.text3;

    const card = (
      <View style={[S.aptCard, {
        backgroundColor: C.card,
        borderColor: isActive ? `${orange}40` : isDone ? `${green}25` : C.cardBorder,
      }]}>
        {/* Time + Status row */}
        <View style={S.aptHeader}>
          <View style={S.aptTimeRow}>
            <View style={[S.timeDot, { backgroundColor: statusColor }]} />
            <Text style={[S.aptTime, { color: C.text2 }]}>{fmt12(apt.start_time)}</Text>
            {isActive && (
              <View style={[S.liveChip, { backgroundColor: `${orange}15` }]}>
                <Animated.View style={[S.liveDotSmall, { backgroundColor: orange, opacity: pulseAnim }]} />
                <Text style={[S.liveText, { color: orange }]}>{elapsedSince(apt.start_time)}</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {apt.price > 0 && <Text style={[S.aptPrice, { color: green }]}>${apt.price}</Text>}
            {apt.paid && (
              <View style={[S.paidChip, { backgroundColor: `${green}12` }]}>
                <CheckCircle2 color={green} size={10} />
                <Text style={[S.paidChipText, { color: green }]}>Paid</Text>
              </View>
            )}
          </View>
        </View>

        {/* Client */}
        <View style={S.aptClient}>
          <View style={[S.aptAvatar, { backgroundColor: `${aColor}15` }]}>
            <Text style={[S.aptAvatarTxt, { color: aColor }]}>{initials(apt.client_name || 'C')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[S.aptName, { color: C.text }]} numberOfLines={1}>{apt.client_name || 'Client'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              {!!apt.service_name && (
                <Text style={[S.aptMeta, { color: C.text3 }]}>{apt.service_name}</Text>
              )}
              {!!assignedStaffName && (
                <Text style={[S.aptMeta, { color: C.accent }]}>{assignedStaffName}</Text>
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

        {/* Actions */}
        {isUpdating ? (
          <View style={{ paddingVertical: 6, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={C.accent} />
          </View>
        ) : (
          <>
            {apt.status === 'pending' && (
              <View style={S.aptActions}>
                <Tap onPress={() => updateStatus(apt.id, 'confirmed')}
                  style={[S.aptBtn, { backgroundColor: green, flex: 1 }]}>
                  <Check color="#fff" size={14} strokeWidth={2.5} />
                  <Text style={S.aptBtnTxt}>Confirm</Text>
                </Tap>
                <Tap onPress={() => Alert.alert('Decline', 'Decline this booking?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Decline', style: 'destructive', onPress: () => updateStatus(apt.id, 'cancelled') },
                ])}
                  style={[S.aptBtnSmall, { backgroundColor: `${red}10`, borderColor: `${red}25` }]}>
                  <X color={red} size={15} />
                </Tap>
              </View>
            )}

            {apt.status === 'confirmed' && (
              <View style={S.aptActions}>
                <Tap onPress={() => updateStatus(apt.id, 'in_chair')}
                  style={[S.aptBtn, { backgroundColor: C.accent, flex: 1 }]}>
                  <Play color="#fff" size={13} strokeWidth={2.5} />
                  <Text style={S.aptBtnTxt}>Start Session</Text>
                </Tap>
              </View>
            )}

            {apt.status === 'in_chair' && (() => {
              const paysAtShop = apt.payment_method === 'at_shop' || !apt.payment_method;
              const needsCharge = paysAtShop && !apt.paid;
              return (
                <View style={S.aptActions}>
                  <Tap onPress={async () => {
                    await updateStatus(apt.id, 'completed');
                    if (needsCharge) {
                      router.push({
                        pathname: '/(barber)/charge',
                        params: { client_name: apt.client_name, client_id: apt.client_id || '', appointment_id: apt.id, prefill_amount: String(apt.price) },
                      });
                    }
                  }} style={[S.aptBtn, { backgroundColor: needsCharge ? stripeColor : green, flex: 1 }]}>
                    {needsCharge
                      ? <><CreditCard color="#fff" size={14} /><Text style={S.aptBtnTxt}>{Number(apt.price) > 0 ? `Complete & Charge $${apt.price}` : 'Complete & Charge'}</Text></>
                      : <><CheckCircle2 color="#fff" size={14} /><Text style={S.aptBtnTxt}>Complete</Text></>}
                  </Tap>
                </View>
              );
            })()}

            {apt.status === 'completed' && !apt.paid && (() => {
              const paysAtShop = apt.payment_method === 'at_shop' || !apt.payment_method;
              if (!paysAtShop) return null;
              return (
                <Tap onPress={() => router.push({
                  pathname: '/(barber)/charge',
                  params: { client_name: apt.client_name ?? '', client_id: apt.client_id ?? '', appointment_id: apt.id, prefill_amount: String(Number(apt.price).toFixed(2)) },
                })} style={[S.aptBtn, { backgroundColor: stripeColor, marginTop: 4 }]}>
                  <CreditCard color="#fff" size={14} />
                  <Text style={S.aptBtnTxt}>{Number(apt.price) > 0 ? `Charge $${apt.price}` : 'Charge'}</Text>
                </Tap>
              );
            })()}
          </>
        )}
      </View>
    );

    if (['pending', 'confirmed', 'in_chair'].includes(apt.status)) {
      return (
        <Swipeable key={apt.id}
          renderLeftActions={renderSwipeRight(apt.status, apt.id)}
          renderRightActions={renderSwipeLeft(apt.status, apt.id)}
          overshootLeft={false} overshootRight={false} friction={2}>
          {card}
        </Swipeable>
      );
    }

    return <View key={apt.id}>{card}</View>;
  };

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* ── Header ── */}
      <Animated.View style={[S.header, { opacity: fadeAnim }]}>
        <View style={{ flex: 1 }}>
          <Text style={[S.brandName, { color: C.text }]}>kutz</Text>
        </View>
        {dayStreak >= 2 && (
          <View style={[S.streakPill, { backgroundColor: `${orange}12` }]}>
            <Flame color={orange} size={13} />
            <Text style={[S.streakNum, { color: orange }]}>{dayStreak}</Text>
          </View>
        )}
        <Tap onPress={() => router.push('/(barber)/settings')}
          style={[S.headerIcon, { backgroundColor: C.bg2 }]}>
          <User color={C.text2} size={18} />
        </Tap>
      </Animated.View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[S.scroll, { paddingBottom: tabBarClearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── Daily Goal Card ── */}
          {dailyGoal && dailyGoal > 0 && (
            <View style={[S.goalCard, { backgroundColor: C.card, borderColor: goalReached ? `${green}35` : C.cardBorder }]}>
              <View style={S.goalTop}>
                <ProgressRing
                  percent={goalPct} size={52} strokeWidth={5}
                  color={goalReached ? green : C.accent}
                  trackColor={C.border}
                >
                  <Target color={goalReached ? green : C.accent} size={16} />
                </ProgressRing>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[S.goalLabel, { color: C.text3 }]}>Daily Goal</Text>
                  <Text style={[S.goalAmount, { color: C.text }]}>
                    ${todayRevenue.toFixed(0)} <Text style={{ color: C.text3, fontWeight: '500', fontSize: 14 }}>/ ${dailyGoal}</Text>
                  </Text>
                </View>
                {goalReached && <ConfettiPop trigger={goalReached} count={8} />}
              </View>
              <Text style={[S.goalMotivation, { color: goalReached ? green : C.text2 }]}>
                {goalReached ? 'Goal smashed!' :
                 goalPct >= 75 ? 'Almost there, keep going' :
                 goalPct >= 50 ? 'Over halfway' :
                 goalPct >= 25 ? 'Building momentum' : 'Make it official'}
              </Text>
            </View>
          )}

          {/* ── This Week Strip ── */}
          <View style={[S.weekCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={S.weekHeader}>
              <Text style={[S.weekTitle, { color: C.text }]}>This Week</Text>
              <Tap onPress={() => router.push('/(barber)/appointments')} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={[S.weekMore, { color: C.text3 }]}>{format(now, 'MMM yyyy')}</Text>
                <CalendarCheck color={C.text3} size={14} />
              </Tap>
            </View>

            {/* Date strip */}
            <View style={S.dateStrip}>
              {weekDates.map((d, i) => {
                const tod = isToday(d);
                const count = weekActivity[i];
                const hasApts = count > 0;
                return (
                  <TouchableOpacity
                    key={i}
                    style={S.dateCol}
                    onPress={() => router.push('/(barber)/appointments')}
                    activeOpacity={0.7}
                  >
                    <Text style={[S.dayLabel, { color: tod ? C.accent : C.text3 }]}>{DAY_SHORT[i]}</Text>
                    <View style={[
                      S.dateCircle,
                      tod && { backgroundColor: C.accent },
                      !tod && hasApts && { backgroundColor: `${C.accent}10` },
                    ]}>
                      <Text style={[S.dateNum, {
                        color: tod ? '#fff' : hasApts ? C.accent : C.text,
                        fontWeight: hasApts || tod ? '800' : '600',
                      }]}>{format(d, 'd')}</Text>
                    </View>
                    <View style={[S.countPill, {
                      backgroundColor: hasApts ? (tod ? C.accent : `${C.accent}12`) : 'transparent',
                    }]}>
                      <Text style={[S.countText, {
                        color: hasApts ? (tod ? '#fff' : C.accent) : C.text3,
                        fontWeight: hasApts ? '800' : '400',
                      }]}>{hasApts ? count : '—'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[S.sessionCount, { color: C.text3 }]}>
              {weekActivity.reduce((a, b) => a + b, 0)} appointments this week
            </Text>
          </View>

          {/* ── Next Up / CTA Section ── */}
          {inChairApts.length > 0 ? (
            /* Currently in session — with complete actions */
            <View style={[S.inSessionCard, { backgroundColor: `${orange}08`, borderColor: `${orange}30` }]}>
              <View style={S.inSessionTop}>
                <Animated.View style={[S.inSessionDot, { backgroundColor: orange, opacity: pulseAnim }]} />
                <Text style={[S.inSessionLabel, { color: orange }]}>In Session</Text>
              </View>
              {inChairApts.map(apt => {
                const paysAtShop = apt.payment_method === 'at_shop' || !apt.payment_method;
                const needsCharge = paysAtShop && !apt.paid;
                return (
                  <View key={apt.id}>
                    <View style={S.inSessionRow}>
                      <View style={[S.inSessionAvatar, { backgroundColor: `${avatarColor(apt.client_name)}15` }]}>
                        <Text style={[S.inSessionAvatarTxt, { color: avatarColor(apt.client_name) }]}>
                          {initials(apt.client_name || 'C')}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.inSessionName, { color: C.text }]}>{apt.client_name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
                          <Text style={[S.inSessionMeta, { color: C.text3 }]}>{apt.service_name || 'Service'}</Text>
                          <View style={[S.typeBadge, { backgroundColor: apt.is_walk_in ? `${orange}12` : `${blue}10` }]}>
                            <Text style={[S.typeBadgeText, { color: apt.is_walk_in ? orange : blue }]}>
                              {apt.is_walk_in ? 'Walk-in' : 'Booked'}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[S.inSessionTimer, { color: orange }]}>{elapsedSince(apt.start_time)}</Text>
                        {apt.price > 0 && <Text style={[S.inSessionPrice, { color: C.text2 }]}>${apt.price}</Text>}
                      </View>
                    </View>
                    {/* Complete / Complete & Charge button */}
                    <Tap
                      disabled={updatingId === apt.id}
                      onPress={async () => {
                        await updateStatus(apt.id, 'completed');
                        if (needsCharge) {
                          router.push({
                            pathname: '/(barber)/charge',
                            params: { client_name: apt.client_name, client_id: apt.client_id || '', appointment_id: apt.id, prefill_amount: String(apt.price) },
                          });
                        }
                      }}
                      style={[S.inSessionBtn, { backgroundColor: needsCharge ? stripeColor : green }]}
                    >
                      {updatingId === apt.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : needsCharge ? (
                        <>
                          <CreditCard color="#fff" size={15} />
                          <Text style={S.inSessionBtnTxt}>{Number(apt.price) > 0 ? `Complete & Charge $${apt.price}` : 'Complete & Charge'}</Text>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 color="#fff" size={15} />
                          <Text style={S.inSessionBtnTxt}>Complete Session</Text>
                        </>
                      )}
                    </Tap>
                  </View>
                );
              })}
            </View>
          ) : nextUp ? (
            /* Ready to start */
            <View style={S.readySection}>
              <Text style={[S.readyTitle, { color: C.text }]}>
                {nextUp.status === 'pending' ? 'New request' : 'Ready to cut?'}
              </Text>
              <Text style={[S.readySub, { color: C.text3 }]}>
                {nextUp.client_name} — {fmt12(nextUp.start_time)}
                {nextUp.service_name ? ` · ${nextUp.service_name}` : ''}
              </Text>
              {nextUp.status === 'confirmed' ? (
                <BigCTA
                  onPress={() => updateStatus(nextUp.id, 'in_chair')}
                  label="Start Session"
                  sub={`${nextUp.client_name} is waiting`}
                  color={C.accent}
                  icon={<Play color="#fff" size={24} strokeWidth={2.5} />}
                />
              ) : nextUp.status === 'pending' ? (
                <BigCTA
                  onPress={() => updateStatus(nextUp.id, 'confirmed')}
                  label="Confirm Booking"
                  sub={`${nextUp.client_name} · ${fmt12(nextUp.start_time)}`}
                  color={green}
                  icon={<Check color="#fff" size={24} strokeWidth={2.5} />}
                />
              ) : null}
            </View>
          ) : (
            /* No appointments */
            <View style={S.readySection}>
              <Text style={[S.readyTitle, { color: C.text }]}>Ready to build?</Text>
              <Text style={[S.readySub, { color: C.text3 }]}>Add a walk-in or charge a client</Text>
              <BigCTA
                onPress={addWalkIn}
                label="Add Walk-in"
                sub="Add to today's queue"
                color={orange}
                icon={<UserCircle2 color="#fff" size={24} />}
              />
              <View style={{ height: 8 }} />
              <Tap onPress={() => router.push('/(barber)/charge')}
                style={[S.chargeLink, { borderColor: C.cardBorder }]}>
                <CreditCard color={C.text2} size={16} />
                <Text style={[S.chargeLinkText, { color: C.text2 }]}>Charge walk-in directly</Text>
                <ChevronRight color={C.text3} size={14} />
              </Tap>
            </View>
          )}

          {/* Quick actions when appointments exist */}
          {todayApts.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              <Tap onPress={addWalkIn}
                style={[S.chargeLink, { borderColor: C.cardBorder, flex: 1 }]}>
                <UserCircle2 color={orange} size={16} />
                <Text style={[S.chargeLinkText, { color: C.text2 }]}>Add walk-in</Text>
              </Tap>
              <Tap onPress={() => router.push('/(barber)/charge')}
                style={[S.chargeLink, { borderColor: C.cardBorder, flex: 1 }]}>
                <CreditCard color={C.text2} size={16} />
                <Text style={[S.chargeLinkText, { color: C.text2 }]}>Charge</Text>
              </Tap>
            </View>
          )}

          {/* Pending banner */}
          {pendingCount > 1 && (
            <Tap onPress={() => router.push('/(barber)/appointments')}
              style={[S.pendingBanner, { backgroundColor: `${yellow}10`, borderColor: `${yellow}30` }]}>
              <View style={[S.pendingIcon, { backgroundColor: `${yellow}18` }]}>
                <AlertCircle color={yellow} size={18} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.pendingTitle, { color: C.text }]}>{pendingCount} Pending Requests</Text>
                <Text style={[S.pendingSub, { color: C.text3 }]}>Tap to review</Text>
              </View>
              <ChevronRight color={yellow} size={16} />
            </Tap>
          )}

          {/* ── Stats Widgets ── */}
          <View style={S.statsGrid}>
            <View style={[S.statWidget, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={[S.statIconBox, { backgroundColor: `${green}12` }]}>
                <DollarSign color={green} size={16} />
              </View>
              <AnimatedCounter value={todayRevenue} prefix="$" style={[S.statWidgetVal, { color: C.text }]} />
              <Text style={[S.statWidgetLabel, { color: C.text3 }]}>Today</Text>
            </View>
            <View style={[S.statWidget, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={[S.statIconBox, { backgroundColor: `${blue}12` }]}>
                <TrendingUp color={blue} size={16} />
              </View>
              <AnimatedCounter value={weekRevenue} prefix="$" style={[S.statWidgetVal, { color: C.text }]} />
              <Text style={[S.statWidgetLabel, { color: C.text3 }]}>This Week</Text>
            </View>
            <View style={[S.statWidget, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={[S.statIconBox, { backgroundColor: `${C.accent}12` }]}>
                <Scissors color={C.accent} size={16} />
              </View>
              <View style={S.statWidgetRow}>
                <Text style={[S.statWidgetVal, { color: C.text }]}>{completedToday}</Text>
                <Text style={[S.statWidgetFrac, { color: C.text3 }]}>/{todayApts.filter(a => a.status !== 'cancelled').length}</Text>
              </View>
              <View style={[S.miniBar, { backgroundColor: C.border }]}>
                <View style={[S.miniBarFill, {
                  width: `${todayApts.length > 0 ? (completedToday / todayApts.filter(a => a.status !== 'cancelled').length) * 100 : 0}%`,
                  backgroundColor: C.accent,
                }]} />
              </View>
              <Text style={[S.statWidgetLabel, { color: C.text3 }]}>Completed</Text>
            </View>
            <View style={[S.statWidget, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={[S.statIconBox, { backgroundColor: `${yellow}12` }]}>
                <Users color={yellow} size={16} />
              </View>
              <AnimatedCounter value={totalClients} style={[S.statWidgetVal, { color: C.text }]} />
              <Text style={[S.statWidgetLabel, { color: C.text3 }]}>Clients</Text>
            </View>
          </View>

          {/* ── Today's Schedule ── */}
          <View style={S.section}>
            <View style={S.sectionHeader}>
              <Text style={[S.sectionTitle, { color: C.text }]}>Today's Schedule</Text>
              <Tap onPress={() => router.push('/(barber)/appointments')}>
                <Text style={[S.sectionLink, { color: C.accent }]}>View all</Text>
              </Tap>
            </View>

            {todayApts.length === 0 ? (
              <View style={[S.emptyCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <CalendarCheck color={C.text3} size={32} />
                <Text style={[S.emptyText, { color: C.text2 }]}>No appointments today</Text>
                <Text style={[S.emptySub, { color: C.text3 }]}>Share your booking link to fill the chair</Text>
              </View>
            ) : (
              <Animated.View style={{ transform: [{ scale: sessionStartScale }] }}>
                {todayApts.map(renderAppointment)}
              </Animated.View>
            )}
          </View>

          {/* ── Quick Nav ── */}
          <View style={{ gap: 8 }}>
            {[
              { label: 'Full Schedule', sub: 'Calendar & history',    Icon: CalendarCheck, color: C.accent, route: '/(barber)/appointments' },
              { label: 'Clients',       sub: `${totalClients} total`, Icon: Users,         color: blue,     route: '/(barber)/clients' },
              { label: 'Messages',      sub: 'Chat with clients',     Icon: MessageCircle, color: green,    route: '/(barber)/messages' },
            ].map(({ label, sub, Icon, color, route }) => (
              <Tap key={label} onPress={() => router.push(route as any)}
                style={[S.navCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <View style={[S.navIconBox, { backgroundColor: `${color}12` }]}>
                  <Icon color={color} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.navLabel, { color: C.text }]}>{label}</Text>
                  <Text style={[S.navSub, { color: C.text3 }]}>{sub}</Text>
                </View>
                <ChevronRight color={C.text3} size={16} />
              </Tap>
            ))}
          </View>

        </Animated.View>
      </ScrollView>

      {/* ── Celebration Overlay ── */}
      {celebration && (
        <Pressable onPress={dismissCelebration} style={S.celebOverlay}>
          <Animated.View style={[S.celebScrim, { opacity: celebOpacity }]} />
          <Animated.View style={[S.celebCard, {
            backgroundColor: C.card,
            borderColor: `${green}35`,
            opacity: celebOpacity,
            transform: [{ scale: celebScale }],
          }]}>
            <View style={[S.celebCircle, { backgroundColor: `${green}12` }]}>
              <CheckCircle2 color={green} size={48} strokeWidth={1.5} />
              <ConfettiPop trigger={showConfetti} count={12} />
            </View>
            {celebration.amount > 0 && (
              <AnimatedCounter
                value={celebration.amount}
                prefix="$"
                style={{ fontSize: 36, fontWeight: '900', color: C.text, letterSpacing: -1, marginTop: 12 }}
              />
            )}
            <Text style={[S.celebName, { color: C.text }]}>{celebration.name}</Text>
            <Text style={[S.celebSub, { color: C.text2 }]}>Session complete</Text>
            <View style={[S.celebTotal, { backgroundColor: C.bg2 }]}>
              <Text style={[S.celebTotalLabel, { color: C.text3 }]}>Today's total</Text>
              <Text style={[S.celebTotalVal, { color: green }]}>${todayRevenue.toFixed(0)}</Text>
            </View>
          </Animated.View>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container:      { flex: 1 },
  loader:         { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header — clean, PumpPick style
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14, gap: 10 },
  brandName:      { fontSize: 22, fontWeight: '900', letterSpacing: -0.8 },
  streakPill:     { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  streakNum:      { fontSize: 12, fontWeight: '800' },
  headerIcon:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  scroll:         { paddingHorizontal: 18, paddingTop: 4 },

  // Daily goal card
  goalCard:       { borderRadius: 20, padding: 18, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  goalTop:        { flexDirection: 'row', alignItems: 'center' },
  goalLabel:      { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  goalAmount:     { fontSize: 20, fontWeight: '900', letterSpacing: -0.5, marginTop: 2 },
  goalMotivation: { fontSize: 12, marginTop: 10, fontWeight: '500' },

  // Week card — PumpPick inspired
  weekCard:       { borderRadius: 20, padding: 18, borderWidth: 1, marginBottom: 14 },
  weekHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  weekTitle:      { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  weekMore:       { fontSize: 12, fontWeight: '500', marginRight: 4 },
  dateStrip:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  dateCol:        { alignItems: 'center', gap: 6, flex: 1 },
  dayLabel:       { fontSize: 11, fontWeight: '600' },
  dateCircle:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dateNum:        { fontSize: 14, fontWeight: '700' },
  countPill:      { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4, minWidth: 20, alignItems: 'center' },
  countText:      { fontSize: 11 },
  sessionCount:   { fontSize: 11, fontWeight: '500', marginTop: 8 },

  // Ready section — big CTA like PumpPick
  readySection:   { marginBottom: 14 },
  readyTitle:     { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  readySub:       { fontSize: 13, marginTop: 3, marginBottom: 12 },
  bigCTA:         { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 22 },
  bigCTALabel:    { fontSize: 17, fontWeight: '800', color: '#fff' },
  bigCTASub:      { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2, fontWeight: '500' },
  bigCTAIcon:     { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },

  // In session card
  inSessionCard:  { borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1 },
  inSessionTop:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  inSessionDot:   { width: 8, height: 8, borderRadius: 4 },
  inSessionLabel: { fontSize: 13, fontWeight: '700' },
  inSessionRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  inSessionAvatar:{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  inSessionAvatarTxt: { fontSize: 14, fontWeight: '800' },
  inSessionName:  { fontSize: 15, fontWeight: '700' },
  inSessionMeta:  { fontSize: 12, marginTop: 1 },
  inSessionTimer: { fontSize: 14, fontWeight: '800' },
  inSessionPrice: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  inSessionBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, marginTop: 10 },
  inSessionBtnTxt:{ fontSize: 14, fontWeight: '700', color: '#fff' },

  // Charge link
  chargeLink:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  chargeLinkText: { flex: 1, fontSize: 14, fontWeight: '600' },

  // Pending
  pendingBanner:  { borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pendingIcon:    { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pendingTitle:   { fontSize: 14, fontWeight: '700' },
  pendingSub:     { fontSize: 12, marginTop: 1 },

  // Stats grid
  statsGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  statWidget:     { width: '47.5%', borderRadius: 18, padding: 16, borderWidth: 1 },
  statIconBox:    { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  statWidgetVal:  { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  statWidgetFrac: { fontSize: 14, fontWeight: '500' },
  statWidgetRow:  { flexDirection: 'row', alignItems: 'baseline' },
  statWidgetLabel:{ fontSize: 11, marginTop: 3, fontWeight: '500' },
  miniBar:        { height: 3, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  miniBarFill:    { height: '100%', borderRadius: 2 },

  // Section
  section:        { marginBottom: 16 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle:   { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  sectionLink:    { fontSize: 13, fontWeight: '600' },

  // Empty
  emptyCard:      { borderRadius: 20, padding: 36, alignItems: 'center', borderWidth: 1, gap: 8 },
  emptyText:      { fontSize: 14, fontWeight: '600' },
  emptySub:       { fontSize: 12, textAlign: 'center' },

  // Appointment card — clean, minimal
  aptCard:        { borderRadius: 18, marginBottom: 10, padding: 16, borderWidth: 1 },
  aptHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  aptTimeRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeDot:        { width: 6, height: 6, borderRadius: 3 },
  aptTime:        { fontSize: 12, fontWeight: '600' },
  liveChip:       { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  liveDotSmall:   { width: 5, height: 5, borderRadius: 3 },
  liveText:       { fontSize: 10, fontWeight: '700' },
  aptPrice:       { fontSize: 14, fontWeight: '800' },
  paidChip:       { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  paidChipText:   { fontSize: 10, fontWeight: '700' },
  aptClient:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  aptAvatar:      { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  aptAvatarTxt:   { fontSize: 14, fontWeight: '800' },
  aptName:        { fontSize: 15, fontWeight: '700' },
  aptMeta:        { fontSize: 11, fontWeight: '500' },
  typeBadge:      { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText:  { fontSize: 10, fontWeight: '700' },
  aptActions:     { flexDirection: 'row', gap: 8, marginTop: 12 },
  aptBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 13 },
  aptBtnTxt:      { fontSize: 13, fontWeight: '700', color: '#fff' },
  aptBtnSmall:    { width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },

  // Swipe
  swipeAction:    { justifyContent: 'center', alignItems: 'center', width: 80, borderRadius: 18, marginBottom: 10 },
  swipeActionText:{ color: '#fff', fontWeight: '800', fontSize: 13 },

  // Quick nav
  navCard:        { borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1 },
  navIconBox:     { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navLabel:       { fontWeight: '700', fontSize: 14 },
  navSub:         { fontSize: 12, marginTop: 1 },

  // Celebration
  celebOverlay:   { ...StyleSheet.absoluteFillObject, zIndex: 100, alignItems: 'center', justifyContent: 'center' },
  celebScrim:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  celebCard:      { borderRadius: 28, padding: 32, alignItems: 'center', borderWidth: 1, width: '82%', maxWidth: 340 },
  celebCircle:    { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  celebName:      { fontSize: 18, fontWeight: '800', marginTop: 4 },
  celebSub:       { fontSize: 13, marginTop: 2 },
  celebTotal:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 20, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  celebTotalLabel:{ fontSize: 12, fontWeight: '600' },
  celebTotalVal:  { fontSize: 16, fontWeight: '900' },
});
