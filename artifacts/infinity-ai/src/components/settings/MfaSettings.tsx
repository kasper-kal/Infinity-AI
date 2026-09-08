/**
 * MfaSettings — Phase 42: Passkeys + TOTP management panel.
 *
 * Rendered inside the Settings Security tab. Uses the useMfa hook to manage
 * passkeys, TOTP authenticator setup (QR + confirm), single-use backup codes,
 * and trusted devices. All calls are cookie-authenticated.
 */
import React, { useState, useCallback, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Input,
  Badge,
  Separator,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui";
import {
  Shield,
  Fingerprint,
  Smartphone,
  KeyRound,
  Plus,
  Trash2,
  Pencil,
  Copy,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMfa, type MfaPasskey, type MfaStatus } from "@/hooks/useMfa";

export const MfaSettings: React.FC = () => {
  const { t } = useI18n();
  const mfa = useMfa();

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [passkeys, setPasskeys] = useState<MfaPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // TOTP setup state
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qrCodeDataUrl: string; backupCodes: string[] } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [rotatedCodes, setRotatedCodes] = useState<string[] | null>(null);

  const [renameTarget, setRenameTarget] = useState<MfaPasskey | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MfaPasskey | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [s, pk] = await Promise.all([mfa.fetchStatus(), mfa.listPasskeys()]);
    if (s) setStatus(s);
    setPasskeys(pk);
    setLoading(false);
  }, [mfa]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const showError = (msg: string) => {
    setError(msg);
    setNotice(null);
  };
  const showNotice = (msg: string) => {
    setNotice(msg);
    setError(null);
  };

  // ── Passkey actions ───────────────────────────────────────────────────────
  const handleAddPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    const origin = window.location.origin;
    const rpID = window.location.hostname;
    const err = await mfa.registerPasskey({ origin, rpID });
    setBusy(false);
    if (!err) {
      showNotice(t("mfa.passkeyAdded"));
      await refresh();
    } else {
      showError(err || t("mfa.passkeyAddFailed"));
    }
  }, [mfa, refresh, t]);

  const handleRename = useCallback(async () => {
    if (!renameTarget) return;
    const ok = await mfa.renamePasskey(renameTarget.id, renameValue || renameTarget.name);
    setRenameTarget(null);
    if (ok) {
      showNotice(t("mfa.passkeyRenamed"));
      await refresh();
    } else {
      showError(t("mfa.passkeyRenameFailed"));
    }
  }, [mfa, renameTarget, renameValue, refresh, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const ok = await mfa.deletePasskey(deleteTarget.id);
    setDeleteTarget(null);
    if (ok) {
      showNotice(t("mfa.passkeyDeleted"));
      await refresh();
    } else {
      showError(t("mfa.passkeyDeleteFailed"));
    }
  }, [mfa, deleteTarget, refresh, t]);

  // ── TOTP actions ──────────────────────────────────────────────────────────
  const handleStartSetup = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await mfa.startTotpSetup();
    setBusy(false);
    if (result) {
      setSetup(result);
      setConfirmCode("");
      setShowBackupCodes(false);
      setSetupOpen(true);
    } else {
      showError(t("mfa.totpSetupFailed"));
    }
  }, [mfa, t]);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    const ok = await mfa.confirmTotp(confirmCode);
    setBusy(false);
    if (ok) {
      showNotice(t("mfa.totpEnabled"));
      setSetupOpen(false);
      setSetup(null);
      await refresh();
    } else {
      showError(t("mfa.totpConfirmFailed"));
    }
  }, [mfa, confirmCode, refresh, t]);

  const handleDisableTotp = useCallback(async () => {
    setBusy(true);
    setError(null);
    const err = await mfa.disableTotp();
    setBusy(false);
    if (!err) {
      showNotice(t("mfa.totpDisabled"));
      await refresh();
    } else {
      showError(err || t("mfa.totpDisableFailed"));
    }
  }, [mfa, refresh, t]);

  const handleRotateBackup = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { codes, error: rotateErr } = await mfa.rotateBackupCodes();
    setBusy(false);
    if (codes) {
      setRotatedCodes(codes);
      showNotice(t("mfa.backupRotated"));
      await refresh();
    } else {
      showError(rotateErr || t("mfa.backupRotateFailed"));
    }
  }, [mfa, refresh, t]);

  const handleClearTrusted = useCallback(async () => {
    setBusy(true);
    setError(null);
    const err = await mfa.clearTrustedDevices();
    setBusy(false);
    if (!err) {
      showNotice(t("mfa.trustedCleared"));
    } else {
      showError(err || t("mfa.trustedClearFailed"));
    }
  }, [mfa, t]);

  const copyText = (text: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    showNotice(t("mfa.copied"));
  };

  const totpEnabled = !!status?.totp;
  const passkeySupported = typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {t("mfa.title")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("mfa.description")}</p>
        </div>
        {!loading && (
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {t("common.refresh") || "Refresh"}
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          {notice}
        </div>
      )}

      {/* Status overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Fingerprint className="w-6 h-6 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">{t("mfa.passkeys")}</p>
              <p className="text-xl font-semibold">{status ? status.passkeyCount : "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Smartphone className="w-6 h-6 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">{t("mfa.authenticatorApp")}</p>
              <Badge variant={totpEnabled ? "secondary" : "outline"} className="mt-1">
                {totpEnabled ? t("mfa.enabled") : t("mfa.disabled")}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <KeyRound className="w-6 h-6 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">{t("mfa.backupCodes")}</p>
              <p className="text-xl font-semibold">{status ? status.backupCodeCount : "—"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Passkeys */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Fingerprint className="w-4 h-4" />
                {t("mfa.passkeysTitle")}
              </CardTitle>
              <CardDescription>{t("mfa.passkeysDesc")}</CardDescription>
            </div>
            <Button onClick={handleAddPasskey} disabled={busy || !passkeySupported}>
              <Plus className="w-4 h-4 mr-2" />
              {t("mfa.addPasskey")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!passkeySupported ? (
            <p className="text-sm text-muted-foreground">{t("mfa.passkeyUnsupported")}</p>
          ) : passkeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("mfa.noPasskeys")}</p>
          ) : (
            <div className="space-y-2">
              {passkeys.map((pk) => (
                <div key={pk.id} className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated/50">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{pk.name}</p>
                    <p className="text-xs text-muted-foreground truncate font-mono">{pk.credentialId.slice(0, 20)}…</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => { setRenameTarget(pk); setRenameValue(pk.name); }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(pk)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("mfa.deletePasskeyTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>{t("mfa.deletePasskeyDesc")}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDelete}>{t("common.confirm")}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* TOTP */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="w-4 h-4" />
                {t("mfa.authenticatorApp")}
              </CardTitle>
              <CardDescription>{t("mfa.totpDesc")}</CardDescription>
            </div>
            {totpEnabled ? (
              <Button variant="danger" onClick={handleDisableTotp} disabled={busy}>
                {t("mfa.disable")}
              </Button>
            ) : (
              <Button onClick={handleStartSetup} disabled={busy}>
                <Plus className="w-4 h-4 mr-2" />
                {t("mfa.setup")}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Backup codes */}
      {totpEnabled && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4" />
                  {t("mfa.backupCodes")}
                </CardTitle>
                <CardDescription>{t("mfa.backupDesc")}</CardDescription>
              </div>
              <Button variant="outline" onClick={handleRotateBackup} disabled={busy}>
                {t("mfa.rotateBackup")}
              </Button>
            </div>
          </CardHeader>
          {rotatedCodes && (
            <CardContent>
              <p className="text-sm font-medium mb-2">{t("mfa.newBackupCodes")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {rotatedCodes.map((code, i) => (
                  <div key={code} className="flex items-center justify-between p-2 rounded bg-bg-elevated/50 font-mono text-sm">
                    <span>{code}</span>
                    <Button variant="ghost" size="sm" onClick={() => copyText(code)}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{t("mfa.storeBackup")}</p>
            </CardContent>
          )}
        </Card>
      )}

      {/* Trusted devices */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("mfa.trustedDevices")}</CardTitle>
              <CardDescription>{t("mfa.trustedDevicesDesc")}</CardDescription>
            </div>
            <Button variant="outline" onClick={handleClearTrusted} disabled={busy}>
              {t("mfa.clearTrusted")}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* TOTP setup dialog */}
      {setupOpen && setup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-bg-elevated p-6 space-y-4">
            <h3 className="text-lg font-semibold">{t("mfa.totpSetupTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("mfa.totpSetupInstructions")}</p>

            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrCodeDataUrl} alt="QR code" className="w-48 h-48 rounded-lg" />
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("mfa.manualEntry")}</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={setup.secret} className="font-mono text-xs" />
                <Button variant="ghost" size="sm" onClick={() => copyText(setup.secret)}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("mfa.enterCode")}</p>
              <Input
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                maxLength={6}
                className="font-mono text-center text-lg tracking-widest"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSetupOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleConfirm} disabled={busy || confirmCode.length < 6}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {t("mfa.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-bg-elevated p-6 space-y-4">
            <h3 className="text-lg font-semibold">{t("mfa.renamePasskey")}</h3>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t("mfa.passkeyNamePlaceholder")}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleRename} disabled={!renameValue.trim()}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MfaSettings;
