// Web Highlighter & Recall - PDF Document Generator (Manifest V3)

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get({ pendingPdfExport: null }, (result) => {
    const exportConfig = result.pendingPdfExport;
    if (!exportConfig || !exportConfig.data) {
      document.getElementById('contentContainer').innerHTML = `
        <div style="text-align: center; padding: 40px; color: #64748b;">
          <h2>No highlights selected for export.</h2>
          <p>Please open the extension popup and click "Export as PDF".</p>
        </div>
      `;
      return;
    }

    renderExportDocument(exportConfig);
  });

  document.getElementById('printPdfBtn').addEventListener('click', () => {
    window.print();
  });
});

function renderExportDocument(config) {
  const { scope, orderBy, includeNotes, data } = config;

  // Header Metadata
  const docDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  document.getElementById('docDate').textContent = docDate;
  document.getElementById('docScope').textContent = scope === 'current' ? 'Current Webpage' : 'All Saved Websites';

  const orderLabels = {
    pageOrder: 'Page Appearance Order',
    dateDesc: 'Date Added (Newest First)',
    dateAsc: 'Date Added (Oldest First)',
    color: 'Grouped by Highlight Color'
  };
  document.getElementById('docOrder').textContent = orderLabels[orderBy] || orderBy;

  const container = document.getElementById('contentContainer');
  container.innerHTML = '';

  let grandTotal = 0;

  // Render by website groups
  for (const url in data) {
    let highlights = [...data[url]];
    if (highlights.length === 0) continue;

    // Apply User's Specified Ordering
    if (orderBy === 'dateDesc') {
      highlights.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    } else if (orderBy === 'dateAsc') {
      highlights.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    } else if (orderBy === 'color') {
      highlights.sort((a, b) => (a.color || '').localeCompare(b.color || ''));
    }
    // 'pageOrder' retains the sequential array order from DOM walking

    grandTotal += highlights.length;

    const section = document.createElement('div');
    section.className = 'site-section';

    const siteTitle = highlights[0]?.title || url;
    section.innerHTML = `
      <h2 class="site-title">${escapeHtml(siteTitle)}</h2>
      <a href="${escapeHtml(url)}" target="_blank" class="site-url">${escapeHtml(url)}</a>
      <div class="site-highlights-list"></div>
    `;

    const listContainer = section.querySelector('.site-highlights-list');

    highlights.forEach((hl, index) => {
      const card = document.createElement('div');
      card.className = 'highlight-card';

      const hlDate = hl.timestamp ? new Date(hl.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const hlColor = hl.color || '#fef08a';

      let noteBlock = '';
      if (includeNotes && hl.note && hl.note.trim()) {
        noteBlock = `
          <div class="highlight-note">
            <div class="highlight-note-title">Context Note</div>
            <div>${escapeHtml(hl.note)}</div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="highlight-card-header">
          <span class="highlight-num">#${index + 1}</span>
          <span>${escapeHtml(hlDate)}</span>
        </div>
        <div>
          <span class="highlight-quote" style="background-color: ${escapeHtml(hlColor)};">
            “${escapeHtml(hl.text)}”
          </span>
        </div>
        ${noteBlock}
      `;

      listContainer.appendChild(card);
    });

    container.appendChild(section);
  }

  document.getElementById('docCount').textContent = grandTotal;
  document.getElementById('exportSummaryText').textContent = `${grandTotal} highlight${grandTotal === 1 ? '' : 's'} ready for PDF export`;

  // Auto-launch system print dialog with pre-configured print-to-PDF styles
  setTimeout(() => {
    window.print();
  }, 600);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
