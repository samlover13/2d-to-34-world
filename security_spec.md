# Cartoon AI Studio — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Owner-Only PII Isolation (`/users/{userId}`)**: A user profile contains PII (`email`, `displayName`, `photoUrl`). Only the verified Google owner (`request.auth.uid == userId` and `request.auth.token.email_verified == true`) can `get`, `create`, or `update` their own profile. Blanket `list` queries on `/users` are strictly denied.
2. **Master Gate Subcollection Sync (`/users/{userId}/quotas/{dateKey}`)**: A daily Nano Banana quota record can only be created or updated if the parent `/users/{userId}` document exists (`exists(...)`), `userId == request.auth.uid`, and `dateKey` strictly matches `YYYY-MM-DD`.
3. **Anti-Tamper Quota Integrity**: Quota records cannot be deleted by clients, `dailyLimit` is bounded (`1..500`) and immutable after creation, `imagesUsed` cannot be decremented below its existing value (`incoming().imagesUsed >= existing().imagesUsed`) and cannot exceed `existing().dailyLimit`, and authoritative quota enforcement always occurs on the Express backend.
4. **Immutable & Server-Timestamp Integrity**: `uid`, `dateKey`, and `createdAt` are immutable on update; `createdAt` (on create) and `updatedAt` (on create & update) must strictly equal `request.time`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return `PERMISSION_DENIED`)
1. **Unauthenticated Read**: `GET /users/userA` with `auth == null`.
2. **Cross-User PII Read**: `GET /users/userA` authenticated as `userB`.
3. **Blanket User Directory Scrape**: `LIST /users` authenticated as `userA`.
4. **Unverified Email Spoof**: `CREATE /users/userA` with `email_verified: false`.
5. **Identity Spoofing on Create**: `CREATE /users/userA` with `uid: "userB"` while authenticated as `userA`.
6. **Shadow Field Injection**: `CREATE /users/userA` including ghost field `isAdmin: true` or `unlimitedQuota: true`.
7. **Invalid Enum Value**: `UPDATE /users/userA` setting `preferredStyle: "arbitrary_prompt_injection"`.
8. **Resource Poisoning (Oversized ID / String)**: `CREATE /users/userA` with `displayName` of 500 characters or invalid path ID containing spaces/slashes.
9. **Immutable Field Mutation**: `UPDATE /users/userA` modifying `createdAt` or `uid`.
10. **Client Timestamp Forgery**: `CREATE /users/userA/quotas/2026-11-22` with backdated `createdAt` instead of `request.time`.
11. **Quota Reset / Decrement Attack**: `UPDATE /users/userA/quotas/2026-11-22` trying to reduce `imagesUsed` from `40` to `0` or raise `dailyLimit` from `100` to `99999`.
12. **Quota Deletion Bypass**: `DELETE /users/userA/quotas/2026-11-22` to erase today's usage count.
