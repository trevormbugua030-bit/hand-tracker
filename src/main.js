import { openCamera, closeCamera, cameraErrorMessage } from './camera.js';
import { createHandTracker } from './landmarker.js';
import { SkeletonRenderer } from './renderer.js';
import { estimateKslLetter } from './gestures.js';
import { ObjectManipulator } from './objects.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const video = $('camera'), canvas = $('overlay'), renderer = new SkeletonRenderer(canvas, video);
const objectManipulator = new ObjectManipulator($('objectLayer'), video);
const settings = renderer.settings;
let stream = null, tracker = null, animationFrame = 0, running = false, lastInference = 0, lastResult = null;
let fpsFrames = 0, fpsStart = performance.now();
let trackerPromise = null;
const readouts = [];
const recognitionTracks = new Map();
let startToken = 0;
function loadTracker() { return tracker || (trackerPromise ||= createHandTracker().then((instance) => (tracker = instance)).catch((error) => { trackerPromise = null; throw error; })); }

function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 5200);
}
function updateControls(active) {
  $('startBtn').disabled = active; $('stopBtn').disabled = !active; $('screenshotBtn').disabled = !active;
  $('emptyState').classList.toggle('hidden', active);
  $('cameraStatus').textContent = active ? 'Camera live' : 'Standby';
  document.querySelector('.record-dot').classList.toggle('active', active);
}
function stabilizeLetter(key, candidate) {
  let track = recognitionTracks.get(key);
  if (!track) {
    track = { history: [], current: '', misses: 0 };
    recognitionTracks.set(key, track);
  }
  track.history.push(candidate || '');
  if (track.history.length > 8) track.history.shift();
  if (candidate) {
    track.misses = 0;
    if (track.history.filter((letter) => letter === candidate).length >= 5) track.current = candidate;
  } else if (++track.misses >= 7) {
    track.current = '';
    track.history = [];
  }
  return track.current;
}
function presentResult(result) {
  lastResult = result;
  objectManipulator.update(result);
  const landmarks = result?.landmarks || [], worldLandmarks = result?.worldLandmarks || [], handedness = result?.handedness || [];
  const recognitionEnabled = $('kslRecognitionToggle').checked;
  const activeTracks = new Set();
  $('handCount').textContent = String(landmarks.length).padStart(2,'0');
  $('handCountInline').textContent = String(landmarks.length);
  const gestures = landmarks.map((points, i) => {
    const classification = handedness[i]?.[0];
    const side = classification?.categoryName || `Hand ${i+1}`;
    const gesture = { letter: '' };
    if (recognitionEnabled) {
      activeTracks.add(side);
      gesture.letter = stabilizeLetter(side, estimateKslLetter(points, worldLandmarks[i]));
      updateGestureReadout(i, points, side, gesture);
    }
    return { gesture, side, score: Math.round((classification?.score ?? 0.8)*100) };
  });
  for (const key of recognitionTracks.keys()) {
    if (!activeTracks.has(key)) recognitionTracks.delete(key);
  }
  const rows = gestures.map(({ gesture, side, score }) => {
    const status = recognitionEnabled ? `KSL letter · ${gesture.letter || 'Hold a clear letter'}` : 'KSL recognition off';
    return `<div class="hand-chip"><span class="hand-chip-dot"></span><b>${side}</b><small>${score}%</small><em>${status}</em></div>`;
  });
  (recognitionEnabled ? readouts.slice(landmarks.length) : readouts).forEach((node) => node.hidden = true);
  $('handList').innerHTML = rows.join('') || '<span class="no-hands">Hands will appear here when detected.</span>';
  if (landmarks.length) {
    $('gestureValue').textContent = recognitionEnabled ? gestures[0].gesture.letter || '—' : 'Off';
    const confidence = Math.round((handedness[0]?.[0]?.score ?? .8) * 100);
    $('confidenceValue').textContent = `${confidence}%`; $('confidenceFill').style.width = `${confidence}%`;
  } else {
    recognitionTracks.clear();
    $('gestureValue').textContent = recognitionEnabled ? '—' : 'Off'; $('confidenceValue').textContent = '—'; $('confidenceFill').style.width = '0%';
  }
  $('modelStatus').textContent = 'Tracking active';
}
function updateGestureReadout(index, points, side, gesture) {
  const stage = $('viewportFrame');
  let node = readouts[index];
  if (!node) {
    node = document.createElement('div');
    node.className = 'gesture-readout';
    node.innerHTML = '<span class="readout-hand"></span><b class="readout-sign"></b>';
    stage.querySelector('#gestureOverlay').append(node);
    readouts[index] = node;
  }
  node.style.right = '18px';
  node.style.top = `${54 + index * 82}px`;
  node.querySelector('.readout-hand').textContent = side;
  node.querySelector('.readout-sign').textContent = gesture.letter || '—';
  node.hidden = false;
}
function loop(now) {
  if (!running) return;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastInference >= 33) {
    lastInference = now;
    try {
      const result = tracker.detect(video, now);
      presentResult(result);
      $('resolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
      fpsFrames++;
      if (now - fpsStart >= 1000) { $('fpsValue').textContent = Math.round(fpsFrames * 1000 / (now - fpsStart)); fpsFrames = 0; fpsStart = now; }
    } catch (error) { console.error('Hand inference failed', error); toast(`Tracking paused: ${error?.message || String(error)}`); stop(); return; }
  }
  renderer.draw((lastResult?.landmarks || []).map((landmarks, i) => ({ landmarks, handedness: lastResult.handedness?.[i] })), now);
  animationFrame = requestAnimationFrame(loop);
}
async function start() {
  if (running) return;
  const token = ++startToken;
  $('modelStatus').textContent = 'Requesting camera'; $('cameraStatus').textContent = 'Connecting';
  $('startBtn').disabled = true;
  let phase = 'camera';
  try {
    const acquiredStream = await openCamera(video);
    if (token !== startToken) { closeCamera(acquiredStream, video); return; }
    stream = acquiredStream;
    stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
      if (token === startToken) { toast('The camera disconnected. Reconnect it and start the camera again.'); stop(); }
    }, { once: true }));
    updateControls(true);
    $('modelStatus').textContent = 'Loading model';
    phase = 'model';
    if (!tracker) await loadTracker();
    if (token !== startToken) return;
    running = true; lastResult = null; lastInference = 0; updateControls(true);
    $('modelStatus').textContent = 'Tracking active'; $('resolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
    animationFrame = requestAnimationFrame(loop);
  } catch (error) {
    if (token !== startToken) return;
    console.error(error); closeCamera(stream, video); stream = null; $('startBtn').disabled = false;
    $('cameraStatus').textContent = 'Standby'; $('modelStatus').textContent = phase === 'model' ? 'Model error' : 'Model ready';
    toast(phase === 'camera' ? cameraErrorMessage(error) : `Could not load the hand model. Check your internet connection and refresh. ${error?.message || ''}`);
  }
}
function stop() {
  startToken++;
  if (!running && !stream) { updateControls(false); return; }
  running = false; cancelAnimationFrame(animationFrame); closeCamera(stream, video); stream = null;
  lastResult = null; renderer.smoothed = []; renderer.draw([], performance.now());
  presentResult({ landmarks: [], handedness: [] }); $('fpsValue').textContent = '—'; $('resolution').textContent = '— × —';
  $('modelStatus').textContent = tracker ? 'Model ready' : 'Model offline'; updateControls(false);
}

