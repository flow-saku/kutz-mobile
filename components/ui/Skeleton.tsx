import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  const baseColor = isDark ? '#2a2a2a' : '#e5e5e5';

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: baseColor, opacity },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <Skeleton width={44} height={44} borderRadius={22} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton height={14} width="60%" />
          <Skeleton height={11} width="40%" />
        </View>
      </View>
      <Skeleton height={11} />
      <Skeleton height={11} width="80%" />
    </View>
  );
}

export function SkeletonAppointmentCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <Skeleton width={4} height={56} borderRadius={2} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton height={14} width="50%" />
          <Skeleton height={11} width="35%" />
        </View>
        <Skeleton width={72} height={28} borderRadius={14} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 3, renderItem }: { count?: number; renderItem?: () => React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <React.Fragment key={i}>
          {renderItem ? renderItem() : <SkeletonCard />}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
