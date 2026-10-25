export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNAVAILABLE');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function closeCamera(stream, video) {
  stream?.getTracks().forEach((track) => track.stop());
  if (video) { video.pause(); video.srcObject = null; }
}

export function cameraErrorMessage(error) {
  if (error?.message === 'CAMERA_UNAVAILABLE') return 'This browser cannot access a camera. Try a current version of Chrome, Edge, or Firefox.';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Camera access was blocked. Allow camera permission in your browser settings, then try again.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No camera was found. Connect a camera and try again.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'The camera is busy in another app. Close it there and try again.';
  return 'The camera could not start. Check its connection and browser permissions, then try again.';
}
