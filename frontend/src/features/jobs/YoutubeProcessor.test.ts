import { describe, expect, it } from "vitest";
import { progressTitle, stageLabel } from "./YoutubeProcessor";

describe("YouTube progress copy", () => {
  it("uses friendly stage labels throughout the measured process", () => {
    expect(stageLabel(1)).toBe("Na fila");
    expect(stageLabel(20)).toBe("Preparando o áudio");
    expect(stageLabel(60)).toBe("Separando as faixas");
    expect(stageLabel(95)).toBe("Organizando o ZIP");
    expect(stageLabel(100)).toBe("Concluído");
  });

  it("does not expose implementation/model names in titles", () => {
    const titles = [1, 20, 60, 95].map(progressTitle).join(" ");
    expect(titles).not.toMatch(/demucs|stem|modelo/i);
  });
});
