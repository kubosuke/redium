/**
 * Reddit display languages (official list) and `?tl=` URL helpers.
 * @see https://support.reddithelp.com/hc/en-us/articles/204528049
 */

/** @typedef {{ code: string, emoji: string, label: string }} RedditLanguage */

/** @type {readonly RedditLanguage[]} */
export const REDDIT_LANGUAGES = [
  { code: "", emoji: "🇺🇸", label: "English" },
  { code: "ar", emoji: "🇸🇦", label: "Arabic" },
  { code: "bn", emoji: "🇧🇩", label: "Bengali" },
  { code: "bg", emoji: "🇧🇬", label: "Bulgarian" },
  { code: "zh-hans", emoji: "🇨🇳", label: "Chinese (Simplified)" },
  { code: "zh-hant", emoji: "🇹🇼", label: "Chinese (Traditional)" },
  { code: "hr", emoji: "🇭🇷", label: "Croatian" },
  { code: "cs", emoji: "🇨🇿", label: "Czech" },
  { code: "da", emoji: "🇩🇰", label: "Danish" },
  { code: "nl", emoji: "🇳🇱", label: "Dutch" },
  { code: "fil", emoji: "🇵🇭", label: "Filipino" },
  { code: "fi", emoji: "🇫🇮", label: "Finnish" },
  { code: "fr", emoji: "🇫🇷", label: "French" },
  { code: "de", emoji: "🇩🇪", label: "German" },
  { code: "el", emoji: "🇬🇷", label: "Greek" },
  { code: "hi", emoji: "🇮🇳", label: "Hindi" },
  { code: "hu", emoji: "🇭🇺", label: "Hungarian" },
  { code: "it", emoji: "🇮🇹", label: "Italian" },
  { code: "ja", emoji: "🇯🇵", label: "Japanese" },
  { code: "ko", emoji: "🇰🇷", label: "Korean" },
  { code: "ms", emoji: "🇲🇾", label: "Malay" },
  { code: "no", emoji: "🇳🇴", label: "Norwegian" },
  { code: "pl", emoji: "🇵🇱", label: "Polish" },
  { code: "pt-br", emoji: "🇧🇷", label: "Portuguese (Brazil)" },
  { code: "pt-pt", emoji: "🇵🇹", label: "Portuguese (Europe)" },
  { code: "ro", emoji: "🇷🇴", label: "Romanian" },
  { code: "ru", emoji: "🇷🇺", label: "Russian" },
  { code: "sr", emoji: "🇷🇸", label: "Serbian" },
  { code: "sk", emoji: "🇸🇰", label: "Slovak" },
  { code: "es", emoji: "🇪🇸", label: "Spanish (Europe)" },
  { code: "es-mx", emoji: "🇲🇽", label: "Spanish (Mexico)" },
  { code: "sv", emoji: "🇸🇪", label: "Swedish" },
  { code: "th", emoji: "🇹🇭", label: "Thai" },
  { code: "uk", emoji: "🇺🇦", label: "Ukrainian" },
  { code: "vi", emoji: "🇻🇳", label: "Vietnamese" },
];

const LANG_BY_CODE = new Map(
  REDDIT_LANGUAGES.map(function (lang) {
    return [lang.code, lang];
  })
);

/**
 * @param {string} [href]
 * @returns {string} Normalized `tl` code, or "" for English / unset.
 */
export function getTlFromUrl(href) {
  try {
    const url = new URL(href || (typeof location !== "undefined" ? location.href : "https://www.reddit.com/"));
    const tl = url.searchParams.get("tl");
    return tl ? tl.trim().toLowerCase() : "";
  } catch (e) {
    return "";
  }
}

/**
 * @param {string} code
 * @returns {RedditLanguage}
 */
export function findLanguageByCode(code) {
  const key = (code || "").trim().toLowerCase();
  return LANG_BY_CODE.get(key) || REDDIT_LANGUAGES[0];
}

/**
 * @param {string} code
 * @returns {boolean}
 */
export function isSupportedTlCode(code) {
  return LANG_BY_CODE.has((code || "").trim().toLowerCase());
}

/**
 * Apply `?tl=` and reload (English removes the param).
 * @param {string} code
 * @param {{ assign?: (url: string) => void }} [opts]
 */
export function navigateWithTl(code, opts) {
  const assign = (opts && opts.assign) || defaultAssign;
  const key = (code || "").trim().toLowerCase();
  if (key && !isSupportedTlCode(key)) {
    return;
  }
  const url = new URL(
    typeof location !== "undefined" ? location.href : "https://www.reddit.com/"
  );
  if (!key) {
    url.searchParams.delete("tl");
  } else {
    url.searchParams.set("tl", key);
  }
  assign(url.toString());
}

/**
 * Reddit is an SPA — query-only changes via assign often skip a full load.
 * Update the URL, then reload so `?tl=` is applied.
 * @param {string} url
 */
function defaultAssign(url) {
  if (typeof location === "undefined") return;
  const target = new URL(url, location.href);
  const next = target.pathname + target.search + target.hash;
  if (next !== location.pathname + location.search + location.hash) {
    history.replaceState(null, "", next);
  }
  location.reload();
}
