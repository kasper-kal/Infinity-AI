/**
 * PHASE 12 — MOBILE APP GENERATOR (Expo / React Native)
 *
 * Generates native iOS/Android apps with React Native + Expo + NativeWind.
 * Supports screens, device features, platform-specific components, shared backend.
 * $0 budget: pure code generation.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactConfig,
  ArtifactScaffoldResult,
  ArtifactBuildResult,
  ArtifactDeployResult,
  ArtifactPreviewInfo,
  ArtifactTypeDefinition,
  MobileAppSettings,
} from "../artifact-types";

export class MobileAppGenerator {
  private typeDef: ArtifactTypeDefinition;

  constructor(typeDef: ArtifactTypeDefinition) {
    this.typeDef = typeDef;
  }

  async generate(config: ArtifactConfig): Promise<ArtifactScaffoldResult> {
    const settings = config.settings as MobileAppSettings;
    const files: ArtifactScaffoldResult["files"] = [];

    files.push(...this.generateExpoFiles(config, settings));

    return {
      config,
      files,
      entryPoints: ["App.tsx"],
      installCommands: this.getInstallCommands(),
      devCommands: this.getDevCommands(),
      buildCommands: this.getBuildCommands(),
      previewCommands: this.getPreviewCommands(),
      deployCommands: this.getDeployCommands(),
    };
  }

  private generateExpoFiles(config: ArtifactConfig, settings: MobileAppSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    // app.json — Expo config
    files.push({
      path: "app.json",
      content: this.generateAppJson(config, settings),
      purpose: "Expo configuration",
      isTemplate: true,
    });

    // package.json
    files.push({
      path: "package.json",
      content: JSON.stringify(this.generatePackageJson(config, settings), null, 2),
      purpose: "NPM package configuration for Expo",
      isTemplate: true,
    });

    // babel.config.js
    files.push({
      path: "babel.config.js",
      content: this.generateBabelConfig(),
      purpose: "Babel configuration with NativeWind",
      isTemplate: true,
    });

    // tailwind.config.js
    files.push({
      path: "tailwind.config.js",
      content: this.generateTailwindConfig(),
      purpose: "Tailwind CSS configuration for NativeWind",
      isTemplate: true,
    });

    // tsconfig.json
    files.push({
      path: "tsconfig.json",
      content: JSON.stringify(this.generateTsConfig(), null, 2),
      purpose: "TypeScript configuration",
      isTemplate: true,
    });

    // App.tsx (entry)
    files.push({
      path: "App.tsx",
      content: this.generateAppEntry(config, settings),
      purpose: "Root application entry",
      isTemplate: true,
    });

    // Expo Router app structure
    files.push(...this.generateRouterStructure(config, settings));

    // Components
    files.push(...this.generateComponents(config, settings));

    // Features (camera, location, etc.)
    if (settings.features.length > 0) {
      files.push(...this.generateFeatureModules(config, settings));
    }

    // Backend integration
    if (settings.backend.sharedDb || settings.backend.sharedAuth) {
      files.push({
        path: "src/lib/backend.ts",
        content: this.generateBackendConfig(config, settings),
        purpose: "Shared backend client (auth, database, API)",
        isTemplate: true,
      });
    }

    // README
    files.push({
      path: "README.md",
      content: this.generateReadme(config, settings),
      purpose: "Project documentation",
      isTemplate: true,
    });

    // Git ignore
    files.push({
      path: ".gitignore",
      content: "node_modules/\n.expo/\ndist/\n*.log\n.env\n.env.local\nios/\nandroid/\n",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    return files;
  }

  private generateAppJson(config: ArtifactConfig, settings: MobileAppSettings): string {
    const platforms = settings.platform === "both" ? ["ios", "android"] : [settings.platform];

    return JSON.stringify({
      expo: {
        name: config.name,
        slug: config.slug || config.name.toLowerCase().replace(/\s+/g, "-"),
        version: "1.0.0",
        orientation: "portrait",
        userInterfaceStyle: "automatic",
        splash: {
          image: "./assets/splash.png",
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
        assetBundlePatterns: ["**/*"],
        ios: {
          supportsTablet: true,
          bundleIdentifier: `com.infinity.${config.slug || config.name.toLowerCase().replace(/\s+/g, "-")}`,
        },
        android: {
          package: `com.infinity.${config.slug || config.name.toLowerCase().replace(/\s+/g, "-")}`,
          adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            backgroundColor: "#ffffff",
          },
        },
        web: {
          bundler: "metro",
          output: "static",
        },
        plugins: [
          "expo-router",
          ...(settings.features.includes("camera") ? ["expo-camera"] : []),
          ...(settings.features.includes("location") ? ["expo-location"] : []),
          ...(settings.features.includes("push") ? ["expo-notifications"] : []),
          ...(settings.features.includes("biometrics") ? ["expo-local-authentication"] : []),
        ],
        experiments: {
          typedRoutes: true,
        },
        platforms,
      },
    }, null, 2);
  }

  private generatePackageJson(config: ArtifactConfig, settings: MobileAppSettings): Record<string, unknown> {
    const deps: Record<string, string> = {
      "expo": "~50.0.0",
      "expo-router": "~3.4.0",
      "expo-status-bar": "~1.11.0",
      "react": "18.2.0",
      "react-native": "0.73.0",
      "nativewind": "^4.0.0",
      "tailwindcss": "^3.4.0",
      "react-native-reanimated": "~3.6.0",
      "react-native-safe-area-context": "4.8.2",
      "react-native-screens": "~3.29.0",
      "@react-navigation/native": "^6.1.0",
      "@react-navigation/bottom-tabs": "^6.5.0",
    };

    if (settings.features.includes("camera")) deps["expo-camera"] = "~14.1.0";
    if (settings.features.includes("location")) deps["expo-location"] = "~16.5.0";
    if (settings.features.includes("push")) deps["expo-notifications"] = "~0.27.0";
    if (settings.features.includes("biometrics")) deps["expo-local-authentication"] = "~14.0.0";
    if (settings.features.includes("contacts")) deps["expo-contacts"] = "~13.0.0";
    if (settings.features.includes("media-library")) deps["expo-media-library"] = "~15.9.0";

    if (settings.backend.sharedAuth) {
      deps["@supabase/supabase-js"] = "^2.39.0";
    }

    return {
      name: config.slug || config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: config.description,
      main: "expo-router/entry",
      scripts: {
        start: "expo start",
        android: "expo start --android",
        ios: "expo start --ios",
        web: "expo start --web",
        eject: "expo eject",
      },
      dependencies: deps,
      devDependencies: {
        "@babel/core": "^7.20.0",
        "@types/react": "~18.2.0",
        "typescript": "^5.3.0",
      },
    };
  }

  private generateBabelConfig(): string {
    return `module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: ["react-native-reanimated/plugin"],
  };
};`;
  }

  private generateTailwindConfig(): string {
    return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};`;
  }

  private generateTsConfig(): Record<string, unknown> {
    return {
      extends: "expo/tsconfig.base",
      compilerOptions: {
        strict: true,
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
      },
      include: [
        "**/*.ts",
        "**/*.tsx",
        ".expo/types/**/*.ts",
        "expo-env.d.ts",
      ],
    };
  }

  private generateAppEntry(config: ArtifactConfig, settings: MobileAppSettings): string {
    return `import "expo-router/entry";

