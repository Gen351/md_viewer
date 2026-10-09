# Markdown Viewer Editor

A modern, minimal single-page Markdown editor with live preview, built with vanilla HTML, CSS, and JavaScript. No build step, no dependencies to install — just open `index.html` in your browser.

## Architecture Overview

The app is structured as a **single IIFE** (`src/js/app.js`) that encapsulates all logic. It follows a **state-driven, event-based** architecture:

```
User Input (keyboard/toolbar) → State Update → Debounce (100ms) → Render → Preview
                                                                              ↓
                                                                    localStorage persistence
```

### Initialization Sequence
1. `cacheElements()` — grabs all DOM references by ID
2. `loadState()` — restores theme, view mode, content, filename from `localStorage`
3. `applyTheme()` — sets `data-theme` attribute on `<html>`
4. `applyViewMode()` — toggles `.hidden` class on panes
5. `configureMarked()` — creates `marked.Marked` instance with custom renderer (heading anchors, link targets)
6. `bindEvents()` — attaches all event listeners
7. `renderPreview()` — renders initial content
8. `updateFilenameDisplay()` — shows filename badge if present

### State Management

All app state lives in a single `state` object:

| Property | Type | Description |
|----------|------|-------------|
| `viewMode` | `string` | `'focus'`, `'split'`, or `'view-only'` |
| `theme` | `string` | `'light'` or `'dark'` |
| `content` | `string` | Current editor text |
| `filename` | `string` | Name of the opened/saved file |
| `fileHandle` | `FileSystemFileHandle \| null` | Handle for direct file writes (File System Access API) |
| `mathMode` | `string` | `'off'`, `'inline'`, `'display'`, `'dollars'`, `'latex'`, or `'all'` |
| `codeTheme` | `string` | `'auto'`, `'github'`, `'github-dark'`, `'monokai'`, `'dracula'`, or `'nord'` |

### localStorage Keys

| Key | Stores |
|-----|--------|
| `md-editor-theme` | Current theme (`'light'` / `'dark'`) |
| `md-editor-view-mode` | Current view mode (`'focus'` / `'split'` / `'view-only'`) |
| `md-editor-content` | Editor content (auto-saved on every render) |
| `md-editor-filename` | Last opened filename |
| `md-editor-math-mode` | Selected math rendering mode |
| `md-editor-code-theme` | Selected code highlighting theme |

### DOM Element IDs

| ID | Element | Purpose |
|----|---------|---------|
| `appMain` | `<main>` | Flex container for editor + preview panes |
| `editor` | `<textarea>` | Markdown input area |
| `editorPane` | `<div>` | Left pane wrapper (`.pane.editor-pane`) |
| `preview` | `<div>` | Rendered HTML output container |
| `previewPane` | `<div>` | Right pane wrapper (`.pane.preview-pane`) |
| `btnBold` | `<button>` | Bold formatting |
| `btnH1` | `<button>` | Heading 1 insertion |
| `btnItalic` | `<button>` | Italic formatting |
| `btnList` | `<button>` | Bullet list insertion |
| `btnLink` | `<button>` | Link insertion |
| `btnCode` | `<button>` | Inline code formatting |
| `btnFocus` | `<button>` | Focus view mode |
| `btnSplit` | `<button>` | Split view mode |
| `btnViewOnly` | `<button>` | View-only mode |
| `btnOpen` | `<button>` | Open file picker |
| `btnSave` | `<button>` | Save file |
| `btnShare` | `<button>` | Copy shareable link |
| `btnTheme` | `<button>` | Toggle light/dark theme |
| `shareModal` | `<div>` | Share feedback modal overlay (`.modal-overlay`) |
| `shareModalTitle` | `<h2>` | Modal title |
| `shareModalMessage` | `<p>` | Modal message |
| `shareModalClose` | `<button>` | Modal close button |
| `mathjaxScript` | `<script>` | MathJax library tag (load detection) |
| `menuBtn` | `<button>` | Settings menu (gear) trigger |
| `settingsMenu` | `<div>` | Settings menu panel (`.menu`) |
| `mathMenuBtn` | `<button>` | Math flyout parent row |
| `mathFlyout` | `<div>` | Math mode options (`.flyout`) |
| `codeMenuBtn` | `<button>` | Code Themes flyout parent row |
| `codeFlyout` | `<div>` | Code theme options (`.flyout`) |
| `hljsTheme` | `<link>` | Active highlight.js theme stylesheet (swapped on demand) |
| `hljsScript` | `<script>` | highlight.js library tag (load detection) |
| `fileInput` | `<input type="file">` | Hidden file input (fallback for open) |
| `filenameDisplay` | `<span>` | Shows current filename badge |

