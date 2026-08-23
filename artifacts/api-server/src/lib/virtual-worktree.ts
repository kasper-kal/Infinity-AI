/**
 * VIRTUAL WORKTREE MANAGER — Isolated Filesystem per Agent
 *
 * Enables true parallel agent execution without conflicts.
 * Cross-platform: Node.js (server) + Browser (OPFS + IndexedDB fallback).
 * Pure TypeScript, no external deps beyond `diff` (already in deps).
 */

import { createHash } from "crypto";
import { diffLines, applyPatch, parsePatch } from "diff";

// Browser globals type declarations
declare global {
  interface Window {
    indexedDB: IDBFactory;
  }
  var indexedDB: IDBFactory;
  interface IDBFactory {
    open(name: string, version?: number): IDBOpenDBRequest;
  }
  interface IDBOpenDBRequest extends EventTarget {
    onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => any) | null;
    onsuccess: ((this: IDBOpenDBRequest, ev: Event) => any) | null;
    onerror: ((this: IDBOpenDBRequest, ev: Event) => any) | null;
    result: IDBDatabase;
    error: DOMException | null;
  }
  interface IDBDatabase extends EventTarget {
    createObjectStore(name: string, optionalParameters?: IDBObjectStoreParameters): IDBObjectStore;
    transaction(storeNames: string | string[], mode?: IDBTransactionMode): IDBTransaction;
    objectStoreNames: DOMStringList;
    close(): void;
  }
  interface DOMStringList {
    length: number;
    item(index: number): string | null;
    contains(string: string): boolean;
    [index: number]: string;
  }
  interface IDBObjectStoreParameters {
    keyPath?: string | string[];
    autoIncrement?: boolean;
  }
  interface IDBObjectStore {
    get(key: IDBValidKey): IDBRequest;
    put(value: unknown, key?: IDBValidKey): IDBRequest;
    delete(key: IDBValidKey): IDBRequest;
    getAllKeys(): IDBRequest;
    clear(): IDBRequest;
    createIndex(name: string, keyPath: string | string[], optionalParameters?: IDBIndexParameters): IDBIndex;
  }
  interface IDBRequest extends EventTarget {
    onsuccess: ((this: IDBRequest, ev: Event) => any) | null;
    onerror: ((this: IDBRequest, ev: Event) => any) | null;
    result: unknown;
    error: DOMException | null;
  }
  interface IDBTransaction extends EventTarget {
    objectStore(name: string): IDBObjectStore;
    oncomplete: ((this: IDBTransaction, ev: Event) => any) | null;
    onerror: ((this: IDBTransaction, ev: Event) => any) | null;
    onabort: ((this: IDBTransaction, ev: Event) => any) | null;
  }
  interface IDBIndex {
    get(key: IDBValidKey): IDBRequest;
    getAllKeys(): IDBRequest;
  }
  interface IDBVersionChangeEvent extends Event {
    oldVersion: number;
    newVersion: number | null;
  }
  type IDBTransactionMode = "readonly" | "readwrite" | "versionchange";
  type IDBValidKey = string | number | Date | ArrayBuffer | IDBArrayKey;
  interface IDBArrayKey extends Array<IDBValidKey> {}
  interface IDBIndexParameters {
    unique?: boolean;
    multiEntry?: boolean;
  }
  type BufferSource = ArrayBufferView | ArrayBuffer;
  interface FileSystemDirectoryHandle {
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
  interface FileSystemFileHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<FileSystemWritableFileStream>;
  }
  interface FileSystemWritableFileStream {
    write(data: BufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
  }
  interface FileSystemHandle {
    kind: "file" | "directory";
    name: string;
  }
  interface Navigator {
    storage: StorageManager;
  }
  interface StorageManager {
    getDirectory(): Promise<FileSystemDirectoryHandle>;
  }
}

/**
 * Worktree metadata
 */
export interface WorktreeMeta {
  id: string;
  baseCommit: string;
  createdAt: number;
  updatedAt: number;
  files: Map<string, WorktreeFile>;
  parentId?: string;
}

/**
 * File entry in worktree
 */
