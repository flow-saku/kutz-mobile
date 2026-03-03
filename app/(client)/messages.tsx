import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
  StyleSheet, StatusBar, FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, MessageCircle, Scissors, ChevronLeft, Users } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { getBarberProfile } from '@/lib/barber';
import { getActiveClientBinding } from '@/lib/clientSync';
import { format, isToday, isYesterday } from 'date-fns';
import { router } from 'expo-router';
import { useTheme } from '@/lib/theme';

interface Message {
  id: string;
  sender_type: 'barber' | 'client' | 'system';
  content: string;
  is_read: boolean;
  created_at: string;
}

interface BarberThread {
  barberId: string;
  clientId: string;
  name: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  conversationId?: string | null;
}

function msgTime(iso: string) {
  try {
    const d = new Date(iso);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
    return format(d, 'MMM d, h:mm a');
  } catch { return ''; }
}

function formatPreviewTime(iso?: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d');
  } catch { return ''; }
}

function parseMessages(raw: any): Message[] {
  if (!raw) return [];
  const src = raw?.messages ?? raw;
  if (Array.isArray(src)) return src as Message[];
  if (typeof src === 'string') {
    try { const p = JSON.parse(src); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// Keep in sync with _layout.tsx BAR_HEIGHT
const TAB_BAR_HEIGHT = 72;

export default function MessagesScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 12;

  // ── Shared state ──────────────────────────────────────────────────────────
  const [loading, setLoading]       = useState(true);
  const [hasShop, setHasShop]       = useState(true);
  const [threads, setThreads]       = useState<BarberThread[]>([]);

  // ── Active chat state ─────────────────────────────────────────────────────
  const [selected, setSelected]     = useState<BarberThread | null>(null);
  const [sending, setSending]       = useState(false);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [draft, setDraft]           = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [rpcError, setRpcError]     = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 80);
  }, []);

  // ── Dynamic colors ────────────────────────────────────────────────────────
  const bg       = isDark ? C.bg  : '#ffffff';
  const bg2      = isDark ? C.bg2 : '#f5f5f5';
  const bg3      = isDark ? C.bg3 : '#efefef';
  const border   = isDark ? C.border : '#e6e6e6';
  const textCol  = isDark ? C.text  : '#161616';
  const text2    = isDark ? C.text2 : '#737373';
  const text3    = isDark ? C.text3 : '#a3a3a3';
  const accent   = C.accent;
  const accentText = C.accentText;

  // ── Load inbox (all barbers/team members this client is linked to) ────────
  const loadInbox = useCallback(async () => {
    try {
      setRpcError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

      // Fetch all client rows for this auth user (one per barber/shop)
      const { data: clientRows, error } = await supabase
        .from('clients')
        .select('id, barber_id, name, updated_at')
        .eq('auth_user_id', session.user.id)
        .order('updated_at', { ascending: false, nullsFirst: false });

      if (error || !clientRows || clientRows.length === 0) {
        setHasShop(false);
        setLoading(false);
        return;
      }

      setHasShop(true);

      // For each client row, fetch the barber profile and last conversation preview
      const built: BarberThread[] = [];
      for (const row of clientRows as any[]) {
        if (!row.barber_id) continue;

        // Resolve owner (in case raw barber_id is a team member id, not owner)
        const profile = await getBarberProfile(row.barber_id);
        const resolvedBarberId = profile ? (profile as any).user_id ?? row.barber_id : row.barber_id;
        const name = (profile as any)?.shop_name || (profile as any)?.display_name || 'Barber';

        // Fetch conversation preview
        const { data: convData } = await supabase
          .from('conversations')
          .select('id, last_message, last_message_at, unread_count')
          .eq('barber_id', resolvedBarberId)
          .eq('client_id', row.id)
          .maybeSingle();

        built.push({
          barberId: resolvedBarberId,
          clientId: row.id,
          name,
          lastMessage: (convData as any)?.last_message ?? undefined,
          lastMessageAt: (convData as any)?.last_message_at ?? undefined,
          unreadCount: (convData as any)?.unread_count ?? 0,
          conversationId: (convData as any)?.id ?? null,
        });
      }

      // De-duplicate by barberId (keep first/most recent)
      const seen = new Set<string>();
      const deduped = built.filter(t => {
        if (seen.has(t.barberId)) return false;
        seen.add(t.barberId);
        return true;
      });

      setThreads(deduped);
    } catch (e: any) {
      console.error('MessagesScreen inbox:', e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  // ── Open a chat thread ────────────────────────────────────────────────────
  const openChat = useCallback(async (thread: BarberThread) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(thread);
    setMessages([]);
    setConversationId(null);
    setRpcError(null);
    setChatLoading(true);

    try {
      const { data, error: rErr } = await supabase.rpc('client_get_messages', {
        p_barber_id: thread.barberId,
        p_client_id: thread.clientId,
      });
      if (rErr) {
        setRpcError(rErr.message);
        setChatLoading(false);
        return;
      }
      setConversationId((data as any)?.conversation_id ?? null);
      const msgs = parseMessages(data);
      setMessages(msgs);
      if (msgs.length > 0) scrollToBottom(false);
    } catch (e: any) {
      setRpcError(e.message);
    }
    setChatLoading(false);
  }, [scrollToBottom]);

  // ── Back to inbox ─────────────────────────────────────────────────────────
  const goBack = useCallback(() => {
    setSelected(null);
    setMessages([]);
    setDraft('');
    setConversationId(null);
    setRpcError(null);
    loadInbox(); // refresh previews
  }, [loadInbox]);

  // ── Realtime for active chat ───────────────────────────────────────────────
  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`client_chat_${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const msg = payload.new as Message;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        if (msg.sender_type === 'barber') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        scrollToBottom();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0 && !chatLoading) scrollToBottom();
  }, [messages.length]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!selected || !draft.trim() || sending) return;
    const text = draft.trim();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    setDraft('');

    const tempId = `temp_${Date.now()}`;
    const temp: Message = { id: tempId, sender_type: 'client', content: text, is_read: false, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, temp]);
    scrollToBottom();

    try {
      const { data, error: rErr } = await supabase.rpc('client_send_message', {
        p_barber_id: selected.barberId,
        p_client_id: selected.clientId,
        p_content: text,
      });
      if (rErr) throw rErr;
      if (!conversationId && (data as any)?.conversation_id) setConversationId((data as any).conversation_id);
      // Refresh messages
      const { data: fresh } = await supabase.rpc('client_get_messages', {
        p_barber_id: selected.barberId,
        p_client_id: selected.clientId,
      });
      setMessages(parseMessages(fresh));
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setDraft(text);
      Alert.alert('Failed to send', e.message || 'Please try again');
    }
    setSending(false);
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <View style={[S.loader, { backgroundColor: bg }]}>
      <ActivityIndicator color={accent} size="large" />
    </View>
  );

  // ── No shop ───────────────────────────────────────────────────────────────
  if (!hasShop) return (
    <SafeAreaView style={[S.container, { backgroundColor: bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bg} />
      <View style={[S.header, { borderBottomColor: border }]}>
        <Text style={[S.headerName, { color: textCol }]}>Messages</Text>
      </View>
      <View style={S.centred}>
        <View style={[S.emptyIconBox, { backgroundColor: bg2, borderColor: border }]}>
          <Scissors color={text3} size={26} strokeWidth={1.5} />
        </View>
        <Text style={[S.emptyH, { color: textCol }]}>No barbershop connected</Text>
        <Text style={[S.emptyP, { color: text2 }]}>Join a shop first to message your barber</Text>
        <TouchableOpacity style={[S.ctaBtn, { backgroundColor: accent }]} onPress={() => router.push('/(client)/discover')} activeOpacity={0.85}>
          <Text style={[S.ctaBtnTxt, { color: accentText }]}>Find a shop</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  // ── Active chat view ──────────────────────────────────────────────────────
  if (selected) return (
    <SafeAreaView style={[S.container, { backgroundColor: bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bg} />

      {/* Header */}
      <View style={[S.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={goBack} style={S.backBtn} activeOpacity={0.7}>
          <ChevronLeft color={textCol} size={22} strokeWidth={2} />
        </TouchableOpacity>
        <View style={[S.avatar, { backgroundColor: bg2, borderColor: border }]}>
          <Text style={[S.avatarTxt, { color: textCol }]}>{selected.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[S.headerName, { color: textCol }]}>{selected.name}</Text>
          <Text style={[S.headerSub, { color: text3 }]}>Messages</Text>
        </View>
      </View>

      {rpcError ? (
        <View style={S.centred}>
          <Text style={[S.emptyH, { color: textCol }]}>Could not load messages</Text>
          <Text style={[S.emptyP, { color: text2 }]}>{rpcError}</Text>
          <TouchableOpacity
            style={[S.ctaBtn, { backgroundColor: accent }]}
            onPress={() => openChat(selected)}
            activeOpacity={0.85}
          >
            <Text style={[S.ctaBtnTxt, { color: accentText }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[S.msgList, { paddingBottom: tabBarClearance + 8 }]}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
          >
            {chatLoading ? (
              <View style={{ paddingTop: 80, alignItems: 'center' }}>
                <ActivityIndicator color={accent} />
              </View>
            ) : messages.length === 0 ? (
              <View style={S.emptyChat}>
                <View style={[S.emptyChatIcon, { backgroundColor: bg2, borderColor: border }]}>
                  <MessageCircle color={text3} size={26} strokeWidth={1.5} />
                </View>
                <Text style={[S.emptyChatH, { color: text2 }]}>Start the conversation</Text>
                <Text style={[S.emptyChatP, { color: text3 }]}>Send a message to {selected.name}</Text>
              </View>
            ) : messages.map((msg, idx) => {
              const isClient = msg.sender_type === 'client';
              const isSystem = msg.sender_type === 'system';
              const isTemp   = msg.id.startsWith('temp_');
              const prev     = messages[idx - 1];
              const showDate = !prev || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              return (
                <View key={msg.id}>
                  {showDate && (
                    <View style={S.dateSep}>
                      <Text style={[S.dateSepTxt, { color: text3, backgroundColor: bg2 }]}>
                        {isToday(new Date(msg.created_at)) ? 'Today'
                          : isYesterday(new Date(msg.created_at)) ? 'Yesterday'
                          : format(new Date(msg.created_at), 'MMMM d')}
                      </Text>
                    </View>
                  )}
                  <View style={[S.row, isClient ? S.rowR : S.rowL]}>
                    {isSystem ? (
                      <View style={[S.sysBubble, { backgroundColor: bg2, borderColor: border }]}>
                        <Text style={[S.sysTxt, { color: text2 }]}>{msg.content}</Text>
                      </View>
                    ) : (
                      <View style={[
                        S.bubble,
                        isClient
                          ? [S.bubbleMe, { backgroundColor: accent }]
                          : [S.bubbleThem, { backgroundColor: bg2, borderColor: border }],
                        isTemp && { opacity: 0.5 },
                      ]}>
                        <Text style={[S.bubbleTxt, { color: isClient ? accentText : textCol }]}>{msg.content}</Text>
                        <Text style={[S.bubbleTs, { color: isClient ? (isDark ? '#00000080' : '#ffffff80') : text3 }]}>
                          {msgTime(msg.created_at)}{isTemp ? ' · Sending' : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Input bar */}
          <View style={[
            S.inputBar,
            {
              borderTopColor: border,
              backgroundColor: bg,
              paddingBottom: tabBarClearance,
            },
          ]}>
            <TextInput
              style={[S.input, { backgroundColor: bg2, borderColor: border, color: textCol }]}
              placeholder="Message…"
              placeholderTextColor={text3}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[S.sendBtn, { backgroundColor: draft.trim() ? accent : bg3, marginBottom: 0 }]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              activeOpacity={0.85}
            >
              {sending
                ? <ActivityIndicator color={draft.trim() ? accentText : text3} size="small" />
                : <Send color={draft.trim() ? accentText : text3} size={16} strokeWidth={2.2} />
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );

  // ── Inbox list view ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[S.container, { backgroundColor: bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bg} />

      {/* Header */}
      <View style={[S.header, { borderBottomColor: border }]}>
        <Text style={[S.headerName, { color: textCol }]}>Messages</Text>
      </View>

      {threads.length === 0 ? (
        <View style={S.centred}>
          <View style={[S.emptyIconBox, { backgroundColor: bg2, borderColor: border }]}>
            <Users color={text3} size={26} strokeWidth={1.5} />
          </View>
          <Text style={[S.emptyH, { color: textCol }]}>No chats yet</Text>
          <Text style={[S.emptyP, { color: text2 }]}>Your messages with barbers will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={t => t.barberId}
          contentContainerStyle={{ paddingBottom: tabBarClearance + 8 }}
          renderItem={({ item: thread }) => (
            <TouchableOpacity
              style={[S.threadRow, { borderBottomColor: border }]}
              onPress={() => openChat(thread)}
              activeOpacity={0.7}
            >
              <View style={[S.threadAvatar, { backgroundColor: bg2, borderColor: border }]}>
                <Text style={[S.threadAvatarTxt, { color: textCol }]}>
                  {thread.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={S.threadTopRow}>
                  <Text style={[S.threadName, { color: textCol }, (thread.unreadCount ?? 0) > 0 && { fontWeight: '800' }]} numberOfLines={1}>
                    {thread.name}
                  </Text>
                  {thread.lastMessageAt && (
                    <Text style={[S.threadTime, { color: text3 }]}>{formatPreviewTime(thread.lastMessageAt)}</Text>
                  )}
                </View>
                <Text style={[S.threadPreview, { color: (thread.unreadCount ?? 0) > 0 ? text2 : text3 }, (thread.unreadCount ?? 0) > 0 && { fontWeight: '600' }]} numberOfLines={1}>
                  {thread.lastMessage || 'Tap to start chatting'}
                </Text>
              </View>
              {(thread.unreadCount ?? 0) > 0 && (
                <View style={[S.unreadBadge, { backgroundColor: accent }]}>
                  <Text style={[S.unreadTxt, { color: accentText }]}>{thread.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn:   { marginRight: 2, padding: 2 },
  avatar:    { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '900' },
  headerName:{ fontSize: 15, fontWeight: '700' },
  headerSub: { fontSize: 11, marginTop: 1 },

  // Inbox thread list
  threadRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, gap: 12,
  },
  threadAvatar:    { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  threadAvatarTxt: { fontSize: 18, fontWeight: '900' },
  threadTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  threadName:      { fontSize: 14, fontWeight: '700', flex: 1, marginRight: 8 },
  threadTime:      { fontSize: 11, flexShrink: 0 },
  threadPreview:   { fontSize: 13 },
  unreadBadge:     { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  unreadTxt:       { fontSize: 10, fontWeight: '800' },

  // Chat messages
  msgList: { paddingHorizontal: 14, paddingTop: 12, gap: 2 },

  dateSep:    { alignItems: 'center', marginVertical: 14 },
  dateSepTxt: { fontSize: 11, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },

  emptyChat:     { alignItems: 'center', paddingTop: 90, gap: 10 },
  emptyChatIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyChatH:    { fontSize: 16, fontWeight: '700' },
  emptyChatP:    { fontSize: 13 },

  row:  { flexDirection: 'row', marginBottom: 2 },
  rowR: { justifyContent: 'flex-end' },
  rowL: { justifyContent: 'flex-start' },

  bubble:    { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMe:  { borderBottomRightRadius: 4 },
  bubbleThem:{ borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleTxt: { fontSize: 14, lineHeight: 20 },
  bubbleTs:  { fontSize: 10, marginTop: 3 },

  sysBubble: { alignSelf: 'center', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1 },
  sysTxt:    { fontSize: 11, fontStyle: 'italic' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 9,
    paddingHorizontal: 14, paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1, borderRadius: 20,
    paddingHorizontal: 15, paddingVertical: 10,
    fontSize: 14, maxHeight: 120,
    borderWidth: 1, lineHeight: 20,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },

  emptyIconBox: { width: 70, height: 70, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 18 },
  emptyH:       { fontSize: 17, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  emptyP:       { fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 24 },
  ctaBtn:       { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  ctaBtnTxt:    { fontSize: 14, fontWeight: '700' },
});
