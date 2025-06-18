import { useState, useRef, useCallback } from "react";
import type { MouseEvent } from "react";
import type { Point } from "../types";

interface UseDragOptions {
  onDrag?: (delta: Point) => void;
  onDragEnd?: (delta: Point) => void;
}

interface UseDragResult {
  isDragging: boolean;
  dragHandlers: {
    onMouseDown: (e: MouseEvent) => void;
    onMouseMove: (e: MouseEvent) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
  };
}

export const useDrag = (options: UseDragOptions = {}): UseDragResult => {
  const { onDrag, onDragEnd } = options;

  const [isDragging, setIsDragging] = useState(false);
  const dragLastPositionRef = useRef<Point>({ x: 0, y: 0 });
  const totalDragDeltaRef = useRef<Point>({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: MouseEvent) => {
    setIsDragging(true);
    totalDragDeltaRef.current = { x: 0, y: 0 };
    dragLastPositionRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const currentDragDelta = {
        x: Math.round(dragLastPositionRef.current.x - e.clientX),
        y: Math.round(dragLastPositionRef.current.y - e.clientY),
      };

      dragLastPositionRef.current = { x: e.clientX, y: e.clientY };

      totalDragDeltaRef.current = {
        x: totalDragDeltaRef.current.x + currentDragDelta.x,
        y: totalDragDeltaRef.current.y + currentDragDelta.y,
      };

      onDrag?.(currentDragDelta);
      e.preventDefault();
    },
    [isDragging, onDrag]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);
    onDragEnd?.(totalDragDeltaRef.current);
  }, [isDragging, onDragEnd]);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return {
    isDragging,
    dragHandlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
    },
  };
};