export interface WorktreeFile {
  content: string;
  encoding: "utf8" | "base64";
  isBinary: boolean;
  size: number;
  hash: string;
  mode: number; // file permissions
}

/**
 * Diff result
 */
export interface WorktreeDiff {
  worktreeId: string;
  baseCommit: string;
  patches: DiffPatch[];
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface DiffPatch {
  file: string;
  oldMode?: number;
  newMode?: number;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Merge result
 */
export interface MergeResult {
  success: boolean;
  mergedFiles: Map<string, WorktreeFile>;
  conflicts: MergeConflict[];
  newCommit: string;
}

export interface MergeConflict {
  file: string;
  type: "content" | "mode" | "delete-modify" | "add-add";
  ours: WorktreeFile | null;
  theirs: WorktreeFile | null;
  base: WorktreeFile | null;
  mergedContent?: string;
}

/**
 * Configuration
 */
export interface VirtualWorktreeConfig {
  /** Storage backend: "opfs" | "indexeddb" | "memory" | "node" */
  backend?: "opfs" | "indexeddb" | "memory" | "node";
  /** Max worktrees to keep (LRU eviction) */
  maxWorktrees?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Storage backend interface
 */
interface WorktreeStorage {
  init(): Promise<void>;
  get(key: string): Promise<WorktreeMeta | null>;
  set(key: string, value: WorktreeMeta): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * In-memory storage (Node.js fallback / testing)
 */
class MemoryStorage implements WorktreeStorage {
  private store = new Map<string, WorktreeMeta>();

  async init(): Promise<void> {}
  async get(key: string): Promise<WorktreeMeta | null> {
    return this.store.get(key) || null;
  }
  async set(key: string, value: WorktreeMeta): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
  async clear(): Promise<void> {
    this.store.clear();
  }
}

/**
 * IndexedDB storage (browser fallback)
 */
class IndexedDBStorage implements WorktreeStorage {
  private dbName = "infinity-worktrees";
  private storeName = "worktrees";
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (typeof window === "undefined") throw new Error("IndexedDB only available in browser");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async get(key: string): Promise<WorktreeMeta | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as unknown) as WorktreeMeta | null);
      request.onerror = () => reject(request.error);
    });
  }

  async set(key: string, value: WorktreeMeta): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async list(): Promise<string[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * OPFS storage (browser - Origin Private File System)
 */
class OPFSStorage implements WorktreeStorage {
  private root: FileSystemDirectoryHandle | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (typeof window === "undefined") throw new Error("OPFS only available in browser");
    if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) {
      throw new Error("OPFS not supported");
    }
    this.root = await navigator.storage.getDirectory();
    this.initialized = true;
  }

  private async getFileHandle(key: string, create = false): Promise<FileSystemFileHandle> {
    if (!this.initialized) await this.init();
    const dir = this.root!;
    const handle = await dir.getFileHandle(key, { create });
    return handle;
  }

  async get(key: string): Promise<WorktreeMeta | null> {
    try {
      const handle = await this.getFileHandle(key);
      const file = await handle.getFile();
      const text = await file.text();
      return JSON.parse(text, this.reviver);
    } catch {
      return null;
    }
  }

  async set(key: string, value: WorktreeMeta): Promise<void> {
    const handle = await this.getFileHandle(key, true);
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(value, this.replacer));
    await writable.close();
  }

  async delete(key: string): Promise<void> {
    if (!this.initialized) await this.init();
    try {
      await this.root!.removeEntry(key);
    } catch {
      // ignore if not exists
    }
  }

  async list(): Promise<string[]> {
    if (!this.initialized) await this.init();
    const keys: string[] = [];
    for await (const [name] of this.root!.entries()) {
      keys.push(name);
    }
    return keys;
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.init();
    for await (const [name] of this.root!.entries()) {
      await this.root!.removeEntry(name);
    }
  }

  private replacer(key: string, value: unknown): unknown {
    if (value instanceof Map) {
      return { __map: true, entries: Array.from(value.entries()) as [unknown, unknown][] };
    }
    return value;
  }

  private reviver(key: string, value: unknown): unknown {
    if (value && typeof value === "object" && "__map" in value) {
      const obj = value as { __map: boolean; entries: [unknown, unknown][] };
      return new Map(obj.entries);
    }
    return value;
  }
}

