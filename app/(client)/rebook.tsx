import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, StyleSheet, StatusBar, Animated, Pressable, Image, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarCheck, Clock, Scissors, ChevronLeft, ChevronRight, Check, MapPin, Users, CreditCard, Wallet, Store } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { getBarberProfile } from '@/lib/barber';
import { getActiveClientBinding } from '@/lib/clientSync';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, isBefore, isToday,
} from 'date-fns';
import { useTheme } from '@/lib/theme';
import { scheduleLocalAppointmentReminder } from '@/lib/notifications';

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ── Fire appointment_booked automations from mobile ───────────────────────────
// Mirrors automationUtils.fireEvent('appointment_booked') but without
// web-only deps (window, localStorage, toast/sonner).
async function fireBookingAutomations(opts: {
  barberId: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  serviceName: string;
  servicePrice?: number | null;
  appointmentDate: string;
  appointmentTime: string;
  shopName: string;
}) {
  const {
    barberId, clientId, clientName, clientEmail,
    serviceName, servicePrice, appointmentDate, appointmentTime, shopName,
  } = opts;

  try {
    // 1. Send booking confirmation in-app message
    if (clientId) {
      const confirmMsg =
        `✅ Your appointment is confirmed!\n` +
        `📅 ${appointmentDate} at ${appointmentTime.slice(0, 5)}\n` +
        `✂️  ${serviceName}\n` +
        `🏪 ${shopName}`;
      await (supabase as any).rpc('send_booking_notification', {
        p_barber_id: barberId,
        p_client_id: clientId,
        p_message: confirmMsg,
      }).catch(() => {});
    }

    // 2. Notify barber (in-app notification)
    await (supabase as any).rpc('create_notification', {
      p_user_id: barberId,
      p_type: 'booking',
      p_title: 'New Booking',
      p_body: `${clientName} booked ${serviceName} on ${appointmentDate} at ${appointmentTime.slice(0, 5)}`,
      p_icon: 'calendar-check',
      p_link: '/calendar',
    }).catch(() => {});

    // 3. Fetch & fire appointment_booked automations
    const { data: rpcData } = await (supabase as any).rpc('get_enabled_automations', {
      p_barber_id: barberId,
    });
    if (!rpcData) return;

    const rawList = Array.isArray(rpcData)
      ? rpcData
      : typeof rpcData === 'string' ? JSON.parse(rpcData) : [];

    const bookingLink = `https://app.kutz.app/c/${barberId}`;

    for (const auto of rawList) {
      const nodes = typeof auto.nodes === 'string' ? JSON.parse(auto.nodes) : (auto.nodes ?? []);
      if (!nodes.length) continue;
      const trigger = nodes[0];
      if (trigger.type !== 'trigger' || trigger.subtype !== 'appointment_booked') continue;
      if (!auto.enabled) continue;

      // Process action nodes (skip trigger node at index 0, skip delay/condition for now)
      for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.type !== 'action') continue;

        const fillMsg = (tpl: string) =>
          (tpl || '')
            .replace(/\{name\}/g, clientName)
            .replace(/\{service\}/g, serviceName)
            .replace(/\{service_name\}/g, serviceName)
            .replace(/\{date\}/g, appointmentDate)
            .replace(/\{time\}/g, appointmentTime.slice(0, 5))
            .replace(/\{barber\}/g, shopName)
            .replace(/\{link\}/g, bookingLink)
            .replace(/\{price\}/g, servicePrice != null ? `$${Number(servicePrice).toFixed(2)}` : '');

        if (node.subtype === 'send_sms' && clientId) {
          // In-app message (SMS channel maps to in-app in mobile context)
          const msg = fillMsg(node.config?.message || 'Hey {name}!');
          await (supabase as any).rpc('send_automation_message', {
            p_barber_id: barberId,
            p_client_id: clientId,
            p_content: msg,
            p_sender_type: 'barber',
          }).catch(() => {});
        } else if (node.subtype === 'send_email' && clientEmail) {
          const subject = fillMsg(node.config?.subject || `Booking confirmed at ${shopName}`);
          const body = fillMsg(node.config?.body || node.config?.message || '');
          await supabase.functions.invoke('send-email', {
            body: { to: clientEmail, subject, html: body.replace(/\n/g, '<br/>'), text: body },
          }).catch(() => {});
        } else if (node.subtype === 'send_real_sms' && clientEmail) {
          // Real SMS — send email as fallback since we don't store phone here
          const msg = fillMsg(node.config?.message || 'Hey {name}!');
          await supabase.functions.invoke('send-email', {
            body: {
              to: clientEmail,
              subject: `Appointment confirmation – ${shopName}`,
              html: msg.replace(/\n/g, '<br/>'),
              text: msg,
            },
          }).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn('[MobileBooking] fireBookingAutomations error:', e);
  }
}

function fmt12(t: string) {
  try {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

type Step = 'service' | 'date' | 'confirm';

type PaymentMethod = 'apple_pay' | 'card' | 'at_shop';

type TeamMember = {
  id: string;
  display_name: string;
  role?: string | null;
  avatar_url?: string | null;
  color?: string | null;
};

type StepMeta = {
  key: Step;
  label: string;
};

type ScheduleRow = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  team_member_id?: string | null;
};

// Pressable tile with spring scale + haptic
function Tile({ onPress, style, children, disabled = false }: {
  onPress: () => void; style?: any; children: React.ReactNode; disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(scale, { toValue: 0.985, useNativeDriver: true, tension: 500, friction: 28 }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 500, friction: 30 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export default function RebookScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';
  const accentText = C.accentText;

  const [loading, setLoading] = useState(true);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [barberScopeIds, setBarberScopeIds] = useState<string[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopCity, setShopCity] = useState('');
  const [services, setServices] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [serviceAssignments, setServiceAssignments] = useState<Record<string, Set<string>>>({});
  const [teamHoursText, setTeamHoursText] = useState<Record<string, string>>({});
  const [selectedTeamMember, setSelectedTeamMember] = useState<string>('');
  const [selectedService, setSelectedService] = useState<any>(null);
  const [todayHoursText, setTodayHoursText] = useState('Check today availability');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Record<string, boolean>>({});
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [step, setStep] = useState<Step>('service');
  const [hasShop, setHasShop] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('at_shop');
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [barberEmail, setBarberEmail] = useState<string | null>(null);
  const [passFeesToClient, setPassFeesToClient] = useState(true);
  const selectedRealTeamMember = selectedTeamMember.startsWith('owner:') ? '' : selectedTeamMember;

  // Slide animation between steps
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const animateStep = useCallback((dir: 'forward' | 'back') => {
    const start = dir === 'forward' ? 14 : -14;
    slideAnim.setValue(start);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 300, friction: 30, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  const goStep = useCallback((next: Step, dir: 'forward' | 'back' = 'forward') => {
    Haptics.impactAsync(dir === 'forward' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft);
    setStep(next);
    animateStep(dir);
  }, [animateStep]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

      const binding = await getActiveClientBinding(session.user.id);
      if (!binding) {
        setHasShop(false);
        setLoading(false);
        return;
      }

      setHasShop(true);

      setBarberId(binding.barberId);
      setClientId(binding.clientId);
      setClientEmail(session.user.email ?? null);
      setClientName(binding.name || session.user.user_metadata?.full_name || 'Client');

      const [svcsRes, profile, staffRes, barberProfileRes] = await Promise.all([
        supabase.from('services').select('id, name, description, price, duration_minutes')
          .eq('barber_id', binding.barberId).eq('is_active', true).order('price', { ascending: true }),
        getBarberProfile(binding.barberId),
        supabase.rpc('get_all_shop_staff', { p_barber_id: binding.barberId }),
        supabase.from('profiles').select('email, pass_fees_to_client').or(`id.eq.${binding.barberId},user_id.eq.${binding.barberId}`).limit(1).maybeSingle(),
      ]);
      setBarberEmail((barberProfileRes.data as any)?.email ?? null);
      setPassFeesToClient((barberProfileRes.data as any)?.pass_fees_to_client ?? true);

      let servicesData = (svcsRes.data as any[]) ?? [];
      const p = profile as any;
      const scopeIds = Array.from(new Set([binding.barberId, p?.id, p?.user_id].filter(Boolean))) as string[];
      setBarberScopeIds(scopeIds);
      if (servicesData.length === 0 && scopeIds.length > 1) {
        const retry = await supabase
          .from('services').select('id, name, description, price, duration_minutes')
          .in('barber_id', scopeIds).eq('is_active', true).order('price', { ascending: true });
        servicesData = (retry.data as any[]) ?? [];
      }

      const unique = new Map<string, TeamMember>();
      for (const tm of (((staffRes.data as any[]) ?? []) as any[])) {
        const mapped: TeamMember = {
          id: tm.is_owner ? `owner:${binding.barberId}` : tm.id,
          display_name: tm.display_name,
          role: tm.role,
          avatar_url: tm.avatar_url,
          color: tm.color,
        };
        unique.set(mapped.id, mapped);
      }

      try {
        const byOwner = await supabase
          .from('team_members')
          .select('id, display_name, role, avatar_url, color')
          .eq('shop_owner_id', binding.barberId)
          .eq('is_active', true);
        for (const tm of ((byOwner.data as any[]) ?? []) as TeamMember[]) unique.set(tm.id, tm);
      } catch {}

      const ownerMember: TeamMember = {
        id: `owner:${binding.barberId}`,
        display_name: p?.display_name || p?.shop_name || 'Shop Owner',
        role: 'Owner',
        avatar_url: p?.avatar_url || null,
        color: null,
      };
      if (![...unique.values()].some((tm) => tm.id === ownerMember.id || tm.display_name === ownerMember.display_name)) {
        unique.set(ownerMember.id, ownerMember);
      }
      const mergedTeamData = Array.from(unique.values());

      setServices(servicesData);
      setTeamMembers(mergedTeamData);
      setStep('service');

      if (servicesData.length > 0) {
        try {
          const serviceIds = servicesData.map((s) => s.id);
          const { data: asgRows } = await supabase
            .from('service_assignments')
            .select('service_id, team_member_id')
            .in('service_id', serviceIds);

          const map: Record<string, Set<string>> = {};
          for (const row of ((asgRows as any[]) ?? [])) {
            if (!row?.service_id || !row?.team_member_id) continue;
            if (!map[row.service_id]) map[row.service_id] = new Set<string>();
            map[row.service_id].add(row.team_member_id);
          }
          setServiceAssignments(map);
        } catch {
          setServiceAssignments({});
        }
      }

      if (p) {
        setShopName(p.shop_name || p.display_name || 'Your Barber');
        setShopCity(p.city || '');
      }

      // Working hours text for today
      let fallbackHours = 'Check today availability';
      try {
        const dayNum = new Date().getDay();
        const { data: schRows } = await supabase
          .from('barber_schedule')
          .select('start_time, end_time, is_active')
          .in('barber_id', scopeIds)
          .eq('day_of_week', dayNum);
        const s = (((schRows as any[]) ?? []).find((r: any) => r?.is_active) ?? null) as any;
        if (s?.is_active && s?.start_time && s?.end_time) {
          fallbackHours = `Open today ${fmt12(s.start_time)} - ${fmt12(s.end_time)}`;
        } else {
          fallbackHours = 'Closed today';
        }
      } catch {
        fallbackHours = 'Check today availability';
      }
      setTodayHoursText(fallbackHours);

      if (mergedTeamData.length > 0) {
        const byMember: Record<string, string> = {};
        const todayDow = new Date().getDay();
        for (const tm of mergedTeamData) {
          if (tm.id.startsWith('owner:')) {
            byMember[tm.id] = fallbackHours;
            continue;
          }
          try {
            const primary = await supabase
              .from('team_member_schedule')
              .select('start_time, end_time, is_active')
              .eq('team_member_id', tm.id)
              .eq('day_of_week', todayDow)
              .maybeSingle();
            let row = primary.data as any;
            if (!row && primary.error) {
              const alt = await supabase
                .from('team_member_schedules')
                .select('start_time, end_time, is_active')
                .eq('team_member_id', tm.id)
                .eq('day_of_week', todayDow)
                .maybeSingle();
              row = alt.data as any;
            }
            if (row?.is_active && row?.start_time && row?.end_time) {
              byMember[tm.id] = `Open ${fmt12(row.start_time)} - ${fmt12(row.end_time)}`;
            } else {
              byMember[tm.id] = fallbackHours;
            }
          } catch {
            byMember[tm.id] = fallbackHours;
          }
        }
        setTeamHoursText(byMember);
      }
      setLoading(false);
    })();
  }, []);

  const fetchAvailableDatesForMonth = useCallback(async () => {
    if (!barberId || !selectedService) {
      setAvailableDates({});
      return;
    }

    try {
      const scopeIds = barberScopeIds.length > 0 ? barberScopeIds : [barberId];
      const { data: barberRowsRaw } = await supabase
        .from('barber_schedule')
        .select('day_of_week, start_time, end_time, is_active')
        .in('barber_id', scopeIds);

      const barberRows = ((barberRowsRaw as any[]) ?? []) as ScheduleRow[];

      let teamRows = [] as ScheduleRow[];
      if (selectedRealTeamMember) {
        const primary = await supabase
          .from('team_member_schedule')
          .select('team_member_id, day_of_week, start_time, end_time, is_active')
          .eq('team_member_id', selectedRealTeamMember);
        teamRows = ((primary.data as any[]) ?? []) as ScheduleRow[];
        if (teamRows.length === 0) {
          const alt = await supabase
            .from('team_member_schedules')
            .select('team_member_id, day_of_week, start_time, end_time, is_active')
            .eq('team_member_id', selectedRealTeamMember);
          teamRows = ((alt.data as any[]) ?? []) as ScheduleRow[];
        }
      } else {
        const teamIds = teamMembers.filter((m) => !m.id.startsWith('owner:')).map((m) => m.id);
        if (teamIds.length > 0) {
          const primary = await supabase
            .from('team_member_schedule')
            .select('team_member_id, day_of_week, start_time, end_time, is_active')
            .in('team_member_id', teamIds);
          teamRows = ((primary.data as any[]) ?? []) as ScheduleRow[];
          if (teamRows.length === 0) {
            const alt = await supabase
              .from('team_member_schedules')
              .select('team_member_id, day_of_week, start_time, end_time, is_active')
              .in('team_member_id', teamIds);
            teamRows = ((alt.data as any[]) ?? []) as ScheduleRow[];
          }
        }
      }

      const activeBarberDays = new Set(
        barberRows.filter((r) => r.is_active && r.start_time && r.end_time).map((r) => r.day_of_week),
      );
      const activeTeamDays = new Set(
        teamRows.filter((r) => r.is_active && r.start_time && r.end_time).map((r) => r.day_of_week),
      );

      const monthDays = eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth),
      });
      const now = new Date();
      const duration = Number(selectedService?.duration_minutes ?? 30);
      const map: Record<string, boolean> = {};

      for (const day of monthDays) {
        const key = format(day, 'yyyy-MM-dd');
        const dow = day.getDay();
        const isPastDay = isBefore(day, now) && !isToday(day);
        if (isPastDay) {
          map[key] = false;
          continue;
        }

        const hasBaseAvailability = selectedRealTeamMember
          ? (activeTeamDays.has(dow) || activeBarberDays.has(dow))
          : (activeBarberDays.has(dow) || activeTeamDays.has(dow));
        if (!hasBaseAvailability) {
          map[key] = false;
          continue;
        }

        if (isToday(day)) {
          let latestEnd = 0;
          for (const r of barberRows) {
            if (r.is_active && r.day_of_week === dow) latestEnd = Math.max(latestEnd, toMinutes(String(r.end_time).slice(0, 5)));
          }
          for (const r of teamRows) {
            if (r.is_active && r.day_of_week === dow) latestEnd = Math.max(latestEnd, toMinutes(String(r.end_time).slice(0, 5)));
          }
          const nowMins = now.getHours() * 60 + now.getMinutes();
          map[key] = latestEnd - nowMins >= duration;
        } else {
          map[key] = true;
        }
      }

      setAvailableDates(map);
    } catch (err) {
      console.error('fetchAvailableDatesForMonth error:', err);
      setAvailableDates({});
    }
  }, [barberId, barberScopeIds, currentMonth, selectedRealTeamMember, selectedService, teamMembers]);

  const fetchSlots = useCallback(async (date: Date) => {
    if (!barberId || !selectedService) return;
    setLoadingSlots(true);
    setAvailableSlots([]);
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayNum = date.getDay();
      const scopeIds = barberScopeIds.length > 0 ? barberScopeIds : [barberId];

      const { data: scheduleRows } = await supabase
        .from('barber_schedule').select('start_time, end_time, is_active')
        .in('barber_id', scopeIds).eq('day_of_week', dayNum);
      const schedule = ((scheduleRows as any[]) ?? []).find((r: any) => r?.is_active) ?? null;

      if (!schedule || !(schedule as any).is_active) {
        setLoadingSlots(false);
        return;
      }

      let apptQuery = supabase
        .from('appointments').select('start_time, end_time')
        .in('barber_id', scopeIds).eq('date', dateStr)
        .in('status', ['confirmed', 'pending', 'in_chair']);

      if (selectedRealTeamMember) {
        apptQuery = apptQuery.eq('team_member_id', selectedRealTeamMember);
      }

      const { data: appts } = await apptQuery;

      let teamWindow: { start: string; end: string } | null = null;
      if (selectedRealTeamMember) {
        try {
          const primary = await supabase
            .from('team_member_schedule')
            .select('start_time, end_time, is_active')
            .eq('team_member_id', selectedRealTeamMember)
            .eq('day_of_week', dayNum)
            .maybeSingle();
          let row = primary.data as any;
          if (!row && primary.error) {
            const alt = await supabase
              .from('team_member_schedules')
              .select('start_time, end_time, is_active')
              .eq('team_member_id', selectedRealTeamMember)
              .eq('day_of_week', dayNum)
              .maybeSingle();
            row = alt.data as any;
          }
          if (row?.is_active && row?.start_time && row?.end_time) {
            teamWindow = { start: row.start_time, end: row.end_time };
          }
        } catch {}
      }

      const slots: string[] = [];
      const sched = schedule as any;
      let startMins = toMinutes(sched.start_time);
      let endMins = toMinutes(sched.end_time);
      if (teamWindow) {
        startMins = Math.max(startMins, toMinutes(teamWindow.start));
        endMins = Math.min(endMins, toMinutes(teamWindow.end));
      }
      const dur = selectedService.duration_minutes || 30;
      const now = new Date();
      const anyProCapacity = !selectedRealTeamMember
        ? Math.max(1, teamMembers.length || 1)
        : 1;

      for (let mins = startMins; mins + dur <= endMins; mins += 30) {
        const hh = String(Math.floor(mins / 60)).padStart(2, '0');
        const mm = String(mins % 60).padStart(2, '0');
        const slot = `${hh}:${mm}`;
        if (isToday(date)) {
          const st = new Date(date);
          st.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
          if (st <= now) continue;
        }
        const slotEnd = mins + dur;
        const overlappingCount = ((appts as any[]) ?? []).filter((a: any) => {
          const otherStart = toMinutes(String(a.start_time ?? '00:00').slice(0, 5));
          // Use end_time if available, otherwise fall back to start + 30min
          const otherEnd = a.end_time
            ? toMinutes(String(a.end_time).slice(0, 5))
            : otherStart + 30;
          return overlaps(mins, slotEnd, otherStart, Math.max(otherEnd, otherStart + 15));
        }).length;
        const canTakeSlot = selectedRealTeamMember
          ? overlappingCount === 0
          : overlappingCount < anyProCapacity;
        if (canTakeSlot) slots.push(slot);
      }
      setAvailableSlots(slots);
    } catch (err) { console.error('fetchSlots error:', err); }
    setLoadingSlots(false);
  }, [barberId, barberScopeIds, selectedService, selectedRealTeamMember, teamMembers]);

  const filteredServices = services.filter((svc) => {
    if (!selectedRealTeamMember) return true;
    const assigned = serviceAssignments[svc.id];
    if (!assigned || assigned.size === 0) return true;
    return assigned.has(selectedRealTeamMember);
  });

  useEffect(() => {
    if (selectedDate && selectedService) fetchSlots(selectedDate);
  }, [selectedDate, selectedService, fetchSlots]);

  useEffect(() => {
    fetchAvailableDatesForMonth();
  }, [fetchAvailableDatesForMonth]);

  const handleBook = async () => {
    if (!barberId || !clientId || !selectedService || !selectedDate || !selectedSlot) return;
    setBooking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Calculate end_time from start_time + duration
      const dur = selectedService.duration_minutes || 30;
      const [startH, startM] = selectedSlot.split(':').map(Number);
      const endTotalMins = startH * 60 + startM + dur;
      const endTime = `${String(Math.floor(endTotalMins / 60)).padStart(2, '0')}:${String(endTotalMins % 60).padStart(2, '0')}:00`;

      // Store the total the client will pay (includes booking fee for online payments)
      const chargeAmount = isOnlinePayment ? displayTotal : (selectedService.price ?? null);

      const { error: insertError } = await supabase.from('appointments').insert({
        barber_id:      barberId,
        client_id:      clientId,
        client_name:    clientName,
        service_id:     selectedService.id,
        date:           format(selectedDate, 'yyyy-MM-dd'),
        start_time:     selectedSlot + ':00',
        end_time:       endTime,
        status:         'confirmed',
        team_member_id: selectedRealTeamMember || null,
        price_charged:  chargeAmount,
        payment_method: paymentMethod,
      });
      if (insertError) throw insertError;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const timeStr = selectedSlot + ':00';

      // ── Fire automation + confirmation message (fire-and-forget) ──────────────
      fireBookingAutomations({
        barberId,
        clientId,
        clientName,
        clientEmail,
        serviceName: selectedService.name,
        servicePrice: selectedService.price,
        appointmentDate: dateStr,
        appointmentTime: timeStr,
        shopName,
      }).catch(() => {});

      // ── Send transactional confirmation email to client via Resend ──────────────────────
      if (clientEmail) {
        const stylistName = selectedRealTeamMember
          ? teamMembers.find((m) => m.id === selectedRealTeamMember)?.display_name ?? undefined
          : undefined;
        supabase.functions.invoke('send-appointment-confirmation', {
          body: {
            to: clientEmail,
            clientName,
            shopName,
            serviceName: selectedService.name,
            appointmentDate: dateStr,
            appointmentTime: timeStr,
            duration: selectedService.duration_minutes ?? undefined,
            price: selectedService.price ?? undefined,
            barberName: stylistName,
            barberEmail: barberEmail ?? undefined,
            bookingLink: `https://app.kutz.io/c/${barberId}`,
          },
        }).catch(() => {});
      }

      // ── Send new booking notification email to barber ─────────────────────────
      if (barberEmail) {
        supabase.functions.invoke('send-barber-notification', {
          body: {
            to: barberEmail,
            clientName,
            shopName,
            serviceName: selectedService.name,
            appointmentDate: dateStr,
            appointmentTime: timeStr,
            price: selectedService.price ?? undefined,
            clientEmail: clientEmail ?? undefined,
          },
        }).catch(() => {});
      }

      // ── Schedule local reminder ────────────────────────────────────────────────
      await scheduleLocalAppointmentReminder(
        `${barberId}-${dateStr}-${timeStr}`,
        clientName,
        selectedService.name,
        dateStr,
        timeStr,
      ).catch(() => {});
      setBooked(true);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Booking failed', err.message || 'Please try again');
    }
    setBooking(false);
  };

  const calStart = startOfWeek(startOfMonth(currentMonth));
  const calEnd = endOfWeek(endOfMonth(currentMonth));
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });
  const today = new Date();

  const flowSteps = (['service', 'date', 'confirm'] as Step[]);
  const stepMeta: StepMeta[] = [
    { key: 'service', label: 'Preferences' },
    { key: 'date',    label: 'Date & Time' },
    { key: 'confirm', label: 'Confirm' },
  ];
  const stepIndex = flowSteps.indexOf(step);

  const selectedMember = selectedTeamMember
    ? teamMembers.find((tm) => tm.id === selectedTeamMember) || null
    : null;
  const selectedMemberName = selectedMember?.display_name || 'Any Pro';
  const selectedAvailabilityText = selectedMember
    ? (teamHoursText[selectedMember.id] || todayHoursText || 'Open hours unavailable')
    : (todayHoursText || 'Open hours unavailable');

  const PAYMENT_OPTIONS: { key: PaymentMethod; label: string; sub: string; Icon: any }[] = [
    { key: 'apple_pay', label: 'Apple Pay',   sub: 'Pay instantly with Face ID', Icon: Wallet },
    { key: 'card',      label: 'Card',         sub: 'Credit or debit card',       Icon: CreditCard },
    { key: 'at_shop',   label: 'At the shop',  sub: 'Pay when you arrive',        Icon: Store },
  ];

  // Fee calculation — only applies when paying online AND barber has pass_fees_to_client on
  // Stripe: 2.9% + $0.30. Platform: 1%. Gross-up so barber always gets their full price.
  const servicePrice    = Number(selectedService?.price ?? 0);
  const isOnlinePayment = paymentMethod === 'apple_pay' || paymentMethod === 'card';
  const applyFees       = isOnlinePayment && passFeesToClient && servicePrice > 0;
  const platformFeePct  = 0.01;
  const stripePct       = 0.029;
  const stripeFixed     = 0.30;
  const totalOnline = applyFees
    ? Math.ceil(((servicePrice + stripeFixed) / (1 - stripePct - platformFeePct)) * 100) / 100
    : servicePrice;
  const bookingFee  = applyFees ? Math.round((totalOnline - servicePrice) * 100) / 100 : 0;
  const displayTotal = applyFees ? totalOnline : servicePrice;

  if (loading) return (
    <View style={[S.loader, { backgroundColor: C.bg }]}><ActivityIndicator color={C.accent} size="large" /></View>
  );

  if (!hasShop) return (
    <SafeAreaView style={[S.loader, { padding: 24, backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
      <View style={S.emptyState}>
        <View style={[S.emptyIcon, { backgroundColor: C.bg2, borderColor: C.border }]}>
          <Scissors color={C.text3} size={30} />
        </View>
        <Text style={[S.emptyText, { color: C.text }]}>Connect a barbershop first</Text>
        <Text style={[S.emptySub, { color: C.text2 }]}>
          Join a shop to book appointments and track loyalty points.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/(client)/discover')}
          style={[S.pickAnotherBtn, { borderColor: C.border, marginTop: 12 }]}
          activeOpacity={0.85}
        >
          <Text style={[S.pickAnotherTxt, { color: C.accent }]}>Find a shop</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (booked) return (
    <SafeAreaView style={[S.loader, { padding: 32, backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
      <Animated.View style={{ alignItems: 'center' }}>
        <View style={[S.successRing, { backgroundColor: isDark ? 'rgba(22,163,74,0.15)' : '#dcfce7', borderColor: isDark ? 'rgba(22,163,74,0.3)' : '#bbf7d0' }]}>
          <View style={[S.successCircle, { backgroundColor: isDark ? 'rgba(22,163,74,0.1)' : '#f0fdf4', borderColor: isDark ? 'rgba(22,163,74,0.3)' : '#bbf7d0' }]}>
            <Check color={C.success} size={38} strokeWidth={2.5} />
          </View>
        </View>
        <Text style={[S.successTitle, { color: C.text }]}>Booked!</Text>
        <Text style={[S.successService, { color: C.text2 }]}>{selectedService?.name}</Text>
        <View style={[S.successDetails, { backgroundColor: C.bg2, borderColor: C.border }]}>
          <View style={S.successDetailRow}>
            <CalendarCheck color={C.text3} size={14} />
            <Text style={[S.successDetailTxt, { color: C.text }]}>
              {selectedDate ? format(selectedDate, 'EEEE, MMMM d') : ''}
            </Text>
          </View>
          <View style={S.successDetailRow}>
            <Clock color={C.text3} size={14} />
            <Text style={[S.successDetailTxt, { color: C.text }]}>{selectedSlot ? fmt12(selectedSlot) : ''}</Text>
          </View>
          {shopName ? (
            <View style={S.successDetailRow}>
              <MapPin color={C.text3} size={14} />
              <Text style={[S.successDetailTxt, { color: C.text }]}>{shopName}{shopCity ? ` · ${shopCity}` : ''}</Text>
            </View>
          ) : null}
          <View style={S.successDetailRow}>
            <Wallet color={C.text3} size={14} />
            <Text style={[S.successDetailTxt, { color: C.text }]}>
              {PAYMENT_OPTIONS.find(p => p.key === paymentMethod)?.label || 'At the shop'}
            </Text>
          </View>
        </View>
        <Text style={[S.successNote, { color: C.text2 }]}>You're all set! A confirmation has been sent to your messages.</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setBooked(false); setStep('service');
            setSelectedService(null); setSelectedDate(null); setSelectedSlot(null);
            setPaymentMethod('at_shop');
          }}
          style={[S.successBtn, { backgroundColor: C.accent }]}
          activeOpacity={0.85}
        >
          <Text style={[S.successBtnText, { color: accentText }]}>Book Another</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[S.container, { backgroundColor: C.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Header */}
      <View style={[S.header, { borderBottomColor: C.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[S.title, { color: C.text }]}>Book Appointment</Text>
          {shopName ? (
            <View style={S.shopRow}>
              <MapPin color={C.text3} size={10} />
              <Text style={[S.shopLabel, { color: C.text3 }]}>{shopName}{shopCity ? ` · ${shopCity}` : ''}</Text>
            </View>
          ) : null}
        </View>
        {/* Step progress */}
        <View style={S.stepMetaWrap}>
          <View style={S.stepBar}>
            {flowSteps.map((s, i) => (
              <View key={s} style={[S.stepDash, { backgroundColor: stepIndex >= i ? C.accent : C.bg3 }]} />
            ))}
          </View>
          <Text style={[S.stepMetaText, { color: C.text3 }]}>{stepMeta[stepIndex]?.label ?? 'Preferences'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── Step 1: Preferences ── */}
          {step === 'service' && (
            <View style={{ gap: 10 }}>
              {teamMembers.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text style={[S.stepHint, { color: C.text2 }]}>Select professional</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.proRow}>
                    <Tile
                      onPress={() => {
                        setSelectedTeamMember('');
                        if (selectedService) {
                          const assigned = serviceAssignments[selectedService.id];
                          if (assigned && assigned.size > 0) setSelectedService(null);
                        }
                      }}
                      style={[S.proCard, { backgroundColor: C.bg, borderColor: C.border }, !selectedTeamMember && { borderColor: C.accent, backgroundColor: C.bg2 }]}
                    >
                      <View style={[S.proAvatarFallback, { backgroundColor: C.bg2 }]}>
                        <Users color={C.accent} size={24} />
                      </View>
                      <Text style={[S.proName, { color: C.text }]}>Any Pro</Text>
                      <Text style={[S.proRole, { color: C.text3 }]}>First available</Text>
                      <Text style={[S.proHours, { color: C.text3 }]} numberOfLines={2}>{todayHoursText}</Text>
                    </Tile>

                    {teamMembers.map((tm) => (
                      <Tile
                        key={tm.id}
                        onPress={() => {
                          setSelectedTeamMember(tm.id);
                          const pickedMemberId = tm.id.startsWith('owner:') ? '' : tm.id;
                          if (selectedService) {
                            const assigned = serviceAssignments[selectedService.id];
                            if (assigned && assigned.size > 0 && pickedMemberId && !assigned.has(pickedMemberId)) {
                              setSelectedService(null);
                            }
                          }
                        }}
                        style={[S.proCard, { backgroundColor: C.bg, borderColor: C.border }, selectedTeamMember === tm.id && { borderColor: C.accent, backgroundColor: C.bg2 }]}
                      >
                        {tm.avatar_url ? (
                          <View style={S.proAvatarWrap}>
                            <Image source={{ uri: tm.avatar_url }} style={S.proAvatarImage} />
                          </View>
                        ) : (
                          <View style={[S.proAvatarFallback, { backgroundColor: C.bg2 }]}>
                            <Text style={[S.proAvatarInitial, { color: C.text }]}>{tm.display_name?.charAt(0)?.toUpperCase() || 'B'}</Text>
                          </View>
                        )}
                        <Text style={[S.proName, { color: C.text }]} numberOfLines={1}>{tm.display_name}</Text>
                        <Text style={[S.proRole, { color: C.text3 }]} numberOfLines={1}>{tm.role || 'Barber'}</Text>
                        <Text style={[S.proHours, { color: C.text3 }]} numberOfLines={2}>{teamHoursText[tm.id] || todayHoursText}</Text>
                      </Tile>
                    ))}
                  </ScrollView>

                  {/* Single availability card below pro picker */}
                  <View style={[S.availCard, { backgroundColor: C.bg2, borderColor: C.border }]}>
                    <View style={S.availCardRow}>
                      <Users color={C.text2} size={13} />
                      <Text style={[S.availCardName, { color: C.text2 }]}>{selectedMemberName}</Text>
                    </View>
                    <View style={S.availCardRow}>
                      <Clock color={C.success} size={13} />
                      <Text style={[S.availCardHours, { color: C.text }]}>{selectedAvailabilityText}</Text>
                    </View>
                  </View>
                </View>
              )}

              <Text style={[S.stepHint, { color: C.text2, marginTop: 4 }]}>Choose a service</Text>
              {filteredServices.length === 0 ? (
                <View style={S.emptyState}>
                  <View style={[S.emptyIcon, { backgroundColor: C.bg2, borderColor: C.border }]}><Scissors color={C.text3} size={28} /></View>
                  <Text style={[S.emptyText, { color: C.text2 }]}>No services for this professional</Text>
                  <Text style={[S.emptySub, { color: C.text3 }]}>Pick another barber or choose Any Pro</Text>
                </View>
              ) : filteredServices.map(svc => (
                <Tile
                  key={svc.id}
                  onPress={() => {
                    setSelectedService(svc);
                    goStep('date');
                  }}
                  style={[S.serviceCard, { backgroundColor: C.card, borderColor: C.border }]}
                >
                  <View style={[S.serviceIcon, { backgroundColor: C.bg2 }]}>
                    <Scissors color={C.accent} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.serviceName, { color: C.text }]}>{svc.name}</Text>
                    {svc.description ? <Text style={[S.serviceDesc, { color: C.text2 }]} numberOfLines={1}>{svc.description}</Text> : null}
                    <Text style={[S.serviceMeta, { color: C.text3 }]}>{svc.duration_minutes} min · ${Number(svc.price).toFixed(2)}</Text>
                  </View>
                  <ChevronRight color={C.text3} size={16} />
                </Tile>
              ))}
            </View>
          )}

          {/* ── Step 2: Date & Time (merged) ── */}
          {step === 'date' && (
            <View style={{ gap: 16 }}>
              <TouchableOpacity onPress={() => goStep('service', 'back')} style={S.backBtn}>
                <ChevronLeft color={C.accent} size={16} />
                <Text style={[S.backTxt, { color: C.accent }]}>{selectedService?.name}</Text>
              </TouchableOpacity>

              {/* Calendar */}
              <Text style={[S.stepHint, { color: C.text2 }]}>Pick a date</Text>
              <View style={[S.calCard, { backgroundColor: C.card, borderColor: C.border }]}>
                {/* Month nav */}
                <View style={S.calHeader}>
                  <TouchableOpacity
                    onPress={() => { Haptics.selectionAsync(); setCurrentMonth(m => subMonths(m, 1)); }}
                    style={[S.calNavBtn, { backgroundColor: C.bg2, borderColor: C.border }]}
                  >
                    <ChevronLeft color={C.text2} size={18} />
                  </TouchableOpacity>
                  <Text style={[S.calMonth, { color: C.text }]}>{format(currentMonth, 'MMMM yyyy')}</Text>
                  <TouchableOpacity
                    onPress={() => { Haptics.selectionAsync(); setCurrentMonth(m => addMonths(m, 1)); }}
                    style={[S.calNavBtn, { backgroundColor: C.bg2, borderColor: C.border }]}
                  >
                    <ChevronRight color={C.text2} size={18} />
                  </TouchableOpacity>
                </View>
                {/* Day headers */}
                <View style={S.calDayRow}>
                  {DAY_SHORT.map(d => <Text key={d} style={[S.calDayLabel, { color: C.text3 }]}>{d}</Text>)}
                </View>
                {/* Days grid */}
                <View style={S.calGrid}>
                  {calDays.map(day => {
                    const dayKey = format(day, 'yyyy-MM-dd');
                    const inMonth = isSameMonth(day, currentMonth);
                    const isPast = isBefore(day, today) && !isToday(day);
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isTod = isToday(day);
                    const hasAvailabilityMap = Object.keys(availableDates).length > 0;
                    const isAvailable = inMonth && !isPast && (hasAvailabilityMap ? !!availableDates[dayKey] : true);
                    const disabled = !isAvailable;
                    return (
                      <TouchableOpacity
                        key={day.toISOString()}
                        style={[
                          S.calDay,
                          isSelected && { backgroundColor: C.accent },
                          isTod && !isSelected && S.calDayToday,
                          disabled && S.calDayDisabled,
                        ]}
                        disabled={disabled}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelectedDate(day);
                          setSelectedSlot(null);
                          // Do NOT navigate — slots load below
                        }}
                      >
                        <Text style={[
                          S.calDayNum,
                          { color: C.text },
                          isSelected && { color: accentText, fontWeight: '800' },
                          isTod && !isSelected && { color: C.accent, fontWeight: '700' },
                          disabled && { color: C.text3 },
                        ]}>{format(day, 'd')}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Time slots — shown inline below calendar once a date is selected */}
              {selectedDate && (
                <View style={{ gap: 12 }}>
                  <Text style={[S.stepHint, { color: C.text2 }]}>
                    {format(selectedDate, 'EEE, MMMM d')} · Available times
                  </Text>
                  {loadingSlots ? (
                    <View style={S.slotsLoading}>
                      <ActivityIndicator color={C.accent} />
                      <Text style={[S.slotsLoadingTxt, { color: C.text2 }]}>Checking availability…</Text>
                    </View>
                  ) : availableSlots.length === 0 ? (
                    <View style={[S.noSlotsBox, { backgroundColor: C.bg2, borderColor: C.border }]}>
                      <Clock color={C.text3} size={18} />
                      <Text style={[S.noSlotsTxt, { color: C.text2 }]}>No available slots — barber is off or fully booked this day.</Text>
                    </View>
                  ) : (
                    <View style={S.slotsGrid}>
                      {availableSlots.map(slot => (
                        <Tile
                          key={slot}
                          onPress={() => setSelectedSlot(slot)}
                          style={[
                            S.slotBtn,
                            { backgroundColor: C.bg2, borderColor: C.border },
                            selectedSlot === slot && { backgroundColor: C.accent, borderColor: C.accent },
                          ]}
                        >
                          <Text style={[S.slotTxt, { color: C.text }, selectedSlot === slot && { color: accentText, fontWeight: '800' }]}>
                            {fmt12(slot)}
                          </Text>
                        </Tile>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Next button — only enabled when both date + slot selected */}
              {selectedDate && selectedSlot && (
                <Tile
                  onPress={() => goStep('confirm')}
                  style={[S.nextBtn, { backgroundColor: C.accent }]}
                >
                  <Text style={[S.nextBtnTxt, { color: accentText }]}>Continue</Text>
                  <ChevronRight color={accentText} size={18} />
                </Tile>
              )}
            </View>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 'confirm' && (
            <View style={{ gap: 16 }}>
              <TouchableOpacity onPress={() => goStep('date', 'back')} style={S.backBtn}>
                <ChevronLeft color={C.accent} size={16} />
                <Text style={[S.backTxt, { color: C.accent }]}>Back</Text>
              </TouchableOpacity>

              {/* Booking summary */}
              <View style={[S.confirmCard, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[S.confirmTitle, { color: C.text }]}>Review & Confirm</Text>
                <View style={[S.confirmDivider, { backgroundColor: C.border }]} />
                {[
                  ...(teamMembers.length > 0 ? [{
                    Icon: Users,
                    label: 'Professional',
                    value: selectedTeamMember
                      ? (teamMembers.find((t) => t.id === selectedTeamMember)?.display_name || 'Selected pro')
                      : 'Any Pro',
                  }] : []),
                  { Icon: Scissors,      label: 'Service', value: selectedService?.name },
                  { Icon: CalendarCheck, label: 'Date',    value: selectedDate ? format(selectedDate, 'EEEE, MMMM d') : '' },
                  { Icon: Clock,         label: 'Time',    value: selectedSlot ? fmt12(selectedSlot) : '' },
                  ...(shopName ? [{ Icon: MapPin, label: 'At', value: shopName + (shopCity ? ` · ${shopCity}` : '') }] : []),
                ].map(({ Icon, label, value }, idx, arr) => (
                  <View key={label}>
                    <View style={S.confirmRow}>
                      <View style={[S.confirmIconWrap, { backgroundColor: C.bg2 }]}><Icon color={C.accent} size={16} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.confirmRowLabel, { color: C.text3 }]}>{label}</Text>
                        <Text style={[S.confirmRowValue, { color: C.text }]}>{value}</Text>
                      </View>
                    </View>
                    {idx < arr.length - 1 && <View style={[S.confirmRowDivider, { backgroundColor: C.border }]} />}
                  </View>
                ))}
                {selectedService?.price != null && (
                  <>
                    <View style={[S.confirmDivider, { backgroundColor: C.border }]} />
                    <View style={S.confirmPriceRow}>
                      <Text style={[S.confirmPriceLabel, { color: C.text2 }]}>Service price</Text>
                      <Text style={[S.confirmPriceLabel, { color: C.text2 }]}>${servicePrice.toFixed(2)}</Text>
                    </View>
                    {applyFees && bookingFee > 0 && (
                      <View style={[S.confirmPriceRow, { marginTop: 6 }]}>
                        <Text style={[S.confirmPriceLabel, { color: C.text3, fontSize: 12 }]}>Booking fee</Text>
                        <Text style={[S.confirmPriceLabel, { color: C.text3, fontSize: 12 }]}>${bookingFee.toFixed(2)}</Text>
                      </View>
                    )}
                    <View style={[S.confirmDivider, { backgroundColor: C.border, marginTop: 10 }]} />
                    <View style={[S.confirmPriceRow, { marginTop: 4 }]}>
                      <Text style={[S.confirmPriceLabel, { color: C.text2, fontWeight: '700' }]}>Total due</Text>
                      <Text style={[S.confirmPriceValue, { color: C.text }]}>${displayTotal.toFixed(2)}</Text>
                    </View>
                    {applyFees && bookingFee > 0 && (
                      <Text style={[S.confirmNote, { color: C.text3, textAlign: 'right', marginTop: 2, fontSize: 10 }]}>
                        Includes processing fee
                      </Text>
                    )}
                  </>
                )}
              </View>

              {/* Payment method */}
              <View style={{ gap: 10 }}>
                <Text style={[S.stepHint, { color: C.text2 }]}>How would you like to pay?</Text>
                {PAYMENT_OPTIONS.map((opt) => {
                  const active = paymentMethod === opt.key;
                  return (
                    <Tile
                      key={opt.key}
                      onPress={() => setPaymentMethod(opt.key)}
                      style={[
                        S.payCard,
                        { backgroundColor: C.bg, borderColor: C.border },
                        active && { borderColor: C.accent, backgroundColor: C.bg2 },
                      ]}
                    >
                      <View style={[S.payIconWrap, { backgroundColor: active ? C.accent : C.bg3 }]}>
                        <opt.Icon color={active ? accentText : C.text2} size={18} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.payLabel, { color: C.text, fontWeight: active ? '800' : '600' }]}>{opt.label}</Text>
                        <Text style={[S.paySub, { color: C.text3 }]}>{opt.sub}</Text>
                      </View>
                      {active && (
                        <View style={[S.payCheck, { backgroundColor: C.accent }]}>
                          <Check color={accentText} size={12} strokeWidth={3} />
                        </View>
                      )}
                    </Tile>
                  );
                })}
              </View>

              <Tile
                onPress={handleBook}
                disabled={booking}
                style={[S.confirmBtn, { backgroundColor: C.accent, opacity: booking ? 0.75 : 1 }]}
              >
                {booking
                  ? <ActivityIndicator color={accentText} />
                  : <>
                      <CalendarCheck color={accentText} size={18} />
                      <Text style={[S.confirmBtnText, { color: accentText }]}>Confirm Booking</Text>
                    </>
                }
              </Tile>

              <Text style={[S.confirmNote, { color: C.text3 }]}>
                Appointments are confirmed instantly. You'll receive a confirmation in your messages.
              </Text>
            </View>
          )}

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title:     { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  shopRow:   { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  shopLabel: { fontSize: 11 },
  stepMetaWrap: { alignItems: 'flex-end' },
  stepBar:   { flexDirection: 'row', gap: 5, alignSelf: 'center' },
  stepDash:  { width: 24, height: 3, borderRadius: 2 },
  stepMetaText: { marginTop: 6, fontSize: 11, fontWeight: '600' },

  scroll:   { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 120 },
  stepHint: { fontSize: 13, fontWeight: '600', marginBottom: 6, letterSpacing: 0.1 },

  // Professionals
  proRow: { gap: 10, paddingRight: 10 },
  proCard: {
    width: 112, borderRadius: 16, borderWidth: 1,
    padding: 12, alignItems: 'center', gap: 4,
  },
  proAvatarWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: '#e5e7eb', alignItems: 'center',
    justifyContent: 'center', overflow: 'hidden',
  },
  proAvatarImage:   { width: '100%', height: '100%' },
  proAvatarFallback:{ width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  proAvatarInitial: { fontWeight: '800', fontSize: 18 },
  proName:  { fontWeight: '700', fontSize: 14, textAlign: 'center' },
  proRole:  { fontSize: 11, textTransform: 'capitalize', textAlign: 'center' },
  proHours: { fontSize: 9.5, textAlign: 'center', marginTop: 1, lineHeight: 12 },

  // Single availability card
  availCard: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, gap: 6,
  },
  availCardRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  availCardName: { fontSize: 12, fontWeight: '700' },
  availCardHours: { fontSize: 12, fontWeight: '600' },

  // Services
  serviceCard: {
    borderRadius: 16, padding: 16, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  serviceIcon:  { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  serviceName:  { fontWeight: '700', fontSize: 15 },
  serviceDesc:  { fontSize: 12, marginTop: 2 },
  serviceMeta:  { fontSize: 12, marginTop: 4, fontWeight: '500' },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  backTxt: { fontSize: 14, fontWeight: '600' },

  // Calendar
  calCard: { borderRadius: 20, padding: 18, borderWidth: 1 },
  calHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 18,
  },
  calNavBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  calMonth:    { fontWeight: '800', fontSize: 15 },
  calDayRow:   { flexDirection: 'row', marginBottom: 8 },
  calDayLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700' },
  calGrid:     { flexDirection: 'row', flexWrap: 'wrap' },
  calDay:      { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 100 },
  calDayToday:   {},
  calDayDisabled:{ opacity: 0.3 },
  calDayNum:     { fontSize: 13 },

  // Time slots
  slotsGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slotBtn:        { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  slotTxt:        { fontWeight: '600', fontSize: 13 },
  slotsLoading:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20, justifyContent: 'center' },
  slotsLoadingTxt:{ fontSize: 13 },
  noSlotsBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 14,
  },
  noSlotsTxt: { fontSize: 13, flex: 1 },

  // Continue button (date+time step)
  nextBtn: {
    borderRadius: 16, height: 54,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  nextBtnTxt: { fontWeight: '800', fontSize: 16 },

  // Payment
  payCard: {
    borderRadius: 16, borderWidth: 1.5,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14,
  },
  payIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  payLabel: { fontSize: 15 },
  paySub:   { fontSize: 12, marginTop: 1 },
  payCheck: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty
  emptyState:    { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyIcon:     { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyText:     { fontSize: 15, fontWeight: '700' },
  emptySub:      { fontSize: 12, textAlign: 'center' },
  pickAnotherBtn:{ marginTop: 8, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1 },
  pickAnotherTxt:{ fontSize: 13, fontWeight: '700' },

  // Confirm
  confirmCard: { borderRadius: 20, padding: 20, borderWidth: 1 },
  confirmTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3, marginBottom: 16 },
  confirmDivider:{ height: 1, marginVertical: 12 },
  confirmRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  confirmRowDivider: { height: 1, marginLeft: 46, marginVertical: 4 },
  confirmIconWrap:{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  confirmRowLabel:{ fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  confirmRowValue:{ fontWeight: '700', fontSize: 15, marginTop: 1 },
  confirmPriceRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  confirmPriceLabel:{ fontSize: 13 },
  confirmPriceValue:{ fontWeight: '900', fontSize: 22, letterSpacing: -0.5 },

  confirmBtn: {
    borderRadius: 16, height: 56,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  confirmBtnText: { fontWeight: '800', fontSize: 16 },
  confirmNote:    { fontSize: 12, textAlign: 'center', lineHeight: 17 },

  // Success
  successRing: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24, borderWidth: 1,
  },
  successCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  successTitle:    { fontSize: 32, fontWeight: '900', letterSpacing: -1, marginBottom: 4 },
  successService:  { fontSize: 16, fontWeight: '600', marginBottom: 24 },
  successDetails:  { borderRadius: 16, padding: 16, gap: 10, width: '100%', borderWidth: 1, marginBottom: 16 },
  successDetailRow:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  successDetailTxt:{ fontSize: 14 },
  successNote:     { fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 28, paddingHorizontal: 20 },
  successBtn: {
    borderRadius: 16, paddingHorizontal: 36, paddingVertical: 14,
  },
  successBtnText: { fontWeight: '700', fontSize: 15 },
});