## Features

### View Modes

Three mutually exclusive modes controlled by CSS class toggling:

| Mode | Editor Pane | Preview Pane | CSS Behavior |
|------|-------------|--------------|--------------|
| **Split** | Visible | Visible | Both `flex: 1` |
| **Focus** | Visible | Hidden | Preview gets `.hidden` → `flex: 0 0 0; opacity: 0; pointer-events: none` |
| **View-Only** | Hidden | Visible | Editor gets `.hidden` → same collapse behavior |

Mode is persisted in `localStorage` and restored on load. `Escape` key resets to Split.

Hidden panes are also removed from keyboard focus and assistive tech: the pane gets `inert` + `aria-hidden` (with a CSS `visibility: hidden` fallback for browsers without `inert` support), so Tab traversal and screen readers never enter a hidden pane.

### Formatting Toolbar

Six toolbar buttons in the header center, separated from view-mode buttons by a vertical divider. Each manipulates the textarea selection:

| Button | Behavior | Wraps Selection? | Placeholder |
|--------|----------|------------------|-------------|
| **Bold** | Inserts `**text**` | Yes | `text` |
| **H1** | Prepends `# ` to current line | No (line-level) | N/A |
| **Italic** | Inserts `*text*` | Yes | `text` |
| **Bullet List** | Inserts `- ` at cursor line start | No (line-level) | N/A |
| **Link** | Inserts `[text](url)` | Yes (wraps, leaves `url` editable) | `text` |
| **Inline Code** | Inserts `` `text` `` | Yes | `text` |

**Insertion logic** (`insertFormat`):
1. Gets `selectionStart` / `selectionEnd` from textarea
2. Extracts selected text (if any)
3. Builds replacement: `before + (selectedText || 'text') + after`
4. Uses `setRangeText()` to replace and auto-select the placeholder
5. Triggers debounced preview render

**Line-level operations** (`insertHeading`, `insertList`):
1. Finds current line boundaries via `lastIndexOf('\n')` and `indexOf('\n')`
2. Replaces the entire line content
3. Positions cursor at end of line

### Keyboard Shortcuts

All shortcuts detect the platform (User-Agent Client Hints, falling back to `navigator.userAgent` / legacy `navigator.platform`) to use `Cmd` on Mac, `Ctrl` on Windows/Linux.

| Shortcut | Handler | Notes |
|----------|---------|-------|
| `Ctrl+B` | `insertFormat('**', '**')` | Overrides native bold in textarea |
| `Ctrl+I` | `insertFormat('*', '*')` | Overrides native italic |
| `Ctrl+K` | `insertFormat('[', '](url)')` | Inserts link template |
| `Ctrl+O` | `openFileWithPicker()` | Opens file picker dialog |
| `Ctrl+S` | `saveFile()` | Opens save dialog or writes to existing handle |
| `Ctrl+Z` | `document.execCommand('undo')` | Triggers textarea undo, re-renders preview |
| `Ctrl+Y` | `document.execCommand('redo')` | Triggers textarea redo, re-renders preview |
| `Ctrl+Shift+Z` | `document.execCommand('redo')` | Alternate redo shortcut |
| `Ctrl+D` | `toggleTheme()` | Switches between light/dark |
| `Ctrl+M` | `cycleMathMode()` | Cycles math mode: Off → $ → $$ → $+$$ → LaTeX → All |
| `Escape` | Closes share modal if open, else settings menu, else `setViewMode('split')` | Closes modal/menu or resets to split view |
| `Tab` | Inserts 2 spaces | Overrides native tab focus behavior |

