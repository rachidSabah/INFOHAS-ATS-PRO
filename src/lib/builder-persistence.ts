// ============================================================================
// Builder Persistence — versioned auto-save and undo/redo via IndexedDB
// ============================================================================
// Keeps up to 10 versioned auto-saves and a persistent undo/redo history
// that survives page refresh. Zero external dependencies.
// ============================================================================

import type { ResumeData } from "@/lib/types";

// ============================================================================
// IndexedDB helpers
// ============================================================================

const DB_NAME = "ResumeBuilderDB";
const DB_VERSION = 1;
const AUTO_SAVE_STORE = "autoSaves";
const UNDO_STORE = "undoRedo";

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTO_SAVE_STORE)) {
        db.createObjectStore(AUTO_SAVE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(UNDO_STORE)) {
        db.createObjectStore(UNDO_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result?.value as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put({ id: key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// Auto-save — versioned saves in IndexedDB
// ============================================================================

export interface AutoSaveEntry {
  resumeId: string;
  resumeData: ResumeData;
  savedAt: number;
  version: number;
  label?: string;
}

const MAX_AUTO_SAVES = 10;
const AUTO_SAVE_KEY_PREFIX = "autosave-";

async function getAutoSaveKey(resumeId: string): Promise<string> {
  const saves = await listAutoSaves(resumeId);
  // Always use the current key
  return `${AUTO_SAVE_KEY_PREFIX}${resumeId}-current`;
}

export async function listAutoSaves(resumeId?: string): Promise<AutoSaveEntry[]> {
  const all: AutoSaveEntry[] = (await dbGet<AutoSaveEntry[]>("autoSaves", "index")) || [];
  return resumeId ? all.filter(s => s.resumeId === resumeId) : all;
}

export async function saveAutoSave(entry: AutoSaveEntry): Promise<void> {
  let all = await dbGet<AutoSaveEntry[]>(AUTO_SAVE_STORE, "index") || [];
  // Add new entry
  all.push(entry);
  // Sort by savedAt descending, keep latest MAX_AUTO_SAVES
  all.sort((a, b) => b.savedAt - a.savedAt);
  // Remove duplicates (same resumeId + same savedAt)
  const seen = new Set<string>();
  all = all.filter(s => {
    const key = `${s.resumeId}-${s.savedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Keep only MAX_AUTO_SAVES per resumeId
  const perResume = new Map<string, number>();
  all = all.filter(s => {
    const count = perResume.get(s.resumeId) || 0;
    if (count >= MAX_AUTO_SAVES) return false;
    perResume.set(s.resumeId, count + 1);
    return true;
  });
  await dbPut(AUTO_SAVE_STORE, "index", all);
}

export async function getLatestAutoSave(resumeId: string): Promise<AutoSaveEntry | undefined> {
  const all = await listAutoSaves(resumeId);
  return all[0]; // Already sorted desc by savedAt
}

export async function restoreAutoSave(entry: AutoSaveEntry): Promise<void> {
  // Remove all saves for this resumeId and put back only this one
  const all = await dbGet<AutoSaveEntry[]>(AUTO_SAVE_STORE, "index") || [];
  const filtered = all.filter(s => s.resumeId !== entry.resumeId);
  filtered.push(entry);
  await dbPut(AUTO_SAVE_STORE, "index", filtered);
}

export async function clearAutoSaves(resumeId: string): Promise<void> {
  const all = await dbGet<AutoSaveEntry[]>(AUTO_SAVE_STORE, "index") || [];
  const filtered = all.filter(s => s.resumeId !== resumeId);
  await dbPut(AUTO_SAVE_STORE, "index", filtered);
}

// ============================================================================
// Undo-redo persistence
// ============================================================================

export interface UndoRedoEntry {
  data: Partial<ResumeData>;
  timestamp: number;
  label?: string;
  sessionId?: string; // Groups related edits within a time window
}

export interface UndoRedoPersisted {
  undoStack: UndoRedoEntry[];
  redoStack: UndoRedoEntry[];
  totalUndos: number; // Total undos performed (for session tracking)
  totalRedos: number;
}

const MAX_UNDO_HISTORY = 100;

export async function loadUndoRedo(resumeId: string): Promise<UndoRedoPersisted> {
  const data = await dbGet<UndoRedoPersisted>(UNDO_STORE, resumeId);
  return data || { undoStack: [], redoStack: [], totalUndos: 0, totalRedos: 0 };
}

export async function saveUndoRedo(resumeId: string, state: UndoRedoPersisted): Promise<void> {
  // Trim stacks to max
  const trimmed: UndoRedoPersisted = {
    ...state,
    undoStack: state.undoStack.slice(-MAX_UNDO_HISTORY),
    redoStack: state.redoStack.slice(-MAX_UNDO_HISTORY),
  };
  await dbPut(UNDO_STORE, resumeId, trimmed);
}

export async function clearUndoRedo(resumeId: string): Promise<void> {
  await dbDelete(UNDO_STORE, resumeId);
}
