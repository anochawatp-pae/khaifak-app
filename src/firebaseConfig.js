import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// These come from your Firebase project settings (Project settings → General →
// "Your apps" → SDK setup and configuration). They are safe to expose in the
// browser bundle — they are not secret keys, just project identifiers.
// Set the real values in Netlify: Site settings → Environment variables.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