Shortcut handlers call `e.preventDefault()` to suppress default browser behavior.

### File Operations

**Open** (`openFileWithPicker`):
1. Checks for `window.showOpenFilePicker` support
2. If available: opens native file picker, reads file via `handle.getFile()` → `file.text()`, stores `fileHandle` for future saves
3. If unavailable: falls back to hidden `<input type="file">` + `FileReader`
4. On success: updates editor content, filename, state, preview, and localStorage

**Save** (`saveFile`):
1. Checks for `window.showSaveFilePicker` support
2. If `state.fileHandle` exists (file was opened via picker): writes directly to the same file without prompting
3. If no handle: opens `showSaveFilePicker` dialog with suggested filename, stores the returned handle for future saves
4. Writes content via `handle.createWritable()` → `writable.write()` → `writable.close()`
5. On abort: silently ignores
6. On error or unsupported browser: falls back to `fallbackSave()`

**Fallback Save** (`fallbackSave`):
- Creates a `Blob` with `text/markdown;charset=utf-8` MIME type
- Generates object URL, creates temporary `<a>` element with `download` attribute
- Programmatically clicks it, then removes element and revokes URL

### Sharing & Link Import

**Share** (`shareFile`):
1. Builds a share link from the page URL plus a URL fragment: `#content=<encoded>&filename=<encoded>`
2. Content travels only in the fragment — never sent to any server — so links work for both hosted and `file://` URLs
3. If the link would exceed `SHARE_URL_MAX_LENGTH` (8,000 chars), a modal explains the file is too big to share by link and suggests saving the `.md` file instead
4. Copies the link via `navigator.clipboard`, with a hidden-textarea + `execCommand('copy')` fallback for non-secure contexts like `file://`
5. If the clipboard is blocked, the link is placed in the address bar and a modal tells the user to copy it manually
6. On success the Share button flashes "Copied!" for 1.5s

**Link import** (`loadState`, on load):
1. Checks whether the URL hash carries `content` / `filename` params (`URLSearchParams` decodes exactly once — a second `decodeURIComponent` would break content containing literal `%`)
2. If found: imports content + filename into state, opens **view-only** mode (the recipient sees a rendered copy first and can switch to Split/Focus to edit), persists to `localStorage`, and strips the hash with `history.replaceState` so refreshing the page does not overwrite later edits
3. This is also the cross-origin hand-off used by other apps to send text in — see `docs/instruction.md` for the InPlainSite integration guide

### Scroll Sync

Scrolling either pane proportionally scrolls the other (`syncScroll`):
- Maps the source's scroll fraction (0–100%) onto the target, so panes of different lengths stay aligned and the longer pane scrolls faster
- Throttled with `requestAnimationFrame` (latest-wins); an epsilon check makes programmatic echoes no-ops, so a feedback loop is impossible
- Disabled entirely while either pane is hidden (Focus / View-Only modes)

### Math (LaTeX) Rendering

Optional LaTeX math via **MathJax v3** (`tex-chtml`, pinned), enabled via the **Math submenu** in the settings menu (gear icon, header-right; default **Off**, so `$` stays literal text unless you opt in):

| Mode | Active delimiters |
|------|-------------------|
| Off | none |
| `$` | `$…$` inline (`$H_{in}$`) |
| `$$` | `$$…$$` display (centered block) |
| `$ + $$` | both dollar forms |
| `\( \)` / `\[ \]` | LaTeX-style only (immune to currency false positives) |
| All | everything above |

`Ctrl+M` cycles the modes. The choice persists in `localStorage` (`md-editor-math-mode`).

