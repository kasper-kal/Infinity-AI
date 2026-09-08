/**
 * AccountSettings — Settings panel for profile, password, and active sessions.
 *
 * Appears under the "account" section in SettingsView and is also reachable
 * via the AccountMenu header dropdown.
 */
import React, { useState, useCallback } from "react";
import { Button, Input, Card, Alert } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import { User, Lock, AlertCircle, CheckCircle, Loader2, Shield, Trash2 } from "lucide-react";

export const AccountSettings: React.FC = () => {
  const auth = useAuth();
  const { t } = useI18n();

  /* ── Profile ── */
  const [displayName, setDisplayName] = useState(auth.account?.displayName || "");
  const [email, setEmail] = useState(auth.account?.email || "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileResult, setProfileResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleProfileSave = useCallback(async () => {
    setProfileBusy(true);
    setProfileResult(null);
    const res = await auth.updateProfile({
      displayName: displayName.trim() || undefined,
      email: email.trim() !== auth.account?.email ? email.trim() : undefined,
    });
    setProfileBusy(false);
    setProfileResult(res.ok ? { ok: true, msg: t("auth.profileUpdated") } : { ok: false, msg: res.error || t("auth.profileError") });
    haptics[res.ok ? "medium" : "heavy"]();
  }, [auth, displayName, email, t]);

  /* ── Password ── */
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwResult, setPwResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handlePasswordChange = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      setPwResult({ ok: false, msg: t("auth.passwordsMismatch") });
      return;
    }
    if (newPassword.length < 8) {
      setPwResult({ ok: false, msg: t("auth.passwordMin") });
      return;
    }
    setPwBusy(true);
    setPwResult(null);
    const res = await auth.changePassword(currentPassword, newPassword);
    setPwBusy(false);
    if (res.ok) {
      setPwResult({ ok: true, msg: t("auth.passwordChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setPwResult({ ok: false, msg: res.error || t("auth.passwordError") });
    }
    haptics[res.ok ? "medium" : "heavy"]();
  }, [auth, currentPassword, newPassword, confirmPassword, t]);

  /* ── Sessions ── */
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeResult, setRevokeResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleRevokeSessions = useCallback(async () => {
    setRevokeBusy(true);
    setRevokeResult(null);
    const ok = await auth.revokeAllSessions();
    setRevokeBusy(false);
    setRevokeResult(
      ok
        ? { ok: true, msg: t("auth.sessionsRevoked") }
        : { ok: false, msg: t("auth.sessionRevokeError") },
    );
    haptics[ok ? "medium" : "heavy"]();
  }, [auth, t]);

  if (!auth.account) return null;

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">{t("auth.profile")}</h3>

      {/* Profile card */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="w-4 h-4" />
          {t("auth.email")}: {auth.account.email}
        </div>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("auth.displayName")}
          maxLength={100}
        />
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.email")}
        />
        <ResultBanner result={profileResult} />
        <Button onClick={handleProfileSave} disabled={profileBusy || (!displayName.trim() && email.trim() === auth.account.email)}>
          {profileBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {t("common.save")}
        </Button>
      </Card>

      {/* Password card */}
      <h3 className="text-lg font-semibold pt-2">{t("auth.changePassword")}</h3>
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="w-4 h-4" />
          {t("auth.changePassword")}
        </div>
        <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={t("auth.currentPassword")} autoComplete="current-password" />
        <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("auth.newPassword")} autoComplete="new-password" minLength={8} />
        <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t("auth.confirmPassword")} autoComplete="new-password" />
        <ResultBanner result={pwResult} />
        <Button onClick={handlePasswordChange} disabled={pwBusy || !currentPassword || !newPassword}>
          {pwBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {t("auth.changePassword")}
        </Button>
      </Card>

      {/* Sessions card */}
      <h3 className="text-lg font-semibold pt-2">{t("auth.sessions")}</h3>
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="w-4 h-4" />
          {t("auth.sessionsDescription")}
        </div>
        <ResultBanner result={revokeResult} />
        <Button variant="danger" onClick={handleRevokeSessions} disabled={revokeBusy}>
          {revokeBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
          {t("auth.revokeAllSessions")}
        </Button>
      </Card>
    </div>
  );
};

/** Inline result banner (success/error). */
const ResultBanner: React.FC<{ result: { ok: boolean; msg: string } | null }> = ({ result }) => {
  if (!result) return null;
  return (
    <div className={`flex items-center gap-2 p-2 rounded text-sm ${result.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
      {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
      {result.msg}
    </div>
  );
};

export default AccountSettings;