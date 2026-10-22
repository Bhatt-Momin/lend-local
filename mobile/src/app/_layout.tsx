import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider } from '../context/AuthContext';
import { DeepLinkHandler } from '../components/DeepLinkHandler';
import { NotificationPushHandler } from '../components/NotificationPushHandler';
import { Brand, Surfaces } from '../constants/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const activeTheme = useMemo(() => {
    if (colorScheme === 'dark') {
      return {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: Surfaces.darkBg,
          card: Surfaces.darkCard,
          text: '#F0F4F8',
          border: Surfaces.darkBorder,
          primary: Brand.primary,
        },
      };
    }
    return DefaultTheme;
  }, [colorScheme]);

  return (
    <ThemeProvider value={activeTheme}>
      <StatusBar style="light" />
      <AuthProvider>
        <DeepLinkHandler />
        <NotificationPushHandler />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Surfaces.darkBg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)/login" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(auth)/register" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="group/new" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="group/[id]/index" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
