import type { Rectangle } from "../types";

type CancelMessage = {
  action: "cancel";
};

type DrawMessage = {
  action: "draw";
  imageDimensions: {
    width: number;
    height: number;
  };
  bufferWidth: number;
  viewport: Rectangle;
};

export type DrawResult = {
  action: "drawComplete";
  runId: string;
  timestamp: number;
  viewport: Rectangle;
  bitmap: ImageBitmap;
};

type IncomingMesssage = CancelMessage | DrawMessage;

const workerFunction = () => {
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
    ctx.fillRect(imageDimensions.width / 2 - 50, imageDimensions.height / 2 - 50, 100, 100);
    ctx.resetTransform();

    const bitmap = canvas.transferToImageBitmap();
    lastDrawResult = {
      action: "drawComplete",
      runId: myRunId,
      timestamp: Date.now(),
      viewport: viewport,
      bitmap: bitmap,
    };
    postMessage(lastDrawResult, {
      targetOrigin: "*",
      transfer: [lastDrawResult.bitmap],
    });
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

  self.onmessage = async (event: MessageEvent<IncomingMesssage>) => {
    if (!event?.data?.action) {
      return;
    }

    // Process cancellations immediately
    const now = Date.now();
    const cancelByNewDrawRequest =
      event.data.action === "draw" &&
      (now - queueProcessingStarted < MAX_IMAGE_AGE_MS ||
        (lastDrawResult && now < lastDrawResult.timestamp + MAX_IMAGE_AGE_MS));

    const shouldCancel =
      cancelByNewDrawRequest || event.data.action === "cancel";
    if (shouldCancel) {
      cancelCurrentDraw();
    }

    // Queue the messages for further processing
    const shouldQueue = event.data.action !== "cancel";
    if (shouldQueue) {
      queue.enqueue(event.data);
      if (!isProcessingMessages) {
        await processQueue();
      }
    }
  };
};

// This is not a very good way to do this, but it works for now.
// The problem with this Blob approach is that it requires
// all necessary code to live inside the worker function.
// Better way would be to create a separate js-bundle for the worker
export const createWebWorker = () => {
  const viteDistStuff = `
    var __defProp = Object.defineProperty;
    var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
    var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  `;

  const blob = new Blob([`${viteDistStuff}\n(${workerFunction.toString()})()`], {
    type: "application/javascript",
  });
  const worker = new Worker(URL.createObjectURL(blob));
  return worker;
};
