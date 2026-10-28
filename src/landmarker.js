import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// Keep MediaPipe's runtime assets under Vite's configured base path. This is
// important on GitHub Pages, where the app is hosted below /hand-tracker/.
const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function errorDetails(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  if (value && typeof value === 'object') {
    const attached = value.error;
    const target = value.target || value.currentTarget;
    const details = {
      type: value.type,
      message: value.message,
      filename: value.filename,
      line: value.lineno,
      column: value.colno,
      target: target ? {
        kind: target.constructor?.name,
        url: target.src || target.href || target.currentSrc,
      } : undefined,
      attachedError: attached instanceof Error ? `${attached.name}: ${attached.message}\n${attached.stack || ''}` : attached,
    };
    return JSON.stringify(details, (_key, item) => typeof item === 'function' ? undefined : item);
  }
  return String(value);
}

export async function createHandTracker() {
  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  } catch (error) {
    throw new Error(`MediaPipe WASM runtime could not load from ${WASM_ROOT}. Check network access or a content blocker. ${error?.message || error}`);
  }
  let modelBuffer;
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    modelBuffer = new Uint8Array(await response.arrayBuffer());
    if (!modelBuffer.byteLength) throw new Error('The model download was empty.');
  } catch (error) {
    throw new Error(`Hand model could not download from Google Cloud Storage (${MODEL_URL}). Check network access, VPN/proxy rules, or content blockers. ${error?.message || error}`);
  }
  let landmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: modelBuffer.slice(), delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  } catch (gpuError) {
    console.warn('MediaPipe GPU delegate unavailable; retrying on CPU.', gpuError);
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: modelBuffer.slice(), delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
    } catch (cpuError) {
      console.error('MediaPipe GPU initialization failure:', gpuError);
      console.error('MediaPipe CPU initialization failure:', cpuError);
      throw new Error(`MediaPipe could not initialize on GPU or CPU. GPU: ${errorDetails(gpuError)} CPU: ${errorDetails(cpuError)}`);
    }
  }
  let lastTimestamp = -1;
  return {
    detect(video, timestamp) {
      const time = Math.max(Math.round(timestamp), lastTimestamp + 1);
      lastTimestamp = time;
      return landmarker.detectForVideo(video, time);
    },
    close() { landmarker.close(); },
  };
}
