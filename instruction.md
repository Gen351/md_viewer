# Instructions: Connect InPlainSite to Markdown Viewer Editor

This guide is for modifying the **InPlainSite** app so it can send decrypted output text directly to the **Markdown Viewer Editor** app.

---

## 1. The Challenge: Same-Origin Policy
Because `inplainsite.vercel.app` and your **Markdown Viewer** run on different domains (origins), they **cannot** share `localStorage` directly. The browser's Same-Origin Policy prevents one website from reading or writing another website's local storage.

## 2. The Solution: URL Hash Parameter Transfer
To solve this, we have configured **Markdown Viewer** to listen for data passed via the URL hash (e.g., `#content=...&filename=...`). 

When Markdown Viewer loads:
1. It detects if there is a `content` parameter in the URL hash.
2. It decodes the text, saves it directly into **its own local storage**, and displays it in the editor.
3. It cleans up the URL bar (removing the hash) so refreshing the page does not overwrite future user edits.

---

## 3. How to Modify the InPlainSite Codebase

Follow these instructions to add an **"Open in Markdown Viewer"** button to the decryption/output interface of InPlainSite.

### Step A: Identify the UI Location
Locate the section of HTML/JS in InPlainSite containing the **"Copy Data to Clipboard"** button or the output textarea (e.g., around the "Secured Message Box Output").

### Step B: Add the Button HTML
Add a button element next to the copy button. For example:

```html
<button id="btnOpenMD" class="btn btn-secondary">
  Open in Markdown Viewer
</button>
```

### Step C: Implement the Redirection Logic
Add the following JavaScript to handle the button click. It will extract the text, encode it, and open it in the Markdown Viewer:

```javascript
// 1. Define the destination URL (configure this as needed)
const MD_VIEWER_URL = 'http://localhost:5500'; // Or your deployed production URL, e.g., 'https://my-md-viewer.vercel.app'

// 2. Add click handler to the button
document.getElementById('btnOpenMD').addEventListener('click', () => {
  // Grab the text from your decrypted output textarea/div (adjust selector as needed)
  const outputTextarea = document.querySelector('#output') || document.querySelector('.secured-message-box');
  const text = outputTextarea ? outputTextarea.value || outputTextarea.innerText : '';

  if (!text.trim()) {
    alert('There is no content to view! Decrypt some data first.');
    return;
  }

  // Define a default filename for the imported content
  const filename = 'Decrypted_Record.md';

  // Encode the content for a URL hash safely
  const encodedContent = encodeURIComponent(text);
  const encodedFilename = encodeURIComponent(filename);

  // Construct the target URL using the hash parameter strategy
  const targetUrl = `${MD_VIEWER_URL}/#content=${encodedContent}&filename=${encodedFilename}`;

  // Open the Markdown Viewer in a new tab
  window.open(targetUrl, '_blank');
});
```

---

## 4. How the Markdown Viewer Receives This (For Reference)
For context, the **Markdown Viewer**'s `src/js/app.js` is already modified to parse and handle this incoming data in its `loadState` function:

```javascript
function loadState() {
  state.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
  state.viewMode = localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || VIEW_MODES.SPLIT;

  // Check if content was passed via URL hash (cross-origin import)
  let hashContent = '';
  let hashFilename = '';
  try {
    const hash = window.location.hash.substring(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      if (params.has('content')) {
        hashContent = decodeURIComponent(params.get('content'));
      }
      if (params.has('filename')) {
        hashFilename = decodeURIComponent(params.get('filename'));
      }
    }
  } catch (e) {
    console.error('Failed to parse content from URL hash:', e);
  }

  if (hashContent) {
    state.content = hashContent;
    state.filename = hashFilename || 'imported.md';
    // Persist the imported content to local storage
    localStorage.setItem(STORAGE_KEYS.CONTENT, state.content);
    localStorage.setItem(STORAGE_KEYS.FILENAME, state.filename);
    // Clean up the hash in the browser address bar
    history.replaceState(null, document.title, window.location.pathname + window.location.search);
  } else {
    state.content = localStorage.getItem(STORAGE_KEYS.CONTENT) || '';
    state.filename = localStorage.getItem(STORAGE_KEYS.FILENAME) || '';
  }

  elements.editor.value = state.content;
}
```
