import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

type PanOrigin = { x: number; y: number; left: number; top: number };

export function useCanvasPan(canvasRef: RefObject<HTMLDivElement | null>, spaceDown: boolean) {
  const panOrigin = useRef<PanOrigin | null>(null);

  function startCanvasGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!spaceDown && event.button !== 1) return;
    panOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveCanvasGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const canvas = canvasRef.current;
    const origin = panOrigin.current;
    if (!canvas || !origin) return;
    canvas.scrollLeft = origin.left - event.clientX + origin.x;
    canvas.scrollTop = origin.top - event.clientY + origin.y;
  }

  function endCanvasGesture() {
    panOrigin.current = null;
  }

  return { startCanvasGesture, moveCanvasGesture, endCanvasGesture };
}
