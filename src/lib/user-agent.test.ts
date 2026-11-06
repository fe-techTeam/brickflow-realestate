import { describe, expect, it } from "vitest";
import { describeUserAgent, isMobileUserAgent } from "./user-agent";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/141.0.0.0`;
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

describe("describeUserAgent", () => {
  it.each([
    [CHROME_WIN, "Chrome on Windows"],
    [EDGE_WIN, "Edge on Windows"],
    [SAFARI_IPHONE, "Safari on iPhone"],
    [FIREFOX_MAC, "Firefox on macOS"],
    [CHROME_ANDROID, "Chrome on Android"],
    ["curl/8.4.0", "Unknown device"],
    [null, "Unknown device"],
  ])("%s → %s", (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  it("flags phones", () => {
    expect(isMobileUserAgent(SAFARI_IPHONE)).toBe(true);
    expect(isMobileUserAgent(CHROME_ANDROID)).toBe(true);
    expect(isMobileUserAgent(CHROME_WIN)).toBe(false);
  });
});
