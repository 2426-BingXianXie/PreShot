import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { computePreviewPath } from "./physics/preview";
import { simulateShot } from "./physics/simulateShot";
import {
  type Ball,
  type BallKind,
  cloneBalls,
  createInitialBalls,
  pushSnapshot,
  restoreLastSnapshot,
  clampBallPositionNoOverlap,
} from "./game/state";
import {
  clearSavedPracticeLayout,
  loadSavedPracticeLayout,
  savePracticeLayout,
} from "./game/layoutStorage";
import {
  countRemaining,
  createInitialMatchState,
  legalTargetKindsForPlayer,
  resolveMatchTurn,
} from "./game/rules";

type Mode = "match" | "practice";
type Opponent = "hotseat" | "ai";
type AiStyle = "attack" | "balanced" | "safety";
type DragState = { ballId: string; offsetX: number; offsetY: number } | null;
type TableToastKind = "info" | "foul" | "bih" | "win";
type EventFeedItem = { id: number; text: string; kind: TableToastKind; time: number };
type BannerAnchor = { leftPct: number };
const EVENT_ICON_BY_KIND: Record<TableToastKind, string> = {
  info: "●",
  foul: "⚠",
  bih: "✋",
  win: "★",
};
const CUE_PAD_RADIUS = 24;
const ZOOM_CUE_PAD_RADIUS = 92;
const POWER_MIN = 0.1;
const POWER_MAX = 1;
const POWER_UI_MAX = 75;
const POWER_RELEASE_ARM_PX = 14;
const POWER_MIN_SHOT = 0.18;

