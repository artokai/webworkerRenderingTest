import React, { useCallback, useEffect, useMemo } from "react";
import styles from "./Viewer.module.css";
import type { ImageSource, Point, Rectangle } from "../types";
import { useDrag as useDragEvents } from "../hooks/useDragEvents";
import { createWebWorker, type DrawResult } from "../workers/Worker";

type ViewerProps = {
  width: number;
  height: number;
  image: ImageSource;
  onFetchData: (area: Rectangle) => Promise<void>;
};

const DRAW_MARGIN_PX = 100;

const Viewer: React.FC<ViewerProps> = ({
  width,
  height,
  image,
  onFetchData,
}) => {
  const centerPointRef = React.useRef<Point>({
    x: Math.round(image.width / 2),
    y: Math.round(image.height / 2),
  });
  const isAnimationPendingRef = React.useRef<boolean>(false);
  const drawResultRef = React.useRef<DrawResult | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const updateCanvas = () => {
    if (isAnimationPendingRef.current) {
      return;
    }
    isAnimationPendingRef.current = true;

    requestAnimationFrame(() => {
      if (!canvasRef.current || !drawResultRef.current) {
        isAnimationPendingRef.current = false;
        return;
      }
      const viewport = drawResultRef.current.viewport;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: false });
      if (!ctx) {
        isAnimationPendingRef.current = false;
        return;
      }

      // Clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Set canvas translation to match the center point
      const centerPoint = centerPointRef.current;
      const viewportCenter = {
        x: viewport.x + viewport.width / 2,
        y: viewport.y + viewport.height / 2,
      };
      ctx.translate(
        viewportCenter.x - centerPoint.x - DRAW_MARGIN_PX,
        viewportCenter.y - centerPoint.y - DRAW_MARGIN_PX
      );
      const bitmap = drawResultRef.current.bitmap;
      ctx.drawImage(bitmap, 0, 0);
      ctx.resetTransform();

      isAnimationPendingRef.current = false;
    });
  };

  const workerRef = React.useRef<Worker | null>(null);
  if (!workerRef.current) {
    workerRef.current = createWebWorker();
    workerRef.current.onmessage = (event) => {
      const result = event.data as DrawResult;

      if (drawResultRef.current) {
        console.log("Got updated bitmap from worker", result.timestamp - drawResultRef.current.timestamp);
      }

      if (
        drawResultRef.current &&
        drawResultRef.current.timestamp > result.timestamp
      ) {
        return;
      }
      drawResultRef.current = result;
      updateCanvas();
    };
  }

  const requestDraw = useCallback(() => {
    if (!workerRef.current) return;

    const requestedViewportWidth = width + 2 * DRAW_MARGIN_PX;
    const requestedViewportHeight = height + 2 * DRAW_MARGIN_PX;

    workerRef.current.postMessage(
      {
        action: "draw",
        imageDimensions: {
          width: image.width,
          height: image.height,
        },
        bufferWidth: DRAW_MARGIN_PX,
        viewport: {
          x: centerPointRef.current.x - requestedViewportWidth / 2,
          y: centerPointRef.current.y - requestedViewportHeight / 2,
          width: requestedViewportWidth,
          height: requestedViewportHeight,
        },
      },
      []
    );
  }, [image, width, height]);

  const handleDrag = useCallback(
    (delta: Point) => {
      const newCenterPoint = {
        x: centerPointRef.current.x + delta.x,
        y: centerPointRef.current.y + delta.y,
      };

      centerPointRef.current = newCenterPoint;
      requestDraw();
      updateCanvas();
    },
    [requestDraw]
  );

  const { isDragging, dragHandlers } = useDragEvents({
    onDrag: handleDrag,
    onDragEnd: (delta) => {
      console.log("Drag end:", delta);
    },
  });

  // Calculate the current viewport area
  const currentArea = useMemo<Rectangle>(() => {
    return {
      x: centerPointRef.current.x,
      y: centerPointRef.current.y,
      width: Math.min(width, image.width),
      height: Math.min(height, image.height),
    };
  }, [width, height, image]);

  const containerStyle = {
    width: `${width}px`,
    height: `${height}px`,
    cursor: isDragging ? "grabbing" : "grab",
  };

  const scrollIntervalRef = React.useRef<number>(0);
  const handleAutoscroll = useCallback(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = 0;
      return;
    }
    
    const scrollSpeed = 1; // Pixels per frame
    scrollIntervalRef.current = setInterval(() => {
      centerPointRef.current.x += scrollSpeed;
      requestDraw();
      updateCanvas();
    }, 10);
  }, [requestDraw]);

  // Fetch initial data on mount
  useEffect(() => {
    onFetchData(currentArea);
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // stop autoscroll on unmount
  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = 0;
      }
    };
  }, []);


  return (
    <>
      <div className={styles.viewer} style={containerStyle} {...dragHandlers}>
        <canvas ref={canvasRef} width={width} height={height}></canvas>
      </div>
      <button type="button" onClick={handleAutoscroll}>
        Autoscroll
      </button>
    </>
  );
};

export default Viewer;
