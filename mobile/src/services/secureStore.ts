import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'lendlocal_auth_token';
const USER_KEY = 'lendlocal_auth_user';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  upiId?: string | null;
}

export async function saveAuthToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getAuthToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch (err) {
    console.warn('Failed to retrieve token from SecureStore:', err);
    return null;
  }
}

export async function deleteAuthToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (err) {
    console.warn('Failed to delete token from SecureStore:', err);
  }
}

export async function saveUserData(user: UserProfile): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } catch (err) {
    console.warn('Failed to save user data to SecureStore:', err);
  }
}

export async function getUserData(): Promise<UserProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to retrieve user data from SecureStore:', err);
    return null;
  }
}

export async function deleteUserData(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(USER_KEY);
  } catch (err) {
    console.warn('Failed to delete user data from SecureStore:', err);
  }
}

export async function clearAllAuth(): Promise<void> {
  await Promise.all([deleteAuthToken(), deleteUserData()]);
}
