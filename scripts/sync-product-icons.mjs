#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "assets", "icon.png");
const checkOnly = process.argv.includes("--check");

await fs.access(source);

const pngTargets = new Map([
  ["assets/openleash-icon.png", 1024],
  ["apps/desktop-client/src/openleash-icon.png", 1024],
  ["apps/desktop-client/src/tray-icon.png", 64],
  ["apps/docs-web/public/openleash-icon.png", 1024],
  ["apps/docs-web/public/favicon.png", 64],
  ["apps/main-web/public/openleash-icon.png", 1024],
  ["apps/main-web/public/openleash-desktop-icon-v2.png", 1024],
  ["apps/main-web/public/favicon.png", 64],
  ["apps/main-web/public/apple-touch-icon.png", 180],
  ["apps/flow-viewer/public/favicon.png", 128],
  ["apps/mobile-client/assets/openleash-icon.png", 1024],
  ["apps/mobile-client/android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48],
  ["apps/mobile-client/android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72],
  ["apps/mobile-client/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96],
  ["apps/mobile-client/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144],
  ["apps/mobile-client/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192],
]);

const webpTargets = new Map([
  ["apps/main-web/public/media/leash-mark.webp", 256],
]);

for (const [relativePath, size] of pngTargets) {
  await writePngIcon(relativePath, size);
}

for (const [relativePath, size] of webpTargets) {
  await writeWebpIcon(relativePath, size);
}

const iosIconDirectory = path.join(
  root,
  "apps/mobile-client/ios/Runner/Assets.xcassets/AppIcon.appiconset",
);
const iosManifest = JSON.parse(
  await fs.readFile(path.join(iosIconDirectory, "Contents.json"), "utf8"),
);
for (const image of iosManifest.images ?? []) {
  if (!image.filename || !image.size || !image.scale) continue;
  const points = Number.parseFloat(String(image.size).split("x")[0]);
  const scale = Number.parseFloat(String(image.scale).replace("x", ""));
  const pixels = Math.round(points * scale);
  await writePngIcon(
    path.relative(root, path.join(iosIconDirectory, image.filename)),
    pixels,
  );
}

console.log(`${checkOnly ? "Verified" : "Synced"} ${pngTargets.size + webpTargets.size + (iosManifest.images?.length ?? 0)} product icons from assets/icon.png.`);

async function writePngIcon(relativePath, size) {
  const destination = path.join(root, relativePath);
  const expected = await sharp(source)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  if (checkOnly) {
    const actual = await fs.readFile(destination);
    if (!actual.equals(expected)) {
      throw new Error(`${relativePath} is not synchronized with assets/icon.png`);
    }
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, expected);
}

async function writeWebpIcon(relativePath, size) {
  const destination = path.join(root, relativePath);
  const expected = await sharp(source)
    .resize(size, size, { fit: "cover", position: "centre" })
    .webp({ quality: 95 })
    .toBuffer();
  if (checkOnly) {
    const actual = await fs.readFile(destination);
    if (!actual.equals(expected)) {
      throw new Error(`${relativePath} is not synchronized with assets/icon.png`);
    }
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, expected);
}
