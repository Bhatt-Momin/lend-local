import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider } from '../context/AuthContext';
import { DeepLinkHandler } from '../components/DeepLinkHandler';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <DeepLinkHandler />
        <Stack screenOptions={{ headerShown: false }}>
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
