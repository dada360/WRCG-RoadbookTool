import { PLAY_SPEED_MPS, AXIS_PADDING, EPSILON } from "./config.js";
import { state } from "./state.js";
import { refs } from "./dom.js";
import { clamp, formatDistance, toOneDecimal } from "./utils.js";

const MIN_VIEW_WINDOW_METERS = 400;
const BASE_CANVAS_HEIGHT = 300;
const RULER_HEIGHT = 56;
const TRACK_TOP = 56;
const TRACK_CENTER_RATIO = 0.55;
const TRACK_INNER_PADDING = 4;
const CARET_TIP_Y = 56;
const CARET_HALF_WIDTH = 8;
const CARET_HEIGHT = 12;
const CARET_HIT_PADDING = 4;
const MARKER_DOT_RADIUS = 7;
const MARKER_LABEL_OFFSET_Y = 24;
const MARKER_LABEL_HEIGHT = 22;
const MARKER_FONT_SIZE = 12;
const MARKER_PADDING_X = 14;
const MARKER_HEIGHT = 28;
const MARKER_MIN_WIDTH = 52;
const MARKER_LANE_GAP = 6;
const MAX_VISIBLE_MARKER_ROWS_ON_ZOOM_OUT = 6;
const SNAP_THRESHOLD_PX = 10;
const SNAP_RELEASE_THRESHOLD_PX = 16;
const FONT_FAMILY = '"Microsoft YaHei","PingFang SC",Arial,sans-serif';
const KEY_STEP_DISTANCE = 20;
const KEY_HOLD_START_DELAY_MS = 260;
const KEY_HOLD_INTERVAL_MS = 120;
const RIGHT_HOLD_OPEN_MS = 100;
const RADIAL_MENU_SIZE = 210;
const RADIAL_MENU_MARGIN = 8;
const RADIAL_CENTER = RADIAL_MENU_SIZE / 2;
const PRIMARY_RING_INNER_RADIUS = 36;
const PRIMARY_RING_OUTER_RADIUS = 62;
const SECONDARY_RING_INNER_RADIUS = 66;
const SECONDARY_RING_OUTER_RADIUS = 96;
const MENU_CENTER_CLOSE_RADIUS = 28;
const MENU_BASE_START_ANGLE = -Math.PI / 2;
const TWO_PI = Math.PI * 2;
const CHAIN_HUE_PALETTE = [8, 24, 42, 58, 76, 102, 136, 168, 196, 214, 236, 258, 282, 306, 332, 350];

const PRIMARY_MENU_ITEMS = [
  { id: "curve", label: "弯道", type: null, angle: -90 },
  { id: "specialCurve", label: "特弯", type: null, angle: -18 },
  { id: "danger", label: "注意", type: "注意", angle: 54 },
  { id: "surface", label: "路况", type: "路面颠簸", angle: 126 },
  { id: "jump", label: "飞跳", type: "飞跳", angle: 198 }
];

const CURVE_SECONDARY_ITEMS = [
  "右1",
  "右2",
  "右3",
  "右4",
  "右5",
  "右6",
  "左6",
  "左5",
  "左4",
  "左3",
  "左2",
  "左1"
];

const SECONDARY_MENU_MAP = {
  curve: CURVE_SECONDARY_ITEMS,
  specialCurve: ["右直角弯", "右发卡弯", "左发卡弯", "左直角弯"],
  danger: ["注意", "注意刹车"],
  surface: ["路面颠簸", "过坡", "不要切弯", "可以切"],
  jump: ["飞跳", "回头弯", "发卡弯", "变急", "变缓"]
};

const hitState = {
  markers: [],
  caretX: 0
};

const canvasState = {
  dpr: Math.max(1, window.devicePixelRatio || 1),
  width: 0,
  height: BASE_CANVAS_HEIGHT
};

const keyMoveState = {
  activeKey: null,
  holdTimeoutId: null,
  holdIntervalId: null
};

const radialState = {
  holdTimerId: null,
  holdingRight: false,
  isOpen: false,
  pressX: 0,
  pressY: 0,
  lastX: 0,
  lastY: 0,
  hoverPrimaryId: null,
  hoverSecondaryType: null,
  secondaryOpen: false,
  primaryLayout: [],
  secondaryLayout: []
};

const noticeState = {
  hideTimerId: null,
  cleanupTimerId: null
};

const markerDragState = {
  pointerOffsetX: 0
};

let markerLayoutVersion = 0;

const rowLimitGuardState = {
  lastZoom: Number.NaN,
  lastCenterDistance: Number.NaN,
  lastLayoutVersion: -1
};

function touchMarkerLayoutVersion() {
  markerLayoutVersion += 1;
}

function getCtx() {
  const ctx = refs.timelineCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context 获取失败");
  }
  return ctx;
}

function syncCanvasSize() {
  const rect = refs.timelineCanvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width));
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvasState.width = width;
  const height = calculateAdaptiveCanvasHeight();

  refs.timelineCanvas.style.height = `${height}px`;
  refs.timelineCanvas.width = Math.round(width * dpr);
  refs.timelineCanvas.height = Math.round(height * dpr);

  canvasState.height = height;
  canvasState.dpr = dpr;
}

function toCanvasX(clientX) {
  const rect = refs.timelineCanvas.getBoundingClientRect();
  return clientX - rect.left;
}

function getAxisWidth() {
  const width = canvasState.width - AXIS_PADDING * 2;
  return Math.max(1, width);
}

function getTrackHeight(height = canvasState.height) {
  return Math.max(0, height - TRACK_TOP);
}

function getTrackCenterY(height = canvasState.height) {
  return TRACK_TOP + getTrackHeight(height) * TRACK_CENTER_RATIO;
}

function calculateAdaptiveCanvasHeight() {
  // 固定画布高度
  return BASE_CANVAS_HEIGHT;
}

function getMaxZoom() {
  if (!state.initialized || state.startDistance <= 0) return 1;
  const byWindow = state.startDistance / Math.max(0.1, MIN_VIEW_WINDOW_METERS);
  return Math.max(1, Math.min(80, byWindow));
}

function getViewWindow() {
  if (!state.initialized || state.startDistance <= 0) return 0;
  return state.startDistance / state.zoom;
}

function clampCenterDistance() {
  if (!state.initialized) return;
  const window = getViewWindow();
  const half = window / 2;
  state.centerDistance = clamp(state.centerDistance, half, state.startDistance - half);
}

function getViewBounds() {
  const window = getViewWindow();
  const half = window / 2;
  return {
    viewMin: state.centerDistance - half,
    viewMax: state.centerDistance + half,
    window
  };
}

// 左大右小
function distanceToX(distance) {
  if (!state.initialized || state.startDistance <= 0) return AXIS_PADDING;
  const { viewMin, viewMax, window } = getViewBounds();
  const ratio = (viewMax - distance) / Math.max(window, EPSILON);
  return AXIS_PADDING + clamp(ratio, 0, 1) * getAxisWidth();
}

function xToDistance(x) {
  if (!state.initialized) return 0;
  const localX = clamp(x, AXIS_PADDING, canvasState.width - AXIS_PADDING);
  const ratio = (localX - AXIS_PADDING) / Math.max(1, getAxisWidth());
  const { viewMin, viewMax, window } = getViewBounds();
  const distance = viewMax - ratio * window;
  return toOneDecimal(clamp(distance, viewMin, viewMax));
}

function clientXToDistance(clientX) {
  return xToDistance(toCanvasX(clientX));
}

function getNiceStep(rawStep) {
  const safe = Math.max(0.1, rawStep);
  const power = 10 ** Math.floor(Math.log10(safe));
  const unit = safe / power;
  let niceUnit = 10;
  if (unit <= 1) niceUnit = 1;
  else if (unit <= 2) niceUnit = 2;
  else if (unit <= 5) niceUnit = 5;
  return Math.max(0.1, niceUnit * power);
}

function stopPlaying() {
  state.isPlaying = false;
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.lastFrameTime = 0;
}

function getMarkerById(id) {
  return state.markers.find((marker) => marker.id === id) || null;
}

function getSortedMarkers() {
  return [...state.markers].sort((a, b) => {
    if (Math.abs(a.distance - b.distance) > EPSILON) return b.distance - a.distance;
    return a.id.localeCompare(b.id);
  });
}

function getMarkerNumericOrder(markerId) {
  const match = /^M(\d+)$/.exec(markerId || "");
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function buildMarkerChildrenMap(markerMap = null) {
  const childrenMap = new Map();
  state.markers.forEach((marker) => {
    const parentId = marker.snapToMarkerId;
    if (!parentId) return;
    if (markerMap && !markerMap.has(parentId)) return;

    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId).push(marker);
  });

  childrenMap.forEach((children) => {
    children.sort((a, b) => getMarkerNumericOrder(a.id) - getMarkerNumericOrder(b.id));
  });

  return childrenMap;
}

function getTailAppendMarker(startMarker, markerMap, childrenMap) {
  let current = startMarker;
  const visited = new Set();

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const children = childrenMap.get(current.id);
    if (!children || children.length === 0) break;
    current = children[children.length - 1];
    if (!markerMap.has(current.id)) break;
  }

  return current || startMarker;
}

