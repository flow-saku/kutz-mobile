import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, Animated, Easing,
    TouchableOpacity, Dimensions, Platform,
} from 'react-native';
import { X, Smartphone } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

const { width: SW, height: SH } = Dimensions.get('window');

/* ─── Contactless / NFC waves icon (drawn with Animated arcs) ─────────── */
function ContactlessIcon({ color, pulseAnim }: { color: string; pulseAnim: Animated.Value }) {
    const wave1 = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
    const wave2 = pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.2, 0.7, 1] });
    const wave3 = pulseAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.1, 0.5, 1] });

    return (
        <View style={styles.nfcIcon}>
            {/* Phone icon in center */}
            <Smartphone color={color} size={36} strokeWidth={1.8} />
            {/* Animated wave rings */}
            {[wave1, wave2, wave3].map((opacity, i) => (
                <Animated.View
                    key={i}
                    style={[
                        styles.waveRing,
                        {
                            width: 100 + i * 40,
                            height: 100 + i * 40,
                            borderRadius: 50 + i * 20,
                            borderColor: color,
                            opacity,
                            transform: [{
                                scale: pulseAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.85 + i * 0.02, 1 + i * 0.02],
                                })
                            }],
                        },
                    ]}
                />
            ))}
        </View>
    );
}

interface TapToPayOverlayProps {
    visible: boolean;
    status: string;
    amount: string;
    clientName?: string;
    onCancel: () => void;
}

export default function TapToPayOverlay({
    visible,
    status,
    amount,
    clientName,
    onCancel,
}: TapToPayOverlayProps) {
    const { C, theme } = useTheme();
    const insets = useSafeAreaInsets();
    const isDark = theme === 'dark';

    // Animations
    const overlayOpacity = useRef(new Animated.Value(0)).current;
    const contentScale = useRef(new Animated.Value(0.9)).current;
    const pulseAnim = useRef(new Animated.Value(0)).current;
    const glowAnim = useRef(new Animated.Value(0)).current;
    const statusFade = useRef(new Animated.Value(1)).current;

    const isReady = status === 'Ready — Tap card now';
    const isProcessing = status === 'Processing...';

    // Enter / exit animation
    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.timing(overlayOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
                Animated.spring(contentScale, { toValue: 1, tension: 200, friction: 18, useNativeDriver: true }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
                Animated.timing(contentScale, { toValue: 0.9, duration: 200, useNativeDriver: true }),
            ]).start();
        }
    }, [visible]);

    // Pulse animation for NFC waves
    useEffect(() => {
        if (visible && isReady) {
            const loop = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                ]),
            );
            loop.start();
            return () => loop.stop();
        } else {
            pulseAnim.setValue(0.5);
        }
    }, [visible, isReady]);

    // Glow animation
    useEffect(() => {
        if (visible && isReady) {
            const loop = Animated.loop(
                Animated.sequence([
                    Animated.timing(glowAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                    Animated.timing(glowAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                ]),
            );
            loop.start();
            return () => loop.stop();
        }
    }, [visible, isReady]);

    // Status text fade on change
    useEffect(() => {
        Animated.sequence([
            Animated.timing(statusFade, { toValue: 0, duration: 100, useNativeDriver: true }),
            Animated.timing(statusFade, { toValue: 1, duration: 250, useNativeDriver: true }),
        ]).start();
    }, [status]);

    if (!visible) return null;

    const accentColor = isReady ? '#34d399' : isProcessing ? '#fbbf24' : C.accent;
    const bgColor = isDark ? '#0a0a0a' : '#f8f9fa';

    const glowOpacity = glowAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.15, 0.4],
    });

    return (
        <Animated.View style={[styles.overlay, {
            opacity: overlayOpacity,
            backgroundColor: bgColor,
        }]}>
            {/* Close / Cancel button */}
            <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    onPress={onCancel}
                    style={[styles.cancelBtn, { backgroundColor: isDark ? '#1a1a2e' : '#e8e8ec' }]}
                    activeOpacity={0.7}
                >
                    <X color={isDark ? '#999' : '#666'} size={20} strokeWidth={2.5} />
                </TouchableOpacity>
            </View>

            <Animated.View style={[styles.content, { transform: [{ scale: contentScale }] }]}>
                {/* Amount */}
                <View style={styles.amountSection}>
                    {clientName && (
                        <Text style={[styles.clientLabel, { color: isDark ? '#666' : '#999' }]}>
                            {clientName}
                        </Text>
                    )}
                    <Text style={[styles.amountText, { color: isDark ? '#fff' : '#0a0a0a' }]}>
                        {amount}
                    </Text>
                </View>

                {/* NFC Icon with glow */}
                <View style={styles.nfcSection}>
                    {/* Glow backdrop */}
                    <Animated.View style={[styles.glowCircle, {
                        backgroundColor: accentColor,
                        opacity: glowOpacity,
                    }]} />

                    <ContactlessIcon color={accentColor} pulseAnim={pulseAnim} />
                </View>

                {/* Status */}
                <Animated.View style={[styles.statusSection, { opacity: statusFade }]}>
                    <Text style={[styles.statusText, { color: accentColor }]}>
                        {isReady ? 'Ready to Tap' : isProcessing ? 'Processing Payment...' : status}
                    </Text>
                    <Text style={[styles.statusHint, { color: isDark ? '#555' : '#aaa' }]}>
                        {isReady
                            ? 'Hold card near the top of your iPhone'
                            : isProcessing
                                ? 'Please wait...'
                                : 'Setting up secure connection'}
                    </Text>
                </Animated.View>
            </Animated.View>

            {/* Bottom cancel text */}
            {isReady && (
                <TouchableOpacity
                    onPress={onCancel}
                    style={[styles.bottomCancel, { paddingBottom: insets.bottom + 16 }]}
                    activeOpacity={0.7}
                >
                    <Text style={[styles.bottomCancelText, { color: isDark ? '#555' : '#aaa' }]}>
                        Tap to Cancel
                    </Text>
                </TouchableOpacity>
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 999,
    },
    topBar: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 20,
        paddingBottom: 8,
    },
    cancelBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    amountSection: {
        alignItems: 'center',
        marginBottom: 60,
    },
    clientLabel: {
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: 0.3,
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    amountText: {
        fontSize: 56,
        fontWeight: '900',
        letterSpacing: -2,
    },
    nfcSection: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 200,
        height: 200,
        marginBottom: 48,
    },
    glowCircle: {
        position: 'absolute',
        width: 200,
        height: 200,
        borderRadius: 100,
    },
    nfcIcon: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 180,
        height: 180,
    },
    waveRing: {
        position: 'absolute',
        borderWidth: 2,
    },
    statusSection: {
        alignItems: 'center',
        gap: 8,
    },
    statusText: {
        fontSize: 20,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    statusHint: {
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
        lineHeight: 20,
    },
    bottomCancel: {
        alignItems: 'center',
        paddingTop: 16,
    },
    bottomCancelText: {
        fontSize: 15,
        fontWeight: '600',
    },
});
