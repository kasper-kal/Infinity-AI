/**
 * ACP Resources - Project-scoped resources that clients can read
 */

import { type ACPResource, type ACPResourcesReadResult } from "./types";
import { db, projects, buildCheckpoints, projectMemories, projectActivity } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

export async function listResources(projectId: string): Promise<ACPResource[]> {
  const resources: ACPResource[] = [
    // Project info
    {
      uri: `infinity://project/${projectId}`,
      name: "Project Info",
      description: "Basic project information",
      mimeType: "application/json",
    },
    // Build checkpoints
    {
      uri: `infinity://project/${projectId}/builds`,
      name: "Build History",
      description: "Recent build checkpoints",
      mimeType: "application/json",
    },
    // Latest build
    {
      uri: `infinity://project/${projectId}/builds/latest`,
      name: "Latest Build",
      description: "Most recent build checkpoint",
      mimeType: "application/json",
    },
    // Project memory
    {
      uri: `infinity://project/${projectId}/memory`,
      name: "Project Memory",
      description: "All project memory entries",
      mimeType: "application/json",
    },
    // Activity feed
    {
      uri: `infinity://project/${projectId}/activity`,
      name: "Project Activity",
      description: "Recent project activity feed",
      mimeType: "application/json",
    },
  ];

  return resources;
}

export async function readResource(uri: string): Promise<ACPResourcesReadResult> {
  // Parse URI: infinity://project/{projectId}/{resource}
  const match = uri.match(/^infinity:\/\/project\/([^\/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const [, projectId, resourcePath] = match;

  try {
    switch (resourcePath) {
      case "": {
        const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(project, null, 2),
          }],
        };
      }

      case "builds": {
        const builds = await db
          .select()
          .from(buildCheckpoints)
          .where(eq(buildCheckpoints.projectId, projectId))
          .orderBy(desc(buildCheckpoints.createdAt))
          .limit(50);
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(builds, null, 2),
          }],
        };
      }

      case "builds/latest": {
        const [build] = await db
          .select()
          .from(buildCheckpoints)
          .where(eq(buildCheckpoints.projectId, projectId))
          .orderBy(desc(buildCheckpoints.createdAt))
          .limit(1);
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(build || {}, null, 2),
          }],
        };
      }

      case "memory": {
        const memories = await db
          .select()
          .from(projectMemory)
          .where(eq(projectMemory.projectId, projectId))
          .orderBy(desc(projectMemory.updatedAt));
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(memories, null, 2),
          }],
        };
      }

      case "activity": {
        const activity = await db
          .select()
          .from(projectActivity)
          .where(eq(projectActivity.projectId, projectId))
          .orderBy(desc(projectActivity.createdAt))
          .limit(100);
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(activity, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown resource: ${resourcePath}`);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Failed to read resource ${uri}: ${error}`);
  }
}