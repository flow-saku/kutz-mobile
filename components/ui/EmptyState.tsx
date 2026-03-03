import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export function EmptyState({ icon: Icon, title, subtitle, action }: EmptyStateProps) {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(168,85,247,0.12)' : 'rgba(168,85,247,0.08)' }]}>
        <Icon size={32} color="#a855f7" strokeWidth={1.5} />
      </View>
      <Text style={[styles.title, { color: C.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: C.text3 }]}>{subtitle}</Text>
      ) : null}
      {action ? (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: isDark ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.35)' }]}
          onPress={action.onPress}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 12,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  buttonText: {
    color: '#a855f7',
    fontWeight: '600',
    fontSize: 14,
  },
});
