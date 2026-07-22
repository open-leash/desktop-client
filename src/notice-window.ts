export type NoticeWindowSize = {
  width?: number;
  height?: number;
  interactiveBounds?: NoticeInteractiveBounds;
};

export type NoticeInteractiveBounds = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export function isPointInNoticeBounds(
  point: { x: number; y: number },
  windowBounds: { x: number; y: number },
  requested?: NoticeInteractiveBounds,
) {
  const x = Number(requested?.x);
  const y = Number(requested?.y);
  const width = Number(requested?.width);
  const height = Number(requested?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    return false;
  return point.x >= windowBounds.x + x
    && point.x <= windowBounds.x + x + width
    && point.y >= windowBounds.y + y
    && point.y <= windowBounds.y + y + height;
}

export function clampNoticeWindowSize(
  requested: number | NoticeWindowSize,
  currentWidth = 300,
) {
  const requestedWidth = typeof requested === "object" ? requested?.width : undefined;
  const requestedHeight = typeof requested === "object" ? requested?.height : requested;
  return {
    width: Math.max(230, Math.min(780, Math.round(Number(requestedWidth) || currentWidth))),
    height: Math.max(44, Math.min(760, Math.round(Number(requestedHeight) || 52))),
  };
}
