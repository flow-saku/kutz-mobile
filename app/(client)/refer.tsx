import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator,
  Share, StyleSheet, StatusBar, Platform, Animated, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Copy, Share2, CheckCircle2, Gift, MapPin, Lock, ChevronRight } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { getBarberProfile } from '@/lib/barber';
import { getActiveClientBinding } from '@/lib/clientSync';
import { useTheme } from '@/lib/theme';
import { router } from 'expo-router';
import AnimatedCounter from '@/components/ui/AnimatedCounter';

type RewardType = 'points' | 'discount_percent' | 'cash_fixed' | 'cash_percent_service';
type ReferralTier = { id: string; name: string; reward_type: RewardType; min_conversions: number };
type ReferralRow = { id: string; status: 'pending' | 'converted' | 'expired'; bonus_points: number };

const DEFAULT_TIERS: ReferralTier[] = [
  { id: 'tier_1', name: 'Tier 1', reward_type: 'points',               min_conversions: 0  },
  { id: 'tier_2', name: 'Tier 2', reward_type: 'discount_percent',     min_conversions: 3  },
  { id: 'tier_3', name: 'Tier 3', reward_type: 'cash_fixed',           min_conversions: 7  },
  { id: 'tier_4', name: 'Tier 4', reward_type: 'cash_percent_service', min_conversions: 15 },
];

const TIER_NAMES = ['Starter', 'Growth', 'Pro', 'Elite'];

const rewardValueLabel = (type: RewardType, cfg: any) => {
  if (type === 'points')           return `+${cfg.bonusPoints} points`;
  if (type === 'discount_percent') return `${cfg.discountPercent}% off`;
  if (type === 'cash_fixed')       return `$${Number(cfg.cashAmount || 0).toFixed(0)} cash`;
  return `${cfg.cashPercent}% of cut`;
};

function buildReferralConfig(bookingPageConfig: any) {
  const bpc = bookingPageConfig || {};
  const parsedTiers: ReferralTier[] = Array.isArray(bpc.referral_tiers)
    ? bpc.referral_tiers
        .map((t: any, i: number) => ({
          id: t.id || `tier_${i + 1}`, name: t.name || `Tier ${i + 1}`,
          reward_type: (t.reward_type || 'points') as RewardType,
          min_conversions: Number(t.min_conversions ?? 0),
        }))
        .filter((t: ReferralTier) => ['points','discount_percent','cash_fixed','cash_percent_service'].includes(t.reward_type))
    : [];
  const tiers = parsedTiers.length > 0
    ? [...parsedTiers].sort((a, b) => a.min_conversions - b.min_conversions)
    : [...DEFAULT_TIERS];
  if (tiers.length > 0) {
    tiers[0] = { ...tiers[0], reward_type: (bpc.referral_reward_type || tiers[0].reward_type || 'points') as RewardType, min_conversions: 0 };
  }
  return {
    tiers,
    bonusPoints:     Number(bpc.referral_bonus_points     ?? 50),
    discountPercent: Number(bpc.referral_discount_percent ?? 10),
    cashAmount:      Number(bpc.referral_cash_amount      ?? 10),
    cashPercent:     Number(bpc.referral_cash_percent     ?? 10),
  };
}

