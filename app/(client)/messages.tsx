import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
  StyleSheet, StatusBar, Animated, Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, MessageCircle, Scissors, ChevronLeft, Users, Hash, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { getBarberProfile } from '@/lib/barber';
import { format, isToday, isYesterday } from 'date-fns';
import { router } from 'expo-router';
import { useTheme } from '@/lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  isShopChannel?: boolean;   // true for the main shop DM
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  conversationId?: string | null;
}

interface StaffEntry {
  userId: string;
  displayName: string;
  thread: BarberThread;
}

interface ShopGroup {
  ownerId: string;
  shopName: string;
  clientId: string;
  shopThread: BarberThread;   // DM with the shop owner
  staff: StaffEntry[];        // individual team members
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msgTime(iso: string) {
  try {
    const d = new Date(iso);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
    return format(d, 'MMM d, h:mm a');
  } catch { return ''; }
}

function previewTime(iso?: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d');
  } catch { return ''; }
}

// ─── Spring-animated pressable ────────────────────────────────────────────────
function Tap({ onPress, style, children }: { onPress: () => void; style?: any; children: React.ReactNode }) {
  const s = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(s, { toValue: 0.97, useNativeDriver: true, tension: 600, friction: 32 }).start();
      }}
      onPressOut={() => Animated.spring(s, { toValue: 1, useNativeDriver: true, tension: 400, friction: 26 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
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

const TAB_BAR_HEIGHT = 72;

// ─── Component ───────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 12;

  const bg      = isDark ? C.bg  : '#ffffff';
  const bg2     = isDark ? C.bg2 : '#f5f5f5';
  const bg3     = isDark ? C.bg3 : '#efefef';
  const border  = isDark ? C.border : '#e6e6e6';
  const textCol = isDark ? C.text  : '#161616';
  const text2   = isDark ? C.text2 : '#737373';
  const text3   = isDark ? C.text3 : '#a3a3a3';
  const accent  = C.accent;
  const accentText = C.accentText;

  // ── State ─────────────────────────────────────────────────────────────────
  const [loading, setLoading]         = useState(true);
  const [hasShop, setHasShop]         = useState(true);
  const [shopGroups, setShopGroups]   = useState<ShopGroup[]>([]);

  // Active chat
  const [selected, setSelected]       = useState<BarberThread | null>(null);
  const [sending, setSending]         = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [draft, setDraft]             = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [rpcError, setRpcError]       = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 80);
  }, []);

  // ── Load inbox ────────────────────────────────────────────────────────────

  const loadInbox = useCallback(async () => {
    try {
      setRpcError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

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

      const groups: ShopGroup[] = [];
      const seenOwners = new Set<string>();

      for (const row of clientRows as any[]) {
        if (!row.barber_id) continue;

        const profile = await getBarberProfile(row.barber_id);
        const ownerUid  = (profile as any)?.user_id ?? row.barber_id;
        const shopName  = (profile as any)?.shop_name || (profile as any)?.display_name || 'Barbershop';

        // De-duplicate shops
        if (seenOwners.has(ownerUid)) continue;
        seenOwners.add(ownerUid);

        // Main shop conversation
        const { data: convData } = await supabase
          .from('conversations')
          .select('id, last_message, last_message_at, unread_count')
          .eq('barber_id', ownerUid)
          .eq('client_id', row.id)
          .maybeSingle();

        const shopThread: BarberThread = {
          barberId: ownerUid,
          clientId: row.id,
          name: shopName,
          isShopChannel: true,
          lastMessage: (convData as any)?.last_message ?? undefined,
          lastMessageAt: (convData as any)?.last_message_at ?? undefined,
          unreadCount: (convData as any)?.unread_count ?? 0,
          conversationId: (convData as any)?.id ?? null,
        };

        // Team members (individual barbers)
        const { data: memberData } = await supabase
          .from('team_members' as any)
          .select('user_id, display_name')
          .eq('shop_owner_id', ownerUid)
          .eq('is_active', true);

        const staff: StaffEntry[] = [];
        for (const member of ((memberData || []) as any[])) {
          if (!member.user_id) continue;
          const { data: mConv } = await supabase
            .from('conversations')
            .select('id, last_message, last_message_at, unread_count')
            .eq('barber_id', member.user_id)
            .eq('client_id', row.id)
            .maybeSingle();

          staff.push({
            userId: member.user_id,
            displayName: member.display_name || 'Team Member',
            thread: {
              barberId: member.user_id,
              clientId: row.id,
              name: member.display_name || 'Team Member',
              isShopChannel: false,
              lastMessage: (mConv as any)?.last_message ?? undefined,
              lastMessageAt: (mConv as any)?.last_message_at ?? undefined,
              unreadCount: (mConv as any)?.unread_count ?? 0,
              conversationId: (mConv as any)?.id ?? null,
            },
          });
        }

        groups.push({ ownerId: ownerUid, shopName, clientId: row.id, shopThread, staff });
      }

      setShopGroups(groups);
    } catch (e: any) {
      console.error('MessagesScreen inbox:', e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  // ── Open chat ─────────────────────────────────────────────────────────────

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
      if (rErr) { setRpcError(rErr.message); setChatLoading(false); return; }
      setConversationId((data as any)?.conversation_id ?? null);
      const msgs = parseMessages(data);
      setMessages(msgs);
      if (msgs.length > 0) scrollToBottom(false);
    } catch (e: any) { setRpcError(e.message); }
    setChatLoading(false);
  }, [scrollToBottom]);

  const goBack = useCallback(() => {
    setSelected(null);
    setMessages([]);
    setDraft('');
    setConversationId(null);
    setRpcError(null);
    loadInbox();
  }, [loadInbox]);

  // ── Realtime ──────────────────────────────────────────────────────────────

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

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!selected || !draft.trim() || sending) return;
    const text = draft.trim();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    setDraft('');
    const tempId = `temp_${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, sender_type: 'client', content: text, is_read: false, created_at: new Date().toISOString() }]);
    scrollToBottom();
    try {
      const { data, error: rErr } = await supabase.rpc('client_send_message', {
        p_barber_id: selected.barberId,
        p_client_id: selected.clientId,
        p_content: text,
      });
      if (rErr) throw rErr;
      if (!conversationId && (data as any)?.conversation_id) setConversationId((data as any).conversation_id);
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
        <Text style={[S.headerTitle, { color: textCol }]}>Messages</Text>
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

  // ── Active chat ───────────────────────────────────────────────────────────

  if (selected) return (
    <SafeAreaView style={[S.container, { backgroundColor: bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bg} />

      <View style={[S.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={goBack} style={S.backBtn} activeOpacity={0.7}>
          <ChevronLeft color={textCol} size={22} strokeWidth={2} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[S.chatHeroTap, { borderColor: border, backgroundColor: bg2 }]}
          activeOpacity={0.7}
          onPress={() => router.push({
            pathname: '/(client)/barber-profile',
            params: { barberId: selected.barberId, barberName: selected.name, isShopChannel: selected.isShopChannel ? 'true' : 'false' },
          })}
        >
          {selected.isShopChannel ? (
            <View style={[S.avatar, { backgroundColor: accent + '18' }]}>
              <Hash color={accent} size={18} strokeWidth={2.5} />
            </View>
          ) : (
            <View style={[S.avatar, { backgroundColor: bg2, borderColor: border, borderWidth: 1 }]}>
              <Text style={[S.avatarTxt, { color: textCol }]}>{selected.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[S.headerName, { color: textCol }]}>{selected.name}</Text>
            <Text style={[S.headerSub, { color: text3 }]}>{selected.isShopChannel ? 'Shop channel · tap to view' : 'Barber · tap to view'}</Text>
          </View>
          <View style={[S.chatHeroPill, { backgroundColor: bg, borderColor: border }]}>
            <Text style={[S.chatHeroPillTxt, { color: textCol }]}>Profile</Text>
          </View>
        </TouchableOpacity>
      </View>

      {rpcError ? (
        <View style={S.centred}>
          <Text style={[S.emptyH, { color: textCol }]}>Could not load messages</Text>
          <Text style={[S.emptyP, { color: text2 }]}>{rpcError}</Text>
          <TouchableOpacity style={[S.ctaBtn, { backgroundColor: accent }]} onPress={() => openChat(selected)} activeOpacity={0.85}>
            <Text style={[S.ctaBtnTxt, { color: accentText }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
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

          <View style={[S.inputBar, { borderTopColor: border, backgroundColor: bg, paddingBottom: tabBarClearance }]}>
            <View style={[S.inputShell, { backgroundColor: bg2, borderColor: border }]}>
              <TextInput
                style={[S.input, { color: textCol }]}
                placeholder="Send a polished update…"
                placeholderTextColor={text3}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[S.sendBtn, { backgroundColor: draft.trim() ? accent : bg3 }]}
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
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );

  // ── Inbox list ────────────────────────────────────────────────────────────

  const totalUnread = shopGroups.reduce((sum, g) => {
    return sum + (g.shopThread.unreadCount ?? 0) + g.staff.reduce((s2, m) => s2 + (m.thread.unreadCount ?? 0), 0);
  }, 0);

  return (
    <SafeAreaView style={[S.container, { backgroundColor: bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={bg} />

      <View style={[S.header, { borderBottomColor: border }]}>
        <Text style={[S.headerTitle, { color: textCol }]}>Messages</Text>
        {totalUnread > 0 && (
          <View style={[S.headerBadge, { backgroundColor: accent }]}>
            <Text style={[S.headerBadgeTxt, { color: accentText }]}>{totalUnread}</Text>
          </View>
        )}
      </View>

      {shopGroups.length === 0 ? (
        <View style={S.centred}>
          <View style={[S.emptyIconBox, { backgroundColor: bg2, borderColor: border }]}>
            <Users color={text3} size={26} strokeWidth={1.5} />
          </View>
          <Text style={[S.emptyH, { color: textCol }]}>No chats yet</Text>
          <Text style={[S.emptyP, { color: text2 }]}>Your messages with barbers will appear here</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: tabBarClearance + 8 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[S.overviewCard, { backgroundColor: bg2, borderColor: border }]}>
            <View style={S.overviewTop}>
              <View>
                <Text style={[S.overviewEyebrow, { color: text3 }]}>INBOX</Text>
                <Text style={[S.overviewTitle, { color: textCol }]}>Every shop conversation in one place</Text>
              </View>
              <View style={[S.overviewBadge, { backgroundColor: bg, borderColor: border }]}>
                <Sparkles color={accent} size={13} />
              </View>
            </View>
            <View style={S.overviewStats}>
              <View style={[S.overviewStatCard, { backgroundColor: bg, borderColor: border }]}>
                <Text style={[S.overviewStatValue, { color: textCol }]}>{shopGroups.length}</Text>
                <Text style={[S.overviewStatLabel, { color: text3 }]}>Shops</Text>
              </View>
              <View style={[S.overviewStatCard, { backgroundColor: bg, borderColor: border }]}>
                <Text style={[S.overviewStatValue, { color: textCol }]}>{totalUnread}</Text>
                <Text style={[S.overviewStatLabel, { color: text3 }]}>Unread</Text>
              </View>
            </View>
          </View>

          {shopGroups.map((group, gi) => (
            <View
              key={group.ownerId}
              style={[
                S.shopGroupCard,
                {
                  marginTop: gi > 0 ? 12 : 0,
                  backgroundColor: bg2,
                  borderColor: border,
                },
              ]}
            >

              <View style={[S.shopHeaderRow, { borderBottomColor: border }]}>
                <View style={[S.shopIconWrap, { backgroundColor: accent + '15' }]}>
                  <Scissors color={accent} size={14} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.shopHeaderName, { color: textCol }]}>{group.shopName}</Text>
                  <Text style={[S.shopHeaderMeta, { color: text3 }]}>
                    {group.staff.length > 0 ? `${group.staff.length} barbers available` : 'Direct shop messaging'}
                  </Text>
                </View>
              </View>

              <Tap
                onPress={() => openChat(group.shopThread)}
                style={[S.threadRow, {
                  borderBottomColor: border,
                  backgroundColor: (group.shopThread.unreadCount ?? 0) > 0 ? accent + '08' : bg,
                }]}
              >
                <View style={[S.channelAvatar, { backgroundColor: accent + '18' }]}>
                  <Hash color={accent} size={20} strokeWidth={2.5} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={S.threadTopRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
                      <Text style={[S.threadName, { color: textCol, fontWeight: '800' }]} numberOfLines={1}>
                        {group.shopName}
                      </Text>
                      <View style={{ backgroundColor: accent + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: accent, letterSpacing: 0.5 }}>SHOP</Text>
                      </View>
                    </View>
                    {group.shopThread.lastMessageAt && (
                      <Text style={[S.threadTime, { color: text3 }]}>{previewTime(group.shopThread.lastMessageAt)}</Text>
                    )}
                  </View>
                  <Text style={[S.threadPreview, { color: (group.shopThread.unreadCount ?? 0) > 0 ? text2 : text3, fontWeight: (group.shopThread.unreadCount ?? 0) > 0 ? '600' : '400' }]} numberOfLines={1}>
                    {group.shopThread.lastMessage || 'Tap to message the shop'}
                  </Text>
                </View>
                {(group.shopThread.unreadCount ?? 0) > 0 && (
                  <View style={[S.unreadBadge, { backgroundColor: accent }]}>
                    <Text style={[S.unreadTxt, { color: accentText }]}>{group.shopThread.unreadCount}</Text>
                  </View>
                )}
              </Tap>

              {group.staff.length > 0 && (
                <>
                  <View style={[S.staffLabel, { borderBottomColor: border }]}>
                    <Text style={[S.staffLabelTxt, { color: text3 }]}>BARBERS</Text>
                  </View>
                  {group.staff.map((member, mi) => (
                    <Tap
                      key={member.userId}
                      onPress={() => openChat(member.thread)}
                      style={[S.threadRow, {
                        borderBottomColor: mi < group.staff.length - 1 ? border : 'transparent',
                        backgroundColor: (member.thread.unreadCount ?? 0) > 0 ? accent + '08' : bg,
                      }]}
                    >
                      <View style={[S.memberAvatar, { backgroundColor: bg2, borderColor: border }]}>
                        <Text style={[S.memberAvatarTxt, { color: textCol }]}>
                          {member.displayName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={S.threadTopRow}>
                          <Text style={[S.threadName, { color: textCol, fontWeight: (member.thread.unreadCount ?? 0) > 0 ? '800' : '600' }]} numberOfLines={1}>
                            {member.displayName}
                          </Text>
                          {member.thread.lastMessageAt && (
                            <Text style={[S.threadTime, { color: text3 }]}>{previewTime(member.thread.lastMessageAt)}</Text>
                          )}
                        </View>
                        <Text style={[S.threadPreview, { color: (member.thread.unreadCount ?? 0) > 0 ? text2 : text3, fontWeight: (member.thread.unreadCount ?? 0) > 0 ? '600' : '400' }]} numberOfLines={1}>
                          {member.thread.lastMessage || 'Barber · tap to message'}
                        </Text>
                      </View>
                      {(member.thread.unreadCount ?? 0) > 0 && (
                        <View style={[S.unreadBadge, { backgroundColor: accent }]}>
                          <Text style={[S.unreadTxt, { color: accentText }]}>{member.thread.unreadCount}</Text>
                        </View>
                      )}
                    </Tap>
                  ))}
                </>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container: { flex: 1 },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn:      { marginRight: 2, padding: 2 },
  avatar:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:    { fontSize: 16, fontWeight: '900' },
  headerTitle:  { fontSize: 22, fontWeight: '900', letterSpacing: -0.5, flex: 1 },
  headerName:   { fontSize: 15, fontWeight: '700' },
  headerSub:    { fontSize: 11, marginTop: 1 },
  headerBadge:  { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  headerBadgeTxt: { fontSize: 11, fontWeight: '800' },
  chatHeroTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chatHeroPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chatHeroPillTxt: { fontSize: 11, fontWeight: '700' },

  // Inbox
  overviewCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 14,
  },
  overviewTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  overviewEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  overviewTitle: { fontSize: 20, fontWeight: '900', letterSpacing: -0.6, marginTop: 8, maxWidth: 240 },
  overviewBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  overviewStats: { flexDirection: 'row', gap: 10, marginTop: 16 },
  overviewStatCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  overviewStatValue: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  overviewStatLabel: { fontSize: 11, marginTop: 4 },
  shopGroupCard: {
    borderRadius: 24,
    borderWidth: 1,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  shopHeaderRow:  { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1 },
  shopIconWrap:   { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  shopHeaderName: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  shopHeaderMeta: { fontSize: 12, marginTop: 2 },

  staffLabel:     { paddingHorizontal: 18, paddingVertical: 7, borderBottomWidth: 1 },
  staffLabelTxt:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  threadRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, gap: 13 },
  channelAvatar:{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  memberAvatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  memberAvatarTxt: { fontSize: 18, fontWeight: '900' },
  threadTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  threadName:   { fontSize: 14, flex: 1, marginRight: 8 },
  threadTime:   { fontSize: 11, flexShrink: 0 },
  threadPreview:{ fontSize: 13 },
  unreadBadge:  { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  unreadTxt:    { fontSize: 10, fontWeight: '800' },

  // Chat
  msgList:    { paddingHorizontal: 14, paddingTop: 12, gap: 2 },
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

  inputBar: { paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1 },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
  },
  input:    { flex: 1, fontSize: 14, maxHeight: 120, lineHeight: 20, paddingTop: 4, paddingBottom: 4 },
  sendBtn:  { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },

  emptyIconBox: { width: 70, height: 70, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 18 },
  emptyH:       { fontSize: 17, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  emptyP:       { fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 24 },
  ctaBtn:       { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  ctaBtnTxt:    { fontSize: 14, fontWeight: '700' },
});