// Expo Router handles navigation automatically via app/ directory
// Screens are defined in app/(tabs)/, app/index.tsx, etc.

export default function App() {
  // Entry point for Expo Router
  return null;
}`;
  }

  private generateRouterStructure(config: ArtifactConfig, settings: MobileAppSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    // Root layout
    files.push({
      path: "app/_layout.tsx",
      content: this.generateRootLayout(config),
      purpose: "Root navigation layout",
      isTemplate: true,
    });

    // Index / splash
    files.push({
      path: "app/index.tsx",
      content: this.generateIndexScreen(config),
      purpose: "App entry screen",
      isTemplate: true,
    });

    // Tab-based navigation
    if (settings.template === "tabs" || settings.template === "dashboard") {
      files.push({
        path: "app/(tabs)/_layout.tsx",
        content: this.generateTabsLayout(config),
        purpose: "Tab navigation layout",
        isTemplate: true,
      });
      files.push({
        path: "app/(tabs)/index.tsx",
        content: this.generateHomeScreen(config),
        purpose: "Home tab screen",
        isTemplate: true,
      });
      files.push({
        path: "app/(tabs)/settings.tsx",
        content: this.generateSettingsScreen(config),
        purpose: "Settings tab screen",
        isTemplate: true,
      });
    }

    // Stack navigation
    if (settings.template === "stack" || settings.template === "auth") {
      files.push({
        path: "app/(stack)/_layout.tsx",
        content: this.generateStackLayout(config),
        purpose: "Stack navigation layout",
        isTemplate: true,
      });
    }

    // Drawer navigation
    if (settings.template === "drawer") {
      files.push({
        path: "app/(drawer)/_layout.tsx",
        content: this.generateDrawerLayout(config),
        purpose: "Drawer navigation layout",
        isTemplate: true,
      });
    }

    // Auth screens
    if (settings.template === "auth" || settings.backend.sharedAuth) {
      files.push({
        path: "app/(auth)/login.tsx",
        content: this.generateLoginScreen(config),
        purpose: "Login screen",
        isTemplate: true,
      });
      files.push({
        path: "app/(auth)/register.tsx",
        content: this.generateRegisterScreen(config),
        purpose: "Register screen",
        isTemplate: true,
      });
    }

    // Dashboard
    if (settings.template === "dashboard") {
      files.push({
        path: "app/(tabs)/dashboard.tsx",
        content: this.generateDashboardScreen(config),
        purpose: "Dashboard tab screen",
        isTemplate: true,
      });
    }

    return files;
  }

  private generateComponents(config: ArtifactConfig, settings: MobileAppSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    files.push({
      path: "src/components/Button.tsx",
      content: `import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { cn } from '@/lib/utils';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled }: ButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      className={cn(
        'rounded-lg px-6 py-3 items-center justify-center',
        variant === 'primary' && 'bg-indigo-600',
        variant === 'secondary' && 'bg-gray-200',
        variant === 'ghost' && 'bg-transparent',
        variant === 'danger' && 'bg-red-600',
        disabled && 'opacity-50'
      )}
    >
      {loading ? (
        <ActivityIndicator color="white" />
      ) : (
        <Text className={cn(
          'font-semibold',
          variant === 'primary' && 'text-white',
          variant === 'secondary' && 'text-gray-900',
          variant === 'ghost' && 'text-indigo-600',
          variant === 'danger' && 'text-white'
        )}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}`,
      purpose: "Reusable button component",
      isTemplate: true,
    });

    files.push({
      path: "src/components/Card.tsx",
      content: `import { View, Text } from 'react-native';
import { cn } from '@/lib/utils';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, children, className }: CardProps) {
  return (
    <View className={cn('bg-white rounded-xl p-4 shadow-sm border border-gray-100', className)}>
      {title && <Text className="text-lg font-bold text-gray-900 mb-2">{title}</Text>}
      {children}
    </View>
  );
}`,
      purpose: "Reusable card component",
      isTemplate: true,
    });

    files.push({
      path: "src/lib/utils.ts",
      content: `import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date);
}`,
      purpose: "Utility functions (cn, formatDate)",
      isTemplate: true,
    });

    return files;
  }

  private generateFeatureModules(config: ArtifactConfig, settings: MobileAppSettings): ArtifactScaffoldResult["files"] {
    const files: ArtifactScaffoldResult["files"] = [];

    if (settings.features.includes("camera")) {
      files.push({
        path: "src/features/camera/useCamera.ts",
        content: `import { useState, useEffect } from 'react';
