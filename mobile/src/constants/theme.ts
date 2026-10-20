/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#030507',
    background: '#F8FAFC',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#F1F5F9',
    textSecondary: '#64748B',
  },
  dark: {
    text: '#F0F4F8',
    background: '#030507',
    backgroundElement: '#0A0E14',
    backgroundSelected: '#0F1520',
    textSecondary: '#7A93A6',
  },
} as const;

export const Brand = {
  primary: '#10B981',
  primaryHover: '#059669',
  primaryLight: '#34D399',
  primaryDim: 'rgba(16, 185, 129, 0.12)',
  primaryGlow: 'rgba(16, 185, 129, 0.22)',
  positive: '#10B981',
  positiveDim: 'rgba(16, 185, 129, 0.14)',
  negative: '#EF4444',
  negativeDim: 'rgba(239, 68, 68, 0.14)',
  warning: '#F59E0B',
  warningDim: 'rgba(245, 158, 11, 0.14)',
  info: '#0284C7',
  infoDim: 'rgba(2, 132, 199, 0.14)',
} as const;

export const Surfaces = {
  darkBg: '#030507',
  darkCard: '#0A0E14',
  darkCardMid: '#0F1520',
  darkCardRaised: 'rgba(255, 255, 255, 0.03)',
  darkBorder: 'rgba(255, 255, 255, 0.08)',
  darkBorderBright: 'rgba(255, 255, 255, 0.14)',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
