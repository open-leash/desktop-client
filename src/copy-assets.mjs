import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as simpleIcons from "simple-icons";

await fs.mkdir("dist", { recursive: true });
const windowTemplate = await fs.readFile(path.join("src", "window.html"), "utf8");
const featurePresentationsJson = await fs.readFile(
  path.join("..", "..", "packages", "shared", "feature-presentations.json"),
  "utf8",
);
await fs.writeFile(
  path.join("dist", "window.html"),
  windowTemplate.replace(
    "__LEASH_FEATURE_PRESENTATIONS__",
    featurePresentationsJson
      .replaceAll("<", "\\u003c")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029"),
  ),
);
const noticeTemplate = await fs.readFile(path.join("src", "notice.html"), "utf8");
const fireworksJson = await fs.readFile(path.join("src", "Fireworks.json"), "utf8");
const embeddedFireworks = fireworksJson
  .replaceAll("<", "\\u003c")
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");
await fs.writeFile(
  path.join("dist", "notice.html"),
  noticeTemplate.replace("__OPENLEASH_FIREWORKS_DATA__", embeddedFireworks),
);
await fs.copyFile(path.join("src", "openleash-icon.png"), path.join("dist", "openleash-icon.png"));
await fs.copyFile(path.join("src", "island-preview.png"), path.join("dist", "island-preview.png"));
await fs.cp(path.join("src", "agent-mascots"), path.join("dist", "agent-mascots"), { recursive: true });
await fs.copyFile("THIRD_PARTY_NOTICES.md", path.join("dist", "THIRD_PARTY_NOTICES.md"));
await fs.copyFile(path.join("src", "Fireworks.json"), path.join("dist", "Fireworks.json"));
await fs.copyFile(path.join("src", "question.mp3"), path.join("dist", "question.mp3"));
await fs.copyFile(path.join("..", "..", "node_modules", "lottie-web", "build", "player", "lottie.min.js"), path.join("dist", "lottie.min.js"));
await copyIntroVideo();
await copyWelcomeAgentIcons();
await fs.mkdir(path.join("dist", "agent-icons"), { recursive: true });

await sharp(path.join("src", "openleash-icon.png"))
  .resize(64, 64, { fit: "fill", kernel: "lanczos3" })
  .png()
  .toFile(path.join("dist", "tray-icon.png"));

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
await downloadBinaryIcon("vscode", "https://raw.githubusercontent.com/microsoft/vscode/main/resources/linux/code.png", "png");

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

async function downloadBinaryIcon(name, url, extension) {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    await fs.writeFile(path.join("dist", "agent-icons", `${name}.${extension}`), Buffer.from(await response.arrayBuffer()));
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
    path.join("src", "agents"),
    path.join("..", "main-web", "public", "agents"),
    path.join("..", "..", "assets", "agents")
  ];
  for (const candidate of candidates) {
    try {
      await fs.rm(path.join("dist", "agents"), { recursive: true, force: true });
      await fs.cp(candidate, path.join("dist", "agents"), { recursive: true });
      await assertWelcomeAgentIcons();
      return;
    } catch {
      // Try the next common asset location/name.
    }
  }
  throw new Error("Desktop agent icons are missing; setup cannot be packaged without src/agents.");
}

async function assertWelcomeAgentIcons() {
  const required = [
    "antigravity.png",
    "chatgpt.png",
    "claude.png",
    "cline.png",
    "codex.png",
    "cursor.png",
    "githubcopilot.svg",
    "googlegemini.svg",
    "opencode.png",
    "windsurf.svg"
  ];
  await Promise.all(required.map((file) => fs.access(path.join("dist", "agents", file))));
}
