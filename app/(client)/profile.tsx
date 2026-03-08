import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft, CalendarCheck, Clock, MessageCircle, Scissors, Sparkles, StickyNote,
} from 'lucide-react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { getActiveClientBinding } from '@/lib/clientSync';

type ProfileField = string | null | undefined;

interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  visit_count: number;
  last_visit: string | null;
  notes: string | null;
  created_at: string;
  average_spend?: number | null;
  birthday?: string | null;
  tags?: string[];
  hair_type?: ProfileField;
  hair_texture?: ProfileField;
  preferred_length?: ProfileField;
  color_history?: ProfileField;
  allergies?: ProfileField;
  preferred_service_name?: ProfileField;
  preferred_day?: ProfileField;
  preferred_time?: ProfileField;
  payment_method?: ProfileField;
}

interface AptRow {
  id: string;
  date: string;
  start_time: string | null;
  status?: string | null;
  service_name?: string | null;
}

interface MsgRow {
  id: string;
  sender_type: 'barber' | 'client' | 'system';
  content: string;
  created_at: string;
}

interface NoteRow {
  id: string;
  note: string;
  created_at: string;
}

const TIERS = [
  { tier: 'new', label: 'New', icon: '✦', minVisits: 0, color: '#737373' },
  { tier: 'bronze', label: 'Bronze', icon: '◆', minVisits: 1, color: '#92400e' },
  { tier: 'silver', label: 'Silver', icon: '◈', minVisits: 5, color: '#475569' },
  { tier: 'gold', label: 'Gold', icon: '★', minVisits: 12, color: '#d97706' },
  { tier: 'platinum', label: 'Platinum', icon: '⬢', minVisits: 25, color: '#7c3aed' },
  { tier: 'diamond', label: 'Diamond', icon: '◇', minVisits: 50, color: '#2563eb' },
] as const;

function getTier(visits: number) {
  let tier: (typeof TIERS)[number] = TIERS[0];
  for (const current of TIERS) if (visits >= current.minVisits) tier = current;
  return tier;
}

function normalizeClient(row: any): ClientRow {
  const name = row?.name || row?.full_name || (row?.email ? String(row.email).split('@')[0] : 'Client');
  return {
    id: String(row?.id ?? ''),
    name: String(name || 'Client'),
    email: String(row?.email ?? ''),
    phone: row?.phone ?? null,
    visit_count: Number(row?.visit_count ?? 0),
    last_visit: row?.last_visit ?? null,
    notes: row?.notes ?? null,
    created_at: String(row?.created_at ?? new Date().toISOString()),
    average_spend: row?.average_spend ?? null,
    birthday: row?.birthday ?? null,
    tags: Array.isArray(row?.tags) ? row.tags : [],
    hair_type: row?.hair_type ?? null,
    hair_texture: row?.hair_texture ?? null,
    preferred_length: row?.preferred_length ?? null,
    color_history: row?.color_history ?? null,
    allergies: row?.allergies ?? null,
    preferred_service_name: row?.preferred_service_name ?? row?.preferred_service ?? null,
    preferred_day: row?.preferred_day ?? null,
    preferred_time: row?.preferred_time ?? null,
    payment_method: row?.payment_method ?? null,
  };
}

function safeFmt(input: any, pattern: string) {
  if (!input) return null;
  try {
    const raw = String(input).trim();
    if (!raw) return null;
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : format(date, pattern);
  } catch {
    return null;
  }
}

function fmt12(time: string | null | undefined) {
  if (!time) return null;
  try {
    const [hours, minutes] = String(time).split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return String(time).slice(0, 5);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  } catch {
    return String(time).slice(0, 5);
  }
}

