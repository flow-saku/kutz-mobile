import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export interface ClientSession {
  id: string;
  display_name: string;
  email?: string;
  client_id?: string;
  visit_count?: number;
  birthday?: string | null;
}

export const useClientAuth = (barberId?: string) => {
  const [clientSession, setClientSession] = useState<ClientSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);

  const linkClient = useCallback(async (user: User, bid: string) => {
    try {
      const email = user.email ?? '';
      const name =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        email.split('@')[0] ||
        'Client';

      const { data, error } = await (supabase as any).rpc('link_client_account', {
        p_barber_id: bid,
        p_auth_user_id: user.id,
        p_email: email,
        p_name: name,
      });

      if (error) {
        console.error('[useClientAuth] link error:', error);
        setClientSession({ id: user.id, display_name: name, email });
        return;
      }

      setClientSession({
        id: user.id,
        display_name: (data as any)?.name || name,
        email,
        client_id: (data as any)?.client_id ?? undefined,
        visit_count: (data as any)?.visit_count ?? 0,
        birthday: (data as any)?.birthday ?? null,
      });
    } catch (err) {
      console.error('[useClientAuth] link error:', err);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const user = session?.user ?? null;
      setAuthUser(user);
      if (user && barberId) {
        linkClient(user, barberId).finally(() => {
          if (mounted) setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;
        const user = session?.user ?? null;
        setAuthUser(user);
        if (user && barberId) {
          await linkClient(user, barberId);
        } else {
          setClientSession(null);
        }
        setIsLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [barberId, linkClient]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, name?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name ?? email.split('@')[0] } },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setClientSession(null);
    setAuthUser(null);
  }, []);

  return { clientSession, authUser, isLoading, signInWithEmail, signUpWithEmail, signOut };
};
