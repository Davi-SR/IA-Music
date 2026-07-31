import { describe, expect, it } from "vitest";
import { isYoutubeUrl, validateAudioFiles } from "./validation";

describe("validateAudioFiles", () => {
  it("accepts one MP3 or WAV file", () => {
    const file = new File(["audio"], "solo.wav", { type: "audio/wav" });
    expect(validateAudioFiles([file])).toEqual({ file });
  });

  it("rejects unsupported extensions and empty files", () => {
    const text = new File(["text"], "solo.txt", { type: "text/plain" });
    const empty = new File([], "solo.mp3", { type: "audio/mpeg" });
    expect(validateAudioFiles([text]).error).toMatch(/formato/i);
    expect(validateAudioFiles([empty]).error).toMatch(/vazio/i);
  });
});

describe("isYoutubeUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=XgzdrVggJ-E",
    "https://youtu.be/XgzdrVggJ-E",
    "https://music.youtube.com/watch?v=XgzdrVggJ-E",
  ])("accepts %s", (url) => expect(isYoutubeUrl(url)).toBe(true));

  it.each([
    "https://example.com/watch?v=XgzdrVggJ-E",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects %s", (url) => expect(isYoutubeUrl(url)).toBe(false));
});
