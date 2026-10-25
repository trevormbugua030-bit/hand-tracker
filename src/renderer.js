const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const colors = ['#f0bd7d','#6bd8d1','#75d1cc','#88c9b4','#aebf91'];
const fingerTips = [[4,'THUMB'],[8,'INDEX'],[12,'MIDDLE'],[16,'RING'],[20,'PINKY']];

export class SkeletonRenderer {
  constructor(canvas, video) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.video = video;
    this.settings = { skeleton: true, joints: true, labels: true, ids: false, thickness: 2.4, glow: 32 };
    this.smoothed = [];
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return;
    if (this.canvas.width !== Math.round(rect.width * dpr) || this.canvas.height !== Math.round(rect.height * dpr)) {
      this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width; this.height = rect.height;
  }
  draw(hands = [], time = performance.now()) {
    this.resize();
    const { ctx, width: w, height: h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const sourceW = this.video.videoWidth || w, sourceH = this.video.videoHeight || h;
    const scale = Math.max(w / sourceW, h / sourceH), ox = (w - sourceW * scale) / 2, oy = (h - sourceH * scale) / 2;
    const current = [];
    for (const [handIndex, hand] of hands.entries()) {
      const points = hand.landmarks.map((point, i) => {
        const x = w - (point.x * sourceW * scale + ox), y = point.y * sourceH * scale + oy;
        const old = this.smoothed[handIndex]?.[i];
        return { x: old ? old.x + (x - old.x) * 0.58 : x, y: old ? old.y + (y - old.y) * 0.58 : y };
      });
      current.push(points);
      const glow = this.settings.glow / 100;
      if (this.settings.skeleton) {
        connections.forEach(([a, b]) => {
          const color = colors[a === 0 || a === 17 ? 0 : a < 5 ? 0 : a < 9 ? 1 : a < 13 ? 2 : a < 17 ? 3 : 4];
          ctx.beginPath(); ctx.moveTo(points[a].x, points[a].y); ctx.lineTo(points[b].x, points[b].y);
          ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(2,12,20,.88)'; ctx.lineWidth = this.settings.thickness + 3.6; ctx.shadowBlur = 0; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(points[a].x, points[a].y); ctx.lineTo(points[b].x, points[b].y);
          ctx.strokeStyle = color; ctx.lineWidth = this.settings.thickness; ctx.shadowColor = color; ctx.shadowBlur = 5 + 18 * glow; ctx.stroke();
        });
        // Palm frame gives the central structure a readable holographic plane.
        ctx.beginPath(); [0,5,9,13,17].forEach((id, i) => { const p = points[id]; i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y); }); ctx.closePath();
        ctx.fillStyle = `rgba(55,222,255,${0.035 + glow * 0.055})`; ctx.fill();
      }
      if (this.settings.joints) points.forEach((p, i) => {
        const isTip = fingerTips.some(([id]) => id === i), isPalm = [0,5,9,13,17].includes(i), r = isTip ? 5.4 : isPalm ? 4 : 2.9;
        ctx.beginPath(); ctx.arc(p.x,p.y,r+2.5,0,Math.PI*2); ctx.fillStyle = 'rgba(3,11,18,.88)'; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fillStyle = isTip ? '#f3ffff' : '#65efff'; ctx.shadowColor = isTip ? '#fff' : '#38dcff'; ctx.shadowBlur = 4 + 15*glow; ctx.fill(); ctx.shadowBlur = 0;
        if (isTip) { const pulse = 1 + Math.sin(time / 220 + i) * .12; ctx.beginPath(); ctx.arc(p.x,p.y,(r+4)*pulse,0,Math.PI*2); ctx.strokeStyle = `rgba(91,239,255,${.35 + glow*.35})`; ctx.lineWidth = 1; ctx.stroke(); }
      });
      if (this.settings.labels) fingerTips.forEach(([id,label]) => {
        const p = points[id], tx = p.x + (p.x < w*.5 ? 12 : -12); ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(212,250,255,.82)'; ctx.textAlign = p.x < w*.5 ? 'left' : 'right'; ctx.fillText(label,p.x < w*.5 ? tx : tx,p.y-9);
      });
      if (this.settings.ids) points.forEach((p,i) => { ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#e5fcff'; ctx.fillText(String(i).padStart(2,'0'),p.x+7,p.y-6); });
    }
    this.smoothed = current;
  }
}
