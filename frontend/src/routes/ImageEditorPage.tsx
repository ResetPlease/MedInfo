import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useParams } from "react-router-dom";

import { getImageEditor, removeSegmentation, saveSegmentation } from "../lib/api";
import type { CurrentUser, ImageEditorResponse, SegmentationMap } from "../lib/api";

type ImageEditorPageProps = {
  currentUser: CurrentUser;
};

type Point = {
  x: number;
  y: number;
};

type ViewportState = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type EraseTarget = {
  label: string;
  lineIndex: number;
};

type PointerGesture =
  | {
      kind: "draw";
      pointerId: number;
    }
  | {
      kind: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startOffsetX: number;
      startOffsetY: number;
    }
  | {
      kind: "pinch";
      startDistance: number;
      startZoom: number;
      anchorSceneX: number;
      anchorSceneY: number;
    }
  | null;

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const DRAW_DISTANCE_THRESHOLD = 0.0025;
const STROKE_WIDTH_OPTIONS = [3, 5, 8];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cloneSegmentations(segmentations: SegmentationMap): SegmentationMap {
  const next: SegmentationMap = {};

  Object.entries(segmentations).forEach(([label, lines]) => {
    next[label] = lines.map((line) => line.map((point) => ({ x: point.x, y: point.y })));
  });

  return next;
}

function colorForTag(tag: string) {
  let hue = 0;
  for (let index = 0; index < tag.length; index += 1) {
    hue = (hue << 5) - hue + tag.charCodeAt(index);
  }

  const normalizedHue = Math.abs(hue) % 360;
  return `hsl(${normalizedHue} 78% 52%)`;
}

function pointsToPolyline(line: Point[], width: number, height: number) {
  return line
    .map((point) => `${point.x * width},${point.y * height}`)
    .join(" ");
}

function countTagLines(segmentations: SegmentationMap, label: string) {
  return segmentations[label]?.length ?? 0;
}

function strokeWidthLabel(value: number) {
  if (value === 3) {
    return "Тонкая";
  }

  if (value === 5) {
    return "Средняя";
  }

  return "Толстая";
}

function buildInitialViewport(
  workspaceWidth: number,
  workspaceHeight: number,
  stageWidth: number,
  stageHeight: number,
): ViewportState {
  return {
    zoom: 1,
    offsetX: Math.round((workspaceWidth - stageWidth) / 2),
    offsetY: Math.round((workspaceHeight - stageHeight) / 2),
  };
}

function collectChangedLabels(previous: SegmentationMap, next: SegmentationMap) {
  const labels = new Set([...Object.keys(previous), ...Object.keys(next)]);

  return Array.from(labels).filter((label) => {
    const previousLines = previous[label] ?? [];
    const nextLines = next[label] ?? [];
    return JSON.stringify(previousLines) !== JSON.stringify(nextLines);
  });
}

