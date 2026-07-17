(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImmersaLocalMediaHandleStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const DB_NAME = 'immersa-screen-local-media';
  const DB_VERSION = 2;
  const STORE_NAME = 'bindings';
  const OPFS_DIR = 'immersa-screen-media';
  const MAX_INDEXEDDB_COPY_BYTES = 256 * 1024 * 1024;

  function bindingKey(deckId, slideId) {
    return String(deckId || '') + '::' + String(slideId || '');
  }

  function safeSegment(value, fallback = 'media') {
    const normalized = String(value || '').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  function fileMetadata(file) {
    return {
      name: String(file?.name || ''),
      size: Number(file?.size) || 0,
      type: String(file?.type || ''),
      last_modified: Number(file?.lastModified ?? file?.last_modified) || null
    };
  }

  function sameFileMetadata(left, right) {
    const a = fileMetadata(left);
    const b = fileMetadata(right);
    return a.name.toLowerCase() === b.name.toLowerCase() && (!a.size || !b.size || a.size === b.size);
  }

  function createStore(options = {}) {
    const indexedDBApi = options.indexedDB || root.indexedDB;
    const storageApi = options.storage || root.navigator?.storage;
    const dbName = options.dbName || DB_NAME;
    let databasePromise = null;

    function supported() {
      return Boolean(indexedDBApi);
    }

    function openDatabase() {
      if (!supported()) return Promise.resolve(null);
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDBApi.open(dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.objectStoreNames.contains(STORE_NAME)
            ? request.transaction.objectStore(STORE_NAME)
            : database.createObjectStore(STORE_NAME, { keyPath: 'key' });
          if (!store.indexNames.contains('deck_id')) store.createIndex('deck_id', 'deck_id', { unique: false });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Unable to open local media database'));
        request.onblocked = () => reject(new Error('Local media database upgrade blocked'));
      }).catch((error) => {
        console.warn('Unable to open persistent multimedia storage', error?.message || error);
        return null;
      });
      return databasePromise;
    }

    async function run(mode, operation) {
      const database = await openDatabase();
      if (!database) return null;
      return new Promise((resolve) => {
        let settled = false;
        let result = true;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        let transaction;
        try {
          transaction = database.transaction(STORE_NAME, mode);
          const request = operation(transaction.objectStore(STORE_NAME));
          if (request) {
            request.onsuccess = () => { result = request.result; };
            request.onerror = () => { result = null; };
          }
          transaction.oncomplete = () => finish(result);
          transaction.onabort = () => finish(null);
          transaction.onerror = () => finish(null);
        } catch (_error) {
          try { transaction?.abort?.(); } catch (_abortError) {}
          finish(null);
        }
      });
    }

    async function get(deckId, slideId) {
      return await run('readonly', (store) => store.get(bindingKey(deckId, slideId)));
    }

    async function putRecord(record) {
      const result = await run('readwrite', (store) => store.put(record));
      if (!result) return false;
      const verified = await get(record.deck_id, record.slide_id);
      return Boolean(verified && verified.key === record.key);
    }

    async function writeOpfs(deckId, slideId, file) {
      if (!storageApi?.getDirectory || !file) return null;
      try {
        await storageApi.persist?.();
        const rootDirectory = await storageApi.getDirectory();
        const mediaDirectory = await rootDirectory.getDirectoryHandle(OPFS_DIR, { create: true });
        const deckDirectoryName = safeSegment(deckId, 'deck');
        const deckDirectory = await mediaDirectory.getDirectoryHandle(deckDirectoryName, { create: true });
        const fileName = safeSegment(slideId, 'slide') + '.mp4';
        const target = await deckDirectory.getFileHandle(fileName, { create: true });
        const writable = await target.createWritable();
        await writable.write(file);
        await writable.close();
        return { directory: deckDirectoryName, name: fileName };
      } catch (error) {
        console.warn('Unable to create persistent local multimedia copy', error?.message || error);
        return null;
      }
    }

    async function readOpfs(opfs) {
      if (!storageApi?.getDirectory || !opfs?.directory || !opfs?.name) return null;
      try {
        const rootDirectory = await storageApi.getDirectory();
        const mediaDirectory = await rootDirectory.getDirectoryHandle(OPFS_DIR);
        const deckDirectory = await mediaDirectory.getDirectoryHandle(String(opfs.directory));
        const target = await deckDirectory.getFileHandle(String(opfs.name));
        return await target.getFile();
      } catch (_error) {
        return null;
      }
    }

    async function removeOpfs(opfs) {
      if (!storageApi?.getDirectory || !opfs?.directory || !opfs?.name) return false;
      try {
        const rootDirectory = await storageApi.getDirectory();
        const mediaDirectory = await rootDirectory.getDirectoryHandle(OPFS_DIR);
        const deckDirectory = await mediaDirectory.getDirectoryHandle(String(opfs.directory));
        await deckDirectory.removeEntry(String(opfs.name));
        return true;
      } catch (_error) {
        return false;
      }
    }

    async function put(deckId, slideId, handle, file) {
      if (!supported() || !file) return false;
      const base = {
        key: bindingKey(deckId, slideId),
        deck_id: String(deckId || ''),
        slide_id: String(slideId || ''),
        file: fileMetadata(file),
        saved_at: new Date().toISOString()
      };

      if (handle) {
        const handleSaved = await putRecord({ ...base, storage_mode: 'handle', handle, opfs: null, file_blob: null });
        if (handleSaved) {
          const verified = await get(deckId, slideId);
          if (verified?.handle && typeof verified.handle.getFile === 'function') return true;
        }
      }

      const opfs = await writeOpfs(deckId, slideId, file);
      if (opfs) {
        const copySaved = await putRecord({ ...base, storage_mode: 'opfs', handle: null, opfs, file_blob: null });
        if (copySaved) return true;
      }

      if ((Number(file.size) || 0) <= MAX_INDEXEDDB_COPY_BYTES) {
        const blobSaved = await putRecord({ ...base, storage_mode: 'indexeddb-file', handle: null, opfs: null, file_blob: file });
        if (blobSaved) return true;
      }

      return false;
    }

    async function getDeck(deckId) {
      if (!supported()) return [];
      const database = await openDatabase();
      if (!database) return [];
      return new Promise((resolve) => {
        let transaction;
        try {
          transaction = database.transaction(STORE_NAME, 'readonly');
          const index = transaction.objectStore(STORE_NAME).index('deck_id');
          const request = index.getAll(String(deckId || ''));
          request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
          request.onerror = () => resolve([]);
          transaction.onabort = () => resolve([]);
        } catch (_error) {
          resolve([]);
        }
      });
    }

    async function remove(deckId, slideId) {
      const binding = await get(deckId, slideId);
      if (binding?.storage_mode === 'opfs') await removeOpfs(binding.opfs);
      return Boolean(await run('readwrite', (store) => store.delete(bindingKey(deckId, slideId))));
    }

    async function permission(handle, request = false) {
      if (!handle) return 'denied';
      try {
        if (typeof handle.queryPermission !== 'function') return 'granted';
        let state = await handle.queryPermission({ mode: 'read' });
        if (state === 'prompt' && request && typeof handle.requestPermission === 'function') {
          state = await handle.requestPermission({ mode: 'read' });
        }
        return state;
      } catch (_error) {
        return 'denied';
      }
    }

    async function read(binding, options = {}) {
      if (!binding) return { status: 'missing', binding };

      if (binding.storage_mode === 'opfs' || binding.opfs) {
        const file = await readOpfs(binding.opfs);
        return file ? { status: 'file', file, handle: null, binding, persistence_mode: 'opfs' } : { status: 'missing', binding };
      }

      if (binding.storage_mode === 'indexeddb-file' && binding.file_blob) {
        return { status: 'file', file: binding.file_blob, handle: null, binding, persistence_mode: 'indexeddb-file' };
      }

      const handle = binding.handle;
      if (!handle || typeof handle.getFile !== 'function') return { status: 'missing', binding };
      const state = await permission(handle, Boolean(options.request));
      if (state !== 'granted') return { status: 'permission_required', permission: state, binding, handle };
      try {
        const file = await handle.getFile();
        return { status: 'file', file, handle, binding, persistence_mode: 'handle' };
      } catch (error) {
        return { status: 'missing', error, binding, handle };
      }
    }

    return { supported, put, get, getDeck, remove, permission, read };
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
    OPFS_DIR,
    MAX_INDEXEDDB_COPY_BYTES,
    bindingKey,
    safeSegment,
    fileMetadata,
    sameFileMetadata,
    createStore
  };
});