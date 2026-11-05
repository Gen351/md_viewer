# Firebase Sharing + Google Auth - Implementation Plan

> **Purpose:** A concrete, trackable plan for an AI agent to implement Google sign-in and permissioned document storage (Google Docs style) using the Firestore design below.  
> **Coordinator:** This document. Update status as you go.  
> **Target Agent:** A separate coding agent implementing this plan.  

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Done
- [!] Blocked
- [?] Needs Verification

## Project Context
- Stack: Vanilla HTML, CSS, JavaScript (no bundler, no framework)
- Existing features: hash-based share (`#content=...&filename=...`), file open/save, live preview, split/focus/view-only, themes, math, code highlighting, scroll sync
- Goal: Add Google Authentication + Firestore-backed permissioned documents (`users`, `documents`, `document_access`). Gate document operations behind auth. Keep existing hash-based share as a fallback.

## Firestore Schema (Source of Truth)
| Collection | Document ID | Fields | Notes |
| :--- | :--- | :--- | :--- |
| `users` | Firebase Auth UID (`userId`) | `email` (string) | Created on first sign-in. |
| `documents` | Auto-generated ID | `name` (string), `content` (string), `ownerId` (string) | `ownerId` references `users/{uid}`. |
| `document_access` | Same as `documentId` (1:1 mapping) | `userId` (string), `accessType` (string) — one of `"owner"`, `"editor"`, `"viewer"` | Permission bridge. Must be created alongside the document. |

Firestore rules are already published by the developer and match this design.

## Prerequisites
- [x] Firebase project configured
- [x] Google Auth enabled
- [x] Firestore created with rules published
- [x] Authorized domains configured (localhost + hosting domain)
- [ ] `src/js/firebase-config.js` exists with `window.FIREBASE_CONFIG` (created by developer)
- [ ] Running via local HTTP server (not `file://`) for auth testing

## File Map
| File | Action | Purpose |
| :--- | :--- | :--- |
| `index.html` | Edit | Add Firebase SDK (module), load `firebase-config.js`, add auth UI elements, update menu/share UI. |
| `src/js/firebase-config.js` | Verify (expect exists) | Global config created by dev. Do not modify unless instructed. |
| `src/js/app.js` | Edit | Firebase init, auth state, Firestore CRUD, permission checks, URL loading (`?d=`), integrate with share flow, UI wiring. |
| `src/css/styles.css` | Edit (minimal) | Styles for auth/profile/sign-in button only if needed. |
| `README.md` | Edit | Document auth, Google Docs-style documents, Firestore usage. |
| `docs/firebase_sharing_auth_instruction_agent.md` | Update | Align with this plan and schema. |
| `docs/firebase_sharing_plan.md` | Create/Update | This tracking document. |

## Implementation Phases

### Phase 0: Pre-flight
- [ ] Verify `src/js/firebase-config.js` exists and defines `window.FIREBASE_CONFIG`
- [ ] Read `index.html`, `src/js/app.js`, `src/css/styles.css` fully to understand current structure
- [ ] Confirm no existing Firebase code
- [ ] Note current `btnShare` behavior for fallback preservation

### Phase 1: SDK & Firebase Initialization
**Goal:** Load Firebase without breaking existing functionality.

- [ ] Verify `src/js/firebase-config.js` exists (dev creates locally) and defines `window.FIREBASE_CONFIG`
- [ ] Verify `.gitignore` contains `src/js/firebase-config.js`
- [ ] Verify `src/js/firebase-config.example.js` exists with placeholders
- [ ] In `index.html`: add `<script src="src/js/firebase-config.js"></script>` (classic)
- [ ] In `index.html`: add single `type="module"` script loading Firebase 13.1.0 and setting `window.firebase` with only needed APIs (no analytics)
- [ ] In `index.html`: keep `<script src="src/js/app.js"></script>` last
- [ ] In `app.js`: add Firebase state (`firebaseApp`, `auth`, `db`, `authState = { user: null, loading: true }`) and element references for auth UI
- [ ] Implement `initFirebase()` reading `window.FIREBASE_CONFIG` and `window.firebase`, init app/auth/db, set up `onAuthStateChanged`
- [ ] Call `initFirebase()` from `init()`
- [ ] On first sign in, upsert user in `users/{uid}` with `email`
- [ ] **Test:** Load via `http://localhost:8000`, no console errors, Firebase initializes when config present

### Phase 2: Authentication UI & Flow
**Goal:** Google sign-in/sign-out working.

