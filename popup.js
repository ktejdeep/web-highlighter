// Web Highlighter & Recall - Popup Controller (Manifest V3)

let allStoredData = {};
let currentTabUrl = '';
let currentTabTitle = '';
let activeScope = 'all'; // 'all' or 'current'
let isExtensionActive = true;
let activeColor = '#fef08a';

const PALETTE = [
  { name: 'Sunny Yellow', hex: '#fef08a' },
  { name: 'Mint Green', hex: '#bbf7d0' },
  { name: 'Sky Blue', hex: '#bfdbfe' },
  { name: 'Soft Pink', hex: '#fbcfe8' },
  { name: 'Warm Orange', hex: '#fed7aa' },
  { name: 'Lavender', hex: '#e9d5ff' }
];

// Canonical URL normalizer matching content.js
function getCanonicalUrl(rawUrl) {
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

// Group all stored highlights into unified site entries by canonical URL
function getUnifiedSiteGroups() {
  const siteMap = new Map();

  for (const rawUrl in allStoredData) {
    const canonical = getCanonicalUrl(rawUrl);
    const items = allStoredData[rawUrl] || [];
    if (!items.length) continue;

    if (!siteMap.has(canonical)) {
      siteMap.set(canonical, {
        canonicalUrl: canonical,
        displayUrl: items[0]?.rawUrl || rawUrl,
        title: items[0]?.title || rawUrl,
        highlightsMap: new Map()
      });
    }

    const group = siteMap.get(canonical);
    if (!group.title && items[0]?.title) {
      group.title = items[0].title;
    }

    items.forEach(hl => {
      group.highlightsMap.set(hl.id, hl);
    });
  }

  // Convert highlightsMap to array
  const groups = [];
  siteMap.forEach(group => {
    groups.push({
      canonicalUrl: group.canonicalUrl,
      displayUrl: group.displayUrl,
      title: group.title,
      highlights: Array.from(group.highlightsMap.values())
    });
  });

  return groups;
}

document.addEventListener('DOMContentLoaded', async () => {
  await determineActiveTab();
  await loadStoredSettings();
  setupEventListeners();
  renderDashboard();
  renderColorPalette();
  updatePdfSummary();
});

// Identify active tab context
async function determineActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      const activeTab = tabs[0];
      currentTabTitle = activeTab.title || '';
      if (activeTab.url) {
        currentTabUrl = getCanonicalUrl(activeTab.url);
      }
    }
  } catch (err) {
    console.warn("Could not query active tab:", err);
  }
}

// Load settings and data from storage
async function loadStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      extensionActive: true,
      activeColor: '#fef08a',
      allWebHighlights: {}
    }, (res) => {
      isExtensionActive = res.extensionActive !== false;
      activeColor = res.activeColor || '#fef08a';
      allStoredData = res.allWebHighlights || {};

      updateToggleUI(isExtensionActive);
      resolve();
    });
  });
}

// 1. Setup Event Listeners
function setupEventListeners() {
  const masterToggle = document.getElementById('masterToggle');
  masterToggle.addEventListener('change', (e) => {
    const newState = e.target.checked;
    isExtensionActive = newState;
    chrome.storage.local.set({ extensionActive: newState }, () => {
      updateToggleUI(newState);

      // Broadcast toggle change to all tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              action: "toggleExtensionActive",
              active: newState
            }).catch(() => {});
          }
        });
      });
    });
  });

  // Navigation Tab Switching
  const navTabs = document.querySelectorAll('.nav-tab');
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetViewId = tab.getAttribute('data-tab');

      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-view').forEach(view => {
        view.classList.remove('active');
      });
      document.getElementById(targetViewId).classList.add('active');

      if (targetViewId === 'tab-pdf') {
        updatePdfSummary();
      }
    });
  });

  // Search input listeners
  const searchInput = document.getElementById('globalSearch');
  const clearBtn = document.getElementById('clearSearchBtn');

  searchInput.addEventListener('input', () => {
    clearBtn.style.display = searchInput.value.length > 0 ? 'block' : 'none';
    renderDashboard();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    searchInput.focus();
    renderDashboard();
  });

  // Scope Buttons (All vs This Page)
  const scopeAll = document.getElementById('scopeAll');
  const scopeCurrent = document.getElementById('scopeCurrent');

  scopeAll.addEventListener('click', () => {
    activeScope = 'all';
    scopeAll.classList.add('active');
    scopeCurrent.classList.remove('active');
    renderDashboard();
  });

  scopeCurrent.addEventListener('click', () => {
    activeScope = 'current';
    scopeCurrent.classList.add('active');
    scopeAll.classList.remove('active');
    renderDashboard();
  });

  // Recolor all highlights on current page button
  document.getElementById('recolorCurrentPageBtn').addEventListener('click', recolorCurrentPage);

  // PDF Export Listeners
  document.getElementById('pdfScopeSelect').addEventListener('change', updatePdfSummary);
  document.getElementById('launchPdfExportBtn').addEventListener('click', handlePdfExport);
  document.getElementById('copyMarkdownFallbackBtn').addEventListener('click', exportToMarkdown);

  // Storage change sync
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.allWebHighlights) {
        allStoredData = changes.allWebHighlights.newValue || {};
        renderDashboard();
        updatePdfSummary();
      }
      if (changes.extensionActive) {
        isExtensionActive = changes.extensionActive.newValue !== false;
        updateToggleUI(isExtensionActive);
      }
    }
  });
}

