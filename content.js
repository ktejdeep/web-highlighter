// Web Highlighter & Recall - Content Script (Manifest V3)
(() => {
  if (window.__webHighlighterInitialized) return;
  window.__webHighlighterInitialized = true;

  let pageHighlights = [];
  let isExtensionActive = true;
  let activeColor = '#fef08a';
  let isRestoring = false;

  const PALETTE = [
    { name: 'Yellow', hex: '#fef08a', border: '#eab308' },
    { name: 'Green', hex: '#bbf7d0', border: '#22c55e' },
    { name: 'Blue', hex: '#bfdbfe', border: '#3b82f6' },
    { name: 'Pink', hex: '#fbcfe8', border: '#ec4899' },
    { name: 'Orange', hex: '#fed7aa', border: '#f97316' },
    { name: 'Purple', hex: '#e9d5ff', border: '#a855f7' }
  ];

  // Canonical URL normalizer: strips hash, trailing slashes, and ad/tracking params
  function getCanonicalUrl(rawUrl = window.location.href) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      if (u.protocol === 'file:') {
        return ('file://' + u.pathname).toLowerCase().replace(/\/$/, '');
      }
      let pathname = u.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      const cleanParams = new URLSearchParams();
      for (const [key, val] of u.searchParams.entries()) {
        const lower = key.toLowerCase();
        if (
          !lower.startsWith('utm_') &&
          lower !== 'gclid' &&
          lower !== 'fbclid' &&
          lower !== 'ref' &&
          lower !== 'source' &&
          lower !== 'ved' &&
          lower !== 'ei' &&
          lower !== 'oq' &&
          lower !== 'gs_lp'
        ) {
          cleanParams.append(key, val);
        }
      }
      const search = cleanParams.toString() ? '?' + cleanParams.toString() : '';
      return (u.origin + pathname + search).toLowerCase();
    } catch (e) {
      return (rawUrl || '').split('#')[0].replace(/\/$/, '').toLowerCase();
    }
  }

  // Find highlights for a URL with fuzzy fallback matching
  function findHighlightsForUrl(allStorage, targetUrl) {
    if (!allStorage) return [];
    const canonical = getCanonicalUrl(targetUrl);

    // 1. Exact canonical key match
    if (allStorage[canonical] && allStorage[canonical].length > 0) {
      return allStorage[canonical];
    }

    // 2. Exact raw key match
    if (allStorage[targetUrl] && allStorage[targetUrl].length > 0) {
      return allStorage[targetUrl];
    }

    // 3. Normalized key match across all keys
    for (const key in allStorage) {
      if (getCanonicalUrl(key) === canonical) {
        return allStorage[key];
      }
    }

    // 4. Pathname-only fallback (ignoring search params)
    try {
      const targetObj = new URL(targetUrl);
      const targetBase = (targetObj.origin + targetObj.pathname).toLowerCase().replace(/\/$/, '');
      for (const key in allStorage) {
        try {
          const keyObj = new URL(key);
          const keyBase = (keyObj.origin + keyObj.pathname).toLowerCase().replace(/\/$/, '');
          if (targetBase === keyBase && allStorage[key].length > 0) {
            return allStorage[key];
          }
        } catch (e) {}
      }
    } catch (e) {}

    return [];
  }

  // Inject Scoped Styles
  function injectStyles() {
    if (document.getElementById('wh-extension-styles')) return;
    const style = document.createElement('style');
    style.id = 'wh-extension-styles';
    style.textContent = `
      .wh-highlight-mark {
        cursor: pointer !important;
        border-radius: 2px !important;
        padding: 1px 2px !important;
        transition: filter 0.15s ease, background-color 0.15s ease !important;
        display: inline !important;
        text-decoration: none !important;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        color: inherit !important;
      }
      .wh-highlight-mark:hover {
        filter: brightness(0.92) contrast(1.05) !important;
      }
      .wh-highlight-mark.wh-has-note {
        border-bottom: 2px dotted rgba(5, 150, 105, 0.8) !important;
      }
      .wh-highlight-pulse {
        animation: wh-pulse-anim 1.5s ease-in-out !important;
      }
      @keyframes wh-pulse-anim {
        0% { filter: brightness(0.7) !important; box-shadow: 0 0 0 4px rgba(251, 146, 60, 0.6) !important; }
        50% { filter: brightness(1.1) !important; box-shadow: 0 0 0 8px rgba(251, 146, 60, 0.2) !important; }
        100% { filter: none !important; box-shadow: none !important; }
      }

      /* Search Engine Recall Memory Cards */
      .wh-recall-search-result {
        border: 2px solid #2563eb !important;
        background: linear-gradient(135deg, rgba(239, 246, 255, 0.95), rgba(254, 240, 138, 0.22)) !important;
        border-radius: 10px !important;
        padding: 10px 14px !important;
        margin-bottom: 12px !important;
        box-shadow: 0 4px 14px rgba(37, 99, 235, 0.12) !important;
        position: relative !important;
        transition: transform 0.2s ease, box-shadow 0.2s ease !important;
      }
      .wh-recall-search-result:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(37, 99, 235, 0.18) !important;
      }
      .wh-recall-badge {
        display: block !important;
        background: #ffffff !important;
        border: 1px solid #bfdbfe !important;
        border-radius: 6px !important;
        padding: 6px 10px !important;
        margin-bottom: 8px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 11.5px !important;
        line-height: 1.4 !important;
        color: #1e293b !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
      }
      .wh-recall-badge-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        font-weight: 700 !important;
        font-size: 10.5px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        color: #2563eb !important;
        margin-bottom: 3px !important;
      }
      .wh-recall-snippet-quote {
        font-style: italic !important;
        color: #334155 !important;
        background: #fef08a !important;
        padding: 1px 4px !important;
        border-radius: 3px !important;
        display: inline !important;
      }
      .wh-recall-note-tag {
        display: inline-block !important;
        margin-top: 4px !important;
        color: #166534 !important;
        background: #f0fdf4 !important;
        border: 1px solid #bbf7d0 !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        font-weight: 500 !important;
      }

      /* Floating Toast Notification */
      #wh-toast-notification {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: #0f172a;
        color: #f8fafc;
        padding: 9px 15px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12.5px;
        font-weight: 500;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.25s ease, transform 0.25s ease;
        pointer-events: none;
      }
      #wh-toast-notification.wh-toast-visible {
        opacity: 1;
        transform: translateY(0);
      }

      /* Sticky Context Note Popover */
      #wh-sticky-popover {
        position: absolute;
        z-index: 2147483647;
        width: 300px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.16), 0 8px 12px -6px rgba(0, 0, 0, 0.1);
        padding: 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        color: #1e293b;
        box-sizing: border-box;
      }
      #wh-sticky-popover * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .wh-popover-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .wh-popover-title {
        font-weight: 600;
        font-size: 13px;
        color: #0f172a;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .wh-popover-close {
        background: none;
        border: none;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        color: #94a3b8;
        padding: 2px 4px;
        border-radius: 4px;
      }
      .wh-popover-close:hover {
        color: #0f172a;
        background-color: #f1f5f9;
      }
      .wh-popover-quote {
        font-size: 11.5px;
        color: #64748b;
        background: #f8fafc;
        border-left: 3px solid #cbd5e1;
        padding: 6px 8px;
        border-radius: 0 4px 4px 0;
        margin-bottom: 10px;
        max-height: 55px;
        overflow-y: auto;
        word-break: break-word;
      }
      .wh-color-picker-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
      }
      .wh-color-label {
        font-size: 11px;
        color: #64748b;
        font-weight: 500;
      }
      .wh-color-dot {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid transparent;
        transition: transform 0.15s ease, border-color 0.15s ease;
      }
      .wh-color-dot:hover {
        transform: scale(1.15);
      }
      .wh-color-dot.active {
        border-color: #0f172a;
        transform: scale(1.1);
      }
      .wh-popover-textarea {
        width: 100%;
        height: 65px;
        padding: 8px;
        font-size: 12.5px;
        font-family: inherit;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        outline: none;
        resize: vertical;
        margin-bottom: 10px;
        color: #1e293b;
        background-color: #ffffff;
      }
      .wh-popover-textarea:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
      }
      .wh-popover-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .wh-btn {
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        padding: 6px 12px;
        transition: background-color 0.15s ease;
      }
      .wh-btn-save {
        background: #2563eb;
        color: #ffffff;
      }
      .wh-btn-save:hover {
        background: #1d4ed8;
      }
      .wh-btn-delete {
        background: transparent;
        color: #ef4444;
        border: 1px solid #fca5a5;
      }
      .wh-btn-delete:hover {
        background: #fef2f2;
      }
    `;
    document.head.appendChild(style);
  }

  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById('wh-toast-notification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'wh-toast-notification';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('wh-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('wh-toast-visible');
    }, 2500);
  }

  // Clean, atomic DOM TextNode wrapper using native splitText API
  function wrapSingleTextNode(textNode, startIndex, length, hl) {
    if (!textNode || !textNode.parentNode) return null;
    if (startIndex < 0 || length <= 0) return null;

    try {
      let target = textNode;
      if (startIndex > 0) {
        target = textNode.splitText(startIndex);
      }
      if (target.nodeValue.length > length) {
        target.splitText(length);
      }

      const mark = document.createElement('mark');
      mark.className = 'wh-highlight-mark' + (hl.note ? ' wh-has-note' : '');
      mark.setAttribute('data-highlight-id', hl.id);
      mark.style.backgroundColor = hl.color || '#fef08a';
      mark.addEventListener('click', handleHighlightClick);

      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      return mark;
    } catch (e) {
      console.warn("Could not wrap text node cleanly:", e);
      return null;
    }
  }

  // Regex builder matching words across variable spaces, newlines, tabs
  function makeFlexibleWhitespaceRegex(text) {
    if (!text) return null;
    try {
      const words = text
        .trim()
        .split(/\s+/)
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return new RegExp(words.join('\\s+'), 'i');
    } catch (e) {
      return null;
    }
  }

  // 1. Text Highlighting Engine
  function highlightSelection(providedText, autoOpenNote = false) {
    if (!isExtensionActive) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const text = (providedText || selection.toString()).trim();
    if (!text || text.length < 2) return;

    const range = selection.getRangeAt(0);
    const highlightId = `hl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const chosenColor = activeColor || '#fef08a';

    const highlightRecord = {
      id: highlightId,
      text: text,
      color: chosenColor,
      url: getCanonicalUrl(),
      rawUrl: window.location.href,
      title: document.title || window.location.hostname,
      note: '',
      timestamp: Date.now()
    };

    // Apply highlight directly using splitText
    let created = false;
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      const mark = wrapSingleTextNode(range.startContainer, range.startOffset, range.endOffset - range.startOffset, highlightRecord);
      if (mark) created = true;
    } else {
      created = applyHighlightRecord(highlightRecord);
    }

    selection.removeAllRanges();

    if (!created) {
      created = applyHighlightRecord(highlightRecord);
    }

    // Add to in-memory array and save to unified storage
    pageHighlights.push(highlightRecord);
    saveHighlightsToStorage();

    if (autoOpenNote) {
      const mark = document.querySelector(`[data-highlight-id="${highlightId}"]`);
      if (mark) showStickyNotePopover(mark, highlightRecord);
    }
  }

  // 2. Instant Selection Highlighting (When Extension is ON)
  function handleAutoSelectionHighlight(e) {
    if (!isExtensionActive) return;

    if (e.target.closest('#wh-sticky-popover') || e.target.closest('#wh-toast-notification')) {
      return;
    }

    const tagName = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tagName === 'input' || tagName === 'textarea' || e.target.isContentEditable) {
      return;
    }

    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

      const selectedText = selection.toString().trim();
      if (selectedText.length >= 2) {
        const anchorNode = selection.anchorNode;
        if (anchorNode && anchorNode.parentNode && anchorNode.parentNode.classList && anchorNode.parentNode.classList.contains('wh-highlight-mark')) {
          return;
        }

        highlightSelection(selectedText, false);
      }
    }, 20);
  }

  document.addEventListener('mouseup', handleAutoSelectionHighlight);

  // 3. Sticky Context Notes & Popover
  function handleHighlightClick(e) {
    if (!isExtensionActive) return;
    e.preventDefault();
    e.stopPropagation();

    const mark = e.currentTarget;
    const highlightId = mark.getAttribute('data-highlight-id');
    const record = pageHighlights.find(h => h.id === highlightId);
    if (!record) return;

    showStickyNotePopover(mark, record);
  }

  function showStickyNotePopover(anchorElement, record) {
    removeExistingPopover();

    const popover = document.createElement('div');
    popover.id = 'wh-sticky-popover';

    const shortQuote = record.text.length > 75 ? record.text.substring(0, 72) + '...' : record.text;
    const currentColor = record.color || '#fef08a';

    const colorDotsHtml = PALETTE.map(c => `
      <div class="wh-color-dot ${c.hex === currentColor ? 'active' : ''}" 
           data-hex="${c.hex}" 
           title="${c.name}" 
           style="background-color: ${c.hex}; border-color: ${c.hex === currentColor ? '#0f172a' : c.border};">
      </div>
    `).join('');

    popover.innerHTML = `
      <div class="wh-popover-header">
        <div class="wh-popover-title">
          <span>📝 Sticky Context Note</span>
        </div>
        <button class="wh-popover-close" id="wh-close-popover" title="Close">✕</button>
      </div>
      <div class="wh-popover-quote" title="${escapeAttribute(record.text)}">“${escapeHtml(shortQuote)}”</div>
      <div class="wh-color-picker-row">
        <span class="wh-color-label">Color:</span>
        ${colorDotsHtml}
      </div>
      <textarea class="wh-popover-textarea" id="wh-note-input" placeholder="Why did you highlight this? Add your context note...">${escapeHtml(record.note || '')}</textarea>
      <div class="wh-popover-actions">
        <button class="wh-btn wh-btn-delete" id="wh-delete-btn" title="Permanently delete this highlight and note">🗑️ Delete</button>
        <button class="wh-btn wh-btn-save" id="wh-save-btn">Save Note</button>
      </div>
    `;

    document.body.appendChild(popover);

    const rect = anchorElement.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    let top = rect.bottom + scrollTop + 8;
    let left = rect.left + scrollLeft;

    const popoverWidth = 300;
    if (left + popoverWidth > window.innerWidth + scrollLeft - 15) {
      left = window.innerWidth + scrollLeft - popoverWidth - 15;
    }
    if (left < scrollLeft + 10) {
      left = scrollLeft + 10;
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    const dots = popover.querySelectorAll('.wh-color-dot');
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const selectedHex = dot.getAttribute('data-hex');
        dots.forEach(d => {
          d.classList.remove('active');
          d.style.borderColor = PALETTE.find(p => p.hex === d.getAttribute('data-hex'))?.border || 'transparent';
        });
        dot.classList.add('active');
        dot.style.borderColor = '#0f172a';

        record.color = selectedHex;
        saveHighlightsToStorage();

        const relatedMarks = document.querySelectorAll(`[data-highlight-id="${record.id}"]`);
        relatedMarks.forEach(m => {
          m.style.backgroundColor = selectedHex;
        });
      });
    });

    const textarea = popover.querySelector('#wh-note-input');
    textarea.focus();

    popover.querySelector('#wh-save-btn').addEventListener('click', () => {
      const newNote = textarea.value.trim();
      record.note = newNote;
      saveHighlightsToStorage();

      const relatedMarks = document.querySelectorAll(`[data-highlight-id="${record.id}"]`);
      relatedMarks.forEach(m => {
        if (newNote) {
          m.classList.add('wh-has-note');
        } else {
          m.classList.remove('wh-has-note');
        }
      });

      removeExistingPopover();
    });

    popover.querySelector('#wh-delete-btn').addEventListener('click', () => {
      deleteHighlight(record.id);
      removeExistingPopover();
    });

    popover.querySelector('#wh-close-popover').addEventListener('click', () => {
      removeExistingPopover();
    });

    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        removeExistingPopover();
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        popover.querySelector('#wh-save-btn').click();
      }
    });

    setTimeout(() => {
      const handleOutsideClick = (evt) => {
        if (!popover.contains(evt.target) && !anchorElement.contains(evt.target)) {
          removeExistingPopover();
          document.removeEventListener('click', handleOutsideClick);
        }
      };
      document.addEventListener('click', handleOutsideClick);
    }, 50);
  }

  function removeExistingPopover() {
    const existing = document.getElementById('wh-sticky-popover');
    if (existing) existing.remove();
  }

  function deleteHighlight(highlightId) {
    // 1. Remove from in-memory pageHighlights
    pageHighlights = pageHighlights.filter(h => h.id !== highlightId);

    // 2. Remove directly from chrome.storage.local without re-merging deleted item
    const canonical = getCanonicalUrl();
    chrome.storage.local.get({ allWebHighlights: {} }, (result) => {
      const allWebHighlights = result.allWebHighlights || {};
      for (const key in allWebHighlights) {
        if (getCanonicalUrl(key) === canonical) {
          allWebHighlights[key] = (allWebHighlights[key] || []).filter(h => h.id !== highlightId);
          if (allWebHighlights[key].length === 0) {
            delete allWebHighlights[key];
          }
        }
      }
      chrome.storage.local.set({ allWebHighlights });
    });

    // 3. Remove all marks with this ID from the DOM
    const marks = document.querySelectorAll(`[data-highlight-id="${highlightId}"]`);
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      }
    });

    removeExistingPopover();
    showToast("🗑️ Highlight deleted");
  }

  // 4. Unified Storage Persistence (Consolidates all markings for the same page under one canonical key)
  function saveHighlightsToStorage() {
    const canonical = getCanonicalUrl();
    chrome.storage.local.get({ allWebHighlights: {} }, (result) => {
      const allWebHighlights = result.allWebHighlights || {};

      // Gather any existing highlights under variant keys for this site and clean them up
      const mergedMap = new Map();
      for (const key in allWebHighlights) {
        if (getCanonicalUrl(key) === canonical) {
          const list = allWebHighlights[key];
          if (Array.isArray(list)) {
            list.forEach(h => mergedMap.set(h.id, h));
          }
          delete allWebHighlights[key];
        }
      }

      // Merge current in-memory highlights
      pageHighlights.forEach(h => mergedMap.set(h.id, h));

      const unifiedHighlights = Array.from(mergedMap.values());
      pageHighlights = unifiedHighlights;

      if (unifiedHighlights.length > 0) {
        allWebHighlights[canonical] = unifiedHighlights;
      }

      chrome.storage.local.set({ allWebHighlights });
    });
  }

  // 5. Robust Highlight Application (Handles Single-Node, Normalized, & Cross-Node Text)
  function applyHighlightRecord(hl) {
    if (!hl || !hl.text || !document.body) return false;
    if (document.querySelector(`[data-highlight-id="${hl.id}"]`)) return true;

    const targetText = hl.text.trim();
    if (!targetText) return false;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName ? parent.tagName.toLowerCase() : '';
          if (
            tag === 'script' ||
            tag === 'style' ||
            tag === 'textarea' ||
            tag === 'input' ||
            tag === 'select' ||
            tag === 'noscript' ||
            parent.isContentEditable ||
            parent.classList.contains('wh-highlight-mark') ||
            parent.closest('#wh-sticky-popover')
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let textNode;
    const nodes = [];

    // Pass 1: Exact substring match in single text nodes
    while ((textNode = walker.nextNode())) {
      nodes.push(textNode);
      const val = textNode.nodeValue;
      const idx = val.indexOf(targetText);
      if (idx !== -1) {
        wrapSingleTextNode(textNode, idx, targetText.length, hl);
        return true;
      }
    }

    // Pass 2: Whitespace-resilient regex match in single text nodes
    const regex = makeFlexibleWhitespaceRegex(targetText);
    if (regex) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const match = node.nodeValue.match(regex);
        if (match && match.index !== undefined) {
          wrapSingleTextNode(node, match.index, match[0].length, hl);
          return true;
        }
      }
    }

    // Pass 3: Cross-node text mapping
    if (nodes.length > 0) {
      let combined = '';
      const nodeMaps = [];

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const start = combined.length;
        combined += n.nodeValue;
        nodeMaps.push({ node: n, start, end: combined.length, length: n.nodeValue.length });
      }

      let matchStart = combined.indexOf(targetText);
      let matchLen = targetText.length;

      if (matchStart === -1 && regex) {
        const flexMatch = combined.match(regex);
        if (flexMatch && flexMatch.index !== undefined) {
          matchStart = flexMatch.index;
          matchLen = flexMatch[0].length;
        }
      }

      if (matchStart !== -1) {
        const matchEnd = matchStart + matchLen;
        for (const map of nodeMaps) {
          if (map.end > matchStart && map.start < matchEnd) {
            const sliceStart = Math.max(0, matchStart - map.start);
            const sliceEnd = Math.min(map.length, matchEnd - map.start);
            const sliceLen = sliceEnd - sliceStart;
            if (sliceLen > 0) {
              wrapSingleTextNode(map.node, sliceStart, sliceLen, hl);
            }
          }
        }
        return true;
      }
    }

    return false;
  }

  // 6. Persistence & Re-Highlighting Engine
  function restoreHighlights() {
    if (!isExtensionActive) return;
    if (isRestoring) return;
    isRestoring = true;

    chrome.storage.local.get({ allWebHighlights: {} }, (result) => {
      const allWebHighlights = result.allWebHighlights || {};
      const savedList = findHighlightsForUrl(allWebHighlights, window.location.href);

      if (savedList && savedList.length > 0) {
        // Merge with existing in-memory highlights
        const map = new Map();
        pageHighlights.forEach(h => map.set(h.id, h));
        savedList.forEach(h => map.set(h.id, h));
        pageHighlights = Array.from(map.values());

        pageHighlights.forEach(hl => {
          applyHighlightRecord(hl);
        });
      }

      // Check if current page is a search engine results page (Google, Bing, DuckDuckGo)
      highlightRecallSearchResults(allWebHighlights);

      isRestoring = false;
      checkUrlHashForJump();
    });
  }

  // 7. Search Engine Memory: Highlight Previously Marked Websites on Search Engine Results
  function highlightRecallSearchResults(allStorage) {
    if (!allStorage || Object.keys(allStorage).length === 0) return;

    const hostname = window.location.hostname.toLowerCase();
    const isSearchEngine =
      hostname.includes('google.') ||
      hostname.includes('bing.com') ||
      hostname.includes('duckduckgo.com') ||
      hostname.includes('yahoo.com') ||
      hostname.includes('ecosia.org');

    if (!isSearchEngine) return;

    const links = document.querySelectorAll('a[href^="http"]:not([data-wh-processed])');

    links.forEach(a => {
      a.setAttribute('data-wh-processed', 'true');
      const href = a.href;
      if (!href) return;

      try {
        const urlObj = new URL(href);
        if (urlObj.hostname.includes('google.') || urlObj.hostname.includes('bing.com') || urlObj.hostname.includes('duckduckgo.')) {
          return;
        }
      } catch (e) {
        return;
      }

      const matchingHighlights = findHighlightsForUrl(allStorage, href);
      if (matchingHighlights && matchingHighlights.length > 0) {
        markSearchResultElement(a, matchingHighlights);
      }
    });
  }

  function markSearchResultElement(linkElement, highlights) {
    const card =
      linkElement.closest('.g') ||
      linkElement.closest('.tF2Cxc') ||
      linkElement.closest('.MjjYud') ||
      linkElement.closest('div[data-hveid]') ||
      linkElement.closest('li.b_algo') ||
      linkElement.closest('article[data-testid="result"]') ||
      linkElement.closest('div.result') ||
      linkElement.parentElement;

    if (!card || card.hasAttribute('data-wh-badged')) return;
    card.setAttribute('data-wh-badged', 'true');
    card.classList.add('wh-recall-search-result');

    const firstHl = highlights[0];
    const previewText = firstHl.text.length > 95 ? firstHl.text.substring(0, 92) + '...' : firstHl.text;
    const count = highlights.length;
    const noteText = firstHl.note ? firstHl.note.substring(0, 70) : '';

    const badge = document.createElement('div');
    badge.className = 'wh-recall-badge';
    badge.innerHTML = `
      <div class="wh-recall-badge-header">
        <span>🧠 Recall Memory (${count} Saved Highlight${count > 1 ? 's' : ''})</span>
        <span>Marked Page</span>
      </div>
      <div>
        “<span class="wh-recall-snippet-quote">${escapeHtml(previewText)}</span>”
      </div>
      ${noteText ? `<div class="wh-recall-note-tag">📝 Your Note: ${escapeHtml(noteText)}</div>` : ''}
    `;

    card.insertBefore(badge, card.firstChild);
  }

  function hideAllHighlightsFromDOM() {
    removeExistingPopover();
    const marks = document.querySelectorAll('.wh-highlight-mark');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      }
    });

    const badgedCards = document.querySelectorAll('.wh-recall-search-result');
    badgedCards.forEach(c => {
      c.classList.remove('wh-recall-search-result');
      const badge = c.querySelector('.wh-recall-badge');
      if (badge) badge.remove();
      c.removeAttribute('data-wh-badged');
    });
  }

  // 8. Auto-Jump & Smooth-Scroll
  function jumpToHighlight(highlightId) {
    if (!isExtensionActive) {
      showToast("Web Highlighter is OFF. Turn it ON to jump to highlights.");
      return false;
    }

    let element = document.querySelector(`[data-highlight-id="${highlightId}"]`);
    if (!element) {
      restoreHighlights();
      element = document.querySelector(`[data-highlight-id="${highlightId}"]`);
    }

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.remove('wh-highlight-pulse');
      void element.offsetWidth;
      element.classList.add('wh-highlight-pulse');
      setTimeout(() => {
        element.classList.remove('wh-highlight-pulse');
      }, 2000);
      return true;
    }
    return false;
  }

  function checkUrlHashForJump() {
    const hash = window.location.hash;
    if (hash && hash.includes('web-hl=')) {
      const match = hash.match(/web-hl=([^&]+)/);
      if (match && match[1]) {
        setTimeout(() => jumpToHighlight(match[1]), 300);
      }
    }
  }

  // Runtime Messages Router
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "highlightCurrentSelection") {
      if (request.extensionActive === false) {
        isExtensionActive = false;
        showToast("⚠️ Web Highlighter is OFF. Turn it ON to highlight.");
      } else {
        highlightSelection(request.selectedText, true);
      }
      sendResponse({ success: true });
    } else if (request.action === "toggleExtensionActive") {
      isExtensionActive = Boolean(request.active);
      if (isExtensionActive) {
        restoreHighlights();
        showToast("✨ Web Highlighter ON: Select any text to highlight.");
      } else {
        hideAllHighlightsFromDOM();
        showToast("⏸️ Web Highlighter OFF: Highlights hidden.");
      }
      sendResponse({ success: true });
    } else if (request.action === "activeColorChanged") {
      activeColor = request.color;
      sendResponse({ success: true });
    } else if (request.action === "recolorPageHighlights") {
      const newColor = request.color;
      pageHighlights.forEach(hl => {
        hl.color = newColor;
      });
      saveHighlightsToStorage();
      const allMarks = document.querySelectorAll('.wh-highlight-mark');
      allMarks.forEach(m => {
        m.style.backgroundColor = newColor;
      });
      showToast(`🎨 Recylored ${pageHighlights.length} highlights!`);
      sendResponse({ success: true });
    } else if (request.action === "autoJumpToPosition" && request.highlightId) {
      let found = jumpToHighlight(request.highlightId);
      if (!found) {
        setTimeout(() => {
          found = jumpToHighlight(request.highlightId);
          sendResponse({ success: found });
        }, 150);
        return true;
      }
      sendResponse({ success: true });
    } else if (request.action === "restoreAndJump" && request.highlightId) {
      restoreHighlights();
      setTimeout(() => {
        const found = jumpToHighlight(request.highlightId);
        sendResponse({ success: found });
      }, 200);
      return true;
    } else if (request.action === "deleteHighlightFromPopup" && request.highlightId) {
      deleteHighlight(request.highlightId);
      sendResponse({ success: true });
    }
    return true;
  });

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(str) {
    return String(str || '')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Initialization & Multi-Pass Restorations
  injectStyles();

  chrome.storage.local.get({ extensionActive: true, activeColor: '#fef08a' }, (res) => {
    isExtensionActive = res.extensionActive !== false;
    activeColor = res.activeColor || '#fef08a';

    if (isExtensionActive) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreHighlights);
      } else {
        restoreHighlights();
      }

      window.addEventListener('load', restoreHighlights);

      setTimeout(restoreHighlights, 200);
      setTimeout(restoreHighlights, 600);
      setTimeout(restoreHighlights, 1500);
    }
  });

  // Observe dynamically loaded elements (Single Page Apps, Infinite scroll, Google search results)
  let mutationDebounce;
  const observer = new MutationObserver(() => {
    if (!isExtensionActive) return;
    clearTimeout(mutationDebounce);
    mutationDebounce = setTimeout(() => {
      restoreHighlights();
    }, 350);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Storage synchronization across tabs
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.extensionActive) {
        isExtensionActive = changes.extensionActive.newValue !== false;
        if (isExtensionActive) {
          restoreHighlights();
        } else {
          hideAllHighlightsFromDOM();
        }
      }
      if (changes.activeColor) {
        activeColor = changes.activeColor.newValue || '#fef08a';
      }
      if (changes.allWebHighlights && isExtensionActive) {
        restoreHighlights();
      }
    }
  });
})();
