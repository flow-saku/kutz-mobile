import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput, StyleSheet, StatusBar, FlatList,
  Animated, Pressable, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search, ChevronLeft, ChevronRight, CalendarCheck, CalendarDays,
  Clock, X, Filter, ArrowUpDown, Trophy, AlertTriangle, MessageCircle,
  StickyNote, ChevronDown, Users, Scissors,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { resolveBarberScope } from '@/lib/barber';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────
const TIERS = [
  { tier: 'new',      label: 'New',      icon: '✦', minVisits: 0,  color: '#737373' },
  { tier: 'bronze',   label: 'Bronze',   icon: '◆', minVisits: 1,  color: '#92400e' },
  { tier: 'silver',   label: 'Silver',   icon: '◈', minVisits: 5,  color: '#475569' },
  { tier: 'gold',     label: 'Gold',     icon: '★', minVisits: 12, color: '#d97706' },
  { tier: 'platinum', label: 'Platinum', icon: '⬢', minVisits: 25, color: '#7c3aed' },
  { tier: 'diamond',  label: 'Diamond',  icon: '◇', minVisits: 50, color: '#2563eb' },
] as const;

const PAGE_SIZES = [20, 50, 100] as const;
type SortOption  = 'name' | 'recent' | 'visits' | 'spend' | 'tier';
type AtRiskFilter = 'all' | '30' | '60' | '90';
type TierFilter  = 'all' | 'new' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
type PageSize    = (typeof PAGE_SIZES)[number];
type ProfileField = string | null | undefined;

interface Client {
  id: string; name: string; email: string; phone: string | null;
  visit_count: number; last_visit: string | null; notes: string | null;
  created_at: string; average_spend?: number | null; birthday?: string | null;
  tags?: string[]; hair_type?: ProfileField; hair_texture?: ProfileField;
  preferred_length?: ProfileField; color_history?: ProfileField; allergies?: ProfileField;
  preferred_service_name?: ProfileField; preferred_day?: ProfileField;
  preferred_time?: ProfileField; payment_method?: ProfileField;
}
interface AptRow   { id: string; date: string; start_time: string | null; end_time?: string | null; status?: string | null; service_name?: string | null; notes?: string | null; }
interface MsgRow   { id: string; sender_type: 'barber' | 'client' | 'system'; content: string; created_at: string; }
interface NoteRow  { id: string; note: string; created_at: string; }
type DetailTab = 'overview' | 'appointments' | 'messages' | 'notes';

