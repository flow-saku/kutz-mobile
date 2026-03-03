import { supabase } from '@/lib/supabase';

type BarberProfile = {
  id: string;
  user_id: string;
  shop_name: string | null;
  display_name: string | null;
  city: string | null;
  barber_slug: string | null;
  booking_link: string | null;
  booking_page_config?: any;
};

export async function resolveBarberOwnerId(rawBarberId: string | null | undefined): Promise<string | null> {
  if (!rawBarberId) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, user_id')
    .or(`id.eq.${rawBarberId},user_id.eq.${rawBarberId}`)
    .limit(1)
    .maybeSingle();

  const row = data as { id?: string; user_id?: string } | null;
  return row?.user_id ?? rawBarberId;
}

export async function getBarberProfile(rawBarberId: string | null | undefined): Promise<BarberProfile | null> {
  if (!rawBarberId) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, user_id, shop_name, display_name, city, barber_slug, booking_link, booking_page_config')
    .or(`id.eq.${rawBarberId},user_id.eq.${rawBarberId}`)
    .limit(1)
    .maybeSingle();

  return (data as BarberProfile | null) ?? null;
}
