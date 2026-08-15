/**
 * Round 72: IndexedDB wrapper for storing analysis screenshot images.
 *
 * localStorage has a 5-10MB quota, which is easily exceeded by base64
 * screenshot data URIs (~100KB each). IndexedDB has a much larger quota
 * (typically 50MB+ in most browsers) and is the correct storage for
 * binary/large data.
 *
 * This module stores images by a composite key (messageId + imageIndex)
 * and provides get/delete/clear operations.
 */

const DB_NAME = 'pdb-tracker-images';
const DB_VERSION = 1;
const STORE_NAME = 'analysis-images';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export interface StoredImage {
  key: string;
  dataUri: string;
  recipe: string;
  angle: string;
  label: string;
  storedAt: number;
}

/**
 * Store an image in IndexedDB.
 * Key format: `${messageId}:${imageIndex}`
 */
export async function storeImage(
  key: string,
  dataUri: string,
  meta: { recipe: string; angle: string; label: string },
): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      key,
      dataUri,
      recipe: meta.recipe,
      angle: meta.angle,
      label: meta.label,
      storedAt: Date.now(),
    } satisfies StoredImage);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    // Round 74: Auto-clean old images if we exceed 100 stored images
    autoCleanOldImages(100);
  } catch { /* ignore */ }
}

/**
 * Retrieve an image from IndexedDB by key.
 */
export async function getImage(key: string): Promise<StoredImage | null> {
  const db = await openDB();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return await new Promise<StoredImage | null>((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Retrieve all images for a given message ID.
 * Returns a map of imageIndex → StoredImage.
 */
export async function getImagesForMessage(
  messageId: string,
): Promise<Map<number, StoredImage>> {
  const db = await openDB();
  if (!db) return new Map();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<StoredImage[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const result = new Map<number, StoredImage>();
    for (const img of all) {
      if (img.key.startsWith(`${messageId}:`)) {
        const idx = parseInt(img.key.split(':')[1], 10);
        if (!isNaN(idx)) result.set(idx, img);
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Delete all images for a given message ID.
 */
export async function deleteImagesForMessage(messageId: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<StoredImage[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    for (const img of all) {
      if (img.key.startsWith(`${messageId}:`)) {
        store.delete(img.key);
      }
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

/**
 * Clear all stored images (for cleanup/reset).
 */
export async function clearAllImages(): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

/**
 * Round 74: Get the total number of stored images and estimated size.
 * Useful for quota management and debugging.
 */
export async function getImageStats(): Promise<{ count: number; estimatedSizeKB: number }> {
  const db = await openDB();
  if (!db) return { count: 0, estimatedSizeKB: 0 };
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<StoredImage[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const estimatedSizeKB = all.reduce((sum, img) =>
      sum + (img.dataUri ? Math.ceil(img.dataUri.length / 1024) : 0), 0
    );
    return { count: all.length, estimatedSizeKB };
  } catch {
    return { count: 0, estimatedSizeKB: 0 };
  }
}

/**
 * Round 74: Auto-clean old images when the count exceeds a threshold.
 * Keeps only the most recent `maxImages` images (by storedAt timestamp).
 * Called automatically after storing new images.
 *
 * @param maxImages Maximum number of images to keep (default: 100)
 */
export async function autoCleanOldImages(maxImages: number = 100): Promise<number> {
  const db = await openDB();
  if (!db) return 0;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<StoredImage[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (all.length <= maxImages) return 0;
    // Sort by storedAt ascending (oldest first)
    all.sort((a, b) => a.storedAt - b.storedAt);
    const toDelete = all.slice(0, all.length - maxImages);
    for (const img of toDelete) {
      store.delete(img.key);
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    return toDelete.length;
  } catch {
    return 0;
  }
}
