import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Animated, StatusBar, Alert, Platform, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Star, Clock, ChevronDown, ChevronUp,
  Zap, MapPin, Gift, Megaphone, Check, Scissors, Users,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { getBarberProfile } from '@/lib/barber';
import { getActiveClientBinding } from '@/lib/clientSync';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { useTheme } from '@/lib/theme';
import AnimatedCounter from '@/components/ui/AnimatedCounter';

const TIERS = [
  // New — grey (0 visits)
  { tier: 'new',      label: 'New',      minVisits: 0,
    iconL: '#6b7280', bgL: 'rgba(107,114,128,0.10)', borderL: 'rgba(107,114,128,0.22)',
    iconD: '#9ca3af', bgD: 'rgba(156,163,175,0.12)', borderD: 'rgba(156,163,175,0.22)' },
  // Bronze — amber (1–4 visits)
  { tier: 'bronze',   label: 'Bronze',   minVisits: 1,
    iconL: '#b45309', bgL: 'rgba(180,83,9,0.10)',   borderL: 'rgba(180,83,9,0.30)',
    iconD: '#f59e0b', bgD: 'rgba(245,158,11,0.14)', borderD: 'rgba(180,83,9,0.40)' },
  // Silver — slate (5–11 visits)
  { tier: 'silver',   label: 'Silver',   minVisits: 5,
    iconL: '#64748b', bgL: 'rgba(100,116,139,0.10)', borderL: 'rgba(148,163,184,0.40)',
    iconD: '#94a3b8', bgD: 'rgba(100,116,139,0.14)', borderD: 'rgba(148,163,184,0.35)' },
  // Gold — yellow (12–24 visits)
  { tier: 'gold',     label: 'Gold',     minVisits: 12,
    iconL: '#ca8a04', bgL: 'rgba(234,179,8,0.12)',  borderL: 'rgba(234,179,8,0.40)',
    iconD: '#eab308', bgD: 'rgba(234,179,8,0.14)',  borderD: 'rgba(234,179,8,0.35)' },
  // Platinum — violet (25–49 visits)
  { tier: 'platinum', label: 'Platinum', minVisits: 25,
    iconL: '#7c3aed', bgL: 'rgba(124,58,237,0.10)', borderL: 'rgba(124,58,237,0.32)',
    iconD: '#a78bfa', bgD: 'rgba(124,58,237,0.14)', borderD: 'rgba(124,58,237,0.30)' },
  // Diamond — cyan (50+ visits)
  { tier: 'diamond',  label: 'Diamond',  minVisits: 50,
    iconL: '#0891b2', bgL: 'rgba(6,182,212,0.10)',  borderL: 'rgba(6,182,212,0.35)',
    iconD: '#22d3ee', bgD: 'rgba(6,182,212,0.14)',  borderD: 'rgba(6,182,212,0.30)' },
];
function getTier(v: number) {
  let t = TIERS[0];
  for (const tier of TIERS) { if (v >= tier.minVisits) t = tier; }
  return t;
}
function getNextTier(v: number) {
  const idx = TIERS.findLastIndex((t) => v >= t.minVisits);
  return idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
}