export default function ClientProfileScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [upcomingApt, setUpcomingApt] = useState<AptRow | null>(null);
  const [lastApt, setLastApt] = useState<AptRow | null>(null);
  const [messageHistory, setMessageHistory] = useState<MsgRow[]>([]);
  const [noteHistory, setNoteHistory] = useState<NoteRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

      const binding = await getActiveClientBinding(session.user.id);
      const clientRes = await supabase.from('clients').select('*').eq('auth_user_id', session.user.id).maybeSingle();
      const clientData = clientRes.data ? normalizeClient(clientRes.data) : null;
      if (!binding || !clientData) { setClient(clientData); setLoading(false); return; }

      const today = new Date().toISOString().split('T')[0];
      const [ptsRes, upRes, lastRes, notesRes, convRes] = await Promise.all([
        supabase.from('loyalty_points').select('points_balance').eq('client_id', clientData.id).eq('barber_id', binding.barberId).maybeSingle(),
        supabase.from('appointments').select('id, date, start_time, status, service_name')
          .eq('barber_id', binding.barberId).eq('client_id', clientData.id)
          .in('status', ['confirmed', 'pending']).gte('date', today).order('date', { ascending: true }).limit(1).maybeSingle(),
        supabase.from('appointments').select('id, date, start_time, status, service_name')
          .eq('barber_id', binding.barberId).eq('client_id', clientData.id)
          .eq('status', 'completed').order('date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('client_notes').select('id, note, created_at')
          .eq('barber_id', binding.barberId).eq('client_id', clientData.id)
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('conversations').select('id')
          .eq('barber_id', binding.barberId).eq('client_id', clientData.id).maybeSingle(),
      ]);

      let msgs: MsgRow[] = [];
      const convId = (convRes.data as any)?.id;
      if (convId) {
        const { data } = await supabase.from('messages')
          .select('id, sender_type, content, created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: false })
          .limit(20);
        msgs = ((data as any[]) ?? []).map(msg => ({
          id: String(msg.id),
          sender_type: msg.sender_type ?? 'system',
          content: String(msg.content ?? ''),
          created_at: String(msg.created_at),
        }));
      }

      setClient(clientData);
      setPointsBalance(Number((ptsRes.data as any)?.points_balance ?? 0));
      setUpcomingApt((upRes.data as any) ?? null);
      setLastApt((lastRes.data as any) ?? null);
      setNoteHistory(((notesRes.data as any[]) ?? []).map(note => ({
        id: String(note.id),
        note: String(note.note ?? ''),
        created_at: String(note.created_at),
      })));
      setMessageHistory(msgs);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <View style={[S.loader, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  if (!client) {
    return (
      <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
        <View style={[S.header, { borderBottomColor: C.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={[S.backBtn, { backgroundColor: C.bg2, borderColor: C.border }]} activeOpacity={0.8}>
            <ChevronLeft color={C.text} size={18} />
          </TouchableOpacity>
          <Text style={[S.headerTitle, { color: C.text }]}>My Profile</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={S.emptyWrap}>
          <Text style={[S.emptyTitle, { color: C.text }]}>No client profile yet</Text>
          <Text style={[S.emptySub, { color: C.text3 }]}>Book with a shop first and your client card will appear here.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const tier = getTier(client.visit_count);
  const initials = client.name.split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      <View style={[S.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={[S.backBtn, { backgroundColor: C.bg2, borderColor: C.border }]}
          activeOpacity={0.8}
        >
          <ChevronLeft color={C.text} size={18} />
        </TouchableOpacity>
        <Text style={[S.headerTitle, { color: C.text }]}>My Profile</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 36 }]} showsVerticalScrollIndicator={false}>
        <View style={[S.heroCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={S.heroTop}>
            <View>
              <Text style={[S.heroEyebrow, { color: C.text3 }]}>CLIENT CARD</Text>
              <Text style={[S.heroTitle, { color: C.text }]}>This is what your barber sees in Clients</Text>
            </View>
            <View style={[S.sparkBadge, { backgroundColor: C.bg2, borderColor: C.border }]}>
              <Sparkles color={C.accent} size={13} />
            </View>
          </View>

          <View style={[S.avatarWrap, { backgroundColor: `${tier.color}18`, borderColor: `${tier.color}40` }]}>
            <Text style={[S.avatarTxt, { color: tier.color }]}>{initials}</Text>
          </View>
          <Text style={[S.name, { color: C.text }]}>{client.name}</Text>
          <Text style={[S.contact, { color: C.text2 }]}>{client.email || client.phone || 'No contact info'}</Text>

          <View style={[S.tierPill, { backgroundColor: `${tier.color}18`, borderColor: `${tier.color}35` }]}>
            <Text style={[S.tierPillTxt, { color: tier.color }]}>{tier.icon} {tier.label}</Text>
          </View>

          <View style={S.metricRow}>
            <View style={[S.metricCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
              <Text style={[S.metricValue, { color: C.text }]}>{client.visit_count}</Text>
              <Text style={[S.metricLabel, { color: C.text3 }]}>Visits</Text>
            </View>
            <View style={[S.metricCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
              <Text style={[S.metricValue, { color: C.text }]}>{pointsBalance}</Text>
              <Text style={[S.metricLabel, { color: C.text3 }]}>Points</Text>
            </View>
            <View style={[S.metricCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
              <Text style={[S.metricValue, { color: C.text }]}>{client.average_spend ? `$${Math.round(Number(client.average_spend))}` : '—'}</Text>
              <Text style={[S.metricLabel, { color: C.text3 }]}>Avg spend</Text>
            </View>
          </View>
        </View>

        {(upcomingApt || lastApt) && (
          <View style={S.quickRow}>
            {upcomingApt && (
              <View style={[S.quickCard, { backgroundColor: `${C.accent}10`, borderColor: `${C.accent}28` }]}>
                <View style={[S.quickIcon, { backgroundColor: `${C.accent}18` }]}>
                  <CalendarCheck color={C.accent} size={14} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.quickLabel, { color: C.accent }]}>UPCOMING</Text>
                  <Text style={[S.quickVal, { color: C.text }]}>
                    {safeFmt(upcomingApt.date, 'EEE, MMM d') ?? 'Soon'}
                    {upcomingApt.start_time ? ` · ${fmt12(upcomingApt.start_time)}` : ''}
                  </Text>
                  {!!upcomingApt.service_name && <Text style={[S.quickSub, { color: C.text3 }]}>{upcomingApt.service_name}</Text>}
                </View>
              </View>
            )}
            {lastApt && (
              <View style={[S.quickCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <View style={[S.quickIcon, { backgroundColor: C.bg2 }]}>
                  <Clock color={C.text3} size={14} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.quickLabel, { color: C.text3 }]}>LAST VISIT</Text>
                  <Text style={[S.quickVal, { color: C.text }]}>{safeFmt(lastApt.date, 'MMM d, yyyy') ?? 'Recent'}</Text>
                  {!!lastApt.service_name && <Text style={[S.quickSub, { color: C.text3 }]}>{lastApt.service_name}</Text>}
                </View>
              </View>
            )}
          </View>
        )}

        {!!client.tags?.length && (
          <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[S.sectionLabel, { color: C.text3 }]}>TAGS</Text>
            <View style={S.tagRow}>
              {client.tags.map(tag => (
                <View key={tag} style={[S.tagChip, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <Text style={[S.tagTxt, { color: C.text2 }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={S.metaGrid}>
          {[
            { label: 'Birthday', value: safeFmt(client.birthday, 'MMM d') ?? '—' },
            { label: 'Payment', value: client.payment_method || '—' },
            { label: 'Client since', value: safeFmt(client.created_at, 'MMM yyyy') ?? '—' },
            { label: 'Preferred service', value: client.preferred_service_name || '—' },
          ].map(item => (
            <View key={item.label} style={[S.metaCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <Text style={[S.metaLabel, { color: C.text3 }]}>{item.label}</Text>
              <Text style={[S.metaValue, { color: C.text }]} numberOfLines={1}>{item.value}</Text>
            </View>
          ))}
        </View>

        {(client.hair_type || client.hair_texture || client.preferred_length || client.color_history || client.allergies) && (
          <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[S.sectionLabel, { color: C.text3 }]}>HAIR PROFILE</Text>
            {[
              { label: 'Type', value: client.hair_type },
              { label: 'Texture', value: client.hair_texture },
              { label: 'Length', value: client.preferred_length },
              { label: 'Color history', value: client.color_history },
            ].filter(item => item.value).map(item => (
              <View key={item.label} style={S.infoRow}>
                <Text style={[S.infoLabel, { color: C.text3 }]}>{item.label}</Text>
                <Text style={[S.infoValue, { color: C.text }]}>{item.value}</Text>
              </View>
            ))}
            {!!client.allergies && (
              <View style={S.alertWrap}>
                <Text style={S.alertTxt}>⚠ {client.allergies}</Text>
              </View>
            )}
          </View>
        )}

        {!!client.notes && (
          <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[S.sectionLabel, { color: C.text3 }]}>PROFILE NOTES</Text>
            <Text style={[S.notesText, { color: C.text }]}>{client.notes}</Text>
          </View>
        )}

        {noteHistory.length > 0 && (
          <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={S.sectionTitleRow}>
              <StickyNote color={C.text3} size={15} />
              <Text style={[S.sectionTitle, { color: C.text }]}>Recent notes</Text>
            </View>
            {noteHistory.map(note => (
              <View key={note.id} style={[S.timelineCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
                <Text style={[S.timelineText, { color: C.text }]}>{note.note}</Text>
                <Text style={[S.timelineTs, { color: C.text3 }]}>{safeFmt(note.created_at, 'MMM d, yyyy · h:mm a') ?? ''}</Text>
              </View>
            ))}
          </View>
        )}

        {messageHistory.length > 0 && (
          <View style={[S.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={S.sectionTitleRow}>
              <MessageCircle color={C.text3} size={15} />
              <Text style={[S.sectionTitle, { color: C.text }]}>Recent chat activity</Text>
            </View>
            {messageHistory.map(message => {
              const isClient = message.sender_type === 'client';
              return (
                <View key={message.id} style={[S.timelineCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
                  <Text style={[S.timelineRole, { color: isClient ? C.accent : C.text3 }]}>
                    {isClient ? 'You' : message.sender_type === 'barber' ? 'Barber' : 'System'}
                  </Text>
                  <Text style={[S.timelineText, { color: C.text }]}>{message.content}</Text>
                  <Text style={[S.timelineTs, { color: C.text3 }]}>{safeFmt(message.created_at, 'MMM d, h:mm a') ?? ''}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={[S.footerCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
          <Scissors color={C.accent} size={16} />
          <Text style={[S.footerText, { color: C.text2 }]}>Your profile is synced from the same client record used in the barber app.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  scroll: { paddingHorizontal: 16, paddingTop: 18 },
  heroCard: { borderRadius: 28, borderWidth: 1, padding: 18, marginBottom: 14 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  heroEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  heroTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.6, marginTop: 8, maxWidth: 250 },
  sparkBadge: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 18,
    marginBottom: 14,
  },
  avatarTxt: { fontSize: 30, fontWeight: '900' },
  name: { fontSize: 28, fontWeight: '900', letterSpacing: -0.8, textAlign: 'center' },
  contact: { fontSize: 13, textAlign: 'center', marginTop: 6 },
  tierPill: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  tierPillTxt: { fontSize: 13, fontWeight: '800' },
  metricRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  metricCard: { flex: 1, borderRadius: 18, borderWidth: 1, paddingVertical: 15, alignItems: 'center' },
  metricValue: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  metricLabel: { fontSize: 11, marginTop: 4 },
  quickRow: { gap: 10, marginBottom: 14 },
  quickCard: { borderRadius: 20, borderWidth: 1, padding: 14, flexDirection: 'row', gap: 12 },
  quickIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  quickVal: { fontSize: 14, fontWeight: '700' },
  quickSub: { fontSize: 12, marginTop: 4 },
  section: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 14 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.9, marginBottom: 12 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  tagTxt: { fontSize: 12, fontWeight: '700' },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metaCard: { width: '48%', borderRadius: 18, borderWidth: 1, padding: 14 },
  metaLabel: { fontSize: 11, marginBottom: 6 },
  metaValue: { fontSize: 14, fontWeight: '700' },
  infoRow: { marginBottom: 12 },
  infoLabel: { fontSize: 12, marginBottom: 4 },
  infoValue: { fontSize: 14, fontWeight: '700' },
  alertWrap: { borderRadius: 14, borderWidth: 1, borderColor: '#ef444430', backgroundColor: '#ef444410', padding: 12, marginTop: 4 },
  alertTxt: { color: '#ef4444', fontSize: 13, fontWeight: '700' },
  notesText: { fontSize: 14, lineHeight: 21 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  timelineCard: { borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 10 },
  timelineRole: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  timelineText: { fontSize: 14, lineHeight: 20 },
  timelineTs: { fontSize: 11, marginTop: 8 },
  footerCard: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  footerText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
