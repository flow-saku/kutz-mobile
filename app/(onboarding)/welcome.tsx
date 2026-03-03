import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Dimensions, Animated,
  StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Scissors, User } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const { width, height } = Dimensions.get('window');

export default function WelcomeScreen() {
  const [selected, setSelected] = useState<'barber' | 'client' | null>(null);
  const barberAnim = useRef(new Animated.Value(0)).current;
  const clientAnim = useRef(new Animated.Value(0)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;
  const btnScale = useRef(new Animated.Value(0.95)).current;

  const handleSelect = (mode: 'barber' | 'client') => {
    if (selected === mode) return;
    setSelected(mode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const isBarber = mode === 'barber';
    Animated.parallel([
      Animated.spring(barberAnim, {
        toValue: isBarber ? 1 : 0,
        useNativeDriver: false,
        tension: 200,
        friction: 12,
      }),
      Animated.spring(clientAnim, {
        toValue: isBarber ? 0 : 1,
        useNativeDriver: false,
        tension: 200,
        friction: 12,
      }),
      Animated.spring(btnAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 200,
        friction: 12,
      }),
      Animated.spring(btnScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 200,
        friction: 12,
      }),
    ]).start();
  };

  const handleContinue = async () => {
    if (!selected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.setItem('user_mode', selected);
    router.replace('/(auth)/login');
  };

  const barberBg = barberAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#0f0f11', '#1a0e2e'],
  });
  const clientBg = clientAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#0f0f11', '#0a1f18'],
  });

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>Kutz</Text>
        <Text style={styles.tagline}>Who are you?</Text>
      </View>

      {/* Cards */}
      <View style={styles.cards}>
        {/* Barber */}
        <Animated.View style={[styles.card, { backgroundColor: barberBg, flex: selected === 'barber' ? 1.15 : selected === 'client' ? 0.85 : 1 }]}>
          <TouchableOpacity
            style={styles.cardInner}
            activeOpacity={0.92}
            onPress={() => handleSelect('barber')}
          >
            <Animated.View style={[
              styles.iconWrap,
              {
                backgroundColor: barberAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['#ffffff08', '#a855f722'],
                }),
                borderColor: barberAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['#ffffff10', '#a855f755'],
                }),
              }
            ]}>
              <Scissors
                color={selected === 'barber' ? '#a855f7' : '#52525b'}
                size={30}
                strokeWidth={1.8}
              />
            </Animated.View>

            <View style={styles.cardText}>
              <Text style={[
                styles.cardTitle,
                { color: selected === 'barber' ? '#fafafa' : '#52525b' }
              ]}>
                Barber
              </Text>
              <Text style={[
                styles.cardDesc,
                { color: selected === 'barber' ? '#a1a1aa' : '#3f3f46' }
              ]}>
                Run your shop
              </Text>
            </View>

            {selected === 'barber' && (
              <View style={[styles.checkmark, { backgroundColor: '#a855f7' }]}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            )}

            {/* Subtle glow */}
            {selected === 'barber' && <View style={[styles.glow, { backgroundColor: '#a855f7' }]} />}
          </TouchableOpacity>
        </Animated.View>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Client */}
        <Animated.View style={[styles.card, { backgroundColor: clientBg, flex: selected === 'client' ? 1.15 : selected === 'barber' ? 0.85 : 1 }]}>
          <TouchableOpacity
            style={styles.cardInner}
            activeOpacity={0.92}
            onPress={() => handleSelect('client')}
          >
            <Animated.View style={[
              styles.iconWrap,
              {
                backgroundColor: clientAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['#ffffff08', '#10b98122'],
                }),
                borderColor: clientAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['#ffffff10', '#10b98155'],
                }),
              }
            ]}>
              <User
                color={selected === 'client' ? '#10b981' : '#52525b'}
                size={30}
                strokeWidth={1.8}
              />
            </Animated.View>

            <View style={styles.cardText}>
              <Text style={[
                styles.cardTitle,
                { color: selected === 'client' ? '#fafafa' : '#52525b' }
              ]}>
                Client
              </Text>
              <Text style={[
                styles.cardDesc,
                { color: selected === 'client' ? '#a1a1aa' : '#3f3f46' }
              ]}>
                Book & manage cuts
              </Text>
            </View>

            {selected === 'client' && (
              <View style={[styles.checkmark, { backgroundColor: '#10b981' }]}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            )}

            {selected === 'client' && <View style={[styles.glow, { backgroundColor: '#10b981' }]} />}
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* CTA */}
      <Animated.View style={[
        styles.ctaWrap,
        {
          opacity: btnAnim,
          transform: [{ scale: btnScale }],
        }
      ]}>
        <TouchableOpacity
          onPress={handleContinue}
          activeOpacity={0.88}
          style={[
            styles.cta,
            { backgroundColor: selected === 'barber' ? '#a855f7' : '#10b981' }
          ]}
        >
          <Text style={styles.ctaText}>
            Continue
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  header: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 24,
  },
  wordmark: {
    color: '#fafafa',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1.5,
    lineHeight: 46,
  },
  tagline: {
    color: '#52525b',
    fontSize: 17,
    fontWeight: '500',
    marginTop: 6,
    letterSpacing: -0.2,
  },
  cards: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 0,
  },
  card: {
    borderRadius: 28,
    overflow: 'hidden',
    marginVertical: 4,
  },
  cardInner: {
    flex: 1,
    padding: 28,
    justifyContent: 'center',
    position: 'relative',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  cardText: {
    gap: 4,
  },
  cardTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  cardDesc: {
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  checkmark: {
    position: 'absolute',
    top: 22,
    right: 22,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  glow: {
    position: 'absolute',
    bottom: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    opacity: 0.08,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 2,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#27272a',
  },
  dividerText: {
    color: '#3f3f46',
    fontSize: 12,
    fontWeight: '500',
  },
  ctaWrap: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 16,
  },
  cta: {
    borderRadius: 18,
    paddingVertical: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
