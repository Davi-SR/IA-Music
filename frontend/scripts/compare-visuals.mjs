import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const root = resolve("../artifacts/visual");
const states = ["home", "youtube", "library", "mixer"];
const viewports = ["desktop", "mobile"];
const results = [];

for (const state of states) {
  for (const viewport of viewports) {
    const before = PNG.sync.read(
      await readFile(resolve(root, `before-${state}-${viewport}.png`)),
    );
    const after = PNG.sync.read(
      await readFile(resolve(root, `after-${state}-${viewport}.png`)),
    );
    if (before.width !== after.width || before.height !== after.height) {
      results.push({
        state,
        viewport,
        before: `${before.width}x${before.height}`,
        after: `${after.width}x${after.height}`,
        comparable: false,
      });
      continue;
    }
    const diff = new PNG({ width: before.width, height: before.height });
    const differentPixels = pixelmatch(
      before.data,
      after.data,
      diff.data,
      before.width,
      before.height,
      { threshold: 0.1, includeAA: false },
    );
    await writeFile(
      resolve(root, `diff-${state}-${viewport}.png`),
      PNG.sync.write(diff),
    );
    results.push({
      state,
      viewport,
      dimensions: `${before.width}x${before.height}`,
      differentPixels,
      differencePercent: Number(
        ((differentPixels / (before.width * before.height)) * 100).toFixed(4),
      ),
      comparable: true,
    });
  }
}

console.log(JSON.stringify(results, null, 2));