function ensureCurrentDistanceVisible() {
  const { viewMin, viewMax } = getViewBounds();
  if (state.currentDistance < viewMin || state.currentDistance > viewMax) {
    state.centerDistance = state.currentDistance;
    clampCenterDistance();
  }
}

function getMarkerOrderMap() {
  const sorted = getSortedMarkers();
  const orderMap = new Map();
  sorted.forEach((marker, index) => {
    orderMap.set(marker.id, index + 1);
  });
  return orderMap;
}

function getMarkerDisplayText(marker, orderMap = null) {
  const order = orderMap?.get(marker.id);
  if (!order) return marker.type;
  const orderText = String(order).padStart(2, "0");
  return `#${orderText} ${marker.type}`;
}

function getMarkerBoxWidth(marker, orderMap = null) {
  const ctx = getCtx();
  ctx.save();
  ctx.font = `${MARKER_FONT_SIZE}px ${FONT_FAMILY}`;
  const textW = ctx.measureText(getMarkerDisplayText(marker, orderMap)).width;
  ctx.restore();
  return Math.max(MARKER_MIN_WIDTH, Math.round(textW + MARKER_PADDING_X * 2));
}

function getMarkerTailDistance(marker, orderMap = null) {
  if (!state.initialized) return marker.distance;
  const { window } = getViewBounds();
  const metersPerPixel = window / Math.max(1, getAxisWidth());
  const widthPx = getMarkerBoxWidth(marker, orderMap);
  return toOneDecimal(clamp(marker.distance - widthPx * metersPerPixel, 0, state.startDistance));
}

function getSnappedMarkerDistance(markerId, rawDistance) {
  if (!state.initialized) {
    return { distance: rawDistance, snapToMarkerId: null };
  }

  const dragX = distanceToX(rawDistance);
  const draggingMarker = getMarkerById(markerId);
  let bestDistance = rawDistance;
  let bestDeltaPx = SNAP_THRESHOLD_PX + 1;
  let bestSnapToMarkerId = null;

  const orderMap = getMarkerOrderMap();
  const markerMap = new Map(state.markers.map((marker) => [marker.id, marker]));
  const childrenMap = buildMarkerChildrenMap(markerMap);
  const { viewMin, viewMax } = getViewBounds();
  const isMarkerVisibleInCurrentView = (marker) =>
    marker.distance >= viewMin - EPSILON && marker.distance <= viewMax + EPSILON;

  const resolveXCache = new Map();
  const resolvingX = new Set();
  const resolveMarkerBoxX = (marker) => {
    if (!marker) return distanceToX(rawDistance);
    if (resolveXCache.has(marker.id)) return resolveXCache.get(marker.id);

    const defaultX = distanceToX(marker.distance);
    if (!marker.snapToMarkerId) {
      resolveXCache.set(marker.id, defaultX);
      return defaultX;
    }

    const parent = markerMap.get(marker.snapToMarkerId);
    if (!parent || resolvingX.has(marker.id)) {
      resolveXCache.set(marker.id, defaultX);
      return defaultX;
    }

    resolvingX.add(marker.id);
    const parentX = resolveMarkerBoxX(parent);
    const parentW = getMarkerBoxWidth(parent, orderMap);
    const x = parentX + parentW;
    resolvingX.delete(marker.id);
    resolveXCache.set(marker.id, x);
    return x;
  };

  const getTargetTailX = (targetMarker) => {
    const targetX = resolveMarkerBoxX(targetMarker);
    const targetW = getMarkerBoxWidth(targetMarker, orderMap);
    return targetX + targetW;
  };

  const trySnap = (candidateX, candidateDistance, snapToMarkerId = null) => {
    const deltaPx = Math.abs(candidateX - dragX);
    if (deltaPx <= SNAP_THRESHOLD_PX && deltaPx < bestDeltaPx) {
      bestDeltaPx = deltaPx;
      bestDistance = candidateDistance;
      bestSnapToMarkerId = snapToMarkerId;
    }
  };

  // 已吸附目标使用更大释放阈值，避免在阈值边缘来回抖动/闪烁
  if (draggingMarker?.snapToMarkerId) {
    const currentTarget = markerMap.get(draggingMarker.snapToMarkerId);
    if (currentTarget && isMarkerVisibleInCurrentView(currentTarget)) {
      const holdTailX = getTargetTailX(currentTarget);
      const holdDelta = Math.abs(holdTailX - dragX);
      if (holdDelta <= SNAP_RELEASE_THRESHOLD_PX) {
        return {
          distance: toOneDecimal(clamp(currentTarget.distance, 0, state.startDistance)),
          snapToMarkerId: currentTarget.id
        };
      }
    }
  }

  trySnap(distanceToX(state.currentDistance), state.currentDistance, null);

  state.markers.forEach((item) => {
    if (item.id === markerId) return;
    // 被隐藏（不在当前可视范围）的标志禁止作为吸附目标
    if (!isMarkerVisibleInCurrentView(item)) return;
    // 仅允许吸附到“主标志”（未跟随其他标志）
    if (item.snapToMarkerId) return;

    // 若目标已有子标志，则自动追加到其子链尾部
    const appendTarget = getTailAppendMarker(item, markerMap, childrenMap);
    if (!isMarkerVisibleInCurrentView(appendTarget)) return;

    // 命中判定基于“追加目标的真实尾部坐标”
    const tailX = getTargetTailX(appendTarget);

    // 吸附后距离继承追加目标的距离，形成同距分行链
    trySnap(tailX, appendTarget.distance, appendTarget.id);
  });

  return {
    distance: toOneDecimal(clamp(bestDistance, 0, state.startDistance)),
    snapToMarkerId: bestSnapToMarkerId
  };
}

function applyMarkerSnapLinks() {
  if (!state.initialized || state.markers.length === 0) return;

  const markerMap = new Map(state.markers.map((marker) => [marker.id, marker]));
  const resolving = new Set();
  let changed = false;

  const resolveMarker = (marker) => {
    if (!marker?.snapToMarkerId) return;

    const target = markerMap.get(marker.snapToMarkerId);
    if (!target || target.id === marker.id) {
      if (marker.snapToMarkerId !== null) {
        marker.snapToMarkerId = null;
        changed = true;
      }
      return;
    }

    if (resolving.has(marker.id)) {
      if (marker.snapToMarkerId !== null) {
        marker.snapToMarkerId = null;
        changed = true;
      }
      return;
    }

    resolving.add(marker.id);
    resolveMarker(target);

    const nextDistance = toOneDecimal(clamp(target.distance, 0, state.startDistance));
    if (Math.abs(marker.distance - nextDistance) > EPSILON) {
      marker.distance = nextDistance;
      changed = true;
    }

    resolving.delete(marker.id);
  };

  state.markers.forEach((marker) => resolveMarker(marker));

  if (changed) {
    touchMarkerLayoutVersion();
  }
}

function getMenuCtx() {
  const ctx = refs.menuCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("菜单 Canvas 2D context 获取失败");
  }
  return ctx;
}

function syncMenuCanvasSize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  refs.menuCanvas.width = Math.round(RADIAL_MENU_SIZE * dpr);
  refs.menuCanvas.height = Math.round(RADIAL_MENU_SIZE * dpr);
  refs.menuCanvas.style.width = `${RADIAL_MENU_SIZE}px`;
  refs.menuCanvas.style.height = `${RADIAL_MENU_SIZE}px`;
}

