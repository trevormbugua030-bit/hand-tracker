const tips = [4, 8, 12, 16, 20];
const pips = [3, 6, 10, 14, 18];
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)); }
function jointAngle(a, joint, b) {
  const ax = a.x - joint.x, ay = a.y - joint.y, az = (a.z || 0) - (joint.z || 0);
  const bx = b.x - joint.x, by = b.y - joint.y, bz = (b.z || 0) - (joint.z || 0);
  const denominator = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
  if (!denominator) return 0;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

export function estimateKslLetter(points, worldPoints = points) {
  if (!Array.isArray(points) || points.length !== 21
      || points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return '';
  const validWorldPoints = Array.isArray(worldPoints) && worldPoints.length === 21
    && worldPoints.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  const pose = validWorldPoints ? worldPoints : points;
  const palm = Math.max(distance(pose[0], pose[9]), 0.001);
  // Use joint bend and fingertip reach together in 3D, so a slightly bent open finger still counts.
  const extended = [false, ...[1, 2, 3, 4].map((finger) => {
    const mcp = [5, 9, 13, 17][finger - 1], pip = pips[finger], dip = pip + 1, tip = tips[finger];
    const pipAngle = jointAngle(pose[mcp], pose[pip], pose[dip]);
    const dipAngle = jointAngle(pose[pip], pose[dip], pose[tip]);
    const reach = distance(pose[tip], pose[0]) - distance(pose[pip], pose[0]);
    return (pipAngle > 145 && dipAngle > 130) || (pipAngle > 125 && reach > palm * 0.12);
  })];
  // The thumb counts only when its IP joint is straight and its tip reaches outward from the palm.
  const thumbStraight = jointAngle(pose[2], pose[3], pose[4]) > 135;
  const thumbReach = distance(pose[4], pose[9]) - distance(pose[3], pose[9]);
  extended[0] = thumbStraight && thumbReach > palm * 0.06;
  return recognizeKslLetter(points, pose, extended, palm);
}

// A compact landmark heuristic for the static KSL manual alphabet. J and Z
// require movement, so they cannot be identified from a single hand pose.
function recognizeKslLetter(points, pose, extended, palm) {
  const [thumb, index, middle, ring, pinky] = extended;
  const tipDistance = (a, b) => distance(pose[a], pose[b]) / palm;
  const [indexMcp, middleMcp] = [5, 9];
  const fingerJoints = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  const fingerCurved = fingerJoints.map(([mcp, pip, dip, tip]) =>
    jointAngle(pose[mcp], pose[pip], pose[dip]) < 155 || jointAngle(pose[pip], pose[dip], pose[tip]) < 150);
  const curledCount = fingerCurved.filter(Boolean).length;
  const indexStraight = jointAngle(pose[5], pose[6], pose[7]) > 135
    && jointAngle(pose[6], pose[7], pose[8]) > 120;
  const indexExtended = index || indexStraight;
  const middleExtended = middle || (jointAngle(pose[9], pose[10], pose[11]) > 135
    && jointAngle(pose[10], pose[11], pose[12]) > 120);
  const indexMiddleGap = tipDistance(8, 12);
  const thumbIndexGap = tipDistance(4, 8);
  const thumbMiddleGap = tipDistance(4, 12);
  const fingers = [index, middle, ring, pinky];
  const openCount = [thumb, ...fingers].filter(Boolean).length;
  const avgTipReach = [8, 12, 16, 20].reduce((sum, tip) => sum + tipDistance(tip, 0), 0) / 4;
  const fingerSpread = Math.max(...[[8, 12], [8, 16], [8, 20], [12, 16], [12, 20], [16, 20]]
    .map(([a, b]) => tipDistance(a, b)));
  const fingerCluster = (tipDistance(8, 12) + tipDistance(12, 16) + tipDistance(16, 20)) / 3;
  const cShape = curledCount >= 3 && fingerCluster < 0.42 && fingerSpread < 0.68
    && avgTipReach > 1.15 && thumbIndexGap > 0.55 && thumbIndexGap < 1.05 && tipDistance(4, 20) > 0.75;
  const closedFist = curledCount >= 3 && fingerCluster < 0.65 && avgTipReach < 1.15;
  const thumbIndexTouch = thumbIndexGap < 0.38;
  const thumbMiddleTouch = thumbMiddleGap < 0.48;
  const fourStraight = fingers.every(Boolean) && curledCount <= 1;
  const indexAndMiddle = indexExtended && middleExtended && !ring && !pinky;
  const roundShape = curledCount >= 3 && [8, 12, 16, 20].every((tip) => tipDistance(4, tip) < 0.62)
    && avgTipReach > 0.9 && avgTipReach < 1.65;

  // Resolve distinctive shapes before the more ambiguous fist and extension patterns.
  if (cShape) return 'C';
  if (middle && ring && pinky && thumbIndexTouch) return 'F';
  if (fourStraight && !thumb && fingerSpread < 0.72) return 'B';
  if (indexAndMiddle && thumbIndexTouch) return 'K';
  if (indexExtended && !middleExtended && !ring && !pinky) {
    if (thumbMiddleTouch) return 'D';
    const imagePalm = Math.max(distance(points[0], points[9]), 0.001);
    const indexSideways = Math.abs(points[8].x - points[5].x) > imagePalm * 0.65
      && Math.abs(points[8].y - points[5].y) < imagePalm * 0.65;
    if (thumb && indexSideways) return 'G';
    return thumb ? 'L' : 'D';
  }
  if (!index && !middle && !ring && pinky && thumb) return 'Y';
  if (!index && !middle && !ring && pinky) return 'I';
  if (index && middle && ring && !pinky) return 'W';
  if (indexAndMiddle) return indexMiddleGap < 0.32 ? 'U' : 'V';
  if (roundShape && thumbIndexTouch) return 'O';
  if (closedFist && openCount <= 1 && !indexExtended && !middleExtended) {
    const thumbAtIndex = tipDistance(4, indexMcp), thumbAtMiddle = tipDistance(4, middleMcp);
    if (Math.abs(thumbAtIndex - thumbAtMiddle) < 0.08) return '';
    return thumbAtIndex < thumbAtMiddle ? 'A' : 'E';
  }
  // The two moving letters need a temporal trajectory model and stay unknown here.
  return '';
}