function updateToggleUI(isActive) {
  const toggle = document.getElementById('masterToggle');
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const label = document.getElementById('toggleStatusLabel');
  const banner = document.getElementById('inactiveBanner');
  const autoHighlightSub = document.getElementById('autoHighlightSub');

  toggle.checked = isActive;
  if (isActive) {
    dot.classList.remove('is-off');
    label.classList.remove('is-off');
    text.textContent = 'ON';
    banner.style.display = 'none';
    if (autoHighlightSub) autoHighlightSub.style.display = 'flex';
  } else {
    dot.classList.add('is-off');
    label.classList.add('is-off');
    text.textContent = 'OFF';
    banner.style.display = 'flex';
    if (autoHighlightSub) autoHighlightSub.style.display = 'none';
  }
}

// 2. Render Highlights Dashboard (Aggregates all markings for same site into ONE unified card)
function renderDashboard() {
  const container = document.getElementById('cardsContainer');
  const emptyState = document.getElementById('emptyState');
  const footerCount = document.getElementById('footerCount');
  const footerStatus = document.getElementById('footerStatus');
  const searchInput = document.getElementById('globalSearch');
  const query = searchInput.value.toLowerCase().trim();

  container.innerHTML = '';

  const siteGroups = getUnifiedSiteGroups();

  let totalVisible = 0;
  let grandTotal = 0;

  siteGroups.forEach(g => {
    grandTotal += g.highlights.length;
  });
  footerCount.textContent = `${grandTotal} highlight${grandTotal === 1 ? '' : 's'} saved`;

  // Filter groups by scope
  let filteredGroups = siteGroups;
  if (activeScope === 'current' && currentTabUrl) {
    filteredGroups = siteGroups.filter(g => g.canonicalUrl === currentTabUrl);
  }

  filteredGroups.forEach(group => {
    const highlights = group.highlights;
    if (highlights.length === 0) return;

    // Filter highlights if query exists
    const matched = highlights.filter(hl => {
      if (!query) return true;
      const tMatch = hl.text && hl.text.toLowerCase().includes(query);
      const nMatch = hl.note && hl.note.toLowerCase().includes(query);
      const titleMatch = group.title && group.title.toLowerCase().includes(query);
      const urlMatch = group.canonicalUrl.toLowerCase().includes(query);
      return tMatch || nMatch || titleMatch || urlMatch;
    });

    if (matched.length === 0) return;

    totalVisible += matched.length;

    // Create Single Unified Website Card
    const card = document.createElement('div');
    card.className = 'site-card';

    card.innerHTML = `
      <div class="site-header">
        <div class="site-title" title="${escapeHtml(group.title)}">${escapeHtml(group.title)}</div>
        <span class="site-count-badge">${matched.length}</span>
      </div>
      <ul class="highlight-list"></ul>
    `;

    const ul = card.querySelector('.highlight-list');

    matched.forEach(hl => {
      const li = document.createElement('li');
      li.className = 'highlight-item';
      li.title = "Click paragraph to jump directly to this text on the page";

      const colorStyle = hl.color || '#fef08a';

      let noteHtml = '';
      if (hl.note && hl.note.trim()) {
        noteHtml = `
          <div class="note-container">
            <strong>Note:</strong> ${escapeHtml(hl.note)}
          </div>
        `;
      }

      li.innerHTML = `
        <div class="highlight-body">
          <div class="highlight-para-content" style="flex: 1; min-width: 0; cursor: pointer;">
            <span class="highlight-mark" style="background-color: ${escapeHtml(colorStyle)};">
              “${escapeHtml(hl.text)}”
            </span>
            ${noteHtml}
          </div>
          <div class="highlight-item-actions">
            <button class="btn-item-jump" title="Jump to paragraph">↗ Jump</button>
            <button class="btn-item-delete" title="Delete highlight">✕</button>
          </div>
        </div>
      `;

      // Clicking anywhere on the item or paragraph jumps directly to the text on the page!
      li.addEventListener('click', () => {
        triggerAutoJump(group.canonicalUrl, hl.id);
      });

      // Jump button click also jumps
      li.querySelector('.btn-item-jump').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerAutoJump(group.canonicalUrl, hl.id);
      });

      // Delete button click removes highlight without triggering jump
      li.querySelector('.btn-item-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSingleHighlight(group.canonicalUrl, hl.id);
      });

      ul.appendChild(li);
    });

    container.appendChild(card);
  });

  if (totalVisible > 0) {
    emptyState.style.display = 'none';
    footerStatus.textContent = `Showing ${totalVisible} item${totalVisible === 1 ? '' : 's'}`;
  } else {
    emptyState.style.display = 'block';
    if (query) {
      emptyState.querySelector('.empty-title').textContent = 'No matching highlights';
      emptyState.querySelector('.empty-desc').textContent = `No snippets match "${query}".`;
    } else if (activeScope === 'current') {
      emptyState.querySelector('.empty-title').textContent = 'No highlights on this page';
      emptyState.querySelector('.empty-desc').textContent = 'Select any text on this page to highlight it instantly.';
    } else {
      emptyState.querySelector('.empty-title').textContent = 'No highlights saved yet';
      emptyState.querySelector('.empty-desc').textContent = 'Turn ON the extension and select any text on any page.';
    }
    footerStatus.textContent = '0 displayed';
  }
}

