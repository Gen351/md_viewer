(function() {
  'use strict';

  const STORAGE_KEYS = {
    THEME: 'md-editor-theme',
    VIEW_MODE: 'md-editor-view-mode',
    CONTENT: 'md-editor-content',
    FILENAME: 'md-editor-filename',
    MATH_MODE: 'md-editor-math-mode',
    CODE_THEME: 'md-editor-code-theme'
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

  const CODE_THEMES = {
    AUTO: 'auto',
    GITHUB: 'github',
    GITHUB_DARK: 'github-dark',
    MONOKAI: 'monokai',
    DRACULA: 'dracula',
    NORD: 'nord'
  };

  const HLJS_STYLE_BASE = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/';
  // Dracula is a third-party theme (not bundled with highlight.js core),
  // served from its official repo. Everything else comes from the pinned
  // @highlightjs/cdn-assets package.
  const CODE_THEME_URLS = {
    'github': HLJS_STYLE_BASE + 'github.min.css',
    'github-dark': HLJS_STYLE_BASE + 'github-dark.min.css',
    'monokai': HLJS_STYLE_BASE + 'monokai.min.css',
    'nord': HLJS_STYLE_BASE + 'nord.min.css',
    'dracula': 'https://cdn.jsdelivr.net/gh/dracula/highlightjs@master/dracula.css'
  };
  const HLJS_AUTO_LIGHT = CODE_THEMES.GITHUB;
  const HLJS_AUTO_DARK = CODE_THEMES.GITHUB_DARK;

  const DEBOUNCE_DELAY = 100;
  const ENHANCE_DELAY = 250;
  const ENHANCE_CHUNK = 6;

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
    mathMode: MATH_MODES.OFF,
    codeTheme: CODE_THEMES.AUTO
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
    mathjaxScript: null,
    menuBtn: null,
    settingsMenu: null,
    mathMenuBtn: null,
    mathFlyout: null,
    codeMenuBtn: null,
    codeFlyout: null,
    hljsTheme: null,
    hljsScript: null
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

  // Math (LaTeX) state: placeholder records for the current render.
  let pendingMaths = [];

  // Render generations: every sync commit bumps renderGen; async enhance
  // stages abort when their generation goes stale, so slow work can never
  // overwrite (or append to) newer output.
  let renderGen = 0;
  let enhanceTimer = null;

  function init() {
    cacheElements();
    loadState();
    applyTheme();
    applyViewMode();
    applyMathMode();
    applyCodeTheme();
    configureMarked();
    configureHljs();
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
    elements.mathjaxScript = document.getElementById('mathjaxScript');
    elements.menuBtn = document.getElementById('menuBtn');
    elements.settingsMenu = document.getElementById('settingsMenu');
    elements.mathMenuBtn = document.getElementById('mathMenuBtn');
    elements.mathFlyout = document.getElementById('mathFlyout');
    elements.codeMenuBtn = document.getElementById('codeMenuBtn');
    elements.codeFlyout = document.getElementById('codeFlyout');
    elements.hljsTheme = document.getElementById('hljsTheme');
    elements.hljsScript = document.getElementById('hljsScript');
  }

  function loadState() {
    state.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    state.viewMode = localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || VIEW_MODES.SPLIT;
    state.mathMode = localStorage.getItem(STORAGE_KEYS.MATH_MODE) || MATH_MODES.OFF;
    if (!Object.values(MATH_MODES).includes(state.mathMode)) {
      state.mathMode = MATH_MODES.OFF;
    }
    state.codeTheme = localStorage.getItem(STORAGE_KEYS.CODE_THEME) || CODE_THEMES.AUTO;
    if (!Object.values(CODE_THEMES).includes(state.codeTheme)) {
      state.codeTheme = CODE_THEMES.AUTO;
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
    applyHljsTheme();
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
    syncFlyoutSelection(elements.mathFlyout, state.mathMode);
    localStorage.setItem(STORAGE_KEYS.MATH_MODE, state.mathMode);
  }

  // Marks the active option in a flyout (checkmark + aria-checked).
  function syncFlyoutSelection(flyout, value) {
    if (!flyout) return;
    flyout.querySelectorAll('[data-value]').forEach(opt => {
      const selected = opt.getAttribute('data-value') === value;
      opt.classList.toggle('selected', selected);
      opt.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
  }

  function applyCodeTheme() {
    syncFlyoutSelection(elements.codeFlyout, state.codeTheme);
    localStorage.setItem(STORAGE_KEYS.CODE_THEME, state.codeTheme);
    applyHljsTheme();
  }

  function setCodeTheme(id) {
    if (!Object.values(CODE_THEMES).includes(id)) return;
    state.codeTheme = id;
    applyCodeTheme();
  }

  function currentHljsThemeUrl() {
    const id = state.codeTheme === CODE_THEMES.AUTO
      ? (state.theme === 'dark' ? HLJS_AUTO_DARK : HLJS_AUTO_LIGHT)
      : state.codeTheme;
    return CODE_THEME_URLS[id] || CODE_THEME_URLS[HLJS_AUTO_LIGHT];
  }

  // Single on-demand stylesheet: only the active theme CSS is fetched.
  function applyHljsTheme() {
    if (!elements.hljsTheme) return;
    const href = currentHljsThemeUrl();
    if (elements.hljsTheme.getAttribute('href') !== href) {
      elements.hljsTheme.setAttribute('href', href);
    }
  }

  function configureHljs() {
    if (!window.hljs || !window.hljs.configure) return;
    // The default matcher only accepts word chars, so `language-C++` would
    // resolve to just `C`. Allow +, #, . and - so C++/C# tags work.
    window.hljs.configure({ languageDetectRe: /language-([\w#+.-]+)/ });
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

  function isMenuOpen() {
    return !!elements.settingsMenu && !elements.settingsMenu.classList.contains('hidden');
  }

  function openMenu() {
    elements.settingsMenu.classList.remove('hidden');
    elements.menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu(refocus) {
    if (!isMenuOpen()) return;
    closeFlyouts();
    elements.settingsMenu.classList.add('hidden');
    elements.menuBtn.setAttribute('aria-expanded', 'false');
    if (refocus && elements.menuBtn) elements.menuBtn.focus();
  }

  function toggleMenu() {
    if (isMenuOpen()) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function toggleFlyout(btn, flyout) {
    const willOpen = flyout.classList.contains('hidden');
    closeFlyouts();
    if (willOpen) {
      flyout.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  function closeFlyouts() {
    [elements.mathFlyout, elements.codeFlyout].forEach(f => {
      if (f) f.classList.add('hidden');
    });
    [elements.mathMenuBtn, elements.codeMenuBtn].forEach(b => {
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }

  function handleOutsideMenu(e) {
    if (!isMenuOpen()) return;
    if (e.target.closest && e.target.closest('.menu-wrapper')) return;
    closeMenu();
  }

  function handleMenuKeys(e) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(elements.settingsMenu.querySelectorAll('button'))
      .filter(b => b.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') items[(i + 1 + items.length) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else if (e.key === 'Home') items[0].focus();
    else items[items.length - 1].focus();
  }

  // Adds a Copy button to every fenced code block. Dependency-free on
  // purpose (plain DOM only): copying keeps working even if highlight.js
  // failed to load or is blocked.
  function addCopyButtons() {
    if (!elements.preview) return;
    elements.preview.querySelectorAll('pre code').forEach(code => {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== 'PRE' || pre.classList.contains('has-copy-btn')) return;
      pre.classList.add('has-copy-btn');
      // Accessible name carries the language tag when present, so screen
      // reader users know what the block (and its button) refers to.
      const tag = codeTagName(code);
      pre.setAttribute('aria-label', tag ? tag + ' code' : 'Code block');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy ' + (tag ? tag + ' ' : '') + 'code to clipboard');
      // Announces the "Copied!" confirmation to assistive tech.
      btn.setAttribute('aria-live', 'polite');
      btn.addEventListener('click', async () => {
        try {
          await copyText(code.textContent);
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        } catch (e) {
          console.error('Copy failed:', e);
        }
      });
      pre.appendChild(btn);
    });
  }

  // Raw language tag from the fence info string, e.g. "C++", "cpp".
  function codeTagName(code) {
    const m = code.className.match(/language-([\w#+.-]+)/);
    return m ? m[1] : '';
  }

  // Highlights one fenced code block with an explicit, supported language
  // tag (tagged-only). Called from the enhance pass, chunk by chunk.
  function highlightOneBlock(code) {
    if (code.classList.contains('nohighlight') || code.classList.contains('plaintext')) return;
    if (code.dataset.highlighted) return;
    const tag = codeTagName(code);
    if (!tag || !window.hljs.getLanguage(tag.toLowerCase())) return;
    try {
      window.hljs.highlightElement(code);
    } catch (e) {
      console.error('Code highlighting failed:', e);
    }
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

    // Line-level only: callers rejoin with '\n'. (Inline code spans are
    // split one level down, per line, and rejoined with ''.)
    return segments;
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
  function hasMathChars(src, flags) {
    // Microsecond pre-scan: skip the whole extraction pass when no math
    // delimiters can possibly match.
    if (flags.displayDollar && src.includes('$$')) return true;
    if (flags.latex && (src.includes('\\(') || src.includes('\\['))) return true;
    if (flags.inlineDollar && /\$(?!\s)/.test(src)) return true;
    return false;
  }

  function extractMath(src, flags) {
    const maths = [];
    // Fast path: no code spans possible without backticks — extract inline.
    if (!src.includes('`')) {
      return { text: extractMathDelimiters(src, flags, maths), maths };
    }
    const parts = splitCodeSegments(src).map(seg => {
      if (seg.isCode) return seg.text;
      return extractMathFromText(seg.text, flags, maths);
    });
    // Segments tile whole source lines, so '\n' restores each boundary
    // separator exactly (join('') would fuse lines and corrupt fences).
    return { text: parts.join('\n'), maths };
  }

  // Splits one line on inline code spans, extracts math from the non-code
  // pieces, and rejoins losslessly with ''.
  function extractMathFromText(text, flags, maths) {
    const pieces = [];
    splitInlineCode(text, pieces);
    return pieces.map(piece => {
      if (piece.isCode) return piece.text;
      return extractMathDelimiters(piece.text, flags, maths);
    }).join('');
  }

  function extractMathDelimiters(text, flags, maths) {
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

  function yieldToMain() {
    // Lets the keystroke paint land before heavy work resumes. Idle-callback
    // waits for a real lull (with a cap); setTimeout is the fallback.
    return new Promise(resolve => {
      if (window.requestIdleCallback) {
        requestIdleCallback(() => resolve(), { timeout: 60 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function scheduleEnhance(gen) {
    clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(() => runEnhance(gen), ENHANCE_DELAY);
  }

  async function runEnhance(gen) {
    if (gen !== renderGen) return;
    await yieldToMain();
    if (gen !== renderGen || !elements.preview) return;

    // Highlight in chunks so huge docs can't block typing; abort cleanly
    // when a newer commit lands mid-pass.
    if (window.hljs) {
      const blocks = Array.from(elements.preview.querySelectorAll('pre code'));
      for (let i = 0; i < blocks.length; i += ENHANCE_CHUNK) {
        if (gen !== renderGen) return;
        blocks.slice(i, i + ENHANCE_CHUNK).forEach(highlightOneBlock);
        await yieldToMain();
      }
    }
    if (gen !== renderGen) return;

    // Re-query at fire time: only ever touches the current DOM, and only
    // spans MathJax hasn't processed yet.
    if (window.MathJax && window.MathJax.typesetPromise) {
      const spans = Array.from(elements.preview.querySelectorAll('span.math'))
        .filter(n => !n.querySelector('mjx-container'));
      if (spans.length) {
        try {
          await window.MathJax.typesetPromise(spans);
        } catch (e) {
          console.error('MathJax typeset failed:', e);
        }
      }
    }
    // MathJax still arriving is covered by onMathJaxReady → scheduleEnhance.
  }

  function onMathJaxReady() {
    // The MathJax global exists as soon as our config block runs, but
    // startup.promise only appears once the library itself executes.
    // Funnels through the normal enhance path so a late arrival typesets
    // exactly once, on the current DOM.
    if (!window.MathJax || !window.MathJax.startup || !window.MathJax.startup.promise) return;
    window.MathJax.startup.promise.then(() => scheduleEnhance(renderGen));
  }

  function renderPreview() {
    // Every commit bumps the generation: async enhance stages check it and
    // abort when stale, so slow work never touches newer output.
    const gen = ++renderGen;
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
      const flags = mathDelimitersActive();
      // Tier-0 fast path: skip extraction entirely when no math chars exist.
      if (hasMathChars(content, flags)) {
        const extracted = extractMath(content, flags);
        source = extracted.text;
        pendingMaths = extracted.maths;
      }
    }

    const html = mdParser.parse(source);
    const sanitized = DOMPurify.sanitize(html);

    // Preserve preview scroll across the full-DOM rebuild (the programmatic
    // set is absorbed by scroll sync's epsilon guard — no feedback loop).
    const paneTop = elements.previewPane.scrollTop;
    const paneLeft = elements.previewPane.scrollLeft;
    elements.preview.innerHTML = sanitized;
    elements.previewPane.scrollTop = paneTop;
    elements.previewPane.scrollLeft = paneLeft;

    const links = elements.preview.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !link.getAttribute('target')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    });

    // Sync commit ends here: placeholders show raw TeX until enhance runs,
    // copy buttons are cheap DOM. Heavy work trails in scheduleEnhance().
    restoreMathPlaceholders();
    addCopyButtons();
    saveState();

    // Only schedule heavy work when there is something to enhance
    // (an escaped "&lt;pre" in text may false-positive the string check —
    // harmless, the pass then simply finds nothing).
    if (pendingMaths.length || sanitized.includes('<pre')) {
      scheduleEnhance(gen);
    }
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
    closeMenu();
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
    closeMenu();
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
    closeMenu();
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
    elements.fileInput.addEventListener('change', handleFileSelect);

    elements.menuBtn.addEventListener('click', toggleMenu);
    elements.mathMenuBtn.addEventListener('click', () => toggleFlyout(elements.mathMenuBtn, elements.mathFlyout));
    elements.codeMenuBtn.addEventListener('click', () => toggleFlyout(elements.codeMenuBtn, elements.codeFlyout));
    elements.mathFlyout.querySelectorAll('[data-value]').forEach(opt => {
      opt.addEventListener('click', () => {
        setMathMode(opt.getAttribute('data-value'));
        closeMenu(true);
      });
    });
    elements.codeFlyout.querySelectorAll('[data-value]').forEach(opt => {
      opt.addEventListener('click', () => {
        setCodeTheme(opt.getAttribute('data-value'));
        closeMenu(true);
      });
    });
    elements.settingsMenu.addEventListener('keydown', handleMenuKeys);
    document.addEventListener('pointerdown', handleOutsideMenu);
    if (elements.hljsScript) {
      elements.hljsScript.addEventListener('load', () => {
        configureHljs();
        // Late arrival: enhance whatever is on screen now.
        scheduleEnhance(renderGen);
      });
      // A missing/blocked library degrades silently by design (plain code,
      // working copy buttons) — but a wrong URL is a config bug, so be loud.
      elements.hljsScript.addEventListener('error', () => {
        console.error('highlight.js failed to load — code blocks will stay plain.');
      });
    }

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
      if (isMenuOpen()) {
        e.preventDefault();
        closeMenu(true);
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
