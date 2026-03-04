import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput, KeyboardAvoidingView, Platform, Alert,
  StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, Send, ArrowLeft, Hash, Users } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { resolveBarberScope } from '@/lib/barber';
import { format, isToday, isYesterday } from 'date-fns';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientConv {
  id: string; client_id: string; client_name: string;
  last_message: string | null; last_message_at: string | null; unread_count: number;
}
interface ClientMessage {
  id: string; sender_type: 'barber' | 'client' | 'system';
  content: string; is_read: boolean; created_at: string;
}

interface TeamChannel {
  id: string; shop_owner_id: string; name: string;
  description: string | null; last_message: string | null; last_message_at: string | null;
}
interface ChannelMessage {
  id: string; channel_id: string; sender_id: string; content: string; created_at: string;
}

interface BarberConv {
  id: string; participant1_id: string; participant2_id: string;
  last_message: string | null; last_message_at: string | null;
  other_barber: { id: string; display_name: string; avatar_url: string | null };
}
interface BarberDMMessage {
  id: string; conversation_id: string; sender_id: string;
  content: string; is_read: boolean; created_at: string;
}

type InternalSelection =
  | { type: 'channel'; data: TeamChannel }
  | { type: 'dm'; data: BarberConv }
  | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msgTime(iso: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d');
  } catch { return ''; }
}

function contrastTextColor(bg: string) {
  const hex = String(bg || '').trim();
  const full = /^#([0-9a-fA-F]{6})$/;
  const short = /^#([0-9a-fA-F]{3})$/;
  let r = 0, g = 0, b = 0;
  if (short.test(hex)) {
    const m = short.exec(hex)![1];
    r = parseInt(m[0] + m[0], 16); g = parseInt(m[1] + m[1], 16); b = parseInt(m[2] + m[2], 16);
  } else if (full.test(hex)) {
    const m = full.exec(hex)![1];
    r = parseInt(m.slice(0, 2), 16); g = parseInt(m.slice(2, 4), 16); b = parseInt(m.slice(4, 6), 16);
  } else return '#ffffff';
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0a0a0a' : '#ffffff';
}

const TAB_BAR_HEIGHT = 72;

// ─── Component ───────────────────────────────────────────────────────────────

