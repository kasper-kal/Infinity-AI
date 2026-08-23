/**
 * File System Access API service for Infinity Build.
 *
 * Provides browser-native file system access via showDirectoryPicker(),
 * with IndexedDB persistence for folder handles across sessions.
 */

import { initDB, saveHandleMeta, loadHandleMeta, deleteHandleMeta, ACTIVE_WORKSPACE_KEY } from './indexed-db';

export interface FileSystemAccessError extends Error {
  code: 'NOT_SUPPORTED' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'ABORTED' | 'SECURITY_ERROR' | 'UNKNOWN';
}

export function createFSError(message: string, code: FileSystemAccessError['code']): FileSystemAccessError {
  const error = new Error(message) as FileSystemAccessError;
  error.code = code;
  return error;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export interface PickDirectoryOptions {
  mode?: 'read' | 'readwrite';
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  id?: string;
}

export async function pickDirectory(options: PickDirectoryOptions = {}): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw createFSError('File System Access API is not supported in this browser', 'NOT_SUPPORTED');
  }

  try {
    // @ts-ignore - showDirectoryPicker exists but TypeScript doesn't know it
    const handle = await window.showDirectoryPicker({
      mode: options.mode ?? 'readwrite',
      startIn: options.startIn,
      id: options.id,
    });
    return handle;
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === 'AbortError') {
        throw createFSError('Directory selection was cancelled', 'ABORTED');
      }
      if (err.name === 'SecurityError') {
        throw createFSError('Permission denied to access the selected directory', 'SECURITY_ERROR');
      }
      if (err.name === 'NotFoundError') {
        throw createFSError('The selected directory was not found', 'NOT_FOUND');
      }
    }
    throw createFSError(err instanceof Error ? err.message : 'Failed to pick directory', 'UNKNOWN');
  }
}

export async function verifyPermission(handle: FileSystemDirectoryHandle, mode: 'read' | 'readwrite' = 'readwrite'): Promise<PermissionState> {
  if (!isFileSystemAccessSupported()) {
    return 'denied';
  }

  try {
    // @ts-ignore - queryPermission exists on handle
    const state = await handle.queryPermission({ mode });
    return state;
  } catch {
    return 'denied';
  }
}

export async function requestPermission(handle: FileSystemDirectoryHandle, mode: 'read' | 'readwrite' = 'readwrite'): Promise<PermissionState> {
  if (!isFileSystemAccessSupported()) {
    return 'denied';
  }

  try {
    // @ts-ignore - requestPermission exists on handle
    const state = await handle.requestPermission({ mode });
    return state;
  } catch {
    return 'denied';
  }
}

export async function ensurePermission(handle: FileSystemDirectoryHandle, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  const current = await verifyPermission(handle, mode);
  if (current === 'granted') return true;

  const requested = await requestPermission(handle, mode);
  return requested === 'granted';
}

export async function readFile(handle: FileSystemDirectoryHandle, path: string): Promise<string> {
  try {
    // Navigate to the file
    const parts = path.split('/').filter(Boolean);
    let current: FileSystemHandle = handle;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // @ts-ignore - getFileHandle/getDirectoryHandle exist
      if (i === parts.length - 1) {
        // Last part - get file
        current = await (current as FileSystemDirectoryHandle).getFileHandle(part);
      } else {
        // Intermediate directory
        current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(part);
      }
    }

    // @ts-ignore - getFile exists on FileSystemFileHandle
    const file = await (current as FileSystemFileHandle).getFile();
    const text = await file.text();
    return text;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      throw createFSError(`File not found: ${path}`, 'NOT_FOUND');
    }
    throw createFSError(`Failed to read file ${path}: ${err instanceof Error ? err.message : 'Unknown error'}`, 'UNKNOWN');
  }
}

export async function writeFile(handle: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  try {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop()!;
    let current: FileSystemDirectoryHandle = handle;

    // Create directories as needed
    for (const part of parts) {
      // @ts-ignore - getDirectoryHandle exists
      current = await current.getDirectoryHandle(part, { create: true });
    }

    // @ts-ignore - getFileHandle exists
    const fileHandle = await current.getFileHandle(fileName, { create: true });
    // @ts-ignore - createWritable exists
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (err) {
    throw createFSError(`Failed to write file ${path}: ${err instanceof Error ? err.message : 'Unknown error'}`, 'UNKNOWN');
  }
}

export interface FileEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
}

