import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureClientLinkedToShop, getActiveClientBinding, getSelectedBarberId, saveSelectedBarberId } from '@/lib/clientSync';
import { useTheme } from '@/lib/theme';

export default function Index() {
  const { C } = useTheme();

  useEffect(() => {
    (async () => {
      // Check if user has chosen a mode before
      const userMode = await AsyncStorage.getItem('user_mode');

      if (!userMode) {
        // First time — show onboarding
        router.replace('/(onboarding)/welcome');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace('/(auth)/login');
        return;
      }

      const userId = session.user.id;

      if (userMode === 'barber') {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, onboarding_complete, display_name')
          .or(`id.eq.${userId},user_id.eq.${userId}`)
          .maybeSingle();

        // Truly new = no profile row at all, or no name set yet
        const isNewBarber = !profile || (!profile.onboarding_complete && !profile.display_name);

        if (isNewBarber) {
          router.replace('/(onboarding)/barber-setup');
          return;
        }

        // Existing barber who has a name but flag wasn't set — stamp it so we never check again
        if (profile && !profile.onboarding_complete && profile.display_name) {
          await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', profile.id);
        }

        router.replace('/(barber)/dashboard');
        return;
      }

      // Client mode — show onboarding only if they haven't completed it on this device
      const clientOnboardingDone = await AsyncStorage.getItem('client_onboarding_complete');

      if (!clientOnboardingDone) {
        router.replace('/(onboarding)/client-setup');
        return;
      }

      // Client mode — check if they have a barbershop linked yet
      let binding = await getActiveClientBinding(userId);

      // If user already selected a shop in mobile flow, guarantee they are linked
      // to CRM on auth (auto-create/update client row for that shop).
      if (!binding?.barberId) {
        const selectedBarberId = await getSelectedBarberId();
        if (selectedBarberId) {
          try {
            await ensureClientLinkedToShop(session.user, selectedBarberId);
            binding = await getActiveClientBinding(userId);
          } catch (e) {
            console.error('[index] ensureClientLinkedToShop failed', e);
          }
        }
      }

      if (!binding?.barberId) {
        // No barbershop yet → send to discover so they can pick one
        router.replace('/(client)/discover');
        return;
      }

      await saveSelectedBarberId(binding.barberId);

      router.replace('/(client)/home');
    })();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );
}
