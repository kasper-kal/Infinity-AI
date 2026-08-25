/**
 * PHASE 10 — STORE SUBMISSION AUTOMATION
 *
 * Guided flow for submitting to:
 * - Apple App Store (TestFlight → App Store Connect)
 * - Google Play Store (Internal Testing → Production)
 *
 * Uses EAS CLI (expo application services) for build automation.
 * $0 budget: EAS free tier supports limited builds/month; fallback to local builds.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Store platform
 */
export type StorePlatform = "ios" | "android" | "both";

/**
 * Submission stage
 */
export type SubmissionStage =
  | "prepare"
  | "credentials"
  | "build"
  | "upload"
  | "review"
  | "release"
  | "complete";

/**
 * Build profile
 */
export type BuildProfile = "development" | "preview" | "production";

/**
 * App Store Connect / Play Console credentials
 */
export interface StoreCredentials {
  platform: StorePlatform;
  // iOS
  appleId?: string;
  teamId?: string;
  ascApiKeyId?: string;
  ascApiKeyPath?: string;
  // Android
  googleServiceAccountKey?: string;
  googlePlayTrack?: "internal" | "closed" | "open" | "production";
  // Shared
  bundleIdentifier: string;
  packageName: string;
}

/**
 * EAS Build configuration
 */
export interface EasConfig {
  projectId: string;
  buildProfiles: Record<BuildProfile, EasBuildProfile>;
  submitProfiles: Record<StorePlatform, EasSubmitProfile>;
}

export interface EasBuildProfile {
  developmentClient?: boolean;
  distribution?: "internal" | "store";
  ios?: { resourceClass?: string; simulator?: boolean; image?: string };
  android?: { buildType?: "apk" | "aab"; image?: string; withoutCredentials?: boolean };
}

export interface EasSubmitProfile {
  ios?: { appleId?: string; ascApiKeyPath?: string };
  android?: { serviceAccountKeyPath?: string; track?: string };
}

/**
 * Store submission job
 */
export interface StoreSubmissionJob {
  id: string;
  projectId: string;
  projectName: string;
  platform: StorePlatform;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  stage: SubmissionStage;
  progress: number; // 0-100
  buildProfile: BuildProfile;
  credentials?: StoreCredentials;
  easConfig?: EasConfig;
  logs: SubmissionLogEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  buildUrls: { ios?: string; android?: string };
  error?: string;
}

export interface SubmissionLogEntry {
  timestamp: string;
  stage: SubmissionStage;
  message: string;
  level: "info" | "warn" | "error";
}

/**
 * Generate eas.json configuration
 */
export function generateEasConfig(config: {
  projectId: string;
  projectName: string;
  bundleIdentifier: string;
  packageName: string;
  platform: StorePlatform;
  buildProfile: BuildProfile;
  credentials?: StoreCredentials;
}): string {
  const easConfig: EasConfig = {
    projectId: config.projectId,
    buildProfiles: {
      development: {
        developmentClient: true,
        distribution: "internal",
      },
      preview: {
        distribution: "internal",
      },
      production: {
        distribution: "store",
      },
    },
    submitProfiles: {
      ios: config.platform === "ios" || config.platform === "both" ? {
        appleId: config.credentials?.appleId,
        ascApiKeyPath: config.credentials?.ascApiKeyPath,
      } : undefined,
      android: config.platform === "android" || config.platform === "both" ? {
        serviceAccountKeyPath: config.credentials?.googleServiceAccountKey,
        track: config.credentials?.googlePlayTrack ?? "internal",
      } : undefined,
    },
  };

  return JSON.stringify({
    cli: { version: ">= 5.0.0" },
    build: easConfig.buildProfiles,
    submit: easConfig.submitProfiles,
  }, null, 2);
}

/**
 * Generate the guided submission checklist
 */
export function generateSubmissionChecklist(job: StoreSubmissionJob): string[] {
  const checks: string[] = [];

  if (job.platform === "ios" || job.platform === "both") {
    checks.push("iOS: Bundle identifier registered in App Store Connect");
    checks.push("iOS: App icons (all sizes) generated");
    checks.push("iOS: Launch screens configured");
    checks.push("iOS: Privacy descriptions in Info.plist (camera, location, etc.)");
    checks.push("iOS: App Store Connect metadata (description, keywords, screenshots)");
    checks.push("iOS: App Store Connect API key configured (ASC API Key + Issuer ID)");
    checks.push("iOS: TestFlight build processing complete");
    checks.push("iOS: Export compliance confirmed");
    checks.push("iOS: Age rating completed");
  }

  if (job.platform === "android" || job.platform === "both") {
    checks.push("Android: Package name reserved in Play Console");
    checks.push("Android: App icons (all densities) generated");
    checks.push("Android: Feature graphic & screenshots uploaded");
    checks.push("Android: Content rating questionnaire completed");
    checks.push("Android: Target audience & content section filled");
    checks.push("Android: Data safety form completed");
    checks.push("Android: Google Play service account key configured");
    checks.push("Android: App signing key uploaded / Play App Signing enabled");
    checks.push("Android: Release track selected (internal/closed/open/production)");
  }

  checks.push("All: Version code / build number incremented");
  checks.push("All: Changelog / release notes prepared");
  checks.push("All: Privacy policy URL accessible");
  checks.push("All: Support URL / contact email accessible");

  return checks;
}

/**
 * Create a new store submission job
 */
export function createStoreSubmissionJob(params: {
  projectId: string;
  projectName: string;
  platform: StorePlatform;
  buildProfile: BuildProfile;
  credentials?: StoreCredentials;
  easConfig?: EasConfig;
}): StoreSubmissionJob {
  return {
    id: randomUUID(),
    projectId: params.projectId,
    projectName: params.projectName,
    platform: params.platform,
    status: "pending",
    stage: "prepare",
    progress: 0,
    buildProfile: params.buildProfile,
    credentials: params.credentials,
    easConfig: params.easConfig,
    logs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    buildUrls: {},
  };
}

