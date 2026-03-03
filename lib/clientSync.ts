import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { resolveBarberOwnerId } from '@/lib/barber';
import type { User } from '@supabase/supabase-js';

export const CLIENT_SELECTED_BARBER_KEY = 'client_selected_barber_id';

export async function saveSelectedBarberId(barberId: string | null | undefined) {
  if (!barberId) return;
  await AsyncStorage.setItem(CLIENT_SELECTED_BARBER_KEY, barberId);
}

export async function getSelectedBarberId() {
  return AsyncStorage.getItem(CLIENT_SELECTED_BARBER_KEY);
}

export interface ActiveClientBinding {
  clientId: string;
  rawBarberId: string;
  barberId: string;
  visitCount: number;
  name?: string | null;
}

export async function getActiveClientBinding(authUserId: string): Promise<ActiveClientBinding | null> {
  const { data: rows, error } = await supabase
    .from('clients')
    .select('id, barber_id, visit_count, name, updated_at')
    .eq('auth_user_id', authUserId)
    .order('updated_at', { ascending: false, nullsFirst: false });

  if (error) throw error;
  const list = ((rows as any[]) ?? []).filter((r) => !!r?.barber_id);
  if (list.length === 0) return null;

  const selectedRaw = await getSelectedBarberId();
  const selectedOwner = await resolveBarberOwnerId(selectedRaw);

  const normalized = await Promise.all(
    list.map(async (r) => ({
      ...r,
      barber_owner_id: await resolveBarberOwnerId(r.barber_id),
    })),
  );

  let chosen =
    (selectedOwner
      ? normalized.find((r) => r.barber_owner_id === selectedOwner)
      : null) || normalized.find((r) => !!r.barber_owner_id);

  if (!chosen?.barber_owner_id) return null;

  await saveSelectedBarberId(chosen.barber_owner_id);

  return {
    clientId: chosen.id,
    rawBarberId: chosen.barber_id,
    barberId: chosen.barber_owner_id,
    visitCount: chosen.visit_count ?? 0,
    name: chosen.name ?? null,
  };
}

export async function ensureClientLinkedToShop(user: User, rawBarberId: string | null | undefined) {
  if (!rawBarberId) return null;

  const barberId = await resolveBarberOwnerId(rawBarberId);
  if (!barberId) return null;

  const email = user.email ?? '';
  const name =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    email.split('@')[0] ||
    'Client';

  const { data, error } = await (supabase as any).rpc('link_client_account', {
    p_barber_id: barberId,
    p_auth_user_id: user.id,
    p_email: email,
    p_name: name,
  });

  if (error) throw error;
  await saveSelectedBarberId(barberId);
  return data;
}
