import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react-native';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: '#052e16', border: '#16a34a', text: '#bbf7d0', icon: '#4ade80' },
  error:   { bg: '#2d0000', border: '#dc2626', text: '#fecaca', icon: '#f87171' },
  info:    { bg: '#0c1a2e', border: '#3b82f6', text: '#bfdbfe', icon: '#60a5fa' },
  warning: { bg: '#2c1a00', border: '#d97706', text: '#fde68a', icon: '#fbbf24' },
};

function ToastIcon({ type, color }: { type: ToastType; color: string }) {
  const props = { size: 18, color };
  switch (type) {
    case 'success': return <CheckCircle {...props} />;
    case 'error':   return <XCircle {...props} />;
    case 'warning': return <AlertTriangle {...props} />;
    default:        return <Info {...props} />;
  }
}

function ToastItem({ toast, onDismiss, topOffset }: {
  toast: Toast;
  onDismiss: (id: string) => void;
  topOffset: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-16)).current;
  const colors = COLORS[toast.type];

  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(opacity, { toValue: 1, useNativeDriver: true, tension: 120, friction: 12 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 12 }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -16, duration: 220, useNativeDriver: true }),
      ]).start(() => onDismiss(toast.id));
    }, toast.duration ?? 3500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          top: topOffset,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.iconWrapper}>
        <ToastIcon type={toast.type} color={colors.icon} />
      </View>
      <Text style={[styles.toastText, { color: colors.text }]} numberOfLines={3}>
        {toast.message}
      </Text>
      <TouchableOpacity
        onPress={() => onDismiss(toast.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <X size={14} color={colors.text} />
      </TouchableOpacity>
    </Animated.View>
  );
}

function ToastContainer({ toasts, onDismiss }: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const topOffset = insets.top + 12;

  if (toasts.length === 0) return null;

  return (
    <>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} topOffset={topOffset} />
      ))}
    </>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev.slice(-2), { id, message, type, duration }]);
  }, []);

  const value: ToastContextValue = {
    show,
    success: (msg, dur) => show(msg, 'success', dur),
    error:   (msg, dur) => show(msg, 'error', dur),
    info:    (msg, dur) => show(msg, 'info', dur),
    warning: (msg, dur) => show(msg, 'warning', dur),
  };

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    zIndex: 9999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  iconWrapper: {
    marginRight: 10,
  },
  toastText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginRight: 10,
  },
});
