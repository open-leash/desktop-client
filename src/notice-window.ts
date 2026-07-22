export type NoticeWindowSize = {
  width?: number;
  height?: number;
};

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
