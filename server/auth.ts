import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  name: string;
  picture: string;
  emailVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
}

function loadFirebaseProjectId(): string {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error('firebase-applet-config.json is missing. Provision Firebase first.');
  }
  const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
  if (!parsed.projectId || parsed.projectId === 'remixed-project-id') {
    throw new Error('Invalid projectId in firebase-applet-config.json.');
  }
  return parsed.projectId;
}

function getFirebaseAdminAuth() {
  const projectId = loadFirebaseProjectId();
  const app = getApps().length ? getApp() : initializeApp({ projectId });
  return getAuth(app);
}

// Ephemeral HMAC key for short-lived <video>/<img> media streaming URLs
const MEDIA_TOKEN_SECRET = process.env.MEDIA_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const MEDIA_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function createMediaToken(jobId: string, uid: string): string {
  const exp = Date.now() + MEDIA_TOKEN_TTL_MS;
  const payload = `${jobId}.${uid}.${exp}`;
  const sig = crypto.createHmac('sha256', MEDIA_TOKEN_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

export function verifyMediaToken(token: string, expectedJobId: string): { uid: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, providedSig] = parts;
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const expectedSig = crypto
      .createHmac('sha256', MEDIA_TOKEN_SECRET)
      .update(payload)
      .digest('base64url');

    const a = Buffer.from(providedSig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const [jobId, uid, expStr] = payload.split('.');
    const exp = Number(expStr);
    if (!jobId || !uid || !Number.isFinite(exp) || Date.now() > exp) return null;
    if (jobId !== expectedJobId) return null;
    return { uid };
  } catch {
    return null;
  }
}

export async function verifyBearerHeader(authHeader?: string): Promise<AuthenticatedUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(idToken);
    if (!decoded.uid) return null;
    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      name: (decoded.name as string | undefined) ?? decoded.email ?? 'Google User',
      picture: (decoded.picture as string | undefined) ?? '',
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    return null;
  }
}

export async function requireGoogleAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await verifyBearerHeader(req.headers.authorization);
  if (!user) {
    res.status(401).json({
      error: 'Please sign in with Google to use Cartoon AI Studio and your Nano Banana quota.',
    });
    return;
  }
  req.authUser = user;
  next();
}
