"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/card";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs } from "@/components/ui/Tabs";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface StoreSubmission {
  id: string;
  platform: string;
  stage: string;
  status: string;
  progress: number;
  buildProfile: string;
  credentials: Record<string, unknown>;
  easConfig: Record<string, unknown>;
  buildUrls: Record<string, string>;
  logs: Array<{ timestamp: string; stage: string; message: string; level: string }>;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface MobileSubmitTabProps {
  app: {
    id: string;
    appName: string;
    bundleIdentifier: string;
    packageName: string;
    platform: "ios" | "android" | "both";
    expoProjectId?: string;
    version: string;
    buildNumber: number;
  };
  submissions: StoreSubmission[];
  onCreateSubmission: (submissionData: Partial<StoreSubmission>) => void;
  loading: boolean;
}

export const MobileSubmitTab: React.FC<MobileSubmitTabProps> = ({
  app,
  submissions,
  onCreateSubmission,
  loading,
}) => {
  const { t } = useI18n();
  const [activeSubTab, setActiveSubTab] = useState<"create" | "history" | "credentials">("create");
  const [submissionForm, setSubmissionForm] = useState({
    platform: app.platform === "both" ? "ios" : app.platform,
    buildProfile: "production",
    credentials: {} as Record<string, string>,
    autoIncrementBuild: true,
    submitForReview: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const platforms = [
    { value: "ios", label: "iOS App Store" },
    { value: "android", label: "Google Play Store" },
  ];

  const buildProfiles = [
    { value: "production", label: "Production" },
    { value: "preview", label: "Preview" },
    { value: "development", label: "Development" },
  ];

  const iosCredentialFields = [
    { key: "appleId", label: "Apple ID", type: "email", required: true },
    { key: "appleTeamId", label: "Apple Team ID", type: "text", required: true },
    { key: "ascAppId", label: "App Store Connect App ID", type: "text", required: false },
    { key: "distributionCert", label: "Distribution Certificate (.p12)", type: "file", required: true },
    { key: "distributionCertPassword", label: "Certificate Password", type: "password", required: true },
    { key: "provisioningProfile", label: "Provisioning Profile (.mobileprovision)", type: "file", required: true },
  ];

  const androidCredentialFields = [
    { key: "serviceAccountKey", label: "Google Play Service Account Key (JSON)", type: "textarea", required: true },
    { key: "keystore", label: "Keystore File (.jks/.keystore)", type: "file", required: true },
    { key: "keystorePassword", label: "Keystore Password", type: "password", required: true },
    { key: "keyAlias", label: "Key Alias", type: "text", required: true },
    { key: "keyPassword", label: "Key Password", type: "password", required: true },
  ];

  const currentCredentialFields = submissionForm.platform === "ios" ? iosCredentialFields : androidCredentialFields;

  const handleCredentialChange = (key: string, value: string) => {
    setSubmissionForm((prev) => ({
      ...prev,
      credentials: { ...prev.credentials, [key]: value },
    }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const validateCredentials = () => {
    const newErrors: Record<string, string> = {};
    currentCredentialFields.forEach((field) => {
      if (field.required && !submissionForm.credentials[field.key]) {
        newErrors[field.key] = "Required";
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCredentials()) return;

    setSubmitting(true);
    try {
      await onCreateSubmission({
        platform: submissionForm.platform,
        buildProfile: submissionForm.buildProfile,
        credentials: submissionForm.credentials,
      });
      setSubmissionForm((prev) => ({
        ...prev,
        credentials: {},
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusStyles: Record<string, string> = {
      pending: "bg-muted text-muted-foreground",
      running: "bg-primary/10 text-primary animate-pulse",
      completed: "bg-green-500/10 text-green-500",
      failed: "bg-red-500/10 text-red-500",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyles[status] || statusStyles.pending}`}>
        {status}
      </span>
    );
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <Tabs
        tabs={[
          { id: "create", label: t("mobile.submit.create") },
          { id: "history", label: t("mobile.submit.history") },
          { id: "credentials", label: t("mobile.submit.credentials") },
        ]}
        activeTab={activeSubTab}
        onChange={setActiveSubTab}
      />

      {/* Create Submission Tab */}
      {activeSubTab === "create" && (
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="font-semibold mb-4">{t("mobile.submit.newSubmission")}</h3>
            <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
              <div className="space-y-2">
                <Label>{t("mobile.platform")}</Label>
                <Select
                  name="platform"
                  value={submissionForm.platform}
                  onChange={(e) => setSubmissionForm((prev) => ({ ...prev, platform: e.target.value, credentials: {} }))}
                  options={platforms.filter((p) =>
                    app.platform === "both" ? true : p.value === app.platform
                  )}
                  className="w-full md:w-64"
                  disabled={app.platform !== "both"}
                />
              </div>

              <div className="space-y-2">
                <Label>Build Profile</Label>
                <Select
                  name="buildProfile"
                  value={submissionForm.buildProfile}
                  onChange={(e) => setSubmissionForm((prev) => ({ ...prev, buildProfile: e.target.value }))}
                  options={buildProfiles}
                  className="w-full md:w-64"
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    name="autoIncrementBuild"
                    checked={submissionForm.autoIncrementBuild}
                    onChange={(e) => setSubmissionForm((prev) => ({ ...prev, autoIncrementBuild: e.target.checked }))}
                  />
                  <span className="text-sm">Auto-increment build number</span>
                </Label>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    name="submitForReview"
                    checked={submissionForm.submitForReview}
                    onChange={(e) => setSubmissionForm((prev) => ({ ...prev, submitForReview: e.target.checked }))}
                  />
                  <span className="text-sm">Submit for review immediately (iOS only)</span>
                </Label>
              </div>

              <div className="pt-4 border-t border-border">
                <h4 className="font-medium mb-3">{t("mobile.submit.credentials")}</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  {submissionForm.platform === "ios"
                    ? "Enter your Apple Developer credentials. These are encrypted and stored securely."
                    : "Enter your Google Play credentials. Service account key must have Release Manager permissions."}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentCredentialFields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <Label htmlFor={field.key}>{field.label} {field.required && <span className="text-red-500">*</span>}</Label>
                      {field.type === "textarea" ? (
                        <Textarea
                          id={field.key}
                          name={field.key}
                          value={submissionForm.credentials[field.key] || ""}
                          onChange={(e) => handleCredentialChange(field.key, e.target.value)}
                          placeholder={`Enter ${field.label.toLowerCase()}`}
                          error={errors[field.key]}
                          rows={4}
                        />
                      ) : field.type === "file" ? (
                        <Input
                          id={field.key}
                          name={field.key}
                          type="file"
                          accept={field.key.includes("Cert") ? ".p12" : field.key.includes("Profile") ? ".mobileprovision" : ".jks,.keystore"}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = () => handleCredentialChange(field.key, reader.result as string);
                              reader.readAsDataURL(file);
                            }
                          }}
                          error={errors[field.key]}
                        />
                      ) : (
                        <Input
                          id={field.key}
                          name={field.key}
                          type={field.type}
                          value={submissionForm.credentials[field.key] || ""}
                          onChange={(e) => handleCredentialChange(field.key, e.target.value)}
                          placeholder={`Enter ${field.label.toLowerCase()}`}
                          error={errors[field.key]}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button type="button" variant="ghost" onClick={() => setSubmissionForm((prev) => ({ ...prev, credentials: {} }))} disabled={submitting}>
                  {t("common.clear")}
                </Button>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? t("mobile.submitting") : t("mobile.submit")}
                </Button>
              </div>
            </form>
          </Card>

          {/* Checklist */}
          <Card className="p-4">
            <h3 className="font-semibold mb-3">{t("mobile.submit.checklist")}</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-green-500">✓ {t("mobile.submit.checklist.appSigned")}</li>
              <li className="flex items-center gap-2 text-green-500">✓ {t("mobile.submit.checklist.versionBump")}</li>
              <li className="flex items-center gap-2 text-green-500">✓ {t("mobile.submit.checklist.assetsReady")}</li>
              <li className="flex items-center gap-2 text-green-500">✓ {t("mobile.submit.checklist.privacyPolicy")}</li>
              <li className="flex items-center gap-2 text-muted-foreground">○ {t("mobile.submit.checklist.reviewGuidelines")}</li>
              <li className="flex items-center gap-2 text-muted-foreground">○ {t("mobile.submit.checklist.testFlight")}</li>
            </ul>
          </Card>
        </div>
      )}

      {/* History Tab */}
      {activeSubTab === "history" && (
        <div className="space-y-4">
          {submissions.length === 0 ? (
            <Card className="p-8 text-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-muted-foreground/50 mb-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <h3 className="text-lg font-semibold mb-2">{t("mobile.submit.noSubmissions")}</h3>
              <p className="text-muted-foreground">Create your first submission to see it here.</p>
            </Card>
          ) : (
            submissions.map((sub) => (
              <Card key={sub.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        sub.platform === "ios" ? "bg-primary/10 text-primary" : "bg-green-500/10 text-green-500"
                      }`}>
                        {sub.platform.toUpperCase()}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        sub.buildProfile === "production" ? "bg-orange-500/10 text-orange-500" :
                        sub.buildProfile === "preview" ? "bg-blue-500/10 text-blue-500" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {sub.buildProfile}
                      </span>
                      {getStatusBadge(sub.status)}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                      <span>Build: {sub.progress}%</span>
                      <span>Stage: {sub.stage}</span>
                      <span>Created: {formatDate(sub.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {sub.buildUrls?.ios && (
                      <a href={sub.buildUrls.ios} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                        iOS Build
                      </a>
                    )}
                    {sub.buildUrls?.android && (
                      <a href={sub.buildUrls.android} target="_blank" rel="noopener noreferrer" className="text-sm text-green-500 hover:underline">
                        Android Build
                      </a>
                    )}
                    {sub.error && (
                      <span className="text-sm text-red-500 max-w-xs truncate" title={sub.error}>
                        Error: {sub.error}
                      </span>
                    )}
                  </div>
                </div>

                {sub.logs.length > 0 && (
                  <details className="mt-4">
                    <summary className="text-sm text-muted-foreground cursor-pointer">Show logs ({sub.logs.length})</summary>
                    <div className="mt-2 p-3 bg-black/20 rounded font-mono text-xs overflow-auto max-h-48 space-y-1">
                      {sub.logs.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className={`flex gap-2 ${
                          log.level === "error" ? "text-red-300" :
                          log.level === "warn" ? "text-yellow-300" : "text-green-300"
                        }`}>
                          <span className="text-muted-foreground shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0">{log.stage}</span>
                          <span className="break-all flex-1">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {/* Credentials Tab */}
      {activeSubTab === "credentials" && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">{t("mobile.submit.manageCredentials")}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Credentials are stored encrypted per project. Only you can access them.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-border">
              <h4 className="font-medium mb-2">iOS Credentials</h4>
              <p className="text-sm text-muted-foreground mb-3">Apple Developer account, certificates, provisioning profiles</p>
              <Button variant="outline" size="sm">Manage</Button>
            </div>
            <div className="p-4 rounded-lg border border-border">
              <h4 className="font-medium mb-2">Android Credentials</h4>
              <p className="text-sm text-muted-foreground mb-3">Google Play service account, keystore, key passwords</p>
              <Button variant="outline" size="sm">Manage</Button>
            </div>
            <div className="p-4 rounded-lg border border-border">
              <h4 className="font-medium mb-2">Expo Credentials</h4>
              <p className="text-sm text-muted-foreground mb-3">EAS project linking, build secrets, environment variables</p>
              <Button variant="outline" size="sm">Manage</Button>
            </div>
            <div className="p-4 rounded-lg border border-border">
              <h4 className="font-medium mb-2">App Store Connect</h4>
              <p className="text-sm text-muted-foreground mb-3">API keys for TestFlight and App Store automation</p>
              <Button variant="outline" size="sm">Manage</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};