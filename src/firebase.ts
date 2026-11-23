import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, User, getAuth } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { ConversionMode, NanoBananaQuota, VisualStyleId } from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

const VALID_STYLES = new Set<VisualStyleId>([
  'pixar_3d',
  'stylized_3d',
  'cel_shaded_npr',
  'low_poly',
  'chibi_sd',
  'stop_motion_clay',
]);

function clampStr(val: string | null | undefined, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

export async function syncUserProfileToFirestore(
  user: User,
  preferredStyle: VisualStyleId = 'pixar_3d',
  preferredMode: ConversionMode = 'nano_banana_frames'
): Promise<void> {
  if (!user.uid || !user.emailVerified) return;
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const safeStyle: VisualStyleId = VALID_STYLES.has(preferredStyle) ? preferredStyle : 'pixar_3d';
  const safeMode: ConversionMode =
    preferredMode === 'veo_scenes' ? 'veo_scenes' : 'nano_banana_frames';

  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName: clampStr(user.displayName || 'Google User', 120),
        email: clampStr(user.email, 200),
        photoUrl: clampStr(user.photoURL, 500),
        preferredStyle: safeStyle,
        preferredMode: safeMode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: clampStr(user.displayName || 'Google User', 120),
        email: clampStr(user.email, 200),
        photoUrl: clampStr(user.photoURL, 500),
        preferredStyle: safeStyle,
        preferredMode: safeMode,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export async function syncQuotaToFirestore(
  user: User,
  quota: NanoBananaQuota,
  lastJobId = ''
): Promise<void> {
  if (!user.uid || !user.emailVerified) return;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(quota.dateKey)) return;

  const quotaPath = `users/${user.uid}/quotas/${quota.dateKey}`;
  const ref = doc(db, 'users', user.uid, 'quotas', quota.dateKey);
  const safeLimit = Math.max(1, Math.min(500, Math.round(quota.dailyLimit)));
  const safeUsed = Math.max(0, Math.min(safeLimit, Math.round(quota.imagesUsed)));
  const safeJobId = clampStr(lastJobId, 64);

  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        dateKey: quota.dateKey,
        dailyLimit: safeLimit,
        imagesUsed: safeUsed,
        lastJobId: safeJobId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const prevUsed = Number(existing.data()?.imagesUsed ?? 0);
      const nextUsed = Math.max(prevUsed, safeUsed);
      await updateDoc(ref, {
        imagesUsed: Math.min(safeLimit, nextUsed),
        lastJobId: safeJobId,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, quotaPath);
  }
}