const TAB_BAR_HEIGHT = 68;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTier(visits: number) {
  let t: (typeof TIERS)[number] = TIERS[0];
  for (const tier of TIERS) { if (visits >= tier.minVisits) t = tier; }
  return t;
}
function normalizeClient(row: any): Client {
  const name = row?.name || row?.full_name || (row?.email ? String(row.email).split('@')[0] : 'Client');
  return {
    id: String(row?.id ?? ''), name: String(name || 'Client'),
    email: String(row?.email ?? ''), phone: row?.phone ?? null,
    visit_count: Number(row?.visit_count ?? 0), last_visit: row?.last_visit ?? null,
    notes: row?.notes ?? null, created_at: String(row?.created_at ?? new Date().toISOString()),
    average_spend: row?.average_spend ?? null, birthday: row?.birthday ?? null,
    tags: Array.isArray(row?.tags) ? row.tags : [],
    hair_type: row?.hair_type ?? null, hair_texture: row?.hair_texture ?? null,
    preferred_length: row?.preferred_length ?? null, color_history: row?.color_history ?? null,
    allergies: row?.allergies ?? null,
    preferred_service_name: row?.preferred_service_name ?? row?.preferred_service ?? null,
    preferred_day: row?.preferred_day ?? null, preferred_time: row?.preferred_time ?? null,
    payment_method: row?.payment_method ?? null,
  };
}
function safeFmt(input: any, pattern: string) {
  if (!input) return null;
  try {
    const raw = String(input).trim();
    if (!raw) return null;
    const norm = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
    const d = new Date(norm);
    return Number.isNaN(d.getTime()) ? null : format(d, pattern);
  } catch { return null; }
}
function daysSince(last: string | null) {
  if (!last) return null;
  const d = new Date(last);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function fmt12(t: string | null | undefined) {
  if (!t) return null;
  try {
    const [h, m] = String(t).split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return String(t).slice(0, 5);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return String(t).slice(0, 5); }
}

// ─── Animated pressable row (for detail view) ─────────────────────────────────
function PressRow({ children, onPress, style }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => Animated.spring(scale, { toValue: 0.978, useNativeDriver: true, tension: 600, friction: 32 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 400, friction: 26 }).start()}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress?.(); }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function BarberClients() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 16;

  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [barberId, setBarberId]         = useState<string | null>(null);
  const [scopeIds, setScopeIds]         = useState<string[]>([]);
  const [clients, setClients]           = useState<Client[]>([]);
  const [search, setSearch]             = useState('');
  const [sortBy, setSortBy]             = useState<SortOption>('name');
  const [filterTier, setFilterTier]     = useState<TierFilter>('all');
  const [atRisk, setAtRisk]             = useState<AtRiskFilter>('all');
  const [showFilters, setShowFilters]   = useState(false);
  const [pageSize, setPageSize]         = useState<PageSize>(20);
  const [page, setPage]                 = useState(1);

  // Detail state
  const [selected, setSelected]         = useState<(Client & {
    pointsBalance: number; upcomingApt: any; lastApt: any;
    appointmentHistory: AptRow[]; messageHistory: MsgRow[]; noteHistory: NoteRow[];
  }) | null>(null);
  const [detailTab, setDetailTab]       = useState<DetailTab>('overview');
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchClients = useCallback(async (ids: string[]) => {
    try {
      const { data, error } = await supabase.from('clients').select('*').in('barber_id', ids);
      if (error) throw error;
      setClients(
        ((data as any[]) ?? []).map(normalizeClient).filter(c => !!c.id)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) { console.error('fetchClients:', err); }
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: any) => {
      if (!session?.user) { setLoading(false); return; }
      const uid = session.user.id;
      setBarberId(uid);
      const scope = await resolveBarberScope(uid);
      const { scopeIds: ids } = scope;
      setScopeIds(ids);
      fetchClients(ids);
    });
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (scopeIds.length > 0) await fetchClients(scopeIds);
    setRefreshing(false);
  }, [scopeIds, fetchClients]);

  // ── Open client detail ─────────────────────────────────────────────────────
  const openClient = async (client: Client) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetailLoading(true);
    setDetailTab('overview');
    setSelected({ ...client, pointsBalance: 0, upcomingApt: null, lastApt: null, appointmentHistory: [], messageHistory: [], noteHistory: [] });

    try {
      if (!barberId || scopeIds.length === 0) return;
      const today = new Date().toISOString().split('T')[0];
      const [ptsRes, upRes, lastRes, histRes, notesRes, convRes] = await Promise.all([
        supabase.from('loyalty_points').select('points_balance').eq('client_id', client.id).in('barber_id', scopeIds),
        supabase.from('appointments').select('id, date, start_time, status, service_name').in('barber_id', scopeIds).eq('client_id', client.id).in('status', ['confirmed', 'pending']).gte('date', today).order('date', { ascending: true }).limit(1),
        supabase.from('appointments').select('id, date, start_time, status, service_name').in('barber_id', scopeIds).eq('client_id', client.id).eq('status', 'completed').order('date', { ascending: false }).limit(1),
        supabase.from('appointments').select('id, date, start_time, end_time, status, service_name, notes').in('barber_id', scopeIds).eq('client_id', client.id).order('date', { ascending: false }).limit(30),
        supabase.from('client_notes').select('id, note, created_at').in('barber_id', scopeIds).eq('client_id', client.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('conversations').select('id').in('barber_id', scopeIds).eq('client_id', client.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      ]);

      const pts = Math.max(...(((ptsRes.data as any[]) ?? []).map((r: any) => Number(r?.points_balance ?? 0))), 0);

      let msgs: MsgRow[] = [];
      const convId = (convRes.data as any)?.id;
      if (convId) {
        const { data: md } = await supabase.from('messages').select('id, sender_type, content, created_at').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(50);
        msgs = ((md as any[]) ?? []).map(m => ({ id: String(m.id), sender_type: m.sender_type ?? 'system', content: String(m.content ?? ''), created_at: String(m.created_at) }));
      }

      setSelected({
        ...client, pointsBalance: pts,
        upcomingApt: (upRes.data as any[])?.[0] ?? null,
        lastApt: (lastRes.data as any[])?.[0] ?? null,
        appointmentHistory: ((histRes.data as any[]) ?? []).map(a => ({ id: String(a.id), date: String(a.date ?? ''), start_time: a.start_time ?? null, end_time: a.end_time ?? null, status: a.status ?? null, service_name: a.service_name ?? null, notes: a.notes ?? null })),
        noteHistory: ((notesRes.data as any[]) ?? []).map(n => ({ id: String(n.id), note: String(n.note ?? ''), created_at: String(n.created_at) })),
        messageHistory: msgs,
      });
    } catch (err) { console.error('openClient:', err); }
    setDetailLoading(false);
  };

  // ── Stats + filter ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let newMonth = 0, active30 = 0, visits = 0;
    const now = Date.now();
    const tierCounts: Record<string, number> = {};
    for (const c of clients) {
      visits += c.visit_count;
      if (now - new Date(c.created_at).getTime() <= 30 * 86400000) newMonth++;
      const d = daysSince(c.last_visit);
      if (d !== null && d <= 30) active30++;
      const t = getTier(c.visit_count).tier;
      tierCounts[t] = (tierCounts[t] ?? 0) + 1;
    }
    return { total: clients.length, newMonth, active30, avgVisits: clients.length > 0 ? Math.round(visits / clients.length * 10) / 10 : 0, tierCounts };
  }, [clients]);

  const filtered = useMemo(() => {
    let r = clients.filter(c => {
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !(c.email ?? '').toLowerCase().includes(q) && !(c.phone ?? '').includes(search) && !(c.tags ?? []).some(t => t.toLowerCase().includes(q))) return false;
      }
      if (filterTier !== 'all' && getTier(c.visit_count).tier !== filterTier) return false;
      if (atRisk !== 'all') { const d = daysSince(c.last_visit); if (d !== null && d < Number(atRisk)) return false; }
      return true;
    });
    const s = [...r];
    if (sortBy === 'recent') s.sort((a, b) => (b.last_visit ? new Date(b.last_visit).getTime() : 0) - (a.last_visit ? new Date(a.last_visit).getTime() : 0));
    else if (sortBy === 'visits') s.sort((a, b) => b.visit_count - a.visit_count);
    else if (sortBy === 'spend') s.sort((a, b) => Number(b.average_spend ?? 0) - Number(a.average_spend ?? 0));
    else if (sortBy === 'tier') {
      const rank: Record<string, number> = { new: 1, bronze: 2, silver: 3, gold: 4, platinum: 5, diamond: 6 };
      s.sort((a, b) => (rank[getTier(b.visit_count).tier] ?? 0) - (rank[getTier(a.visit_count).tier] ?? 0));
    } else s.sort((a, b) => a.name.localeCompare(b.name));
    return s;
  }, [clients, search, filterTier, atRisk, sortBy]);

  const hasFilters = !!(search.trim() || sortBy !== 'name' || filterTier !== 'all' || atRisk !== 'all');
  useEffect(() => { setPage(1); }, [search, sortBy, filterTier, atRisk, pageSize]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start       = (clampedPage - 1) * pageSize;
  const end         = Math.min(start + pageSize, filtered.length);
  const paginated   = filtered.slice(start, end);

  const clearFilters = () => { setSearch(''); setSortBy('name'); setFilterTier('all'); setAtRisk('all'); };

  // ─────────────────────────────────────────────────────────────────────────────
  // LOADING
  if (loading) return <View style={[S.loader, { backgroundColor: C.bg }]}><ActivityIndicator color={C.accent} size="large" /></View>;

  // ─────────────────────────────────────────────────────────────────────────────
  // DETAIL VIEW
  if (selected) {
    const tier = getTier(selected.visit_count);
    const riskDays = daysSince(selected.last_visit);

    return (
      <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

        {/* Header */}
        <View style={[S.detailHeader, { borderBottomColor: C.border }]}>
          <TouchableOpacity onPress={() => setSelected(null)}
            style={[S.backBtn, { backgroundColor: C.bg2, borderColor: C.border }]}>
            <ChevronLeft color={C.text} size={20} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={[S.detailTitle, { color: C.text }]} numberOfLines={1}>{selected.name}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={[S.detailScroll, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
          {detailLoading ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}><ActivityIndicator color={C.accent} size="large" /></View>
          ) : (
            <>
              {/* ── Hero ── */}
              <View style={[S.heroCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                {/* Avatar + name + tier */}
                <View style={S.heroTop}>
                  <View style={[S.heroAvatarRing, { borderColor: `${tier.color}50` }]}>
                    <View style={[S.heroAvatar, { backgroundColor: `${tier.color}20` }]}>
                      <Text style={[S.heroAvatarTxt, { color: tier.color }]}>{selected.name.charAt(0).toUpperCase()}</Text>
                    </View>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[S.heroName, { color: C.text }]}>{selected.name}</Text>
                    {!!selected.email && <Text style={[S.heroContact, { color: C.text2 }]}>{selected.email}</Text>}
                    {!!selected.phone && <Text style={[S.heroContact, { color: C.text2 }]}>{selected.phone}</Text>}
                    <View style={[S.tierPill, { backgroundColor: `${tier.color}18`, borderColor: `${tier.color}35` }]}>
                      <Text style={[S.tierPillTxt, { color: tier.color }]}>{tier.icon}  {tier.label}</Text>
                    </View>
                  </View>
                </View>

                <View style={[S.heroDivider, { backgroundColor: C.border }]} />

                {/* Stats row */}
                <View style={S.heroStats}>
                  {[
                    { val: String(selected.visit_count), lbl: 'Visits', color: C.accent },
                    { val: String(selected.pointsBalance), lbl: 'Points', color: '#d97706' },
                    { val: selected.average_spend != null ? `$${Math.round(Number(selected.average_spend))}` : '—', lbl: 'Avg Spend', color: '#16a34a' },
                    { val: riskDays != null ? `${riskDays}d` : '—', lbl: 'Since Visit', color: riskDays != null && riskDays >= 60 ? '#ef4444' : C.text2 },
                  ].map(({ val, lbl, color }, i, arr) => (
                    <React.Fragment key={lbl}>
                      <View style={S.heroStat}>
                        <Text style={[S.heroStatVal, { color }]}>{val}</Text>
                        <Text style={[S.heroStatLbl, { color: C.text3 }]}>{lbl}</Text>
                      </View>
                      {i < arr.length - 1 && <View style={[S.heroStatDiv, { backgroundColor: C.border }]} />}
                    </React.Fragment>
                  ))}
                </View>
              </View>

              {/* ── Quick info cards ── */}
              {(selected.upcomingApt || selected.lastApt) && (
                <View style={S.quickRow}>
                  {selected.upcomingApt && (
                    <View style={[S.quickCard, { backgroundColor: `${C.accent}0e`, borderColor: `${C.accent}28` }]}>
                      <View style={[S.quickIcon, { backgroundColor: `${C.accent}18` }]}>
                        <CalendarCheck color={C.accent} size={14} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.quickLabel, { color: C.accent }]}>UPCOMING</Text>
                        <Text style={[S.quickVal, { color: C.text }]} numberOfLines={1}>
                          {safeFmt(selected.upcomingApt.date, 'EEE, MMM d') ?? 'Soon'}
                          {selected.upcomingApt.start_time ? ` · ${String(selected.upcomingApt.start_time).slice(0, 5)}` : ''}
                        </Text>
                        {!!selected.upcomingApt.service_name && <Text style={[S.quickSub, { color: C.text3 }]} numberOfLines={1}>{selected.upcomingApt.service_name}</Text>}
                      </View>
                    </View>
                  )}
                  {selected.lastApt && (
                    <View style={[S.quickCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <View style={[S.quickIcon, { backgroundColor: C.bg2 }]}>
                        <Clock color={C.text3} size={14} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.quickLabel, { color: C.text3 }]}>LAST VISIT</Text>
                        <Text style={[S.quickVal, { color: C.text }]} numberOfLines={1}>
                          {safeFmt(selected.lastApt.date, 'MMM d, yyyy') ?? 'Recent'}
                        </Text>
                        {!!selected.lastApt.service_name && <Text style={[S.quickSub, { color: C.text3 }]} numberOfLines={1}>{selected.lastApt.service_name}</Text>}
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* ── Detail tabs ── */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.tabStrip} style={S.tabStripWrap}>
                {([
                  { key: 'overview',     label: 'Overview',                            icon: '👤' },
                  { key: 'appointments', label: `Visits (${selected.appointmentHistory.length})`, icon: '📅' },
                  { key: 'messages',     label: `Chats (${selected.messageHistory.length})`,      icon: '💬' },
                  { key: 'notes',        label: `Notes (${selected.noteHistory.length})`,          icon: '📝' },
                ] as { key: DetailTab; label: string; icon: string }[]).map(t => {
                  const active = detailTab === t.key;
                  return (
                    <TouchableOpacity
                      key={t.key}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDetailTab(t.key); }}
                      style={[S.tabPill, active ? { backgroundColor: C.accent } : { backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1 }]}
                      activeOpacity={0.8}
                    >
                      <Text style={[S.tabPillTxt, { color: active ? C.accentText : C.text2 }]}>{t.icon}  {t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* ── OVERVIEW ── */}
              {detailTab === 'overview' && (
                <View style={S.tabContent}>
                  {/* Tags */}
                  {!!selected.tags?.length && (
                    <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.sectionLabel, { color: C.text3 }]}>TAGS</Text>
                      <View style={S.tagRow}>
                        {selected.tags.map(tag => (
                          <View key={tag} style={[S.tagChip, { backgroundColor: C.bg2, borderColor: C.border }]}>
                            <Text style={[S.tagTxt, { color: C.text2 }]}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Meta grid */}
                  <View style={S.metaGrid}>
                    <View style={[S.metaCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.metaCardLabel, { color: C.text3 }]}>Birthday</Text>
                      <Text style={[S.metaCardVal, { color: C.text }]}>{safeFmt(selected.birthday, 'MMM d') ?? '—'}</Text>
                    </View>
                    <View style={[S.metaCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.metaCardLabel, { color: C.text3 }]}>Payment</Text>
                      <Text style={[S.metaCardVal, { color: C.text }]}>{selected.payment_method || '—'}</Text>
                    </View>
                    <View style={[S.metaCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.metaCardLabel, { color: C.text3 }]}>Client since</Text>
                      <Text style={[S.metaCardVal, { color: C.text }]}>{safeFmt(selected.created_at, 'MMM yyyy') ?? '—'}</Text>
                    </View>
                    <View style={[S.metaCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.metaCardLabel, { color: C.text3 }]}>Preferred</Text>
                      <Text style={[S.metaCardVal, { color: C.text }]} numberOfLines={1}>{selected.preferred_service_name || '—'}</Text>
                    </View>
                  </View>

                  {/* Hair profile */}
                  {(selected.hair_type || selected.hair_texture || selected.preferred_length || selected.color_history || selected.allergies) && (
                    <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.sectionLabel, { color: C.text3 }]}>HAIR PROFILE</Text>
                      {[
                        { l: 'Type', v: selected.hair_type },
                        { l: 'Texture', v: selected.hair_texture },
                        { l: 'Length', v: selected.preferred_length },
                        { l: 'Color History', v: selected.color_history },
                      ].filter(x => x.v).map(({ l, v }) => (
                        <View key={l} style={S.infoRow}>
                          <Text style={[S.infoRowLabel, { color: C.text3 }]}>{l}</Text>
                          <Text style={[S.infoRowVal, { color: C.text }]}>{v}</Text>
                        </View>
                      ))}
                      {!!selected.allergies && (
                        <View style={[S.allergyBanner, { backgroundColor: '#ef444410', borderColor: '#ef444430' }]}>
                          <Text style={S.allergyTxt}>⚠️  {selected.allergies}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Notes */}
                  {!!selected.notes && (
                    <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.sectionLabel, { color: C.text3 }]}>NOTES</Text>
                      <Text style={[S.notesTxt, { color: C.text }]}>{selected.notes}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* ── APPOINTMENTS ── */}
              {detailTab === 'appointments' && (
                <View style={S.tabContent}>
                  {selected.appointmentHistory.length === 0 ? (
                    <View style={[S.emptyTab, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <CalendarDays color={C.text3} size={28} strokeWidth={1.5} />
                      <Text style={[S.emptyTabTxt, { color: C.text2 }]}>No appointments yet</Text>
                    </View>
                  ) : selected.appointmentHistory.map(apt => {
                    const sc = apt.status?.toLowerCase() ?? '';
                    const sc_color = sc === 'completed' ? '#16a34a' : sc === 'confirmed' ? '#2563eb' : sc === 'pending' ? '#d97706' : sc === 'cancelled' ? '#ef4444' : C.text3;
                    return (
                      <View key={apt.id} style={[S.aptCard, { backgroundColor: C.card, borderColor: C.cardBorder, borderLeftColor: sc_color }]}>
                        <View style={S.aptTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={[S.aptService, { color: C.text }]}>{apt.service_name || 'Appointment'}</Text>
                            <Text style={[S.aptDate, { color: C.text2 }]}>
                              {safeFmt(apt.date, 'EEE, MMM d, yyyy') ?? 'Unknown date'} · {fmt12(apt.start_time) ?? '--'}
                            </Text>
                          </View>
                          <View style={[S.statusBadge, { backgroundColor: `${sc_color}15`, borderColor: `${sc_color}30` }]}>
                            <Text style={[S.statusBadgeTxt, { color: sc_color }]}>{sc || 'scheduled'}</Text>
                          </View>
                        </View>
                        {!!apt.notes && <Text style={[S.aptNotes, { color: C.text3 }]}>{apt.notes}</Text>}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* ── MESSAGES ── */}
              {detailTab === 'messages' && (
                <View style={S.tabContent}>
                  {selected.messageHistory.length === 0 ? (
                    <View style={[S.emptyTab, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <MessageCircle color={C.text3} size={28} strokeWidth={1.5} />
                      <Text style={[S.emptyTabTxt, { color: C.text2 }]}>No messages yet</Text>
                    </View>
                  ) : selected.messageHistory.map(m => {
                    const isBarber = m.sender_type === 'barber';
                    const isSystem = m.sender_type === 'system';
                    return (
                      <View key={m.id} style={{ alignItems: isBarber ? 'flex-end' : isSystem ? 'center' : 'flex-start', marginBottom: 6 }}>
                        <View style={[
                          S.bubble,
                          isBarber ? { backgroundColor: C.accent } : isSystem ? { backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1 } : { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1 },
                        ]}>
                          <Text style={[S.bubbleTxt, { color: isBarber ? C.accentText : C.text }]}>{m.content}</Text>
                          <Text style={[S.bubbleTs, { color: isBarber ? `${C.accentText}80` : C.text3 }]}>{safeFmt(m.created_at, 'MMM d, h:mm a') ?? ''}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* ── NOTES ── */}
              {detailTab === 'notes' && (
                <View style={S.tabContent}>
                  {selected.noteHistory.length === 0 ? (
                    <View style={[S.emptyTab, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <StickyNote color={C.text3} size={28} strokeWidth={1.5} />
                      <Text style={[S.emptyTabTxt, { color: C.text2 }]}>No notes yet</Text>
                    </View>
                  ) : selected.noteHistory.map(n => (
                    <View key={n.id} style={[S.noteCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                      <Text style={[S.noteCardTxt, { color: C.text }]}>{n.note}</Text>
                      <Text style={[S.noteCardTs, { color: C.text3 }]}>{safeFmt(n.created_at, 'MMM d, yyyy · h:mm a') ?? ''}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LIST VIEW
  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Header */}
      <View style={[S.listHeader, { borderBottomColor: C.border }]}>
        <View style={S.listTitleRow}>
          <Text style={[S.listTitle, { color: C.text }]}>Clients</Text>
          <View style={[S.countBadge, { backgroundColor: C.bg2, borderColor: C.border }]}>
            <Text style={[S.countTxt, { color: C.text2 }]}>{filtered.length}/{clients.length}</Text>
          </View>
        </View>

        {/* Search */}
        <View style={[S.searchBar, { backgroundColor: C.bg2, borderColor: C.border }]}>
          <Search color={C.text3} size={15} strokeWidth={2} />
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search name, email, phone…"
            placeholderTextColor={C.text3}
            style={[S.searchInput, { color: C.text }]}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X color={C.text3} size={14} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter toggle */}
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowFilters(v => !v); }}
          style={[S.filterToggle, { backgroundColor: (showFilters || hasFilters) ? `${C.accent}15` : C.bg2, borderColor: (showFilters || hasFilters) ? `${C.accent}40` : C.border }]}
          activeOpacity={0.8}
        >
          <Filter color={(showFilters || hasFilters) ? C.accent : C.text3} size={13} strokeWidth={2} />
          <Text style={[S.filterToggleTxt, { color: (showFilters || hasFilters) ? C.accent : C.text2 }]}>
            {hasFilters ? 'Filters active' : 'Filters'}
          </Text>
          <ChevronDown color={(showFilters || hasFilters) ? C.accent : C.text3} size={13} strokeWidth={2}
            style={{ transform: [{ rotate: showFilters ? '180deg' : '0deg' }] }} />
        </TouchableOpacity>

        {/* Filter panel */}
        {showFilters && (
          <View style={[S.filterPanel, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {/* Sort */}
            <View style={S.filterGroup}>
              <Text style={[S.filterGroupLabel, { color: C.text3 }]}>SORT BY</Text>
              <View style={S.chipRow}>
                {([
                  { key: 'name', label: 'Name' }, { key: 'recent', label: 'Recent' },
                  { key: 'visits', label: 'Visits' }, { key: 'spend', label: 'Spend' }, { key: 'tier', label: 'Tier' },
                ] as { key: SortOption; label: string }[]).map(o => (
                  <TouchableOpacity key={o.key} onPress={() => setSortBy(o.key)}
                    style={[S.chip, { borderColor: sortBy === o.key ? C.accent : C.border, backgroundColor: sortBy === o.key ? `${C.accent}15` : C.bg }]}>
                    <Text style={[S.chipTxt, { color: sortBy === o.key ? C.accent : C.text2 }]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Tier */}
            <View style={S.filterGroup}>
              <Text style={[S.filterGroupLabel, { color: C.text3 }]}>TIER</Text>
              <View style={S.chipRow}>
                <TouchableOpacity onPress={() => setFilterTier('all')}
                  style={[S.chip, { borderColor: filterTier === 'all' ? C.accent : C.border, backgroundColor: filterTier === 'all' ? `${C.accent}15` : C.bg }]}>
                  <Text style={[S.chipTxt, { color: filterTier === 'all' ? C.accent : C.text2 }]}>All</Text>
                </TouchableOpacity>
                {TIERS.map(t => {
                  const active = filterTier === t.tier;
                  return (
                    <TouchableOpacity key={t.tier} onPress={() => setFilterTier(prev => prev === t.tier ? 'all' : t.tier as TierFilter)}
                      style={[S.chip, { borderColor: active ? t.color : C.border, backgroundColor: active ? `${t.color}15` : C.bg }]}>
                      <Text style={[S.chipTxt, { color: active ? t.color : C.text2 }]}>{t.icon} {t.label} ({stats.tierCounts[t.tier] ?? 0})</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* At risk */}
            <View style={S.filterGroup}>
              <Text style={[S.filterGroupLabel, { color: C.text3 }]}>AT RISK (DAYS SINCE VISIT)</Text>
              <View style={S.chipRow}>
                {([{ key: 'all', label: 'All' }, { key: '30', label: '30+ days' }, { key: '60', label: '60+ days' }, { key: '90', label: '90+ days' }] as { key: AtRiskFilter; label: string }[]).map(o => (
                  <TouchableOpacity key={o.key} onPress={() => setAtRisk(o.key)}
                    style={[S.chip, { borderColor: atRisk === o.key ? C.accent : C.border, backgroundColor: atRisk === o.key ? `${C.accent}15` : C.bg }]}>
                    <Text style={[S.chipTxt, { color: atRisk === o.key ? C.accent : C.text2 }]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {hasFilters && (
              <TouchableOpacity onPress={clearFilters} style={[S.clearBtn, { borderColor: C.border }]}>
                <X color={C.text3} size={11} />
                <Text style={[S.clearBtnTxt, { color: C.text2 }]}>Clear all filters</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Stats strip */}
      {clients.length > 0 && (
        <View style={[S.statsStrip, { borderBottomColor: C.border }]}>
          {[
            { val: stats.newMonth,  lbl: 'NEW 30D' },
            { val: stats.active30,  lbl: 'ACTIVE 30D' },
            { val: stats.avgVisits, lbl: 'AVG VISITS' },
          ].map(({ val, lbl }, i, arr) => (
            <React.Fragment key={lbl}>
              <View style={S.statStripItem}>
                <Text style={[S.statStripVal, { color: C.text }]}>{val}</Text>
                <Text style={[S.statStripLbl, { color: C.text3 }]}>{lbl}</Text>
              </View>
              {i < arr.length - 1 && <View style={[S.statStripDiv, { backgroundColor: C.border }]} />}
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Pagination */}
      <View style={[S.pageRow, { borderBottomColor: C.border }]}>
        <View style={S.pageSizes}>
          {PAGE_SIZES.map(s => (
            <TouchableOpacity key={s} onPress={() => setPageSize(s)}
              style={[S.pageSizeBtn, { borderColor: C.border, backgroundColor: pageSize === s ? C.bg2 : 'transparent' }]}>
              <Text style={[S.pageSizeTxt, { color: pageSize === s ? C.text : C.text3 }]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={S.pageNav}>
          <TouchableOpacity onPress={() => setPage(p => Math.max(1, p - 1))} disabled={clampedPage <= 1}
            style={[S.pageNavBtn, { borderColor: C.border, opacity: clampedPage <= 1 ? 0.35 : 1 }]}>
            <ChevronLeft size={14} color={C.text2} />
          </TouchableOpacity>
          <Text style={[S.pageTxt, { color: C.text2 }]}>{filtered.length === 0 ? '0' : `${start + 1}–${end}`} of {filtered.length}</Text>
          <TouchableOpacity onPress={() => setPage(p => Math.min(totalPages, p + 1))} disabled={clampedPage >= totalPages}
            style={[S.pageNavBtn, { borderColor: C.border, opacity: clampedPage >= totalPages ? 0.35 : 1 }]}>
            <ChevronRight size={14} color={C.text2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Client list */}
      <FlatList
        data={paginated}
        keyExtractor={c => c.id}
        contentContainerStyle={[S.listContent, { paddingBottom: tabBarClearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={[S.emptyState, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Users color={C.text3} size={36} strokeWidth={1.5} />
            <Text style={[S.emptyStateTxt, { color: C.text2 }]}>{hasFilters ? 'No clients match these filters' : 'No clients yet'}</Text>
            {!hasFilters && <Text style={[S.emptyStateSub, { color: C.text3 }]}>Clients appear here when they join your shop</Text>}
          </View>
        }
        renderItem={({ item: client }) => {
          const tier = getTier(client.visit_count);
          const riskDays = daysSince(client.last_visit);
          const lastVisitTxt = safeFmt(client.last_visit, 'MMM d');
          return (
            <PressRow
              onPress={() => openClient(client)}
              style={[S.clientCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}
            >
              {/* Tier accent bar */}
              <View style={[S.clientAccent, { backgroundColor: tier.color }]} />

              <View style={[S.clientAvatarWrap, { backgroundColor: `${tier.color}18` }]}>
                <Text style={[S.clientAvatarTxt, { color: tier.color }]}>{client.name.charAt(0).toUpperCase()}</Text>
              </View>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={S.clientNameRow}>
                  <Text numberOfLines={1} style={[S.clientName, { color: C.text }]}>{client.name}</Text>
                  <Text style={{ fontSize: 13 }}>{tier.icon}</Text>
                  {riskDays !== null && riskDays >= 60 && (
                    <View style={[S.riskBadge, { backgroundColor: '#ef444412', borderColor: '#ef444428' }]}>
                      <Text style={[S.riskTxt, { color: '#ef4444' }]}>At risk</Text>
                    </View>
                  )}
                </View>
                <Text numberOfLines={1} style={[S.clientEmail, { color: C.text3 }]}>{client.email || client.phone || 'No contact'}</Text>
                <View style={S.clientMeta}>
                  <Text style={[S.clientMetaVal, { color: tier.color }]}>{client.visit_count} visits</Text>
                  {typeof client.average_spend === 'number' && client.average_spend > 0 && (
                    <Text style={[S.clientMetaDot, { color: C.text3 }]}>  ·  <Text style={[S.clientMetaVal, { color: C.text2 }]}>${Math.round(client.average_spend)} avg</Text></Text>
                  )}
                  {lastVisitTxt && <Text style={[S.clientMetaDot, { color: C.text3 }]}>  ·  <Text style={{ color: C.text3 }}>Last {lastVisitTxt}</Text></Text>}
                </View>
              </View>

              <ChevronRight color={C.border} size={17} strokeWidth={2} />
            </PressRow>
          );
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1 },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // List header
  listHeader:   { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1 },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  listTitle:    { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  countBadge:   { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  countTxt:     { fontSize: 12, fontWeight: '700' },

  searchBar:   { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, gap: 10, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },

  filterToggle:    { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, alignSelf: 'flex-start' },
  filterToggleTxt: { fontSize: 13, fontWeight: '600' },

  filterPanel:      { marginTop: 10, borderRadius: 16, padding: 14, borderWidth: 1, gap: 14 },
  filterGroup:      { gap: 8 },
  filterGroupLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip:             { borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  chipTxt:          { fontSize: 12, fontWeight: '600' },
  clearBtn:         { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
  clearBtnTxt:      { fontSize: 12, fontWeight: '600' },

  // Stats strip
  statsStrip:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1 },
  statStripItem: { flex: 1, alignItems: 'center' },
  statStripVal:  { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  statStripLbl:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.7, marginTop: 2 },
  statStripDiv:  { width: 1, height: 30 },

  // Pagination
  pageRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  pageSizes:   { flexDirection: 'row', gap: 6 },
  pageSizeBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  pageSizeTxt: { fontSize: 11, fontWeight: '700' },
  pageNav:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pageNavBtn:  { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pageTxt:     { fontSize: 12, fontWeight: '600' },

  listContent: { paddingHorizontal: 14, paddingTop: 10, gap: 8 },

  // Client card
  clientCard:      { borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 13, overflow: 'hidden', paddingRight: 14, paddingVertical: 14 },
  clientAccent:    { width: 3, alignSelf: 'stretch', borderRadius: 2, marginLeft: 2, marginRight: -4 },
  clientAvatarWrap:{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  clientAvatarTxt: { fontSize: 20, fontWeight: '900' },
  clientNameRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clientName:      { fontWeight: '800', fontSize: 16, flexShrink: 1 },
  clientEmail:     { fontSize: 12 },
  clientMeta:      { flexDirection: 'row', alignItems: 'center' },
  clientMetaVal:   { fontSize: 12, fontWeight: '700' },
  clientMetaDot:   { fontSize: 12 },
  riskBadge:       { borderWidth: 1, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 },
  riskTxt:         { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  emptyState:    { borderRadius: 20, borderWidth: 1, paddingVertical: 56, alignItems: 'center', gap: 10, marginTop: 8 },
  emptyStateTxt: { fontSize: 15, fontWeight: '700' },
  emptyStateSub: { fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },

  // ── Detail ──────────────────────────────────────────────────────────────────
  detailHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  detailTitle:  { fontSize: 18, fontWeight: '900', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  detailScroll: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },

  // Hero card
  heroCard:      { borderRadius: 22, borderWidth: 1, padding: 18, ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12 }, android: { elevation: 3 } }) },
  heroTop:       { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 16 },
  heroAvatarRing:{ width: 72, height: 72, borderRadius: 36, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  heroAvatar:    { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  heroAvatarTxt: { fontSize: 26, fontWeight: '900' },
  heroName:      { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  heroContact:   { fontSize: 13 },
  tierPill:      { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4 },
  tierPillTxt:   { fontSize: 12, fontWeight: '800' },
  heroDivider:   { height: 1, marginBottom: 14 },
  heroStats:     { flexDirection: 'row', alignItems: 'center' },
  heroStat:      { flex: 1, alignItems: 'center', gap: 3 },
  heroStatVal:   { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  heroStatLbl:   { fontSize: 10, fontWeight: '600' },
  heroStatDiv:   { width: 1, height: 32 },

  // Quick info row
  quickRow:  { flexDirection: 'row', gap: 10 },
  quickCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  quickIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  quickLabel:{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 3 },
  quickVal:  { fontSize: 13, fontWeight: '700' },
  quickSub:  { fontSize: 11, marginTop: 2 },

  // Tab strip
  tabStripWrap: { marginHorizontal: -16 },
  tabStrip:     { paddingHorizontal: 16, gap: 8 },
  tabPill:      { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  tabPillTxt:   { fontSize: 13, fontWeight: '700' },

  // Tab content
  tabContent: { gap: 10 },

  // Section card
  section:      { borderRadius: 18, borderWidth: 1, padding: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 12 },

  // Meta grid (2x2)
  metaGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaCard:     { width: '47%', borderRadius: 14, borderWidth: 1, padding: 14 },
  metaCardLabel:{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 },
  metaCardVal:  { fontSize: 15, fontWeight: '800' },

  // Info rows
  infoRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: 0.5 },
  infoRowLabel: { fontSize: 13 },
  infoRowVal:   { fontSize: 13, fontWeight: '600', maxWidth: '55%', textAlign: 'right' },
  allergyBanner:{ borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 8 },
  allergyTxt:   { fontSize: 13, fontWeight: '600', color: '#ef4444' },
  notesTxt:     { fontSize: 14, lineHeight: 21 },

  // Tags
  tagRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tagChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  tagTxt:  { fontSize: 12, fontWeight: '600' },

  // Appointments
  aptCard:      { borderRadius: 16, borderWidth: 1, borderLeftWidth: 3, padding: 14 },
  aptTop:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  aptService:   { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  aptDate:      { fontSize: 12 },
  aptNotes:     { fontSize: 12, marginTop: 8, lineHeight: 18 },
  statusBadge:  { borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  statusBadgeTxt:{ fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },

  // Messages
  bubble:    { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10 },
  bubbleTxt: { fontSize: 14, lineHeight: 20 },
  bubbleTs:  { fontSize: 10, marginTop: 4 },

  // Notes
  noteCard:   { borderRadius: 16, borderWidth: 1, padding: 14 },
  noteCardTxt:{ fontSize: 14, lineHeight: 21 },
  noteCardTs: { fontSize: 11, marginTop: 8 },

  // Empty state (tabs)
  emptyTab:    { borderRadius: 18, borderWidth: 1, paddingVertical: 40, alignItems: 'center', gap: 10 },
  emptyTabTxt: { fontSize: 14, fontWeight: '600' },
});