- [ ] In `index.html`: add auth UI in header/menu (e.g., sign-in button, user avatar/email, sign-out option)
- [ ] In `app.js`: implement `signInWithGoogle()` using `GoogleAuthProvider` + `signInWithPopup`
- [ ] In `app.js`: implement `signOutUser()` using `signOut(auth)`
- [ ] In `app.js`: implement `updateAuthUI()` to toggle between signed-in/signed-out states
- [ ] Wire event listeners for auth buttons
- [ ] Implement `ensureUserProfile(user)` to create/update `users/{uid}` with `email`
- [ ] **Test:** Sign in via Google popup on localhost, profile displays, sign out works, user doc created in Firestore

### Phase 3: Firestore Data Layer (Documents + Permissions)
**Goal:** CRUD operations matching schema.

- [ ] Implement `createUserDocument(name, content)`:
  - Create document in `documents` collection with `{ name, content, ownerId: auth.currentUser.uid }`
  - Get auto-generated `docId`
  - Create `document_access/{docId}` with `{ userId: auth.currentUser.uid, accessType: 'owner' }`
- [ ] Implement `loadUserDocument(docId)`:
  - Check access via `document_access/{docId}` - user must exist and match current user
  - Fetch document from `documents/{docId}`
  - Load into editor/preview, set appropriate filename/view
- [ ] Implement `saveUserDocument(docId, updates)`:
  - Check access - must be `owner` or `editor`
  - Update `documents/{docId}` with allowed fields
- [ ] Implement `getUserAccessibleDocuments()` (optional): query `document_access` where `userId == auth.currentUser.uid`, fetch corresponding documents
- [ ] Add permission checks before all operations
- [ ] **Test:** Create document creates both collections, load works with permissions, updates blocked for wrong user

### Phase 4: URL Routing & Integration
**Goal:** Load documents from URL, integrate with existing flows.

- [ ] In `loadState()`: parse URL for `d` parameter (document ID) from hash or search params
- [ ] If `d` present:
  - If not signed in → show auth prompt via modal
  - If signed in → call `loadUserDocument(d)`, set view to `VIEW_ONLY` by default, clean URL
- [ ] Update `shareFile()` or add new flow:
  - If signed in: offer to save current document to account (`createUserDocument` or `saveUserDocument`) and copy shareable link with `?d=<docId>`
  - If not signed in: fall back to existing hash-based share
- [ ] Preserve existing hash import (`#content=...&filename=...`) behavior
- [ ] **Test:** Load `?d=...` when signed in with access, auth prompt when not signed in, fallback share still works

### Phase 5: UI Polish & Documentation
**Goal:** Complete integration and docs.

- [ ] Update menu/share button text/tooltips to reflect new functionality
- [ ] Add minimal CSS for auth UI in `src/css/styles.css`
- [ ] Update `README.md` with Google Auth, Firestore documents, permissions, usage
- [ ] Update `docs/firebase_sharing_auth_instruction_agent.md` to align with this plan
- [ ] Add inline comments for Firebase-related code
- [ ] Run `node --check src/js/app.js`
- [ ] **Test:** All flows work end-to-end

## Testing Checklist
- [ ] Page loads without errors when `firebase-config.js` present
- [ ] Google sign-in works on localhost
- [ ] User created in `users` collection on first sign-in
- [ ] Create document creates `documents/{id}` and `document_access/{id}` with owner
- [ ] Load document via `?d=` works for owner
- [ ] Permission checks enforced (viewer cannot edit, etc.)
- [ ] Non-authenticated user prompted to sign in for private docs
- [ ] Existing file open/save still works
- [ ] Existing hash share still works
- [ ] Sign out works correctly
- [ ] No regressions in preview/editor functionality

## Agent Rules
- **ONLY** modify files in the File Map
- **DO NOT** modify Firebase security rules
- **DO NOT** create or modify `firebase-config.js` (dev creates it)
- **DO NOT** commit secrets
- Follow existing code style, patterns, and structure
- Keep changes minimal and surgical
- Preserve backward compatibility (hash share fallback)
- Use local HTTP server for testing auth (not `file://`)
- If blocked, mark task as [!] in this plan with reason
- Update this plan's status as you complete tasks

## Rollback Plan
If issues arise:
1. Remove Firebase SDK scripts from `index.html`
2. Revert `src/js/app.js` changes
3. Remove auth UI elements
4. App reverts to original functionality
5. All existing features remain intact

## Definition of Done
- [ ] All phases completed and tested
- [ ] All tests in checklist pass
- [ ] Documentation updated
- [ ] This plan fully marked complete
- [ ] No console errors
- [ ] No regressions to existing features
- [ ] Works on localhost with local server
