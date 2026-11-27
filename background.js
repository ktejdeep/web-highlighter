// Web Highlighter & Recall - Background Service Worker (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  // Initialize default settings if not already present
  chrome.storage.local.get({ extensionActive: true, activeColor: '#fef08a' }, (res) => {
    chrome.storage.local.set({
      extensionActive: res.extensionActive !== false,
      activeColor: res.activeColor || '#fef08a'
    });
  });

  // Create context menu
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "web-highlighter-menu-item",
      title: "🖊️ Highlight Selection",
      contexts: ["selection"]
    });
  });
});

// Listen for context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "web-highlighter-menu-item" && tab?.id) {
    chrome.storage.local.get({ extensionActive: true }, (res) => {
      const isActive = res.extensionActive !== false;
      chrome.tabs.sendMessage(tab.id, {
        action: "highlightCurrentSelection",
        selectedText: info.selectionText || "",
        extensionActive: isActive
      }).catch((err) => {
        console.warn("Could not send highlight message to tab:", err.message);
      });
    });
  }
});