function normalizeMenuAngle(angle) {
  let a = angle % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

function getSectorIndexByAngle(angle, count, startAngle = MENU_BASE_START_ANGLE) {
  if (count <= 0) return -1;
  const step = TWO_PI / count;
  const offset = normalizeMenuAngle(angle - startAngle);
  return Math.min(count - 1, Math.floor(offset / step));
}

function buildPrimaryLayout() {
  const count = PRIMARY_MENU_ITEMS.length;
  const step = TWO_PI / count;

  return PRIMARY_MENU_ITEMS.map((item, index) => {
    const startAngle = MENU_BASE_START_ANGLE + index * step;
    const endAngle = startAngle + step;
    return {
      ...item,
      startAngle,
      endAngle,
      midAngle: startAngle + step / 2
    };
  });
}

function buildSecondaryLayout(primaryId) {
  const items = SECONDARY_MENU_MAP[primaryId] || [];
  const count = items.length;
  if (!count) return [];

  const step = TWO_PI / count;
  const layoutStartAngle = MENU_BASE_START_ANGLE;

  return items.map((type, index) => {
    const startAngle = layoutStartAngle + index * step;
    const endAngle = startAngle + step;
    return {
      id: `${primaryId}-${type}`,
      type,
      startAngle,
      endAngle,
      midAngle: startAngle + step / 2
    };
  });
}

function drawDonutSector(ctx, innerR, outerR, startAngle, endAngle, fillStyle, strokeStyle) {
  ctx.beginPath();
  ctx.arc(RADIAL_CENTER, RADIAL_CENTER, outerR, startAngle, endAngle);
  ctx.arc(RADIAL_CENTER, RADIAL_CENTER, innerR, endAngle, startAngle, true);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawSectorLabel(ctx, text, midAngle, innerR, outerR, color, fontSize = 11, sectorSpan = Math.PI / 6) {
  const chars = Array.from(text || "");
  if (chars.length === 0) return;

  const r = (innerR + outerR) / 2;
  const maxArcLength = Math.max(16, r * sectorSpan * 0.78);

  let size = fontSize;
  let charSpacing = Math.max(0.8, size * 0.16);
  let charWidths = [];

  const calcTotalLength = () => {
    ctx.font = `${size}px ${FONT_FAMILY}`;
    charWidths = chars.map((ch) => ctx.measureText(ch).width);
    const widthSum = charWidths.reduce((sum, w) => sum + w, 0);
    return widthSum + charSpacing * Math.max(0, chars.length - 1);
  };

  let totalLength = calcTotalLength();
  while (size > 8 && totalLength > maxArcLength) {
    size -= 0.5;
    charSpacing = Math.max(0.8, size * 0.16);
    totalLength = calcTotalLength();
  }

  const spreadScale = Math.min(1.5, maxArcLength / Math.max(totalLength, 1));
  const tangentX = -Math.sin(midAngle);
  const direction = tangentX >= 0 ? 1 : -1;

  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${size}px ${FONT_FAMILY}`;

  let cursor = -totalLength / 2;
  chars.forEach((ch, index) => {
    const width = charWidths[index];
    const centerOffset = (cursor + width / 2) * spreadScale;
    const charAngle = midAngle + direction * (centerOffset / r);
    const x = RADIAL_CENTER + Math.cos(charAngle) * r;
    const y = RADIAL_CENTER + Math.sin(charAngle) * r;
    ctx.fillText(ch, x, y);
    cursor += width + charSpacing;
  });

  ctx.restore();
}

function drawMenuCanvas() {
  const ctx = getMenuCtx();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, RADIAL_MENU_SIZE, RADIAL_MENU_SIZE);

  const visiblePrimaryItems =
    radialState.secondaryOpen && radialState.hoverPrimaryId
      ? radialState.primaryLayout.filter((item) => item.id === radialState.hoverPrimaryId)
      : radialState.primaryLayout;

  visiblePrimaryItems.forEach((item) => {
    const active = radialState.hoverPrimaryId === item.id;
    drawDonutSector(
      ctx,
      PRIMARY_RING_INNER_RADIUS,
      PRIMARY_RING_OUTER_RADIUS,
      item.startAngle,
      item.endAngle,
      active ? "#dbeafe" : "#f8fbff",
      active ? "#3b82f6" : "#d6deea"
    );
    drawSectorLabel(
      ctx,
      item.label,
      item.midAngle,
      PRIMARY_RING_INNER_RADIUS,
      PRIMARY_RING_OUTER_RADIUS,
      active ? "#1e3a8a" : "#334155",
      10,
      item.endAngle - item.startAngle
    );
  });

  if (radialState.secondaryOpen && radialState.secondaryLayout.length > 0) {
    radialState.secondaryLayout.forEach((item) => {
      const active = radialState.hoverSecondaryType === item.type;
      drawDonutSector(
        ctx,
        SECONDARY_RING_INNER_RADIUS,
        SECONDARY_RING_OUTER_RADIUS,
        item.startAngle,
        item.endAngle,
        active ? "#e0f2fe" : "#f8fafc",
        active ? "#0ea5e9" : "#d6deea"
      );
      drawSectorLabel(
        ctx,
        item.type,
        item.midAngle,
        SECONDARY_RING_INNER_RADIUS,
        SECONDARY_RING_OUTER_RADIUS,
        active ? "#075985" : "#475569",
        9.5,
        item.endAngle - item.startAngle
      );
    });
  }

  ctx.beginPath();
  ctx.arc(RADIAL_CENTER, RADIAL_CENTER, MENU_CENTER_CLOSE_RADIUS, 0, TWO_PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#d6deea";
  ctx.stroke();

  const primaryLabel = radialState.primaryLayout.find((item) => item.id === radialState.hoverPrimaryId)?.label || "标记";
  const centerText = radialState.hoverSecondaryType || primaryLabel;
  ctx.font = `13px ${FONT_FAMILY}`;
  ctx.fillStyle = "#1e3a8a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(centerText, RADIAL_CENTER, RADIAL_CENTER);
}

function hideContextMenu() {
  refs.contextMenu.classList.add("hidden");
  radialState.isOpen = false;
  radialState.secondaryOpen = false;
  radialState.hoverPrimaryId = null;
  radialState.hoverSecondaryType = null;
  state.pendingContextDistance = null;
  drawMenuCanvas();
}

function showNotice(message, type = "error") {
  const bar = refs.noticeBar;
  if (!bar) return;

  if (noticeState.hideTimerId) {
    clearTimeout(noticeState.hideTimerId);
    noticeState.hideTimerId = null;
  }
  if (noticeState.cleanupTimerId) {
    clearTimeout(noticeState.cleanupTimerId);
    noticeState.cleanupTimerId = null;
  }

  bar.textContent = String(message ?? "");
  bar.dataset.type = type;
  bar.classList.remove("hidden");
  requestAnimationFrame(() => {
    bar.classList.add("show");
  });

  noticeState.hideTimerId = setTimeout(() => {
    bar.classList.remove("show");
    noticeState.cleanupTimerId = setTimeout(() => {
      bar.classList.add("hidden");
    }, 180);
  }, 2000);
}

function showContextMenu(clientX, clientY) {
  const half = RADIAL_MENU_SIZE / 2 + RADIAL_MENU_MARGIN;
  const x = clamp(clientX, half, Math.max(half, window.innerWidth - half));
  const y = clamp(clientY, half, Math.max(half, window.innerHeight - half));

  refs.contextMenu.style.left = `${x}px`;
  refs.contextMenu.style.top = `${y}px`;
  refs.contextMenu.classList.remove("hidden");

  radialState.isOpen = true;
  radialState.secondaryOpen = false;
  radialState.hoverPrimaryId = null;
  radialState.hoverSecondaryType = null;
  syncMenuCanvasSize();
  updateRadialHover(radialState.lastX || x, radialState.lastY || y);
}

function isCreateDialogOpen() {
  return refs.createDialog && !refs.createDialog.classList.contains("hidden");
}

function openCreateDialog(selectName = true) {
  if (!refs.createDialog) return;
  refs.createDialog.classList.remove("hidden");
  requestAnimationFrame(() => {
    refs.roadbookNameInput.focus();
    if (selectName) {
      refs.roadbookNameInput.select();
    }
  });
}

function closeCreateDialog() {
  if (!refs.createDialog) return;
  refs.createDialog.classList.add("hidden");
}

function renderStatus() {
  refs.roadbookNameText.textContent = state.initialized && state.roadbookName ? state.roadbookName : "--";
  refs.startDistanceText.textContent = state.initialized ? formatDistance(state.startDistance) : "--";
  refs.currentDistanceText.textContent = state.initialized ? formatDistance(state.currentDistance) : "--";

  const selectedMarker = state.selectedMarkerId ? getMarkerById(state.selectedMarkerId) : null;
  refs.selectedMarkerDistanceText.textContent = selectedMarker ? formatDistance(selectedMarker.distance) : "--";

  if (!state.initialized) {
    refs.playStatusText.textContent = "未创建";
    return;
  }

  if (state.currentDistance <= 0) {
    refs.playStatusText.textContent = "已到终点";
  } else {
    refs.playStatusText.textContent = state.isPlaying ? "播放中" : "已暂停";
  }

}

function renderPlayButton() {
  // 播放控制仅保留空格快捷键，不再渲染按钮状态
}

function clearCanvas(ctx) {
  ctx.clearRect(0, 0, canvasState.width, canvasState.height);
}

function drawTrackArea(ctx) {
  const trackHeight = getTrackHeight();
  const trackCenterY = getTrackCenterY();

  ctx.fillStyle = "#f9fbff";
  ctx.fillRect(0, TRACK_TOP, canvasState.width, trackHeight);

  ctx.fillStyle = "#e8edf7";
  const x = AXIS_PADDING;
  const y = trackCenterY - 2;
  const w = getAxisWidth();
  const h = 4;
  const r = 2;

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawRulerBase(ctx) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasState.width, RULER_HEIGHT);
  ctx.strokeStyle = "#e6eaf2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_HEIGHT - 0.5);
  ctx.lineTo(canvasState.width, RULER_HEIGHT - 0.5);
  ctx.stroke();
}

function drawText(ctx, text, x, y, align = "center", color = "#475569") {
  ctx.save();
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawRulerTicks(ctx) {
  if (!state.initialized) return;

  const leftX = AXIS_PADDING;
  const rightX = canvasState.width - AXIS_PADDING;
  const { viewMin, viewMax, window } = getViewBounds();
  const showEndpointLabels = state.zoom <= 1 + EPSILON;

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(leftX, RULER_HEIGHT);
  ctx.lineTo(leftX, RULER_HEIGHT - 30);
  ctx.moveTo(rightX, RULER_HEIGHT);
  ctx.lineTo(rightX, RULER_HEIGHT - 30);
  ctx.stroke();

  if (showEndpointLabels) {
    drawText(ctx, formatDistance(viewMax), leftX, 20, "left");
    drawText(ctx, formatDistance(viewMin), rightX, 20, "right");
  }

  const majorStep = getNiceStep(window / 8);
  const minorStep = Math.max(0.1, majorStep / 5);
  const endpointLabelAvoidPx = 72;
  const isNearEndpoint = (x) =>
    Math.abs(x - leftX) < endpointLabelAvoidPx || Math.abs(x - rightX) < endpointLabelAvoidPx;

  const minorStart = Math.ceil(viewMin / minorStep) * minorStep;
  ctx.strokeStyle = "#9aa4b2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let value = minorStart; value <= viewMax + EPSILON; value += minorStep) {
    const fixed = toOneDecimal(value);
    if (Math.abs(fixed - viewMin) < EPSILON || Math.abs(fixed - viewMax) < EPSILON) continue;
    const x = distanceToX(fixed);
    ctx.moveTo(x, RULER_HEIGHT);
    ctx.lineTo(x, RULER_HEIGHT - 12);
  }
  ctx.stroke();

  const majorStart = Math.ceil(viewMin / majorStep) * majorStep;
  ctx.strokeStyle = "#64748b";
  ctx.beginPath();
  for (let value = majorStart; value <= viewMax + EPSILON; value += majorStep) {
    const fixed = toOneDecimal(value);
    if (Math.abs(fixed - viewMin) < EPSILON || Math.abs(fixed - viewMax) < EPSILON) continue;
    const x = distanceToX(fixed);
    if (showEndpointLabels && isNearEndpoint(x)) continue;
    ctx.moveTo(x, RULER_HEIGHT);
    ctx.lineTo(x, RULER_HEIGHT - 24);
  }
  ctx.stroke();

  for (let value = majorStart; value <= viewMax + EPSILON; value += majorStep) {
    const fixed = toOneDecimal(value);
    if (Math.abs(fixed - viewMin) < EPSILON || Math.abs(fixed - viewMax) < EPSILON) continue;
    const x = distanceToX(fixed);
    if (showEndpointLabels && isNearEndpoint(x)) continue;
    drawText(ctx, formatDistance(fixed), x, 20, "center");
  }
}

function drawPointer(ctx) {
  if (!state.initialized) return;

  const x = distanceToX(state.currentDistance);
  hitState.caretX = x;

  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, TRACK_TOP);
  ctx.lineTo(x, canvasState.height);
  ctx.stroke();

  const label = formatDistance(state.currentDistance);
  ctx.font = `12px ${FONT_FAMILY}`;
  const textWidth = ctx.measureText(label).width;
  const paddingX = 8;
  const boxW = textWidth + paddingX * 2;
  const boxH = 20;
  const boxX = x - boxW / 2;
  const boxY = TRACK_TOP + 4;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#fecaca";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#b91c1c";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, boxY + boxH / 2);
}

function drawCaret(ctx) {
  if (!state.initialized) return;

  const x = hitState.caretX || distanceToX(state.currentDistance);

  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.moveTo(x, CARET_TIP_Y);
  ctx.lineTo(x - CARET_HALF_WIDTH, CARET_TIP_Y - CARET_HEIGHT);
  ctx.lineTo(x + CARET_HALF_WIDTH, CARET_TIP_Y - CARET_HEIGHT);
  ctx.closePath();
  ctx.fill();
}

function drawMarkerLink(ctx, fromLayout, toLayout, chainStyle = null) {
  const startX = toLayout.tailX;
  const startY = toLayout.centerY;
  const endX = fromLayout.boxX;
  const endY = fromLayout.centerY;
  const midX = (startX + endX) / 2;

  const linkStroke = chainStyle?.stroke || "rgba(139, 92, 246, 0.95)";
  const linkDot = chainStyle?.accent || "#8b5cf6";

  ctx.save();
  ctx.strokeStyle = linkStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(midX, startY);
  ctx.lineTo(midX, endY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = linkDot;
  ctx.beginPath();
  ctx.arc(startX, startY, 2.2, 0, TWO_PI);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(endX, endY, 2.2, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawMarker(ctx, marker, isSelected, layout, isLinked = false, isSnapParent = false, chainStyle = null) {
  const { boxX, boxY, boxW, centerY, labelText } = layout;
  const boxH = MARKER_HEIGHT;
  const textX = boxX + boxW / 2;

  const normalFill = chainStyle ? chainStyle.fill : isSnapParent ? "#ede9fe" : isLinked ? "#f5f3ff" : "#ffffff";
  const normalStroke = chainStyle ? chainStyle.stroke : isSnapParent ? "#7c3aed" : isLinked ? "#8b5cf6" : "#cbd5e1";
  const normalText = chainStyle ? chainStyle.text : isSnapParent ? "#4c1d95" : isLinked ? "#5b21b6" : "#334155";
  const selectedFill = chainStyle ? chainStyle.selectedFill : "#dbeafe";
  const selectedStroke = chainStyle ? chainStyle.selectedStroke : "#2563eb";
  const selectedHalo = chainStyle ? chainStyle.halo : "rgba(37, 99, 235, 0.25)";
  const accentColor = chainStyle ? chainStyle.accent : isSnapParent ? "#7c3aed" : "#8b5cf6";

  ctx.fillStyle = isSelected ? selectedFill : normalFill;
  ctx.strokeStyle = isSelected ? selectedStroke : normalStroke;
  ctx.lineWidth = isSelected ? 1.5 : 1;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, [0, 8, 8, 0]);
  ctx.fill();
  ctx.stroke();

  if (!isSelected) {
    if (isSnapParent) {
      ctx.fillStyle = accentColor;
      ctx.fillRect(boxX, boxY, 4, boxH);

      ctx.beginPath();
      ctx.arc(boxX + boxW - 6, boxY + 6, 2.4, 0, TWO_PI);
      ctx.fill();
    } else if (isLinked) {
      ctx.fillStyle = accentColor;
      ctx.fillRect(boxX, boxY, 3, boxH);
    }
  }

  if (isSelected) {
    ctx.strokeStyle = selectedHalo;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(boxX - 2, boxY - 2, boxW + 4, boxH + 4, [0, 10, 10, 0]);
    ctx.stroke();
  }

  ctx.fillStyle = isSelected ? (chainStyle ? chainStyle.selectedText : "#1e3a8a") : normalText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${MARKER_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillText(labelText, textX, centerY);

  hitState.markers.push({
    id: marker.id,
    x: boxX,
    y: boxY,
    w: boxW,
    h: boxH
  });
}

function hashTextToInt(text) {
  let hash = 0;
  const source = String(text ?? "");
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function createChainStyle(ownerId) {
  const hash = hashTextToInt(ownerId);
  const paletteHue = CHAIN_HUE_PALETTE[hash % CHAIN_HUE_PALETTE.length];
  const hueJitter = ((hash >>> 5) % 9) - 4;
  const hue = (paletteHue + hueJitter + 360) % 360;
  const sat = 66 + ((hash >>> 9) % 20);

  return {
    fill: `hsl(${hue}, 100%, 97%)`,
    stroke: `hsl(${hue}, ${sat}%, 45%)`,
    text: `hsl(${hue}, 58%, 25%)`,
    accent: `hsl(${hue}, ${Math.min(92, sat + 10)}%, 43%)`,
    selectedFill: `hsl(${hue}, 100%, 90%)`,
    selectedStroke: `hsl(${hue}, ${Math.min(95, sat + 12)}%, 37%)`,
    selectedText: `hsl(${hue}, 62%, 22%)`,
    halo: `hsla(${hue}, 88%, 42%, 0.24)`
  };
}

function buildMarkerLayoutDraft() {
  if (!state.initialized) {
    return {
      pendingLayouts: [],
      markerMap: new Map(),
      linkedIds: new Set(),
      snapParentIds: new Set(),
      maxAbsLaneOffset: 0
    };
  }

  const sorted = getSortedMarkers();
  const orderMap = getMarkerOrderMap();
  const markerMap = new Map(state.markers.map((marker) => [marker.id, marker]));
  const childrenMap = buildMarkerChildrenMap(markerMap);
  const { viewMin, viewMax } = getViewBounds();

  const visibleMarkers = sorted.filter((marker) => marker.distance >= viewMin - EPSILON && marker.distance <= viewMax + EPSILON);
  const visibleSet = new Set(visibleMarkers.map((marker) => marker.id));

  const laneGapX = 6;
  const laneOccupancyByOffset = new Map();

  const getBalancedLaneOffsetByOrder = (order) => {
    if (order === 0) return 0;
    const step = Math.ceil(order / 2);
    return order % 2 === 1 ? -step : step;
  };

  const getLaneRightX = (laneOffset) => laneOccupancyByOffset.get(laneOffset)?.rightX ?? -Infinity;

  const canPlaceAtLaneOffset = (laneOffset, boxX) => {
    const laneRight = getLaneRightX(laneOffset);
    return boxX > laneRight + laneGapX;
  };

  const occupyLaneOffset = (laneOffset, rightX, meta = {}) => {
    laneOccupancyByOffset.set(laneOffset, { rightX, ...meta });
  };

  const pickBalancedLaneOffset = (boxX) => {
    for (let order = 0; order < 256; order += 1) {
      const laneOffset = getBalancedLaneOffsetByOrder(order);
      if (canPlaceAtLaneOffset(laneOffset, boxX)) {
        return laneOffset;
      }
    }
    return 0;
  };

  const findAvailableLaneOffsetNearby = (startOffset, boxX) => {
    if (canPlaceAtLaneOffset(startOffset, boxX)) {
      return startOffset;
    }

    for (let delta = 1; delta < 256; delta += 1) {
      const upwardLaneOffset = startOffset - delta;
      if (canPlaceAtLaneOffset(upwardLaneOffset, boxX)) {
        return upwardLaneOffset;
      }

      const downwardLaneOffset = startOffset + delta;
      if (canPlaceAtLaneOffset(downwardLaneOffset, boxX)) {
        return downwardLaneOffset;
      }
    }
    return startOffset;
  };

  const canPlaceSequenceAtLaneOffset = (laneOffset, items) => {
    let laneRight = getLaneRightX(laneOffset);
    for (const item of items) {
      if (item.boxX <= laneRight + laneGapX) {
        return false;
      }
      laneRight = item.boxX + item.boxW;
    }
    return true;
  };

  const pickAlignedLaneOffsetForSequence = (preferredOffset, items) => {
    if (canPlaceSequenceAtLaneOffset(preferredOffset, items)) {
      return preferredOffset;
    }

    for (let delta = 1; delta < 256; delta += 1) {
      const upwardLaneOffset = preferredOffset - delta;
      if (canPlaceSequenceAtLaneOffset(upwardLaneOffset, items)) {
        return upwardLaneOffset;
      }

      const downwardLaneOffset = preferredOffset + delta;
      if (canPlaceSequenceAtLaneOffset(downwardLaneOffset, items)) {
        return downwardLaneOffset;
      }
    }
    return null;
  };

  const resolveXCache = new Map();
  const resolvingX = new Set();
  const resolveMarkerBoxX = (marker) => {
    if (resolveXCache.has(marker.id)) return resolveXCache.get(marker.id);

    const defaultX = distanceToX(marker.distance);
    if (!marker.snapToMarkerId) {
      resolveXCache.set(marker.id, defaultX);
      return defaultX;
    }

    const target = markerMap.get(marker.snapToMarkerId);
    if (!target || resolvingX.has(marker.id)) {
      resolveXCache.set(marker.id, defaultX);
      return defaultX;
    }

    resolvingX.add(marker.id);
    const targetX = resolveMarkerBoxX(target);
    const targetW = getMarkerBoxWidth(target, orderMap);
    const x = targetX + targetW;
    resolvingX.delete(marker.id);
    resolveXCache.set(marker.id, x);
    return x;
  };

  const chainStyleByOwnerId = new Map();
  const getChainStyleByOwnerId = (ownerId) => {
    if (!ownerId) return null;
    if (!chainStyleByOwnerId.has(ownerId)) {
      chainStyleByOwnerId.set(ownerId, createChainStyle(ownerId));
    }
    return chainStyleByOwnerId.get(ownerId);
  };

  const collectVisibleDescendants = (parentId, list = []) => {
    const children = childrenMap.get(parentId) || [];
    children.forEach((child) => {
      if (visibleSet.has(child.id)) {
        list.push(child);
      }
      collectVisibleDescendants(child.id, list);
    });
    return list;
  };

  const toDraftItem = (marker, chainOwnerId = null) => ({
    id: marker.id,
    marker,
    boxX: resolveMarkerBoxX(marker),
    boxW: getMarkerBoxWidth(marker, orderMap),
    labelText: getMarkerDisplayText(marker, orderMap),
    chainOwnerId,
    isChainDescendant: Boolean(chainOwnerId && marker.id !== chainOwnerId),
    chainStyle: getChainStyleByOwnerId(chainOwnerId)
  });

  const pendingLayouts = [];
  const linkedIds = new Set();
  const snapParentIds = new Set();
  const placedIds = new Set();

  state.markers.forEach((marker) => {
    if (marker.snapToMarkerId) {
      linkedIds.add(marker.id);
      linkedIds.add(marker.snapToMarkerId);
      snapParentIds.add(marker.snapToMarkerId);
    }
  });

  const placeItem = (item, laneOffset) => {
    occupyLaneOffset(laneOffset, item.boxX + item.boxW, {
      markerId: item.id,
      chainOwnerId: item.chainOwnerId || null,
      isChainDescendant: Boolean(item.isChainDescendant)
    });
    pendingLayouts.push({
      ...item,
      laneOffset
    });
    placedIds.add(item.id);
  };

  const rootMarkers = visibleMarkers.filter(
    (marker) => !marker.snapToMarkerId || !visibleSet.has(marker.snapToMarkerId)
  );

  rootMarkers.forEach((rootMarker) => {
    if (placedIds.has(rootMarker.id)) return;

    const descendants = collectVisibleDescendants(rootMarker.id, []).filter((marker) => !placedIds.has(marker.id));
    const hasDescendants = descendants.length > 0;
    const chainOwnerId = hasDescendants ? rootMarker.id : null;

    const rootItem = toDraftItem(rootMarker, chainOwnerId);
    const rootLaneOffset = pickBalancedLaneOffset(rootItem.boxX);
    placeItem(rootItem, rootLaneOffset);

    if (!hasDescendants) return;

    const descendantItems = descendants
      .map((marker) => toDraftItem(marker, chainOwnerId))
      .sort((a, b) => {
        if (Math.abs(a.boxX - b.boxX) > EPSILON) return a.boxX - b.boxX;
        return a.id.localeCompare(b.id);
      });

    const preferredChildLane = rootLaneOffset + 1;
    const alignedLaneOffset = pickAlignedLaneOffsetForSequence(preferredChildLane, descendantItems);

    if (alignedLaneOffset !== null) {
      descendantItems.forEach((item) => {
        placeItem(item, alignedLaneOffset);
      });
      return;
    }

    // 关键：一旦发生换行，后续追加优先沿当前行继续，不再每个元素都从初始行重新找位
    let currentLaneOffset = preferredChildLane;
    descendantItems.forEach((item) => {
      if (!canPlaceAtLaneOffset(currentLaneOffset, item.boxX)) {
        const laneOccupancy = laneOccupancyByOffset.get(currentLaneOffset);

        // 若当前行右侧不存在“其他标志”阻挡，且仅为同一子链尾部占位，则直接接在同一行后面，避免阶梯换行
        const canAppendInline =
          laneOccupancy &&
          laneOccupancy.chainOwnerId &&
          laneOccupancy.chainOwnerId === chainOwnerId &&
          laneOccupancy.isChainDescendant;

        if (canAppendInline) {
          item.boxX = (laneOccupancy.rightX ?? item.boxX) + laneGapX;
        } else {
          currentLaneOffset = findAvailableLaneOffsetNearby(currentLaneOffset, item.boxX);
        }
      }
      placeItem(item, currentLaneOffset);
    });
  });

  visibleMarkers.forEach((marker) => {
    if (placedIds.has(marker.id)) return;
    const item = toDraftItem(marker, null);
    const laneOffset = pickBalancedLaneOffset(item.boxX);
    placeItem(item, laneOffset);
  });

  const maxAbsLaneOffset = pendingLayouts.reduce(
    (max, item) => Math.max(max, Math.abs(item.laneOffset)),
    0
  );

  return {
    pendingLayouts,
    markerMap,
    linkedIds,
    snapParentIds,
    maxAbsLaneOffset
  };
}

function getVisibleMarkerRowCountFromDraft(draft) {
  if (!draft?.pendingLayouts?.length) return 0;
  return new Set(draft.pendingLayouts.map((item) => item.laneOffset)).size;
}

function getVisibleMarkerRowCountForView(zoom, centerDistance) {
  if (!state.initialized) return 0;

  const prevZoom = state.zoom;
  const prevCenterDistance = state.centerDistance;

  try {
    state.zoom = zoom;
    state.centerDistance = centerDistance;
    clampCenterDistance();
    return getVisibleMarkerRowCountFromDraft(buildMarkerLayoutDraft());
  } finally {
    state.zoom = prevZoom;
    state.centerDistance = prevCenterDistance;
  }
}

function autoZoomInIfRowsExceeded(maxRows = MAX_VISIBLE_MARKER_ROWS_ON_ZOOM_OUT) {
  if (!state.initialized) return false;

  let changed = false;
  for (let i = 0; i < 48; i += 1) {
    const currentRows = getVisibleMarkerRowCountFromDraft(buildMarkerLayoutDraft());
    if (currentRows <= maxRows) break;

    const maxZoom = getMaxZoom();
    const nextZoom = clamp(state.zoom * 1.12, 1, maxZoom);
    if (nextZoom <= state.zoom + EPSILON) break;

    state.zoom = nextZoom;
    clampCenterDistance();
    changed = true;
  }

  return changed;
}

function ensureRowLimitIfNeeded() {
  if (!state.initialized) return false;

  const zoomChanged =
    !Number.isFinite(rowLimitGuardState.lastZoom) ||
    Math.abs(rowLimitGuardState.lastZoom - state.zoom) > EPSILON;
  const centerChanged =
    !Number.isFinite(rowLimitGuardState.lastCenterDistance) ||
    Math.abs(rowLimitGuardState.lastCenterDistance - state.centerDistance) > EPSILON;
  const layoutChanged = rowLimitGuardState.lastLayoutVersion !== markerLayoutVersion;

  if (!zoomChanged && !centerChanged && !layoutChanged) return false;

  autoZoomInIfRowsExceeded();

  rowLimitGuardState.lastZoom = state.zoom;
  rowLimitGuardState.lastCenterDistance = state.centerDistance;
  rowLimitGuardState.lastLayoutVersion = markerLayoutVersion;
  return true;
}

function drawMarkers(ctx) {
  hitState.markers = [];
  if (!state.initialized) return;

  const { pendingLayouts, linkedIds, snapParentIds } = buildMarkerLayoutDraft();

  const laneStep = MARKER_HEIGHT + MARKER_LANE_GAP;
  const baseY = getTrackCenterY() - MARKER_HEIGHT / 2;
  const minBoxY = TRACK_TOP + TRACK_INNER_PADDING;
  const maxBoxY = canvasState.height - MARKER_HEIGHT - TRACK_INNER_PADDING;

  const layouts = [];
  const layoutMap = new Map();

  pendingLayouts.forEach((item) => {
    const boxY = clamp(baseY + item.laneOffset * laneStep, minBoxY, maxBoxY);
    const centerY = boxY + MARKER_HEIGHT / 2;

    const layout = {
      id: item.id,
      marker: item.marker,
      boxX: item.boxX,
      boxY,
      boxW: item.boxW,
      centerY,
      tailX: item.boxX + item.boxW,
      labelText: item.labelText,
      chainStyle: item.chainStyle
    };

    layouts.push(layout);
    layoutMap.set(item.id, layout);
  });

  layouts.forEach((layout) => {
    const targetId = layout.marker.snapToMarkerId;
    if (!targetId) return;
    const targetLayout = layoutMap.get(targetId);
    if (!targetLayout) return;
    drawMarkerLink(ctx, layout, targetLayout, layout.chainStyle || targetLayout.chainStyle || null);
  });

  layouts.forEach((layout) => {
    drawMarker(
      ctx,
      layout.marker,
      layout.id === state.selectedMarkerId,
      layout,
      linkedIds.has(layout.id),
      snapParentIds.has(layout.id),
      layout.chainStyle
    );
  });
}

function renderCanvas() {
  syncCanvasSize();
  const ctx = getCtx();

  ctx.setTransform(canvasState.dpr, 0, 0, canvasState.dpr, 0, 0);
  clearCanvas(ctx);

  drawTrackArea(ctx);
  drawRulerBase(ctx);

  if (!state.initialized) return;

  drawRulerTicks(ctx);
  drawMarkers(ctx);
  drawPointer(ctx);
  drawCaret(ctx);
}

function renderAll() {
  applyMarkerSnapLinks();

  // 性能优化：仅在缩放/中心位置/标记布局变化时才触发行数限制检查
  ensureRowLimitIfNeeded();

  renderStatus();
  renderPlayButton();
  renderCanvas();
  refs.emptyTrackHint.classList.toggle("hidden", state.markers.length > 0);
}

function addMarker(type, distance) {
  const marker = {
    id: `M${String(state.nextId).padStart(4, "0")}`,
    distance: toOneDecimal(distance),
    type,
    snapToMarkerId: null
  };
  state.nextId += 1;
  state.markers.push(marker);
  state.selectedMarkerId = marker.id;
  touchMarkerLayoutVersion();

  renderAll();
}

function deleteMarker(id) {
  const prevLength = state.markers.length;
  state.markers = state.markers.filter((marker) => marker.id !== id);
  if (state.markers.length !== prevLength) {
    touchMarkerLayoutVersion();
  }
  if (state.selectedMarkerId === id) {
    state.selectedMarkerId = null;
  }
  renderAll();
}

function exportRoadbookJson() {
  if (!state.initialized) {
    showNotice("请先创建或导入路书，再执行导出。");
    return;
  }

  const sortedMarkers = getSortedMarkers();
  const data = {
    version: 1,
    roadbookName: state.roadbookName,
    startDistance: toOneDecimal(state.startDistance),
    currentDistance: toOneDecimal(state.currentDistance),
    markers: sortedMarkers.map((marker, index) => ({
      id: `#${String(index + 1).padStart(2, "0")}`,
      sourceId: marker.id,
      distance: toOneDecimal(marker.distance),
      type: marker.type,
      snapToSourceId: marker.snapToMarkerId || null
    }))
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = (state.roadbookName || "roadbook").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "roadbook";
  link.href = url;
  link.download = `${safeName}-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
  showNotice("导出成功。", "success");
}

function normalizeImportedMarkers(rawMarkers, startDistance) {
  if (!Array.isArray(rawMarkers)) return [];

  const markers = [];
  rawMarkers.forEach((item) => {
    const type = typeof item?.type === "string" ? item.type.trim() : "";
    const rawDistance = Number(item?.distance);
    if (!type || !Number.isFinite(rawDistance)) return;

    markers.push({
      id: `M${String(markers.length + 1).padStart(4, "0")}`,
      distance: toOneDecimal(clamp(rawDistance, 0, startDistance)),
      type,
      snapToMarkerId: null,
      __importSourceId: typeof item?.sourceId === "string" ? item.sourceId.trim() : "",
      __importLegacyId: typeof item?.id === "string" ? item.id.trim() : "",
      __importSnapRef:
        typeof item?.snapToSourceId === "string"
          ? item.snapToSourceId.trim()
          : typeof item?.snapToMarkerId === "string"
            ? item.snapToMarkerId.trim()
            : typeof item?.snapToId === "string"
              ? item.snapToId.trim()
              : ""
    });
  });

  return markers;
}

function importRoadbookObject(data) {
  if (!data || typeof data !== "object") {
    throw new Error("JSON 顶层必须是对象。");
  }

  const roadbookNameRaw = typeof data.roadbookName === "string" ? data.roadbookName.trim() : "";
  const roadbookName = roadbookNameRaw || "未命名路书";

  const startDistance = toOneDecimal(Number(data.startDistance));
  if (!Number.isFinite(startDistance) || startDistance <= 0) {
    throw new Error("startDistance 必须是大于 0 的数字。");
  }

  const markers = normalizeImportedMarkers(data.markers, startDistance);
  const rawCurrentDistance = Number(data.currentDistance);
  const currentDistance = Number.isFinite(rawCurrentDistance)
    ? toOneDecimal(clamp(rawCurrentDistance, 0, startDistance))
    : startDistance;

  stopPlaying();

  state.initialized = true;
  state.roadbookName = roadbookName;
  state.startDistance = startDistance;
  state.currentDistance = currentDistance;
  state.markers = markers;
  state.nextId = markers.length + 1;
  touchMarkerLayoutVersion();

  // 还原导入文件中的吸附父子关系（若存在）
  const importIdMap = new Map();
  markers.forEach((marker) => {
    if (marker.__importSourceId) {
      importIdMap.set(marker.__importSourceId, marker.id);
    }
    if (marker.__importLegacyId) {
      importIdMap.set(marker.__importLegacyId, marker.id);
    }
  });

  markers.forEach((marker) => {
    if (marker.__importSnapRef) {
      const mappedId = importIdMap.get(marker.__importSnapRef);
      if (mappedId && mappedId !== marker.id) {
        marker.snapToMarkerId = mappedId;
      }
    }
    delete marker.__importSourceId;
    delete marker.__importLegacyId;
    delete marker.__importSnapRef;
  });

  state.selectedMarkerId = null;
  state.markerDraggingId = null;
  state.pendingContextDistance = null;

  state.zoom = 1;
  state.centerDistance = startDistance / 2;
  clampCenterDistance();

  state.panning = false;
  state.caretDragging = false;
  refs.timelineViewport.classList.remove("marker-dragging", "panning", "caret-dragging");

  refs.roadbookNameInput.value = roadbookName;
  refs.startDistanceInput.value = startDistance.toFixed(1);

  hideContextMenu();
  closeCreateDialog();
  renderAll();
}

async function importRoadbookFromFile(file) {
  if (!file) return;
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  importRoadbookObject(parsed);
}

function updateMarkerDistanceByClientX(markerId, clientX, pointerOffsetX = 0) {
  const marker = getMarkerById(markerId);
  if (!marker || !state.initialized) return;
  const anchorCanvasX = toCanvasX(clientX) - pointerOffsetX;
  const rawDistance = xToDistance(anchorCanvasX);
  const snapped = getSnappedMarkerDistance(markerId, rawDistance);

  const distanceChanged = Math.abs(marker.distance - snapped.distance) > EPSILON;
  const snapChanged = marker.snapToMarkerId !== snapped.snapToMarkerId;
  if (!distanceChanged && !snapChanged) return;

  marker.distance = snapped.distance;
  marker.snapToMarkerId = snapped.snapToMarkerId;
  touchMarkerLayoutVersion();
  renderAll();
}

function setCurrentDistance(nextDistance) {
  if (!state.initialized) return;
  state.currentDistance = toOneDecimal(clamp(nextDistance, 0, state.startDistance));
  if (state.currentDistance <= 0) {
    state.currentDistance = 0;
    stopPlaying();
  }
  ensureCurrentDistanceVisible();
  renderAll();
}

function adjustCurrentDistanceByDirection(direction) {
  if (!state.initialized) return;
  stopPlaying();
  setCurrentDistance(state.currentDistance + direction * KEY_STEP_DISTANCE);
}

function setCurrentDistanceByClientX(clientX) {
  setCurrentDistance(clientXToDistance(clientX));
}

function clearArrowHold() {
  if (keyMoveState.holdTimeoutId) {
    clearTimeout(keyMoveState.holdTimeoutId);
    keyMoveState.holdTimeoutId = null;
  }
  if (keyMoveState.holdIntervalId) {
    clearInterval(keyMoveState.holdIntervalId);
    keyMoveState.holdIntervalId = null;
  }
  keyMoveState.activeKey = null;
}

function startArrowHold(keyCode, direction) {
  if (!state.initialized) return;
  if (keyMoveState.activeKey === keyCode && (keyMoveState.holdTimeoutId || keyMoveState.holdIntervalId)) return;

  clearArrowHold();
  keyMoveState.activeKey = keyCode;

  keyMoveState.holdTimeoutId = setTimeout(() => {
    if (keyMoveState.activeKey !== keyCode) return;
    keyMoveState.holdTimeoutId = null;
    keyMoveState.holdIntervalId = setInterval(() => {
      adjustCurrentDistanceByDirection(direction);
    }, KEY_HOLD_INTERVAL_MS);
  }, KEY_HOLD_START_DELAY_MS);
}

function startCaretDragging(clientX) {
  if (!state.initialized) return;
  stopPlaying();
  clearCaretHoverState();
  state.caretDragging = true;
  refs.timelineViewport.classList.add("caret-dragging");
  setCurrentDistanceByClientX(clientX);
}

function stopCaretDragging() {
  if (!state.caretDragging) return;
  state.caretDragging = false;
  refs.timelineViewport.classList.remove("caret-dragging");
}

function setZoomKeepingAnchor(nextZoom, anchorRatio = 0.5, anchorDistance = state.centerDistance) {
  if (!state.initialized) return;

  const maxZoom = getMaxZoom();
  const clampedZoom = clamp(nextZoom, 1, maxZoom);
  if (Math.abs(clampedZoom - state.zoom) <= EPSILON) return;

  const newWindow = state.startDistance / clampedZoom;
  const newViewMax = anchorDistance + anchorRatio * newWindow;
  const nextCenterDistance = clamp(newViewMax - newWindow / 2, newWindow / 2, state.startDistance - newWindow / 2);

  // 缩小时间尺度（zoom out）时限制行数：超过 6 行则阻止继续缩小
  if (clampedZoom < state.zoom - EPSILON) {
    const nextVisibleRows = getVisibleMarkerRowCountForView(clampedZoom, nextCenterDistance);
    if (nextVisibleRows > MAX_VISIBLE_MARKER_ROWS_ON_ZOOM_OUT) {
      return;
    }
  }

  state.zoom = clampedZoom;
  state.centerDistance = nextCenterDistance;

  clampCenterDistance();
  renderAll();
}

function zoomByWheel(event) {
  if (!state.initialized) return;
  event.preventDefault();

  const rect = refs.timelineCanvas.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left - AXIS_PADDING) / Math.max(1, rect.width - AXIS_PADDING * 2), 0, 1);
  const anchorDistance = clientXToDistance(event.clientX);

  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  setZoomKeepingAnchor(state.zoom * factor, ratio, anchorDistance);
}

function startPanning(clientX) {
  if (!state.initialized) return;
  clearCaretHoverState();
  state.panning = true;
  state.panStartX = clientX;
  state.panStartCenterDistance = state.centerDistance;
  refs.timelineViewport.classList.add("panning");
}

function updatePanning(clientX) {
  if (!state.panning || !state.initialized) return;

  const deltaX = clientX - state.panStartX;
  const window = getViewWindow();
  const deltaDistance = (deltaX / getAxisWidth()) * window;

  state.centerDistance = state.panStartCenterDistance + deltaDistance;
  clampCenterDistance();
  renderAll();
}

function stopPanning() {
  if (!state.panning) return;
  state.panning = false;
  refs.timelineViewport.classList.remove("panning");
}

function findMarkerHit(clientX, clientY) {
  const rect = refs.timelineCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  for (let i = hitState.markers.length - 1; i >= 0; i -= 1) {
    const hit = hitState.markers[i];
    if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
      return {
        id: hit.id,
        pointerOffsetX: x - hit.x
      };
    }
  }

  return null;
}

function isCaretHit(clientX, clientY) {
  if (!state.initialized) return false;
  const rect = refs.timelineCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const caretX = hitState.caretX || distanceToX(state.currentDistance);
  if (y < CARET_TIP_Y - CARET_HEIGHT - 6 || y > CARET_TIP_Y + 6) return false;
  return Math.abs(x - caretX) <= CARET_HALF_WIDTH + CARET_HIT_PADDING;
}

function isRulerHit(clientY) {
  const rect = refs.timelineCanvas.getBoundingClientRect();
  const y = clientY - rect.top;
  return y >= 0 && y <= RULER_HEIGHT;
}

function isPointerLineHit(clientX, clientY) {
  if (!state.initialized) return false;
  const rect = refs.timelineCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  if (x < 0 || x > rect.width || y < RULER_HEIGHT || y > rect.height) return false;

  const caretX = hitState.caretX || distanceToX(state.currentDistance);
  return Math.abs(x - caretX) <= CARET_HALF_WIDTH + CARET_HIT_PADDING;
}

function clearCaretHoverState() {
  refs.timelineViewport.classList.remove("caret-hover");
}

function updateCaretHoverState(clientX, clientY) {
  if (!state.initialized) {
    clearCaretHoverState();
    return;
  }

  if (findMarkerHit(clientX, clientY)) {
    clearCaretHoverState();
    return;
  }

  const nearCaret = isCaretHit(clientX, clientY);
  const nearPointerLine = isPointerLineHit(clientX, clientY);
  refs.timelineViewport.classList.toggle("caret-hover", nearCaret || nearPointerLine);
}

function createRoadbook() {
  const roadbookName = refs.roadbookNameInput.value.trim();
  if (!roadbookName) {
    showNotice("请输入路书名称。");
    refs.roadbookNameInput.focus();
    return;
  }

  const rawInputValue = Number(refs.startDistanceInput.value);
  const inputValue = toOneDecimal(rawInputValue);

  if (!Number.isFinite(rawInputValue) || inputValue <= 0) {
    showNotice("请输入大于 0 的起始距离（单位：米，保留 1 位小数）。");
    refs.startDistanceInput.focus();
    return;
  }

  stopPlaying();

  state.initialized = true;
  state.roadbookName = roadbookName;
  state.startDistance = inputValue;
  state.currentDistance = inputValue;
  state.markers = [];
  state.nextId = 1;
  touchMarkerLayoutVersion();
  state.selectedMarkerId = null;
  state.markerDraggingId = null;

  state.zoom = 1;
  state.centerDistance = inputValue / 2;
  clampCenterDistance();

  state.panning = false;
  state.caretDragging = false;
  refs.timelineViewport.classList.remove("marker-dragging", "panning", "caret-dragging");

  refs.roadbookNameInput.value = roadbookName;
  refs.startDistanceInput.value = inputValue.toFixed(1);

  hideContextMenu();
  closeCreateDialog();
  renderAll();
}

function togglePlay() {
  if (!state.initialized) return;

  if (state.currentDistance <= 0) {
    state.currentDistance = 0;
    stopPlaying();
    renderAll();
    return;
  }

  if (state.isPlaying) {
    stopPlaying();
    renderAll();
    return;
  }

  state.isPlaying = true;
  state.lastFrameTime = 0;
  renderAll();
  state.rafId = requestAnimationFrame(playLoop);
}

function playLoop(timestamp) {
  if (!state.isPlaying) return;

  if (!state.lastFrameTime) {
    state.lastFrameTime = timestamp;
  }

  const deltaSeconds = (timestamp - state.lastFrameTime) / 1000;
  state.lastFrameTime = timestamp;

  state.currentDistance -= PLAY_SPEED_MPS * deltaSeconds;
  if (state.currentDistance <= 0) {
    state.currentDistance = 0;
    stopPlaying();
  }

  ensureCurrentDistanceVisible();
  renderAll();

  if (state.isPlaying) {
    state.rafId = requestAnimationFrame(playLoop);
  }
}

function initRadialMenu() {
  radialState.primaryLayout = buildPrimaryLayout();
  radialState.secondaryLayout = [];
  syncMenuCanvasSize();
  drawMenuCanvas();
}

function updateRadialHover(clientX, clientY) {
  if (!radialState.isOpen) return;

  radialState.lastX = clientX;
  radialState.lastY = clientY;

  const rect = refs.contextMenu.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  const dx = localX - RADIAL_CENTER;
  const dy = localY - RADIAL_CENTER;
  const distance = Math.hypot(dx, dy);
  const angle = normalizeMenuAngle(Math.atan2(dy, dx));

  const inCenterZone = distance <= MENU_CENTER_CLOSE_RADIUS;
  const inPrimaryRing = distance >= PRIMARY_RING_INNER_RADIUS && distance <= PRIMARY_RING_OUTER_RADIUS;
  const inSecondaryRing = distance >= SECONDARY_RING_INNER_RADIUS && distance <= SECONDARY_RING_OUTER_RADIUS;

  if (inCenterZone) {
    radialState.secondaryOpen = false;
    radialState.hoverPrimaryId = null;
    radialState.hoverSecondaryType = null;
    radialState.secondaryLayout = [];
    drawMenuCanvas();
    return;
  }

  // 二级已打开时：锁定当前一级，不再切换到其他一级
  if (radialState.secondaryOpen) {
    if (inSecondaryRing && radialState.secondaryLayout.length > 0) {
      const secondaryIndex = getSectorIndexByAngle(
        angle,
        radialState.secondaryLayout.length,
        radialState.secondaryLayout[0]?.startAngle ?? MENU_BASE_START_ANGLE
      );
      const secondary = radialState.secondaryLayout[secondaryIndex] || null;
      radialState.hoverSecondaryType = secondary?.type || null;
    } else {
      radialState.hoverSecondaryType = null;
    }
    drawMenuCanvas();
    return;
  }

  if (inPrimaryRing) {
    const primaryIndex = getSectorIndexByAngle(angle, radialState.primaryLayout.length);
    const primary = radialState.primaryLayout[primaryIndex] || null;

    radialState.hoverPrimaryId = primary?.id || null;
    radialState.hoverSecondaryType = null;
    radialState.secondaryOpen = Boolean(primary);

    if (primary) {
      radialState.secondaryLayout = buildSecondaryLayout(primary.id);
    } else {
      radialState.secondaryLayout = [];
    }

    drawMenuCanvas();
    return;
  }

  radialState.hoverPrimaryId = null;
  drawMenuCanvas();
}

function clearRadialHoldTimer() {
  if (radialState.holdTimerId) {
    clearTimeout(radialState.holdTimerId);
    radialState.holdTimerId = null;
  }
}

function startRightHoldMenu(clientX, clientY) {
  clearRadialHoldTimer();
  radialState.holdingRight = true;
  radialState.pressX = clientX;
  radialState.pressY = clientY;
  radialState.lastX = clientX;
  radialState.lastY = clientY;

  state.pendingContextDistance = state.currentDistance;

  radialState.holdTimerId = setTimeout(() => {
    radialState.holdTimerId = null;
    if (!radialState.holdingRight) return;
    showContextMenu(radialState.pressX, radialState.pressY);
  }, RIGHT_HOLD_OPEN_MS);
}

function cancelRightHoldMenu() {
  clearRadialHoldTimer();
  radialState.holdingRight = false;
  hideContextMenu();
}

function finishRightHoldMenu() {
  clearRadialHoldTimer();

  let selectedType = null;
  if (radialState.isOpen) {
    selectedType = radialState.hoverSecondaryType || null;

    if (!selectedType && radialState.hoverPrimaryId) {
      selectedType = radialState.primaryLayout.find((item) => item.id === radialState.hoverPrimaryId)?.type || null;
    }
  }

  radialState.holdingRight = false;

  if (selectedType && state.initialized && state.pendingContextDistance !== null) {
    addMarker(selectedType, state.pendingContextDistance);
  }

  hideContextMenu();
}

function bindEvents() {
  refs.openCreateDialogBtn.addEventListener("click", () => {
    openCreateDialog(true);
  });
  refs.createDialogCloseBtn.addEventListener("click", closeCreateDialog);
  refs.createDialogCancelBtn.addEventListener("click", closeCreateDialog);
  refs.createDialog.addEventListener("mousedown", (event) => {
    if (event.target === refs.createDialog) {
      closeCreateDialog();
    }
  });

  refs.createBtn.addEventListener("click", createRoadbook);
  refs.exportJsonBtn.addEventListener("click", exportRoadbookJson);
  refs.importJsonBtn.addEventListener("click", () => {
    refs.importJsonInput.click();
  });
  refs.importJsonInput.addEventListener("change", async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    try {
      await importRoadbookFromFile(file);
      showNotice("导入成功。", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件解析失败，请检查 JSON 格式。";
      showNotice(`导入失败：${message}`);
    }
  });

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    const editing = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";
    const withCommandKey = (event.ctrlKey || event.metaKey) && !event.altKey;

    if (event.code === "Escape" && isCreateDialogOpen()) {
      event.preventDefault();
      closeCreateDialog();
      return;
    }

    if (
      event.code === "Enter" &&
      isCreateDialogOpen() &&
      refs.createDialog.contains(document.activeElement) &&
      !withCommandKey &&
      !event.altKey
    ) {
      event.preventDefault();
      createRoadbook();
      return;
    }

    // 桌面应用常用快捷键
    if (withCommandKey && event.code === "KeyN") {
      event.preventDefault();
      openCreateDialog(true);
      return;
    }

    if (withCommandKey && event.code === "KeyO") {
      event.preventDefault();
      refs.importJsonInput.click();
      return;
    }

    if (withCommandKey && event.code === "KeyS") {
      event.preventDefault();
      exportRoadbookJson();
      return;
    }

    if (event.code === "Space") {
      if (event.repeat || editing) return;
      event.preventDefault();
      togglePlay();
      return;
    }

    if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && !editing) {
      event.preventDefault();
      if (event.repeat) return;
      const direction = event.code === "ArrowLeft" ? 1 : -1;
      adjustCurrentDistanceByDirection(direction);
      startArrowHold(event.code, direction);
      return;
    }

    if ((event.code === "Delete" || event.code === "Backspace") && !editing && state.selectedMarkerId) {
      event.preventDefault();
      deleteMarker(state.selectedMarkerId);
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code === keyMoveState.activeKey) {
      clearArrowHold();
    }
  });

  window.addEventListener("blur", () => {
    clearArrowHold();
    cancelRightHoldMenu();
    clearCaretHoverState();
  });

  refs.timelineCanvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  refs.timelineCanvas.addEventListener("mousedown", (event) => {
    if (event.button === 2) {
      event.preventDefault();
      if (!state.initialized) {
        showNotice("请先创建路书，再添加标记。");
        return;
      }
      startRightHoldMenu(event.clientX, event.clientY);
      return;
    }

    if (!state.initialized) return;

    const markerHit = findMarkerHit(event.clientX, event.clientY);

    if (event.button === 0) {
      if (markerHit) {
        state.markerDraggingId = markerHit.id;
        markerDragState.pointerOffsetX = markerHit.pointerOffsetX;
        state.selectedMarkerId = markerHit.id;
        refs.timelineViewport.classList.add("marker-dragging");
        renderAll();
        return;
      }

      if (isCaretHit(event.clientX, event.clientY) || isRulerHit(event.clientY) || isPointerLineHit(event.clientX, event.clientY)) {
        hideContextMenu();
        state.selectedMarkerId = null;
        startCaretDragging(event.clientX);
        return;
      }

      state.selectedMarkerId = null;
      renderAll();
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      hideContextMenu();
      startPanning(event.clientX);
    }
  });

  refs.timelineCanvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });

  document.addEventListener("mousemove", (event) => {
    if (radialState.holdingRight || radialState.isOpen) {
      clearCaretHoverState();
      radialState.lastX = event.clientX;
      radialState.lastY = event.clientY;
      if (radialState.isOpen) {
        updateRadialHover(event.clientX, event.clientY);
      }
      return;
    }

    if (state.markerDraggingId) {
      clearCaretHoverState();
      updateMarkerDistanceByClientX(state.markerDraggingId, event.clientX, markerDragState.pointerOffsetX);
      return;
    }

    if (state.caretDragging) {
      clearCaretHoverState();
      setCurrentDistanceByClientX(event.clientX);
      return;
    }

    if (state.panning) {
      clearCaretHoverState();
      updatePanning(event.clientX);
      return;
    }

    updateCaretHoverState(event.clientX, event.clientY);
  });

  document.addEventListener("mouseup", (event) => {
    if (state.markerDraggingId) {
      state.markerDraggingId = null;
      markerDragState.pointerOffsetX = 0;
      refs.timelineViewport.classList.remove("marker-dragging");
    }

    stopCaretDragging();
    stopPanning();

    if (event.button === 2 && (radialState.holdingRight || radialState.isOpen)) {
      finishRightHoldMenu();
    }

    updateCaretHoverState(event.clientX, event.clientY);
  });

  refs.timelineCanvas.addEventListener("wheel", zoomByWheel, { passive: false });

  window.addEventListener("resize", () => {
    syncMenuCanvasSize();
    if (radialState.isOpen) {
      drawMenuCanvas();
    }

    if (!state.initialized) {
      syncCanvasSize();
      renderCanvas();
      return;
    }
    renderAll();
  });
}

function init() {
  syncCanvasSize();
  initRadialMenu();
  bindEvents();
  renderAll();
}

init();