function Tap({ onPress, style, children, disabled = false }: {
  onPress: () => void; style?: any; children: React.ReactNode; disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, tension: 500, friction: 30 }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 400, friction: 26 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export default function LoyaltyScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';

  const [loading, setLoading]               = useState(true);
  const [refreshing, setRefreshing]         = useState(false);
  const [pointsBalance, setPointsBalance]   = useState(0);
  const [lifetimePoints, setLifetimePoints] = useState(0);
  const [visitCount, setVisitCount]         = useState(0);
  const [rewards, setRewards]               = useState<any[]>([]);
  const [transactions, setTransactions]     = useState<any[]>([]);
  const [showHistory, setShowHistory]       = useState(false);
  const [barberId, setBarberId]             = useState<string | null>(null);
  const [clientId, setClientId]             = useState<string | null>(null);
  const [barbershopName, setBarbershopName] = useState<string | null>(null);
  const [barbershopCity, setBarbershopCity] = useState<string | null>(null);
  const [activePromotions, setActivePromotions] = useState<any[]>([]);
  const [redeeming, setRedeeming]           = useState<string | null>(null);
  const [tierConfig, setTierConfig]         = useState<any[]>([]);

  const fade  = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(16)).current;

  // Same tones as home/refer
  const TONES = {
    emerald: { icon: '#10b981', bg: isDark ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.10)', border: isDark ? 'rgba(16,185,129,0.28)' : 'rgba(16,185,129,0.20)' },
    amber:   { icon: '#f59e0b', bg: isDark ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.10)', border: isDark ? 'rgba(245,158,11,0.28)' : 'rgba(245,158,11,0.20)' },
    blue:    { icon: '#3b82f6', bg: isDark ? 'rgba(59,130,246,0.16)' : 'rgba(59,130,246,0.10)', border: isDark ? 'rgba(59,130,246,0.28)' : 'rgba(59,130,246,0.20)' },
    violet:  { icon: '#8b5cf6', bg: isDark ? 'rgba(139,92,246,0.16)' : 'rgba(139,92,246,0.10)', border: isDark ? 'rgba(139,92,246,0.28)' : 'rgba(139,92,246,0.20)' },
  };

  const fetchData = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

      const binding = await getActiveClientBinding(session.user.id);
      if (!binding) {
        setBarberId(null); setClientId(null);
        setPointsBalance(0); setLifetimePoints(0); setVisitCount(0);
        setRewards([]); setTransactions([]);
        setBarbershopName(null); setBarbershopCity(null);
        setActivePromotions([]); setTierConfig([]);
        setLoading(false);
        return;
      }

      setBarberId(binding.barberId);
      setClientId(binding.clientId);
      setVisitCount(binding.visitCount ?? 0);

      const [ptsRes, rwsRes, txnRes, profile, promoRes, tcRes] = await Promise.all([
        supabase.from('loyalty_points').select('points_balance, lifetime_points')
          .eq('client_id', binding.clientId).eq('barber_id', binding.barberId).maybeSingle(),
        supabase.from('loyalty_rewards').select('id, name, description, points_required, is_active')
          .eq('barber_id', binding.barberId).eq('is_active', true).order('points_required', { ascending: true }),
        supabase.from('loyalty_transactions').select('id, points, type, description, created_at')
          .eq('barber_id', binding.barberId).eq('client_id', binding.clientId)
          .order('created_at', { ascending: false }).limit(20),
        getBarberProfile(binding.barberId),
        supabase.from('promotions').select('id, title, description, type, value, ends_at, is_active')
          .eq('barber_id', binding.barberId).eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase.from('tier_config').select('tier, visits_required, perk_type, perk_value')
          .eq('barber_id', binding.barberId).eq('is_active', true),
      ]);

      setPointsBalance((ptsRes.data as any)?.points_balance ?? 0);
      setLifetimePoints((ptsRes.data as any)?.lifetime_points ?? 0);
      setRewards((rwsRes.data as any[]) ?? []);
      setTransactions((txnRes.data as any[]) ?? []);
      const bp = profile as any;
      setBarbershopName(bp?.shop_name || bp?.display_name || null);
      setBarbershopCity(bp?.city || null);
      const promos = ((promoRes.data as any[]) ?? []).filter((p) => !p.ends_at || new Date(p.ends_at) > new Date());
      setActivePromotions(promos);
      setTierConfig((tcRes.data as any[]) ?? []);
    } catch (err) { console.error(err); }

    setLoading(false);
    Animated.parallel([
      Animated.timing(fade,   { toValue: 1, duration: 340, useNativeDriver: true }),
      Animated.spring(slideY, { toValue: 0, tension: 160, friction: 13, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleRedeem = async (reward: any) => {
    if (pointsBalance < reward.points_required || !barberId || !clientId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      `Redeem "${reward.name}"?`,
      `This will use ${reward.points_required} of your ${pointsBalance} points. Show your barber the confirmation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Redeem', onPress: async () => {
            setRedeeming(reward.id);
            try {
              const { error } = await supabase.from('loyalty_transactions').insert({
                barber_id: barberId, client_id: clientId,
                points: -reward.points_required, type: 'redeemed',
                description: `Redeemed: ${reward.name}`,
              });
              if (error) throw error;
              await supabase.from('loyalty_points')
                .update({ points_balance: pointsBalance - reward.points_required })
                .eq('client_id', clientId).eq('barber_id', barberId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Redeemed! 🎉', `Show your barber this screen to claim your "${reward.name}".`);
              await fetchData();
            } catch (err: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', err.message || 'Could not redeem. Please try again.');
            }
            setRedeeming(null);
          },
        },
      ]
    );
  };

  const tier     = getTier(visitCount);
  const nextTier = getNextTier(visitCount);
  const pct      = nextTier
    ? Math.max(3, Math.min(100, ((visitCount - tier.minVisits) / (nextTier.minVisits - tier.minVisits)) * 100))
    : 100;
  const tierIcon   = isDark ? tier.iconD   : tier.iconL;
  const tierPillBg = isDark ? tier.bgD     : tier.bgL;
  const tierPillBorder = isDark ? tier.borderD : tier.borderL;
  const earnedRewards = rewards.filter((r) => pointsBalance >= r.points_required);
  const lockedRewards = rewards.filter((r) => pointsBalance < r.points_required);
  const nextReward    = lockedRewards[0] ?? null;
  const ptsToNext     = nextReward ? Math.max(0, nextReward.points_required - pointsBalance) : 0;
  const nextRewardPct = nextReward ? Math.min(100, (pointsBalance / nextReward.points_required) * 100) : 0;

  if (loading) return (
    <View style={[S.loader, { backgroundColor: C.bg }]}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  return (
    <SafeAreaView style={[S.safe, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Header */}
      <View style={[S.header, { borderBottomColor: C.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[S.title, { color: C.text }]}>Rewards</Text>
          {barbershopName && (
            <View style={S.shopRow}>
              <MapPin color={C.text3} size={10} />
              <Text style={[S.shopLabel, { color: C.text3 }]}>{barbershopName}{barbershopCity ? ` · ${barbershopCity}` : ''}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={S.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fade, transform: [{ translateY: slideY }], gap: 14 }}>

          {/* ── HERO POINTS CARD ── */}
          <View style={[S.heroCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {/* Top row: tier + next tier */}
            <View style={S.heroTopRow}>
              <View style={[S.tierPill, { backgroundColor: tierPillBg, borderColor: tierPillBorder }]}>
                <Star color={tierIcon} size={12} fill={tierIcon} />
                <Text style={[S.tierPillTxt, { color: tierIcon }]}>{tier.label} Member</Text>
              </View>
              {nextTier && (
                <Text style={[S.nextTierHint, { color: C.text3 }]}>
                  {nextTier.minVisits - visitCount} visit{nextTier.minVisits - visitCount !== 1 ? 's' : ''} to {nextTier.label}
                </Text>
              )}
            </View>

            {/* Big points number */}
            <AnimatedCounter value={pointsBalance} style={{ fontSize: 42, fontWeight: '900', letterSpacing: -1.5, color: C.text }} />
            <Text style={[S.heroPointsLabel, { color: C.text3 }]}>loyalty points</Text>

            {/* Stats row */}
            <View style={[S.heroStats, { borderTopColor: C.border }]}>
              {[
                { label: 'Lifetime pts', val: lifetimePoints, tone: TONES.violet },
                { label: 'Visits',       val: visitCount,     tone: TONES.blue   },
                ...(nextReward ? [{ label: 'Pts to next', val: ptsToNext, tone: TONES.amber }] : []),
              ].map(({ label, val, tone }, i, arr) => (
                <React.Fragment key={label}>
                  <View style={S.heroStat}>
                    <AnimatedCounter value={val} style={{ fontSize: 22, fontWeight: '900', letterSpacing: -0.5, color: tone.icon }} />
                    <Text style={[S.heroStatLbl, { color: C.text3 }]}>{label}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[S.heroStatDivider, { backgroundColor: C.border }]} />}
                </React.Fragment>
              ))}
            </View>

            {/* Tier progress bar */}
            {nextTier && (
              <View style={S.progWrap}>
                <View style={[S.progTrack, { backgroundColor: C.bg3 }]}>
                  <View style={[S.progFill, { width: `${pct}%` as any, backgroundColor: tierIcon }]} />
                </View>
                <View style={S.progLabels}>
                  <Text style={[S.progLbl, { color: C.text3 }]}>{tier.label}</Text>
                  <Text style={[S.progLbl, { color: C.text3 }]}>{nextTier.label}</Text>
                </View>
              </View>
            )}
          </View>

          {/* ── TIER ROADMAP ── */}
          {barberId && (
            <View>
              <Text style={[S.secLabel, { color: C.text3 }]}>TIER ROADMAP</Text>
              <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                {TIERS.slice(1).map((t, i) => {
                  const cfg       = tierConfig.find((c: any) => c.tier === t.tier);
                  const visitsReq = cfg?.visits_required ?? t.minVisits;
                  const perkType  = cfg?.perk_type ?? 'custom';
                  const perkVal   = cfg?.perk_value ?? '';
                  const unlocked  = visitCount >= visitsReq;
                  const tIcon     = isDark ? t.iconD : t.iconL;
                  const tBg       = isDark ? t.bgD   : t.bgL;
                  const perkLabel = perkVal
                    ? perkType === 'discount'     ? `${perkVal}% off`
                    : perkType === 'bonus_points' ? `+${perkVal} pts`
                    : perkType === 'free_addon'   ? `Free: ${perkVal}`
                    : perkVal
                    : null;
                  return (
                    <View
                      key={t.tier}
                      style={[
                        S.tierRoadRow,
                        i < TIERS.length - 2 && { borderBottomWidth: 1, borderBottomColor: C.border },
                        { opacity: unlocked ? 1 : 0.5 },
                      ]}
                    >
                      <View style={[S.rewardIconWrap, { backgroundColor: tBg }]}>
                        {unlocked
                          ? <Check color={tIcon} size={15} strokeWidth={2.5} />
                          : <Star  color={tIcon} size={14} strokeWidth={1.8} />
                        }
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.rewardName, { color: unlocked ? C.text : C.text2 }]}>{t.label}</Text>
                        {perkLabel
                          ? <Text style={[S.rewardDesc, { color: tIcon, fontWeight: '600' }]}>{perkLabel}</Text>
                          : null
                        }
                      </View>
                      <View style={[S.tierVisitBadge, { backgroundColor: tBg }]}>
                        <Text style={[S.tierVisitTxt, { color: tIcon }]}>
                          {visitsReq} {visitsReq === 1 ? 'visit' : 'visits'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── NEXT REWARD PROGRESS ── */}
          {nextReward && (
            <View style={[S.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={S.cardHeaderRow}>
                <View style={[S.cardIconWrap, { backgroundColor: TONES.amber.bg }]}>
                  <Gift color={TONES.amber.icon} size={16} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.cardTitle, { color: C.text }]}>Next reward</Text>
                  <Text style={[S.cardSub, { color: C.text3 }]}>{nextReward.name}</Text>
                </View>
                <View style={[S.ptsBadge, { backgroundColor: TONES.amber.bg, borderColor: TONES.amber.border }]}>
                  <Text style={[S.ptsBadgeTxt, { color: TONES.amber.icon }]}>{ptsToNext} pts away</Text>
                </View>
              </View>
              <View style={[S.rewardTrack, { backgroundColor: C.bg3 }]}>
                <View style={[S.rewardFill, { width: `${nextRewardPct}%` as any, backgroundColor: TONES.amber.icon }]} />
              </View>
              <View style={S.rewardTrackLabels}>
                <Text style={[S.progLbl, { color: C.text3 }]}>{pointsBalance} pts</Text>
                <Text style={[S.progLbl, { color: C.text3 }]}>{nextReward.points_required} pts</Text>
              </View>
            </View>
          )}

          {/* ── READY TO REDEEM ── */}
          {earnedRewards.length > 0 && (
            <View>
              <Text style={[S.secLabel, { color: C.text3 }]}>READY TO REDEEM</Text>
              <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                {earnedRewards.map((r, i) => (
                  <View
                    key={r.id}
                    style={[S.rewardRow, i < earnedRewards.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                  >
                    <View style={[S.rewardIconWrap, { backgroundColor: TONES.emerald.bg }]}>
                      <Check color={TONES.emerald.icon} size={16} strokeWidth={2.5} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[S.rewardName, { color: C.text }]}>{r.name}</Text>
                      {r.description ? <Text style={[S.rewardDesc, { color: C.text3 }]}>{r.description}</Text> : null}
                      <Text style={[S.rewardPts, { color: TONES.emerald.icon }]}>{r.points_required} pts</Text>
                    </View>
                    <Tap
                      onPress={() => handleRedeem(r)}
                      disabled={!!redeeming}
                      style={[S.redeemBtn, { backgroundColor: TONES.emerald.bg, borderColor: TONES.emerald.border, opacity: redeeming === r.id ? 0.6 : 1 }]}
                    >
                      {redeeming === r.id
                        ? <ActivityIndicator color={TONES.emerald.icon} size="small" />
                        : <Text style={[S.redeemBtnTxt, { color: TONES.emerald.icon }]}>Redeem</Text>
                      }
                    </Tap>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── REWARDS CATALOG ── */}
          {rewards.length > 0 && (
            <View>
              <Text style={[S.secLabel, { color: C.text3 }]}>REWARDS CATALOG</Text>
              <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                {rewards.map((r, i) => {
                  const earned = pointsBalance >= r.points_required;
                  const prog   = Math.min(100, (pointsBalance / r.points_required) * 100);
                  const tone   = earned ? TONES.emerald : TONES.amber;
                  return (
                    <View
                      key={r.id}
                      style={[S.catalogRow, i < rewards.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                    >
                      <View style={[S.rewardIconWrap, { backgroundColor: tone.bg }]}>
                        {earned
                          ? <Check color={tone.icon} size={15} strokeWidth={2.5} />
                          : <Star  color={tone.icon} size={15} strokeWidth={1.8} />
                        }
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[S.rewardName, { color: earned ? C.text : C.text2 }]}>{r.name}</Text>
                        {r.description ? <Text style={[S.rewardDesc, { color: C.text3 }]}>{r.description}</Text> : null}
                        <View style={[S.catalogTrack, { backgroundColor: C.bg3 }]}>
                          <View style={[S.catalogFill, { width: `${prog}%` as any, backgroundColor: tone.icon }]} />
                        </View>
                      </View>
                      <View style={[S.ptsBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                        <Text style={[S.ptsBadgeTxt, { color: tone.icon }]}>
                          {earned ? '✓ Done' : `${r.points_required} pts`}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── ACTIVE PROMOTIONS ── */}
          {activePromotions.length > 0 && (
            <View>
              <Text style={[S.secLabel, { color: C.text3 }]}>ACTIVE OFFERS</Text>
              <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                {activePromotions.map((promo, i) => {
                  const valueLabel = promo.type === 'discount_percent' ? `${promo.value}% off`
                    : promo.type === 'bonus_points'  ? `+${promo.value} pts`
                    : promo.type === 'double_points' ? '2× points'
                    : 'Free service';
                  return (
                    <View
                      key={promo.id}
                      style={[S.catalogRow, i < activePromotions.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                    >
                      <View style={[S.rewardIconWrap, { backgroundColor: TONES.blue.bg }]}>
                        <Megaphone color={TONES.blue.icon} size={15} strokeWidth={1.9} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.rewardName, { color: C.text }]}>{promo.title}</Text>
                        {promo.description ? <Text style={[S.rewardDesc, { color: C.text3 }]}>{promo.description}</Text> : null}
                        {promo.ends_at && (
                          <Text style={[S.rewardDesc, { color: C.text3, marginTop: 3 }]}>
                            Ends {format(new Date(promo.ends_at), 'MMM d, yyyy')}
                          </Text>
                        )}
                      </View>
                      <View style={[S.ptsBadge, { backgroundColor: TONES.blue.bg, borderColor: TONES.blue.border }]}>
                        <Text style={[S.ptsBadgeTxt, { color: TONES.blue.icon }]}>{valueLabel}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── HOW TO EARN ── */}
          <View>
            <Text style={[S.secLabel, { color: C.text3 }]}>HOW TO EARN</Text>
            <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              {[
                { Icon: Scissors, label: 'Get a Cut',      desc: 'Points credited automatically after every visit', tone: TONES.violet  },
                { Icon: Users,    label: 'Refer a Friend', desc: 'Bonus points when they book their first cut',     tone: TONES.emerald },
                { Icon: Zap,      label: 'Special Events', desc: 'Double points and bonus offers from your barber', tone: TONES.amber   },
              ].map((item, i) => (
                <View
                  key={item.label}
                  style={[S.howRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                >
                  <View style={[S.rewardIconWrap, { backgroundColor: item.tone.bg }]}>
                    <item.Icon color={item.tone.icon} size={16} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.howLabel, { color: C.text }]}>{item.label}</Text>
                    <Text style={[S.howDesc,  { color: C.text3 }]}>{item.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* ── POINTS HISTORY ── */}
          {transactions.length > 0 && (
            <View>
              <Text style={[S.secLabel, { color: C.text3 }]}>POINTS HISTORY</Text>
              <View style={[S.listCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <TouchableOpacity
                  style={S.historyToggle}
                  onPress={() => { Haptics.selectionAsync(); setShowHistory((v) => !v); }}
                  activeOpacity={0.7}
                >
                  <View style={S.historyToggleLeft}>
                    <View style={[S.rewardIconWrap, { backgroundColor: C.bg2 }]}>
                      <Clock color={C.text2} size={15} strokeWidth={1.9} />
                    </View>
                    <Text style={[S.historyToggleTxt, { color: C.text }]}>{transactions.length} transactions</Text>
                  </View>
                  {showHistory
                    ? <ChevronUp   color={C.text3} size={16} />
                    : <ChevronDown color={C.text3} size={16} />
                  }
                </TouchableOpacity>
                {showHistory && transactions.map((t, i) => (
                  <View key={t.id} style={[S.txRow, { borderTopColor: C.border, borderTopWidth: 1 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[S.txDesc, { color: C.text }]} numberOfLines={1}>
                        {t.description || (t.type === 'earned' ? 'Points earned' : t.type === 'redeemed' ? 'Reward redeemed' : 'Adjustment')}
                      </Text>
                      <Text style={[S.txDate, { color: C.text3 }]}>{format(new Date(t.created_at), 'MMM d, yyyy')}</Text>
                    </View>
                    <View style={[S.txBadge, {
                      backgroundColor: t.points > 0 ? TONES.emerald.bg : 'rgba(239,68,68,0.10)',
                      borderColor:     t.points > 0 ? TONES.emerald.border : 'rgba(239,68,68,0.20)',
                    }]}>
                      <Text style={[S.txPts, { color: t.points > 0 ? TONES.emerald.icon : '#ef4444' }]}>
                        {t.points > 0 ? '+' : ''}{t.points}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:   { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1,
  },
  title:     { fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  shopRow:   { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  shopLabel: { fontSize: 11 },

  scroll:   { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 120 },
  secLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9, marginBottom: 8, marginLeft: 2 },

  // Hero
  heroCard: {
    borderRadius: 22, borderWidth: 1, padding: 20,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12 },
      android: { elevation: 3 },
    }),
  },
  heroTopRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  tierPill:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  tierPillTxt:    { fontSize: 12, fontWeight: '800' },
  nextTierHint:   { fontSize: 12, fontWeight: '500' },
  heroPoints:     { fontSize: 56, fontWeight: '900', letterSpacing: -2 },
  heroPointsLabel:{ fontSize: 13, marginTop: 2, marginBottom: 18 },

  heroStats:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', borderTopWidth: 1, paddingTop: 16, marginBottom: 16 },
  heroStat:        { alignItems: 'center', gap: 3, flex: 1 },
  heroStatVal:     { fontSize: 17, fontWeight: '900', letterSpacing: -0.4 },
  heroStatLbl:     { fontSize: 10, fontWeight: '600' },
  heroStatDivider: { width: 1, height: 30 },

  progWrap:   { gap: 6 },
  progTrack:  { height: 5, borderRadius: 3, overflow: 'hidden' },
  progFill:   { height: '100%', borderRadius: 3 },
  progLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  progLbl:    { fontSize: 10, fontWeight: '600' },

  // Next reward card
  card: {
    borderRadius: 18, borderWidth: 1, padding: 16,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  cardIconWrap:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle:     { fontSize: 14, fontWeight: '700' },
  cardSub:       { fontSize: 12, marginTop: 1 },
  rewardTrack:   { height: 5, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  rewardFill:    { height: '100%', borderRadius: 3 },
  rewardTrackLabels: { flexDirection: 'row', justifyContent: 'space-between' },

  // List card
  listCard: {
    borderRadius: 18, borderWidth: 1, overflow: 'hidden',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },

  // Reward rows
  rewardRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rewardIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rewardName:   { fontSize: 14, fontWeight: '700' },
  rewardDesc:   { fontSize: 12, marginTop: 2 },
  rewardPts:    { fontSize: 12, fontWeight: '700', marginTop: 3 },
  redeemBtn:    { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  redeemBtnTxt: { fontSize: 13, fontWeight: '700' },

  // Catalog
  catalogRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  catalogTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  catalogFill:  { height: '100%', borderRadius: 2 },
  ptsBadge:     { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, alignItems: 'center', minWidth: 64 },
  ptsBadgeTxt:  { fontSize: 11, fontWeight: '800' },

  // How to earn
  howRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  howLabel: { fontSize: 14, fontWeight: '700' },
  howDesc:  { fontSize: 12, marginTop: 2 },

  // History
  historyToggle:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  historyToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  historyToggleTxt:  { fontSize: 14, fontWeight: '700' },
  txRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  txDesc:   { fontSize: 13, fontWeight: '500' },
  txDate:   { fontSize: 11, marginTop: 2 },
  txBadge:  { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, minWidth: 52, alignItems: 'center' },
  txPts:    { fontSize: 13, fontWeight: '800' },

  // Tier roadmap
  tierRoadRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  tierVisitBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, alignItems: 'center', minWidth: 60 },
  tierVisitTxt:   { fontSize: 11, fontWeight: '800' },
});
