import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, StyleSheet, type TextStyle, type StyleProp } from 'react-native';

interface Props {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  style?: StyleProp<TextStyle>;
  decimals?: number;
}

export default function AnimatedCounter({
  value,
  prefix = '',
  suffix = '',
  duration = 600,
  style,
  decimals = 0,
}: Props) {
  const animVal = useRef(new Animated.Value(0)).current;
  const prevVal = useRef(0);
  const [display, setDisplay] = useState('0');
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const from = prevVal.current;
    const to = value;
    prevVal.current = to;

    animVal.setValue(0);
    Animated.spring(animVal, {
      toValue: 1,
      tension: 45,
      friction: 9,
      useNativeDriver: false, // must be false for .addListener value reads
    }).start();

    // Pulse scale when value increases significantly
    if (to > from && (to - from) / Math.max(from, 1) > 0.15) {
      scaleAnim.setValue(1);
      Animated.sequence([
        Animated.spring(scaleAnim, { toValue: 1.12, tension: 400, friction: 6, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 200, friction: 10, useNativeDriver: true }),
      ]).start();
    }

    const id = animVal.addListener(({ value: t }) => {
      const current = from + (to - from) * t;
      setDisplay(formatNum(current, decimals));
    });

    return () => animVal.removeListener(id);
  }, [value]);

  return (
    <Animated.Text style={[S.text, style, { transform: [{ scale: scaleAnim }] }]}>
      {prefix}{display}{suffix}
    </Animated.Text>
  );
}

function formatNum(n: number, decimals: number): string {
  const fixed = Math.max(0, n).toFixed(decimals);
  const [whole, dec] = fixed.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
}

const S = StyleSheet.create({
  text: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
});