const TABLE = { width: 980, height: 500, cushionInset: 24, pocketRadius: 20, ballRadius: 12 };
const TABLE_GRID_COLS = 8;
const TABLE_GRID_ROWS = 4;
const POCKETS = [
  { x: TABLE.cushionInset, y: TABLE.cushionInset },
  { x: TABLE.width / 2, y: TABLE.cushionInset },
  { x: TABLE.width - TABLE.cushionInset, y: TABLE.cushionInset },
  { x: TABLE.cushionInset, y: TABLE.height - TABLE.cushionInset },
  { x: TABLE.width / 2, y: TABLE.height - TABLE.cushionInset },
  { x: TABLE.width - TABLE.cushionInset, y: TABLE.height - TABLE.cushionInset },
];
const BALL_COLOR_BY_NUMBER: Record<number, string> = {
  1: "#f1d447",
  2: "#305fd0",
  3: "#d64545",
  4: "#7d4bc2",
  5: "#e08b2c",
  6: "#2f9d5f",
  7: "#8f2f2f",
  8: "#121212",
  9: "#f1d447",
  10: "#305fd0",
  11: "#d64545",
  12: "#7d4bc2",
  13: "#e08b2c",
  14: "#2f9d5f",
  15: "#8f2f2f",
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const ballNumber = (ball: Ball): number | null => {
  if (ball.id === "cue") return null;
  const value = Number(ball.id);
  return Number.isFinite(value) ? value : null;
};

const getAutoTargetId = (balls: Ball[], allowedKinds?: BallKind[]): string | null => {
  const cue = balls.find((b) => b.id === "cue");
  if (!cue) return null;
  const candidates = balls.filter(
    (b) => b.id !== "cue" && !b.pocketed && (!allowedKinds || allowedKinds.includes(b.kind)),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => distance(cue, a) - distance(cue, b));
  return candidates[0].id;
};

const getAimTargetId = ({
  cue,
  aimPoint,
  balls,
  allowedKinds,
  ballRadius,
}: {
  cue: Ball;
  aimPoint: { x: number; y: number };
  balls: Ball[];
  allowedKinds?: BallKind[];
  ballRadius: number;
}): string | null => {
  const dx = aimPoint.x - cue.x;
  const dy = aimPoint.y - cue.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return null;
  const ux = dx / mag;
  const uy = dy / mag;

  let bestId: string | null = null;
  let bestAlong = Number.POSITIVE_INFINITY;
  const maxPerp = ballRadius * 1.35;

  for (const ball of balls) {
    if (ball.id === "cue" || ball.pocketed) continue;
    if (allowedKinds && !allowedKinds.includes(ball.kind)) continue;
    const rx = ball.x - cue.x;
    const ry = ball.y - cue.y;
    const along = rx * ux + ry * uy;
    if (along <= 0) continue;
    const perp = Math.abs(rx * uy - ry * ux);
    if (perp > maxPerp) continue;
    if (along < bestAlong) {
      bestAlong = along;
      bestId = ball.id;
    }
  }
  return bestId;
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("practice");
  const [opponent] = useState<Opponent>("hotseat");
  const [aiStyle] = useState<AiStyle>("balanced");
  const [power, setPower] = useState(0.62);
  const [cueOffsetX, setCueOffsetX] = useState(0.1);
  const [cueOffsetY, setCueOffsetY] = useState(0);
  const [balls, setBalls] = useState<Ball[]>(createInitialBalls);
  const [matchState, setMatchState] = useState(createInitialMatchState);
  const [redoStack, setRedoStack] = useState<Ball[][]>([]);
  const [dragState, setDragState] = useState<DragState>(null);
  const [cuePadDragging, setCuePadDragging] = useState(false);
  const [powerStickDragging, setPowerStickDragging] = useState(false);
  const [hitPointZoomOpen, setHitPointZoomOpen] = useState(false);
  const [lastMatchFoul, setLastMatchFoul] = useState(false);
  const [status, setStatus] = useState("Practice mode: drag balls and shoot with the power stick.");
  const [eventFeed, setEventFeed] = useState<EventFeedItem[]>([]);
  const [isAnimatingShot, setIsAnimatingShot] = useState(false);
  const [aimPoint, setAimPoint] = useState<{ x: number; y: number } | null>(null);
  const [aimLocked, setAimLocked] = useState(false);
  const [lockedAimPoint, setLockedAimPoint] = useState<{ x: number; y: number } | null>(null);
  const feedIdRef = useRef(1);
  const powerStickStartYRef = useRef(0);
  const powerStickArmedRef = useRef(false);
  const shotRafRef = useRef<number | null>(null);
  const displayPower = Math.round(((power - POWER_MIN) / (POWER_MAX - POWER_MIN)) * POWER_UI_MAX);

  const pushEvent = useCallback((text: string, kind: TableToastKind) => {
    const id = feedIdRef.current++;
    setEventFeed((prev) => [{ id, text, kind, time: Date.now() }, ...prev].slice(0, 10));
  }, []);

  useEffect(() => {
    const id = feedIdRef.current++;
    setEventFeed([{ id, text: "System ready. Shoot to generate events.", kind: "info", time: Date.now() }]);
  }, []);
  useEffect(
    () => () => {
      if (shotRafRef.current !== null) {
        window.cancelAnimationFrame(shotRafRef.current);
      }
    },
    [],
  );

  const cueBall = balls.find((b) => b.id === "cue");
  const legalKinds = useMemo(
    () =>
      mode === "match"
        ? legalTargetKindsForPlayer(matchState, matchState.currentPlayer, balls)
        : undefined,
    [mode, matchState, balls],
  );
  const activeAimPoint = aimLocked ? lockedAimPoint : aimPoint;

  const aimDirection = useMemo<{ x: number; y: number } | null>(() => {
    if (!cueBall || !activeAimPoint) return null;
    const dx = activeAimPoint.x - cueBall.x;
    const dy = activeAimPoint.y - cueBall.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-6) return null;
    return { x: dx / mag, y: dy / mag };
  }, [cueBall, activeAimPoint]);

  const selectedTargetId = useMemo(() => {
    const cue = balls.find((b) => b.id === "cue" && !b.pocketed);
    if (!cue) return null;
    if (activeAimPoint) {
      const aimed = getAimTargetId({
        cue,
        aimPoint: activeAimPoint,
        balls,
        allowedKinds: legalKinds,
        ballRadius: TABLE.ballRadius,
      });
      if (aimed) return aimed;
    }
    return getAutoTargetId(balls, legalKinds);
  }, [balls, legalKinds, activeAimPoint]);
  const selectedTarget = balls.find((b) => b.id === selectedTargetId && !b.pocketed);

  const preview = useMemo(() => {
    if (!cueBall || !selectedTarget || !aimDirection) return null;
    return computePreviewPath({
      cue: cueBall,
      target: selectedTarget,
      aimDirection,
      power,
      cueOffset: { x: cueOffsetX, y: cueOffsetY },
      table: TABLE,
    });
  }, [cueBall, selectedTarget, aimDirection, power, cueOffsetX, cueOffsetY]);
  const focusPoints = useMemo(
    () => [
      ...(preview?.prePath ?? []),
      ...(preview?.objectPath ?? []),
      ...(preview?.postPath ?? []),
      ...(cueBall ? [{ x: cueBall.x, y: cueBall.y }] : []),
      ...(selectedTarget ? [{ x: selectedTarget.x, y: selectedTarget.y }] : []),
    ],
    [preview, cueBall, selectedTarget],
  );

  const bannerAnchor = useMemo<BannerAnchor>(() => {
    const candidates = [
      { leftPct: 20, point: { x: TABLE.width * 0.2, y: TABLE.height * 0.08 } },
      { leftPct: 50, point: { x: TABLE.width * 0.5, y: TABLE.height * 0.08 } },
      { leftPct: 80, point: { x: TABLE.width * 0.8, y: TABLE.height * 0.08 } },
    ];

    const nearestRouteDistance = (p: { x: number; y: number }) => {
      if (focusPoints.length === 0) return TABLE.width;
      return focusPoints.reduce((min, q) => Math.min(min, distance(p, q)), Number.POSITIVE_INFINITY);
    };

    const best = candidates.reduce((prev, next) =>
      nearestRouteDistance(next.point) > nearestRouteDistance(prev.point) ? next : prev,
    );
    return { leftPct: best.leftPct };
  }, [focusPoints]);
  const aimAssistEditing = powerStickDragging || cuePadDragging;
  const hudDimOpacity = useMemo(() => {
    if (!aimAssistEditing) return 1;
    if (focusPoints.length === 0) return 0.42;
    const bannerPoint = {
      x: (bannerAnchor.leftPct / 100) * TABLE.width,
      y: TABLE.height * 0.08,
    };
    const nearestDistance = (p: { x: number; y: number }) =>
      focusPoints.reduce((min, q) => Math.min(min, distance(p, q)), Number.POSITIVE_INFINITY);
    const congestion = nearestDistance(bannerPoint);
    if (congestion < 90) return 0.2;
    if (congestion < 150) return 0.28;
    if (congestion < 220) return 0.34;
    return 0.42;
  }, [aimAssistEditing, focusPoints, bannerAnchor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, TABLE.width, TABLE.height);

    ctx.fillStyle = "#0e131c";
    ctx.fillRect(0, 0, TABLE.width, TABLE.height);

    ctx.fillStyle = "#1886cc";
    ctx.fillRect(
      TABLE.cushionInset,
      TABLE.cushionInset,
      TABLE.width - TABLE.cushionInset * 2,
      TABLE.height - TABLE.cushionInset * 2,
    );

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i <= TABLE_GRID_COLS; i += 1) {
      const x =
        TABLE.cushionInset +
        ((TABLE.width - TABLE.cushionInset * 2) / TABLE_GRID_COLS) * i;
      ctx.beginPath();
      ctx.moveTo(x, TABLE.cushionInset);
      ctx.lineTo(x, TABLE.height - TABLE.cushionInset);
      ctx.stroke();
    }
    for (let i = 0; i <= TABLE_GRID_ROWS; i += 1) {
      const y =
        TABLE.cushionInset +
        ((TABLE.height - TABLE.cushionInset * 2) / TABLE_GRID_ROWS) * i;
      ctx.beginPath();
      ctx.moveTo(TABLE.cushionInset, y);
      ctx.lineTo(TABLE.width - TABLE.cushionInset, y);
      ctx.stroke();
    }

    for (const pocket of POCKETS) {
      ctx.fillStyle = "#0a0a0a";
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, TABLE.pocketRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw faint aim line extending from cue ball through mouse position
    if (cueBall && aimDirection && !preview) {
      const extLen = Math.max(TABLE.width, TABLE.height);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(cueBall.x, cueBall.y);
      ctx.lineTo(cueBall.x + aimDirection.x * extLen, cueBall.y + aimDirection.y * extLen);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (preview) {
      // Faint aim ray extending past the contact point
      if (cueBall && aimDirection) {
        const extLen = Math.max(TABLE.width, TABLE.height);
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(cueBall.x, cueBall.y);
        ctx.lineTo(cueBall.x + aimDirection.x * extLen, cueBall.y + aimDirection.y * extLen);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Pre-contact path (cue ball to ghost ball / contact point)
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#f2f6fc";
      ctx.beginPath();
      preview.prePath.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Object ball deflection path
      ctx.strokeStyle = "rgba(247, 248, 251, 0.9)";
      ctx.beginPath();
      preview.objectPath.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Post-contact cue ball path (tangent line to stop)
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = cueOffsetX >= 0 ? "rgba(99, 217, 255, 0.95)" : "rgba(255, 128, 138, 0.95)";
      ctx.beginPath();
      preview.postPath.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Stop position marker (small cross at predicted final position)
      if (preview.postPath.length > 1) {
        const stop = preview.postPath[preview.postPath.length - 1];
        ctx.strokeStyle = "rgba(99, 217, 255, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(stop.x - 5, stop.y - 5);
        ctx.lineTo(stop.x + 5, stop.y + 5);
        ctx.moveTo(stop.x + 5, stop.y - 5);
        ctx.lineTo(stop.x - 5, stop.y + 5);
        ctx.stroke();
      }

      // Ghost ball (contact point)
      if (preview.contactPoint) {
        ctx.beginPath();
        ctx.arc(preview.contactPoint.x, preview.contactPoint.y, TABLE.ballRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(220, 236, 255, 0.18)";
        ctx.fill();
        ctx.strokeStyle = "rgba(220, 236, 255, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    balls.forEach((ball) => {
      if (ball.pocketed) return;
      const number = ballNumber(ball);
      const color = number ? BALL_COLOR_BY_NUMBER[number] : "#f8f8f8";

      ctx.beginPath();
      ctx.arc(ball.x, ball.y, TABLE.ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      if (ball.id === "cue") {
        ctx.fillStyle = "#f8f8f8";
        ctx.fill();
      } else if (ball.kind === "stripe") {
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, TABLE.ballRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = TABLE.ballRadius * 1.1;
        ctx.beginPath();
        ctx.moveTo(ball.x - TABLE.ballRadius - 2, ball.y);
        ctx.lineTo(ball.x + TABLE.ballRadius + 2, ball.y);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }

      if (ball.id !== "cue") {
        ctx.strokeStyle = "rgba(0, 0, 0, 0.24)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, TABLE.ballRadius * 0.46, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#111111";
        ctx.font = "700 9px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(number), ball.x, ball.y);
      }

      if (ball.id === selectedTargetId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, TABLE.ballRadius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }, [balls, preview, selectedTargetId, cueOffsetX, cueBall, selectedTarget, aimDirection]);

  const resetLayout = () => {
    if (shotRafRef.current !== null) {
      window.cancelAnimationFrame(shotRafRef.current);
      shotRafRef.current = null;
    }
    setIsAnimatingShot(false);
    setBalls(createInitialBalls());
    setMatchState(createInitialMatchState());
    setRedoStack([]);
    setEventFeed([]);
    setLastMatchFoul(false);
    setStatus(mode === "practice" ? "Practice reset." : "Match reset. Player 1 to shoot.");
  };

  const runShot = useCallback(() => {
    if (isAnimatingShot) return;
    if (!selectedTargetId || !aimDirection) return;
    const targetAtStart = balls.find((b) => b.id === selectedTargetId && !b.pocketed);
    if (!targetAtStart) return;

    if (mode === "practice") {
      setRedoStack((prev) => pushSnapshot(prev, balls));
    }

    const sim = simulateShot({
      balls,
      targetId: selectedTargetId,
      aimDirection,
      power,
      cueOffset: { x: cueOffsetX, y: cueOffsetY },
      table: TABLE,
    });

    setIsAnimatingShot(true);
    setStatus("Shooting...");
    let frameIdx = 0;
    const animate = () => {
      if (frameIdx < sim.frames.length) {
        setBalls(sim.frames[frameIdx]);
        frameIdx += 1;
        shotRafRef.current = window.requestAnimationFrame(animate);
        return;
      }
      shotRafRef.current = null;
      const finalBalls = cloneBalls(sim.finalBalls);
      if (mode === "match" && sim.cueScratch) {
        const cueFinal = finalBalls.find((b) => b.id === "cue");
        if (cueFinal) {
          cueFinal.x = 280;
          cueFinal.y = 255;
          cueFinal.pocketed = false;
          cueFinal.vx = 0;
          cueFinal.vy = 0;
        }
      }

      setIsAnimatingShot(false);
      // Reset hit point and power after each completed shot.
      setCueOffsetX(0);
      setCueOffsetY(0);
      setPower(POWER_MIN);
      setBalls(finalBalls);
      const objectPottedIds = sim.pottedIds.filter((id) => id !== "cue");
      if (mode === "match") {
        const resolved = resolveMatchTurn(matchState, {
          event: {
            targetKind: sim.firstContactKind,
            potted: objectPottedIds.length > 0,
            cueScratch: sim.cueScratch,
            railAfterContact: sim.railAfterContact,
          },
          remaining: countRemaining(finalBalls),
        });
        setMatchState(resolved.state);
        setLastMatchFoul(resolved.foul);
        setStatus(resolved.summary);
        if (resolved.state.phase === "ended") {
          pushEvent(`Player ${resolved.state.winner} wins`, "win");
        } else if (resolved.state.ballInHand) {
          pushEvent("Ball-in-hand", "bih");
        } else if (resolved.foul) {
          pushEvent("Foul", "foul");
        } else {
          pushEvent(
            objectPottedIds.length > 0
              ? `Potted: ${objectPottedIds.join(", ")}`
              : "Shot complete",
            "info",
          );
        }
      } else {
        setLastMatchFoul(false);
        setStatus(
          objectPottedIds.length > 0
            ? `Potted: ${objectPottedIds.join(", ")}. You can redo if needed.`
            : "Shot played. Adjust and retry.",
        );
        pushEvent(
          objectPottedIds.length > 0
            ? `Potted: ${objectPottedIds.join(", ")}`
            : "Practice shot complete",
          "info",
        );
      }
    };
    shotRafRef.current = window.requestAnimationFrame(animate);
  }, [aimDirection, balls, cueOffsetX, cueOffsetY, isAnimatingShot, matchState, mode, power, pushEvent, selectedTargetId]);

  useEffect(() => {
    if (
      mode !== "match" ||
      opponent !== "ai" ||
      isAnimatingShot ||
      matchState.phase === "ended" ||
      matchState.currentPlayer !== 2
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const legal = legalTargetKindsForPlayer(matchState, 2, balls);
      const nextTarget = getAutoTargetId(balls, legal);
      if (!nextTarget) return;
      const cue = balls.find((ball) => ball.id === "cue");
      const targetBall = balls.find((ball) => ball.id === nextTarget && !ball.pocketed);
      if (!cue || !targetBall) return;

      if (matchState.ballInHand) {
        const placementOffsetX = targetBall.x > TABLE.width * 0.5 ? -150 : 150;
        const desired = {
          x: clamp(
            targetBall.x + placementOffsetX,
            TABLE.cushionInset + TABLE.ballRadius,
            TABLE.width - TABLE.cushionInset - TABLE.ballRadius,
          ),
          y: clamp(
            targetBall.y,
            TABLE.cushionInset + TABLE.ballRadius,
            TABLE.height - TABLE.cushionInset - TABLE.ballRadius,
          ),
        };
        const snapped = clampBallPositionNoOverlap({
          ballId: "cue",
          target: desired,
          balls,
          minCenterDistance: TABLE.ballRadius * 2,
        });
        const nextCue = {
          x: clamp(
            snapped.x,
            TABLE.cushionInset + TABLE.ballRadius,
            TABLE.width - TABLE.cushionInset - TABLE.ballRadius,
          ),
          y: clamp(
            snapped.y,
            TABLE.cushionInset + TABLE.ballRadius,
            TABLE.height - TABLE.cushionInset - TABLE.ballRadius,
          ),
        };
        if (distance(cue, nextCue) > 2) {
          setStatus("AI is placing cue ball...");
          setBalls((prev) =>
            prev.map((ball) =>
              ball.id === "cue"
                ? {
                    ...ball,
                    x: nextCue.x,
                    y: nextCue.y,
                    pocketed: false,
                  }
                : ball,
            ),
          );
          return;
        }
      }
      const d = distance(cue, targetBall);
      const styleFactor = aiStyle === "attack" ? 1.08 : aiStyle === "safety" ? 0.78 : 0.95;
      const basePower = clamp(0.24 + d / 760, 0.34, 0.82);
      const tunedPower = clamp(basePower * styleFactor + (Math.random() - 0.5) * 0.06, POWER_MIN, POWER_MAX);
      setPower(tunedPower);
      const sideRange = aiStyle === "attack" ? 0.24 : aiStyle === "safety" ? 0.44 : 0.34;
      setCueOffsetX((Math.random() - 0.5) * sideRange);
      if (aiStyle === "attack") {
        setCueOffsetY(-0.24 + Math.random() * 0.18);
      } else if (aiStyle === "safety") {
        setCueOffsetY(0.18 + Math.random() * 0.34);
      } else {
        setCueOffsetY((Math.random() - 0.2) * 0.22);
      }
      // AI aims directly at the target ball center (full-ball hit).
      setAimPoint({ x: targetBall.x, y: targetBall.y });
      setAimLocked(true);
      setLockedAimPoint({ x: targetBall.x, y: targetBall.y });
      setStatus("AI is taking the shot...");
      window.setTimeout(() => runShot(), 150);
    }, 520 + Math.random() * 260);

    return () => window.clearTimeout(timer);
  }, [mode, opponent, aiStyle, isAnimatingShot, matchState, balls, runShot]);

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isAnimatingShot) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * TABLE.width;
    const py = ((event.clientY - rect.top) / rect.height) * TABLE.height;
    setAimPoint({ x: px, y: py });

    const hit = balls.find(
      (ball) => !ball.pocketed && distance({ x: px, y: py }, ball) <= TABLE.ballRadius + 3,
    );
    const canDragCueInMatch = mode === "match" && matchState.ballInHand && hit?.id === "cue";
    if (hit && (mode === "practice" || canDragCueInMatch)) {
      setDragState({ ballId: hit.id, offsetX: px - hit.x, offsetY: py - hit.y });
      return;
    }
    if (!aimLocked) {
      setAimLocked(true);
      setLockedAimPoint({ x: px, y: py });
      setStatus("Trajectory locked. Click again to unlock.");
    } else {
      setAimLocked(false);
      setLockedAimPoint(null);
      setStatus("Trajectory unlocked. Move mouse to aim.");
    }
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isAnimatingShot) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * TABLE.width;
    const py = ((event.clientY - rect.top) / rect.height) * TABLE.height;
    if (!aimLocked) {
      setAimPoint({ x: px, y: py });
    }
    if (!dragState) return;
    if (mode !== "practice" && !(mode === "match" && matchState.ballInHand && dragState.ballId === "cue")) {
      return;
    }
    const dragX = px - dragState.offsetX;
    const dragY = py - dragState.offsetY;
    const snapped = clampBallPositionNoOverlap({
      ballId: dragState.ballId,
      target: { x: dragX, y: dragY },
      balls,
      minCenterDistance: TABLE.ballRadius * 2,
    });

    setBalls((prev) =>
      prev.map((ball) =>
        ball.id === dragState.ballId
          ? {
              ...ball,
              x: clamp(
                snapped.x,
                TABLE.cushionInset + TABLE.ballRadius,
                TABLE.width - TABLE.cushionInset - TABLE.ballRadius,
              ),
              y: clamp(
                snapped.y,
                TABLE.cushionInset + TABLE.ballRadius,
                TABLE.height - TABLE.cushionInset - TABLE.ballRadius,
              ),
            }
          : ball,
      ),
    );
  };

  const onCanvasPointerUp = () => setDragState(null);

  const handleRedo = () => {
    const restored = restoreLastSnapshot(redoStack, balls);
    setBalls(restored.balls);
    setRedoStack(restored.stack);
    setStatus("Practice state restored.");
  };

  const handleSaveLayout = () => {
    if (mode !== "practice") return;
    savePracticeLayout(window.localStorage, balls);
    setStatus("Practice layout saved.");
  };

  const handleLoadLayout = () => {
    if (mode !== "practice") return;
    const loaded = loadSavedPracticeLayout(window.localStorage);
    if (!loaded) {
      setStatus("No saved practice layout found.");
      return;
    }
    setBalls(loaded);
    setStatus("Saved practice layout loaded.");
  };

  const handleClearSavedLayout = () => {
    if (mode !== "practice") return;
    clearSavedPracticeLayout(window.localStorage);
    setStatus("Saved practice layout cleared.");
  };
  const handleClearEventFeed = () => {
    setEventFeed([]);
    setStatus("Event feed cleared.");
  };

  const setCueOffsetFromPointer = (event: React.PointerEvent<HTMLDivElement>, radius: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const magnitude = Math.hypot(dx, dy);
    const scale = magnitude > radius ? radius / magnitude : 1;
    const clampedX = dx * scale;
    const clampedY = dy * scale;

    setCueOffsetX(clampedX / radius);
    setCueOffsetY(clampedY / radius);
  };

  const setPowerFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = clamp(event.clientY - rect.top, 0, rect.height);
    const normalized = y / rect.height;
    setPower(POWER_MIN + normalized * (POWER_MAX - POWER_MIN));
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <h1>PreShot Part 1</h1>
        <div className="top-actions">
          <button
            className={mode === "practice" ? "active" : ""}
            onClick={() => {
              setMode("practice");
              setStatus("Practice mode enabled.");
            }}
          >
            Practice
          </button>
          <button
            className={mode === "match" ? "active" : ""}
            onClick={() => {
              setMode("match");
              setStatus("Match mode enabled.");
            }}
          >
            Match
          </button>
          <button onClick={resetLayout}>Reset</button>
        </div>
      </header>

      <main className="layout">
        <section className="table-panel">
          <div className="table-stage">
            <div className="left-widget-column">
              <section className="card power-widget">
                <h2>Power</h2>
                <div className="power-stick-group">
                  <span className="cue-hit-label">{displayPower}</span>
                  <div
                    className="power-stick-control"
                    onPointerDown={(event) => {
                      if (isAnimatingShot) return;
                      setPowerStickDragging(true);
                      powerStickStartYRef.current = event.clientY;
                      powerStickArmedRef.current = false;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setPowerFromPointer(event);
                    }}
                    onPointerMove={(event) => {
                      if (!powerStickDragging) return;
                      if (
                        !powerStickArmedRef.current &&
                        Math.abs(event.clientY - powerStickStartYRef.current) >= POWER_RELEASE_ARM_PX
                      ) {
                        powerStickArmedRef.current = true;
                      }
                      setPowerFromPointer(event);
                    }}
                    onPointerUp={(event) => {
                      const canPlayerShoot =
                        !!selectedTarget &&
                        !isAnimatingShot &&
                        (mode !== "match" ||
                          (matchState.phase !== "ended" &&
                            !(opponent === "ai" && matchState.currentPlayer === 2)));
                      setPowerStickDragging(false);
                      event.currentTarget.releasePointerCapture(event.pointerId);
                      const armedAndValid = powerStickArmedRef.current && power >= POWER_MIN_SHOT;
                      if (canPlayerShoot && armedAndValid) {
                        runShot();
                      } else if (canPlayerShoot) {
                        setStatus("Pull down farther, then release to shoot.");
                      }
                      powerStickArmedRef.current = false;
                    }}
                    onPointerCancel={() => {
                      setPowerStickDragging(false);
                      powerStickArmedRef.current = false;
                    }}
                  >
                    <div className="power-stick-rail">
                      <div
                        className="power-stick-cue"
                        style={{
                          transform: `translateY(${((power - POWER_MIN) / (POWER_MAX - POWER_MIN)) * 98}px)`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>
              <section className="card hitpoint-widget">
                <h2>Hit Point</h2>
                <div className="cue-hit-panel">
                  <div
                    className="cue-ball-pad cue-ball-pad-preview"
                    onClick={() => setHitPointZoomOpen(true)}
                  >
                    <div className="cue-ball-cross cue-ball-cross-v" />
                    <div className="cue-ball-cross cue-ball-cross-h" />
                    <div
                      className="cue-hit-dot"
                      style={{
                        transform: `translate(${cueOffsetX * CUE_PAD_RADIUS}px, ${cueOffsetY * CUE_PAD_RADIUS}px)`,
                      }}
                    />
                  </div>
                  <div className="cue-offset-readout">
                    <span>S: {cueOffsetX.toFixed(2)}</span>
                    <span>T/B: {cueOffsetY.toFixed(2)}</span>
                  </div>
                <div className="hitpoint-hint">Click ball to edit</div>
                </div>
              </section>
            </div>
            <div className="table-canvas-wrap">
              <canvas
                ref={canvasRef}
                width={TABLE.width}
                height={TABLE.height}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerLeave={onCanvasPointerUp}
              />
              {mode === "match" && (
                <div
                  className="table-event-banner"
                  style={{ left: `${bannerAnchor.leftPct}%`, opacity: hudDimOpacity }}
                >
                  {matchState.phase === "ended" ? (
                    <span className="event-win">Game Over - Player {matchState.winner} wins</span>
                  ) : matchState.ballInHand ? (
                    <span className="event-bih">Ball-in-hand: drag cue ball to place it</span>
                  ) : lastMatchFoul ? (
                    <span className="event-foul">Foul committed - turn switched</span>
                  ) : (
                    <span className="event-normal">Normal turn play</span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="status-row">
            <span>{status}</span>
            <span>
              {mode === "match"
                ? matchState.phase === "ended"
                  ? `Winner: Player ${matchState.winner}`
                  : `Turn: Player ${matchState.currentPlayer}`
                : `Redo stack: ${redoStack.length}`}
            </span>
          </div>
          <div className="table-event-feed">
            <div className="table-event-feed-head">
              <div className="table-event-feed-title">Event Feed</div>
              <button className="event-feed-clear-btn" onClick={handleClearEventFeed} disabled={eventFeed.length === 0}>
                Clear
              </button>
            </div>
            {eventFeed.length === 0 ? (
              <div className="table-event-feed-empty">No events yet</div>
            ) : (
              <div className="table-event-feed-list">
                {eventFeed.map((item, index) => (
                  <div
                    className={`table-event-feed-row ${index % 2 === 0 ? "table-event-feed-row-left" : "table-event-feed-row-right"}`}
                    key={item.id}
                  >
                    <div className={`table-event-feed-item table-event-feed-item-${item.kind}`}>
                      <span className="table-event-feed-icon">{EVENT_ICON_BY_KIND[item.kind]}</span>
                      <span>{item.text}</span>
                    </div>
                    <span className="table-event-feed-time">
                      {new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="control-panel">
          <section className="card">
            <h2>Shot Controls</h2>
            <div className="auto-target-note">
              Target is auto-selected in Part 1. AI best-shot recommendation is Part 2.
            </div>
            <div className="auto-target-note">Pull down, then release the power stick to shoot.</div>
            <div className="row-buttons">
              <button
                onClick={handleRedo}
                disabled={isAnimatingShot || mode !== "practice" || redoStack.length === 0}
              >
                Redo
              </button>
            </div>
            <div className="row-buttons practice-layout-buttons">
              <button onClick={handleSaveLayout} disabled={mode !== "practice"}>
                Save Layout
              </button>
              <button onClick={handleLoadLayout} disabled={mode !== "practice"}>
                Load Layout
              </button>
              <button onClick={handleClearSavedLayout} disabled={mode !== "practice"}>
                Clear Save
              </button>
            </div>
          </section>
        </aside>
      </main>
      {hitPointZoomOpen && (
        <div className="hitpoint-zoom-backdrop" onClick={() => setHitPointZoomOpen(false)}>
          <section className="hitpoint-zoom-modal">
            <h2>Hit Point Zoom</h2>
            <div
              className="cue-ball-pad cue-ball-pad-zoom"
              onPointerDown={(event) => {
                event.stopPropagation();
                setCuePadDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                setCueOffsetFromPointer(event, ZOOM_CUE_PAD_RADIUS);
              }}
              onPointerMove={(event) => {
                event.stopPropagation();
                if (!cuePadDragging) return;
                setCueOffsetFromPointer(event, ZOOM_CUE_PAD_RADIUS);
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                setCuePadDragging(false);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => setCuePadDragging(false)}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="cue-ball-cross cue-ball-cross-v" />
              <div className="cue-ball-cross cue-ball-cross-h" />
              <div
                className="cue-hit-dot cue-hit-dot-zoom"
                style={{
                  transform: `translate(${cueOffsetX * ZOOM_CUE_PAD_RADIUS}px, ${cueOffsetY * ZOOM_CUE_PAD_RADIUS}px)`,
                }}
              />
            </div>
            <div className="cue-offset-readout cue-offset-readout-zoom">
              <span>Side: {cueOffsetX.toFixed(3)}</span>
              <span>Top/Back: {cueOffsetY.toFixed(3)}</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
