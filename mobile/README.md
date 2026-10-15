# LendLocal Native Mobile App

The native mobile client for LendLocal, built with **React Native**, **Expo SDK 57**, **TypeScript**, and **Expo Router** file-based navigation.

---

## 1. Prerequisites & Installation

- **Node.js**: LTS version (v20+ recommended)
- **Package Manager**: `npm`

To install project dependencies, navigate to the `mobile/` directory:

```bash
cd mobile
npm install
```

---

## 2. Starting the Development Server

From within the `mobile/` directory, start the Metro bundler:

```bash
npm start
# or
npx expo start
```

Available platform targets:
- `npm run android` — Launches the app on a connected Android device or running emulator.
- `npm run ios` — Launches the app on an iOS simulator (requires macOS and Xcode).
- `npm run web` — Starts the web preview in your browser.
- `npm run lint` — Runs Expo ESLint checks.

---

## 3. Testing on a Physical Android Device (Expo Go)

1. Install **Expo Go** from the Google Play Store on your Android phone.
2. Ensure your phone and development computer are connected to the **same local Wi-Fi network**.
3. Start the dev server with `npm start`.
4. Open the Expo Go app on your phone and scan the QR code displayed in the terminal.

---

## 4. Backend API URL Configuration

The app automatically detects the appropriate backend base URL based on the runtime platform (`mobile/src/services/config.ts`):

| Environment | Default API Base URL | Detection Mechanism |
| :--- | :--- | :--- |
| **Physical Device (Expo Go)** | `http://<METRO_HOST_LAN_IP>:3000/api` | Automatically extracted from Metro's `hostUri` |
| **Android Emulator** | `http://10.0.2.2:3000/api` | Standard Android emulator loopback alias to host `localhost` |
| **iOS Simulator** | `http://localhost:3000/api` | Direct local network loopback |
| **Web Preview** | `http://localhost:3000/api` | Browser localhost |

### Network & Security Notes
- **Local Development**: Physical devices **must** be on the same Wi-Fi / local network to reach your computer's IP address on port `3000`. Ensure your firewall allows incoming connections on port `3000`.
- **Production & Remote Traffic**: Production API communication must use secure `https://` endpoints.
- **Dynamic In-App Override**: You can tap the **Server Connection** badge on the Welcome/Login/Register screens to open the **Server Config Modal**. This allows you to manually specify a custom API URL (e.g. an ngrok tunnel or staging server) or reset to defaults. Custom URLs are persisted securely in storage.
- **Environment Variable**: You can also supply an optional `EXPO_PUBLIC_API_URL` environment variable at bundle time.

---

## 5. Authentication & Session Architecture

- **Registration & Login**: Full native forms with inline validation, error handling, and password visibility toggles.
- **Secure Token Storage**: Authentication tokens (`lendlocal_auth_token`) and user profiles (`lendlocal_auth_user`) are stored securely using **`expo-secure-store`** (Android Keystore / iOS Keychain), rather than unencrypted storage.
- **Session Restoration**: When the app boots, `AuthContext` automatically reads stored credentials from SecureStore, restoring authenticated sessions without re-prompting.
- **Sign Out**: Clears both the in-memory context and persistent SecureStore entries.

---

## 6. iOS Simulator & Native Store Builds

- **iOS Simulator**: Requires a Mac running macOS with Xcode and Xcode Command Line Tools installed.
- **Native Store Builds**: Building standalone `.apk` / `.aab` packages for Google Play or `.ipa` packages for Apple TestFlight/App Store requires native build tools or Expo Application Services (EAS Build), configured with the application identifiers `com.lendlocal.app`.
