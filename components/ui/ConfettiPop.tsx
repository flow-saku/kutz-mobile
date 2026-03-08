import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

const COLORS = ['#16a34a', '#fbbf24', '#f97316', '#60a5fa', '#e879f9', '#34d399', '#f472b6', '#fff'];

interface Props {
  trigger: boolean;
  count?: number;
  colors?: string[];
  size?: number;
}

export default function ConfettiPop({ trigger, count = 10, colors = COLORS, size = 8 }: Props) {
  const particles = useRef(
    Array.from({ length: count }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0),
    }))
  ).current;

  const prevTrigger = useRef(false);

  useEffect(() => {
    if (trigger && !prevTrigger.current) {
      fire();
    }
    prevTrigger.current = trigger;
  }, [trigger]);

  const fire = () => {
    particles.forEach((p, i) => {
      const angle = (i / particles.length) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 50 + Math.random() * 40;

      p.x.setValue(0);
      p.y.setValue(0);
      p.opacity.setValue(0);
      p.scale.setValue(0.3);

      Animated.sequence([
        Animated.parallel([
          Animated.timing(p.opacity, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.timing(p.scale, { toValue: 1.4, duration: 60, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(p.x, { toValue: Math.cos(angle) * dist, duration: 650, useNativeDriver: true }),
          Animated.timing(p.y, { toValue: Math.sin(angle) * dist - 50, duration: 650, useNativeDriver: true }),
          Animated.timing(p.opacity, { toValue: 0, duration: 450, delay: 180, useNativeDriver: true }),
          Animated.timing(p.scale, { toValue: 0.15, duration: 650, useNativeDriver: true }),
        ]),
      ]).start();
    });
  };

  return (
    <View style={S.container} pointerEvents="none">
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            S.dot,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: colors[i % colors.length],
              opacity: p.opacity,
              transform: [
                { translateX: p.x },
                { translateY: p.y },
                { scale: p.scale },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  dot: { position: 'absolute' },
});
