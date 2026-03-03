import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Scissors,
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  Briefcase,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureClientLinkedToShop, getSelectedBarberId } from '@/lib/clientSync';
import { useTheme } from '@/lib/theme';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'choose' | 'signin' | 'signup' | 'forgot';
type UserMode = 'client' | 'barber';

export default function LoginScreen() {
  const { C, theme } = useTheme();
  const isDark = theme === 'dark';

  const [mode, setMode] = useState<Mode>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [userMode, setUserMode] = useState<UserMode>('client');

  const canSignIn = email.trim().length > 0 && password.length > 0;
  const canSignUp = email.trim().length > 0 && password.length > 0 && name.trim().length > 0;
  const canReset = email.trim().length > 0;

  const resolveUserMode = async (): Promise<UserMode> => {
    const modeFromStorage = await AsyncStorage.getItem('user_mode');
    if (modeFromStorage === 'barber' || modeFromStorage === 'client') return modeFromStorage;
    return userMode;
  };

  const syncClientRowIfNeeded = async (mode?: UserMode) => {
    const finalMode = mode ?? (await resolveUserMode());
    if (finalMode !== 'client') return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const selectedBarberId = await getSelectedBarberId();
    if (!selectedBarberId) return;
    await ensureClientLinkedToShop(session.user, selectedBarberId);
  };

  useEffect(() => {
    AsyncStorage.getItem('user_mode').then((stored: string | null) => {
      if (stored === 'barber' || stored === 'client') setUserMode(stored);
    });
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener('url', async ({ url }: { url: string }) => {
      if (url.includes('access_token') || url.includes('code=')) {
        // Exchange the OAuth code / access_token for a Supabase session
        // (detectSessionInUrl is false in the client, so we must do it manually)
        if (url.includes('code=')) {
          await supabase.auth.exchangeCodeForSession(url);
        } else {
          // implicit flow — parse tokens from the URL fragment and set session
          const params = new URLSearchParams(url.split('#')[1] ?? url.split('?')[1] ?? '');
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
          }
        }
        const { data, error } = await supabase.auth.getSession();
        if (!error && data.session) {
          await syncClientRowIfNeeded();
          router.replace('/');
        }
      }
    });
    return () => sub.remove();
  }, []);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const finalMode = await resolveUserMode();
      await AsyncStorage.setItem('user_mode', finalMode);
      // Use the app's deep-link scheme directly so the OS routes the OAuth
      // callback back into the app (not to the kutz.io web app).
      // 'kutz' scheme is set in app.json → expo.scheme.
      const redirectUrl = 'kutz:///';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        if (result.type === 'success' && result.url) {
          // detectSessionInUrl is false — manually exchange the code/tokens
          if (result.url.includes('code=')) {
            await supabase.auth.exchangeCodeForSession(result.url);
          } else {
            const fragment = result.url.split('#')[1] ?? result.url.split('?')[1] ?? '';
            const params = new URLSearchParams(fragment);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            if (access_token && refresh_token) {
              await supabase.auth.setSession({ access_token, refresh_token });
            }
          }
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData.session) {
            await syncClientRowIfNeeded(finalMode);
            router.replace('/');
          } else {
            Alert.alert('Sign in incomplete', 'Google authentication did not complete. Please try again.');
          }
        }
      }
    } catch (err: any) {
      Alert.alert('Google sign in failed', err.message || 'Please try again');
    }
    setGoogleLoading(false);
  };

  const handleSignIn = async () => {
    if (!canSignIn) return;
    setLoading(true);
    try {
      const finalMode = await resolveUserMode();
      await AsyncStorage.setItem('user_mode', finalMode);
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      await syncClientRowIfNeeded(finalMode);
      router.replace('/');
    } catch (err: any) {
      Alert.alert('Sign in failed', err.message || 'Please check your credentials');
    }
    setLoading(false);
  };

  const handleSignUp = async () => {
    if (!canSignUp) return;
    setLoading(true);
    try {
      const finalMode = await resolveUserMode();
      await AsyncStorage.setItem('user_mode', finalMode);
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() } },
      });
      if (error) throw error;
      // Always clear the onboarding flag on new signup so they go through setup
      if (finalMode === 'client') {
        await AsyncStorage.removeItem('client_onboarding_complete');
      }
      if (data.session) {
        await syncClientRowIfNeeded(finalMode);
        router.replace('/');
      } else {
        Alert.alert('Account created', 'Check your email to verify your account, then sign in.');
        setMode('signin');
      }
    } catch (err: any) {
      Alert.alert('Sign up failed', err.message || 'Please try again');
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!canReset) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'kutz://reset-password',
      });
      if (error) throw error;
      Alert.alert('Reset link sent', `Check ${email.trim()} for a password reset link.`, [
        { text: 'OK', onPress: () => setMode('signin') },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not send reset email');
    }
    setLoading(false);
  };

  const isBarber = userMode === 'barber';
  const accentColor = isBarber ? '#a855f7' : '#10b981';
  const roleLabel = isBarber ? 'Barber' : 'Client';

  return (
    <SafeAreaView style={[S.safe, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Top bar */}
      <View style={S.topBar}>
        {mode !== 'choose' ? (
          <TouchableOpacity
            onPress={() => setMode(mode === 'forgot' ? 'signin' : 'choose')}
            style={S.backBtn}
            activeOpacity={0.7}
          >
            <ArrowLeft color={C.text2} size={20} strokeWidth={2} />
          </TouchableOpacity>
        ) : (
          <View style={S.backBtn} />
        )}

        {/* Role pill — tappable to go back to welcome */}
        <TouchableOpacity
          onPress={() => router.push('/(onboarding)/welcome')}
          style={[S.rolePill, { backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0', borderColor: isDark ? '#2e2e2e' : '#e0e0e0' }]}
          activeOpacity={0.75}
        >
          {isBarber
            ? <Briefcase color={accentColor} size={13} strokeWidth={2} />
            : <User color={accentColor} size={13} strokeWidth={2} />
          }
          <Text style={[S.rolePillText, { color: C.text2 }]}>{roleLabel}</Text>
          <ChevronRight color={C.text3} size={12} strokeWidth={2.5} />
        </TouchableOpacity>

        <View style={S.backBtn} />
      </View>

      <KeyboardAvoidingView style={S.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Hero */}
          <View style={S.hero}>
            <View style={[S.logoOuter, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5', borderColor: isDark ? '#2a2a2a' : '#e8e8e8' }]}>
              <View style={[S.logoInner, { backgroundColor: accentColor }]}>
                <Scissors color="#fff" size={26} strokeWidth={2} />
              </View>
            </View>
            <Text style={[S.brand, { color: C.text }]}>Kutz</Text>
            <Text style={[S.tagline, { color: C.text3 }]}>
              {mode === 'choose'
                ? 'Sign in to continue'
                : mode === 'signin'
                ? 'Welcome back'
                : mode === 'forgot'
                ? 'Reset your password'
                : 'Create your account'}
            </Text>
          </View>

          {/* Card */}
          <View style={[S.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>

            {/* Choose mode */}
            {mode === 'choose' && (
              <>
                {/* Google */}
                <TouchableOpacity
                  style={[S.googleBtn, { backgroundColor: isDark ? '#1e1e1e' : '#f7f7f7', borderColor: isDark ? '#333' : '#e0e0e0' }]}
                  onPress={handleGoogleSignIn}
                  disabled={googleLoading}
                  activeOpacity={0.82}
                >
                  {googleLoading ? (
                    <ActivityIndicator color={C.text} />
                  ) : (
                    <>
                      <Text style={[S.googleG, { color: C.text }]}>G</Text>
                      <Text style={[S.googleLabel, { color: C.text }]}>Continue with Google</Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={S.orRow}>
                  <View style={[S.orLine, { backgroundColor: C.border }]} />
                  <Text style={[S.orText, { color: C.text3 }]}>or</Text>
                  <View style={[S.orLine, { backgroundColor: C.border }]} />
                </View>

                <TouchableOpacity
                  style={[S.emailBtn, { backgroundColor: accentColor }]}
                  onPress={() => setMode('signin')}
                  activeOpacity={0.86}
                >
                  <Mail color="#fff" size={17} strokeWidth={2} />
                  <Text style={S.emailBtnText}>Sign in with Email</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={S.newAccountRow}
                  onPress={() => setMode('signup')}
                  activeOpacity={0.8}
                >
                  <Text style={[S.newAccountText, { color: C.text3 }]}>
                    No account?{' '}
                    <Text style={{ color: accentColor, fontWeight: '700' }}>Create one</Text>
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* Sign In */}
            {mode === 'signin' && (
              <View style={S.form}>
                <Field label="Email" icon={<Mail color={C.text3} size={16} />} C={C}>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@email.com"
                    placeholderTextColor={C.text3}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[S.input, { color: C.text }]}
                  />
                </Field>

                <Field
                  label="Password"
                  icon={<Lock color={C.text3} size={16} />}
                  C={C}
                  right={
                    <TouchableOpacity onPress={() => setShowPassword(v => !v)} hitSlop={10}>
                      {showPassword
                        ? <EyeOff color={C.text3} size={16} />
                        : <Eye color={C.text3} size={16} />}
                    </TouchableOpacity>
                  }
                >
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Your password"
                    placeholderTextColor={C.text3}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    style={[S.input, { color: C.text }]}
                  />
                </Field>

                <TouchableOpacity
                  style={[S.submitBtn, { backgroundColor: accentColor, opacity: canSignIn ? 1 : 0.5 }]}
                  onPress={handleSignIn}
                  disabled={loading || !canSignIn}
                  activeOpacity={0.86}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={S.submitBtnText}>Sign In</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ alignItems: 'center', paddingTop: 2 }}
                  onPress={() => setMode('forgot')}
                  activeOpacity={0.8}
                >
                  <Text style={[S.switchText, { color: C.text3 }]}>
                    Forgot password?{' '}
                    <Text style={{ color: accentColor, fontWeight: '700' }}>Reset it</Text>
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={S.switchRow} onPress={() => setMode('signup')} activeOpacity={0.8}>
                  <Text style={[S.switchText, { color: C.text3 }]}>
                    No account?{' '}
                    <Text style={{ color: accentColor, fontWeight: '700' }}>Create one</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Forgot Password */}
            {mode === 'forgot' && (
              <View style={S.form}>
                <Field label="Email" icon={<Mail color={C.text3} size={16} />} C={C}>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@email.com"
                    placeholderTextColor={C.text3}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[S.input, { color: C.text }]}
                  />
                </Field>

                <TouchableOpacity
                  style={[S.submitBtn, { backgroundColor: accentColor, opacity: canReset ? 1 : 0.5 }]}
                  onPress={handleForgotPassword}
                  disabled={loading || !canReset}
                  activeOpacity={0.86}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={S.submitBtnText}>Send Reset Link</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={S.switchRow} onPress={() => setMode('signin')} activeOpacity={0.8}>
                  <Text style={[S.switchText, { color: C.text3 }]}>
                    <Text style={{ color: accentColor, fontWeight: '700' }}>← Back to sign in</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Sign Up */}
            {mode === 'signup' && (
              <View style={S.form}>
                <Field label="Full Name" icon={<User color={C.text3} size={16} />} C={C}>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Marcus Jordan"
                    placeholderTextColor={C.text3}
                    autoCapitalize="words"
                    style={[S.input, { color: C.text }]}
                  />
                </Field>

                <Field label="Email" icon={<Mail color={C.text3} size={16} />} C={C}>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@email.com"
                    placeholderTextColor={C.text3}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[S.input, { color: C.text }]}
                  />
                </Field>

                <Field
                  label="Password"
                  icon={<Lock color={C.text3} size={16} />}
                  C={C}
                  right={
                    <TouchableOpacity onPress={() => setShowPassword(v => !v)} hitSlop={10}>
                      {showPassword
                        ? <EyeOff color={C.text3} size={16} />
                        : <Eye color={C.text3} size={16} />}
                    </TouchableOpacity>
                  }
                >
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Choose a password"
                    placeholderTextColor={C.text3}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    style={[S.input, { color: C.text }]}
                  />
                </Field>

                <TouchableOpacity
                  style={[S.submitBtn, { backgroundColor: accentColor, opacity: canSignUp ? 1 : 0.5 }]}
                  onPress={handleSignUp}
                  disabled={loading || !canSignUp}
                  activeOpacity={0.86}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={S.submitBtnText}>Create Account</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={S.switchRow} onPress={() => setMode('signin')} activeOpacity={0.8}>
                  <Text style={[S.switchText, { color: C.text3 }]}>
                    Already have an account?{' '}
                    <Text style={{ color: accentColor, fontWeight: '700' }}>Sign in</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  icon,
  right,
  C,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  C: any;
  children: React.ReactNode;
}) {
  return (
    <View style={S.fieldWrap}>
      <Text style={[S.fieldLabel, { color: C.text2 }]}>{label}</Text>
      <View style={[S.fieldBox, { borderColor: C.border, backgroundColor: C.bg2 }]}>
        <View style={S.fieldIcon}>{icon}</View>
        <View style={S.fieldInput}>{children}</View>
        {right ? <View style={S.fieldRight}>{right}</View> : null}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: '600',
  },

  hero: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 28,
  },
  logoOuter: {
    width: 80,
    height: 80,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 14,
  },
  logoInner: {
    width: 54,
    height: 54,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4,
  },

  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
  },

  googleBtn: {
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleG: {
    fontSize: 17,
    fontWeight: '800',
    fontStyle: 'italic',
  },
  googleLabel: {
    fontSize: 15,
    fontWeight: '600',
  },

  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 14,
  },
  orLine: { flex: 1, height: 1 },
  orText: { fontSize: 12, fontWeight: '600' },

  emailBtn: {
    height: 54,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emailBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  newAccountRow: {
    alignItems: 'center',
    paddingTop: 16,
  },
  newAccountText: {
    fontSize: 14,
    fontWeight: '500',
  },

  form: { gap: 12 },

  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginLeft: 2 },
  fieldBox: {
    height: 52,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldIcon: { width: 40, alignItems: 'center', justifyContent: 'center' },
  fieldInput: { flex: 1 },
  fieldRight: { width: 40, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 15, fontWeight: '500', paddingVertical: 0 },

  submitBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  switchRow: { alignItems: 'center', paddingTop: 12 },
  switchText: { fontSize: 14, fontWeight: '500' },
});
