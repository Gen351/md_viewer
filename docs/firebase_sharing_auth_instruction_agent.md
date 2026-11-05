# Firebase Sharing + Google Auth - AI Agent Instructions

This document provides concrete instructions for implementing Google Authentication and Firestore-backed permissioned documents. Follow this alongside `docs/firebase_sharing_plan.md` as your source of truth.

## Goal
Implement Google sign-in and a Google Docs-style document system using Firestore collections `users`, `documents`, and `document_access`. Gate document operations behind authentication. Keep existing hash-based sharing as a fallback.

## Prerequisites (Must Exist)
- `src/js/firebase-config.js` with `window.FIREBASE_CONFIG` (created by developer)
- Firebase project with Google Auth enabled
- Firestore with rules published per dev instructions
- Running on local HTTP server (e.g., `python -m http.server`) for testing auth

## Firestore Schema
| Collection | Doc ID | Fields |
| :--- | :--- | :--- |
| `users` | Auth UID | `email` (string) |
| `documents` | Auto-generated ID | `name` (string), `content` (string), `ownerId` (string) |
| `document_access` | Same as `documentId` (1:1) | `userId` (string), `accessType` ("owner" \| "editor" \| "viewer") |

## Files to Modify
- `index.html` - Add Firebase SDK, config script, auth UI
- `src/js/app.js` - Firebase init, auth, Firestore CRUD, URL handling, UI wiring
- `src/css/styles.css` - Minimal auth UI styles (if needed)
- `README.md` - Document new features

## Implementation Steps

### 1) Add Firebase SDK to index.html
Edit `index.html`. Load in this exact order:

```html
<!-- Firebase config (classic, gitignored) -->
<script src="src/js/firebase-config.js"></script>

<!-- Firebase SDK (module) - expose only needed APIs -->
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
  import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
  import { getFirestore, doc, getDoc, setDoc, addDoc, collection, serverTimestamp, updateDoc, deleteDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

  window.firebase = {
    initializeApp,
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    getFirestore,
    doc,
    getDoc,
    setDoc,
    addDoc,
    collection,
    serverTimestamp,
    updateDoc,
    deleteDoc,
    query,
    where,
    getDocs
  };
</script>

<!-- App -->
<script src="src/js/app.js"></script>
```

Notes:
- Use `13.1.0` for all imports
- Do NOT add `firebase-analytics`
- `app.js` is classic and reads `window.FIREBASE_CONFIG` and `window.firebase`. This order is correct since module executes after parsing
- Google sign-in will not work with `file://`. Use `python -m http.server` or Live Server

### 2) Add Auth UI to index.html
Add to header or menu area:
```html
<div class="auth-section">
  <button id="btnSignIn" class="btn">Sign in with Google</button>
  <div id="userProfile" class="user-profile hidden">
    <span id="userEmail"></span>
    <button id="btnSignOut" class="btn">Sign out</button>
  </div>
</div>
```

### 3) Update app.js
Add to `elements` object:
```js
btnSignIn: null,
btnSignOut: null,
userProfile: null,
userEmail: null
```

Add Firebase state:
```js
let firebaseApp = null;
let auth = null;
let db = null;
const authState = { user: null, loading: true };
```

Cache elements and bind events in `init()` flow.

### 4) Implement Firebase Functions
```js
function initFirebase() {
  if (!window.FIREBASE_CONFIG || !window.firebase) return;
  try {
    firebaseApp = window.firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = window.firebase.getAuth(firebaseApp);
    db = window.firebase.getFirestore(firebaseApp);
    window.firebase.onAuthStateChanged(auth, (user) => {
      authState.user = user;
      authState.loading = false;
      ensureUserProfile(user);
      updateAuthUI();
    });
  } catch (e) {
    console.error('Firebase init failed:', e);
  }
}

async function ensureUserProfile(user) {
  if (!user || !db) return;
  const userRef = window.firebase.doc(db, 'users', user.uid);
  const snap = await window.firebase.getDoc(userRef);
  if (!snap.exists()) {
    await window.firebase.setDoc(userRef, { email: user.email });
  }
}

async function signInWithGoogle() {
  if (!auth) return;
  const provider = new window.firebase.GoogleAuthProvider();
  try {
    await window.firebase.signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Sign in failed:', e);
    openShareModal('Sign in failed', e.message);
  }
}

async function signOutUser() {
  if (!auth) return;
  try {
    await window.firebase.signOut(auth);
  } catch (e) {
    console.error('Sign out failed:', e);
  }
}

function updateAuthUI() {
  const { btnSignIn, userProfile, userEmail } = elements;
  if (authState.user) {
    btnSignIn?.classList.add('hidden');
    userProfile?.classList.remove('hidden');
    if (userEmail) userEmail.textContent = authState.user.email;
  } else {
    btnSignIn?.classList.remove('hidden');
    userProfile?.classList.add('hidden');
  }
}
```