**How it stays fast and correct:**
- Before parsing, `extractMath()` pulls LaTeX spans into private-use Unicode placeholders (`U+E000…U+E001`, zero markdown meaning), so `marked` can't mangle them (the `*` in `$a*b$` would otherwise become emphasis). Markdown rendering stays fully synchronous on the 100ms debounce.
- Fenced code blocks and `` `code spans` `` are never touched. Known limitation: indented (4-space) code blocks are not detected — use fenced blocks in math-heavy docs.
- After sanitize + `innerHTML`, `restoreMathPlaceholders()` swaps tokens for `<span>` nodes built with `textContent` (never `innerHTML`), then `MathJax.typesetPromise()` typesets **only those nodes**, asynchronously. Markdown is already on screen; formulas fill in as each typeset resolves, and stale typesets from older keystrokes mutate detached nodes and evaporate harmlessly.
- Delimiter rules: no space adjacent to `$`, closing `$` not followed by a digit (so `$5 and $10` is left alone), `\$` never opens/closes, inline `$` is single-line only, and `$$x$$` stays literal unless a `$$` mode is active.
- MathJax runs with `startup.typeset: false` so it never scans the whole page; bad TeX renders inline-red instead of crashing the preview; if the CDN is unreachable (offline), raw `$…$` text simply stays visible.

### Code Highlighting

Fenced code blocks with an explicit language tag are syntax-highlighted via **highlight.js v11** (common bundle, pinned), e.g. ```` ```cpp ```` or ```` ```python ````. Untagged blocks and `plaintext` / `nohighlight` blocks keep plain styling.

- The tag after the fence picks the language; a custom matcher also accepts `+`, `#`, `.` and `-`, so ```` ```C++ ```` and ```` ```C# ```` resolve through the official alias table (`c++`→cpp, `c#`→csharp). Canonical lowercase tags are still recommended.
- Highlighting runs post-sanitize on `pre code` nodes only (tagged + supported), so it never touches math spans or inline code and the XSS posture is unchanged. Our own code-block chrome is kept — only token colors come from the highlight.js theme.
- Every fenced block gets a **Copy** button (top-right; hover/focus reveal on desktop, always visible on touch) that copies the raw code with clipboard + `execCommand` fallback and flashes "Copied!".
- **Code Themes** submenu (gear menu): `Auto (app theme)` default plus GitHub Light/Dark, Monokai, Dracula, Nord. A single on-demand stylesheet is swapped (`Auto` follows the app theme in `applyTheme()`); the choice persists in `localStorage` (`md-editor-code-theme`).

### Settings Menu

File and display settings live behind the **gear button** in header-right: Open / Save / Share rows, a **Math ▸** flyout (the six math modes), a **Code Themes ▸** flyout, and the icon-only theme button. Both flyouts open leftward so they never clip off the viewport edge (on ≤480px screens they expand inline instead). The menu closes on outside click, on `Escape` (before the split-view reset), and on row activation; arrow keys navigate rows; focus returns to the gear on dismiss.

### Live Preview Rendering Pipeline

```
textarea input event
    ↓
debouncedRender() — clears previous timer, sets 100ms timeout
    ↓
requestAnimationFrame(renderPreview()) — batches to next paint
    ↓
mdParser.parse(content) — converts Markdown to HTML (custom marked.Marked instance)
    ↓
DOMPurify.sanitize(html) — strips dangerous tags/attributes (XSS prevention)
    ↓
preview.innerHTML = sanitized — updates DOM
    ↓
Post-render: inject target="_blank" on all external <a> links
    ↓
saveState() — persists content to localStorage
```

**Empty state**: When content is empty/whitespace-only, renders an SVG icon + "Start typing to see the preview" message instead of calling the parser.

**Debouncing**: 100ms delay prevents excessive parsing on rapid keystrokes. Timer is cleared on each new input event.

**requestAnimationFrame**: Ensures DOM updates happen on the next paint cycle, avoiding layout thrashing.

### Theming System

