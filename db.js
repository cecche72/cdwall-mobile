const DB_NAME = 'cdwall-mobile';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('albums')) {
        const albums = db.createObjectStore('albums', { keyPath: 'Id' });
        albums.createIndex('title', 'Title');
        albums.createIndex('artist', 'Artist');
        albums.createIndex('photo', 'PhotoId');
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let request;
    try { request = action(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || request?.error);
    tx.onabort = () => reject(tx.error || new Error('Operazione annullata'));
  }).finally(() => db.close());
}

export const db = {
  albums: {
    all: () => run('albums', 'readonly', store => store.getAll()),
    get: id => run('albums', 'readonly', store => store.get(id)),
    put: album => run('albums', 'readwrite', store => store.put(album)),
    delete: id => run('albums', 'readwrite', store => store.delete(id)),
    clear: () => run('albums', 'readwrite', store => store.clear())
  },
  photos: {
    all: () => run('photos', 'readonly', store => store.getAll()),
    get: id => run('photos', 'readonly', store => store.get(id)),
    put: photo => run('photos', 'readwrite', store => store.put(photo)),
    delete: id => run('photos', 'readwrite', store => store.delete(id)),
    clear: () => run('photos', 'readwrite', store => store.clear())
  }
};