import { Camera } from 'expo-camera';

export function useCamera() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [type, setType] = useState(Camera.Constants.Type.back);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const toggleType = () => {
    setType((prev) => (prev === Camera.Constants.Type.back ? Camera.Constants.Type.front : Camera.Constants.Type.back));
  };

  return { hasPermission, type, toggleType };
}`,
        purpose: "Camera feature hook",
        isTemplate: true,
      });
    }

    if (settings.features.includes("location")) {
      files.push({
        path: "src/features/location/useLocation.ts",
        content: `import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

export function useLocation() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
    })();
  }, []);

  return { location, errorMsg };
}`,
        purpose: "Location feature hook",
        isTemplate: true,
      });
    }

    if (settings.features.includes("push")) {
      files.push({
        path: "src/features/notifications/usePushNotifications.ts",
        content: `import { useState, useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string>('');

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => token && setExpoPushToken(token));
  }, []);

  return { expoPushToken };
}

async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }
    token = (await Notifications.getExpoPushTokenAsync()).data;
  }

  return token;
}`,
        purpose: "Push notifications feature hook",
        isTemplate: true,
      });
    }

    if (settings.features.includes("biometrics")) {
      files.push({
        path: "src/features/biometrics/useBiometrics.ts",
        content: `import { useState, useEffect } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export function useBiometrics() {
  const [hasHardware, setHasHardware] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [supportedTypes, setSupportedTypes] = useState<LocalAuthentication.AuthenticationType[]>([]);

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      setHasHardware(compatible);
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setIsEnrolled(enrolled);
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      setSupportedTypes(types);
    })();
  }, []);

  const authenticate = async (promptMessage = 'Authenticate'): Promise<boolean> => {
    if (!hasHardware || !isEnrolled) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use passcode',
    });
    return result.success;
  };

  return { hasHardware, isEnrolled, supportedTypes, authenticate };
}`,
        purpose: "Biometrics feature hook",
        isTemplate: true,
      });
    }

    return files;
  }

  private generateBackendConfig(config: ArtifactConfig, settings: MobileAppSettings): string {
    if (settings.backend.sharedAuth) {
      return `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Shared database queries
