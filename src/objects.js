const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const smoothingAlpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class ObjectManipulator {
  constructor(layer, video) {
    this.layer = layer;
    this.video = video;
    this.cursor = layer.querySelector('#handCursor');
    this.objects = [...layer.querySelectorAll('.virtual-object')];
    this.enabled = true;
    this.active = null;
    this.handPoints = new Map();
    this.objects.forEach((element) => {
      const x = Number(element.dataset.x), y = Number(element.dataset.y), scale = Number(element.dataset.scale) || 1;
      const state = { x, y, scale, visualX: x, visualY: y, visualScale: scale };
      element._objectState = state;
      this.renderObject(element, true);
      element.addEventListener('pointerdown', (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        const mode = event.target.closest('.resize-handle') ? 'resize' : 'move';
        element.setPointerCapture(event.pointerId);
        this.begin(element, mode, event.clientX, event.clientY, event.pointerId);
      });
      element.addEventListener('pointermove', (event) => {
        if (this.active?.pointerId === event.pointerId) this.move(event.clientX, event.clientY);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        element.addEventListener(type, (event) => {
          if (this.active?.pointerId === event.pointerId) this.finish();
        });
      }
    });
  }

  renderObject(element, snap = false) {
    const state = element._objectState;
    if (snap) {
      cancelAnimationFrame(element._animationFrame);
      element._animationFrame = null;
      state.visualX = state.x; state.visualY = state.y; state.visualScale = state.scale;
    }
    const paint = () => {
      element.style.left = `${state.visualX * 100}%`;
      element.style.top = `${state.visualY * 100}%`;
      element.style.setProperty('--object-scale', state.visualScale);
    };
    paint();
    if (snap || element._animationFrame) return;
    let previousTime = performance.now();
    const animate = (now) => {
      const dt = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      const alpha = 1 - Math.exp(-dt / 0.034);
      state.visualX += (state.x - state.visualX) * alpha;
      state.visualY += (state.y - state.visualY) * alpha;
      state.visualScale += (state.scale - state.visualScale) * alpha;
      const settled = Math.abs(state.x - state.visualX) < 0.00025
        && Math.abs(state.y - state.visualY) < 0.00025
        && Math.abs(state.scale - state.visualScale) < 0.001;
      if (settled) {
        state.visualX = state.x; state.visualY = state.y; state.visualScale = state.scale;
        element._animationFrame = null;
      }
      paint();
      if (!settled) element._animationFrame = requestAnimationFrame(animate);
    };
    element._animationFrame = requestAnimationFrame(animate);
  }

  smoothPoint(point, key, now) {
    const previous = this.handPoints.get(key);
    if (!previous) {
      const initial = { x: point.x, y: point.y, rawX: point.x, rawY: point.y, dx: 0, dy: 0, time: now, stage: point.stage };
      this.handPoints.set(key, initial);
      return initial;
    }
    const dt = clamp((now - previous.time) / 1000, 0.008, 0.1);
    const rawDx = (point.x - previous.rawX) / dt, rawDy = (point.y - previous.rawY) / dt;
    const derivativeAlpha = smoothingAlpha(1.5, dt);
    const dx = previous.dx + (rawDx - previous.dx) * derivativeAlpha;
    const dy = previous.dy + (rawDy - previous.dy) * derivativeAlpha;
    const speed = Math.hypot(dx, dy);
    // Dampen low-speed landmark jitter, then raise the cutoff as the hand moves
    // so the ball stays smooth without trailing fast pinches.
    const cutoff = 1.8 + 0.026 * speed;
    const alpha = smoothingAlpha(cutoff, dt);
    const filtered = {
      x: previous.x + (point.x - previous.x) * alpha,
      y: previous.y + (point.y - previous.y) * alpha,
      rawX: point.x, rawY: point.y, dx, dy, time: now, stage: point.stage,
    };
    this.handPoints.set(key, filtered);
    return filtered;
  }

  pinchInfo(result, landmarks, index) {
    const label = result.handedness?.[index]?.[0]?.categoryName || `hand-${index}`;
    const midpoint = { x: (landmarks[4].x + landmarks[8].x) / 2, y: (landmarks[4].y + landmarks[8].y) / 2 };
    const rawPinch = this.screenPoint(midpoint);
    const rawTip = this.screenPoint(landmarks[8]);
    const palmCenter = [0, 5, 9, 13, 17].reduce((center, id) => ({ x: center.x + landmarks[id].x / 5, y: center.y + landmarks[id].y / 5 }), { x: 0, y: 0 });
    const now = performance.now();
    const pinch = this.smoothPoint(rawPinch, `${label}-pinch`, now);
    const tip = this.smoothPoint(rawTip, `${label}-tip`, now);
    const palm = this.smoothPoint(this.screenPoint(palmCenter), `${label}-palm`, now);
    const handScale = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y);
    const ratio = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y) / Math.max(handScale, 0.001);
    const wrist = landmarks[0];
    const curled = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([tipId, pipId]) =>
      pointDistance(landmarks[tipId], wrist) < pointDistance(landmarks[pipId], wrist) * 1.08,
    ).length;
    return { label, pinch, tip, palm, ratio, curled, pinched: ratio < 0.36, grasped: curled >= 3 };
  }

  screenPoint(point) {
    const stage = this.layer.getBoundingClientRect();
    const sourceW = this.video.videoWidth || stage.width;
    const sourceH = this.video.videoHeight || stage.height;
    const scale = Math.max(stage.width / sourceW, stage.height / sourceH);
    const offsetX = (stage.width - sourceW * scale) / 2;
    const offsetY = (stage.height - sourceH * scale) / 2;
    return {
      x: stage.left + stage.width - (point.x * sourceW * scale + offsetX),
      y: stage.top + point.y * sourceH * scale + offsetY,
      stage,
    };
  }

  findTarget(x, y) {
    for (const element of [...this.objects].reverse()) {
      const handle = element.querySelector('.resize-handle').getBoundingClientRect();
      if (x >= handle.left - 12 && x <= handle.right + 12 && y >= handle.top - 12 && y <= handle.bottom + 12) return { element, mode: 'resize' };
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { element, mode: 'move' };
    }
    return null;
  }

  begin(element, mode, x, y, pointerId = null) {
    const rect = element.getBoundingClientRect();
    const state = element._objectState;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    this.active = {
      element, mode, pointerId, offsetX: state.x - (x - this.layer.getBoundingClientRect().left) / this.layer.clientWidth,
      offsetY: state.y - (y - this.layer.getBoundingClientRect().top) / this.layer.clientHeight,
      initialScale: state.scale, initialRadius: Math.max(1, Math.hypot(x - cx, y - cy)),
    };
    element.classList.add('is-grabbed');
    this.cursor.classList.add('pinching');
    this.cursor.dataset.mode = mode;
  }

  beginTwoHand(element, first, second) {
    const rect = element.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    this.active = {
      element, mode: 'two-hand', pointerId: null,
      initialScale: element._objectState.scale,
      initialSpan: Math.max(25, Math.hypot(second.x - first.x, second.y - first.y)),
      initialCenter: center, initialMidpoint: midpoint,
    };
    element.classList.add('is-grabbed');
    this.cursor.classList.add('pinching');
    this.cursor.dataset.mode = 'two-hand';
  }

  move(x, y) {
    if (!this.active) return;
    const { element, mode } = this.active;
    const state = element._objectState;
    if (mode === 'move') {
      const rect = this.layer.getBoundingClientRect();
      const objectRect = element.getBoundingClientRect();
      const marginX = objectRect.width / 2 / rect.width + 0.015;
      const marginY = objectRect.height / 2 / rect.height + 0.02;
      state.x = clamp((x - rect.left) / rect.width + this.active.offsetX, marginX, 1 - marginX);
      state.y = clamp((y - rect.top) / rect.height + this.active.offsetY, marginY, 1 - marginY);
    } else {
      const rect = element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const radius = Math.hypot(x - cx, y - cy);
      state.scale = clamp(this.active.initialScale * radius / this.active.initialRadius, 0.55, 2.15);
    }
    this.renderObject(element);
  }

  moveTwoHand(first, second) {
    if (!this.active || this.active.mode !== 'two-hand') return;
    const { element } = this.active;
    const state = element._objectState;
    const rect = this.layer.getBoundingClientRect();
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const span = Math.hypot(second.x - first.x, second.y - first.y);
    state.scale = clamp(this.active.initialScale * span / this.active.initialSpan, 0.55, 2.15);
    const cx = this.active.initialCenter.x + midpoint.x - this.active.initialMidpoint.x;
    const cy = this.active.initialCenter.y + midpoint.y - this.active.initialMidpoint.y;
    state.x = clamp((cx - rect.left) / rect.width, 0.08, 0.92);
    state.y = clamp((cy - rect.top) / rect.height, 0.12, 0.88);
    this.renderObject(element);
  }

  finish() {
    if (!this.active) return;
    this.active.element.classList.remove('is-grabbed');
    this.active = null;
    this.cursor.classList.remove('pinching');
    delete this.cursor.dataset.mode;
  }

  update(result) {
    const hands = (result?.landmarks || []).map((landmarks, index) => this.pinchInfo(result, landmarks, index));
    if (!this.enabled || !hands.length) {
      this.cursor.classList.remove('visible');
      if (this.active && this.active.pointerId === null) this.finish();
      return;
    }
    const pinchedHands = hands.filter((hand) => hand.pinched);
    const twoPinched = pinchedHands.length >= 2;
    const activeHand = this.active?.handLabel ? hands.find((item) => item.label === this.active.handLabel) : null;
    const cursorPoint = twoPinched
      ? { x: (pinchedHands[0].pinch.x + pinchedHands[1].pinch.x) / 2, y: (pinchedHands[0].pinch.y + pinchedHands[1].pinch.y) / 2, stage: pinchedHands[0].pinch.stage }
      : (() => { const hand = activeHand || hands.find((item) => item.pinched || item.grasped) || hands[0]; return hand.pinched || this.active?.grabType === 'pinch' ? hand.pinch : hand.grasped || this.active?.grabType === 'grasp' ? hand.palm : hand.tip; })();
    this.cursor.classList.add('visible');
    this.cursor.style.left = `${cursorPoint.x - cursorPoint.stage.left}px`;
    this.cursor.style.top = `${cursorPoint.y - cursorPoint.stage.top}px`;
    if (this.active && this.active.pointerId !== null) return;
    if (this.active?.mode === 'two-hand') {
      const heldHands = hands.filter((hand) => hand.ratio < 0.78);
      if (heldHands.length >= 2) this.moveTwoHand(heldHands[0].pinch, heldHands[1].pinch);
      else if (hands.some((hand) => hand.ratio > 0.78) || hands.length < 2) this.finish();
      return;
    }
    if (this.active) {
      if (twoPinched) {
        this.beginTwoHand(this.active.element, pinchedHands[0].pinch, pinchedHands[1].pinch);
        this.moveTwoHand(pinchedHands[0].pinch, pinchedHands[1].pinch);
      } else {
        const hand = hands.find((item) => item.label === this.active.handLabel) || hands[0];
        if (this.active.grabType === 'grasp') {
          if (hand.curled < 2) this.finish();
          else this.move(hand.palm.x, hand.palm.y);
        } else if (hand.ratio > 0.78) this.finish();
        else this.move(hand.pinch.x, hand.pinch.y);
      }
    } else if (twoPinched) {
      const center = { x: (pinchedHands[0].pinch.x + pinchedHands[1].pinch.x) / 2, y: (pinchedHands[0].pinch.y + pinchedHands[1].pinch.y) / 2 };
      const target = this.findTarget(center.x, center.y);
      if (target) this.beginTwoHand(target.element, pinchedHands[0].pinch, pinchedHands[1].pinch);
    } else if (hands.some((hand) => hand.pinched || hand.grasped)) {
      const hand = hands.find((item) => item.pinched || item.grasped);
      const grabType = hand.pinched ? 'pinch' : 'grasp';
      const point = grabType === 'pinch' ? hand.pinch : hand.palm;
      const target = this.findTarget(point.x, point.y);
      if (target) {
        this.begin(target.element, target.mode, point.x, point.y);
        this.active.handLabel = hand.label;
        this.active.grabType = grabType;
      }
    }
  }

  reset() {
    this.finish();
    this.objects.forEach((element) => {
      const x = Number(element.dataset.x), y = Number(element.dataset.y), scale = Number(element.dataset.scale) || 1;
      element._objectState = { x, y, scale, visualX: x, visualY: y, visualScale: scale };
      this.renderObject(element, true);
    });
  }
}
