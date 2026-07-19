import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as simpleIcons from "simple-icons";

await fs.mkdir("dist", { recursive: true });
await fs.copyFile(path.join("src", "window.html"), path.join("dist", "window.html"));
const noticeTemplate = await fs.readFile(path.join("src", "notice.html"), "utf8");
const fireworksJson = await fs.readFile(path.join("..", "..", "assets", "Fireworks.json"), "utf8");
const embeddedFireworks = fireworksJson
  .replaceAll("<", "\\u003c")
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");
await fs.writeFile(
  path.join("dist", "notice.html"),
  noticeTemplate.replace("__OPENLEASH_FIREWORKS_DATA__", embeddedFireworks),
);
await fs.copyFile(path.join("src", "openleash-icon.png"), path.join("dist", "openleash-icon.png"));
await fs.copyFile(path.join("..", "..", "assets", "Fireworks.json"), path.join("dist", "Fireworks.json"));
await fs.copyFile(path.join("..", "..", "node_modules", "lottie-web", "build", "player", "lottie.min.js"), path.join("dist", "lottie.min.js"));
await copyIntroVideo();
await copyWelcomeAgentIcons();
await fs.mkdir(path.join("dist", "agent-icons"), { recursive: true });

await sharp(path.join("src", "openleash-icon.png")).resize(64, 64).png().toFile(path.join("dist", "tray-icon.png"));

const iconMap = {
  claude: simpleIcons.siClaude,
  gemini: simpleIcons.siGooglegemini,
  cline: simpleIcons.siCline,
  cursor: simpleIcons.siCursor,
  windsurf: simpleIcons.siWindsurf,
  copilot: simpleIcons.siGithubcopilot,
  github: simpleIcons.siGithub,
  zed: simpleIcons.siZedindustries,
  replit: simpleIcons.siReplit,
  perplexity: simpleIcons.siPerplexity
};

for (const [name, icon] of Object.entries(iconMap)) {
  if (!icon) continue;
  await fs.writeFile(path.join("dist", "agent-icons", `${name}.svg`), simpleIconSvg(icon));
}

await downloadIcon("openai", "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/openai.svg");
await downloadIcon("opencode", "https://opencode.ai/favicon.svg");

function simpleIconSvg(icon) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#${icon.hex ?? "101318"}" d="${icon.path}"/></svg>`;
}

async function downloadIcon(name, url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const body = await response.text();
    if (!body.includes("<svg")) return;
    await fs.writeFile(path.join("dist", "agent-icons", `${name}.svg`), body);
  } catch {
    // The UI falls back to initials if an icon cannot be fetched during packaging.
  }
}

async function copyIntroVideo() {
  const candidates = [
    path.join("..", "..", "assets", "openleash-video.mp4"),
    path.join("..", "..", "assets", "openleash-vid.mp4"),
    path.join("src", "openleash-video.mp4")
  ];
  for (const candidate of candidates) {
    try {
      await fs.copyFile(candidate, path.join("dist", "openleash-video.mp4"));
      return;
    } catch {
      // Try the next common asset location/name.
    }
  }
}

async function copyWelcomeAgentIcons() {
  const candidates = [
    path.join("..", "main-web", "public", "agents"),
    path.join("..", "..", "assets", "agents"),
    path.join("src", "agents")
  ];
  for (const candidate of candidates) {
    try {
      await fs.rm(path.join("dist", "agents"), { recursive: true, force: true });
      await fs.cp(candidate, path.join("dist", "agents"), { recursive: true });
      return;
    } catch {
      // Try the next common asset location/name.
    }
  }
}