// 3. Render Colors Tab & Selection
function renderColorPalette() {
  const grid = document.getElementById('paletteGrid');
  grid.innerHTML = '';

  const previewSpan = document.getElementById('previewHighlightSpan');
  previewSpan.style.backgroundColor = activeColor;

  PALETTE.forEach(c => {
    const isSelected = c.hex.toLowerCase() === activeColor.toLowerCase();

    const card = document.createElement('div');
    card.className = `palette-card ${isSelected ? 'active' : ''}`;
    card.innerHTML = `
      <div class="palette-swatch" style="background-color: ${c.hex};">
        ${isSelected ? '✓' : ''}
      </div>
      <div class="palette-name">${c.name}</div>
    `;

    card.addEventListener('click', () => {
      activeColor = c.hex;
      chrome.storage.local.set({ activeColor: c.hex }, () => {
        renderColorPalette();

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "activeColorChanged",
              color: c.hex
            }).catch(() => {});
          }
        });
      });
    });

    grid.appendChild(card);
  });
}

function recolorCurrentPage() {
  const siteGroups = getUnifiedSiteGroups();
  const currentGroup = siteGroups.find(g => g.canonicalUrl === currentTabUrl);

  if (!currentGroup || currentGroup.highlights.length === 0) {
    alert("There are no saved highlights on this page to recolor.");
    return;
  }

  const btn = document.getElementById('recolorCurrentPageBtn');
  const original = btn.textContent;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "recolorPageHighlights",
        color: activeColor
      }, () => {
        for (const k in allStoredData) {
          if (getCanonicalUrl(k) === currentTabUrl) {
            allStoredData[k].forEach(hl => {
              hl.color = activeColor;
            });
          }
        }
        renderDashboard();

        btn.textContent = '✅ Colors Updated!';
        setTimeout(() => {
          btn.textContent = original;
        }, 1800);
      });
    }
  });
}

// 4. PDF Export Logic
function updatePdfSummary() {
  const scopeSelect = document.getElementById('pdfScopeSelect');
  const summaryBox = document.getElementById('pdfExportCountSummary');
  const scope = scopeSelect.value;

  const siteGroups = getUnifiedSiteGroups();
  let count = 0;

  if (scope === 'current') {
    const currentGroup = siteGroups.find(g => g.canonicalUrl === currentTabUrl);
    count = currentGroup ? currentGroup.highlights.length : 0;
    summaryBox.textContent = `Target: ${count} highlight${count === 1 ? '' : 's'} from the current page will be exported.`;
  } else {
    siteGroups.forEach(g => {
      count += g.highlights.length;
    });
    const sitesCount = siteGroups.length;
    summaryBox.textContent = `Target: ${count} highlight${count === 1 ? '' : 's'} across ${sitesCount} website${sitesCount === 1 ? '' : 's'} will be exported.`;
  }
}

