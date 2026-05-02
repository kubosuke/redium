import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isExtensionRuntimeAlive,
  safeExtensionGetUrl,
} from "./extension-runtime.js";

describe("extension-runtime", () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  describe("isExtensionRuntimeAlive", () => {
    it("returns false when chrome is undefined", () => {
      Reflect.deleteProperty(globalThis, "chrome");
      expect(isExtensionRuntimeAlive()).toBe(false);
    });

    it("returns false when chrome.runtime is missing", () => {
      globalThis.chrome = {};
      expect(isExtensionRuntimeAlive()).toBe(false);
    });

    it("returns true when chrome.runtime.id is a non-empty string", () => {
      globalThis.chrome = {
        runtime: {
          id: "abcdefghijklmnopqrstuvwxyz123456",
          getURL: (p) => `chrome-extension://fake/${p}`,
        },
      };
      expect(isExtensionRuntimeAlive()).toBe(true);
    });

    it("returns false when runtime.id access throws (invalidated context)", () => {
      globalThis.chrome = {
        get runtime() {
          throw new Error("Extension context invalidated.");
        },
      };
      expect(isExtensionRuntimeAlive()).toBe(false);
    });

    it("returns false when runtime.id is empty string", () => {
      globalThis.chrome = {
        runtime: { id: "" },
      };
      expect(isExtensionRuntimeAlive()).toBe(false);
    });
  });

  describe("safeExtensionGetUrl", () => {
    beforeEach(() => {
      globalThis.chrome = {
        runtime: {
          id: "abc",
          getURL: vi.fn((path) => `chrome-extension://abc/${path}`),
        },
      };
    });

    it("returns resolved extension URL when runtime is valid", () => {
      expect(safeExtensionGetUrl("icons/x.png")).toBe(
        "chrome-extension://abc/icons/x.png"
      );
      expect(globalThis.chrome.runtime.getURL).toHaveBeenCalledWith(
        "icons/x.png"
      );
    });

    it("returns empty string when getURL throws", () => {
      globalThis.chrome.runtime.getURL = vi.fn(() => {
        throw new Error("Extension context invalidated.");
      });
      expect(safeExtensionGetUrl("icons/x.png")).toBe("");
    });

    it("returns empty string when chrome is missing", () => {
      Reflect.deleteProperty(globalThis, "chrome");
      expect(safeExtensionGetUrl("icons/x.png")).toBe("");
    });
  });
});
