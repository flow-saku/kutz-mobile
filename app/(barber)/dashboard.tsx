import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Animated, StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Scissors, DollarSign, Users, CalendarCheck, Clock,
  ChevronRight, TrendingUp, Check, X, AlertCircle, MessageCircle, CreditCard,
  Smartphone, Globe, CheckCircle2, Timer, UserCircle2,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { format, startOfWeek } from 'date-fns';
import * as Haptics from 'expo-haptics';

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

const TAB_BAR_HEIGHT = 68;

export default function BarberDashboard() {
  const { C, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 16;

  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [scopeIds, setScopeIds]         = useState<string[]>([]);
  const [primaryId, setPrimaryId]       = useState<string | null>(null);
  const [shopName, setShopName]         = useState('My Shop');
  const [isOwner, setIsOwner]           = useState(false);
  const [todayApts, setTodayApts]       = useState<any[]>([]);
  const [staffMap, setStaffMap]         = useState<Record<string, string>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [weekRevenue, setWeekRevenue]   = useState(0);
  const [totalClients, setTotalClients] = useState(0);
  const [updatingId, setUpdatingId]     = useState<string | null>(null);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;
  const scopeRef  = useRef<string[]>([]);

  function animateIn() {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 200, friction: 13, useNativeDriver: true }),
    ]).start();
  }

  async function loadStaffNames(ownerUid: string) {
    try {
      // Try the same RPC the client booking screen uses
      const { data } = await supabase.rpc('get_all_shop_staff', { p_barber_id: ownerUid });
      const map: Record<string, string> = {};
      for (const tm of ((data as any[]) ?? [])) {
        if (tm.id) map[tm.id] = tm.display_name ?? tm.name ?? 'Unknown';
      }
      // Also include owner under their UID
      if (!map[ownerUid]) {
        const { data: p } = await supabase.from('profiles')
          .select('display_name, shop_name').eq('id', ownerUid).maybeSingle();
        map[ownerUid] = (p as any)?.display_name || 'Owner';
      }
      setStaffMap(map);
    } catch { /* non-critical */ }
  }

  async function fetchData(ids: string[], uid: string) {
    try {
      const now = new Date();
      const today = format(now, 'yyyy-MM-dd');
      const weekStartStr = format(startOfWeek(now), 'yyyy-MM-dd');

      // Run every query independently so one failure doesn't kill the rest
      const profileRes = await supabase.from('profiles').select('display_name, shop_name')
        .or(`id.eq.${uid},user_id.eq.${uid}`).limit(1).maybeSingle();

      const todayRes = await supabase.from('appointments')
        .select('id, client_name, client_id, start_time, end_time, status, price_charged, date, service_id, notes, team_member_id, paid, payment_id, payment_method, services(name)')
        .in('barber_id', ids)
        .eq('date', today)
        .order('start_time', { ascending: true });

      const weekRes = await supabase.from('appointments')
        .select('price_charged')
        .in('barber_id', ids).eq('status', 'completed').gte('date', weekStartStr);

      const clientCountRes = await supabase.from('clients')
        .select('*', { count: 'exact', head: true }).in('barber_id', ids);

      setShopName((profileRes.data as any)?.shop_name || (profileRes.data as any)?.display_name || 'My Shop');

      const rawApts = (todayRes.data as any[]) ?? [];

      // Fetch payment types for paid badge display
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

      setTodayApts(apts);
      setPendingCount(apts.filter((a: any) => a.status === 'pending').length);
      setTodayRevenue(apts.filter((a: any) => a.status === 'completed').reduce((s: number, a: any) => s + (a.price || 0), 0));
      setWeekRevenue(((weekRes.data as any[]) ?? []).reduce((s, a) => s + (a.price_charged || 0), 0));
      setTotalClients(clientCountRes.count ?? 0);
    } catch (err) { console.error('Dashboard fetchData error:', err); }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); router.replace('/(auth)/login'); return; }
      const uid = session.user.id;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, user_id, shop_name, display_name')
        .or(`id.eq.${uid},user_id.eq.${uid}`)
        .limit(1)
        .maybeSingle();

      const ids = Array.from(
        new Set([uid, (profile as any)?.id, (profile as any)?.user_id].filter(Boolean) as string[])
      );
      const ownerUid = (profile as any)?.user_id ?? (profile as any)?.id ?? uid;

      setPrimaryId(uid);
      setScopeIds(ids);
      scopeRef.current = ids;
      setShopName((profile as any)?.shop_name || (profile as any)?.display_name || 'My Shop');

      await fetchData(ids, uid);
      loadStaffNames(ownerUid); // non-blocking

      setLoading(false);
      animateIn();
    })();
  }, []);

  // ── Real-time ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scopeIds.length) return;
    const ch = supabase.channel('barber_dash_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments',
        filter: `barber_id=eq.${scopeIds[0]}` },
        () => { if (scopeRef.current.length) fetchData(scopeRef.current, scopeIds[0]); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [scopeIds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (scopeRef.current.length && primaryId) {
      await fetchData(scopeRef.current, primaryId);
    }
    setRefreshing(false);
  }, [primaryId]);

  const updateStatus = async (aptId: string, newStatus: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setUpdatingId(aptId);
    try {
      const { error } = await supabase.from('appointments').update({ status: newStatus }).eq('id', aptId);
      if (error) throw error;
      if (scopeRef.current.length && primaryId) await fetchData(scopeRef.current, primaryId);
    } catch (err: any) { Alert.alert('Error', err.message || 'Failed to update'); }
    setUpdatingId(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <View style={[S.loader, { backgroundColor: C.bg }]}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  const completedToday = todayApts.filter(a => a.status === 'completed').length;
  const inChairToday   = todayApts.filter(a => a.status === 'in_chair').length;
  const green = '#16a34a', blue = '#2563eb', yellow = '#d97706', red = '#dc2626', orange = '#f97316';
  const stripeColor = '#635bff';

  const STATUS: Record<string, { label: string; color: string }> = {
    pending:   { label: 'Pending',   color: yellow },
    confirmed: { label: 'Confirmed', color: C.accent },
    in_chair:  { label: 'In Chair',  color: orange },
    completed: { label: 'Done',      color: green },
    cancelled: { label: 'Cancelled', color: C.text3 },
  };

  const renderAppointment = (apt: any) => {
    const cfg    = STATUS[apt.status] || STATUS.pending;
    const aColor = avatarColor(apt.client_name || 'C');
    const isUpdating = updatingId === apt.id;
    const isPOS    = apt.payment_type === 'pos';
    const isOnline = apt.payment_type === 'online';
    const isActive = apt.status === 'in_chair';
    const isDone   = apt.status === 'completed';

    // Who is doing this appointment
    const assignedStaffName = apt.team_member_id
      ? (staffMap[apt.team_member_id] ?? null)
      : null;

    return (
      <View
        key={apt.id}
        style={[S.aptCard, {
          backgroundColor: C.card,
          borderColor: isActive ? `${orange}45` : isDone ? `${green}30` : C.cardBorder,
          borderWidth: isActive ? 1.5 : 1,
        }]}
      >
        {/* Left accent bar */}
        <View style={[S.accentBar, { backgroundColor: cfg.color }]} />

        <View style={{ flex: 1, paddingLeft: 14 }}>
          {/* Time + status row */}
          <View style={S.aptTopRow}>
            <View style={S.timeChip}>
              <Clock color={cfg.color} size={12} strokeWidth={2.5} />
              <Text style={[S.timeText, { color: cfg.color }]}>
                {fmt12(apt.start_time)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {apt.price > 0 && (
                <Text style={[S.priceText, { color: green }]}>${apt.price}</Text>
              )}
              <View style={[S.statusPill, { backgroundColor: cfg.color + '1a' }]}>
                <Text style={[S.statusPillText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            </View>
          </View>

          {/* Client row */}
          <View style={S.clientRow}>
            <View style={[S.avatar, { backgroundColor: aColor + '20' }]}>
              <Text style={[S.avatarTxt, { color: aColor }]}>{initials(apt.client_name || 'C')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={[S.aptName, { color: C.text }]} numberOfLines={1}>{apt.client_name}</Text>
                {apt.paid && isPOS && (
                  <View style={[S.payBadge, { backgroundColor: stripeColor + '18' }]}>
                    <Smartphone color={stripeColor} size={9} />
                    <Text style={[S.payBadgeText, { color: stripeColor }]}>POS</Text>
                  </View>
                )}
                {apt.paid && isOnline && (
                  <View style={[S.payBadge, { backgroundColor: green + '18' }]}>
                    <Globe color={green} size={9} />
                    <Text style={[S.payBadgeText, { color: green }]}>Online</Text>
                  </View>
                )}
                {!apt.paid && isDone && (
                  <View style={[S.payBadge, { backgroundColor: yellow + '18' }]}>
                    <Text style={[S.payBadgeText, { color: yellow }]}>Unpaid</Text>
                  </View>
                )}
              </View>

              {/* Service + assigned barber */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
                {!!apt.service_name && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Scissors color={C.text3} size={10} strokeWidth={2} />
                    <Text style={[S.metaText, { color: C.text3 }]} numberOfLines={1}>{apt.service_name}</Text>
                  </View>
                )}
                {!!assignedStaffName && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <UserCircle2 color={C.accent} size={10} strokeWidth={2} />
                    <Text style={[S.metaText, { color: C.accent }]}>{assignedStaffName}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Actions */}
          {isUpdating ? (
            <View style={[S.actionRow, { justifyContent: 'center', paddingVertical: 8 }]}>
              <ActivityIndicator size="small" color={C.accent} />
            </View>
          ) : (
            <>
              {apt.status === 'pending' && (
                <View style={S.actionRow}>
                  <TouchableOpacity
                    onPress={() => updateStatus(apt.id, 'confirmed')}
                    activeOpacity={0.75}
                    style={[S.actionBtn, { backgroundColor: green, flex: 1 }]}
                  >
                    <Check color="#fff" size={14} strokeWidth={2.5} />
                    <Text style={S.actionBtnTxt}>Confirm</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => Alert.alert('Decline', 'Decline this booking?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Decline', style: 'destructive', onPress: () => updateStatus(apt.id, 'cancelled') },
                    ])}
                    activeOpacity={0.75}
                    style={[S.actionIconBtn, { backgroundColor: red + '15', borderColor: red + '30', borderWidth: 1 }]}
                  >
                    <X color={red} size={16} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>
              )}

              {apt.status === 'confirmed' && (
                <View style={S.actionRow}>
                  <TouchableOpacity
                    onPress={() => updateStatus(apt.id, 'in_chair')}
                    activeOpacity={0.75}
                    style={[S.actionBtn, { backgroundColor: orange, flex: 1 }]}
                  >
                    <Text style={S.actionBtnTxt}>▶  Start Session</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => Alert.alert('Cancel Appointment', 'Cancel this appointment?', [
                      { text: 'Keep', style: 'cancel' },
                      { text: 'Cancel', style: 'destructive', onPress: () => updateStatus(apt.id, 'cancelled') },
                    ])}
                    activeOpacity={0.75}
                    style={[S.actionIconBtn, { backgroundColor: red + '12', borderColor: red + '25', borderWidth: 1 }]}
                  >
                    <X color={red} size={16} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>
              )}

              {apt.status === 'in_chair' && (() => {
                const paysAtShop = apt.payment_method === 'at_shop' || !apt.payment_method;
                const needsCharge = paysAtShop && !apt.paid && Number(apt.price) > 0;
                return (
                  <View style={S.actionRow}>
                    <TouchableOpacity
                      onPress={async () => {
                        await updateStatus(apt.id, 'completed');
                        // Auto-open charge screen for in-person payers
                        if (needsCharge) {
                          router.push({
                            pathname: '/(barber)/charge',
                            params: {
                              client_name: apt.client_name,
                              client_id: apt.client_id || '',
                              appointment_id: apt.id,
                              prefill_amount: String(apt.price),
                            },
                          });
                        }
                      }}
                      activeOpacity={0.75}
                      style={[S.actionBtn, { backgroundColor: needsCharge ? stripeColor : green, flex: 1 }]}
                    >
                      {needsCharge
                        ? <><CreditCard color="#fff" size={14} strokeWidth={2.5} /><Text style={S.actionBtnTxt}>Complete & Charge ${apt.price}</Text></>
                        : <><CheckCircle2 color="#fff" size={14} strokeWidth={2.2} /><Text style={S.actionBtnTxt}>Complete</Text></>
                      }
                    </TouchableOpacity>
                    {apt.paid && (
                      <View style={[S.actionBtn, { backgroundColor: green + '18', flex: 1 }]}>
                        <CheckCircle2 color={green} size={14} strokeWidth={2.2} />
                        <Text style={[S.actionBtnTxt, { color: green }]}>Paid ✓</Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {apt.status === 'completed' && apt.paid && (
                <View style={[S.paidRow, { backgroundColor: green + '10', borderColor: green + '25' }]}>
                  <CheckCircle2 color={green} size={12} strokeWidth={2.2} />
                  <Text style={[S.paidTxt, { color: green }]}>Payment received</Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      <Animated.View style={[S.header, { opacity: fadeAnim, borderBottomColor: C.border }]}>
        <View style={[S.logoBox, { backgroundColor: C.accent + '15', borderColor: C.accent + '25' }]}>
          <Scissors color={C.accent} size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[S.shopName, { color: C.text }]}>{shopName}</Text>
          <Text style={[S.dateLabel, { color: C.text3 }]}>{format(new Date(), 'EEEE, MMM d')}</Text>
        </View>
      </Animated.View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[S.scroll, { paddingBottom: tabBarClearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* Stats */}
          <View style={S.statsGrid}>
            {[
              { Icon: DollarSign,    color: green,    label: "Today's Revenue", value: `$${todayRevenue.toFixed(0)}` },
              { Icon: TrendingUp,    color: blue,     label: 'Week Revenue',    value: `$${weekRevenue.toFixed(0)}` },
              { Icon: CalendarCheck, color: C.accent, label: 'Completed',       value: `${completedToday}/${todayApts.length}` },
              { Icon: Users,         color: yellow,   label: 'Total Clients',   value: String(totalClients) },
            ].map(({ Icon, color, label, value }) => (
              <View key={label} style={[S.statCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <View style={[S.statIcon, { backgroundColor: color + '18' }]}><Icon color={color} size={18} /></View>
                <Text style={[S.statValue, { color: C.text }]}>{value}</Text>
                <Text style={[S.statLabel, { color: C.text3 }]}>{label}</Text>
              </View>
            ))}
          </View>

          {/* In-chair indicator */}
          {inChairToday > 0 && (
            <View style={[S.inChairBanner, { backgroundColor: orange + '12', borderColor: orange + '35' }]}>
              <View style={[S.inChairDot, { backgroundColor: orange }]} />
              <Timer color={orange} size={16} />
              <Text style={[S.inChairText, { color: C.text }]}>
                {inChairToday} session{inChairToday > 1 ? 's' : ''} in progress
              </Text>
            </View>
          )}

          {/* Charge button */}
          <TouchableOpacity
            onPress={() => router.push('/(barber)/charge')}
            activeOpacity={0.85}
            style={[S.chargeBtn, { backgroundColor: C.accent }]}
          >
            <CreditCard color="#fff" size={20} />
            <Text style={S.chargeBtnText}>Charge Client</Text>
          </TouchableOpacity>

          {/* Pending banner */}
          {pendingCount > 0 && (
            <TouchableOpacity
              onPress={() => router.push('/(barber)/appointments')}
              style={[S.pendingBanner, { backgroundColor: yellow + '12', borderColor: yellow + '35' }]}
              activeOpacity={0.85}
            >
              <View style={[S.pendingIcon, { backgroundColor: yellow + '20' }]}>
                <AlertCircle color={yellow} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.pendingTitle, { color: C.text }]}>
                  {pendingCount} Pending Request{pendingCount > 1 ? 's' : ''}
                </Text>
                <Text style={[S.pendingSub, { color: C.text2 }]}>Tap to review & approve</Text>
              </View>
              <ChevronRight color={yellow} size={18} />
            </TouchableOpacity>
          )}

          {/* Today's Schedule */}
          <View style={S.section}>
            <View style={S.sectionHeader}>
              <Text style={[S.sectionTitle, { color: C.text }]}>Today's Schedule</Text>
              <TouchableOpacity onPress={() => router.push('/(barber)/appointments')}>
                <Text style={[S.sectionLink, { color: C.accent }]}>View all →</Text>
              </TouchableOpacity>
            </View>

            {todayApts.length === 0 ? (
              <View style={[S.emptySchedule, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <CalendarCheck color={C.text3} size={36} />
                <Text style={[S.emptyText, { color: C.text2 }]}>No appointments today</Text>
                <Text style={{ fontSize: 12, color: C.text3 }}>Enjoy the downtime ☕</Text>
              </View>
            ) : (
              todayApts.map(renderAppointment)
            )}
          </View>

          {/* Quick nav */}
          <View style={{ gap: 10 }}>
            {[
              { label: 'Full Schedule', sub: 'Calendar & history',    Icon: CalendarCheck, color: C.accent, route: '/(barber)/appointments' },
              { label: 'Clients',       sub: `${totalClients} total`, Icon: Users,         color: blue,     route: '/(barber)/clients' },
              { label: 'Messages',      sub: 'Chat with clients',     Icon: MessageCircle, color: green,    route: '/(barber)/messages' },
            ].map(({ label, sub, Icon, color, route }) => (
              <TouchableOpacity key={label} onPress={() => router.push(route as any)}
                style={[S.navCard, { backgroundColor: C.card, borderColor: C.cardBorder }]} activeOpacity={0.75}>
                <View style={[S.navIcon, { backgroundColor: color + '18' }]}><Icon color={color} size={20} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.navLabel, { color: C.text }]}>{label}</Text>
                  <Text style={[S.navSub, { color: C.text2 }]}>{sub}</Text>
                </View>
                <ChevronRight color={C.text3} size={18} />
              </TouchableOpacity>
            ))}
          </View>

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container:      { flex: 1 },
  loader:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1 },
  logoBox:        { width: 40, height: 40, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  shopName:       { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  dateLabel:      { fontSize: 12, marginTop: 1 },
  scroll:         { paddingHorizontal: 18, paddingTop: 16 },
  statsGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statCard:       { width: '47.5%', borderRadius: 20, padding: 16, borderWidth: 1 },
  statIcon:       { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  statValue:      { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  statLabel:      { fontSize: 11, marginTop: 3 },
  inChairBanner:  { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12, borderWidth: 1 },
  inChairDot:     { width: 7, height: 7, borderRadius: 4, marginRight: 2 },
  inChairText:    { fontSize: 13, fontWeight: '600' },
  chargeBtn:      { height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 },
  chargeBtnText:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  pendingBanner:  { borderRadius: 18, padding: 16, marginBottom: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  pendingIcon:    { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pendingTitle:   { fontWeight: '700', fontSize: 14 },
  pendingSub:     { fontSize: 12, marginTop: 2 },
  section:        { marginBottom: 16 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle:   { fontSize: 16, fontWeight: '800' },
  sectionLink:    { fontSize: 13, fontWeight: '600' },
  emptySchedule:  { borderRadius: 20, padding: 36, alignItems: 'center', borderWidth: 1, gap: 8 },
  emptyText:      { fontSize: 14, fontWeight: '600' },
  aptCard:        { borderRadius: 18, marginBottom: 10, overflow: 'hidden', flexDirection: 'row' },
  accentBar:      { width: 4 },
  aptTopRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingRight: 14, marginBottom: 10 },
  timeChip:       { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timeText:       { fontSize: 12, fontWeight: '700' },
  priceText:      { fontSize: 14, fontWeight: '800' },
  statusPill:     { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  clientRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, paddingRight: 14 },
  avatar:         { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:      { fontSize: 13, fontWeight: '800' },
  aptName:        { fontSize: 15, fontWeight: '700' },
  metaText:       { fontSize: 11 },
  payBadge:       { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  payBadgeText:   { fontSize: 9, fontWeight: '700' },
  actionRow:      { flexDirection: 'row', gap: 8, paddingBottom: 12, paddingRight: 14 },
  actionBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
  actionBtnTxt:   { fontSize: 13, fontWeight: '700', color: '#fff' },
  actionIconBtn:  { width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  paidRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, marginBottom: 12, marginRight: 14, alignSelf: 'flex-start' },
  paidTxt:        { fontSize: 12, fontWeight: '600' },
  navCard:        { borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1 },
  navIcon:        { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  navLabel:       { fontWeight: '700', fontSize: 14 },
  navSub:         { fontSize: 12, marginTop: 2 },
});