function handlePdfExport() {
  const scope = document.getElementById('pdfScopeSelect').value;
  const orderBy = document.getElementById('pdfOrderSelect').value;
  const includeNotes = document.getElementById('pdfIncludeNotes').checked;

  const siteGroups = getUnifiedSiteGroups();
  let exportData = {};

  if (scope === 'current') {
    const currentGroup = siteGroups.find(g => g.canonicalUrl === currentTabUrl);
    if (!currentGroup || currentGroup.highlights.length === 0) {
      alert("No highlights found on the current page to export.");
      return;
    }
    exportData[currentGroup.canonicalUrl] = currentGroup.highlights;
  } else {
    if (siteGroups.length === 0) {
      alert("No highlights saved yet to export.");
      return;
    }
    siteGroups.forEach(g => {
      exportData[g.canonicalUrl] = g.highlights;
    });
  }

  chrome.storage.local.set({
    pendingPdfExport: {
      scope,
      orderBy,
      includeNotes,
      data: exportData
    }
  }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('export.html') });
  });
}

// 5. In-Page Smooth Auto-Jump (Jumps directly and closes popup so page is focused)
function triggerAutoJump(targetUrl, highlightId) {
  if (!isExtensionActive) {
    alert("Please turn ON the extension switch to jump to highlights.");
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) return;

    const activeNorm = getCanonicalUrl(activeTab.url);
    const targetNorm = getCanonicalUrl(targetUrl);

    // If target is on the current active page, scroll in place and close popup!
    if (activeNorm === targetNorm || activeScope === 'current') {
      chrome.tabs.sendMessage(activeTab.id, {
        action: "autoJumpToPosition",
        highlightId
      }, () => {
        window.close(); // Close popup window so user is immediately viewing the highlighted paragraph on the page
      });
      return;
    }

    // If target is on a different page:
    chrome.tabs.query({ currentWindow: true }, (allTabs) => {
      const existingTab = allTabs.find(t => getCanonicalUrl(t.url) === targetNorm);
      if (existingTab) {
        chrome.tabs.update(existingTab.id, { active: true }, () => {
          setTimeout(() => {
            chrome.tabs.sendMessage(existingTab.id, {
              action: "autoJumpToPosition",
              highlightId
            });
            window.close();
          }, 250);
        });
      } else {
        chrome.tabs.create({ url: `${targetUrl}#web-hl=${highlightId}` });
        window.close();
      }
    });
  });
}

// 6. Delete Single Highlight
function deleteSingleHighlight(canonicalUrl, highlightId) {
  chrome.storage.local.get({ allWebHighlights: {} }, (result) => {
    const data = result.allWebHighlights || {};

    // Delete across all keys matching this canonicalUrl
    for (const key in data) {
      if (getCanonicalUrl(key) === canonicalUrl) {
        data[key] = (data[key] || []).filter(h => h.id !== highlightId);
        if (data[key].length === 0) {
          delete data[key];
        }
      }
    }

    chrome.storage.local.set({ allWebHighlights: data }, () => {
      allStoredData = data;
      renderDashboard();
      updatePdfSummary();

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url && getCanonicalUrl(tabs[0].url) === canonicalUrl) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "deleteHighlightFromPopup",
            highlightId
          });
        }
      });
    });
  });
}

// 7. Markdown Fallback Export
function exportToMarkdown() {
  const scope = document.getElementById('pdfScopeSelect').value;
  const siteGroups = getUnifiedSiteGroups();

  let targetGroups = siteGroups;
  if (scope === 'current' && currentTabUrl) {
    targetGroups = siteGroups.filter(g => g.canonicalUrl === currentTabUrl);
  }

  if (targetGroups.length === 0) {
    alert("No saved highlights available to export.");
    return;
  }

  let mdString = "";

  targetGroups.forEach(group => {
    const highlights = group.highlights || [];
    if (highlights.length === 0) return;

    mdString += `- [${group.title}](${group.displayUrl || group.canonicalUrl})\n`;

    highlights.forEach(hl => {
      const cleanText = hl.text.replace(/\r?\n/g, ' ').trim();
      mdString += `  - **Highlight:** ${cleanText}\n`;
      if (hl.note && hl.note.trim()) {
        const cleanNote = hl.note.replace(/\r?\n/g, ' ').trim();
        mdString += `    - *Note:* ${cleanNote}\n`;
      }
    });
  });

  navigator.clipboard.writeText(mdString).then(() => {
    const btn = document.getElementById('copyMarkdownFallbackBtn');
    const original = btn.textContent;
    btn.textContent = '✅ Copied to Clipboard!';
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