function withRef(baseUrl: string, code: string) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('ref', code);
    return url.toString();
  } catch {
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}`;
  }
}

function Tap({ onPress, style, children, disabled = false }: {
  onPress: () => void; style?: any; children: React.ReactNode; disabled?: boolean;
}) {
  const s = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
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

export default function ReferScreen() {
  const { theme, C } = useTheme();
  const isDark = theme === 'dark';

  const [loading, setLoading]               = useState(true);
  const [barberId, setBarberId]             = useState<string | null>(null);
  const [referralCode, setReferralCode]     = useState<string | null>(null);
  const [referrals, setReferrals]           = useState<ReferralRow[]>([]);
  const [barberName, setBarberName]         = useState('');
  const [barberSlug, setBarberSlug]         = useState<string | null>(null);
  const [bookingLink, setBookingLink]       = useState<string | null>(null);
  const [referralConfig, setReferralConfig] = useState(buildReferralConfig(null));
  const [copied, setCopied]                 = useState(false);
  const [hasShop, setHasShop]               = useState(true);

  const fade  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(14)).current;

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }
      const binding = await getActiveClientBinding(session.user.id);
      if (!binding) { setHasShop(false); setLoading(false); return; }
      setHasShop(true);
      setBarberId(binding.barberId);
      const [profile, { data: referralRows }] = await Promise.all([
        getBarberProfile(binding.barberId),
        supabase.from('referrals').select('id, status, bonus_points')
          .eq('barber_id', binding.barberId).eq('referrer_client_id', binding.clientId)
          .order('created_at', { ascending: false }),
      ]);
      const p = profile as any;
      setBarberName(p?.shop_name || p?.display_name || '');
      setBarberSlug(p?.barber_slug || null);
      setBookingLink(p?.booking_link || null);
      setReferralConfig(buildReferralConfig(p?.booking_page_config));
      setReferrals(((referralRows || []) as ReferralRow[]));
      const { data: rpcCode } = await supabase.rpc('get_or_create_referral_code', {
        p_barber_id: binding.barberId, p_client_id: binding.clientId,
      });
      setReferralCode((rpcCode as string | null) || null);
    } catch (err) { console.error('[refer] loadData error', err); }
    setLoading(false);
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 360, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, tension: 180, friction: 16, useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => { loadData(); }, []);

  const stats = useMemo(() => {
    const total      = referrals.length;
    const converted  = referrals.filter(r => r.status === 'converted').length;
    const pending    = referrals.filter(r => r.status === 'pending').length;
    const conversion = total > 0 ? Math.round((converted / total) * 100) : 0;
    return { total, converted, pending, conversion };
  }, [referrals]);

  const orderedTiers = useMemo(
    () => [...referralConfig.tiers].sort((a, b) => a.min_conversions - b.min_conversions),
    [referralConfig.tiers],
  );

  const currentTier = useMemo(() => {
    let active = orderedTiers[0] || null;
    for (const t of orderedTiers) { if (stats.converted >= t.min_conversions) active = t; }
    return active;
  }, [orderedTiers, stats.converted]);

  const nextTier = useMemo(
    () => orderedTiers.find(t => t.min_conversions > stats.converted) || null,
    [orderedTiers, stats.converted],
  );

  const referralLink = useMemo(() => {
    if (!referralCode) return null;
    // Sanitize: ignore localhost / dev URLs stored from local development
    const isLocalhost = bookingLink &&
      (bookingLink.includes('localhost') || bookingLink.includes('127.0.0.1'));
    const cleanBookingLink = isLocalhost ? null : (bookingLink || null);
    const baseUrl = cleanBookingLink
      || (barberSlug ? `https://kutz.io/c/${barberSlug}` : null)
      || (barberId   ? `https://kutz.io/c/${barberId}` : null);
    return baseUrl ? withRef(baseUrl, referralCode) : null;
  }, [bookingLink, barberSlug, barberId, referralCode]);

  const handleCopy = async () => {
    const value = referralLink || referralCode;
    if (!value) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  };

  const handleShare = async () => {
    if (!referralCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const shopPart = barberName ? ` at ${barberName}` : '';
    const message = referralLink
      ? `I get my cuts${shopPart} on Kutz. Use my referral link when you book: ${referralLink}`
      : `Join me${shopPart} on Kutz and use my referral code: ${referralCode}`;
    try { await Share.share({ message, title: 'Join Kutz' }); } catch {}
  };

  if (loading) return (
    <View style={[S.loader, { backgroundColor: C.bg }]}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  if (!hasShop) return (
    <SafeAreaView style={[S.root, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={S.emptyWrap}>
        <View style={[S.emptyIcon, { backgroundColor: '#f3f0ff' }]}>
          <Gift color="#8b5cf6" size={34} strokeWidth={1.7} />
        </View>
        <Text style={[S.emptyTitle, { color: C.text }]}>Refer & Earn</Text>
        <Text style={[S.emptySub, { color: C.text3 }]}>
          Connect to a barbershop first — then you'll get a personal referral link to share.
        </Text>
        <Tap onPress={() => router.push('/(client)/discover')}
          style={[S.emptyBtn, { backgroundColor: C.accent }]}>
          <MapPin color={C.accentText} size={16} strokeWidth={2} />
          <Text style={[S.emptyBtnTxt, { color: C.accentText }]}>Find a shop</Text>
        </Tap>
      </View>
    </SafeAreaView>
  );

  const tierPct = nextTier
    ? Math.max(4, Math.min(100, ((stats.converted - (currentTier?.min_conversions ?? 0)) / Math.max(1, nextTier.min_conversions - (currentTier?.min_conversions ?? 0))) * 100))
    : 100;

  const currentReward = currentTier
    ? rewardValueLabel(currentTier.reward_type, referralConfig)
    : `+${referralConfig.bonusPoints} points`;

  const accentBg     = isDark ? 'rgba(0,0,0,0.18)' : `${C.accent}14`;
  const accentBorder = isDark ? 'rgba(255,255,255,0.12)' : `${C.accent}30`;

  // Same tones as home screen quick-action cards
  const TONES = {
    violet:  { icon: '#8b5cf6', bg: isDark ? 'rgba(139,92,246,0.16)'  : 'rgba(139,92,246,0.10)',  border: isDark ? 'rgba(139,92,246,0.28)'  : 'rgba(139,92,246,0.20)'  },
    emerald: { icon: '#10b981', bg: isDark ? 'rgba(16,185,129,0.16)'  : 'rgba(16,185,129,0.10)',  border: isDark ? 'rgba(16,185,129,0.28)'  : 'rgba(16,185,129,0.20)'  },
    amber:   { icon: '#f59e0b', bg: isDark ? 'rgba(245,158,11,0.16)'  : 'rgba(245,158,11,0.10)',  border: isDark ? 'rgba(245,158,11,0.28)'  : 'rgba(245,158,11,0.20)'  },
    blue:    { icon: '#3b82f6', bg: isDark ? 'rgba(59,130,246,0.16)'  : 'rgba(59,130,246,0.10)',  border: isDark ? 'rgba(59,130,246,0.28)'  : 'rgba(59,130,246,0.20)'  },
  };

  return (
    <SafeAreaView style={[S.root, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={[S.header, { borderBottomColor: C.border }]}>
        <View>
          <Text style={[S.title, { color: C.text }]}>Refer & Earn</Text>
          {barberName ? <Text style={[S.headerSub, { color: C.text3 }]}>{barberName}</Text> : null}
        </View>
        {/* Current reward pill — accent only */}
        <View style={[S.rewardPill, { backgroundColor: accentBg, borderColor: accentBorder }]}>
          <Text style={[S.rewardPillTxt, { color: C.accent }]}>{currentReward}</Text>
          <Text style={[S.rewardPillSub, { color: C.text3 }]}>per referral</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[S.scroll, { paddingBottom: 120 }]}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>

          {/* ── SHARE CARD ── */}
          <View style={[S.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>

            {/* Stats row — subtle toned chips like home screen */}
            <View style={S.miniStats}>
              {[
                { num: stats.total,     label: 'Referred',  tone: TONES.violet  },
                { num: stats.converted, label: 'Converted', tone: TONES.emerald },
                { num: stats.pending,   label: 'Pending',   tone: TONES.amber   },
              ].map(({ num, label, tone }) => (
                <View key={label} style={[S.miniStat, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                  <AnimatedCounter value={num} style={{ fontSize: 20, fontWeight: '900', letterSpacing: -0.5, color: tone.icon }} />
                  <Text style={[S.miniStatLbl, { color: tone.icon }]}>{label}</Text>
                </View>
              ))}
            </View>

            {/* Divider */}
            <View style={[S.divider, { backgroundColor: C.border }]} />

            {/* Link section */}
            <Text style={[S.fieldLabel, { color: C.text3 }]}>YOUR REFERRAL LINK</Text>
            <View style={[S.linkBox, { backgroundColor: C.bg2, borderColor: C.border }]}>
              <Text style={[S.linkText, { color: C.text2 }]} numberOfLines={2} selectable>
                {referralLink ?? referralCode ?? '—'}
              </Text>
            </View>

            {/* Buttons — identical height/border so they stay aligned */}
            <View style={S.btnRow}>
              <Tap
                onPress={handleCopy}
                style={[S.btn, S.btnOutline, {
                  backgroundColor: copied ? accentBg : C.bg2,
                  borderColor:     copied ? accentBorder : C.border,
                }]}
              >
                {copied
                  ? <CheckCircle2 color={C.accent} size={17} strokeWidth={2.2} />
                  : <Copy color={C.text2} size={17} strokeWidth={2} />}
                <Text style={[S.btnTxt, { color: copied ? C.accent : C.text2 }]}>
                  {copied ? 'Copied!' : 'Copy link'}
                </Text>
              </Tap>

              <Tap onPress={handleShare} style={[S.btn, S.btnOutline, { backgroundColor: C.accent, borderColor: C.accent }]}>
                <Share2 color={C.accentText} size={17} strokeWidth={2} />
                <Text style={[S.btnTxt, { color: C.accentText }]}>Share</Text>
              </Tap>
            </View>
          </View>

          {/* ── TIER PROGRESS ── */}
          {nextTier && (
            <View style={[S.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={S.progressTop}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[S.progressTitle, { color: C.text }]}>
                    {Math.max(0, nextTier.min_conversions - stats.converted)} more referral{Math.max(0, nextTier.min_conversions - stats.converted) !== 1 ? 's' : ''} to unlock
                  </Text>
                  <Text style={[S.progressSub, { color: C.text3 }]}>
                    Next: <Text style={{ color: C.accent, fontWeight: '700' }}>
                      {rewardValueLabel(nextTier.reward_type, referralConfig)}
                    </Text>
                  </Text>
                </View>
                <Text style={[S.progressPct, { color: C.accent }]}>{Math.round(tierPct)}%</Text>
              </View>
              <View style={[S.track, { backgroundColor: C.bg3 }]}>
                <View style={[S.trackFill, { width: `${tierPct}%` as any, backgroundColor: C.accent }]} />
              </View>
              <View style={S.progressFooter}>
                <Text style={[S.progressLbl, { color: C.text3 }]}>
                  {TIER_NAMES[orderedTiers.indexOf(currentTier!)] ?? 'Starter'}  ·  {stats.converted} converted
                </Text>
                <Text style={[S.progressLbl, { color: C.text3 }]}>
                  Goal: {nextTier.min_conversions}
                </Text>
              </View>
            </View>
          )}

          {/* ── REWARD TIERS ── */}
          <Text style={[S.sectionLabel, { color: C.text3 }]}>REWARD TIERS</Text>
          <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {orderedTiers.map((tier, idx) => {
              const unlocked = stats.converted >= tier.min_conversions;
              const active   = currentTier?.id === tier.id;
              const toUnlock = Math.max(0, tier.min_conversions - stats.converted);
              return (
                <View key={tier.id} style={[
                  S.tierRow,
                  idx < orderedTiers.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border },
                ]}>
                  {/* Badge */}
                  <View style={[S.tierBadge, {
                    backgroundColor: active ? C.accent : unlocked ? TONES.emerald.bg : C.bg2,
                    borderColor:     active ? C.accent : unlocked ? TONES.emerald.border : C.border,
                  }]}>
                    {!unlocked
                      ? <Lock color={C.text3} size={12} strokeWidth={2.5} />
                      : <Text style={[S.tierBadgeTxt, { color: active ? C.accentText : TONES.emerald.icon }]}>{idx + 1}</Text>
                    }
                  </View>

                  {/* Name + reward */}
                  <View style={{ flex: 1 }}>
                    <Text style={[S.tierName, { color: unlocked ? C.text : C.text3 }]}>
                      {TIER_NAMES[idx] ?? tier.name}
                    </Text>
                    <Text style={[S.tierReward, { color: active ? C.accent : C.text3 }]}>
                      {rewardValueLabel(tier.reward_type, referralConfig)}
                    </Text>
                  </View>

                  {/* Status */}
                  {active ? (
                    <View style={[S.activeTag, { backgroundColor: accentBg, borderColor: accentBorder }]}>
                      <Text style={[S.activeTagTxt, { color: C.accent }]}>Active</Text>
                    </View>
                  ) : unlocked ? (
                    <Text style={[S.unlockedTxt, { color: C.text3 }]}>✓ Done</Text>
                  ) : (
                    <Text style={[S.lockedTxt, { color: C.text3 }]}>{toUnlock} left</Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* ── HOW IT WORKS ── */}
          <Text style={[S.sectionLabel, { color: C.text3 }]}>HOW IT WORKS</Text>
          <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {[
              { n: '1', title: 'Share your link',   body: 'Send your referral link to a friend who needs a fresh cut.', tone: TONES.violet  },
              { n: '2', title: 'They book & visit', body: 'Counts once they complete their first appointment.',          tone: TONES.amber   },
              { n: '3', title: 'You earn rewards',  body: 'Points, discounts, or cash — automatically applied.',        tone: TONES.emerald },
            ].map((item, i) => (
              <View key={item.n} style={[
                S.howRow,
                i < 2 && { borderBottomWidth: 1, borderBottomColor: C.border },
              ]}>
                <View style={[S.howNum, { backgroundColor: item.tone.bg, borderColor: item.tone.border, borderWidth: 1 }]}>
                  <Text style={[S.howNumTxt, { color: item.tone.icon }]}>{item.n}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.howTitle, { color: C.text }]}>{item.title}</Text>
                  <Text style={[S.howBody, { color: C.text3 }]}>{item.body}</Text>
                </View>
              </View>
            ))}
          </View>

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  root:   { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  emptyWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  emptyIcon:   { width: 80, height: 80, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  emptyTitle:  { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 },
  emptySub:    { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 30 },
  emptyBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 26, paddingVertical: 15, borderRadius: 14 },
  emptyBtnTxt: { fontSize: 15, fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title:     { fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  headerSub: { fontSize: 13, marginTop: 2, fontWeight: '500' },

  rewardPill:    { alignItems: 'center', borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  rewardPillTxt: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  rewardPillSub: { fontSize: 10, fontWeight: '600', marginTop: 1 },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  card: {
    borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 14,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10 },
      android: { elevation: 2 },
    }),
  },

  // Mini stats inside share card
  miniStats: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  miniStat:  { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 10, alignItems: 'center', gap: 2 },
  miniStatNum: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  miniStatLbl: { fontSize: 11, fontWeight: '600' },

  divider: { height: 1, marginBottom: 16 },

  fieldLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  linkBox: {
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14,
  },
  linkText: { fontSize: 13, lineHeight: 20, fontWeight: '500' },

  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 13,
    height: 50,
  },
  btnOutline: { borderWidth: 1.5 },
  btnTxt: { fontSize: 14, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' },

  // Progress
  progressTop:    { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  progressTitle:  { fontSize: 15, fontWeight: '700' },
  progressSub:    { fontSize: 13, marginTop: 3 },
  progressPct:    { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  track:          { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  trackFill:      { height: '100%', borderRadius: 3 },
  progressFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLbl:    { fontSize: 11, fontWeight: '500' },

  // Tiers
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 10, marginLeft: 4 },
  listCard: {
    borderRadius: 20, borderWidth: 1, overflow: 'hidden', marginBottom: 20,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  tierRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 15 },
  tierBadge:    { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tierBadgeTxt: { fontSize: 14, fontWeight: '800' },
  tierName:     { fontSize: 14, fontWeight: '700' },
  tierReward:   { fontSize: 13, fontWeight: '600', marginTop: 2 },
  activeTag:    { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  activeTagTxt: { fontSize: 12, fontWeight: '700' },
  unlockedTxt:  { fontSize: 12, fontWeight: '600' },
  lockedTxt:    { fontSize: 12, fontWeight: '500' },

  // How it works
  howRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 18, paddingVertical: 16 },
  howNum:    { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  howNumTxt: { fontSize: 15, fontWeight: '900' },
  howTitle:  { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  howBody:   { fontSize: 13, lineHeight: 19 },
});