/**
 * Node.js filesystem storage (server-side)
 */
class NodeFSStorage implements WorktreeStorage {
  private basePath: string;
  private fs: typeof import("fs/promises");

  constructor(basePath = ".infinity/worktrees") {
    this.basePath = basePath;
    this.fs = require("fs/promises");
  }

  async init(): Promise<void> {
    await this.fs.mkdir(this.basePath, { recursive: true });
  }

  private getPath(key: string): string {
    return `${this.basePath}/${key}.json`;
  }

  async get(key: string): Promise<WorktreeMeta | null> {
    try {
      const text = await this.fs.readFile(this.getPath(key), "utf8");
      return JSON.parse(text, this.reviver);
    } catch {
      return null;
    }
  }

  async set(key: string, value: WorktreeMeta): Promise<void> {
    await this.fs.writeFile(this.getPath(key), JSON.stringify(value, this.replacer), "utf8");
  }

  async delete(key: string): Promise<void> {
    try {
      await this.fs.unlink(this.getPath(key));
    } catch {
      // ignore if not exists
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await this.fs.readdir(this.basePath);
      return files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    const files = await this.list();
    await Promise.all(files.map(f => this.delete(f)));
  }

  private replacer(key: string, value: unknown): unknown {
    if (value instanceof Map) {
      return { __map: true, entries: Array.from(value.entries()) as [unknown, unknown][] };
    }
    return value;
  }

  private reviver(key: string, value: unknown): unknown {
    if (value && typeof value === "object" && "__map" in value) {
      const obj = value as { __map: boolean; entries: [unknown, unknown][] };
      return new Map(obj.entries);
    }
    return value;
  }
}

/**
 * Virtual Worktree Manager
 */
export class VirtualWorktreeManager {
  private storage: WorktreeStorage;
  private config: Required<VirtualWorktreeConfig>;
  private initialized = false;

  constructor(config: VirtualWorktreeConfig = {}) {
    this.config = {
      backend: config.backend || (typeof window === "undefined" ? "node" : "opfs"),
      maxWorktrees: config.maxWorktrees || 50,
      debug: config.debug || false,
    };

    // Initialize appropriate storage backend
    switch (this.config.backend) {
      case "opfs":
        this.storage = new OPFSStorage();
        break;
      case "indexeddb":
        this.storage = new IndexedDBStorage();
        break;
      case "node":
        this.storage = new NodeFSStorage();
        break;
      case "memory":
      default:
        this.storage = new MemoryStorage();
        break;
    }
  }

  /**
   * Initialize the storage backend
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await this.storage.init();
    this.initialized = true;
    this.log("VirtualWorktreeManager initialized with backend:", this.config.backend);
  }

  /**
   * Create a new worktree from a base commit snapshot
   */
  async createWorktree(baseCommit: string, files: Map<string, WorktreeFile>, parentId?: string): Promise<string> {
    await this.init();

    const worktreeId = this.generateId();
    const now = Date.now();

    const meta: WorktreeMeta = {
      id: worktreeId,
      baseCommit,
      createdAt: now,
      updatedAt: now,
      files: new Map(files),
      parentId,
    };

    // Evict old worktrees if at capacity
    await this.evictIfNeeded();

    await this.storage.set(worktreeId, meta);
    this.log(`Created worktree ${worktreeId} from base ${baseCommit.slice(0, 8)} with ${files.size} files`);
    return worktreeId;
  }

