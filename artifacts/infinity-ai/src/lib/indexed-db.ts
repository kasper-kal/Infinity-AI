/**
 * IndexedDB utility for persisting File System Access API handles.
 *
 * FileSystemDirectoryHandle cannot be directly serialized to JSON.
 * Instead, we use the File System Access API's built-in persistence:
 * - navigator.storage.getDirectory() returns a FileSystemDirectoryHandle for the origin's sandboxed storage
 * - We can't directly persist cross-origin handles, but we can store a reference
 * - For user-selected directories, we store the handle ID and re-request permission on reload
 *
 * Strategy: Store metadata about the selected folder (name, timestamp) in IndexedDB.
 * On reconnect, we prompt the user to re-select the same folder (browser requires user gesture).
 * The browser will restore the handle if the user picks the same folder.
 */

interface StoredHandleMeta {
  key: string;
  name: string;
  timestamp: number;
  // Note: We don't store the actual handle - browser requires user gesture to restore
  // We store metadata so we can show "Last connected: Folder Name" and guide re-selection
}

const DB_NAME = 'Infinity-fs';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });

  return dbPromise;
}

export async function initDB(): Promise<IDBDatabase> {
  return openDB();
}

export async function saveHandleMeta(key: string, name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const meta: StoredHandleMeta = {
      key,
      name,
      timestamp: Date.now(),
    };
    const request = store.put(meta);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadHandleMeta(key: string): Promise<StoredHandleMeta | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteHandleMeta(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function listHandleMetas(): Promise<StoredHandleMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

// Storage key for the active workspace handle
export const ACTIVE_WORKSPACE_KEY = 'infinity-build-workspace';