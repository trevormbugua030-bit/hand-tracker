# HAND SIGNAL

A local, browser based hand tracking interface. It uses MediaPipe Tasks Vision to detect up to two hands and draws the 21 point hand skeleton over a mirrored webcam preview. An experimental landmark heuristic estimates some static KSL manual alphabet letters; it is not a trained full alphabet recognizer. Camera frames and landmarks are processed in your browser; no backend or paid API is used.

## Prerequisites

- Node.js 18 or newer and npm.
- A current browser with webcam support (Chrome, Edge, Firefox, or Safari).
- Internet access on first load to download the hand landmark model. Vite serves the MediaPipe WASM runtime from the installed npm package. The app itself does not send camera frames to a server.

## Install and run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`). Localhost is treated as a secure context by modern browsers, so camera access is available. For a production bundle use `npm run build`, then serve the generated `dist` folder from HTTPS or localhost.

## Camera permission troubleshooting

Press **Start camera**, then allow the browser's camera prompt. If permission was denied earlier, use the site controls beside the address bar to allow camera access and reload. Close video meeting apps that may be using the camera. If no camera is listed, connect one and reload. A non-local network deployment must use HTTPS for `getUserMedia`.

## Controls

- Start/stop the camera, turn KSL letter estimates on or off, show/hide the skeleton and joints, show fingertip names, and toggle landmark IDs.
- Adjust line width and glow, reset the visualization, save a PNG with the overlay, or put the viewport into fullscreen.
- Move and resize the translucent virtual ball with a pinch or grasp; use both hands to resize it.
- The panel shows the number of hands, estimated frame rate, a stabilized KSL letter estimate, and MediaPipe handedness confidence.
- Letter estimates use hand landmarks and can vary with camera angle, rotation, and occlusion. Unclear poses are left blank; J and Z require motion and are not currently recognized.

## Landmark numbering

MediaPipe returns 21 normalized image landmarks per hand: **0** is the wrist. Thumb is **1–4** (tip 4); index is **5–8** (tip 8); middle is **9–12** (tip 12); ring is **13–16** (tip 16); pinky is **17–20** (tip 20). The renderer draws the anatomical chains, palm connections, and wrist-to-pinky edge. Enable Landmark IDs to see point indices.

## Common errors

- **Camera access blocked:** grant permission in browser site settings, then try again.
- **No camera found:** check the device connection and operating system camera privacy settings.
- **Camera busy:** close other apps or tabs using the camera.
- **Hand model failed to load:** check network access to Google Cloud Storage and reload. The model is downloaded by the browser; the WASM runtime is served locally from the installed package.
- **Black preview:** check camera permissions and close other camera applications.
