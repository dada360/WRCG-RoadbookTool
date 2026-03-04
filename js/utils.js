export function toOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

export function formatDistance(value) {
  return `${Number(value).toFixed(1)} m`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