export async function readDirectoryRecursive(handle: FileSystemDirectoryHandle, options: {
  maxFiles?: number;
  maxFileSize?: number;
  excludePatterns?: RegExp[];
} = {}): Promise<FileEntry[]> {
  const {
    maxFiles = 1000,
    maxFileSize = 2_000_000,
    excludePatterns = [/^\.git/, /^node_modules/, /^\.tmp/],
  } = options;

  const entries: FileEntry[] = [];

  async function walk(dirHandle: FileSystemDirectoryHandle, relPath: string = ''): Promise<void> {
    if (entries.length >= maxFiles) return;

    // @ts-ignore - values() exists on FileSystemDirectoryHandle
    for await (const [name, entry] of dirHandle.entries()) {
      if (entries.length >= maxFiles) break;

      // Check exclude patterns
      if (excludePatterns.some((pattern) => pattern.test(name))) continue;

      const fullPath = relPath ? `${relPath}/${name}` : name;

      if (entry.kind === 'directory') {
        entries.push({ path: `${fullPath}/`, name, type: 'dir', size: 0 });
        await walk(entry, fullPath);
      } else if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          if (file.size <= maxFileSize) {
            entries.push({ path: fullPath, name, type: 'file', size: file.size });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(handle);
  return entries;
}

export async function readAllTextFiles(handle: FileSystemDirectoryHandle, options: {
  maxFiles?: number;
  maxFileSize?: number;
  excludePatterns?: RegExp[];
  textExtensions?: string[];
} = {}): Promise<Map<string, string>> {
  const {
    maxFiles = 500,
    maxFileSize = 500_000,
    excludePatterns = [/^\.git/, /^node_modules/, /^\.tmp/, /\.lock$/, /\.log$/],
    textExtensions = [
      'ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'scss', 'less',
      'md', 'mdx', 'txt', 'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
      'php', 'rb', 'swift', 'kt', 'sh', 'bash', 'zsh', 'fish', 'sql',
      'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
      'vue', 'svelte', 'astro', 'prisma', 'graphql', 'proto',
    ],
  } = options;

  const result = new Map<string, string>();

  async function walk(dirHandle: FileSystemDirectoryHandle, relPath: string = ''): Promise<void> {
    if (result.size >= maxFiles) return;

    // @ts-ignore - values() exists
    for await (const [name, entry] of dirHandle.entries()) {
      if (result.size >= maxFiles) break;

      if (excludePatterns.some((pattern) => pattern.test(name))) continue;

      const fullPath = relPath ? `${relPath}/${name}` : name;

      if (entry.kind === 'directory') {
        await walk(entry, fullPath);
      } else if (entry.kind === 'file') {
        const ext = name.split('.').pop()?.toLowerCase();
        if (!ext || !textExtensions.includes(ext)) continue;

        try {
          const file = await entry.getFile();
          if (file.size <= maxFileSize) {
            const text = await file.text();
            result.set(fullPath, text);
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(handle);
  return result;
}

export async function writeFileTree(handle: FileSystemDirectoryHandle, files: Map<string, string>): Promise<void> {
  for (const [path, content] of files) {
    await writeFile(handle, path, content);
  }
}

export async function deletePath(handle: FileSystemDirectoryHandle, path: string): Promise<void> {
  try {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    let current: FileSystemDirectoryHandle = handle;

    for (const part of parts) {
      // @ts-ignore - getDirectoryHandle exists
      current = await current.getDirectoryHandle(part);
    }

    // @ts-ignore - removeEntry exists
    await current.removeEntry(name, { recursive: true });
  } catch (err) {
    throw createFSError(`Failed to delete ${path}: ${err instanceof Error ? err.message : 'Unknown error'}`, 'UNKNOWN');
  }
}

export async function renamePath(handle: FileSystemDirectoryHandle, from: string, to: string): Promise<void> {
  try {
    const fromParts = from.split('/').filter(Boolean);
    const toParts = to.split('/').filter(Boolean);
    const fromName = fromParts.pop()!;
    const toName = toParts.pop()!;

    let fromParent: FileSystemDirectoryHandle = handle;
    for (const part of fromParts) {
      // @ts-ignore - getDirectoryHandle exists
      fromParent = await fromParent.getDirectoryHandle(part);
    }

    let toParent: FileSystemDirectoryHandle = handle;
    for (const part of toParts) {
      // @ts-ignore - getDirectoryHandle exists
      toParent = await toParent.getDirectoryHandle(part, { create: true });
    }

    // @ts-ignore - getFileHandle/getDirectoryHandle exists
    let entry: FileSystemHandle;
    try {
      entry = await fromParent.getFileHandle(fromName);
    } catch {
      entry = await fromParent.getDirectoryHandle(fromName);
    }

    // Move by creating new and deleting old (no direct rename API)
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      const text = await file.text();
      // @ts-ignore - getFileHandle exists
      const newHandle = await toParent.getFileHandle(toName, { create: true });
      // @ts-ignore - createWritable exists
      const writable = await newHandle.createWritable();
      await writable.write(text);
      await writable.close();
    } else {
      // For directories, we'd need recursive copy - simplified for now
      throw createFSError('Directory rename not fully implemented - use move operations', 'UNKNOWN');
    }

    // @ts-ignore - removeEntry exists
    await fromParent.removeEntry(fromName);
  } catch (err) {
    throw createFSError(`Failed to rename ${from} to ${to}: ${err instanceof Error ? err.message : 'Unknown error'}`, 'UNKNOWN');
  }
}

export async function createDirectory(handle: FileSystemDirectoryHandle, path: string): Promise<void> {
  try {
    const parts = path.split('/').filter(Boolean);
    let current: FileSystemDirectoryHandle = handle;

    for (const part of parts) {
      // @ts-ignore - getDirectoryHandle exists
      current = await current.getDirectoryHandle(part, { create: true });
    }
  } catch (err) {
    throw createFSError(`Failed to create directory ${path}: ${err instanceof Error ? err.message : 'Unknown error'}`, 'UNKNOWN');
  }
}

const STORAGE_KEY = ACTIVE_WORKSPACE_KEY;

export async function storeHandleMeta(handle: FileSystemDirectoryHandle, name: string): Promise<void> {
  await saveHandleMeta(STORAGE_KEY, name);
}

export async function loadStoredHandleMeta(): Promise<{ name: string; timestamp: number } | null> {
  const meta = await loadHandleMeta(STORAGE_KEY);
  if (!meta) return null;
  return { name: meta.name, timestamp: meta.timestamp };
}

export async function clearStoredHandleMeta(): Promise<void> {
  await deleteHandleMeta(STORAGE_KEY);
}

export interface ReconnectResult {
  handle: FileSystemDirectoryHandle | null;
  permissionState: PermissionState;
  error: FileSystemAccessError | null;
}

export async function reconnectWorkspace(): Promise<ReconnectResult> {
  if (!isFileSystemAccessSupported()) {
    return {
      handle: null,
      permissionState: 'denied',
      error: createFSError('File System Access API not supported', 'NOT_SUPPORTED'),
    };
  }

  const meta = await loadStoredHandleMeta();
  if (!meta) {
    return { handle: null, permissionState: 'denied', error: null };
  }

  try {
    // We can't restore the handle directly - need user gesture
    // But we can check if the origin has stored a handle via navigator.storage
    // For now, return metadata so UI can prompt user to reconnect
    return {
      handle: null,
      permissionState: 'prompt',
      error: null,
    };
  } catch (err) {
    await clearStoredHandleMeta();
    return {
      handle: null,
      permissionState: 'denied',
      error: createFSError(
        `Failed to reconnect: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'UNKNOWN'
      ),
    };
  }
}

export async function connectAndStoreWorkspace(name?: string): Promise<{ handle: FileSystemDirectoryHandle; name: string }> {
  const handle = await pickDirectory({ mode: 'readwrite', id: 'infinity-build-workspace' });
  const folderName = name ?? handle.name;
  await storeHandleMeta(handle, folderName);
  return { handle, name: folderName };
}

export async function disconnectWorkspace(): Promise<void> {
  await clearStoredHandleMeta();
}

export function getBrowserSupportMessage(): string | null {
  if (typeof window === 'undefined') return null;
  if (!('showDirectoryPicker' in window)) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('safari') && !ua.includes('chrome')) {
      return 'Safari does not support the File System Access API. Use Chrome or Edge for local folder access.';
    }
    if (ua.includes('firefox')) {
      return 'Firefox does not support the File System Access API. Use Chrome or Edge for local folder access.';
    }
    return 'Your browser does not support the File System Access API. Use Chrome or Edge for local folder access.';
  }
  return null;
}