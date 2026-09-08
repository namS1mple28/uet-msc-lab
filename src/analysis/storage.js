import { cloneProject, validateDataset, validateProject } from './model.js';

export const DB_NAME = 'msc-data-studio';
export const DB_VERSION = 1;

// Node tests and server-side rendering have no IndexedDB. The in-memory stores
// retain the same wrapper shape as the browser database.
const memory = { projects: new Map(), transfers: new Map() };

function hasIndexedDB() {
  return typeof globalThis.indexedDB !== 'undefined' && typeof globalThis.indexedDB.open === 'function';
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('transfers')) db.createObjectStore('transfers', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
  });
}

function transaction(db, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    let request;
    const tx = db.transaction(storeName, mode);
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error ?? request?.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    try { request = action(tx.objectStore(storeName)); }
    catch (error) { reject(error); }
  });
}

export async function saveProject(project) {
  validateProject(project);
  const copy = cloneProject(project);
  if (!hasIndexedDB()) { memory.projects.set('autosave', { id: 'autosave', project: copy }); return cloneProject(copy); }
  const db = await openDatabase();
  try {
    await transaction(db, 'projects', 'readwrite', store => store.put({ id: 'autosave', project: copy }));
  } finally { db.close?.(); }
  return cloneProject(copy);
}

export async function loadProject() {
  if (!hasIndexedDB()) {
    const wrapper = memory.projects.get('autosave');
    return wrapper ? cloneProject(wrapper.project) : null;
  }
  const db = await openDatabase();
  try {
    const wrapper = await transaction(db, 'projects', 'readonly', store => store.get('autosave'));
    if (!wrapper) return null;
    validateProject(wrapper.project);
    return cloneProject(wrapper.project);
  } finally { db.close?.(); }
}

export async function saveTransfer(dataset) {
  const issues = validateDataset(dataset);
  if (issues.length) throw new TypeError(`Invalid transfer dataset: ${issues.join('; ')}`);
  const copy = cloneProject(dataset);
  if (typeof copy.id !== 'string' || !copy.id) throw new TypeError('Transfer dataset needs an id');
  if (!hasIndexedDB()) { memory.transfers.set(copy.id, { id: copy.id, dataset: copy }); return copy.id; }
  const db = await openDatabase();
  try { await transaction(db, 'transfers', 'readwrite', store => store.put({ id: copy.id, dataset: copy })); }
  finally { db.close?.(); }
  return copy.id;
}

export async function loadTransfer(id) {
  if (typeof id !== 'string' || !id) return null;
  if (!hasIndexedDB()) {
    const wrapper = memory.transfers.get(id);
    return wrapper ? cloneProject(wrapper.dataset) : null;
  }
  const db = await openDatabase();
  try {
    const wrapper = await transaction(db, 'transfers', 'readonly', store => store.get(id));
    if (!wrapper) return null;
    const issues = validateDataset(wrapper.dataset);
    if (issues.length) throw new TypeError(`Invalid stored transfer: ${issues.join('; ')}`);
    return cloneProject(wrapper.dataset);
  } finally { db.close?.(); }
}
