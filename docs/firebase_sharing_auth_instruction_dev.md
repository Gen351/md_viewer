# Firebase Sharing + Google Auth - Developer Setup Instructions

This document outlines everything you need to do manually to set up Firebase (Authentication + Firestore) so the AI agent can implement "Publish as Link" with Google sign-in for authorized actions.

## Overview
We want to replace/augment the current hash-based Share with a Firebase-backed short link system, and gate "Publish as Link" behind Google Authentication (like Google Docs). This keeps content out of long URLs and allows managing published documents.

## Prerequisites
- A Google account
- Access to [Firebase Console](https://console.firebase.google.com/)
- Access to [Google Cloud Console](https://console.cloud.google.com/) (for OAuth configuration if needed)
- The app is a static vanilla JS site (no bundler) hosted locally or on static hosting (e.g. GitHub Pages, Vercel, Firebase Hosting)

## Step 1: Create a Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Give it a name (e.g. `md-viewer-editor`)
4. (Optional) Enable Google Analytics
5. Create the project

## Step 2: Register your web app
1. In your project, go to Project Settings > General
2. Under "Your apps", click the web icon (`</>`)
3. Register app with nickname (e.g. `md-viewer-web`)
4. Check "Also set up Firebase Hosting" if you plan to deploy there (optional now)
5. Click "Register app"
6. Copy the Firebase config object - you'll need this later:
```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
  // measurementId omitted intentionally
};
```

## Step 3: Enable Google Authentication
1. Go to Build > Authentication > Sign-in method
2. Click "Google" provider
3. Toggle "Enable"
4. Set a support email
5. Save
6. Under "Authorized domains", add your domains where the app will run (e.g. `localhost`, your GitHub Pages domain, `your-app.web.app`)

## Step 4: Set up Firestore Database
1. Go to Build > Firestore Database
2. Click "Create database"
3. Choose "Start in test mode" for initial development OR "Production mode" - better to use production mode and set rules
4. Select a location (choose closest to your users)
5. Create database

## Firestore Database Design:
### Collections
#### 1. `users`
Represents the registered users in the application.
* **Document ID:** `userId` (Google Authenticated UID)
* **Fields:**
  * `email` (string)
#### 2. `documents`
Stores the actual markdown documents created by users.
* **Document ID:** Auto-generated ID
* **Fields:**
  * `name` (string)
  * `content` (string)
  * `ownerId` (string): References the document owner in string form (points to `users/userId`)
#### 3. `document_access`
Manages permissions and rules for which users can view or modify specific documents.
* **Document ID:** Same as the target `documentId` it references (1-to-1 mapping with the document)
* **Fields:**
  * `accessType` (string): Allowed values are `"owner"`, `"editor"`, or `"viewer"`.
  * `userId` (string): References a user document ID in string form (points to `users/userId`).

## Step 5: Configure Firestore Security Rules
Go to Firestore > Rules and replace the existing rules with the following to match the database design: 

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users collection - only the user can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.auth.uid == userId;
    }
    
    // Documents collection - access controlled via document_access
    match /documents/{documentId} {
      // Allow read if user is owner, editor, or viewer via document_access
      allow read: if request.auth != null && (
        exists(/databases/$(database)/documents/document_access/$(documentId)) &&
        get(/databases/$(database)/documents/document_access/$(documentId)).data.userId == request.auth.uid
      );
      
      // Allow create if authenticated and they set themselves as owner
      allow create: if request.auth != null 
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.name is string
        && request.resource.data.content is string;
      
      // Allow update/delete only if user has owner or editor access
      allow update, delete: if request.auth != null && (
        exists(/databases/$(database)/documents/document_access/$(documentId)) &&
        get(/databases/$(database)/documents/document_access/$(documentId)).data.userId == request.auth.uid &&
        get(/databases/$(database)/documents/document_access/$(documentId)).data.accessType in ['owner', 'editor']
      );
    }
    
    // Document access collection - controls permissions
    match /document_access/{documentId} {
      // Only accessible to the user with access to this document
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      
      // Only allow creation if the creator is the owner
      allow create: if request.auth != null 
        && request.resource.data.accessType == 'owner'
        && request.resource.data.userId == request.auth.uid;
      
      // Only owners can modify access permissions
      allow update, delete: if request.auth != null && 
        resource.data.userId == request.auth.uid &&
        resource.data.accessType == 'owner';
    }
  }
}
```

> **Notes:** 
> - This design requires you to create a `document_access` document alongside every new `document` to grant permissions. 
> - Since `document_access` uses the same ID as the `document` it's referencing, this 1-to-1 mapping is enforced by your application logic.
> - If you still want a public "Publish as Link" feature (like the original share button), you'll need a separate `shares` collection with different rules, as this design is tailored towards authenticated, permissioned documents similar to Google Docs. 
> - Be sure to test these rules with the Rules Playground in the Firebase Console before publishing. 

Publish the rules once you're satisfied with them.

> Note: Adjust size limits based on needs. Also consider App Check for production.

Publish the rules.

## Step 6: Get Firebase SDK setup ready
The app uses no bundler, so we'll use Firebase 13.1.0 modular SDK via CDN. The agent will add the necessary script tags and initialization logic.

## Step 7: Create your Firebase config file (local only)
Do **not** commit your real Firebase web config to git.

1. Copy `src/js/firebase-config.example.js` to `src/js/firebase-config.js`
   ```bash
   cp src/js/firebase-config.example.js src/js/firebase-config.js
   ```
   (On Windows you can just duplicate the file in File Explorer)

2. Open `src/js/firebase-config.js` and fill in the values from your Firebase web app config (Project Settings > General > Your apps > Web app)

   ```js
   // src/js/firebase-config.js
   // CLASSIC script. Loaded before app.js
   window.FIREBASE_CONFIG = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_AUTH_DOMAIN",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_STORAGE_BUCKET",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

> Notes:
> - `src/js/firebase-config.js` is added to `.gitignore`. Never commit it.
> - The `apiKey` is an identifier for your Firebase project on the web. It is not a secret. Lock it down in Google Cloud Console > Credentials > API key restrictions (HTTP referrers for `localhost:8000`, your deployed domain) and rely on Firestore Security Rules.
> - Omit `measurementId` unless you explicitly add Firebase Analytics later.
> - This must be a classic script, `app.js` is classic and reads `window.FIREBASE_CONFIG`.

## Step 8: Test OAuth locally
- For `localhost`, Firebase Auth works by default if added to authorized domains (it usually is)
- For file:// protocol, Google sign-in may not work - better to use a local server (e.g. `python -m http.server` or VS Code Live Server)

## Checklist for Developer
- [x] Firebase project created
- [x] Web app registered, config copied
- [x] Google Auth enabled with support email
- [x] Firestore created with security rules published
- [x] Authorized domains configured (localhost + your hosting domain)
- [ ] `src/js/firebase-config.example.js` copied to `src/js/firebase-config.js` and filled
- [ ] API key restricted in Google Cloud Console (HTTP referrers + API restrictions)
- [ ] Local server available for testing auth (http://localhost:8000)

Only create `firebase-config.js`. Do not edit `app.js`, `index.html`, CSS, or other files. The agent will handle the implementation.

Everything is set up. The agent can now proceed with implementation using the config and database design above.
