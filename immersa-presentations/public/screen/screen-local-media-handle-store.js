(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImmersaLocalMediaHandleStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const DB_NAME = 'immersa-screen-local-media';
  const DB_VERSION = 1;
  const STORE_NAME = 'bindings';

  function bindingKey(deckId, slideId) {
    return String(deckId || '') + '::' + String(slideId || '');
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
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            store.createIndex('deck_id', 'deck_id', { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Unable to open local media database'));
      }).catch(() => null);
      return databasePromise;
    }

    async function run(mode, operation) {
      const database = await openDatabase();
      if (!database) return null;
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let request;
        try {
          request = operation(store);
        } catch (error) {
          reject(error);
          return;
        }
        if (request) {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('Local media database request failed'));
        } else {
          transaction.oncomplete = () => resolve(true);
        }
        transaction.onerror = () => reject(transaction.error || new Error('Local media database transaction failed'));
      }).catch(() => null);
    }

    async function put(deckId, slideId, handle, file) {
      if (!handle || !supported()) return false;
      const record = {
        key: bindingKey(deckId, slideId),
        deck_id: String(deckId || ''),
        slide_id: String(slideId || ''),
        handle,
        file: fileMetadata(file),
        saved_at: new Date().toISOString()
      };
      return Boolean(await run('readwrite', (store) => store.put(record)));
    }

    async function getDeck(deckId) {
      if (!supported()) return [];
      const database = await openDatabase();
      if (!database) return [];
      return new Promise((resolve) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const index = transaction.objectStore(STORE_NAME).index('deck_id');
        const request = index.getAll(String(deckId || ''));
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
      });
    }

    async function remove(deckId, slideId) {
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
      const handle = binding?.handle;
      if (!handle || typeof handle.getFile !== 'function') return { status: 'missing', binding };
      const state = await permission(handle, Boolean(options.request));
      if (state !== 'granted') return { status: 'permission_required', permission: state, binding, handle };
      try {
        const file = await handle.getFile();
        return { status: 'file', file, handle, binding };
      } catch (error) {
        return { status: 'missing', error, binding, handle };
      }
    }

    return { supported, put, getDeck, remove, permission, read };
  }

  return { DB_NAME, STORE_NAME, bindingKey, fileMetadata, sameFileMetadata, createStore };
});
