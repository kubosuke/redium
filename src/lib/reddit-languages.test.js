import { describe, it, expect, vi } from "vitest";
import {
  REDDIT_LANGUAGES,
  getTlFromUrl,
  findLanguageByCode,
  isSupportedTlCode,
  navigateWithTl,
} from "./reddit-languages.js";

describe("reddit-languages", () => {
  it("lists all 35 official display languages", () => {
    expect(REDDIT_LANGUAGES).toHaveLength(35);
  });

  it("getTlFromUrl reads tl query param", () => {
    expect(getTlFromUrl("https://www.reddit.com/r/test/comments/abc/?tl=ja")).toBe("ja");
    expect(getTlFromUrl("https://www.reddit.com/?tl=ZH-HANS")).toBe("zh-hans");
    expect(getTlFromUrl("https://www.reddit.com/r/test/")).toBe("");
  });

  it("findLanguageByCode resolves emoji and label", () => {
    expect(findLanguageByCode("ja").emoji).toBe("🇯🇵");
    expect(findLanguageByCode("").label).toBe("English");
    expect(findLanguageByCode("unknown").label).toBe("English");
  });

  it("isSupportedTlCode validates known codes", () => {
    expect(isSupportedTlCode("pt-br")).toBe(true);
    expect(isSupportedTlCode("en")).toBe(false);
    expect(isSupportedTlCode("xx")).toBe(false);
  });

  it("navigateWithTl builds url with tl set or removed", () => {
    const assign = vi.fn();
    navigateWithTl("ja", { assign });
    expect(assign).toHaveBeenCalledWith(expect.stringContaining("tl=ja"));

    assign.mockClear();
    navigateWithTl("", { assign });
    expect(assign.mock.calls[0][0]).not.toMatch(/[?&]tl=/);
  });

  it("navigateWithTl ignores unsupported codes", () => {
    const assign = vi.fn();
    navigateWithTl("not-a-lang", { assign });
    expect(assign).not.toHaveBeenCalled();
  });
});
