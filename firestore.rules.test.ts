/**
 * Firestore Security Rules Verification Spec (Dirty Dozen Payloads)
 * Maps each attack vector from security_spec.md to the exact rule guard in firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  expected: 'PERMISSION_DENIED';
  guard: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Read',
    operation: 'get',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'isVerifiedOwner(userId) requires request.auth != null',
  },
  {
    id: 2,
    name: 'Cross-User PII Read',
    operation: 'get',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'isVerifiedOwner(userId) requires request.auth.uid == userId',
  },
  {
    id: 3,
    name: 'Blanket User Directory Scrape',
    operation: 'list',
    path: '/users',
    expected: 'PERMISSION_DENIED',
    guard: 'allow list: if false on /users/{userId}',
  },
  {
    id: 4,
    name: 'Unverified Email Spoof',
    operation: 'create',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'isVerifiedUser() mandates request.auth.token.email_verified == true',
  },
  {
    id: 5,
    name: 'Identity Spoofing on Create',
    operation: 'create',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'isValidUserProfile enforces data.uid == request.auth.uid && data.uid == userId',
  },
  {
    id: 6,
    name: 'Shadow Field Injection (isAdmin / unlimitedQuota)',
    operation: 'create',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'data.keys().hasOnly([...]) rejects all undeclared fields',
  },
  {
    id: 7,
    name: 'Invalid Visual Style Enum Value',
    operation: 'update',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'isValidStyleId(data.preferredStyle) allowlist check',
  },
  {
    id: 8,
    name: 'Resource Poisoning (Oversized displayName / ID)',
    operation: 'create',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'isValidId(userId) and data.displayName.size() <= 120',
  },
  {
    id: 9,
    name: 'Immutable Field Mutation (createdAt / uid)',
    operation: 'update',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    guard: 'incoming().uid == existing().uid && incoming().createdAt == existing().createdAt && affectedKeys().hasOnly([...])',
  },
  {
    id: 10,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    path: '/users/userA/quotas/2026-11-22',
    expected: 'PERMISSION_DENIED',
    guard: 'incoming().createdAt == request.time && incoming().updatedAt == request.time',
  },
  {
    id: 11,
    name: 'Quota Reset / Limit Escalation Attack',
    operation: 'update',
    path: '/users/userA/quotas/2026-11-22',
    expected: 'PERMISSION_DENIED',
    guard: 'incoming().dailyLimit == existing().dailyLimit && incoming().imagesUsed >= existing().imagesUsed',
  },
  {
    id: 12,
    name: 'Quota Deletion Bypass',
    operation: 'delete',
    path: '/users/userA/quotas/2026-11-22',
    expected: 'PERMISSION_DENIED',
    guard: 'allow delete: if false on /users/{userId}/quotas/{dateKey}',
  },
];
