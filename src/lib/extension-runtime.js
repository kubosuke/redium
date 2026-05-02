/**
 * Chrome extension runtime guards — unit-tested helpers shared by the content bundle.
 * After reloading the extension, `chrome.runtime` can throw "Extension context invalidated".
 */

/**
 * @returns {boolean}
 */
export function isExtensionRuntimeAlive() {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime) return false;
    return (
      typeof chrome.runtime.id === "string" && chrome.runtime.id.length > 0
    );
  } catch (e) {
    return false;
  }
}

/**
 * @param {string} resourcePath
 * @returns {string}
 */
export function safeExtensionGetUrl(resourcePath) {
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.getURL === "function"
    ) {
      return chrome.runtime.getURL(resourcePath);
    }
  } catch (e) {
    /* invalidated context */
  }
  return "";
}
