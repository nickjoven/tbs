// Tablosco — service worker

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "extract") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.sidePanel.open({ tabId: tab.id });
      // Small delay to let panel initialize before it requests extraction
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "trigger-extract", tabId: tab.id });
      }, 300);
    }
  }
});

// Relay extraction requests from sidepanel to content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "request-extract" && msg.tabId) {
    chrome.tabs.sendMessage(msg.tabId, { type: "extract" }, (response) => {
      sendResponse(response);
    });
    return true;
  }
});
