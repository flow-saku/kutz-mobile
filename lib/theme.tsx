import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'app_theme';

export type Theme = 'light' | 'dark';

interface Colors {
  bg: string;
  bg2: string;
  bg3: string;
  border: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentText: string;
  card: string;
  cardBorder: string;
  tabBar: string;
  tabBarBorder: string;
  success: string;
}

export const LIGHT: Colors = {
  bg: '#ffffff',
  bg2: '#f5f5f5',
  bg3: '#efefef',
  border: '#e5e5e5',
  text: '#171717',
  text2: '#525252',
  text3: '#737373',
  accent: '#171717',
  accentText: '#ffffff',
  card: '#ffffff',
  cardBorder: '#e5e5e5',
  tabBar: 'rgba(255,255,255,0.96)',
  tabBarBorder: '#e5e5e5',
  success: '#16a34a',
};

export const DARK: Colors = {
  bg: '#0a0a0a',
  bg2: '#141414',
  bg3: '#1f1f1f',
  border: '#2e2e2e',
  text: '#fafafa',
  text2: '#d4d4d4',
  text3: '#a3a3a3',
  accent: '#f5f5f5',
  accentText: '#171717',
  card: '#121212',
  cardBorder: '#2e2e2e',
  tabBar: 'rgba(10,10,10,0.96)',
  tabBarBorder: '#2e2e2e',
  success: '#22c55e',
};

interface ThemeCtx {
  theme: Theme;
  C: Colors;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'light',
  C: LIGHT,
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((val: string | null) => {
      if (val === 'dark' || val === 'light') setTheme(val);
    });
  }, []);

  const toggle = async () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    await AsyncStorage.setItem(THEME_KEY, next);
  };

  return (
    <ThemeContext.Provider value={{ theme, C: theme === 'dark' ? DARK : LIGHT, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
