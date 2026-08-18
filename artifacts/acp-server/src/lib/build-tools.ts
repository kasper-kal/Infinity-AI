/**
 * ACP tool bridge — exposes the file/command/git tool surface that
 * server.ts's MCP tools call, implemented on top of the real api-server
 * workspace helpers. Keeps acp-server decoupled from api-server internals
 * while providing the legacy tool names the protocol expects.
 */
import { eq } from "drizzle-orm";
import { db, projects } from "@workspace/db";
import {
  getWorkspaceRoot,
  listWorkspaceFiles,
  readWorkspaceFileText,
  writeWorkspaceFile,
  deleteWorkspacePath,
  runTerminalCommand,
  runGit,
} from "../../../api-server/src/lib/workspace";

export interface ListFilesArgs { projectId: string; path?: string; }
export interface ReadFileArgs { projectId: string; path: string; }
export interface EditFileArgs { projectId: string; path: string; content: string; }
export interface DeleteFileArgs { projectId: string; path: string; }
export interface RunCommandArgs { projectId: string; command: string; cwd?: string; timeout?: number; }
export interface GitArgs { projectId: string; staged?: boolean; message?: string; addAll?: boolean; }

function rootFor(projectId: string): string {
  return getWorkspaceRoot(projectId);
}

export async function listFiles(args: ListFilesArgs): Promise<{ path: string; name: string; type: string; size: number }[]> {
  await db.select().from(projects).where(eq(projects.id, args.projectId)).limit(1);
  const files = await listWorkspaceFiles(args.projectId);
  const prefix = args.path ? args.path.replace(/^\/+/, "") : "";
  return files
    .filter((f) => !prefix || f.path === prefix || f.path.startsWith(`${prefix}/`))
    .map((f) => ({ path: f.path, name: f.name, type: f.type, size: f.size }));
}

export async function readFile(args: ReadFileArgs): Promise<{ content: string; path: string }> {
  const content = await readWorkspaceFileText(args.path, args.projectId);
  return { content, path: args.path };
}

export async function editFile(args: EditFileArgs): Promise<{ ok: boolean; path: string }> {
  await writeWorkspaceFile(args.path, args.content, args.projectId);
  return { ok: true, path: args.path };
}

export async function deleteFile(args: DeleteFileArgs): Promise<{ ok: boolean; path: string }> {
  await deleteWorkspacePath(args.path, args.projectId);
  return { ok: true, path: args.path };
}

export async function runCommand(args: RunCommandArgs): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const run = await runTerminalCommand("acp", args.command, {
    timeoutMs: args.timeout,
    workspaceId: args.projectId,
  });
  return { stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode, timedOut: run.timedOut };
}

export async function gitStatus(args: GitArgs): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return runGit(rootFor(args.projectId), ["status", "--porcelain"]);
}

export async function gitDiff(args: GitArgs): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const flags = args.staged ? ["diff", "--cached"] : ["diff"];
  return runGit(rootFor(args.projectId), flags);
}

export async function gitCommit(args: GitArgs): Promise<{ ok: boolean; stdout: string }> {
  const root = rootFor(args.projectId);
  if (args.addAll !== false) await runGit(root, ["add", "-A"]);
  const res = await runGit(root, ["commit", "-q", "-m", args.message || "infinity: acp commit"]);
  return { ok: res.ok, stdout: res.stdout };
}
