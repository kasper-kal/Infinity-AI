/**
 * MfaChallenge — Phase 42: two-step login challenge.
 *
 * Drop-in component for any login surface. When a password login returns
 * `{ mfaRequired: true, pendingToken, methods }`, render this component to
 * finish the second factor (passkey / TOTP / backup code).
 *
 * Usage:
 *   const login = await fetch('/api/auth/login', { method:'POST', body });
 *   const data = await login.json();
 *   if (data.mfaRequired) setChallenge(data); // render <MfaChallenge .../>
 *   else // logged in
 */
import React, { useState, useCallback } from "react";
import { Button, Input, Badge } from "@/components/ui";
import { Fingerprint, Smartphone, KeyRound, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMfa } from "@/hooks/useMfa";

export interface MfaChallengeData {
  pendingToken: string;
  methods: string[]; // 'passkey' | 'totp' | 'backup'
  passkeyCount?: number;
  account?: { email?: string; displayName?: string };
}

interface MfaChallengeProps {
  challenge: MfaChallengeData;
  /** Called when the second factor succeeds (session cookie is now set). */
  onSuccess: () => void;
  /** Called when the pending login expires or fails irrecoverably. */
  onExpired?: () => void;
  rememberDevice?: boolean;
  fingerprint?: string;
}

const METHOD_ICONS: Record<string, React.ReactNode> = {
  passkey: <Fingerprint className="w-5 h-5" />,
  totp: <Smartphone className="w-5 h-5" />,
  backup: <KeyRound className="w-5 h-5" />,
};

export const MfaChallenge: React.FC<MfaChallengeProps> = ({
  challenge,
  onSuccess,
  onExpired,
  rememberDevice = false,
  fingerprint = "",
}) => {
  const { t } = useI18n();
  const mfa = useMfa();

  const [mode, setMode] = useState<"select" | "passkey" | "totp" | "backup">(
    challenge.methods[0] === "passkey" ? "passkey" : "select",
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(
    (ok: boolean, msg: string) => {
      setBusy(false);
      if (ok) {
        onSuccess();
      } else {
        setError(msg);
      }
    },
    [onSuccess],
  );

  const handlePasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await mfa.authenticateWithPasskey(challenge.pendingToken, {
      origin: window.location.origin,
      rpID: window.location.hostname,
      rememberDevice,
      fingerprint,
    });
    finish(res.success, t("mfa.passkeyFailed"));
  }, [mfa, challenge.pendingToken, rememberDevice, fingerprint, finish, t]);

  const handleTotp = useCallback(async () => {
    if (code.length < 6) return;
    setBusy(true);
    setError(null);
    const ok = await mfa.verifyTotpCode(challenge.pendingToken, code, { rememberDevice, fingerprint });
    finish(ok, t("mfa.totpInvalid"));
  }, [mfa, challenge.pendingToken, code, rememberDevice, fingerprint, finish, t]);

  const handleBackup = useCallback(async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const ok = await mfa.verifyBackupCode(challenge.pendingToken, code, { rememberDevice, fingerprint });
    finish(ok, t("mfa.backupInvalid"));
  }, [mfa, challenge.pendingToken, code, rememberDevice, fingerprint, finish, t]);

  const back = () => {
    setMode("select");
    setError(null);
    setCode("");
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-2">
          <ShieldCheck className="w-6 h-6 text-accent" />
        </div>
        <h3 className="text-lg font-semibold">{t("mfa.challengeTitle")}</h3>
        {challenge.account?.email && (
          <p className="text-sm text-muted-foreground">{challenge.account.email}</p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {mode === "select" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("mfa.chooseMethod")}</p>
          {challenge.methods.map((m) => (
            <Button
              key={m}
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={() => setMode(m as "passkey" | "totp" | "backup")}
            >
              {METHOD_ICONS[m]}
              {m === "passkey" ? t("mfa.usePasskey") : m === "totp" ? t("mfa.useTotp") : t("mfa.useBackup")}
              {m === "passkey" && challenge.passkeyCount ? (
                <Badge variant="outline" className="ml-auto">{challenge.passkeyCount}</Badge>
              ) : null}
            </Button>
          ))}
        </div>
      )}

      {mode === "passkey" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("mfa.tapPasskey")}</p>
          <Button className="w-full" onClick={handlePasskey} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Fingerprint className="w-4 h-4 mr-2" />}
            {busy ? t("mfa.waiting") : t("mfa.authenticate")}
          </Button>
          {challenge.methods.length > 1 && (
            <Button variant="ghost" className="w-full" onClick={back} disabled={busy}>
              {t("mfa.otherMethod")}
            </Button>
          )}
        </div>
      )}

      {mode === "totp" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("mfa.enterTotp")}</p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            inputMode="numeric"
            maxLength={6}
            className="font-mono text-center text-lg tracking-widest"
          />
          <Button className="w-full" onClick={handleTotp} disabled={busy || code.length < 6}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {t("mfa.verify")}
          </Button>
          {challenge.methods.includes("backup") && (
            <Button variant="ghost" className="w-full" onClick={() => setMode("backup")} disabled={busy}>
              {t("mfa.useBackup")}
            </Button>
          )}
        </div>
      )}

      {mode === "backup" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("mfa.enterBackup")}</p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            className="font-mono text-center tracking-widest"
            onKeyDown={(e) => { if (e.key === "Enter") handleBackup(); }}
          />
          <Button className="w-full" onClick={handleBackup} disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {t("mfa.verify")}
          </Button>
          {challenge.methods.includes("totp") && (
            <Button variant="ghost" className="w-full" onClick={() => setMode("totp")} disabled={busy}>
              {t("mfa.useTotp")}
            </Button>
          )}
        </div>
      )}

      {onExpired && (
        <p className="text-center">
          <Button variant="ghost" size="sm" onClick={onExpired}>
            {t("mfa.expired")}
          </Button>
        </p>
      )}
    </div>
  );
};

export default MfaChallenge;
