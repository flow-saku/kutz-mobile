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

/**
 * Resolves the effective barber scope for the currently logged-in user.
 *
 * - If the user is a STAFF MEMBER (has a row in team_members with user_id = uid):
 *   → scopeIds = [shop_owner_uid]
 *   → staffMemberId = their team_members.id  (add as extra filter on appointments)
 *   → isStaff = true
 *
 * - If the user is a SHOP OWNER (has a profiles row):
 *   → scopeIds = [uid, profile.id, profile.user_id]  (de-duped)
 *   → staffMemberId = null
 *   → isStaff = false
 */
export async function resolveBarberScope(uid: string): Promise<{
  scopeIds: string[];
  ownerUid: string;
  staffMemberId: string | null;
  isStaff: boolean;
  displayName: string;
  shopName: string;
}> {
  // Check if this user is a staff member first
  const { data: teamRow } = await supabase
    .from('team_members')
    .select('id, shop_owner_id, display_name')
    .eq('user_id', uid)
    .eq('is_active', true)
    .maybeSingle();

  if ((teamRow as any)?.shop_owner_id) {
    const ownerUid = (teamRow as any).shop_owner_id as string;
    // Fetch shop name from owner's profile
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('shop_name, display_name')
      .or(`id.eq.${ownerUid},user_id.eq.${ownerUid}`)
      .limit(1)
      .maybeSingle();
    return {
      scopeIds: [ownerUid],
      ownerUid,
      staffMemberId: (teamRow as any).id as string,
      isStaff: true,
      displayName: (teamRow as any).display_name ?? '',
      shopName: (ownerProfile as any)?.shop_name || (ownerProfile as any)?.display_name || 'Shop',
    };
  }

  // Owner path — build ids from their profiles row
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, user_id, shop_name, display_name')
    .or(`id.eq.${uid},user_id.eq.${uid}`)
    .limit(1)
    .maybeSingle();

  const scopeIds = Array.from(
    new Set([uid, (profile as any)?.id, (profile as any)?.user_id].filter(Boolean) as string[])
  );
  const ownerUid = (profile as any)?.user_id ?? (profile as any)?.id ?? uid;

  return {
    scopeIds,
    ownerUid,
    staffMemberId: null,
    isStaff: false,
    displayName: (profile as any)?.display_name ?? '',
    shopName: (profile as any)?.shop_name || (profile as any)?.display_name || 'My Shop',
  };
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
