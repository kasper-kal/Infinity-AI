/**
 * Authentication Integration
 *
 * Unified interface for multiple auth providers (Clerk, Auth.js, Supabase Auth,
 * Firebase Auth, custom JWT). Generates auth guards, login/register forms,
 * protected routes, user profile components, and session management.
 */

import { z } from 'zod';

// ============================================================================
// Auth Provider Types
// ============================================================================

export const AuthProviderSchema = z.enum([
  'clerk',
  'authjs', // NextAuth.js
  'supabase',
  'firebase',
  'custom-jwt',
]);

export const AuthConfigSchema = z.object({
  projectId: z.string().uuid(),
  provider: AuthProviderSchema,
  name: z.string().min(1).max(100),
  publishableKey: z.string().optional(),
  secretKey: z.string().optional(),
  domain: z.string().optional(),
  audience: z.string().optional(),
  redirectUrl: z.string().optional(),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
  options: z.record(z.any()).optional(),
  enabled: z.boolean().default(true),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const GeneratedGuardSchema = z.object({
  name: z.string(),
  code: z.string(),
  type: z.enum(['middleware', 'hook', 'component', 'route']),
});

export const GeneratedFormSchema = z.object({
  name: z.string(),
  code: z.string(),
  type: z.enum(['login', 'register', 'profile']),
});

export type AuthProvider = z.infer<typeof AuthProviderSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type GeneratedGuard = z.infer<typeof GeneratedGuardSchema>;
export type GeneratedForm = z.infer<typeof GeneratedFormSchema>;

// ============================================================================
// Auth Integration Engine
// ============================================================================

export class AuthIntegrationEngine {
  static async saveConfig(config: AuthConfig): Promise<AuthConfig> {
    // In production: store to DB with encrypted secrets
    const id = `auth_${config.projectId}_${config.provider}`;
    const stored: AuthConfig = {
      ...config,
      createdAt: config.createdAt || new Date(),
      updatedAt: new Date(),
    };
    // DB insert would happen here
    return stored;
  }

  static async getConfig(projectId: string, provider: AuthProvider): Promise<AuthConfig | null> {
    return null; // In production: query DB
  }

  // ==========================================================================
  // Guard Generation
  // ==========================================================================

  static generateGuards(config: AuthConfig): GeneratedGuard[] {
    switch (config.provider) {
      case 'clerk':
        return this.generateClerkGuards(config);
      case 'authjs':
        return this.generateAuthJSGuards(config);
      case 'supabase':
        return this.generateSupabaseGuards(config);
      case 'firebase':
        return this.generateFirebaseGuards(config);
      case 'custom-jwt':
        return this.generateCustomJWTGuards(config);
      default:
        return [];
    }
  }

  private static generateClerkGuards(config: AuthConfig): GeneratedGuard[] {
    return [
      {
        name: 'withAuth',
        type: 'middleware',
        code: `import { auth } from '@clerk/nextjs/server';

export async function withAuth(handler: (userId: string) => Promise<Response>) {
  const { userId } = await auth();
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }
  return handler(userId);
}`,
      },
      {
        name: 'RequireAuth',
        type: 'component',
        code: `import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/nextjs';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut><RedirectToSignIn /></SignedOut>
    </>
  );
}`,
      },
      {
        name: 'authMiddleware',
        type: 'middleware',
        code: `import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();`,
      },
    ];
  }

  private static generateAuthJSGuards(config: AuthConfig): GeneratedGuard[] {
    return [
      {
        name: 'withAuth',
        type: 'middleware',
        code: `import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function withAuth(handler: (session: any) => Promise<Response>) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  return handler(session);
}`,
      },
      {
        name: 'useRequireAuth',
        type: 'hook',
        code: `import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function useRequireAuth() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/api/auth/signin');
    }
  }, [status, router]);

  return { session, status };
}`,
      },
    ];
  }

  private static generateSupabaseGuards(config: AuthConfig): GeneratedGuard[] {
    return [
      {
        name: 'withAuth',
        type: 'middleware',
        code: `import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function withAuth(handler: (user: any) => Promise<Response>) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  return handler(user);
}`,
      },
      {
        name: 'RequireAuth',
        type: 'component',
        code: `import { useUser } from '@supabase/auth-helpers-react';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useUser();
  if (!user) {
    return <div>Please sign in</div>;
  }
  return <>{children}</>;
}`,
      },
    ];
  }

  private static generateFirebaseGuards(config: AuthConfig): GeneratedGuard[] {
    return [
      {
        name: 'withAuth',
        type: 'middleware',
        code: `import { getAuth } from 'firebase-admin/auth';
import { initializeApp, cert, getApps } from 'firebase-admin/app';

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS!)) });
}

export async function withAuth(handler: (user: any) => Promise<Response>) {
  const auth = getAuth();
  // In middleware, token comes from Authorization header
  const token = ''; // Extract from request
  try {
    const decoded = await auth.verifyIdToken(token);
    return handler(decoded);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
}`,
      },
      {
        name: 'RequireAuth',
        type: 'component',
        code: `import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '@/lib/firebase';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [user, loading] = useAuthState(auth);
  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Please sign in</div>;
  return <>{children}</>;
}`,
      },
    ];
  }

  private static generateCustomJWTGuards(config: AuthConfig): GeneratedGuard[] {
    return [
      {
        name: 'withAuth',
        type: 'middleware',
        code: `import jwt from 'jsonwebtoken';

export async function withAuth(handler: (payload: any) => Promise<Response>) {
  const token = ''; // Extract from request Authorization header
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    return handler(decoded);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
}`,
      },
      {
        name: 'RequireAuth',
        type: 'hook',
        code: `import { useEffect, useState } from 'react';

export function useRequireAuth() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => { setUser(data); setLoading(false); });
  }, []);

  return { user, loading };
}`,
      },
    ];
  }

  // ==========================================================================
  // Form Generation
  // ==========================================================================

  static generateForms(config: AuthConfig): GeneratedForm[] {
    switch (config.provider) {
      case 'clerk':
        return this.generateClerkForms(config);
      case 'authjs':
        return this.generateAuthJSForms(config);
      case 'supabase':
        return this.generateSupabaseForms(config);
      case 'firebase':
        return this.generateFirebaseForms(config);
      case 'custom-jwt':
        return this.generateCustomJWTForms(config);
      default:
        return [];
    }
  }

  private static generateClerkForms(config: AuthConfig): GeneratedForm[] {
    return [
      {
        name: 'LoginForm',
        type: 'login',
        code: `import { SignIn } from '@clerk/nextjs';

export function LoginForm() {
  return <SignIn routing="path" path="/sign-in" />;
}`,
      },
      {
        name: 'RegisterForm',
        type: 'register',
        code: `import { SignUp } from '@clerk/nextjs';

export function RegisterForm() {
  return <SignUp routing="path" path="/sign-up" />;
}`,
      },
      {
        name: 'UserProfile',
        type: 'profile',
        code: `import { UserProfile } from '@clerk/nextjs';

export function UserProfile() {
  return <UserProfile />;
}`,
      },
    ];
  }

  private static generateAuthJSForms(config: AuthConfig): GeneratedForm[] {
    return [
      {
        name: 'LoginForm',
        type: 'login',
        code: `import { signIn } from 'next-auth/react';
import { useState } from 'react';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn('credentials', { email, password, callbackUrl: '/' });
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign In</button>
    </form>
  );
}`,
      },
      {
        name: 'RegisterForm',
        type: 'register',
        code: `import { useState } from 'react';

export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (res.ok) window.location.href = '/api/auth/signin';
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign Up</button>
    </form>
  );
}`,
      },
    ];
  }

  private static generateSupabaseForms(config: AuthConfig): GeneratedForm[] {
    return [
      {
        name: 'LoginForm',
        type: 'login',
        code: `import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) window.location.href = '/dashboard';
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign In</button>
    </form>
  );
}`,
      },
      {
        name: 'RegisterForm',
        type: 'register',
        code: `import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signUp({ email, password });
    if (!error) window.location.href = '/dashboard';
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign Up</button>
    </form>
  );
}`,
      },
      {
        name: 'UserProfile',
        type: 'profile',
        code: `import { useUser, useSupabaseClient } from '@supabase/auth-helpers-react';

export function UserProfile() {
  const user = useUser();
  const supabase = useSupabaseClient();

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return (
    <div>
      <p>Welcome, {user?.email}</p>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}`,
      },
    ];
  }

  private static generateFirebaseForms(config: AuthConfig): GeneratedForm[] {
    return [
      {
        name: 'LoginForm',
        type: 'login',
        code: `import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = '/dashboard';
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign In</button>
    </form>
  );
}`,
      },
      {
        name: 'RegisterForm',
        type: 'register',
        code: `import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      window.location.href = '/dashboard';
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign Up</button>
    </form>
  );
}`,
      },
    ];
  }

  private static generateCustomJWTForms(config: AuthConfig): GeneratedForm[] {
    return [
      {
        name: 'LoginForm',
        type: 'login',
        code: `import { useState } from 'react';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) window.location.href = '/dashboard';
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign In</button>
    </form>
  );
}`,
      },
      {
        name: 'RegisterForm',
        type: 'register',
        code: `import { useState } from 'react';

export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (res.ok) window.location.href = '/login';
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign Up</button>
    </form>
  );
}`,
      },
    ];
  }

  // ==========================================================================
  // Protected Route Generation
  // ==========================================================================

  static generateProtectedRoute(config: AuthConfig): GeneratedGuard {
    switch (config.provider) {
      case 'clerk':
        return {
          name: 'ProtectedRoute',
          type: 'route',
          code: `import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return new NextResponse('Unauthorized', { status: 401 });
  return NextResponse.json({ message: 'Protected data', userId });
}`,
        };
      case 'supabase':
        return {
          name: 'ProtectedRoute',
          type: 'route',
          code: `import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  return NextResponse.json({ message: 'Protected data', userId: user.id });
}`,
        };
      default:
        return {
          name: 'ProtectedRoute',
          type: 'route',
          code: `import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

export async function GET(request: Request) {
  return withAuth(async (user) => {
    return NextResponse.json({ message: 'Protected data', user });
  });
}`,
        };
    }
  }
}

// ============================================================================
// Validation
// ============================================================================

export function validateAuthConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = AuthConfigSchema.safeParse(config);
  return {
    valid: result.success,
    errors: result.success ? [] : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}