const MAX_PLUGIN_ICON_BYTES = 256 * 1024;
const IMAGE_DATA_URL =
  /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export type PluginIconInput = { iconText?: string; visualPng?: string };

export function normalizePluginIconInput(
  value: PluginIconInput,
): Required<PluginIconInput> {
  const visualPng = String(value.visualPng ?? "").trim();
  const iconText = String(value.iconText ?? "").trim();
  if (visualPng) {
    validateImageDataUrl(visualPng);
    return { iconText: "", visualPng };
  }
  if (!iconText || !isSingleEmoji(iconText)) {
    throw badRequest("Choose one emoji or upload a PNG, JPEG, or WebP icon.");
  }
  return { iconText, visualPng: "" };
}

export function isSingleEmoji(value: string) {
  const segments = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      value,
    ),
  ];
  return segments.length === 1 && /\p{Extended_Pictographic}/u.test(value);
}

function validateImageDataUrl(value: string) {
  const match = IMAGE_DATA_URL.exec(value);
  if (!match)
    throw badRequest("Plugin images must be PNG, JPEG, or WebP data URLs.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_PLUGIN_ICON_BYTES) {
    throw badRequest("Plugin images must be no larger than 256 KB.");
  }
  const mime = match[1];
  const valid =
    (mime === "png" &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "jpeg" &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes.at(-2) === 0xff &&
      bytes.at(-1) === 0xd9) ||
    (mime === "webp" &&
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP");
  if (!valid)
    throw badRequest(
      "The uploaded file does not match its declared image format.",
    );
}

function badRequest(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}
