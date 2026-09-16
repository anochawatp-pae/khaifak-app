import { db } from "../firebaseConfig";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

// Mirrors the window.storage.get/set/delete/list API the app was written
// against (Claude-artifact persistent storage), backed by Firestore instead.
// Every key becomes one document in the "khaifak_data" collection.
const COLLECTION = "khaifak_data";

function safeId(key) {
  // Firestore doc IDs can't contain "/". Our keys sometimes do (e.g. "plot_photo:abc123" is fine,
  // but be defensive anyway).
  return key.replace(/\//g, "__");
}

export const storage = {
  async get(key) {
    const ref = doc(db, COLLECTION, safeId(key));
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error(`not found: ${key}`);
    return { key, value: snap.data().value, shared: false };
  },

  async set(key, value) {
    const ref = doc(db, COLLECTION, safeId(key));
    await setDoc(ref, { value, updatedAt: Date.now() });
    return { key, value, shared: false };
  },

  async delete(key) {
    const ref = doc(db, COLLECTION, safeId(key));
    await deleteDoc(ref);
    return { key, deleted: true, shared: false };
  },

  async list(prefix) {
    const snap = await getDocs(collection(db, COLLECTION));
    const keys = [];
    snap.forEach((d) => {
      const k = d.id.replace(/__/g, "/");
      if (!prefix || k.startsWith(prefix)) keys.push(k);
    });
    return { keys, prefix, shared: false };
  },
};