  /**
   * Create worktree from a git-like snapshot (object with file paths -> content)
   */
  async createWorktreeFromSnapshot(
    baseCommit: string,
    snapshot: Record<string, string | { content: string; encoding?: "utf8" | "base64"; mode?: number }>,
    parentId?: string
  ): Promise<string> {
    const files = new Map<string, WorktreeFile>();

    for (const [path, value] of Object.entries(snapshot)) {
      let content: string;
      let encoding: "utf8" | "base64" = "utf8";
      let mode = 0o644;

      if (typeof value === "string") {
        content = value;
      } else {
        content = value.content;
        encoding = value.encoding || "utf8";
        mode = value.mode || 0o644;
      }

      const hash = this.hashContent(content);
      files.set(path, {
        content,
        encoding,
        isBinary: encoding === "base64",
        size: content.length,
        hash,
        mode,
      });
    }

    return this.createWorktree(baseCommit, files, parentId);
  }

  /**
   * Apply a unified diff patch to a worktree
   */
  async applyPatch(worktreeId: string, diff: string): Promise<WorktreeMeta> {
    await this.init();

    const meta = await this.storage.get(worktreeId);
    if (!meta) throw new Error(`Worktree ${worktreeId} not found`);

    const patches = parsePatch(diff);
    const newFiles = new Map(meta.files);

    for (const patch of patches) {
      const filePath = patch.oldFileName?.replace(/^a\//, "") || patch.newFileName?.replace(/^b\//, "");
      if (!filePath) continue;

      const oldFile = newFiles.get(filePath);
      const oldContent = oldFile?.content || "";

      try {
        const newContent = applyPatch(oldContent, patch);
        if (newContent === false) {
          throw new Error(`Failed to apply patch to ${filePath}`);
        }

        if (patch.newFileName === "/dev/null") {
          // File deleted
          newFiles.delete(filePath);
        } else {
          const newHash = this.hashContent(newContent);
          newFiles.set(filePath, {
            content: newContent,
            encoding: "utf8",
            isBinary: false,
            size: newContent.length,
            hash: newHash,
            mode: oldFile?.mode || 0o644,
          });
        }
      } catch (err) {
        this.log(`Failed to apply patch to ${filePath}:`, err);
        throw new Error(`Patch application failed for ${filePath}: ${err}`);
      }
    }

    meta.files = newFiles;
    meta.updatedAt = Date.now();
    await this.storage.set(worktreeId, meta);
    this.log(`Applied patch to worktree ${worktreeId}`);
    return meta;
  }

  /**
   * Get unified diff between worktree and base commit
   */
  async getDiff(worktreeId: string, baseCommit?: string): Promise<WorktreeDiff> {
    await this.init();

    const meta = await this.storage.get(worktreeId);
    if (!meta) throw new Error(`Worktree ${worktreeId} not found`);

    const base = baseCommit || meta.baseCommit;
    const patches: DiffPatch[] = [];
    let insertions = 0;
    let deletions = 0;
    let filesChanged = 0;

    // For now, we compute diff against the base commit snapshot
    // In a real implementation, we'd fetch the base commit files
    // Here we just show what's changed in the worktree
    for (const [path, file] of meta.files) {
      // This is a simplified diff - in reality you'd compare against base
      const patch: DiffPatch = {
        file: path,
        isNew: true,
        isDeleted: false,
        isBinary: file.isBinary,
        hunks: [{
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: file.content.split("\n").length,
          lines: file.content.split("\n").map(l => "+" + l),
        }],
      };
      patches.push(patch);
      filesChanged++;
      insertions += patch.hunks[0].newLines;
    }

    return {
      worktreeId,
      baseCommit: base,
      patches,
      stats: { filesChanged, insertions, deletions },
    };
  }

  /**
   * Get diff between two worktrees
   */
  async getDiffBetween(worktreeId1: string, worktreeId2: string): Promise<WorktreeDiff> {
    await this.init();

    const meta1 = await this.storage.get(worktreeId1);
    const meta2 = await this.storage.get(worktreeId2);
    if (!meta1 || !meta2) throw new Error("One or both worktrees not found");

    const patches: DiffPatch[] = [];
    let insertions = 0;
    let deletions = 0;
    let filesChanged = 0;

    const allPaths = new Set([...meta1.files.keys(), ...meta2.files.keys()]);

    for (const path of allPaths) {
      const file1 = meta1.files.get(path);
      const file2 = meta2.files.get(path);

      if (!file1 && file2) {
        // Added in meta2
        patches.push({
          file: path,
          isNew: true,
          isDeleted: false,
          isBinary: file2.isBinary,
          hunks: [{
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: file2.content.split("\n").length,
            lines: file2.content.split("\n").map(l => "+" + l),
          }],
        });
        filesChanged++;
        insertions += file2.content.split("\n").length;
      } else if (file1 && !file2) {
        // Deleted in meta2
        patches.push({
          file: path,
          isNew: false,
          isDeleted: true,
          isBinary: file1.isBinary,
          hunks: [{
            oldStart: 1,
            oldLines: file1.content.split("\n").length,
            newStart: 1,
            newLines: 0,
            lines: file1.content.split("\n").map(l => "-" + l),
          }],
        });
        filesChanged++;
        deletions += file1.content.split("\n").length;
      } else if (file1 && file2 && file1.hash !== file2.hash) {
        // Modified
        const diffResult = diffLines(file1.content, file2.content);
        const hunks: DiffHunk[] = [];
        let oldStart = 1, newStart = 1;

        for (const part of diffResult) {
          if (part.added || part.removed) {
            const lines = part.value.split("\n").filter(Boolean);
            hunks.push({
              oldStart,
              oldLines: part.removed ? lines.length : 0,
              newStart,
              newLines: part.added ? lines.length : 0,
              lines: lines.map(l => (part.added ? "+" : "-") + l),
            });
            if (part.added) {
              insertions += lines.length;
              newStart += lines.length;
            }
            if (part.removed) {
              deletions += lines.length;
              oldStart += lines.length;
            }
          } else {
            oldStart += part.value.split("\n").filter(Boolean).length;
            newStart += part.value.split("\n").filter(Boolean).length;
          }
        }

        if (hunks.length > 0) {
          patches.push({
            file: path,
            isNew: false,
            isDeleted: false,
            isBinary: file2.isBinary,
            hunks,
          });
          filesChanged++;
        }
      }
    }

    return {
      worktreeId: worktreeId2,
      baseCommit: meta1.baseCommit,
      patches,
      stats: { filesChanged, insertions, deletions },
    };
  }

  /**
   * Merge multiple worktrees into target (three-way merge)
   */
  async mergeWorktrees(targetId: string, sourceIds: string[]): Promise<MergeResult> {
    await this.init();

    const target = await this.storage.get(targetId);
    if (!target) throw new Error(`Target worktree ${targetId} not found`);

    const sources = await Promise.all(sourceIds.map(id => this.storage.get(id)));
    if (sources.some(s => !s)) throw new Error("One or more source worktrees not found");

    const mergedFiles = new Map<string, WorktreeFile>(target.files);
    const conflicts: MergeConflict[] = [];

    for (const source of sources) {
      for (const [path, sourceFile] of source!.files) {
        const targetFile = mergedFiles.get(path);
        const baseFile = target.files.get(path); // Using target's base as common ancestor

        if (!targetFile) {
          // New file in source
          mergedFiles.set(path, sourceFile);
        } else if (targetFile.hash !== sourceFile.hash) {
          // Conflict - both modified
          if (targetFile.hash === baseFile?.hash) {
            // Target unchanged, take source
            mergedFiles.set(path, sourceFile);
          } else if (sourceFile.hash === baseFile?.hash) {
            // Source unchanged, keep target
          } else {
            // Both changed - conflict
            const mergedContent = this.attemptThreeWayMerge(baseFile, targetFile, sourceFile);
            if (mergedContent !== null) {
              mergedFiles.set(path, {
                ...sourceFile,
                content: mergedContent,
                hash: this.hashContent(mergedContent),
                size: mergedContent.length,
              });
            } else {
              conflicts.push({
                file: path,
                type: "content",
                ours: targetFile,
                theirs: sourceFile,
                base: baseFile || null,
              });
            }
          }
        }
      }
    }

    const newCommit = this.generateCommitHash(mergedFiles);
    target.files = mergedFiles;
    target.updatedAt = Date.now();
    target.baseCommit = newCommit;
    await this.storage.set(targetId, target);

    return {
      success: conflicts.length === 0,
      mergedFiles,
      conflicts,
      newCommit,
    };
  }

  /**
   * Attempt three-way merge
   */
  private attemptThreeWayMerge(
    base: WorktreeFile | undefined,
    ours: WorktreeFile,
    theirs: WorktreeFile
  ): string | null {
    if (!base) return null;

    const baseLines = base.content.split("\n");
    const oursLines = ours.content.split("\n");
    const theirsLines = theirs.content.split("\n");

    // Simple line-based three-way merge
    const result: string[] = [];
    let i = 0, j = 0, k = 0;

    while (i < baseLines.length || j < oursLines.length || k < theirsLines.length) {
      const baseLine = baseLines[i];
      const oursLine = oursLines[j];
      const theirsLine = theirsLines[k];

      if (oursLine === theirsLine) {
        // Both agree
        result.push(oursLine);
        if (oursLine !== undefined) j++;
        if (theirsLine !== undefined) k++;
        if (baseLine !== undefined) i++;
      } else if (oursLine === baseLine) {
        // Only theirs changed
        result.push(theirsLine!);
        k++;
        if (baseLine !== undefined) i++;
      } else if (theirsLine === baseLine) {
        // Only ours changed
        result.push(oursLine!);
        j++;
        if (baseLine !== undefined) i++;
      } else {
        // Conflict - both changed differently
        return null;
      }
    }

    return result.join("\n");
  }

  /**
   * List all worktrees
   */
  async listWorktrees(): Promise<WorktreeMeta[]> {
    await this.init();
    const ids = await this.storage.list();
    const metas = await Promise.all(ids.map(id => this.storage.get(id)));
    return metas.filter((m): m is WorktreeMeta => m !== null);
  }

  /**
   * Get worktree by ID
   */
  async getWorktree(worktreeId: string): Promise<WorktreeMeta | null> {
    await this.init();
    return this.storage.get(worktreeId);
  }

  /**
   * Delete a worktree
   */
  async deleteWorktree(worktreeId: string): Promise<void> {
    await this.init();
    await this.storage.delete(worktreeId);
    this.log(`Deleted worktree ${worktreeId}`);
  }

  /**
   * Get worktree files as a snapshot
   */
  async getSnapshot(worktreeId: string): Promise<Record<string, string>> {
    const meta = await this.getWorktree(worktreeId);
    if (!meta) throw new Error(`Worktree ${worktreeId} not found`);

    const snapshot: Record<string, string> = {};
    for (const [path, file] of meta.files) {
      snapshot[path] = file.content;
    }
    return snapshot;
  }

  /**
   * Clean up old worktrees (LRU)
   */
  private async evictIfNeeded(): Promise<void> {
    const worktrees = await this.listWorktrees();
    if (worktrees.length >= this.config.maxWorktrees) {
      // Sort by updatedAt (oldest first)
      worktrees.sort((a, b) => a.updatedAt - b.updatedAt);
      const toDelete = worktrees.slice(0, worktrees.length - this.config.maxWorktrees + 1);
      for (const wt of toDelete) {
        await this.storage.delete(wt.id);
        this.log(`Evicted old worktree ${wt.id}`);
      }
    }
  }

  private generateId(): string {
    return `wt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private generateCommitHash(files: Map<string, WorktreeFile>): string {
    const content = Array.from(files.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, file]) => `${path}:${file.hash}`)
      .join("\n");
    return createHash("sha1").update(content).digest("hex").slice(0, 12);
  }

  private hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) console.log("[VirtualWorktree]", ...args);
  }
}

/**
 * Singleton instance
 */
let defaultManager: VirtualWorktreeManager | null = null;

/**
 * Get or create default worktree manager
 */
export function getWorktreeManager(config?: VirtualWorktreeConfig): VirtualWorktreeManager {
  if (!defaultManager) {
    defaultManager = new VirtualWorktreeManager(config);
  }
  return defaultManager;
}

/**
 * Reset default manager (for testing)
 */
export function resetWorktreeManager(): void {
  defaultManager = null;
}