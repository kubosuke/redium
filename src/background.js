/**
 * Per-tab toolbar icon: default when reader is on, winking asset when off / inactive.
 */
(function () {
  "use strict";

  const ICON_ENABLED = {
    16: "icons/redium-app-icon.png",
    32: "icons/redium-app-icon.png",
    48: "icons/redium-app-icon.png",
    128: "icons/redium-app-icon.png",
  };

  const ICON_DISABLED = {
    16: "icons/redium-toolbar-disabled.png",
    32: "icons/redium-toolbar-disabled.png",
    48: "icons/redium-toolbar-disabled.png",
    128: "icons/redium-toolbar-disabled.png",
  };

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== "redium-toolbar-icon" || sender.tab?.id == null) {
      return;
    }
    const tabId = sender.tab.id;
    const path = msg.readerOn ? ICON_ENABLED : ICON_DISABLED;
    chrome.action.setIcon({ tabId, path }, function () {
      if (chrome.runtime.lastError) {
        /* ignore */
      }
    });
  });
})();
