/**
 * LoginView — full-screen auth gate.
 *
 * Sign in (email + password) / create account. When the backend reports
 * `mfaRequired`, it swaps to the MfaChallenge two-step flow (passkey / TOTP /
 * backup code) and completes the session. A "continue as guest" link keeps the
 * app usable without an account (the app's primary user historically has no
 * accounts row).
 */
import React, { useState, useCallback } from "react";
import { Button, Input, Checkbox } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useAuth, getDeviceFingerprint } from "@/lib/auth";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { haptics } from "@/lib/haptics";
import { Lock, Mail, User, LogIn, UserPlus, Loader2, AlertCircle, Fingerprint } from "lucide-react";

type Mode = "signin" | "signup";

export const LoginView: React.FC = () => {
  const { t } = useI18n();
  const auth = useAuth();

  const [mode, setMode] = useState<Mode>("signin");

  // sign in
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // sign up
  const [displayName, setDisplayName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberDevice, setRememberDevice] = useState(false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const handleSignIn = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || !password) return;
      setBusy(true);
      setError(null);
      const result = await auth.login(email.trim(), password);
      setBusy(false);
      if (!result.ok) {
        setError(result.error || t("auth.signInError"));
        haptics.heavy();
        return;
      }
      haptics.medium();
      // When mfaRequired the LoginView re-renders (isMfaPending) and shows the challenge below.
    },
    [auth, email, password, t],
  );

  const handleSignUp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (password.length < 8) {
        setError(t("auth.passwordMin"));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("auth.passwordsMismatch"));
        return;
      }
      setBusy(true);
      setError(null);
      const result = await auth.register({ email: email.trim(), password, displayName: displayName.trim() || undefined });
      setBusy(false);
      if (!result.ok) {
        setError(result.error || t("auth.signUpError"));
        haptics.heavy();
        return;
      }
      haptics.medium();
    },
    [auth, email, password, confirmPassword, displayName, t],
  );

  // MFA two-step: the API asked for a factor.
  if (auth.isMfaPending && auth.pendingLogin) {
    return (
      <AuthCard>
        <MfaChallenge
          challenge={{
            pendingToken: auth.pendingLogin.pendingToken,
            methods: auth.pendingLogin.methods,
            passkeyCount: auth.pendingLogin.passkeyCount,
            account: auth.pendingLogin.account || { email },
          }}
          rememberDevice={rememberDevice}
          fingerprint={getDeviceFingerprint()}
          onSuccess={async () => {
            const ok = await auth.completeMfa();
            if (!ok) setError(t("auth.mfaRefreshFailed"));
          }}
          onExpired={() => auth.cancelMfa()}
        />
        <label className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(e) => setRememberDevice(e.target.checked)}
            className="w-4 h-4"
          />
          {t("auth.trustDevice")}
        </label>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <div className="text-center mb-6">
        <div className="mx-auto w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-3">
          <Lock className="w-6 h-6 text-accent" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "signin" ? t("auth.signInTitle") : t("auth.signUpTitle")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("app.name")}</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-3">
        {mode === "signup" && (
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("auth.displayName")}
              className="pl-9"
              autoComplete="name"
              maxLength={100}
            />
          </div>
        )}
        <div className="relative">
          <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.email")}
            className="pl-9"
            autoComplete="email"
            required
          />
        </div>
        <div className="relative">
          <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.password")}
            className="pl-9"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
          />
        </div>
        {mode === "signup" && (
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("auth.confirmPassword")}
              className="pl-9"
              autoComplete="new-password"
              required
            />
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : mode === "signin" ? <LogIn className="w-4 h-4 mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
          {mode === "signin" ? t("auth.signInButton") : t("auth.createAccountButton")}
        </Button>
      </form>

      <div className="flex items-center justify-between mt-4 text-sm">
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? t("auth.noAccount") : t("auth.haveAccount")}
        </button>
      </div>

      <div className="mt-6 pt-4 border-t border-border-primary/50">
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 mx-auto"
          onClick={() => { auth.enterGuest(); haptics.light(); }}
        >
          <Fingerprint className="w-4 h-4" />
          {t("auth.guest")}
        </button>
        <p className="text-xs text-muted-foreground/70 text-center mt-1">{t("auth.guestHint")}</p>
      </div>
    </AuthCard>
  );
};

/** Shared card shell with the app's glass-aesthetic background. */
const AuthCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-dvh w-full flex items-center justify-center bg-background text-foreground p-4">
    <div className="w-full max-w-sm glass-strong rounded-2xl p-6 shadow-xl">
      {children}
    </div>
  </div>
);

export default LoginView;