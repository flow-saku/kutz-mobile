import { useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider } from '@/lib/theme';
import { ToastProvider } from '@/lib/toast';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { registerForPushNotifications, savePushTokenToSupabase } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

function NotificationNavigator() {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    (async () => {
      const token = await registerForPushNotifications();
      if (token) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          await savePushTokenToSupabase(session.user.id, token);
        }
      }
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(_notification => {});

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, string>;
      if (data?.appointmentId) {
        router.push('/(client)/rebook');
      } else if (data?.screen) {
        router.push(data.screen as any);
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ToastProvider>
          <StatusBar style="auto" />
          <NotificationNavigator />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(client)" />
            <Stack.Screen name="(barber)" />
          </Stack>
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
