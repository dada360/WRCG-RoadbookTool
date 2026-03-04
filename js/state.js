export const state = {
  initialized: false,
  roadbookName: "",
  startDistance: 0,
  currentDistance: 0,
  isPlaying: false,

  markers: [],
  nextId: 1,
  selectedMarkerId: null,

  pendingContextDistance: null,

  zoom: 1,
  centerDistance: 0,

  markerDraggingId: null,
  caretDragging: false,

  panning: false,
  panStartX: 0,
  panStartCenterDistance: 0,

  rafId: null,
  lastFrameTime: 0
};
