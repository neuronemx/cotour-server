(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImmersaLocalMediaHandleStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const DB_NAME = 'immersa-screen-local-media';
  const DB_VERSION = 3;
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
    const FileCtor = options.File || root.File;
    const dbName = options.dbName || DB_NAME;
    let databasePromise = null;

    function supported() {
      return Boolean(indexedDBApi || storageApi?.getDirectory);
    }

    function openDatabase() {
      if (!indexedDBApi) return Promise.resolve(null);
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
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => database.close();
          resolve(database);
        };
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

    async function getOpfsDeckDirectory(deckId, create = false) {
      if (!storageApi?.getDirectory) return null;
      try {
        const rootDirectory = await storageApi.getDirectory();
        const mediaDirectory = await rootDirectory.getDirectoryHandle(OPFS_DIR, { create });
        return await mediaDirectory.getDirectoryHandle(safeSegment(deckId, 'deck'), { create });
      } catch (_error) {
        return null;
      }
    }

    async function writeTextFile(directory, name, text) {
      const target = await directory.getFileHandle(name, { create: true });
      const writable = await target.createWritable();
      await writable.write(text);
      await writable.close();
    }

    async function writeOpfs(deckId, slideId, file) {
      if (!storageApi?.getDirectory || !file) return null;
      try {
        await storageApi.persist?.();
        const deckDirectory = await getOpfsDeckDirectory(deckId, true);
        if (!deckDirectory) return null;
        const fileName = safeSegment(slideId, 'slide') + '.mp4';
        const target = await deckDirectory.getFileHandle(fileName, { create: true });
        const writable = await target.createWritable();
        await writable.write(file);
        await writable.close();
        await writeTextFile(deckDirectory, fileName + '.json', JSON.stringify({
          deck_id: String(deckId || ''),
          slide_id: String(slideId || ''),
          file: fileMetadata(file),
          saved_at: new Date().toISOString()
        }));
        return { directory: safeSegment(deckId, 'deck'), name: fileName };
      } catch (error) {
        console.warn('Unable to create persistent local multimedia copy', error?.message || error);
        return null;
      }
    }

    async function readJsonFile(directory, name) {
      try {
        const handle = await directory.getFileHandle(name);
        const file = await handle.getFile();
        return JSON.parse(await file.text());
      } catch (_error) {
        return null;
      }
    }

    async function discoverOpfs(deckId) {
      const deckDirectory = await getOpfsDeckDirectory(deckId, false);
      if (!deckDirectory || typeof deckDirectory.entries !== 'function') return [];
      const bindings = [];
      try {
        for await (const [name, handle] of deckDirectory.entries()) {
          if (handle?.kind !== 'file' || !/\.mp4$/i.test(name)) continue;
          const metadata = await readJsonFile(deckDirectory, name + '.json');
          const slideId = String(metadata?.slide_id || name.replace(/\.mp4$/i, ''));
          let currentFile = null;
          try { currentFile = await handle.getFile(); } catch (_error) {}
          bindings.push({
            key: bindingKey(deckId, slideId),
            deck_id: String(deckId || ''),
            slide_id: slideId,
            storage_mode: 'opfs',
            handle: null,
            opfs: { directory: safeSegment(deckId, 'deck'), name },
            file: metadata?.file || fileMetadata(currentFile),
            saved_at: metadata?.saved_at || null
          });
        }
      } catch (_error) {
        return [];
      }
      return bindings;
    }

    async function readOpfs(opfs, metadata) {
      if (!storageApi?.getDirectory || !opfs?.directory || !opfs?.name) return null;
      try {
        const rootDirectory = await storageApi.getDirectory();
        const mediaDirectory = await rootDirectory.getDirectoryHandle(OPFS_DIR);
        const deckDirectory = await mediaDirectory.getDirectoryHandle(String(opfs.directory));
        const target = await deckDirectory.getFileHandle(String(opfs.name));
        const stored = await target.getFile();
        const original = fileMetadata(metadata);
        if (FileCtor && original.name) {
          return new FileCtor([stored], original.name, {
            type: original.type || stored.type || 'video/mp4',
            lastModified: original.last_modified || stored.lastModified || Date.now()
          });
        }
        return stored;
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
        try { await deckDirectory.removeEntry(String(opfs.name) + '.json'); } catch (_error) {}
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

      const opfs = await writeOpfs(deckId, slideId, file);
      if (opfs) {
        await putRecord({ ...base, storage_mode: 'opfs', handle: null, opfs, file_blob: null });
        return true;
      }

      if (handle) {
        const handleSaved = await putRecord({ ...base, storage_mode: 'handle', handle, opfs: null, file_blob: null });
        if (handleSaved) {
          const verified = await get(deckId, slideId);
          if (verified?.handle && typeof verified.handle.getFile === 'function') return true;
        }
      }

      if ((Number(file.size) || 0) <= MAX_INDEXEDDB_COPY_BYTES) {
        const blobSaved = await putRecord({ ...base, storage_mode: 'indexeddb-file', handle: null, opfs: null, file_blob: file });
        if (blobSaved) return true;
      }

      return false;
    }

    async function getDeckFromDatabase(deckId) {
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

    async function getDeck(deckId) {
      const databaseBindings = await getDeckFromDatabase(deckId);
      const discoveredBindings = await discoverOpfs(deckId);
      const merged = new Map();
      for (const binding of databaseBindings) merged.set(String(binding.slide_id), binding);
      for (const binding of discoveredBindings) merged.set(String(binding.slide_id), binding);
      return Array.from(merged.values());
    }

    async function remove(deckId, slideId) {
      const binding = await get(deckId, slideId);
      await removeOpfs(binding?.opfs || {
        directory: safeSegment(deckId, 'deck'),
        name: safeSegment(slideId, 'slide') + '.mp4'
      });
      const result = await run('readwrite', (store) => store.delete(bindingKey(deckId, slideId)));
      return result !== null;
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
        const file = await readOpfs(binding.opfs, binding.file);
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

    return { supported, put, get, getDeck, discoverOpfs, remove, permission, read };
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
