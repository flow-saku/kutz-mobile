import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  StyleSheet, StatusBar, Animated, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft, Calendar, Clock, Scissors, CheckCircle2,
  XCircle, AlertCircle, RotateCcw,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { getActiveClientBinding } from '@/lib/clientSync';
import { getBarberProfile } from '@/lib/barber';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { format, parseISO } from 'date-fns';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonAppointmentCard, SkeletonList } from '@/components/ui/Skeleton';

type AppointmentStatus = 'pending' | 'confirmed' | 'in_chair' | 'completed' | 'cancelled' | 'no_show';

interface Appointment {
  id: string;
  date: string;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  service_name?: string;
  status: AppointmentStatus;
  price?: number;
  client_name?: string;
  team_member_name?: string;
}

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; color: string; bg: string; Icon: any }> = {
  pending:    { label: 'Pending',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',   Icon: AlertCircle   },
  confirmed:  { label: 'Confirmed',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',   Icon: CheckCircle2  },
  in_chair:   { label: 'In Chair',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',   Icon: Scissors      },
  completed:  { label: 'Completed',  color: '#10b981', bg: 'rgba(16,185,129,0.12)',   Icon: CheckCircle2  },
  cancelled:  { label: 'Cancelled',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)',    Icon: XCircle       },
  no_show:    { label: 'No Show',    color: '#6b7280', bg: 'rgba(107,114,128,0.12)',  Icon: XCircle       },
};


function fmt12(t: string) {
  try {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}

function AppointmentCard({ appt, C, isDark, onRebook }: {
  appt: Appointment; C: any; isDark: boolean; onRebook: (appt: Appointment) => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const cfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.Icon;
  const isRebookable = appt.status === 'completed' || appt.status === 'cancelled' || appt.status === 'no_show';

  let dateStr = appt.date;
  try { dateStr = format(parseISO(appt.date), 'EEE, MMM d, yyyy'); } catch {}

  return (
    <Animated.View style={[S.apptCard, { backgroundColor: C.card, borderColor: C.cardBorder, transform: [{ scale }] }]}>
      {/* Color left stripe */}
      <View style={[S.stripe, { backgroundColor: cfg.color }]} />

      <View style={S.apptContent}>
        {/* Top row: service + status badge */}
        <View style={S.apptTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={[S.serviceName, { color: C.text }]} numberOfLines={1}>
              {appt.service_name || 'Haircut'}
            </Text>
            {appt.team_member_name ? (
              <Text style={[S.teamMember, { color: C.text3 }]}>with {appt.team_member_name}</Text>
            ) : null}
          </View>
          <View style={[S.statusBadge, { backgroundColor: cfg.bg }]}>
            <StatusIcon size={11} color={cfg.color} strokeWidth={2.5} />
            <Text style={[S.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>

        {/* Date + time */}
        <View style={S.apptMeta}>
          <View style={S.metaItem}>
            <Calendar size={13} color={C.text3} strokeWidth={2} />
            <Text style={[S.metaText, { color: C.text2 }]}>{dateStr}</Text>
          </View>
          <View style={S.metaItem}>
            <Clock size={13} color={C.text3} strokeWidth={2} />
            <Text style={[S.metaText, { color: C.text2 }]}>
              {fmt12(appt.start_time)}
              {appt.duration_minutes ? ` · ${appt.duration_minutes}min` : ''}
            </Text>
          </View>
        </View>

        {/* Bottom row: price + rebook */}
        <View style={S.apptBottomRow}>
          {appt.price != null ? (
            <Text style={[S.priceText, { color: C.text }]}>${appt.price}</Text>
          ) : <View />}
          {isRebookable && (
            <TouchableOpacity
              style={[S.rebookBtn, { backgroundColor: isDark ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)' }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRebook(appt); }}
              activeOpacity={0.7}
            >
              <RotateCcw size={11} color="#a855f7" strokeWidth={2.5} />
              <Text style={S.rebookBtnText}>Rebook</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

export default function HistoryScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const toast = useToast();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clientId, setClientId]     = useState<string | null>(null);
  const [barberId, setBarberId]     = useState<string | null>(null);
  const [scopeIds, setScopeIds]     = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, totalSpend: 0 });

  const fade  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    loadData();
  }, []);


  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const binding = await getActiveClientBinding(session.user.id);
      if (!binding) {
        setLoading(false);
        return;
      }

      const profile = await getBarberProfile(binding.barberId);
      const ids = Array.from(
        new Set([binding.barberId, binding.rawBarberId, (profile as any)?.id, (profile as any)?.user_id].filter(Boolean))
      ) as string[];

      setClientId(binding.clientId);
      setBarberId(binding.barberId);
      setScopeIds(ids);
      await fetchAppointments(binding.clientId, ids);
    } catch (e: any) {
      toast.error('Could not load appointment history.');
    } finally {
      setLoading(false);
      Animated.parallel([
        Animated.timing(fade,  { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(slide, { toValue: 0, tension: 160, friction: 18, useNativeDriver: true }),
      ]).start();
    }
  };

  const fetchAppointments = async (cId: string, bIds: string[]) => {
    // Join services for name; use end_time + start_time for duration; price_charged for price
    // Use .in() with all possible barber_id values to handle web app ID mismatches
    const { data, error } = await supabase
      .from('appointments')
      .select('id, date, start_time, end_time, status, price_charged, client_name, service_id, services(name)')
      .eq('client_id', cId)
      .in('barber_id', bIds.length > 0 ? bIds : ['__none__'])
      .order('date', { ascending: false })
      .order('start_time', { ascending: false });

    if (error) throw error;

    // Compute duration from start_time / end_time
    function calcDuration(start: string, end: string): number | undefined {
      try {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        return diff > 0 ? diff : undefined;
      } catch { return undefined; }
    }

    const appts: Appointment[] = (data || []).map((a: any) => ({
      id: a.id,
      date: a.date,
      start_time: a.start_time,
      end_time: a.end_time,
      duration_minutes: calcDuration(a.start_time, a.end_time),
      service_name: (a.services as any)?.name || a.service_name,
      status: a.status,
      price: a.price_charged ?? a.price,
      client_name: a.client_name,
      team_member_name: undefined,
    }));

    setAppointments(appts);

    // Compute stats
    const completed = appts.filter(a => a.status === 'completed');
    const totalSpend = completed.reduce((sum, a) => sum + (a.price ?? 0), 0);
    setStats({ total: appts.length, completed: completed.length, totalSpend });
  };


  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (clientId && scopeIds.length > 0) await fetchAppointments(clientId, scopeIds);
      else if (clientId && barberId) await fetchAppointments(clientId, [barberId]);
    } catch {
      toast.error('Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRebook = (appt: Appointment) => {
    router.push('/(client)/rebook');
  };

  // Group by year-month
  const grouped = appointments.reduce<Record<string, Appointment[]>>((acc, appt) => {
    let key = 'Unknown';
    try { key = format(parseISO(appt.date), 'MMMM yyyy'); } catch {}
    if (!acc[key]) acc[key] = [];
    acc[key].push(appt);
    return acc;
  }, {});

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
        <Text style={[S.title, { color: C.text }]}>History</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <ScrollView contentContainerStyle={S.scroll}>
          {/* Stats skeleton */}
          <View style={[S.statsRow, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {[0,1,2].map(i => (
              <View key={i} style={S.statCol}>
                <View style={{ width: 48, height: 26, backgroundColor: C.bg2, borderRadius: 6 }} />
                <View style={{ width: 56, height: 12, backgroundColor: C.bg2, borderRadius: 4, marginTop: 6 }} />
              </View>
            ))}
          </View>
          <SkeletonList count={4} renderItem={() => <SkeletonAppointmentCard />} />
        </ScrollView>
      ) : (
        <Animated.View style={{ flex: 1, opacity: fade, transform: [{ translateY: slide }] }}>
          {/* Stats bar */}
          {appointments.length > 0 && (
            <View style={[S.statsRow, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={S.statCol}>
                <Text style={[S.statValue, { color: C.text }]}>{stats.total}</Text>
                <Text style={[S.statLabel, { color: C.text3 }]}>Total</Text>
              </View>
              <View style={[S.statDivider, { backgroundColor: C.border }]} />
              <View style={S.statCol}>
                <Text style={[S.statValue, { color: C.text }]}>{stats.completed}</Text>
                <Text style={[S.statLabel, { color: C.text3 }]}>Completed</Text>
              </View>
              <View style={[S.statDivider, { backgroundColor: C.border }]} />
              <View style={S.statCol}>
                <Text style={[S.statValue, { color: C.text }]}>${stats.totalSpend.toFixed(0)}</Text>
                <Text style={[S.statLabel, { color: C.text3 }]}>Spent</Text>
              </View>
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={S.scroll}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#a855f7"
                colors={['#a855f7']}
              />
            }
          >
            {appointments.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="No appointments yet"
                subtitle="Book your first appointment to get started."
                action={{ label: 'Book Now', onPress: () => router.push('/(client)/rebook') }}
              />
            ) : (
              Object.entries(grouped).map(([month, appts]) => (
                <View key={month}>
                  <Text style={[S.monthHeader, { color: C.text3 }]}>{month}</Text>
                  {appts.map(appt => (
                    <AppointmentCard
                      key={appt.id}
                      appt={appt}
                      C={C}
                      isDark={isDark}
                      onRebook={handleRebook}
                    />
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    marginHorizontal: 18, marginTop: 16, marginBottom: 4,
    paddingVertical: 16, borderRadius: 18, borderWidth: 1,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  statCol:   { alignItems: 'center', gap: 4 },
  statValue: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontWeight: '500' },
  statDivider: { width: 1, height: 32 },

  scroll: { paddingHorizontal: 18, paddingBottom: 100, paddingTop: 4 },

  monthHeader: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    marginTop: 18, marginBottom: 10, marginLeft: 2,
  },

  apptCard: {
    flexDirection: 'row',
    borderRadius: 16, borderWidth: 1, marginBottom: 10, overflow: 'hidden',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  stripe:      { width: 4 },
  apptContent: { flex: 1, padding: 14, gap: 8 },
  apptTopRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  serviceName: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  teamMember:  { fontSize: 12, marginTop: 2 },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  statusLabel: { fontSize: 11, fontWeight: '700' },

  apptMeta:  { gap: 4 },
  metaItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText:  { fontSize: 12, fontWeight: '500' },

  apptBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  priceText:     { fontSize: 16, fontWeight: '800' },
  rebookBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  rebookBtnText: { fontSize: 12, fontWeight: '700', color: '#a855f7' },
});