export default function BarberMessages() {
  const { C, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarClearance = TAB_BAR_HEIGHT + Math.max(16, insets.bottom + 8) + 12;
  const accentOn = contrastTextColor(C.accent);
  const accentOnMuted = accentOn === '#ffffff' ? '#ffffff70' : '#00000070';

  // ── Auth ─────────────────────────────────────────────────────────────────
  const [barberId, setBarberId] = useState<string | null>(null);
  // ownerUid is used for client conversations and team channels (scoped to shop owner)
  const [ownerUid, setOwnerUid] = useState<string | null>(null);

  // ── Tab ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'clients' | 'internal'>('clients');

  // ── Client conversations ─────────────────────────────────────────────────
  const [clientConvs, setClientConvs] = useState<ClientConv[]>([]);
  const [selectedClientConv, setSelectedClientConv] = useState<ClientConv | null>(null);
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [clientMsgLoading, setClientMsgLoading] = useState(false);

  // ── Team channels ─────────────────────────────────────────────────────────
  const [teamChannels, setTeamChannels] = useState<TeamChannel[]>([]);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [channelMsgLoading, setChannelMsgLoading] = useState(false);

  // ── Barber DMs ───────────────────────────────────────────────────────────
  const [barberConvs, setBarberConvs] = useState<BarberConv[]>([]);
  const [barberDMMessages, setBarberDMMessages] = useState<BarberDMMessage[]>([]);
  const [dmMsgLoading, setDmMsgLoading] = useState(false);

  // ── Profiles cache (for channel sender names) ─────────────────────────────
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  // ── Internal selection ───────────────────────────────────────────────────
  const [internalSelection, setInternalSelection] = useState<InternalSelection>(null);

  // ── Shared ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT CONVERSATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const fetchClientConvs = useCallback(async (uid: string) => {
    try {
      const { data: convRows } = await supabase
        .from('conversations').select('id, client_id, last_message_at')
        .eq('barber_id', uid).order('last_message_at', { ascending: false, nullsFirst: false });

      if (!convRows?.length) { setClientConvs([]); return; }

      const convs: ClientConv[] = await Promise.all(
        (convRows as any[]).map(async (conv: any) => {
          const [clientRes, lastMsgRes, unreadRes] = await Promise.all([
            supabase.from('clients').select('name').eq('id', conv.client_id).maybeSingle(),
            supabase.from('messages').select('content, created_at')
              .eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('messages').select('*', { count: 'exact', head: true })
              .eq('conversation_id', conv.id).eq('sender_type', 'client').eq('is_read', false),
          ]);
          return {
            id: conv.id, client_id: conv.client_id,
            client_name: (clientRes.data as any)?.name || 'Unknown Client',
            last_message: (lastMsgRes.data as any)?.content || null,
            last_message_at: (lastMsgRes.data as any)?.created_at || conv.last_message_at,
            unread_count: unreadRes.count ?? 0,
          };
        })
      );
      setClientConvs(convs);
    } catch (err) { console.error('fetchClientConvs:', err); }
  }, []);

  const openClientConv = async (conv: ClientConv) => {
    setSelectedClientConv(conv);
    setClientMsgLoading(true);
    try {
      const { data } = await supabase.from('messages')
        .select('id, sender_type, content, is_read, created_at')
        .eq('conversation_id', conv.id).order('created_at', { ascending: true });
      setClientMessages((data as ClientMessage[]) ?? []);
      await supabase.from('messages').update({ is_read: true })
        .eq('conversation_id', conv.id).eq('sender_type', 'client').eq('is_read', false);
    } catch (err) { console.error('openClientConv:', err); }
    setClientMsgLoading(false);
    setTimeout(scrollToBottom, 150);
  };

  const sendClientMessage = async () => {
    if (!newMessage.trim() || !selectedClientConv || !barberId) return;
    setSending(true);
    const text = newMessage.trim();
    setNewMessage('');
    try {
      const { error } = await supabase.from('messages').insert({
        conversation_id: selectedClientConv.id,
        barber_id: barberId,
        client_id: selectedClientConv.client_id,
        sender_type: 'barber',
        content: text,
        channel: 'in_app',
        is_read: false,
      });
      if (error) throw error;
      await supabase.from('conversations')
        .update({ last_message_at: new Date().toISOString(), last_message_sender: 'barber' })
        .eq('id', selectedClientConv.id);
    } catch (err: any) {
      Alert.alert('Failed to send', err.message || 'Please try again');
      setNewMessage(text);
    }
    setSending(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAM CHANNELS
  // ═══════════════════════════════════════════════════════════════════════════

  const fetchTeamChannels = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('team_channels' as any)
        .select('*')
        .eq('shop_owner_id', uid)
        .order('created_at', { ascending: true });

      if (error) throw error;
      let channelList = ((data || []) as unknown as TeamChannel[]);

      // Auto-create defaults for new owners
      if (channelList.length === 0) {
        const { data: created } = await supabase
          .from('team_channels' as any)
          .insert([
            { shop_owner_id: uid, name: 'general', description: 'General team chat', is_default: true },
            { shop_owner_id: uid, name: 'announcements', description: 'Shop updates & news', is_default: true },
          ] as any)
          .select();
        channelList = ((created || []) as unknown as TeamChannel[]);
      }
      setTeamChannels(channelList);
    } catch (err) { console.error('fetchTeamChannels:', err); }
  }, []);

  const openChannel = async (channel: TeamChannel) => {
    setInternalSelection({ type: 'channel', data: channel });
    setChannelMsgLoading(true);
    try {
      const { data, error } = await supabase
        .from('team_channel_messages' as any)
        .select('*')
        .eq('channel_id', channel.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      const msgs = ((data || []) as unknown as ChannelMessage[]);
      setChannelMessages(msgs);

      // Fetch sender display names
      const senderIds = [...new Set(msgs.map(m => m.sender_id))];
      if (senderIds.length > 0) await fetchProfiles(senderIds);
    } catch (err) { console.error('openChannel:', err); }
    setChannelMsgLoading(false);
    setTimeout(scrollToBottom, 150);
  };

  const sendChannelMessage = async () => {
    if (!newMessage.trim() || internalSelection?.type !== 'channel' || !barberId) return;
    setSending(true);
    const text = newMessage.trim();
    const channelId = internalSelection.data.id;
    setNewMessage('');
    try {
      const { error } = await supabase
        .from('team_channel_messages' as any)
        .insert({ channel_id: channelId, sender_id: barberId, content: text } as any);
      if (error) throw error;
      await supabase.from('team_channels' as any)
        .update({ last_message: text.slice(0, 100), last_message_at: new Date().toISOString() } as any)
        .eq('id', channelId);
      if (ownerUid) await fetchTeamChannels(ownerUid);
    } catch (err: any) {
      Alert.alert('Failed to send', err.message || 'Please try again');
      setNewMessage(text);
    }
    setSending(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // BARBER DMs
  // ═══════════════════════════════════════════════════════════════════════════

  const fetchBarberConvs = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('barber_conversations' as any)
        .select('*')
        .or(`participant1_id.eq.${uid},participant2_id.eq.${uid}`)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      const convList = ((data || []) as any[]);

      // Collect other participant IDs
      const otherIds = new Set<string>();
      convList.forEach((c: any) => {
        const otherId = c.participant1_id === uid ? c.participant2_id : c.participant1_id;
        otherIds.add(otherId);
      });

      // Fetch display names
      const nameMap: Record<string, string> = {};
      if (otherIds.size > 0) {
        const idList = Array.from(otherIds);
        const { data: profileData } = await supabase
          .from('profiles').select('user_id, display_name').in('user_id', idList);
        (profileData || []).forEach((p: any) => { nameMap[p.user_id] = p.display_name || 'Team Member'; });

        const { data: memberData } = await supabase
          .from('team_members' as any).select('user_id, display_name').in('user_id', idList);
        (memberData || []).forEach((m: any) => { if (!nameMap[m.user_id]) nameMap[m.user_id] = m.display_name || 'Team Member'; });
      }

      const formatted: BarberConv[] = convList.map((c: any) => {
        const isP1 = c.participant1_id === uid;
        const otherId = isP1 ? c.participant2_id : c.participant1_id;
        return {
          id: c.id,
          participant1_id: c.participant1_id,
          participant2_id: c.participant2_id,
          last_message: c.last_message,
          last_message_at: c.last_message_at,
          other_barber: { id: otherId, display_name: nameMap[otherId] || 'Team Member', avatar_url: null },
        };
      });
      setBarberConvs(formatted);
    } catch (err) { console.error('fetchBarberConvs:', err); }
  }, []);

  const openBarberDM = async (conv: BarberConv) => {
    setInternalSelection({ type: 'dm', data: conv });
    setDmMsgLoading(true);
    try {
      const { data, error } = await supabase
        .from('barber_messages' as any)
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setBarberDMMessages(((data || []) as unknown as BarberDMMessage[]));
      // Mark read
      await supabase.from('barber_messages' as any)
        .update({ is_read: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', barberId ?? '')
        .eq('is_read', false);
    } catch (err) { console.error('openBarberDM:', err); }
    setDmMsgLoading(false);
    setTimeout(scrollToBottom, 150);
  };

  const sendDMMessage = async () => {
    if (!newMessage.trim() || internalSelection?.type !== 'dm' || !barberId) return;
    setSending(true);
    const text = newMessage.trim();
    const convId = internalSelection.data.id;
    setNewMessage('');
    try {
      const { error } = await supabase
        .from('barber_messages' as any)
        .insert({ conversation_id: convId, sender_id: barberId, content: text } as any);
      if (error) throw error;
      await supabase.from('barber_conversations' as any)
        .update({ last_message: text.slice(0, 100), last_message_at: new Date().toISOString() } as any)
        .eq('id', convId);
    } catch (err: any) {
      Alert.alert('Failed to send', err.message || 'Please try again');
      setNewMessage(text);
    }
    setSending(false);
  };

  // ── Shared send handler ─────────────────────────────────────────────────
  const handleSend = () => {
    if (selectedClientConv) return sendClientMessage();
    if (internalSelection?.type === 'channel') return sendChannelMessage();
    if (internalSelection?.type === 'dm') return sendDMMessage();
  };

  // ── Profile name cache ─────────────────────────────────────────────────
  const fetchProfiles = async (userIds: string[]) => {
    const missing = userIds.filter(id => !profiles[id]);
    if (!missing.length) return;
    const { data } = await supabase.from('profiles').select('user_id, display_name').in('user_id', missing);
    const newMap: Record<string, string> = {};
    (data || []).forEach((p: any) => { newMap[p.user_id] = p.display_name || 'Team Member'; });
    setProfiles(prev => ({ ...prev, ...newMap }));
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT & REALTIME
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setLoading(false); return; }
      const uid = session.user.id;
      setBarberId(uid);
      const scope = await resolveBarberScope(uid);
      const owner = scope.ownerUid;
      setOwnerUid(owner);
      Promise.all([
        fetchClientConvs(owner),
        fetchTeamChannels(owner),
        fetchBarberConvs(uid),
      ]).finally(() => setLoading(false));
    });
  }, []);

  // Client conversations realtime
  useEffect(() => {
    if (!ownerUid) return;
    const ch = supabase.channel('barber_client_msgs_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `barber_id=eq.${ownerUid}` },
        () => fetchClientConvs(ownerUid))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        () => fetchClientConvs(ownerUid))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ownerUid, fetchClientConvs]);

  // Client chat realtime
  useEffect(() => {
    if (!selectedClientConv) return;
    const ch = supabase.channel(`barber_chat_rt_${selectedClientConv.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedClientConv.id}` },
        (payload) => {
          setClientMessages(prev => prev.some(m => m.id === (payload.new as any).id) ? prev : [...prev, payload.new as ClientMessage]);
          scrollToBottom();
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedClientConv, scrollToBottom]);

  // Channel realtime
  useEffect(() => {
    if (internalSelection?.type !== 'channel') return;
    const channelId = internalSelection.data.id;
    const ch = supabase.channel(`team_ch_rt_${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_channel_messages', filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const msg = payload.new as ChannelMessage;
          await fetchProfiles([msg.sender_id]);
          setChannelMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          scrollToBottom();
          if (ownerUid) fetchTeamChannels(ownerUid);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [internalSelection, barberId]);

  // DM realtime
  useEffect(() => {
    if (internalSelection?.type !== 'dm') return;
    const convId = internalSelection.data.id;
    const ch = supabase.channel(`barber_dm_rt_${convId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'barber_messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const msg = payload.new as BarberDMMessage;
          setBarberDMMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          scrollToBottom();
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [internalSelection, scrollToBottom]);

  // Barber DMs realtime (sidebar updates)
  useEffect(() => {
    if (!barberId) return;
    const ch = supabase.channel('barber_dm_sidebar_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'barber_conversations' },
        () => fetchBarberConvs(barberId))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [barberId, fetchBarberConvs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (ownerUid && barberId) await Promise.all([
      fetchClientConvs(ownerUid),
      fetchTeamChannels(ownerUid),
      fetchBarberConvs(barberId),
    ]);
    setRefreshing(false);
  }, [barberId, ownerUid]);

  const goBack = () => {
    setSelectedClientConv(null);
    setClientMessages([]);
    setInternalSelection(null);
    setChannelMessages([]);
    setBarberDMMessages([]);
    setNewMessage('');
    if (ownerUid && barberId) {
      fetchClientConvs(ownerUid);
      fetchTeamChannels(ownerUid);
      fetchBarberConvs(barberId);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARED CHAT VIEW (client DM, channel, barber DM)
  // ═══════════════════════════════════════════════════════════════════════════

  if (loading) return (
    <View style={[S.loader, { backgroundColor: C.bg }]}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  // ── Chat views ──────────────────────────────────────────────────────────

  const inChat = !!selectedClientConv || !!internalSelection;

  if (inChat) {
    // Determine header info
    const isChannel = internalSelection?.type === 'channel';
    const isDM = internalSelection?.type === 'dm';
    const isClientChat = !!selectedClientConv;

    const headerTitle = isClientChat
      ? selectedClientConv!.client_name
      : isChannel
        ? `# ${internalSelection!.data.name}`
        : (internalSelection as any)?.data?.other_barber?.display_name || 'Team Member';

    const headerSub = isClientChat ? 'Client' : isChannel ? (internalSelection as any)!.data.description || 'Team channel' : 'Direct Message';

    // Messages to render
    const msgListClient = isClientChat ? clientMessages : [];
    const msgListChannel = isChannel ? channelMessages : [];
    const msgListDM = isDM ? barberDMMessages : [];
    const isMsgLoading = isClientChat ? clientMsgLoading : isChannel ? channelMsgLoading : dmMsgLoading;

    return (
      <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

        {/* Header */}
        <View style={[S.chatHeader, { borderBottomColor: C.border }]}>
          <TouchableOpacity onPress={goBack} style={[S.backBtn, { backgroundColor: C.bg2, borderColor: C.border }]}>
            <ArrowLeft color={C.text} size={18} />
          </TouchableOpacity>
          <View style={[S.chatAvatar, { backgroundColor: C.accent + '18' }]}>
            {isChannel
              ? <Hash color={C.accent} size={18} strokeWidth={2.5} />
              : <Text style={[S.chatAvatarTxt, { color: C.accent }]}>{headerTitle.replace('#','').charAt(0).toUpperCase()}</Text>
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[S.chatName, { color: C.text }]} numberOfLines={1}>{headerTitle}</Text>
            <Text style={[S.chatSub, { color: C.text3 }]}>{headerSub}</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[S.msgList, { paddingBottom: tabBarClearance + 8 }]}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
          >
            {isMsgLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator color={C.accent} />
              </View>
            ) : (

              /* ── CLIENT messages ─────────────────────── */
              isClientChat ? (
                msgListClient.length === 0
                  ? <View style={S.emptyChat}><MessageCircle color={C.text3} size={36} /><Text style={[S.emptyChatTxt, { color: C.text2 }]}>No messages yet</Text></View>
                  : msgListClient.map(msg => {
                    const isBarber = msg.sender_type === 'barber';
                    const isSystem = msg.sender_type === 'system';
                    return (
                      <View key={msg.id} style={{ alignItems: isBarber ? 'flex-end' : isSystem ? 'center' : 'flex-start' }}>
                        <View style={[S.bubble,
                          isBarber ? { backgroundColor: C.accent } :
                          { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border }
                        ]}>
                          <Text style={[S.bubbleTxt, { color: isBarber ? accentOn : C.text, fontStyle: isSystem ? 'italic' : 'normal' }]}>
                            {msg.content}
                          </Text>
                          <Text style={[S.bubbleTime, { color: isBarber ? accentOnMuted : C.text3 }]}>
                            {msgTime(msg.created_at)}
                          </Text>
                        </View>
                      </View>
                    );
                  })

              /* ── CHANNEL messages ────────────────────── */
              ) : isChannel ? (
                msgListChannel.length === 0
                  ? <View style={S.emptyChat}><Hash color={C.text3} size={36} /><Text style={[S.emptyChatTxt, { color: C.text2 }]}>No messages yet — say hi!</Text></View>
                  : msgListChannel.map(msg => {
                    const isMe = msg.sender_id === barberId;
                    const senderName = isMe ? 'You' : (profiles[msg.sender_id] || 'Team Member');
                    return (
                      <View key={msg.id} style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                        {!isMe && (
                          <Text style={[S.senderName, { color: C.text3 }]}>{senderName}</Text>
                        )}
                        <View style={[S.bubble,
                          isMe ? { backgroundColor: C.accent } : { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border }
                        ]}>
                          <Text style={[S.bubbleTxt, { color: isMe ? accentOn : C.text }]}>{msg.content}</Text>
                          <Text style={[S.bubbleTime, { color: isMe ? accentOnMuted : C.text3 }]}>
                            {msgTime(msg.created_at)}
                          </Text>
                        </View>
                      </View>
                    );
                  })

              /* ── DM messages ─────────────────────────── */
              ) : (
                msgListDM.length === 0
                  ? <View style={S.emptyChat}><MessageCircle color={C.text3} size={36} /><Text style={[S.emptyChatTxt, { color: C.text2 }]}>No messages yet</Text></View>
                  : msgListDM.map(msg => {
                    const isMe = msg.sender_id === barberId;
                    return (
                      <View key={msg.id} style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                        <View style={[S.bubble,
                          isMe ? { backgroundColor: C.accent } : { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border }
                        ]}>
                          <Text style={[S.bubbleTxt, { color: isMe ? accentOn : C.text }]}>{msg.content}</Text>
                          <Text style={[S.bubbleTime, { color: isMe ? accentOnMuted : C.text3 }]}>
                            {msgTime(msg.created_at)}
                          </Text>
                        </View>
                      </View>
                    );
                  })
              )
            )}
          </ScrollView>

          <View style={[S.inputRow, { borderTopColor: C.border, backgroundColor: C.bg, paddingBottom: tabBarClearance }]}>
            <TextInput
              value={newMessage} onChangeText={setNewMessage}
              placeholder={isChannel ? `Message #${(internalSelection as any)?.data?.name}…` : 'Message…'}
              placeholderTextColor={C.text3}
              style={[S.input, { backgroundColor: C.bg2, borderColor: C.border, color: C.text }]}
              multiline maxLength={500}
            />
            <TouchableOpacity onPress={handleSend} disabled={!newMessage.trim() || sending}
              style={[S.sendBtn, { backgroundColor: newMessage.trim() ? C.accent : C.bg2 }]}>
              {sending
                ? <ActivityIndicator color={newMessage.trim() ? accentOn : C.text3} size="small" />
                : <Send color={newMessage.trim() ? accentOn : C.text3} size={16} strokeWidth={2} />
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW (tabs: Clients | Internal)
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Title */}
      <View style={[S.titleRow, { borderBottomColor: C.border }]}>
        <Text style={[S.title, { color: C.text }]}>Messages</Text>
      </View>

      {/* Tabs */}
      <View style={[S.tabRow, { borderBottomColor: C.border, backgroundColor: C.bg }]}>
        {(['clients', 'internal'] as const).map(tab => (
          <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={[S.tabBtn, activeTab === tab && { borderBottomColor: C.accent, borderBottomWidth: 2 }]}>
            <Text style={[S.tabLabel, { color: activeTab === tab ? C.accent : C.text3 }]}>
              {tab === 'clients' ? 'Clients' : 'Internal'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[S.scroll, { paddingBottom: tabBarClearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        showsVerticalScrollIndicator={false}
      >

        {/* ── CLIENTS TAB ─────────────────────────────────────────── */}
        {activeTab === 'clients' && (
          clientConvs.length === 0 ? (
            <View style={S.emptyState}>
              <MessageCircle color={C.text3} size={40} />
              <Text style={[S.emptyTitle, { color: C.text2 }]}>No conversations yet</Text>
              <Text style={[S.emptySub, { color: C.text3 }]}>Clients will appear here when they message you</Text>
            </View>
          ) : (
            clientConvs.map(conv => (
              <TouchableOpacity key={conv.id} onPress={() => openClientConv(conv)}
                style={[S.convCard, { backgroundColor: C.card, borderColor: conv.unread_count > 0 ? C.accent + '30' : C.cardBorder }]}
                activeOpacity={0.8}>
                <View style={[S.convAvatar, { backgroundColor: C.accent + '18' }]}>
                  <Text style={[S.convAvatarTxt, { color: C.accent }]}>{conv.client_name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={S.convTop}>
                    <Text style={[S.convName, { color: C.text, fontWeight: conv.unread_count > 0 ? '800' : '600' }]}>{conv.client_name}</Text>
                    {conv.last_message_at && <Text style={[S.convTime, { color: C.text3 }]}>{msgTime(conv.last_message_at)}</Text>}
                  </View>
                  <View style={S.convBottom}>
                    <Text style={[S.convPreview, { color: C.text2 }]} numberOfLines={1}>{conv.last_message || 'No messages yet'}</Text>
                    {conv.unread_count > 0 && (
                      <View style={[S.unreadBadge, { backgroundColor: C.accent }]}>
                        <Text style={S.unreadTxt}>{conv.unread_count}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )
        )}

        {/* ── INTERNAL TAB ─────────────────────────────────────────── */}
        {activeTab === 'internal' && (
          <>
            {/* CHANNELS section */}
            {teamChannels.length > 0 && (
              <>
                <View style={S.sectionHeader}>
                  <Hash color={C.text3} size={12} strokeWidth={2.5} />
                  <Text style={[S.sectionLabel, { color: C.text3 }]}>CHANNELS</Text>
                </View>
                {teamChannels.map(channel => (
                  <TouchableOpacity key={channel.id} onPress={() => openChannel(channel)}
                    style={[S.convCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}
                    activeOpacity={0.8}>
                    <View style={[S.convAvatar, { backgroundColor: C.accent + '12' }]}>
                      <Hash color={C.accent} size={20} strokeWidth={2.5} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={S.convTop}>
                        <Text style={[S.convName, { color: C.text }]}>{channel.name}</Text>
                        {channel.last_message_at && <Text style={[S.convTime, { color: C.text3 }]}>{msgTime(channel.last_message_at)}</Text>}
                      </View>
                      <Text style={[S.convPreview, { color: C.text2 }]} numberOfLines={1}>
                        {channel.last_message || channel.description || 'No messages yet'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* DIRECT MESSAGES section */}
            {barberConvs.length > 0 && (
              <>
                <View style={[S.sectionHeader, { marginTop: teamChannels.length > 0 ? 8 : 0 }]}>
                  <Users color={C.text3} size={12} strokeWidth={2.5} />
                  <Text style={[S.sectionLabel, { color: C.text3 }]}>DIRECT MESSAGES</Text>
                </View>
                {barberConvs.map(conv => (
                  <TouchableOpacity key={conv.id} onPress={() => openBarberDM(conv)}
                    style={[S.convCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}
                    activeOpacity={0.8}>
                    <View style={[S.convAvatar, { backgroundColor: C.accent + '18' }]}>
                      <Text style={[S.convAvatarTxt, { color: C.accent }]}>
                        {(conv.other_barber.display_name || 'T').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={S.convTop}>
                        <Text style={[S.convName, { color: C.text }]}>{conv.other_barber.display_name}</Text>
                        {conv.last_message_at && <Text style={[S.convTime, { color: C.text3 }]}>{msgTime(conv.last_message_at)}</Text>}
                      </View>
                      <Text style={[S.convPreview, { color: C.text2 }]} numberOfLines={1}>
                        {conv.last_message || 'No messages yet'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Empty state */}
            {teamChannels.length === 0 && barberConvs.length === 0 && (
              <View style={S.emptyState}>
                <Users color={C.text3} size={40} />
                <Text style={[S.emptyTitle, { color: C.text2 }]}>No team chats yet</Text>
                <Text style={[S.emptySub, { color: C.text3 }]}>Channels will appear here once your team is set up</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container:    { flex: 1 },
  loader:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow:     { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 0 },
  title:        { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  tabRow:       { flexDirection: 'row', borderBottomWidth: 1 },
  tabBtn:       { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:     { fontSize: 14, fontWeight: '700' },
  scroll:       { paddingHorizontal: 16, paddingTop: 12 },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4, paddingBottom: 8, paddingTop: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  emptyState:   { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle:   { fontSize: 16, fontWeight: '700' },
  emptySub:     { fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },
  convCard:     { borderRadius: 18, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1 },
  convAvatar:   { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  convAvatarTxt:{ fontSize: 20, fontWeight: '900' },
  convTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convName:     { fontSize: 15 },
  convTime:     { fontSize: 11 },
  convBottom:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  convPreview:  { fontSize: 13, flex: 1 },
  unreadBadge:  { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  unreadTxt:    { color: '#fff', fontSize: 10, fontWeight: '800' },
  chatHeader:   { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chatAvatar:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chatAvatarTxt:{ fontWeight: '900', fontSize: 16 },
  chatName:     { fontWeight: '700', fontSize: 15, flex: 1 },
  chatSub:      { fontSize: 12 },
  msgList:      { paddingHorizontal: 14, paddingVertical: 14, gap: 8 },
  emptyChat:    { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyChatTxt: { fontSize: 15, fontWeight: '700' },
  senderName:   { fontSize: 10, fontWeight: '600', marginBottom: 2, marginLeft: 4 },
  bubble:       { maxWidth: '78%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleTxt:    { fontSize: 14, lineHeight: 20 },
  bubbleTime:   { fontSize: 10, marginTop: 3 },
  inputRow:     { paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  input:        { flex: 1, borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10, fontSize: 14, maxHeight: 120, borderWidth: 1, lineHeight: 20 },
  sendBtn:      { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
