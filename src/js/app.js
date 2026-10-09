(function() {
  'use strict';

  const STORAGE_KEYS = {
    THEME: 'md-editor-theme',
    VIEW_MODE: 'md-editor-view-mode',
    CONTENT: 'md-editor-content',
    FILENAME: 'md-editor-filename',
    MATH_MODE: 'md-editor-math-mode'
  };

  const VIEW_MODES = {
    FOCUS: 'focus',
    SPLIT: 'split',
    VIEW_ONLY: 'view-only'
  };

  const MATH_MODES = {
    OFF: 'off',
    INLINE: 'inline',
    DISPLAY: 'display',
    DOLLARS: 'dollars',
    LATEX: 'latex',
    ALL: 'all'
  };

  const DEBOUNCE_DELAY = 100;

  // Max total length (chars) of a generated share link. The file travels in
  // the URL fragment, which is never sent to a server, so only browser-side
  // limits apply (Chromium hard cap: 2MB; Firefox history: 2000 chars;
  // Safari: effectively uncapped). 8000 stays safe everywhere and pastes
  // cleanly into chat apps.
  const SHARE_URL_MAX_LENGTH = 8000;

  const state = {
    viewMode: VIEW_MODES.SPLIT,
    theme: 'light',
    content: '',
    filename: '',
    fileHandle: null,
    mathMode: MATH_MODES.OFF
  };

  const elements = {
    appMain: null,
    editor: null,
    editorPane: null,
    preview: null,
    previewPane: null,
    btnBold: null,
    btnH1: null,
    btnItalic: null,
    btnList: null,
    btnLink: null,
    btnCode: null,
    btnFocus: null,
    btnSplit: null,
    btnViewOnly: null,
    btnOpen: null,
    btnSave: null,
    btnShare: null,
    btnTheme: null,
    fileInput: null,
    filenameDisplay: null,
    shareModal: null,
    shareModalTitle: null,
    shareModalMessage: null,
    shareModalClose: null,
    mathMode: null,
    mathjaxScript: null
  };

  let debounceTimer = null;

  let mdParser = null;

  // Tracks slug usage per render so duplicate headings get unique ids
  // (setup, setup-1, setup-2). Cleared at the start of every renderPreview().
  let slugCounts = new Map();

  // Scroll-sync throttle state: latest pending source/target pair.
  // Applied on the next animation frame (latest-wins, nothing lost).
  let scrollSyncQueued = false;
  let scrollSyncSource = null;
  let scrollSyncTarget = null;

  // Math (LaTeX) state: placeholder records for the current render, plus
  // nodes waiting for MathJax when the library hasn't finished loading yet.
  let pendingMaths = [];
  let queuedMathNodes = [];

  function init() {
    cacheElements();
    loadState();
    applyTheme();
    applyViewMode();
    applyMathMode();
    configureMarked();
    bindEvents();
    renderPreview();
    updateFilenameDisplay();
  }

  function configureMarked() {
    function extractText(tokens) {
      return tokens.map(t => {
        if (t.text && !t.tokens) return t.text;
        if (t.tokens) return extractText(t.tokens);
        return t.raw || '';
      }).join('');
    }

    mdParser = new marked.Marked({
      renderer: {
        heading({ tokens, depth }) {
          const text = this.parser.parseInline(tokens);
          const rawText = extractText(tokens);
          const base = rawText.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'heading';
          const seen = slugCounts.get(base) || 0;
          slugCounts.set(base, seen + 1);
          const id = seen === 0 ? base : `${base}-${seen}`;
          const anchor = `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>`;
          return `<h${depth} id="${id}">${anchor}${text}</h${depth}>\n`;
        },
        link({ href, title, tokens }) {
          const text = this.parser.parseInline(tokens);
          const titleAttr = title ? ` title="${title}"` : '';
          if (href && href.startsWith('#')) {
            return `<a href="${href}"${titleAttr}>${text}</a>`;
          }
          return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
        }
      }
    });
  }

  function cacheElements() {
    elements.appMain = document.getElementById('appMain');
    elements.editor = document.getElementById('editor');
    elements.editorPane = document.getElementById('editorPane');
    elements.preview = document.getElementById('preview');
    elements.previewPane = document.getElementById('previewPane');
    elements.btnBold = document.getElementById('btnBold');
    elements.btnH1 = document.getElementById('btnH1');
    elements.btnItalic = document.getElementById('btnItalic');
    elements.btnList = document.getElementById('btnList');
    elements.btnLink = document.getElementById('btnLink');
    elements.btnCode = document.getElementById('btnCode');
    elements.btnFocus = document.getElementById('btnFocus');
    elements.btnSplit = document.getElementById('btnSplit');
    elements.btnViewOnly = document.getElementById('btnViewOnly');
    elements.btnOpen = document.getElementById('btnOpen');
    elements.btnSave = document.getElementById('btnSave');
    elements.btnShare = document.getElementById('btnShare');
    elements.btnTheme = document.getElementById('btnTheme');
    elements.fileInput = document.getElementById('fileInput');
    elements.filenameDisplay = document.getElementById('filenameDisplay');
    elements.shareModal = document.getElementById('shareModal');
    elements.shareModalTitle = document.getElementById('shareModalTitle');
    elements.shareModalMessage = document.getElementById('shareModalMessage');
    elements.shareModalClose = document.getElementById('shareModalClose');
    elements.mathMode = document.getElementById('mathMode');
    elements.mathjaxScript = document.getElementById('mathjaxScript');
  }

  function loadState() {
    state.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    state.viewMode = localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || VIEW_MODES.SPLIT;
    state.mathMode = localStorage.getItem(STORAGE_KEYS.MATH_MODE) || MATH_MODES.OFF;
    if (!Object.values(MATH_MODES).includes(state.mathMode)) {
      state.mathMode = MATH_MODES.OFF;
    }

    // Check if content was passed via URL hash (cross-origin import)
    let hashContent = '';
    let hashFilename = '';
    try {
      const hash = window.location.hash.substring(1);
      if (hash) {
        // URLSearchParams.get() already percent-decodes once. Do NOT wrap
        // it in decodeURIComponent(): a literal '%' in the content (e.g.
        // "100% sure") would throw URIError and silently drop the import.
        const params = new URLSearchParams(hash);
        if (params.has('content')) {
          hashContent = params.get('content') || '';
        }
        if (params.has('filename')) {
          hashFilename = params.get('filename') || '';
        }
      }
    } catch (e) {
      console.error('Failed to parse content from URL hash:', e);
    }

    if (hashContent) {
      state.content = hashContent;
      state.filename = hashFilename || 'imported.md';
      // Shared links open on the rendered preview: the recipient gets a
      // readable copy first and can switch to Split/Focus to edit.
      // applyViewMode() (called after loadState in init) persists this.
      state.viewMode = VIEW_MODES.VIEW_ONLY;
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

  function saveState() {
    localStorage.setItem(STORAGE_KEYS.CONTENT, state.content);
    if (state.filename) {
      localStorage.setItem(STORAGE_KEYS.FILENAME, state.filename);
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem(STORAGE_KEYS.THEME, state.theme);
  }

  function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme();
  }

  function applyViewMode() {
    const { editorPane, previewPane } = elements;

    editorPane.classList.remove('hidden');
    previewPane.classList.remove('hidden');

    switch (state.viewMode) {
      case VIEW_MODES.FOCUS:
        editorPane.classList.remove('hidden');
        previewPane.classList.add('hidden');
        break;
      case VIEW_MODES.SPLIT:
        editorPane.classList.remove('hidden');
        previewPane.classList.remove('hidden');
        break;
      case VIEW_MODES.VIEW_ONLY:
        editorPane.classList.add('hidden');
        previewPane.classList.remove('hidden');
        break;
    }

    // Remove hidden panes from keyboard focus and assistive tech.
    // `inert` blocks tab/focus traversal; `aria-hidden` hides from AT.
    // CSS `visibility: hidden` covers browsers without `inert` support.
    // If focus is inside the pane being hidden, the browser moves it to <body>.
    const editorHidden = editorPane.classList.contains('hidden');
    const previewHidden = previewPane.classList.contains('hidden');
    editorPane.inert = editorHidden;
    previewPane.inert = previewHidden;
    if (editorHidden) {
      editorPane.setAttribute('aria-hidden', 'true');
    } else {
      editorPane.removeAttribute('aria-hidden');
    }
    if (previewHidden) {
      previewPane.setAttribute('aria-hidden', 'true');
    } else {
      previewPane.removeAttribute('aria-hidden');
    }

    updateViewButtons();
    localStorage.setItem(STORAGE_KEYS.VIEW_MODE, state.viewMode);
  }

  function setViewMode(mode) {
    if (!Object.values(VIEW_MODES).includes(mode)) return;
    state.viewMode = mode;
    applyViewMode();
  }

  function updateViewButtons() {
    const { btnFocus, btnSplit, btnViewOnly } = elements;
    btnFocus.classList.toggle('active', state.viewMode === VIEW_MODES.FOCUS);
    btnSplit.classList.toggle('active', state.viewMode === VIEW_MODES.SPLIT);
    btnViewOnly.classList.toggle('active', state.viewMode === VIEW_MODES.VIEW_ONLY);
  }

  // Order used by Ctrl+M to cycle through the math modes.
  const MATH_MODE_ORDER = [
    MATH_MODES.OFF,
    MATH_MODES.INLINE,
    MATH_MODES.DISPLAY,
    MATH_MODES.DOLLARS,
    MATH_MODES.LATEX,
    MATH_MODES.ALL
  ];

  function mathDelimitersActive() {
    switch (state.mathMode) {
      case MATH_MODES.INLINE: return { inlineDollar: true, displayDollar: false, latex: false };
      case MATH_MODES.DISPLAY: return { inlineDollar: false, displayDollar: true, latex: false };
      case MATH_MODES.DOLLARS: return { inlineDollar: true, displayDollar: true, latex: false };
      case MATH_MODES.LATEX: return { inlineDollar: false, displayDollar: false, latex: true };
      case MATH_MODES.ALL: return { inlineDollar: true, displayDollar: true, latex: true };
      default: return { inlineDollar: false, displayDollar: false, latex: false };
    }
  }

  function applyMathMode() {
    if (elements.mathMode) elements.mathMode.value = state.mathMode;
    localStorage.setItem(STORAGE_KEYS.MATH_MODE, state.mathMode);
  }

  function setMathMode(mode) {
    if (!Object.values(MATH_MODES).includes(mode)) return;
    state.mathMode = mode;
    applyMathMode();
    renderPreview();
  }

  function cycleMathMode() {
    const next = MATH_MODE_ORDER[(MATH_MODE_ORDER.indexOf(state.mathMode) + 1) % MATH_MODE_ORDER.length];
    setMathMode(next);
  }

  function handleMathModeChange(e) {
    setMathMode(e.target.value);
  }

  // Splits markdown source into { text, isCode } segments so math
  // extraction never touches fenced code blocks or inline code spans.
  // Known limitation: indented (4-space) code blocks are not detected —
  // use fenced blocks for math-heavy documents.
  function splitCodeSegments(src) {
    const lines = src.split('\n');
    const segments = [];
    let segStart = 0;
    let fence = null;

    function push(upto, isCode) {
      if (upto > segStart) {
        segments.push({ text: lines.slice(segStart, upto).join('\n'), isCode });
      }
      segStart = upto;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!fence) {
        const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (open) {
          push(i, false);
          fence = { ch: open[1][0], len: open[1].length };
        }
      } else {
        const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === fence.ch && close[1].length >= fence.len) {
          push(i + 1, true);
          fence = null;
        }
      }
    }
    push(lines.length, !!fence);

    const out = [];
    for (const seg of segments) {
      if (seg.isCode) {
        out.push(seg);
      } else {
        splitInlineCode(seg.text, out);
      }
    }
    return out;
  }

  // Splits plain text on CommonMark code spans: a run of N backticks is
  // closed by the first later run of exactly N backticks.
  function splitInlineCode(text, out) {
    const runs = [];
    const runRe = /`+/g;
    let m;
    while ((m = runRe.exec(text))) runs.push({ index: m.index, len: m[0].length });

    let pos = 0;
    let i = 0;
    while (i < runs.length) {
      let j = i + 1;
      while (j < runs.length && runs[j].len !== runs[i].len) j++;
      if (j >= runs.length) break;
      if (runs[i].index > pos) {
        out.push({ text: text.slice(pos, runs[i].index), isCode: false });
      }
      out.push({ text: text.slice(runs[i].index, runs[j].index + runs[j].len), isCode: true });
      pos = runs[j].index + runs[j].len;
      i = j + 1;
    }
    if (pos < text.length) out.push({ text: text.slice(pos), isCode: false });
  }

  // Replaces LaTeX spans in non-code text with placeholder tokens and
  // records { tex, display } for each. Tokens use private-use Unicode so
  // user-typed text can never collide with them, and they carry no
  // markdown meaning through marked or DOMPurify.
  function extractMath(src, flags) {
    const maths = [];
    const parts = splitCodeSegments(src).map(seg => {
      if (seg.isCode) return seg.text;
      return extractMathFromText(seg.text, flags, maths);
    });
    return { text: parts.join(''), maths };
  }

  function extractMathFromText(text, flags, maths) {
    function stash(tex, display) {
      const id = maths.length;
      maths.push({ tex, display });
      return '\uE000MATH' + id + '\uE001';
    }
    // Display $$ first so its dollars are never read as two inline opens.
    if (flags.displayDollar) {
      text = text.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, (m, tex) => stash(tex, true));
    }
    if (flags.latex) {
      text = text.replace(/(?<!\\)\\\[([\s\S]+?)\\\]/g, (m, tex) => stash(tex, true));
      text = text.replace(/(?<!\\)\\\(([^\n]+?)\\\)/g, (m, tex) => stash(tex, false));
    }
    if (flags.inlineDollar) {
      // Single-line only (a runaway match across paragraphs stays literal),
      // no space adjacent to the dollars, closing $ not followed by a digit
      // (so "$5 and $10" is left alone), dollars next to another dollar or
      // a backslash never open/close (so "$$x$$" stays literal here).
      text = text.replace(/(?<!\$)(?<!\\)\$(?!\s)(?!\$)([^\n]+?)(?<!\s)(?<!\$)(?<!\\)\$(?!\d)/g, (m, tex) => stash(tex, false));
    }
    return text;
  }

  const MATH_TOKEN_RE = /\uE000MATH(\d+)\uE001/g;

  // Swaps placeholder tokens back for real <span> nodes holding the raw
  // TeX wrapped in \(...\) / \[...\], then hands them to MathJax. Nodes
  // are built with textContent (never innerHTML), and typesetting happens
  // after DOMPurify — so the XSS guarantee is untouched. Tokens inside
  // <code>/<pre> are user-typed literals (extraction never runs there).
  function restoreMathPlaceholders() {
    const nodes = [];
    if (!pendingMaths.length || !elements.preview) return nodes;

    const walker = document.createTreeWalker(elements.preview, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current;
    while ((current = walker.nextNode())) textNodes.push(current);

    textNodes.forEach(node => {
      MATH_TOKEN_RE.lastIndex = 0;
      if (!MATH_TOKEN_RE.test(node.nodeValue)) return;
      if (node.parentElement && node.parentElement.closest('code, pre')) return;

      MATH_TOKEN_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = MATH_TOKEN_RE.exec(node.nodeValue))) {
        if (m.index > last) {
          frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
        }
        const math = pendingMaths[Number(m[1])];
        if (math) {
          const span = document.createElement('span');
          span.className = math.display ? 'math math-display' : 'math math-inline';
          span.textContent = math.display ? '\\[' + math.tex + '\\]' : '\\(' + math.tex + '\\)';
          frag.appendChild(span);
          nodes.push(span);
        } else {
          frag.appendChild(document.createTextNode(m[0]));
        }
        last = m.index + m[0].length;
      }
      if (last < node.nodeValue.length) {
        frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
      }
      node.parentNode.replaceChild(frag, node);
    });
    return nodes;
  }

  function typesetMath(nodes) {
    if (!nodes.length) return;
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise(nodes).catch(e => {
        console.error('MathJax typeset failed:', e);
      });
    } else {
      // Library still loading (or blocked): retry once it arrives.
      // flushQueuedMath keeps only attached, untypeset nodes.
      queuedMathNodes.push(...nodes);
    }
  }

  function flushQueuedMath() {
    if (!window.MathJax || !window.MathJax.typesetPromise) return;
    if (!queuedMathNodes.length) return;
    const live = queuedMathNodes.filter(n => n.isConnected && !n.querySelector('mjx-container'));
    queuedMathNodes = [];
    if (live.length) typesetMath(live);
  }

  function onMathJaxReady() {
    // The MathJax global exists as soon as our config block runs, but
    // startup.promise only appears once the library itself executes.
    if (!window.MathJax || !window.MathJax.startup || !window.MathJax.startup.promise) return;
    window.MathJax.startup.promise.then(flushQueuedMath);
  }

  function renderPreview() {
    const content = elements.editor.value.trim();
    state.content = elements.editor.value;

    if (!content) {
      elements.preview.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10,9 9,9 8,9"/>
          </svg>
          <p>Start typing to see the preview</p>
        </div>
      `;
      return;
    }

    // Reset per-render so ids are stable across keystrokes and duplicates
    // within this document still dedup (setup, setup-1, ...).
    slugCounts.clear();

    // Pull LaTeX out before parsing so marked can't mangle it (e.g. the
    // `*` in `$a*b$` would otherwise become emphasis). The markdown render
    // itself stays fully synchronous; only the math pass below is async.
    pendingMaths = [];
    let source = content;
    if (state.mathMode !== MATH_MODES.OFF) {
      const extracted = extractMath(content, mathDelimitersActive());
      source = extracted.text;
      pendingMaths = extracted.maths;
    }

    const html = mdParser.parse(source);
    const sanitized = DOMPurify.sanitize(html);
    elements.preview.innerHTML = sanitized;

    const links = elements.preview.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !link.getAttribute('target')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    });

    // Swap placeholders back for math nodes and typeset them async.
    // Markdown is already on screen at this point — MathJax fills in the
    // formulas as soon as each typeset resolves.
    typesetMath(restoreMathPlaceholders());

    saveState();
  }

  function debouncedRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      requestAnimationFrame(renderPreview);
    }, DEBOUNCE_DELAY);
  }

  function openFile() {
    elements.fileInput.click();
  }

  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Fallback open has no writable handle: drop any stale File System
    // Access handle so the next save doesn't silently overwrite a
    // previously picker-opened file with this file's content.
    state.fileHandle = null;

    const reader = new FileReader();
    reader.onload = (e) => {
      elements.editor.value = e.target.result;
      state.filename = file.name;
      state.content = e.target.result;
      updateFilenameDisplay();
      renderPreview();
      saveState();
    };
    reader.readAsText(file);
    elements.fileInput.value = '';
  }

  async function openFileWithPicker() {
    if (!window.showOpenFilePicker) {
      openFile();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }]
      });
      const file = await handle.getFile();
      const content = await file.text();
      elements.editor.value = content;
      state.filename = file.name;
      state.content = content;
      state.fileHandle = handle;
      updateFilenameDisplay();
      renderPreview();
      saveState();
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
    }
  }

  async function saveFile() {
    const content = elements.editor.value;
    if (!content.trim()) return;

    const filename = state.filename || 'untitled.md';

    if (window.showSaveFilePicker) {
      try {
        let handle = state.fileHandle;
        if (!handle) {
          handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }]
          });
          state.fileHandle = handle;
          state.filename = handle.name;
          updateFilenameDisplay();
        }
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      } catch (e) {
        if (e.name !== 'AbortError') {
          fallbackSave(content, filename);
        }
      }
    } else {
      fallbackSave(content, filename);
    }
  }

  function fallbackSave(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildShareLink(content, filename) {
    // Strip any existing hash so the base works for both hosted
    // (https://…/index.html) and file:// URLs.
    const base = window.location.href.split('#')[0];
    return base + '#content=' + encodeURIComponent(content) +
      '&filename=' + encodeURIComponent(filename);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // Fallback for non-secure contexts (e.g. file://): hidden textarea + execCommand.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  function isShareModalOpen() {
    return elements.shareModal && !elements.shareModal.classList.contains('hidden');
  }

  function openShareModal(title, message) {
    elements.shareModalTitle.textContent = title;
    elements.shareModalMessage.textContent = message;
    elements.shareModal.classList.remove('hidden');
    elements.shareModalClose.focus();
  }

  function closeShareModal() {
    elements.shareModal.classList.add('hidden');
    if (elements.btnShare) elements.btnShare.focus();
  }

  async function shareFile() {
    const content = elements.editor.value;
    if (!content.trim()) {
      openShareModal('Nothing to share', 'The editor is empty. Write something first, then share it.');
      return;
    }

    const filename = state.filename || 'untitled.md';
    const link = buildShareLink(content, filename);

    if (link.length > SHARE_URL_MAX_LENGTH) {
      openShareModal(
        'File too big to share with a link',
        'This file would make a ' + link.length.toLocaleString() + '-character link, ' +
        'but links are limited to ' + SHARE_URL_MAX_LENGTH.toLocaleString() + ' characters. ' +
        'Save it as a .md file and send the file instead.'
      );
      return;
    }

    try {
      await copyText(link);
      flashShareButton();
    } catch (e) {
      // Last resort: put the link in the address bar so it can be copied manually.
      window.location.hash = link.substring(link.indexOf('#') + 1);
      openShareModal('Could not copy automatically', 'Your browser blocked copying, so the share link was placed in the address bar instead — copy it from there manually.');
    }
  }

  function flashShareButton() {
    const btn = elements.btnShare;
    if (!btn) return;
    const original = btn.innerHTML;
    btn.innerHTML = 'Copied!';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
  }

  function undo() {
    elements.editor.focus();
    document.execCommand('undo');
    debouncedRender();
  }

  function redo() {
    elements.editor.focus();
    document.execCommand('redo');
    debouncedRender();
  }

  function updateFilenameDisplay() {
    const { filenameDisplay } = elements;
    if (state.filename) {
      filenameDisplay.textContent = state.filename;
      filenameDisplay.classList.add('visible');
    } else {
      filenameDisplay.classList.remove('visible');
    }
  }

  function insertFormat(before, after = '') {
    const { editor } = elements;
    editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selectedText = editor.value.substring(start, end);
    const replacement = before + (selectedText || 'text') + after;
    editor.setRangeText(replacement, start, end, 'select');
    if (!selectedText) {
      editor.selectionStart = start + before.length;
      editor.selectionEnd = start + before.length + 4;
    }
    debouncedRender();
  }

  function insertHeading() {
    const { editor } = elements;
    editor.focus();
    const start = editor.selectionStart;
    const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = editor.value.indexOf('\n', start);
    const actualEnd = lineEnd === -1 ? editor.value.length : lineEnd;
    const currentLine = editor.value.substring(lineStart, actualEnd);
    const cleanLine = currentLine.replace(/^#+\s*/, '');
    const replacement = '# ' + cleanLine;
    editor.setRangeText(replacement, lineStart, actualEnd, 'end');
    debouncedRender();
  }

  function insertList() {
    const { editor } = elements;
    editor.focus();
    const start = editor.selectionStart;
    const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
    editor.setRangeText('- ', lineStart, lineStart, 'end');
    debouncedRender();
  }

  function bindEvents() {
    elements.editor.addEventListener('input', debouncedRender);

    elements.btnBold.addEventListener('click', () => insertFormat('**', '**'));
    elements.btnH1.addEventListener('click', insertHeading);
    elements.btnItalic.addEventListener('click', () => insertFormat('*', '*'));
    elements.btnList.addEventListener('click', insertList);
    elements.btnLink.addEventListener('click', () => insertFormat('[', '](url)'));
    elements.btnCode.addEventListener('click', () => insertFormat('`', '`'));

    elements.btnFocus.addEventListener('click', () => setViewMode(VIEW_MODES.FOCUS));
    elements.btnSplit.addEventListener('click', () => setViewMode(VIEW_MODES.SPLIT));
    elements.btnViewOnly.addEventListener('click', () => setViewMode(VIEW_MODES.VIEW_ONLY));

    elements.btnOpen.addEventListener('click', openFileWithPicker);
    elements.btnSave.addEventListener('click', saveFile);
    elements.btnShare.addEventListener('click', shareFile);
    elements.mathMode.addEventListener('change', handleMathModeChange);
    elements.fileInput.addEventListener('change', handleFileSelect);

    elements.shareModalClose.addEventListener('click', closeShareModal);
    elements.shareModal.addEventListener('click', (e) => {
      if (e.target === elements.shareModal) closeShareModal();
    });

    elements.btnTheme.addEventListener('click', toggleTheme);

    document.addEventListener('keydown', handleKeyboardShortcuts);

    elements.editor.addEventListener('keydown', handleTabKey);

    elements.preview.addEventListener('click', handlePreviewClick);

    // MathJax loads with `defer`, so it may arrive after init. Typeset any
    // nodes queued while it was still loading; the window-load flush covers
    // the case where the script finished before this listener attached.
    if (elements.mathjaxScript) {
      elements.mathjaxScript.addEventListener('load', onMathJaxReady);
    }
    window.addEventListener('load', onMathJaxReady);
    if (window.MathJax) onMathJaxReady();

    elements.editor.addEventListener('scroll', () => syncScroll(elements.editor, elements.previewPane));
    elements.previewPane.addEventListener('scroll', () => syncScroll(elements.previewPane, elements.editor));
  }

  function getScrollFraction(el) {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, el.scrollTop / max));
  }

  function setScrollFraction(el, fraction) {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    el.scrollTop = fraction * max;
  }

  // Proportional scroll sync: maps the source's scroll position (0-100%)
  // onto the target, so panes of different lengths stay aligned and the
  // longer pane scrolls faster. rAF-throttled (latest-wins); the epsilon
  // check makes programmatic echoes no-ops, so no feedback loop is possible.
  function syncScroll(source, target) {
    scrollSyncSource = source;
    scrollSyncTarget = target;
    if (scrollSyncQueued) return;
    scrollSyncQueued = true;
    requestAnimationFrame(() => {
      scrollSyncQueued = false;
      const src = scrollSyncSource;
      const dst = scrollSyncTarget;
      scrollSyncSource = scrollSyncTarget = null;
      if (!src || !dst) return;
      if (elements.editorPane.classList.contains('hidden') ||
          elements.previewPane.classList.contains('hidden')) return;
      const fraction = getScrollFraction(src);
      if (Math.abs(fraction - getScrollFraction(dst)) < 0.001) return;
      setScrollFraction(dst, fraction);
    });
  }

  function handlePreviewClick(e) {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#')) return;

    e.preventDefault();
    const targetId = href.slice(1);
    const target = elements.preview.querySelector(`[id="${targetId}"], [id="${decodeURIComponent(targetId)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function handleKeyboardShortcuts(e) {
    // navigator.platform is deprecated: prefer User-Agent Client Hints,
    // fall back to userAgent, then legacy platform if present.
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.userAgent || navigator.platform || '';
    const isMac = platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();

    if (modifier && key === 'o') {
      e.preventDefault();
      openFileWithPicker();
    }

    if (modifier && key === 's') {
      e.preventDefault();
      saveFile();
    }

    if (modifier && key === 'd') {
      e.preventDefault();
      toggleTheme();
    }

    if (modifier && key === 'b') {
      e.preventDefault();
      insertFormat('**', '**');
    }

    if (modifier && key === 'i') {
      e.preventDefault();
      insertFormat('*', '*');
    }

    if (modifier && key === 'k') {
      e.preventDefault();
      insertFormat('[', '](url)');
    }

    if (modifier && key === 'm') {
      e.preventDefault();
      cycleMathMode();
    }

    if (modifier && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }

    if ((modifier && key === 'y') || (modifier && e.shiftKey && key === 'z')) {
      e.preventDefault();
      redo();
    }

    if (e.key === 'Escape') {
      // An open modal consumes Escape first so dismissing it doesn't
      // also yank the view mode back to split.
      if (isShareModalOpen()) {
        e.preventDefault();
        closeShareModal();
        return;
      }
      setViewMode(VIEW_MODES.SPLIT);
    }
  }

  function handleTabKey(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
      this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
      this.selectionStart = this.selectionEnd = start + 2;
      debouncedRender();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