Implemented via **CSS custom properties** scoped to `:root` and `[data-theme="dark"]`:

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--bg-primary` | `#ffffff` | `#1a1b1e` | Editor background, body |
| `--bg-secondary` | `#f8f9fa` | `#25262b` | Preview pane background |
| `--bg-tertiary` | `#e9ecef` | `#2c2e33` | Buttons, badges, blockquotes |
| `--bg-header` | `#ffffff` | `#1a1b1e` | Header background |
| `--text-primary` | `#212529` | `#e4e5e7` | Main text color |
| `--text-secondary` | `#495057` | `#b4b6ba` | Secondary text |
| `--text-muted` | `#6c757d` | `#8b8d92` | Placeholder, filename badge |
| `--border-color` | `#dee2e6` | `#373a40` | Borders, dividers |
| `--border-light` | `#e9ecef` | `#2c2e33` | Subtle borders (h2, pre) |
| `--accent` | `#4263eb` | `#5c7cfa` | Active buttons, links, links hover |
| `--accent-hover` | `#3b5bdb` | `#748ffc` | Button hover state |
| `--accent-light` | `#edf2ff` | `#1c2333` | Active button background |
| `--code-bg` | `#f1f3f5` | `#2c2e33` | Inline code and code blocks |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.2)` | Header shadow |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 6px rgba(0,0,0,0.3)` | Elevated elements |
| `--radius-sm` | `6px` | — | Buttons, badges |
| `--radius-md` | `8px` | — | Code blocks, images |
| `--radius-lg` | `12px` | — | Cards (unused) |
| `--transition` | `0.2s ease` | — | All animated transitions |
| `--font-mono` | SF Mono, Fira Code, Cascadia Code, Consolas | — | Editor, code |
| `--font-sans` | System font stack | — | UI text |

**Theme toggle logic**:
- Button swaps `data-theme` attribute on `<html>` between `'light'` and `'dark'`
- Sun/moon icons swap visibility via CSS (`[data-theme="dark"] .icon-sun { display: block }`)
- All themed properties transition smoothly via `transition: background/var(--transition), color/var(--transition)`

### Undo / Redo

Uses `document.execCommand('undo')` and `document.execCommand('redo')` on the textarea element. The browser's native undo stack tracks all textarea modifications (typing, toolbar insertions, Tab). After each undo/redo, `debouncedRender()` is called to sync the preview.

### Navigation & Anchors

**Heading anchor links**: Every heading in the rendered preview gets an auto-generated `id` (slugified from heading text) and a hover-reveal `#` anchor link positioned to its left. Hovering a heading makes the anchor visible; clicking it smooth-scrolls to that section.

**Table of Contents support**: Markdown TOCs with `#` fragment links (e.g., `[Section](#section)`) trigger smooth scrolling within the preview pane. The `handlePreviewClick` event handler intercepts clicks on `a[href^="#"]`, prevents default navigation, and calls `scrollIntoView({ behavior: 'smooth' })` on the target element.

**External links**: All non-fragment links (`href` not starting with `#`) are forced to open in a new browser tab via `target="_blank" rel="noopener noreferrer"`. This is applied as a post-render step after DOMPurify sanitization, ensuring it survives any sanitizer stripping of `target` attributes.

**Slug generation**: Heading IDs are generated from raw heading text by lowercasing, stripping non-alphanumeric characters (except hyphens and spaces), collapsing whitespace into single hyphens, and trimming leading/trailing hyphens. Empty slugs default to `'heading'`. Duplicate slugs within one document get numeric suffixes (`setup`, `setup-1`, `setup-2`); the counter resets on every render so IDs stay stable across keystrokes.

### Security

- All rendered Markdown passes through **DOMPurify.sanitize()** before insertion into the DOM
- Prevents XSS from malicious Markdown content (script tags, event handlers, javascript: URLs)
- Uses DOMPurify v3.0.6 from jsDelivr CDN

## Tech Stack

- **HTML5** — Semantic structure, ARIA labels, hidden file input
- **CSS3** — Custom properties for theming, flexbox layout, sticky header, responsive media query at `768px`
- **Vanilla JavaScript (ES6+)** — IIFE pattern, strict mode, arrow functions, async/await, template literals, destructuring
- **marked.js** (latest release, jsDelivr CDN, unpinned) — Markdown-to-HTML parser via `new marked.Marked()` with custom renderer for heading anchors and link handling
- **MathJax** (pinned v3.2.2, jsDelivr CDN, deferred) — LaTeX math typesetting via targeted async `MathJax.typesetPromise()` on extracted math nodes only
- **highlight.js** (pinned v11.9.0 common bundle, jsDelivr CDN, deferred) — code syntax highlighting via `hljs.highlightElement()` on tagged fenced blocks; theme via a single swappable stylesheet
- **DOMPurify** (CDN v3.0.6) — HTML sanitization via `DOMPurify.sanitize()`

