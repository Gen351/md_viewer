(function() {
  'use strict';

  const STORAGE_KEYS = {
    THEME: 'md-editor-theme',
    VIEW_MODE: 'md-editor-view-mode',
    CONTENT: 'md-editor-content',
    FILENAME: 'md-editor-filename'
  };

  const VIEW_MODES = {
    FOCUS: 'focus',
    SPLIT: 'split',
    VIEW_ONLY: 'view-only'
  };

  const DEBOUNCE_DELAY = 100;

  const state = {
    viewMode: VIEW_MODES.SPLIT,
    theme: 'light',
    content: '',
    filename: '',
    fileHandle: null
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
    btnTheme: null,
    fileInput: null,
    filenameDisplay: null
  };

  let debounceTimer = null;

  function init() {
    cacheElements();
    loadState();
    applyTheme();
    applyViewMode();
    configureMarked();
    bindEvents();
    renderPreview();
    updateFilenameDisplay();
  }

  function configureMarked() {
    const renderer = new marked.Renderer();

    function extractText(tokens) {
      return tokens.map(t => {
        if (t.text && !t.tokens) return t.text;
        if (t.tokens) return extractText(t.tokens);
        return t.raw || '';
      }).join('');
    }

    renderer.heading = function({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const rawText = extractText(tokens);
      const id = rawText.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'heading';
      const anchor = `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>`;
      return `<h${depth} id="${id}">${anchor}${text}</h${depth}>\n`;
    };

    marked.setOptions({
      renderer,
      gfm: true
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
    elements.btnTheme = document.getElementById('btnTheme');
    elements.fileInput = document.getElementById('fileInput');
    elements.filenameDisplay = document.getElementById('filenameDisplay');
  }

  function loadState() {
    state.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    state.viewMode = localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || VIEW_MODES.SPLIT;
    state.content = localStorage.getItem(STORAGE_KEYS.CONTENT) || '';
    state.filename = localStorage.getItem(STORAGE_KEYS.FILENAME) || '';
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

    const html = marked.parse(content);
    const sanitized = DOMPurify.sanitize(html);
    elements.preview.innerHTML = sanitized;
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
    elements.fileInput.addEventListener('change', handleFileSelect);

    elements.btnTheme.addEventListener('click', toggleTheme);

    document.addEventListener('keydown', handleKeyboardShortcuts);

    elements.editor.addEventListener('keydown', handleTabKey);

    elements.preview.addEventListener('click', handlePreviewClick);
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
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    if (modifier && e.key === 'o') {
      e.preventDefault();
      openFileWithPicker();
    }

    if (modifier && e.key === 's') {
      e.preventDefault();
      saveFile();
    }

    if (modifier && e.key === 'd') {
      e.preventDefault();
      toggleTheme();
    }

    if (modifier && e.key === 'b') {
      e.preventDefault();
      insertFormat('**', '**');
    }

    if (modifier && e.key === 'i') {
      e.preventDefault();
      insertFormat('*', '*');
    }

    if (modifier && e.key === 'k') {
      e.preventDefault();
      insertFormat('[', '](url)');
    }

    if (modifier && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }

    if ((modifier && e.key === 'y') || (modifier && e.shiftKey && e.key === 'z')) {
      e.preventDefault();
      redo();
    }

    if (e.key === 'Escape') {
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
