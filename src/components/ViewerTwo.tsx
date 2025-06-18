import React, { useCallback, useEffect, useMemo } from "react";
import styles from "./Viewer.module.css";
import type { ImageSource, Point, Rectangle } from "../types";
import { useDrag as useDragEvents } from "../hooks/useDragEvents";
import {
  type DrawMessage,
  type DrawResult,
  type IncomingMesssage,
} from "../workers/Worker";

const DRAW_MARGIN_PX = 100;

const localWorker = () => {
  class AsyncQueue<T> {
    private queue: T[];
    private resolvers: ((value: T) => void)[];

    constructor() {
      this.queue = [];
      this.resolvers = [];
    }

    public enqueue(item: T) {
      if (this.resolvers.length > 0) {
        const resolver = this.resolvers.shift()!;
        resolver(item);
      } else {
        this.queue.push(item);
      }
    }

    public dequeue(): Promise<T> {
      if (this.queue.length > 0) {
        return Promise.resolve(this.queue.shift()!);
      }
      return new Promise<T>((resolve) => this.resolvers.push(resolve));
    }

    public get items() {
      return this.queue;
    }
  }

  const MAX_IMAGE_AGE_MS = 250;
  const queue = new AsyncQueue<IncomingMesssage>();
  let isProcessingMessages = false;
  let currentRunId: string = "";
  let lastDrawResult: DrawResult | null = null;

  const cancelCurrentDraw = () => {
    currentRunId = "";
  };

  const getDarkColor = (x: number, y: number, maxX: number, maxY: number) => {
    const xFraction = x / maxX;
    const yFraction = y / maxY;

    return `rgb(${Math.floor(50 + xFraction * 205)}, ${Math.floor(
      50 + yFraction * 205
    )}, ${Math.floor(50 + ((xFraction + yFraction) / 2) * 205)})`;
  };

  const yieldToIncomingMessages = async () =>
    await new Promise((resolve) => setTimeout(resolve, 0));

  const isCurrentRunCancelled = async (runId: string) => {
    await yieldToIncomingMessages();
    return currentRunId !== runId;
  };

  const simulateHeavyComputation = async (
    durationMs: number,
    myRunId: string
  ) => {
    const startTime = performance.now();

    // This loop will run continuously for the specified duration
    while (performance.now() - startTime < durationMs) {
      // Prime number calculation
      for (let i = 0; i < 1000; i++) {
        let isPrime = true;
        const num = Math.floor(Math.random() * 100000) + 10000;

        for (let j = 2; j <= Math.sqrt(num); j++) {
          if (num % j === 0) {
            isPrime = false;
            break;
          }
        }

        // Force JavaScript to actually compute this by using the result
        if (isPrime) {
          // Create and manipulate large arrays to consume memory and CPU
          const arr = new Array(1000).fill(0).map(() => Math.random());
          arr.sort();
        }
      }

      // Check if cancelled
      if (await isCurrentRunCancelled(myRunId)) {
        return;
      }
    }
  };

  const draw = async (
    imageDimensions: { width: number; height: number },
    viewport: Rectangle
  ) => {
    const myRunId = Math.random().toString(36).substring(2, 15);
    currentRunId = myRunId;

    // Artificially delay the draw to simulate a long-running operation
    await simulateHeavyComputation(100, myRunId);

    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d", {
      desynchronized: true,
      willReadFrequently: false,
    });
    if (!ctx) return;

    const tileSize = 40;
    const startY = viewport.y - (viewport.y % tileSize);
    const startX = viewport.x - (viewport.x % tileSize);

    ctx.translate(-viewport.x, -viewport.y);
    for (let y = startY; y < viewport.y + viewport.height; y += tileSize) {
      for (let x = startX; x < viewport.x + viewport.width; x += tileSize) {
        const isDark = Math.floor(x / tileSize + y / tileSize) % 2 === 0;
        ctx.fillStyle = isDark
          ? getDarkColor(x, y, imageDimensions.width, imageDimensions.height)
          : "#ffffff";
        ctx.fillRect(x, y, tileSize, tileSize);
      }

      // Yield control to allow processing of incoming messages
      if (await isCurrentRunCancelled(myRunId)) {
        return;
      }
    }
    ctx.fillStyle = "#222288";
    ctx.fillRect(
      imageDimensions.width / 2 - 50,
      imageDimensions.height / 2 - 50,
      100,
      100
    );
    ctx.resetTransform();

    const bitmap = canvas.transferToImageBitmap();
    lastDrawResult = {
      action: "drawComplete",
      runId: myRunId,
      timestamp: Date.now(),
      viewport: viewport,
      bitmap: bitmap,
    };
    workkeri.onmessage(lastDrawResult);
    currentRunId = currentRunId == myRunId ? "" : currentRunId;
  };

  const handleDrawMessage = async (message: DrawMessage) => {
    // Only handle the most recent draw request
    if (queue.items.some((msg) => msg.action === "draw")) {
      return;
    }

    const { imageDimensions, viewport } = message;
    await draw(imageDimensions, viewport);
  };

  const handleQueueMessage = async (message: IncomingMesssage) => {
    switch (message.action) {
      case "draw":
        return handleDrawMessage(message as DrawMessage);
      default:
        console.warn("Unknown action:", message.action);
        return;
    }
  };

  let queueProcessingStarted = 0;
  const processQueue = async () => {
    isProcessingMessages = true;
    queueProcessingStarted = Date.now();
    try {
      while (queue.items.length > 0) {
        const message = await queue.dequeue();
        await handleQueueMessage(message);
        await yieldToIncomingMessages();
      }
    } catch (error) {
      console.error("Error processing worker message:", error);
    } finally {
      isProcessingMessages = false;
      queueProcessingStarted = 0;
    }
  };


  const queueMessage = async (data: IncomingMesssage) => {
    if (!data?.action) {
      return;
    }

    // Process cancellations immediately
    const now = Date.now();
    const cancelByNewDrawRequest =
      data.action === "draw" &&
      (now - queueProcessingStarted < MAX_IMAGE_AGE_MS ||
        (lastDrawResult && now < lastDrawResult.timestamp + MAX_IMAGE_AGE_MS));

    const shouldCancel = cancelByNewDrawRequest || data.action === "cancel";
    if (shouldCancel) {
      cancelCurrentDraw();
    }

    // Queue the messages for further processing
    const shouldQueue = data.action !== "cancel";
    if (shouldQueue) {
      queue.enqueue(data);
      if (!isProcessingMessages) {
        await processQueue();
      }
    }
  };

  const workkeri = {
    queueMessage,
    onmessage: (result: DrawResult) => {  console.log("NO OP ONMESSAGE", result); },
  }

  return workkeri;
};

const workkeri = localWorker();

type VieweTwoProps = {
  width: number;
  height: number;
  image: ImageSource;
  onFetchData: (area: Rectangle) => Promise<void>;
};

export const ViewerTwo: React.FC<VieweTwoProps> = ({
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

  workkeri.onmessage = (result: DrawResult) => {
    if (drawResultRef.current) {
      console.log(
        "Got updated bitmap from worker",
        result.timestamp - drawResultRef.current.timestamp
      );
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

  const requestDraw = useCallback(() => {
    const requestedViewportWidth = width + 2 * DRAW_MARGIN_PX;
    const requestedViewportHeight = height + 2 * DRAW_MARGIN_PX;

    workkeri.queueMessage({
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
    });
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
