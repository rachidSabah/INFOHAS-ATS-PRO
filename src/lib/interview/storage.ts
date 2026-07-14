// ============================================================================
// Interview recording storage — IndexedDB (local, privacy-friendly, offline).
//
// Video blobs are large and contain PII, so they are stored ONLY in the
// browser's IndexedDB — never uploaded to a server. Only lightweight metadata
// (InterviewRecordingMeta / InterviewSessionRecord) is mirrored into the shared
// Zustand store and the existing cloud API, so history survives refresh.
//
// Pattern mirrors src/lib/builder-persistence.ts (raw IndexedDB, zero deps).
// ============================================================================

import type { InterviewRecordingMeta, InterviewSessionRecord } from "@/hooks/interview/types";

const DB_NAME = "ResumeInterviewDB";
const DB_VERSION = 1;
const BLOB_STORE = "recordingBlobs"; // key: recording id → Blob
const META_STORE = "recordingMeta"; // key: recording id → InterviewRecordingMeta
const SESSION_STORE = "sessionMeta"; // key: session id → InterviewSessionRecord

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

// ---- Blob (the actual media) ----------------------------------------------

export async function putRecordingBlob(id: string, blob: Blob): Promise<void> {
  await tx<Blob>(BLOB_STORE, "readwrite", (s) => s.put(blob, id));
}

export async function getRecordingBlob(id: string): Promise<Blob | null> {
  const blob = await tx<Blob | undefined>(BLOB_STORE, "readonly", (s) => s.get(id));
  return blob ?? null;
}

export async function deleteRecordingBlob(id: string): Promise<void> {
  await tx<undefined>(BLOB_STORE, "readwrite", (s) => s.delete(id));
}

// ---- Metadata --------------------------------------------------------------

export async function putRecordingMeta(meta: InterviewRecordingMeta): Promise<void> {
  await tx(META_STORE, "readwrite", (s) => s.put(meta, meta.id));
}

export async function getRecordingMeta(id: string): Promise<InterviewRecordingMeta | null> {
  const m = await tx<InterviewRecordingMeta | undefined>(META_STORE, "readonly", (s) => s.get(id));
  return m ?? null;
}

export async function deleteRecordingMeta(id: string): Promise<void> {
  await tx<undefined>(META_STORE, "readwrite", (s) => s.delete(id));
}

/** Persist a finished recording: blob + metadata in one shot. */
export async function saveRecording(
  meta: InterviewRecordingMeta,
  blob: Blob
): Promise<void> {
  await putRecordingBlob(meta.id, blob);
  await putRecordingMeta(meta);
}

// ---- Session ---------------------------------------------------------------

export async function putSession(session: InterviewSessionRecord): Promise<void> {
  await tx(SESSION_STORE, "readwrite", (s) => s.put(session, session.id));
}

export async function getSession(id: string): Promise<InterviewSessionRecord | null> {
  const s = await tx<InterviewSessionRecord | undefined>(SESSION_STORE, "readonly", (s) => s.get(id));
  return s ?? null;
}

export async function listSessions(): Promise<InterviewSessionRecord[]> {
  const all = await tx<InterviewSessionRecord[]>(SESSION_STORE, "readonly", (s) => s.getAll());
  return all ?? [];
}

export async function deleteSession(id: string): Promise<void> {
  const session = await getSession(id);
  if (session) {
    for (const r of session.recordings) {
      await deleteRecordingBlob(r.id).catch(() => {});
      await deleteRecordingMeta(r.id).catch(() => {});
    }
  }
  await tx<undefined>(SESSION_STORE, "readwrite", (s) => s.delete(id));
}

/** Create a downloadable object URL for a recorded blob (caller revokes). */
export async function getRecordingObjectURL(id: string): Promise<string | null> {
  const blob = await getRecordingBlob(id);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}