$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);
$('kslRecognitionToggle').addEventListener('change', () => {
  recognitionTracks.clear();
  if (lastResult) presentResult(lastResult);
  else {
    readouts.forEach((node) => node.hidden = true);
    $('gestureValue').textContent = $('kslRecognitionToggle').checked ? '—' : 'Off';
  }
});
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(animationFrame); closeCamera(stream, video); tracker?.close(); });
video.addEventListener('error', () => { if (running) { toast('The camera feed was interrupted. Reconnect it and restart the camera.'); stop(); } });

const checkboxMap = { skeletonToggle: 'skeleton', jointsToggle: 'joints', labelsToggle: 'labels', idsToggle: 'ids' };
Object.entries(checkboxMap).forEach(([id, key]) => $(id).addEventListener('change', (event) => { settings[key] = event.target.checked; }));
$('objectToggle').addEventListener('change', (event) => {
  objectManipulator.enabled = event.target.checked;
  $('objectLayer').classList.toggle('ball-hidden', !event.target.checked);
  if (!event.target.checked) objectManipulator.update(null);
});
$('resetObjectsBtn').addEventListener('click', () => objectManipulator.reset());
$('thicknessSlider').addEventListener('input', (event) => { settings.thickness = Number(event.target.value); $('thicknessOutput').textContent = settings.thickness.toFixed(1); });
$('glowSlider').addEventListener('input', (event) => { settings.glow = Number(event.target.value); $('glowOutput').textContent = `${settings.glow}%`; });
$('resetBtn').addEventListener('click', () => {
  Object.entries(checkboxMap).forEach(([id,key]) => { $(id).checked = key !== 'ids'; settings[key] = key !== 'ids'; });
  $('thicknessSlider').value = 2.4; settings.thickness = 2.4; $('thicknessOutput').textContent = '2.4';
  $('glowSlider').value = 32; settings.glow = 32; $('glowOutput').textContent = '32%';
});
$('fullscreenBtn').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewportFrame').requestFullscreen(); }
  catch { toast('Fullscreen is unavailable in this browser.'); }
});
$('screenshotBtn').addEventListener('click', () => {
  if (!running) return;
  const out = document.createElement('canvas'), rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  out.width = Math.round(rect.width*dpr); out.height = Math.round(rect.height*dpr);
  const ctx = out.getContext('2d'); ctx.scale(dpr,dpr);
  const scale = Math.max(rect.width/video.videoWidth, rect.height/video.videoHeight), sw=video.videoWidth*scale, sh=video.videoHeight*scale;
  ctx.save(); ctx.translate(rect.width,0); ctx.scale(-1,1); ctx.drawImage(video,(rect.width-sw)/2,(rect.height-sh)/2,sw,sh); ctx.restore();
  ctx.drawImage(canvas,0,0,rect.width,rect.height);
  if ($('objectToggle').checked) {
    const sphere = document.querySelector('.ball-sphere'), sphereRect = sphere.getBoundingClientRect();
    const x = sphereRect.left - rect.left, y = sphereRect.top - rect.top, size = sphereRect.width;
    const gradient = ctx.createRadialGradient(x + size * .31, y + size * .25, 1, x + size * .52, y + size * .52, size * .68);
    gradient.addColorStop(0, 'rgba(241,255,255,.98)'); gradient.addColorStop(.12, 'rgba(112,236,250,.94)'); gradient.addColorStop(.45, 'rgba(28,155,183,.90)'); gradient.addColorStop(1, 'rgba(3,18,31,.97)');
    ctx.save(); ctx.shadowColor = '#66efff'; ctx.shadowBlur = 18; ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI*2); ctx.fill(); ctx.restore();
  }
  const link = document.createElement('a'); link.download = `hand-signal-${Date.now()}.png`; link.href = out.toDataURL('image/png'); link.click();
});

// Initialize the reusable model before a camera request. This avoids repeated downloads between sessions.
loadTracker().then(() => { $('modelStatus').textContent = 'Model ready'; }).catch((error) => {
  console.warn('Model will load when camera starts', error); $('modelStatus').textContent = 'Model loads on start';
});