function formatSaveStatus(saveState: SaveState, lastSavedAt: Date | null) {
  if (saveState === "saving") {
    return "Сохраняем изменения...";
  }

  if (saveState === "error") {
    return "Ошибка сохранения";
  }

  if (saveState === "saved" && lastSavedAt) {
    return `Сохранено ${lastSavedAt.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  return "Готово";
}

function distanceBetweenPoints(left: Point, right: Point) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distanceToSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (lengthSquared === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const projection = ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSquared;
  const t = clamp(projection, 0, 1);
  const nearestX = startX + segmentX * t;
  const nearestY = startY + segmentY * t;

  return Math.hypot(pointX - nearestX, pointY - nearestY);
}

function distanceToPolyline(point: Point, line: Point[], sceneWidth: number, sceneHeight: number) {
  if (!line.length) {
    return Number.POSITIVE_INFINITY;
  }

  const pointX = point.x * sceneWidth;
  const pointY = point.y * sceneHeight;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    const next = line[index + 1];
    const currentX = current.x * sceneWidth;
    const currentY = current.y * sceneHeight;

    if (!next) {
      bestDistance = Math.min(bestDistance, Math.hypot(pointX - currentX, pointY - currentY));
      continue;
    }

    const nextX = next.x * sceneWidth;
    const nextY = next.y * sceneHeight;
    bestDistance = Math.min(
      bestDistance,
      distanceToSegment(pointX, pointY, currentX, currentY, nextX, nextY),
    );
  }

  return bestDistance;
}

function findEraseTarget(
  segmentations: SegmentationMap,
  labels: string[],
  point: Point,
  sceneWidth: number,
  sceneHeight: number,
  hitRadius: number,
): EraseTarget | null {
  let bestTarget: EraseTarget | null = null;
  let bestDistance = hitRadius;

  labels.forEach((label) => {
    const lines = segmentations[label] ?? [];

    lines.forEach((line, lineIndex) => {
      const distance = distanceToPolyline(point, line, sceneWidth, sceneHeight);
      if (distance > bestDistance) {
        return;
      }

      bestDistance = distance;
      bestTarget = { label, lineIndex };
    });
  });

  return bestTarget;
}

export function ImageEditorPage({ currentUser }: ImageEditorPageProps) {
  const params = useParams();
  const imageId = Number(params.imageId);

  const [editor, setEditor] = useState<ImageEditorResponse | null>(null);
  const [segmentations, setSegmentations] = useState<SegmentationMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTag, setActiveTag] = useState("");
  const [mode, setMode] = useState<"draw" | "erase" | "navigate">("draw");
  const [showAllTags, setShowAllTags] = useState(true);
  const [draftLine, setDraftLine] = useState<Point[]>([]);
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [historyStack, setHistoryStack] = useState<SegmentationMap[]>([]);
  const [redoStack, setRedoStack] = useState<SegmentationMap[]>([]);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [viewport, setViewport] = useState<ViewportState>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });

  const focusFrameRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef(viewport);
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<PointerGesture>(null);
  const draftLineRef = useRef<Point[]>([]);
  const saveRequestIdRef = useRef(0);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    function syncFullscreenState() {
      const focusFrame = focusFrameRef.current;
      setIsFocusMode(Boolean(focusFrame && document.fullscreenElement === focusFrame));
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    draftLineRef.current = draftLine;
  }, [draftLine]);

  useEffect(() => {
    if (!Number.isFinite(imageId)) {
      setError("Неверный идентификатор изображения");
      setLoading(false);
      return;
    }

    if (!currentUser.permissions.at_least_worker) {
      setError("У вас нет прав на разметку изображений");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const response = await getImageEditor(imageId, controller.signal);
        setEditor(response);
        setSegmentations(response.segmentations);
        setHistoryStack([]);
        setRedoStack([]);
        setActiveTag(response.editor_tags[0] ?? Object.keys(response.segmentations)[0] ?? "");
        setDraftLine([]);
        setSaveState("idle");
        setNaturalSize({ width: 0, height: 0 });
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          window.location.assign("/login");
          return;
        }

        if (err instanceof Response && err.status === 403) {
          setError("У вас нет доступа к редактору разметки");
        } else if (err instanceof Response && err.status === 409) {
          const payload = await err.json().catch(() => null);
          setError(payload?.detail ?? "Разметка недоступна для этого изображения");
        } else {
          setError("Не удалось загрузить редактор");
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [currentUser.permissions.at_least_worker, imageId]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    const currentWorkspace = workspace;

    function syncWorkspaceSize() {
      const rect = currentWorkspace.getBoundingClientRect();
      setWorkspaceSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setWorkspaceSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      });
    });

    const frameId = window.requestAnimationFrame(syncWorkspaceSize);
    resizeObserver.observe(currentWorkspace);
    window.addEventListener("resize", syncWorkspaceSize);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncWorkspaceSize);
    };
  }, [editor]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();

    editor?.editor_tags.forEach((tag) => tags.add(tag));
    Object.keys(segmentations).forEach((tag) => tags.add(tag));

    return Array.from(tags);
  }, [editor?.editor_tags, segmentations]);

  useEffect(() => {
    if (!availableTags.length) {
      setActiveTag("");
      return;
    }

    if (!activeTag || !availableTags.includes(activeTag)) {
      setActiveTag(availableTags[0]);
    }
  }, [activeTag, availableTags]);

  const stageSize = useMemo(() => {
    if (!workspaceSize.width || !workspaceSize.height || !naturalSize.width || !naturalSize.height) {
      return { width: 0, height: 0 };
    }

    const scale = Math.min(
      workspaceSize.width / naturalSize.width,
      workspaceSize.height / naturalSize.height,
    );

    return {
      width: Math.max(1, Math.round(naturalSize.width * scale)),
      height: Math.max(1, Math.round(naturalSize.height * scale)),
    };
  }, [naturalSize.height, naturalSize.width, workspaceSize.height, workspaceSize.width]);

  const sceneWidth = stageSize.width || workspaceSize.width || 1;
  const sceneHeight = stageSize.height || workspaceSize.height || 1;
  const hasScene = Boolean(workspaceSize.width && workspaceSize.height);

  useEffect(() => {
    if (!sceneWidth || !sceneHeight || !workspaceSize.width || !workspaceSize.height) {
      return;
    }

    setViewport(
      buildInitialViewport(
        workspaceSize.width,
        workspaceSize.height,
        sceneWidth,
        sceneHeight,
      ),
    );
  }, [sceneHeight, sceneWidth, workspaceSize.height, workspaceSize.width]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (saveState !== "saving" && !draftLineRef.current.length) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveState]);

  async function persistChangedLabels(previous: SegmentationMap, next: SegmentationMap) {
    const changedLabels = collectChangedLabels(previous, next);
    if (!changedLabels.length) {
      return;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    setSaveState("saving");
    setError("");

    try {
      for (const label of changedLabels) {
        const lines = next[label] ?? [];
        if (!lines.length) {
          await removeSegmentation(imageId, label);
          continue;
        }

        await saveSegmentation(imageId, label, lines);
      }

      if (saveRequestIdRef.current === requestId) {
        setSaveState("saved");
        setLastSavedAt(new Date());
      }
    } catch (err) {
      if (saveRequestIdRef.current === requestId) {
        setSaveState("error");
        setError("Не удалось сохранить разметку");
      }
    }
  }

  function commitSegmentations(nextSegmentations: SegmentationMap) {
    const previous = cloneSegmentations(segmentations);
    const next = cloneSegmentations(nextSegmentations);

    setHistoryStack((currentHistory) => [...currentHistory.slice(-39), previous]);
    setRedoStack([]);
    setSegmentations(next);
    void persistChangedLabels(previous, next);
  }

  function handleUndo() {
    const previous = historyStack.at(-1);
    if (!previous) {
      return;
    }

    const current = cloneSegmentations(segmentations);
    const next = cloneSegmentations(previous);

    setHistoryStack((items) => items.slice(0, -1));
    setRedoStack((items) => [current, ...items].slice(0, 40));
    setSegmentations(next);
    setDraftLine([]);
    void persistChangedLabels(current, next);
  }

  function handleRedo() {
    const nextSnapshot = redoStack[0];
    if (!nextSnapshot) {
      return;
    }

    const current = cloneSegmentations(segmentations);
    const next = cloneSegmentations(nextSnapshot);

    setRedoStack((items) => items.slice(1));
    setHistoryStack((items) => [...items.slice(-39), current]);
    setSegmentations(next);
    setDraftLine([]);
    void persistChangedLabels(current, next);
  }

  function resetViewport() {
    if (!sceneWidth || !sceneHeight || !workspaceSize.width || !workspaceSize.height) {
      return;
    }

    setViewport(
      buildInitialViewport(
        workspaceSize.width,
        workspaceSize.height,
        sceneWidth,
        sceneHeight,
      ),
    );
  }

  function screenToScene(clientX: number, clientY: number, view = viewportRef.current) {
    const workspace = workspaceRef.current;
    if (!workspace || !sceneWidth || !sceneHeight) {
      return null;
    }

    const rect = workspace.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    return {
      x: (localX - view.offsetX) / view.zoom,
      y: (localY - view.offsetY) / view.zoom,
      localX,
      localY,
    };
  }

  function screenToNormalizedPoint(clientX: number, clientY: number) {
    const scenePoint = screenToScene(clientX, clientY);
    if (!scenePoint || !sceneWidth || !sceneHeight) {
      return null;
    }

    return {
      x: clamp(scenePoint.x / sceneWidth, 0, 1),
      y: clamp(scenePoint.y / sceneHeight, 0, 1),
    };
  }

  function shouldDrawPointer(pointerType: string) {
    if (mode !== "draw") {
      return false;
    }

    return pointerType === "mouse" || pointerType === "pen";
  }

  function startPinchGesture() {
    const touchPoints = Array.from(activeTouchesRef.current.values());
    if (touchPoints.length < 2) {
      return;
    }

    const [firstPoint, secondPoint] = touchPoints;
    const centerX = (firstPoint.x + secondPoint.x) / 2;
    const centerY = (firstPoint.y + secondPoint.y) / 2;
    const anchor = screenToScene(centerX, centerY);
    if (!anchor) {
      return;
    }

    gestureRef.current = {
      kind: "pinch",
      startDistance: Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y),
      startZoom: viewportRef.current.zoom,
      anchorSceneX: anchor.x,
      anchorSceneY: anchor.y,
    };
  }

  function pushDraftPoint(point: Point) {
    setDraftLine((currentLine) => {
      const lastPoint = currentLine.at(-1);
      if (lastPoint && distanceBetweenPoints(lastPoint, point) < DRAW_DISTANCE_THRESHOLD) {
        return currentLine;
      }

      return [...currentLine, point];
    });
  }

  function finalizeDraftLine() {
    if (!activeTag || draftLineRef.current.length < 2) {
      setDraftLine([]);
      return;
    }

    const nextSegmentations = cloneSegmentations(segmentations);
    nextSegmentations[activeTag] = [...(nextSegmentations[activeTag] ?? []), draftLineRef.current];
    setDraftLine([]);
    commitSegmentations(nextSegmentations);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!sceneWidth || !sceneHeight) {
      return;
    }

    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    const pointerType = event.pointerType;
    if (pointerType === "mouse" && (event.button === 1 || event.button === 2)) {
      event.preventDefault();
      gestureRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: viewportRef.current.offsetX,
        startOffsetY: viewportRef.current.offsetY,
      };
      try {
        workspace.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore pointer capture failures
      }
      return;
    }

    if (pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (pointerType === "touch") {
      if (gestureRef.current?.kind === "draw") {
        return;
      }

      activeTouchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouchesRef.current.size >= 2) {
        gestureRef.current = null;
        startPinchGesture();
      } else {
        gestureRef.current = {
          kind: "pan",
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startOffsetX: viewportRef.current.offsetX,
          startOffsetY: viewportRef.current.offsetY,
        };
      }
      return;
    }

    if (shouldDrawPointer(pointerType)) {
      if (!activeTag) {
        return;
      }

      const nextPoint = screenToNormalizedPoint(event.clientX, event.clientY);
      if (!nextPoint) {
        return;
      }

      gestureRef.current = {
        kind: "draw",
        pointerId: event.pointerId,
      };
      setDraftLine([nextPoint]);
      try {
        workspace.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore pointer capture failures
      }
      return;
    }

    if (mode === "erase" && (pointerType === "mouse" || pointerType === "pen")) {
      const nextPoint = screenToNormalizedPoint(event.clientX, event.clientY);
      if (!nextPoint) {
        return;
      }

      const eraseLabels = showAllTags
        ? [activeTag, ...availableTags.filter((tag) => tag !== activeTag)]
        : activeTag
          ? [activeTag]
          : [];

      const target = findEraseTarget(
        segmentations,
        eraseLabels,
        nextPoint,
        sceneWidth,
        sceneHeight,
        Math.max(14, strokeWidth * 3),
      );
      if (!target) {
        return;
      }

      const nextSegmentations = cloneSegmentations(segmentations);
      nextSegmentations[target.label] = (nextSegmentations[target.label] ?? []).filter(
        (_, index) => index !== target.lineIndex,
      );
      if (!nextSegmentations[target.label].length) {
        delete nextSegmentations[target.label];
      }
      commitSegmentations(nextSegmentations);
      return;
    }

    gestureRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: viewportRef.current.offsetX,
      startOffsetY: viewportRef.current.offsetY,
    };
    try {
      workspace.setPointerCapture(event.pointerId);
    } catch (error) {
      // ignore pointer capture failures
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }

    if (event.pointerType === "touch") {
      if (activeTouchesRef.current.has(event.pointerId)) {
        activeTouchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (gesture.kind === "pinch") {
        const touchPoints = Array.from(activeTouchesRef.current.values());
        if (touchPoints.length < 2) {
          return;
        }

        const [firstPoint, secondPoint] = touchPoints;
        const centerX = (firstPoint.x + secondPoint.x) / 2;
        const centerY = (firstPoint.y + secondPoint.y) / 2;
        const distance = Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
        const nextZoom = clamp(
          gesture.startZoom * (distance / Math.max(gesture.startDistance, 1)),
          MIN_ZOOM,
          MAX_ZOOM,
        );

        const workspace = workspaceRef.current;
        if (!workspace) {
          return;
        }

        const rect = workspace.getBoundingClientRect();
        const localCenterX = centerX - rect.left;
        const localCenterY = centerY - rect.top;

        setViewport({
          zoom: nextZoom,
          offsetX: localCenterX - gesture.anchorSceneX * nextZoom,
          offsetY: localCenterY - gesture.anchorSceneY * nextZoom,
        });
        return;
      }

      if (gesture.kind === "pan" && gesture.pointerId === event.pointerId) {
        setViewport({
          zoom: viewportRef.current.zoom,
          offsetX: gesture.startOffsetX + (event.clientX - gesture.startClientX),
          offsetY: gesture.startOffsetY + (event.clientY - gesture.startClientY),
        });
      }
      return;
    }

    if (gesture.kind === "draw" && gesture.pointerId === event.pointerId) {
      const nextPoint = screenToNormalizedPoint(event.clientX, event.clientY);
      if (!nextPoint) {
        return;
      }

      pushDraftPoint(nextPoint);
      return;
    }

    if (gesture.kind === "pan" && gesture.pointerId === event.pointerId) {
      setViewport({
        zoom: viewportRef.current.zoom,
        offsetX: gesture.startOffsetX + (event.clientX - gesture.startClientX),
        offsetY: gesture.startOffsetY + (event.clientY - gesture.startClientY),
      });
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const workspace = workspaceRef.current;
    if (workspace) {
      try {
        workspace.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore pointer capture failures
      }
    }

    if (event.pointerType === "touch") {
      activeTouchesRef.current.delete(event.pointerId);
      if (activeTouchesRef.current.size >= 2) {
        startPinchGesture();
        return;
      }

      gestureRef.current = null;
      return;
    }

    if (gestureRef.current?.kind === "draw" && gestureRef.current.pointerId === event.pointerId) {
      finalizeDraftLine();
    }

    gestureRef.current = null;
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") {
      activeTouchesRef.current.delete(event.pointerId);
    }

    if (gestureRef.current?.kind === "draw" && gestureRef.current.pointerId === event.pointerId) {
      setDraftLine([]);
    }

    gestureRef.current = null;
  }

  function cycleStrokeWidth() {
    setStrokeWidth((currentValue) => {
      const currentIndex = STROKE_WIDTH_OPTIONS.indexOf(currentValue);
      const nextIndex = currentIndex >= 0
        ? (currentIndex + 1) % STROKE_WIDTH_OPTIONS.length
        : 0;
      return STROKE_WIDTH_OPTIONS[nextIndex];
    });
  }

  async function toggleFocusMode() {
    const focusFrame = focusFrameRef.current;
    if (!focusFrame) {
      return;
    }

    if (document.fullscreenElement === focusFrame) {
      await document.exitFullscreen();
      return;
    }

    await focusFrame.requestFullscreen();
  }

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !editor) {
      return;
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();

      const scenePoint = screenToScene(event.clientX, event.clientY);
      if (!scenePoint) {
        return;
      }

      const direction = event.deltaY > 0 ? 0.92 : 1.08;
      const nextZoom = clamp(viewportRef.current.zoom * direction, MIN_ZOOM, MAX_ZOOM);

      setViewport({
        zoom: nextZoom,
        offsetX: scenePoint.localX - scenePoint.x * nextZoom,
        offsetY: scenePoint.localY - scenePoint.y * nextZoom,
      });
    }

    workspace.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      workspace.removeEventListener("wheel", handleWheel);
    };
  }, [editor, sceneHeight, sceneWidth]);

  if (loading) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Editor</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Подготавливаем рабочее пространство разметки</h1>
      </section>
    );
  }

  if (error && !editor) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Ошибка</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Не удалось открыть editor</h1>
        <p className="mt-3 text-sm text-slate-600">{error}</p>
      </section>
    );
  }

  if (!editor) {
    return null;
  }

  return (
    <div
      ref={focusFrameRef}
      className={isFocusMode ? "h-full overflow-hidden bg-[linear-gradient(180deg,_#dfe7f3,_#edf2f8)] p-4 sm:p-5" : ""}
    >
      <main className={isFocusMode ? "flex h-full flex-col gap-4" : "space-y-5"}>
      <section className={`panel z-20 px-5 py-4 sm:px-6 ${isFocusMode ? "shrink-0" : "sticky top-28"}`}>
        <div className="flex flex-col gap-3">
          {!isFocusMode ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Wrinkles Editor</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                  {editor.image.name}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/image/${editor.image.id}`}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                >
                  К карточке
                </Link>
                {editor.prev_id ? (
                  <Link
                    to={`/image/${editor.prev_id}/editor`}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                  >
                    ← Предыдущее
                  </Link>
                ) : null}
                {editor.next_id ? (
                  <Link
                    to={`/image/${editor.next_id}/editor`}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                  >
                    Следующее →
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-1 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("draw")}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  mode === "draw"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink"
                }`}
              >
                Рисование
              </button>
              <button
                type="button"
                onClick={() => setMode("navigate")}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  mode === "navigate"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink"
                }`}
              >
                Навигация
              </button>
              <button
                type="button"
                onClick={() => setShowAllTags((value) => !value)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  showAllTags
                    ? "bg-sky-500 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink"
                }`}
              >
                {showAllTags ? "Показываем все теги" : "Только активный тег"}
              </button>
              <button
                type="button"
                onClick={resetViewport}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
              >
                Сбросить масштаб
              </button>
            </div>

            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!historyStack.length}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!redoStack.length}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Redo
              </button>
              <div
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  saveState === "error"
                    ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200"
                    : saveState === "saving"
                      ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                      : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                }`}
              >
                {formatSaveStatus(saveState, lastSavedAt)}
              </div>
              {isFocusMode ? (
                <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Esc для выхода
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      ) : null}

      <section className={isFocusMode ? "min-h-0 flex-1" : ""}>
        <div className={`panel p-4 sm:p-5 ${isFocusMode ? "h-full min-h-0" : ""}`}>
          <div
            ref={workspaceRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onMouseDown={(event) => {
              if (event.button === 1 || event.button === 2) {
                event.preventDefault();
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
              }
            }}
            onContextMenu={(event) => event.preventDefault()}
            className={`group relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_35%),linear-gradient(180deg,_#09111f,_#101c2c)] touch-none ${
              isFocusMode ? "h-full min-h-[520px]" : "h-[68vh]"
            }`}
          >
            <div className="absolute right-4 top-4 z-20 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setMode((currentMode) => currentMode === "erase" ? "draw" : "erase")}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onAuxClick={(event) => {
                  event.stopPropagation();
                }}
                aria-label={mode === "erase" ? "Выключить ластик" : "Включить ластик"}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
                  mode === "erase"
                    ? "border-rose-200 bg-rose-500 shadow-soft hover:scale-105"
                    : "border-white/15 bg-slate-950/60 backdrop-blur hover:scale-110"
                }`}
              >
                <img
                  src="/icon-eraser.png"
                  alt=""
                  className={`h-5 w-5 object-contain transition duration-200 ${
                    mode === "erase"
                      ? "brightness-0 invert"
                      : "invert brightness-0 saturate-0 contrast-200"
                  } group-hover:scale-110`}
                />
              </button>

              <button
                type="button"
                onClick={cycleStrokeWidth}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onAuxClick={(event) => {
                  event.stopPropagation();
                }}
                title={`Толщина линии: ${strokeWidthLabel(strokeWidth)}`}
                aria-label={`Толщина линии: ${strokeWidthLabel(strokeWidth)}`}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-slate-950/60 text-white backdrop-blur transition hover:scale-110"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <span className="block w-5 rounded-full bg-white/95" style={{ height: "2px" }} />
                  <span className="block w-5 rounded-full bg-white/95" style={{ height: "3px" }} />
                  <span className="block w-5 rounded-full bg-white/95" style={{ height: "4px" }} />
                </div>
              </button>

              <button
                type="button"
                onClick={() => void toggleFocusMode()}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onAuxClick={(event) => {
                  event.stopPropagation();
                }}
                aria-label={isFocusMode ? "Выйти из фокус-режима" : "Включить фокус-режим"}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
                  isFocusMode
                    ? "border-white/15 bg-white/90 shadow-soft hover:scale-105"
                    : "border-white/15 bg-slate-950/60 backdrop-blur hover:scale-110"
                }`}
              >
                <img
                  src="/icon-screen.png"
                  alt=""
                  className={`h-5 w-5 object-contain transition duration-200 ${
                    isFocusMode
                      ? "invert-0"
                      : "invert brightness-0 saturate-0 contrast-200"
                  } group-hover:scale-110`}
                />
              </button>
            </div>

            {hasScene ? (
              <div
                className="absolute left-0 top-0 select-none"
                style={{
                  width: `${sceneWidth}px`,
                  height: `${sceneHeight}px`,
                  transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <img
                  src={editor.image.file_path}
                  alt={editor.image.name}
                  draggable={false}
                  loading="eager"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setNaturalSize({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }}
                  onError={() => {
                    setError("Не удалось загрузить изображение для разметки");
                  }}
                  className="pointer-events-none block h-full w-full rounded-[24px] object-contain shadow-[0_24px_80px_rgba(2,6,23,0.42)]"
                />

                <svg
                  viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
                  className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                  fill="none"
                >
                  {availableTags.map((tag) => {
                    if (!showAllTags && tag !== activeTag) {
                      return null;
                    }

                    const lines = segmentations[tag] ?? [];
                    const color = colorForTag(tag);
                    const isActive = tag === activeTag;

                    return lines.map((line, index) => (
                      <polyline
                        key={`${tag}-${index}`}
                        points={pointsToPolyline(line, sceneWidth, sceneHeight)}
                        stroke={color}
                        strokeWidth={isActive ? strokeWidth : Math.max(2, strokeWidth - 1)}
                        strokeOpacity={isActive ? 0.95 : 0.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ));
                  })}

                  {activeTag && draftLine.length > 1 ? (
                    <polyline
                      points={pointsToPolyline(draftLine, sceneWidth, sceneHeight)}
                      stroke={colorForTag(activeTag)}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </svg>
              </div>
            ) : (
              <div className="absolute inset-0 animate-pulse rounded-[28px] bg-white/10" />
            )}

            <div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-medium text-white backdrop-blur">
              {mode === "draw"
                ? "Режим: рисование"
                : mode === "erase"
                  ? "Режим: ластик"
                  : "Режим: навигация"}
            </div>

            {activeTag ? (
              <div className="absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-slate-950/65 px-3 py-2 text-sm font-semibold text-slate-100 backdrop-blur">
                Активный тег: {activeTag}
              </div>
            ) : (
              <div className="absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-slate-950/65 px-3 py-2 text-sm font-medium text-slate-100 backdrop-blur">
                Нет тегов для разметки
              </div>
            )}

            <div className="absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-slate-950/65 px-3 py-2 text-xs font-semibold text-slate-100 backdrop-blur">
              Масштаб: {(viewport.zoom * 100).toFixed(0)}%
            </div>
          </div>
        </div>

      </section>

      <section
        className={
          isFocusMode
            ? "fixed bottom-4 left-4 right-4 z-20 rounded-[28px] border border-white/70 bg-white/92 px-4 py-3 shadow-panel backdrop-blur sm:left-5 sm:right-5 sm:px-5"
            : "panel px-4 py-4 sm:px-5"
        }
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Слои</p>
        </div>

        <div className="mt-2 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {availableTags.map((tag) => {
              const selected = tag === activeTag;

              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag(tag)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl px-4 py-2 text-left text-sm font-semibold transition ${
                    selected
                      ? "bg-slate-950 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-ink"
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: colorForTag(tag) }}
                  />
                  <span className="whitespace-nowrap">{tag}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? "bg-white/15" : "bg-slate-100 text-slate-500"}`}>
                    {countTagLines(segmentations, tag)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </main>
    </div>
  );
}