export async function getItems<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return data as T[];
}

export async function getItem<T>(table: string, id: string): Promise<T | null> {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data as T;
}`;
    }

    return `// Backend integration for ${config.name}
// Shared with web app and chrome extension via Infinity's shared foundation

export const API_URL = process.env.EXPO_PUBLIC_API_URL || '${settings.backend.apiUrl || "http://localhost:3000"}';

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(\`\${API_URL}\${path}\`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(\`API error: \${response.status}\`);
  return response.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(\`\${API_URL}\${path}\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(\`API error: \${response.status}\`);
  return response.json();
}`;
  }

  private generateRootLayout(config: ArtifactConfig): string {
    return `import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(stack)" />
        <Stack.Screen name="(drawer)" />
        <Stack.Screen name="(auth)" />
      </Stack>
    </SafeAreaProvider>
  );
}`;
  }

  private generateIndexScreen(config: ArtifactConfig): string {
    return `import { Redirect } from 'expo-router';

export default function Index() {
  // Redirect to main app or auth
  return <Redirect href="/(tabs)" />;
}`;
  }

  private generateTabsLayout(config: ArtifactConfig): string {
    return `import { Tabs } from 'expo-router';
import { Home, Settings } from '@/components/icons';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#6366F1' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Home color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Settings color={color} />,
        }}
      />
    </Tabs>
  );
}`;
  }

  private generateHomeScreen(config: ArtifactConfig): string {
    return `import { View, Text, ScrollView } from 'react-native';
import { Button } from '@/components/Button';

export default function HomeScreen() {
  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="px-4 py-6">
        <Text className="text-3xl font-bold text-gray-900">{config.name}</Text>
        <Text className="text-gray-600 mt-2">{config.description}</Text>

        <View className="mt-6 space-y-4">
          <Button title="Get Started" onPress={() => {}} />
          <Button title="Learn More" variant="secondary" onPress={() => {}} />
        </View>
      </View>
    </ScrollView>
  );
}`;
  }

  private generateSettingsScreen(config: ArtifactConfig): string {
    return `import { View, Text, Switch, ScrollView } from 'react-native';
import { useState } from 'react';

export default function SettingsScreen() {
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="px-4 py-6 space-y-4">
        <Text className="text-2xl font-bold text-gray-900">Settings</Text>

        <View className="flex-row justify-between items-center py-3">
          <Text className="text-gray-700">Dark Mode</Text>
          <Switch value={darkMode} onValueChange={setDarkMode} />
        </View>

        <View className="flex-row justify-between items-center py-3">
          <Text className="text-gray-700">Notifications</Text>
          <Switch value={notifications} onValueChange={setNotifications} />
        </View>
      </View>
    </ScrollView>
  );
}`;
  }

  private generateStackLayout(config: ArtifactConfig): string {
    return `import { Stack } from 'expo-router';

export default function StackLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: '${config.name}' }} />
    </Stack>
  );
}`;
  }

  private generateDrawerLayout(config: ArtifactConfig): string {
    return `import { Drawer } from 'expo-router';

export default function DrawerLayout() {
  return (
    <Drawer>
      <Drawer.Screen name="index" options={{ title: 'Home' }} />
      <Drawer.Screen name="settings" options={{ title: 'Settings' }} />
    </Drawer>
  );
}`;
  }

  private generateLoginScreen(config: ArtifactConfig): string {
    return `import { View, Text, TextInput, ScrollView } from 'react-native';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { signIn } from '@/lib/backend';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-12 space-y-4">
        <Text className="text-3xl font-bold text-gray-900">Welcome Back</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3"
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Button title="Sign In" onPress={handleLogin} loading={loading} />
      </View>
    </ScrollView>
  );
}`;
  }

  private generateRegisterScreen(config: ArtifactConfig): string {
    return `import { View, Text, TextInput, ScrollView } from 'react-native';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { signUp } from '@/lib/backend';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setLoading(true);
    try {
      await signUp(email, password);

    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-12 space-y-4">
        <Text className="text-3xl font-bold text-gray-900">Create Account</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3"
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Button title="Sign Up" onPress={handleRegister} loading={loading} />
      </View>
    </ScrollView>
  );
}`;
  }

  private generateDashboardScreen(config: ArtifactConfig): string {
    return `import { View, Text, ScrollView } from 'react-native';
import { Card } from '@/components/Card';

export default function DashboardScreen() {
  const stats = [
    { label: 'Total Users', value: '1,234' },
    { label: 'Active Sessions', value: '89' },
    { label: 'Revenue', value: '$4,567' },
  ];

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="px-4 py-6">
        <Text className="text-2xl font-bold text-gray-900 mb-4">Dashboard</Text>
        <View className="space-y-3">
          {stats.map((stat) => (
            <Card key={stat.label} title={stat.label}>
              <Text className="text-3xl font-bold text-indigo-600">{stat.value}</Text>
            </Card>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}`;
  }

  private generateReadme(config: ArtifactConfig, settings: MobileAppSettings): string {
    const features = settings.features.length > 0
      ? `\n## 📱 Device Features\n\n${settings.features.map(f => `- ${f}`).join("\n")}`
      : "";

    return `# ${config.name}

${config.description}

## 🚀 Quick Start

\`\`\`bash
npm install
npm start
\`\`\`

Scan QR code with Expo Go app (iOS/Android).

## 📱 Platforms

${settings.platform === "both" ? "- iOS + Android" : `- ${settings.platform.charAt(0).toUpperCase() + settings.platform.slice(1)}`}

## 🧭 Navigation

${settings.navigation === "expo-router" ? "- Expo Router (file-based)" : "- React Navigation"}

## 🎨 Styling

- NativeWind (Tailwind CSS for React Native)${features}

## 🔗 Shared Backend

${settings.backend.sharedDb || settings.backend.sharedAuth ? "- Uses Infinity shared foundation (database + auth)" : "- Standalone app"}

## 🚀 Deploy

### Expo Go (Development)
\`\`\`bash
expo start
\`\`\`

### EAS Build (Production)
\`\`\`bash
eas build --platform ${settings.platform === "both" ? "all" : settings.platform}
eas submit --platform ${settings.platform === "both" ? "all" : settings.platform}
\`\`\`

---

*Generated by Infinity AI — Multi-Artifact Support (Phase 12)*`;
  }

  private getInstallCommands(): string[] {
    return ["npm install"];
  }

  private getDevCommands(): string[] {
    return ["npm start"];
  }

  private getBuildCommands(): string[] {
    return ["eas build --platform all"];
  }

  private getPreviewCommands(): string[] {
    return ["npm start"];
  }

  private getDeployCommands(): Record<string, string> {
    return {
      expo: "expo publish",
      eas: "eas build --platform all && eas submit --platform all",
      "self-hosted": "expo export && serve dist",
    };
  }

  async build(artifactId: string, projectDir: string): Promise<ArtifactBuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Building mobile app: ${artifactId}`);
      const { execSync } = await import("node:child_process");
      const output = execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 180000 });
      logs.push(output);

      return {
        artifactId,
        success: true,
        outputDir: path.join(projectDir, "dist"),
        assets: [],
        logs,
        errors: [],
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(errorMsg);
      logs.push(`Build failed: ${errorMsg}`);

      return {
        artifactId,
        success: false,
        outputDir: "",
        assets: [],
        logs,
        errors,
        durationMs: Date.now() - startTime,
      };
    }
  }

  async deploy(artifactId: string, projectDir: string, target: string): Promise<ArtifactDeployResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Deploying mobile app to ${target}: ${artifactId}`);
      const deployCmd = this.getDeployCommands()[target];
      if (!deployCmd) throw new Error(`Unknown deploy target: ${target}`);

      const { execSync } = await import("node:child_process");
      const output = execSync(deployCmd, { cwd: projectDir, encoding: "utf-8", timeout: 300000 });
      logs.push(output);

      return {
        artifactId,
        target: target as any,
        success: true,
        url: this.extractDeployUrl(output, target),
        logs,
        errors: [],
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(errorMsg);
      logs.push(`Deploy failed: ${errorMsg}`);

      return {
        artifactId,
        target: target as any,
        success: false,
        logs,
        errors,
        durationMs: Date.now() - startTime,
      };
    }
  }

  async preview(artifactId: string, projectDir: string): Promise<ArtifactPreviewInfo> {
    return {
      artifactId,
      type: "local",
      url: "http://localhost:8081",
      qrCode: "exp://192.168.1.100:8081",
    };
  }

  private extractDeployUrl(output: string, target: string): string | undefined {
    const urlMatch = output.match(/https?:\/\/[^\s]+/);
    return urlMatch ? urlMatch[0] : undefined;
  }
}

export function createMobileAppGenerator(typeDef: ArtifactTypeDefinition): MobileAppGenerator {
  return new MobileAppGenerator(typeDef);
}