/**
 * Update job stage and progress
 */
export function updateJobStage(
  job: StoreSubmissionJob,
  stage: SubmissionStage,
  progress: number,
  message: string,
): StoreSubmissionJob {
  const entry: SubmissionLogEntry = {
    timestamp: new Date().toISOString(),
    stage,
    message,
    level: "info",
  };
  return {
    ...job,
    stage,
    progress: Math.max(0, Math.min(100, progress)),
    logs: [...job.logs, entry],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mark job as failed
 */
export function failJob(job: StoreSubmissionJob, error: string): StoreSubmissionJob {
  return {
    ...job,
    status: "failed",
    stage: "prepare",
    progress: 0,
    error,
    logs: [
      ...job.logs,
      { timestamp: new Date().toISOString(), stage: job.stage, message: error, level: "error" },
    ],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mark job as completed
 */
export function completeJob(job: StoreSubmissionJob, buildUrls: { ios?: string; android?: string }): StoreSubmissionJob {
  return {
    ...job,
    status: "completed",
    stage: "complete",
    progress: 100,
    buildUrls,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Generate the EAS CLI commands for a submission
 */
export function generateEasCommands(job: StoreSubmissionJob): string[] {
  const cmds: string[] = [];

  // Install EAS CLI if needed
  cmds.push("# Install EAS CLI (one-time)");
  cmds.push("npm install -g eas-cli@latest");

  // Login
  cmds.push("\n# Login to Expo account");
  cmds.push("eas login");

  // Configure project
  cmds.push("\n# Initialize EAS in project (run in mobile project root)");
  cmds.push(`eas init --id ${job.easConfig?.projectId ?? "<project-id>"}`);

  // Configure credentials
  if (job.platform === "ios" || job.platform === "both") {
    cmds.push("\n# Configure iOS credentials");
    cmds.push("eas credentials --platform ios");
    if (job.credentials?.appleId) {
      cmds.push(`# Apple ID: ${job.credentials.appleId}`);
    }
    if (job.credentials?.teamId) {
      cmds.push(`# Team ID: ${job.credentials.teamId}`);
    }
  }

  if (job.platform === "android" || job.platform === "both") {
    cmds.push("\n# Configure Android credentials");
    cmds.push("eas credentials --platform android");
    if (job.credentials?.googleServiceAccountKey) {
      cmds.push("# Service account key will be uploaded");
    }
  }

  // Build
  cmds.push(`\n# Build for ${job.buildProfile}`);
  if (job.platform === "ios" || job.platform === "both") {
    cmds.push(`eas build --platform ios --profile ${job.buildProfile}`);
  }
  if (job.platform === "android" || job.platform === "both") {
    cmds.push(`eas build --platform android --profile ${job.buildProfile}`);
  }

  // Submit
  cmds.push("\n# Submit to stores");
  if (job.platform === "ios" || job.platform === "both") {
    cmds.push(`eas submit --platform ios --profile ${job.buildProfile}`);
  }
  if (job.platform === "android" || job.platform === "both") {
    cmds.push(`eas submit --platform android --profile ${job.buildProfile}`);
  }

  return cmds;
}

/**
 * Generate eas.json file content for the mobile project
 */
export async function writeEasConfig(projectPath: string, config: Parameters<typeof generateEasConfig>[0]): Promise<void> {
  const easJson = generateEasConfig(config);
  await fs.writeFile(path.join(projectPath, "eas.json"), easJson, "utf-8");
}

/**
 * Generate store submission guide markdown
 */
export function generateSubmissionGuide(job: StoreSubmissionJob): string {
  const checklist = generateSubmissionChecklist(job);
  const commands = generateEasCommands(job);

  return `# Store Submission Guide for ${job.projectName}

## Overview
- **Project**: ${job.projectName} (${job.projectId})
- **Platform**: ${job.platform.toUpperCase()}
- **Build Profile**: ${job.buildProfile}
- **Created**: ${new Date(job.createdAt).toLocaleString()}

## Pre-Submission Checklist
${checklist.map((c, i) => `${i + 1}. [ ] ${c}`).join("\n")}

## EAS CLI Commands
Run these commands in your mobile project root:
\`\`\`bash
${commands.join("\n")}
\`\`\`

## Platform-Specific Notes

### iOS (App Store Connect)
1. Create app record in App Store Connect with bundle ID: ${job.credentials?.bundleIdentifier ?? "<bundle-id>"}
2. Configure App Store Connect API Key (Users & Access → Keys)
3. Upload icons, screenshots, and metadata
4. TestFlight: Add internal/external testers
5. Submit for review when ready

### Android (Play Console)
1. Create app in Play Console with package name: ${job.credentials?.packageName ?? "<package-name>"}
2. Set up Play App Signing (recommended)
3. Upload service account key for EAS submit
4. Complete all store listing sections
5. Select release track: ${job.credentials?.googlePlayTrack ?? "internal"}
6. Roll out to selected track

## Troubleshooting
- **Build fails**: Check EAS build logs for specific errors
- **Credentials error**: Run \`eas credentials\` to reconfigure
- **Upload fails**: Verify API keys and permissions
- **Review rejection**: Address feedback in resolution center

## Free Tier Limits (EAS)
- 30 builds/month (iOS + Android combined)
- 30 minutes max build time
- 2 concurrent builds
- Unlimited internal distribution

---

*Generated by Infinity Build — ${new Date().toISOString()}*
`;
}