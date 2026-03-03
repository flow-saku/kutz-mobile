import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const PUSH_TOKEN_KEY = '@cut_confidant/push_token';
const NOTIF_SETTINGS_KEY = '@cut_confidant/notif_settings';

export interface NotificationSettings {
  appointments: boolean;
  reminders: boolean;
  messages: boolean;
  loyalty: boolean;
  marketing: boolean;
}

export const DEFAULT_NOTIF_SETTINGS: NotificationSettings = {
  appointments: true,
  reminders: true,
  messages: true,
  loyalty: true,
  marketing: false,
};

// Configure how notifications appear when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device.');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#a855f7',
    });
    await Notifications.setNotificationChannelAsync('appointments', {
      name: 'Appointments',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#a855f7',
    });
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#a855f7',
    });
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (e) {
    console.warn('Failed to get push token:', e);
    return null;
  }
}

export async function savePushTokenToSupabase(userId: string, token: string) {
  try {
    await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e) {
    // Table may not exist yet — that's fine, we store token locally
    console.warn('Could not save push token to Supabase:', e);
  }
}

export async function getStoredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_SETTINGS_KEY);
    if (!raw) return DEFAULT_NOTIF_SETTINGS;
    return { ...DEFAULT_NOTIF_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NOTIF_SETTINGS;
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  await AsyncStorage.setItem(NOTIF_SETTINGS_KEY, JSON.stringify(settings));
}

export async function scheduleLocalAppointmentReminder(
  appointmentId: string,
  clientName: string,
  serviceName: string,
  date: string,
  time: string
) {
  const settings = await getNotificationSettings();
  if (!settings.reminders) return;

  const [hours, minutes] = time.split(':').map(Number);
  const appointmentDate = new Date(date);
  appointmentDate.setHours(hours, minutes, 0, 0);

  // Reminder 24h before
  const reminder24h = new Date(appointmentDate.getTime() - 24 * 60 * 60 * 1000);
  // Reminder 1h before
  const reminder1h = new Date(appointmentDate.getTime() - 60 * 60 * 1000);

  const now = new Date();

  if (reminder24h > now) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Appointment Tomorrow',
        body: `${serviceName} at ${time} — see you soon!`,
        data: { appointmentId },
        categoryIdentifier: 'appointments',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder24h },
    });
  }

  if (reminder1h > now) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Appointment in 1 Hour',
        body: `${serviceName} starts at ${time}. Don't be late!`,
        data: { appointmentId },
        categoryIdentifier: 'appointments',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder1h },
    });
  }
}

export async function cancelAppointmentReminders(appointmentId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if ((notif.content.data as any)?.appointmentId === appointmentId) {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }
}