### 5) Document CRUD
```js
async function createUserDocument(name, content) {
  if (!authState.user || !db) throw new Error('Not authenticated');
  const docRef = await window.firebase.addDoc(
    window.firebase.collection(db, 'documents'),
    { name, content, ownerId: authState.user.uid }
  );
  await window.firebase.setDoc(
    window.firebase.doc(db, 'document_access', docRef.id),
    { userId: authState.user.uid, accessType: 'owner' }
  );
  return docRef.id;
}

async function loadUserDocument(docId) {
  if (!authState.user || !db) throw new Error('Not authenticated');
  const accessRef = window.firebase.doc(db, 'document_access', docId);
  const accessSnap = await window.firebase.getDoc(accessRef);
  if (!accessSnap.exists()) throw new Error('No access');
  if (accessSnap.data().userId !== authState.user.uid) throw new Error('No access');
  
  const docRef = window.firebase.doc(db, 'documents', docId);
  const docSnap = await window.firebase.getDoc(docRef);
  if (!docSnap.exists()) throw new Error('Document not found');
  
  const data = docSnap.data();
  elements.editor.value = data.content;
  state.content = data.content;
  state.filename = data.name;
  updateFilenameDisplay();
  renderPreview();
}
```

### 6) URL Loading
In `loadState()`:
```js
// Parse for document ID
const params = new URLSearchParams(window.location.hash.substring(1));
const docId = params.get('d');
if (docId && authState.user) {
  loadUserDocument(docId).then(() => {
    state.viewMode = VIEW_MODES.VIEW_ONLY;
    applyViewMode();
    history.replaceState(null, document.title, window.location.pathname + window.location.search);
  }).catch(e => {
    console.error(e);
    openShareModal('Cannot load document', e.message);
  });
}
// Keep existing hash content import logic
```

### 7) Update Share Flow
In `shareFile()`:
```js
async function shareFile() {
  closeMenu();
  const content = elements.editor.value;
  if (!content.trim()) {
    openShareModal('Nothing to share', 'Write something first.');
    return;
  }
  
  if (authState.user && db) {
    try {
      const docId = await createUserDocument(state.filename || 'untitled.md', content);
      const link = `${location.origin}${location.pathname}#d=${docId}`;
      await copyText(link);
      flashShareButton();
      return;
    } catch (e) {
      console.error(e);
    }
  }
  
  // Fallback to existing hash share
  // ... existing code ...
}
```

## Rules to Follow
- Check `authState.user` before any Firestore write/read that requires auth
- Always create both `documents` and `document_access` together
- Use same ID for `document_access` as `document`
- Respect access levels (owner/editor can edit, viewer read-only)
- Keep hash-based share as fallback
- Don't modify Firebase rules
- Don't create or modify `firebase-config.js` (dev creates it locally)
- Do not inline config. Read `window.FIREBASE_CONFIG`
- Test on HTTP server, not file://
- Use existing modal for messages
- Follow existing code style

## Testing Checklist
- [ ] Firebase loads without errors
- [ ] Google sign-in works
- [ ] User profile created
- [ ] Document + access doc created
- [ ] Document loads via `?d=`
- [ ] Permissions enforced
- [ ] Fallback share works
- [ ] No regressions

Refer to `docs/firebase_sharing_plan.md` for detailed tracking.