## Getting Started

1. Clone or download the repository
2. Open `index.html` directly in a browser
3. Start writing

No server, no `npm install`, no build tooling required.

## Browser Support

| Feature | Chromium (Chrome, Edge, Opera) | Firefox | Safari |
|---------|-------------------------------|---------|--------|
| File System Access API (save dialog) | Full support | Not supported | Not supported |
| File System Access API (open dialog) | Full support | Not supported | Not supported |
| Direct file writes | Full support | Not supported | Not supported |
| Fallback download mode | Available | Used | Used |
| Editing and preview | Full support | Full support | Full support |
| `document.execCommand` (undo/redo) | Supported | Supported | Supported |

## Project Structure

```
md_viewer/
├── index.html              # Single-page entry point, CDN scripts, header UI
├── src/
│   ├── css/
│   │   └── styles.css      # All styles: theme vars, layout, components, responsive
│   └── js/
│       └── app.js          # All application logic in a single IIFE
├── docs/
│   ├── DEVELOPMENT_PLAN.md # Phased build plan (completed)
│   ├── instruction.md      # InPlainSite → share-link integration guide
│   └── MARKDOWN_VIEWER_EDITOR.md  # Initial design brief
├── README.md               # This file
└── AGENTS.md               # AI agent instructions and project conventions
```

## Key Implementation Details

### Layout
- Header: `position: sticky; top: 0; z-index: 100` with three-section flex layout (`header-left`, `header-center`, `header-right`)
- `header-left` and `header-right` both have `flex: 1` to center `header-center`
- Main area: `display: flex; height: calc(100vh - 52px)` for full-viewport minus header
- Panes: `flex: 1` with `overflow: hidden`; hidden panes collapse via `flex: 0 0 0`
- Preview pane: `scroll-behavior: smooth` for anchor-based smooth scrolling
- Responsive: at `≤768px`, header wraps, center section goes full-width below, panes stack vertically

### Heading Anchors
- Each heading gets a `position: relative` container with an `.anchor` link absolutely positioned to the left
- Anchors are hidden by default (`opacity: 0`) and revealed on heading hover (`opacity: 1`)
- Anchor color uses `--accent`, transition uses `--transition`
- Slug IDs are generated client-side from heading text (lowercase, strip non-word chars, collapse spaces to hyphens)

### Event Model
- `document.addEventListener('keydown', ...)` for global shortcuts (delegated, not on specific elements)
- `elements.editor.addEventListener('input', ...)` for live preview triggering
- `elements.editor.addEventListener('keydown', handleTabKey)` for Tab interception
- `elements.preview.addEventListener('click', handlePreviewClick)` for TOC smooth-scroll navigation
- Settings menu: `menuBtn` toggles the panel, flyout parents toggle side panels, option buttons apply + close; document `pointerdown` closes on outside clicks; `settingsMenu` handles arrow-key navigation
- Toolbar buttons and view buttons use individual `addEventListener('click', ...)`
- File input uses `change` event

### Content Flow
1. User types or clicks toolbar button
2. Textarea value changes
3. `input` event fires → `debouncedRender()`
4. After 100ms debounce → `requestAnimationFrame(renderPreview)`
5. `renderPreview()` reads textarea value, parses Markdown via `mdParser`, sanitizes, updates preview DOM
6. Post-render: all external `<a>` links get `target="_blank" rel="noopener noreferrer"` injected
7. `saveState()` persists content to `localStorage`

---

P.S. This app was initially built by **opencode**, an AI-powered CLI coding assistant developed by [Anomaly](https://github.com/anomalyco/opencode), powered by **Qwen 3.6**, and later extended using **Qwen 3.8:27B**. LaTeX math support was added afterwards with **Muse Spark** (not Qwen 3.8).
