import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  setLogLevel,
  doc,
  getDocFromServer,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';

// Suppress noisy internal @firebase/firestore offline/timeout logs in offline-first POS mode
try {
  setLogLevel('silent');
} catch {
  // ignore if unsupported
}

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Auth with Google Provider
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Firestore with provisioned Database ID and automatic long-polling detection for proxy/iframe environments
function createFirestoreInstance(): Firestore {
  const dbId = firebaseConfig.firestoreDatabaseId;
  try {
    return dbId
      ? initializeFirestore(
          app,
          {
            experimentalAutoDetectLongPolling: true,
          },
          dbId
        )
      : initializeFirestore(app, {
          experimentalAutoDetectLongPolling: true,
        });
  } catch {
    return dbId ? getFirestore(app, dbId) : getFirestore(app);
  }
}

export const db = createFirestoreInstance();

// Validate Connection to Firestore on demand when online and authenticated
export async function validateFirestoreConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase connection: client appears offline.');
    }
    return false;
  }
}

export default app;

