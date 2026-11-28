/**
 * NKPDF 2.9 iPad Edition — SMOOTH INK ENGINE V2 + FREE CURVE ENGINE V3 (SCHNEIDER BÉZIER)
 * + SMART SHAPE ENGINE V4 + FULL HOLD-TO-SHAPE LIVE DRAG & PARAMETRIC CURVE CONTROLS
 *
 * Đồng bộ 100% tính năng viết vẽ & dựng hình với bản PC (.exe):
 * 1. Bộ lọc thích ứng One-Euro Filter (1€ Filter) + Bảo toàn góc nhọn 52° + Nội suy Quadratic Spline.
 * 2. FreeCurveEngineV3 (Schneider Adaptive Piecewise Cubic Bézier):
 *    - Khử điểm dừng giữ bút (pruneHoldDwellPoints), ước lượng tiếp tuyến hai đầu chống móc câu.
 *    - Khớp đường cong Bézier bậc 3 đơn đoạn (4 điểm điều khiển P0, C1, C2, P3 với 2 tay đòn tiếp tuyến)
 *      hoặc đa đoạn mượt G1 khi người dùng vẽ bất kỳ đường cong tự do nào và giữ bút ~0.6s!
 * 3. SmartShapeEngineV4 (11 mô hình nhận dạng khi giữ bút):
 *    - Đoạn thẳng (duong), Hệ trục tọa độ vuông góc Oxy 2 mũi tên (he_truc_oxy_nan),
 *      Dấu căn bậc hai √‾‾‾‾ (can_bac_2), Sóng hình Sin/Cos (sin_cos), Cung tròn (cung_tron),
 *      Đồ thị Parabol (parabol), Nhánh Hyperbol đẳng nhiệt p-V (hyperbol), Đường tròn/Elip (elip),
 *      Tam giác (tam_giac), Hình chữ nhật (hcn), và Đường cong mượt tự do (duong_cong).
 * 4. TƯƠNG TÁC SỐNG SAU KHI GIỮ BÚT (Hold-then-Drag Live Manipulation — Y HỆT BẢN EXE):
 *    - Sau khi giữ bút để hiện đường cong / hình đẹp, nếu chưa nhấc bút mà dịch chuyển mũi bút:
 *      + Đường cong (Parabol, Cung tròn, Sóng Sin/Cos, Hyperbol, Đường cong mượt): tự động co giãn,
 *        xoay và uốn theo mũi bút quanh điểm đặt bút P0 (kèm bắt dính đầu mút!).
 *      + Dấu căn bậc hai (√‾‾‾‾): kéo dài hoặc thu ngắn thanh ngang của căn thức theo mũi bút,
 *        đồng thời cho phép nâng/hạ chiều cao căn!
 *      + Đoạn thẳng: kéo đầu mút tới điểm bất kỳ, bắt điểm đầu mút và bắt góc chuẩn.
 *      + Đường tròn / Elip: phóng to / thu nhỏ bán kính theo mũi bút.
 *      + Hình chữ nhật: kéo góc đối diện thay đổi kích thước trực tiếp.
 *      + Tam giác: kéo đỉnh cuối trực tiếp.
 *      + Hệ trục Oxy: kéo dài / thu ngắn nhánh trục ngang Ox hoặc trục đứng Oy theo hướng bút.
 * 5. Hệ thống ĐIỂM ĐIỀU KHIỂN ĐỘNG & XOAY 360° / LẬT ĐỐI XỨNG KHI CHỌN:
 *    - Đường cong tự do: 4 điểm điều khiển Bézier (P0, C1, C2, P3) với 2 cánh tay đòn tiếp tuyến màu cam.
 *    - Parabol / Cung tròn / Sóng Sin / Hyperbol: 3 điểm điều khiển toán học trên đường cong.
 *    - Dấu căn bậc 2: 4 đỉnh điều khiển (móc trái, đáy nhọn, đỉnh góc, mút thanh ngang).
 *    - Tay cầm xoay 360° (nút tròn xanh ngọc phía trên khung chọn) + kéo cạnh qua đối diện để lật đối xứng.
 */
window.NKInkEngine = (function () {
  // ============================================================================
  // 1. BỘ LỌC THÍCH ỨNG ONE-EURO FILTER (1€ FILTER) & ADAPTIVE INK PROCESSOR
  // ============================================================================
  class LowPassFilter {
    constructor() { this.y = 0; this.s = 0; this.initialized = false; }
    reset() { this.initialized = false; }
    filter(value, alpha) {
      if (!this.initialized) {
        this.s = value; this.y = value; this.initialized = true;
      } else {
        this.y = value;
        this.s = alpha * value + (1.0 - alpha) * this.s;
      }
      return this.s;
    }
  }

  class OneEuroFilter1D {
    constructor(minCutoff = 1.85, beta = 0.038, dCutoff = 1.0) {
      this.minCutoff = minCutoff;
      this.beta = beta;
      this.dCutoff = dCutoff;
      this.xFilter = new LowPassFilter();
      this.dxFilter = new LowPassFilter();
      this.lastTime = null;
    }
    reset() {
      this.xFilter.reset();
      this.dxFilter.reset();
      this.lastTime = null;
    }
    static alpha(cutoff, dt) {
      const tau = 1.0 / (2.0 * Math.PI * Math.max(0.001, cutoff));
      return 1.0 / (1.0 + tau / Math.max(1e-5, dt));
    }
    filter(value, timestampSec) {
      if (this.lastTime === null || !this.xFilter.initialized) {
        this.lastTime = timestampSec;
        this.dxFilter.filter(0.0, 1.0);
        return this.xFilter.filter(value, 1.0);
      }
      let dt = timestampSec - this.lastTime;
      if (dt <= 1e-5) dt = 1.0 / 240.0;
      else if (dt > 0.5) dt = 1.0 / 60.0;
      this.lastTime = timestampSec;

      const dx = (value - this.xFilter.s) / dt;
      const edx = this.dxFilter.filter(dx, OneEuroFilter1D.alpha(this.dCutoff, dt));
      const cutoff = this.minCutoff + this.beta * Math.abs(edx);
      return this.xFilter.filter(value, OneEuroFilter1D.alpha(cutoff, dt));
    }
  }

  class AdaptiveInkProcessor {
    constructor() {
      // Bộ lọc siêu nhẹ độ trễ gần như 0ms cho Apple Pencil 120Hz trên iPad:
      // Không dùng One-Euro cutoff thấp gây trễ bút; làm mịn tức thì bằng EMA (alpha = 0.58)
      // kết hợp làm mịn 2 lượt Laplacian khi nhấc bút để nét cực mượt, bám sát đầu bút 100%!
      this.rawPoints = [];
      this.filteredPoints = [];
      this.cornerIndices = new Set();
    }
    reset() {
      this.rawPoints = [];
      this.filteredPoints = [];
      this.cornerIndices.clear();
    }
    addPoint(x, y, timestampMs = performance.now()) {
      const ts = timestampMs / 1000.0;
      if (this.rawPoints.length === 0) {
        this.rawPoints.push({ x, y, ts });
        this.filteredPoints.push({ x, y });
        return true;
      }
      const prev = this.rawPoints[this.rawPoints.length - 1];
      const dx = x - prev.x, dy = y - prev.y;
      const dist = Math.hypot(dx, dy);
      // Lọc nhiễu siêu nhỏ < 0.75px để không sinh răng cưa nhưng vẫn giữ trọn vẹn nét chữ nhỏ (n, m, ă, â)
      if (dist < 0.75) return false;

      // Nhận diện góc nhọn thực sự trên đoạn >= 6px với góc ngoặt >= 70°
      if (this.rawPoints.length >= 3) {
        let backIdx = this.rawPoints.length - 2;
        while (backIdx > 0 && Math.hypot(prev.x - this.rawPoints[backIdx].x, prev.y - this.rawPoints[backIdx].y) < 6.0) {
          backIdx--;
        }
        const pBack = this.rawPoints[backIdx];
        const v1x = prev.x - pBack.x, v1y = prev.y - pBack.y;
        const l1 = Math.hypot(v1x, v1y);
        if (l1 >= 5.5 && dist >= 3.0) {
          let cosA = (v1x * dx + v1y * dy) / (l1 * dist);
          cosA = Math.max(-1.0, Math.min(1.0, cosA));
          const angDeg = Math.acos(cosA) * (180.0 / Math.PI);
          if (angDeg >= 70.0) {
            this.cornerIndices.add(this.filteredPoints.length - 1);
          }
        }
      }

      this.rawPoints.push({ x, y, ts });
      // EMA siêu nhẹ bám sát đầu bút (alpha = 0.62 khi kéo nhanh, 0.48 khi viết chậm) -> độ trễ < 2ms!
      const prevF = this.filteredPoints[this.filteredPoints.length - 1];
      const alpha = dist > 8.0 ? 0.68 : 0.52;
      this.filteredPoints.push({
        x: prevF.x + (x - prevF.x) * alpha,
        y: prevF.y + (y - prevF.y) * alpha
      });
      return true;
    }
    buildSmoothPoints(isFinal = false) {
      const nRaw = this.rawPoints.length;
      if (nRaw === 0) return [];
      if (nRaw === 1 || (nRaw === 2 && Math.hypot(this.rawPoints[1].x - this.rawPoints[0].x, this.rawPoints[1].y - this.rawPoints[0].y) < 2.0)) {
        return [{ x: this.rawPoints[0].x, y: this.rawPoints[0].y }];
      }

      let pts = this.filteredPoints.map((p) => ({ x: p.x, y: p.y }));
      pts[0] = { x: this.rawPoints[0].x, y: this.rawPoints[0].y };

      // Khử móc thừa (lift-off hook) ở đuôi nét khi nhấc bút Apple Pencil khỏi mặt kính iPad
      if (isFinal && pts.length >= 5) {
        for (let k = 0; k < 2 && pts.length >= 5; k++) {
          const n = pts.length;
          const pEnd = pts[n - 1], pPrev = pts[n - 2], pPrev2 = pts[n - 3];
          const vInX = pPrev.x - pPrev2.x, vInY = pPrev.y - pPrev2.y;
          const vOutX = pEnd.x - pPrev.x, vOutY = pEnd.y - pPrev.y;
          const lIn = Math.hypot(vInX, vInY), lOut = Math.hypot(vOutX, vOutY);
          if (lOut < 9.0 && lIn > 1.5) {
            const cosH = Math.max(-1, Math.min(1, (vInX * vOutX + vInY * vOutY) / (lIn * Math.max(0.01, lOut))));
            if (cosH < 0.45) {
              pts.pop();
            } else {
              break;
            }
          } else {
            break;
          }
        }
      }

      if (pts.length < 3) return pts;

      // 2 lượt làm mịn Laplacian nhẹ (0.22 - 0.56 - 0.22) khi kết thúc nét để đường viết tay hoàn hảo không gãy khúc
      const passes = isFinal ? 2 : 1;
      let cur = pts;
      for (let pass = 0; pass < passes; pass++) {
        const next = [cur[0]];
        for (let i = 1; i < cur.length - 1; i++) {
          if (this.cornerIndices.has(i)) {
            next.push(cur[i]);
          } else {
            next.push({
              x: 0.22 * cur[i - 1].x + 0.56 * cur[i].x + 0.22 * cur[i + 1].x,
              y: 0.22 * cur[i - 1].y + 0.56 * cur[i].y + 0.22 * cur[i + 1].y
            });
          }
        }
        next.push(cur[cur.length - 1]);
        cur = next;
      }
      return cur;
    }
    isLikelyHandwriting() {
      const n = this.rawPoints.length;
      if (n < 5) return false;
      const p0 = this.rawPoints[0], pend = this.rawPoints[n - 1];
      const chord = Math.hypot(pend.x - p0.x, pend.y - p0.y);
      let totalLen = 0;
      for (let i = 0; i < n - 1; i++) {
        totalLen += Math.hypot(this.rawPoints[i + 1].x - this.rawPoints[i].x, this.rawPoints[i + 1].y - this.rawPoints[i].y);
      }
      if (totalLen < 24.0) return true;
      const isClosed = (totalLen > 45.0 && chord / Math.max(1.0, totalLen) < 0.28);
      if (!isClosed && this.cornerIndices.size >= 2 && (chord / Math.max(1.0, totalLen) < 0.72)) {
        return true;
      }
      return false;
    }
  }

  // ============================================================================
  // 2. FREE CURVE ENGINE V3 (SCHNEIDER CUBIC BÉZIER — Y HỆT free_curve_engine.py)
  // ============================================================================
  function distPt(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }
  function dotVec(v1, v2) { return v1.x * v2.x + v1.y * v2.y; }

  function bezierPt(p0, p1, p2, p3, t) {
    const it = 1.0 - t, it2 = it * it, it3 = it2 * it;
    const t2 = t * t, t3 = t2 * t;
    return {
      x: it3 * p0.x + 3.0 * it2 * t * p1.x + 3.0 * it * t2 * p2.x + t3 * p3.x,
      y: it3 * p0.y + 3.0 * it2 * t * p1.y + 3.0 * it * t2 * p2.y + t3 * p3.y
    };
  }

  function bezierPrime(p0, p1, p2, p3, t) {
    const it = 1.0 - t;
    return {
      x: 3.0 * (it * it * (p1.x - p0.x) + 2.0 * it * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
      y: 3.0 * (it * it * (p1.y - p0.y) + 2.0 * it * t * (p2.y - p1.y) + t * t * (p3.y - p2.y))
    };
  }

  function bezierDoublePrime(p0, p1, p2, p3, t) {
    const it = 1.0 - t;
    return {
      x: 6.0 * (it * (p2.x - 2.0 * p1.x + p0.x) + t * (p3.x - 2.0 * p2.x + p1.x)),
      y: 6.0 * (it * (p2.y - 2.0 * p1.y + p0.y) + t * (p3.y - 2.0 * p2.y + p1.y))
    };
  }

  function cleanRawPoints(pts, minDist = 0.8) {
    if (!pts || pts.length <= 1) return (pts || []).slice();
    const cleaned = [{ x: pts[0].x, y: pts[0].y }];
    for (let i = 1; i < pts.length; i++) {
      if (distPt(pts[i], cleaned[cleaned.length - 1]) >= minDist) {
        cleaned.push({ x: pts[i].x, y: pts[i].y });
      }
    }
    if (cleaned.length < 2 && pts.length >= 2) {
      cleaned.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    }
    return cleaned;
  }

  function pruneHoldDwellPoints(pts, dwellRadius = 5.5) {
    if (pts.length < 6) return pts;
    const pend = pts[pts.length - 1];
    let dwellStart = pts.length - 1;
    while (dwellStart > 2 && distPt(pts[dwellStart - 1], pend) <= dwellRadius) {
      dwellStart--;
    }
    if ((pts.length - 1 - dwellStart) >= 2) {
      return pts.slice(0, dwellStart).concat([{ x: pend.x, y: pend.y }]);
    }
    return pts;
  }

  function estimateLeftTangent(pts) {
    const n = pts.length;
    if (n < 2) return { x: 1.0, y: 0.0 };
    let refStart = pts[0], startI = 1;
    if (n >= 4) {
      const vFirst = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
      const vNext = { x: pts[2].x - pts[1].x, y: pts[2].y - pts[1].y };
      const mFirst = Math.hypot(vFirst.x, vFirst.y), mNext = Math.hypot(vNext.x, vNext.y);
      if (mFirst > 1e-4 && mNext > 1e-4) {
        const cosHook = (vFirst.x * vNext.x + vFirst.y * vNext.y) / (mFirst * mNext);
        if (cosHook < 0.94 && mFirst < 8.0) {
          refStart = pts[1];
          startI = 2;
        }
      }
    }
    let vxSum = 0.0, vySum = 0.0, accumDist = 0.0, count = 0;
    const targetDist = 10.0;
    for (let i = startI; i < n; i++) {
      const d = distPt(pts[i], refStart);
      accumDist += distPt(pts[i], pts[i - 1]);
      if (d < 1e-4) continue;
      const w = accumDist < targetDist ? Math.max(0.15, 1.0 - accumDist / targetDist) : 0.15;
      vxSum += ((pts[i].x - refStart.x) / d) * w;
      vySum += ((pts[i].y - refStart.y) / d) * w;
      count++;
      if (accumDist >= targetDist && count >= 3) break;
    }
    const m = Math.hypot(vxSum, vySum);
    if (m > 1e-6) return { x: vxSum / m, y: vySum / m };
    const vx = pts[n - 1].x - pts[0].x, vy = pts[n - 1].y - pts[0].y;
    const mFb = Math.hypot(vx, vy);
    return mFb > 1e-6 ? { x: vx / mFb, y: vy / mFb } : { x: 1.0, y: 0.0 };
  }

  function estimateRightTangent(pts) {
    const n = pts.length;
    if (n < 2) return { x: -1.0, y: 0.0 };
    let refEnd = pts[n - 1], startI = n - 2;
    if (n >= 4) {
      const vPrev = { x: pts[n - 2].x - pts[n - 3].x, y: pts[n - 2].y - pts[n - 3].y };
      const vLast = { x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y };
      const mPrev = Math.hypot(vPrev.x, vPrev.y), mLast = Math.hypot(vLast.x, vLast.y);
      if (mPrev > 1e-4 && mLast > 1e-4) {
        const cosHook = (vPrev.x * vLast.x + vPrev.y * vLast.y) / (mPrev * mLast);
        if (cosHook < 0.94 && mLast < 8.0) {
          refEnd = pts[n - 2];
          startI = n - 3;
        }
      }
    }
    let vxSum = 0.0, vySum = 0.0, accumDist = 0.0, count = 0;
    const targetDist = 10.0;
    for (let i = startI; i >= 0; i--) {
      const d = distPt(pts[i], refEnd);
      accumDist += distPt(pts[i], pts[i + 1]);
      if (d < 1e-4) continue;
      const w = accumDist < targetDist ? Math.max(0.15, 1.0 - accumDist / targetDist) : 0.15;
      vxSum += ((pts[i].x - refEnd.x) / d) * w;
      vySum += ((pts[i].y - refEnd.y) / d) * w;
      count++;
      if (accumDist >= targetDist && count >= 3) break;
    }
    const m = Math.hypot(vxSum, vySum);
    if (m > 1e-6) return { x: vxSum / m, y: vySum / m };
    const vx = pts[0].x - pts[n - 1].x, vy = pts[0].y - pts[n - 1].y;
    const mFb = Math.hypot(vx, vy);
    return mFb > 1e-6 ? { x: vx / mFb, y: vy / mFb } : { x: -1.0, y: 0.0 };
  }

  function estimateCenterTangent(pts, centerIdx) {
    const n = pts.length;
    const i1 = Math.max(0, centerIdx - 2);
    const i2 = Math.min(n - 1, centerIdx + 2);
    let vx = pts[i2].x - pts[i1].x, vy = pts[i2].y - pts[i1].y;
    let m = Math.hypot(vx, vy);
    if (m < 1e-6) {
      vx = pts[Math.min(n - 1, centerIdx + 1)].x - pts[Math.max(0, centerIdx - 1)].x;
      vy = pts[Math.min(n - 1, centerIdx + 1)].y - pts[Math.max(0, centerIdx - 1)].y;
      m = Math.hypot(vx, vy);
    }
    return m > 1e-6 ? { x: vx / m, y: vy / m } : { x: 1.0, y: 0.0 };
  }

  function chordLengthParameterize(pts) {
    const n = pts.length;
    const u = new Array(n).fill(0);
    for (let i = 1; i < n; i++) u[i] = u[i - 1] + distPt(pts[i], pts[i - 1]);
    const total = u[n - 1];
    if (total < 1e-9) {
      for (let i = 0; i < n; i++) u[i] = i / Math.max(1, n - 1);
    } else {
      for (let i = 0; i < n; i++) u[i] /= total;
    }
    return u;
  }

  function reparameterizeNewton(p0, p1, p2, p3, pts, u) {
    return u.map((ui, i) => {
      const q = bezierPt(p0, p1, p2, p3, ui);
      const qp = bezierPrime(p0, p1, p2, p3, ui);
      const qpp = bezierDoublePrime(p0, p1, p2, p3, ui);
      const diff = { x: q.x - pts[i].x, y: q.y - pts[i].y };
      const num = diff.x * qp.x + diff.y * qp.y;
      const den = (qp.x * qp.x + qp.y * qp.y) + (diff.x * qpp.x + diff.y * qpp.y);
      if (Math.abs(den) > 1e-6) {
        return Math.max(0.0, Math.min(1.0, ui - num / den));
      }
      return ui;
    });
  }

  function generateBezierLeastSquares(pts, tHat1, tHat2, u) {
    const p0 = { x: pts[0].x, y: pts[0].y };
    const p3 = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < pts.length; i++) {
      const ui = u[i], it = 1.0 - ui;
      const b0 = it * it * it;
      const b1 = 3.0 * it * it * ui;
      const b2 = 3.0 * it * ui * ui;
      const b3 = ui * ui * ui;
      const a1 = { x: tHat1.x * b1, y: tHat1.y * b1 };
      const a2 = { x: tHat2.x * b2, y: tHat2.y * b2 };
      c00 += dotVec(a1, a1);
      c01 += dotVec(a1, a2);
      c11 += dotVec(a2, a2);
      const tmp = {
        x: pts[i].x - (b0 * p0.x + b1 * p0.x + b2 * p3.x + b3 * p3.x),
        y: pts[i].y - (b0 * p0.y + b1 * p0.y + b2 * p3.y + b3 * p3.y)
      };
      x0 += dotVec(tmp, a1);
      x1 += dotVec(tmp, a2);
    }
    const detC = c00 * c11 - c01 * c01;
    const chord = distPt(p0, p3);
    let alphaL = Math.abs(detC) > 1e-9 ? (x0 * c11 - x1 * c01) / detC : chord / 3.0;
    let alphaR = Math.abs(detC) > 1e-9 ? (c00 * x1 - c01 * x0) / detC : chord / 3.0;
    if (alphaL < 1e-4) alphaL = Math.max(1e-3, chord / 3.0);
    if (alphaR < 1e-4) alphaR = Math.max(1e-3, chord / 3.0);
    const maxAlpha = Math.max(12.0, chord * 2.5);
    alphaL = Math.min(alphaL, maxAlpha);
    alphaR = Math.min(alphaR, maxAlpha);

    return [
      p0,
      { x: p0.x + tHat1.x * alphaL, y: p0.y + tHat1.y * alphaL },
      { x: p3.x + tHat2.x * alphaR, y: p3.y + tHat2.y * alphaR },
      p3
    ];
  }

  function computeMaxDeviation(pts, p0, p1, p2, p3, u) {
    let maxD = 0.0, splitIdx = Math.floor(pts.length / 2);
    for (let i = 1; i < pts.length - 1; i++) {
      const q = bezierPt(p0, p1, p2, p3, u[i]);
      const d = distPt(pts[i], q);
      if (d > maxD) { maxD = d; splitIdx = i; }
    }
    return { maxD, splitIdx };
  }

  function fitBezierRecursive(pts, tHat1, tHat2, tolerance, depth = 0, maxDepth = 6) {
    const n = pts.length;
    if (n < 2) return [];
    if (n === 2) {
      const chord = distPt(pts[0], pts[1]);
      return [[
        { x: pts[0].x, y: pts[0].y },
        { x: pts[0].x + tHat1.x * chord / 3.0, y: pts[0].y + tHat1.y * chord / 3.0 },
        { x: pts[1].x + tHat2.x * chord / 3.0, y: pts[1].y + tHat2.y * chord / 3.0 },
        { x: pts[1].x, y: pts[1].y }
      ]];
    }
    let u = chordLengthParameterize(pts);
    let [p0, p1, p2, p3] = generateBezierLeastSquares(pts, tHat1, tHat2, u);
    for (let step = 0; step < 2; step++) {
      u = reparameterizeNewton(p0, p1, p2, p3, pts, u);
      [p0, p1, p2, p3] = generateBezierLeastSquares(pts, tHat1, tHat2, u);
    }
    const { maxD, splitIdx } = computeMaxDeviation(pts, p0, p1, p2, p3, u);
    if (maxD <= tolerance || depth >= maxDepth) {
      return [[p0, p1, p2, p3]];
    }
    const tCenter = estimateCenterTangent(pts, splitIdx);
    const tCenterNeg = { x: -tCenter.x, y: -tCenter.y };
    const left = fitBezierRecursive(pts.slice(0, splitIdx + 1), tHat1, tCenterNeg, tolerance, depth + 1, maxDepth);
    const right = fitBezierRecursive(pts.slice(splitIdx), tCenter, tHat2, tolerance, depth + 1, maxDepth);
    return left.concat(right);
  }

  function fitSingleCubicBezier(rawPts) {
    const pts = pruneHoldDwellPoints(cleanRawPoints(rawPts, 0.75), 5.5);
    if (!pts.length) return [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    if (pts.length === 1) return [pts[0], pts[0], pts[0], pts[0]];
    if (pts.length === 2) {
      const p0 = pts[0], p3 = pts[1];
      return [
        { x: p0.x, y: p0.y },
        { x: p0.x + (p3.x - p0.x) / 3.0, y: p0.y + (p3.y - p0.y) / 3.0 },
        { x: p0.x + 2.0 * (p3.x - p0.x) / 3.0, y: p0.y + 2.0 * (p3.y - p0.y) / 3.0 },
        { x: p3.x, y: p3.y }
      ];
    }
    const tStart = estimateLeftTangent(pts);
    const tEnd = estimateRightTangent(pts);
    let u = chordLengthParameterize(pts);
    let [p0, p1, p2, p3] = generateBezierLeastSquares(pts, tStart, tEnd, u);
    u = reparameterizeNewton(p0, p1, p2, p3, pts, u);
    [p0, p1, p2, p3] = generateBezierLeastSquares(pts, tStart, tEnd, u);
    return [p0, p1, p2, p3];
  }

  function sampleCubicBezierPts(p0, p1, p2, p3, steps = 48) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      pts.push(bezierPt(p0, p1, p2, p3, i / steps));
    }
    return pts;
  }

  function smoothFreeCurve(rawPts, tolerance = 2.8) {
    const cleaned = cleanRawPoints(rawPts, 0.75);
    const pts = pruneHoldDwellPoints(cleaned, 5.5);
    if (pts.length < 4) return null;
    const tStart = estimateLeftTangent(pts);
    const tEnd = estimateRightTangent(pts);
    const segs = fitBezierRecursive(pts, tStart, tEnd, tolerance);
    if (!segs.length) return null;
    const sampled = [];
    segs.forEach(([p0, p1, p2, p3], idx) => {
      const chord = distPt(p0, p3);
      const polyLen = distPt(p0, p1) + distPt(p1, p2) + distPt(p2, p3);
      const nSteps = Math.max(10, Math.ceil(((chord + polyLen) * 0.5) / 2.0));
      for (let s = idx === 0 ? 0 : 1; s <= nSteps; s++) {
        sampled.push(bezierPt(p0, p1, p2, p3, s / nSteps));
      }
    });
    if (sampled.length >= 2) {
      sampled[0] = { x: pts[0].x, y: pts[0].y };
      sampled[sampled.length - 1] = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    }
    return sampled;
  }

  // ============================================================================
  // 3. TIỆN ÍCH TOÁN HỌC & TÁI TÍNH TOÁN ĐƯỜNG CONG QUA ĐIỂM ĐIỀU KHIỂN
  // ============================================================================
  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function polyLength(pts) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) s += distPt(pts[i], pts[i + 1]);
    return s;
  }

  function shoelaceArea(pts) {
    const n = pts.length;
    if (n < 3) return 0;
    let a = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) * 0.5;
  }

  function solve3x3Linear(A, B) {
    function det3(m) {
      return (
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
      );
    }
    const d = det3(A);
    if (Math.abs(d) < 1e-11) return null;
    const Ax = [[B[0], A[0][1], A[0][2]], [B[1], A[1][1], A[1][2]], [B[2], A[2][1], A[2][2]]];
    const Ay = [[A[0][0], B[0], A[0][2]], [A[1][0], B[1], A[1][2]], [A[2][0], B[2], A[2][2]]];
    const Az = [[A[0][0], A[0][1], B[0]], [A[1][0], A[1][1], B[1]], [A[2][0], A[2][1], B[2]]];
    return [det3(Ax) / d, det3(Ay) / d, det3(Az) / d];
  }

  /**
   * TÁI TẠO ĐƯỜNG CONG TỪ 4 ĐIỂM ĐIỀU KHIỂN CUBIC BÉZIER (P0, C1, C2, P3) GIỐNG HỆT BẢN EXE TRÊN PC!
   */
  function rebuildCurveFromControls(obj) {
    if (obj.bezierCtrlPts && obj.bezierCtrlPts.length === 4) {
      const [p0, c1, c2, p3] = obj.bezierCtrlPts;
      obj.points = sampleCubicBezierPts(p0, c1, c2, p3, 48);
    }
  }

  function attachCurveControls(obj, curveType, extra = {}) {
    const pts = obj.points || [];
    if (pts.length < 3) return obj;
    obj.curveType = curveType || 'duong_cong';
    if (extra.halfWaves) obj.halfWaves = extra.halfWaves;

    // Lưu bản gốc để sau khi giữ bút 1s, dịch chuyển mũi bút sẽ co giãn/xoay mượt mà theo mũi bút!
    obj.origPoints = pts.map((p) => ({ x: p.x, y: p.y }));

    // Đồng bộ 100% với bản EXE trên PC (nkpdf/infinite_canvas/view.py):
    // Mọi đường cong đều điều khiển bằng đúng 4 điểm Cubic Bézier: P0 (Đầu), C1 (Tiếp tuyến đầu), C2 (Tiếp tuyến đuôi), P3 (Cuối)!
    const ctrl4 = extra.bezierCtrlPts || fitSingleCubicBezier(pts);
    obj.bezierCtrlPts = ctrl4.map((p) => ({ x: p.x, y: p.y }));
    obj.origBezierCtrlPts = ctrl4.map((p) => ({ x: p.x, y: p.y }));
    delete obj.curveControls;
    delete obj.origCurveControls;
    return obj;
  }

  /**
   * CẬP NHẬT HÌNH NẮN THEO VỊ TRÍ MŨI BÚT ĐANG DI CHUYỂN (HOLD-THEN-DRAG LIVE MANIPULATION)
   * Đồng bộ 100% với InfiniteCanvasView.mouseMoveEvent & DocView.mouseMoveEvent trên PC!
   */
  function updateHeldShapeOnMove(snappedObj, targetPos, allObjects, snapPointEnabled, snapAngleEnabled, shiftKey = false) {
    if (!snappedObj) return null;
    let badge = null;

    // 1. ĐOẠN THẲNG CHUẨN
    if (snappedObj.type === 'duong') {
      let ex = targetPos.x, ey = targetPos.y;
      if (snapPointEnabled) {
        const sp = findNearestSnapPoint(allObjects, ex, ey, 14, { x: snappedObj.x1, y: snappedObj.y1 });
        if (sp) { ex = sp.x; ey = sp.y; badge = sp; }
      }
      if (!badge && (snapAngleEnabled || shiftKey)) {
        const sa = snapAnglePoint(snappedObj.x1, snappedObj.y1, ex, ey);
        ex = sa.x; ey = sa.y;
        if (sa.angleLabel) badge = { x: ex, y: ey, label: sa.angleLabel };
      }
      snappedObj.x2 = ex;
      snappedObj.y2 = ey;
      return badge;
    }

    // 2. DẤU CĂN BẬC HAI (√‾‾‾‾): Kéo dài / co ngắn thanh ngang & nâng hạ chiều cao căn theo mũi bút!
    if (snappedObj.isSqrt && snappedObj.points && snappedObj.points.length >= 4) {
      const orig = snappedObj.origSqrtPts || snappedObj.points.map((p) => ({ ...p }));
      if (!snappedObj.origSqrtPts) snappedObj.origSqrtPts = orig;
      const v1 = orig[1]; // Đáy nhọn V1 cố định
      const origV2 = orig[2];
      // Cho phép nâng/hạ nhẹ chiều cao thanh ngang hoặc giữ phẳng, và kéo dài/co ngắn đầu mút phải V3 tự do
      const minTopY = v1.y - 12;
      const newTopY = Math.min(minTopY, targetPos.y);
      const scaleH = Math.max(0.35, (v1.y - newTopY) / Math.max(8, v1.y - origV2.y));
      const newV0Y = v1.y - (v1.y - orig[0].y) * scaleH;
      const newV2X = v1.x + (origV2.x - v1.x) * Math.min(1.3, Math.max(0.75, scaleH));
      const newEndX = Math.max(newV2X + 10, targetPos.x);

      snappedObj.points[0] = { x: orig[0].x, y: newV0Y };
      snappedObj.points[1] = { x: v1.x, y: v1.y };
      snappedObj.points[2] = { x: newV2X, y: newTopY };
      snappedObj.points[3] = { x: newEndX, y: newTopY };
      const barLen = Math.round(newEndX - newV2X);
      badge = { x: newEndX, y: newTopY, label: `√ Thanh ngang: ${barLen}px` };
      return badge;
    }

    // 3. HỆ TRỤC TỌA ĐỘ OXY (2 mũi tên vuông góc): Kéo dài / thu ngắn trục Ox hoặc trục Oy theo mũi bút
    if (snappedObj.type === 'he_truc_oxy_nan') {
      const O = snappedObj.O;
      const dx = Math.abs(targetPos.x - O.x);
      const dy = Math.abs(targetPos.y - O.y);
      if (dx >= dy) {
        snappedObj.Px = { x: targetPos.x, y: O.y };
      } else {
        snappedObj.Py = { x: O.x, y: targetPos.y };
      }
      return badge;
    }

    // 4. ĐƯỜNG TRÒN / ELIP: Kéo để phóng to / thu nhỏ bán kính quanh tâm (chống giật nhỏ khi mới giữ bút)
    if (snappedObj.type === 'elip') {
      if (!snappedObj.origCenter) {
        snappedObj.origCenter = {
          x: snappedObj.x + snappedObj.w * 0.5,
          y: snappedObj.y + snappedObj.h * 0.5,
          isCircle: Math.abs(snappedObj.w - snappedObj.h) < 2.0
        };
      }
      if (snappedObj.holdStartPos && Math.hypot(targetPos.x - snappedObj.holdStartPos.x, targetPos.y - snappedObj.holdStartPos.y) < 10.0) {
        return badge;
      }
      const c = snappedObj.origCenter;
      const dx = Math.max(8, Math.abs(targetPos.x - c.x));
      const dy = Math.max(8, Math.abs(targetPos.y - c.y));
      if (c.isCircle || shiftKey) {
        const r = Math.max(8, Math.hypot(targetPos.x - c.x, targetPos.y - c.y));
        snappedObj.x = c.x - r;
        snappedObj.y = c.y - r;
        snappedObj.w = r * 2;
        snappedObj.h = r * 2;
        badge = { x: targetPos.x, y: targetPos.y, label: `R = ${Math.round(r)}px` };
      } else {
        snappedObj.x = c.x - dx;
        snappedObj.y = c.y - dy;
        snappedObj.w = dx * 2;
        snappedObj.h = dy * 2;
      }
      return badge;
    }

    // 5. HÌNH CHỮ NHẬT: Neo đúng góc ĐỐI DIỆN vị trí đầu bút để kéo co giãn tự nhiên (tuyệt đối không tự co thành hình chữ nhật nhỏ!)
    if (snappedObj.type === 'hcn') {
      if (snappedObj.holdStartPos && Math.hypot(targetPos.x - snappedObj.holdStartPos.x, targetPos.y - snappedObj.holdStartPos.y) < 10.0) {
        return badge;
      }
      if (!snappedObj.origP0) {
        snappedObj.origP0 = { x: snappedObj.x, y: snappedObj.y };
      }
      const p0 = snappedObj.origP0;
      let w = Math.abs(targetPos.x - p0.x);
      let h = Math.abs(targetPos.y - p0.y);
      if (shiftKey) {
        const side = Math.max(w, h);
        w = side; h = side;
      }
      snappedObj.x = Math.min(p0.x, targetPos.x);
      snappedObj.y = Math.min(p0.y, targetPos.y);
      snappedObj.w = Math.max(12, w);
      snappedObj.h = Math.max(12, h);
      return badge;
    }

    // 6. NỬA ĐƯỜNG TRÒN & TAM GIÁC
    if (snappedObj.type === 'tam_giac' && snappedObj.isSemicircle) {
      return null;
    }
    if (snappedObj.type === 'tam_giac' && snappedObj.points && snappedObj.points.length >= 3) {
      let q = { x: targetPos.x, y: targetPos.y };
      if (snapPointEnabled) {
        const sp = findNearestSnapPoint(allObjects, q.x, q.y, 14);
        if (sp) { q = { x: sp.x, y: sp.y }; badge = sp; }
      }
      snappedObj.points[2] = q;
      return badge;
    }

    // 7. MỌI ĐƯỜNG CONG (Parabol, Cung tròn, Sóng Sin/Cos, Hyperbol, Đường cong tự do Schneider Bézier):
    // Dịch chuyển mũi bút -> đường cong co giãn, xoay và biến thiên mượt theo đầu mút mới (kèm bắt điểm đầu mút!)
    if (snappedObj.type === 'but' && snappedObj.origPoints && snappedObj.origPoints.length >= 2) {
      const origPts = snappedObj.origPoints;
      const p0 = origPts[0];
      const pOrigEnd = origPts[origPts.length - 1];
      const chordOrig = Math.hypot(pOrigEnd.x - p0.x, pOrigEnd.y - p0.y);

      let q = { x: targetPos.x, y: targetPos.y };
      if (snapPointEnabled) {
        const sp = findNearestSnapPoint(allObjects, q.x, q.y, 14, p0);
        if (sp) { q = { x: sp.x, y: sp.y }; badge = sp; }
      }

      const chordNew = Math.hypot(q.x - p0.x, q.y - p0.y);
      if (chordOrig >= 8.0 && chordNew >= 8.0) {
        const angOrig = Math.atan2(pOrigEnd.y - p0.y, pOrigEnd.x - p0.x);
        const angNew = Math.atan2(q.y - p0.y, q.x - p0.x);
        const dAng = angNew - angOrig;
        const scale = chordNew / chordOrig;
        const cosA = Math.cos(dAng) * scale;
        const sinA = Math.sin(dAng) * scale;

        const transformPt = (pt) => {
          const rx = pt.x - p0.x, ry = pt.y - p0.y;
          return {
            x: p0.x + rx * cosA - ry * sinA,
            y: p0.y + rx * sinA + ry * cosA
          };
        };

        snappedObj.points = origPts.map(transformPt);
        if (snappedObj.origCurveControls) {
          snappedObj.curveControls = snappedObj.origCurveControls.map(transformPt);
        }
        if (snappedObj.origBezierCtrlPts) {
          snappedObj.bezierCtrlPts = snappedObj.origBezierCtrlPts.map(transformPt);
        }
      }
      return badge;
    }

    return badge;
  }

  // Biến dạng mượt đường cong tự do khi kéo 1 trong 5 điểm neo (fallback nếu không có bezierCtrlPts)
  function deformFreeCurve(obj, anchorIdx, newX, newY) {
    const pts = obj.points || [];
    if (pts.length < 5) return;
    const n = pts.length;
    const anchorPositions = [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1];
    const centerIdx = anchorPositions[anchorIdx] !== undefined ? anchorPositions[anchorIdx] : Math.floor(n * 0.5);
    const dx = newX - pts[centerIdx].x;
    const dy = newY - pts[centerIdx].y;
    const sigma = Math.max(3, n * 0.24);

    for (let i = 0; i < n; i++) {
      const distIdx = Math.abs(i - centerIdx);
      const w = Math.exp(-(distIdx * distIdx) / (2 * sigma * sigma));
      pts[i].x += dx * w;
      pts[i].y += dy * w;
    }
  }

  // ============================================================================
  // 4. CÁC BỘ NHẬN DẠNG CHUYÊN BIỆT (SMART SHAPE ENGINE V4)
  // ============================================================================
  function resampleStroke(pts, targetN = 64) {
    if (pts.length <= 1) return pts.slice();
    const totalL = polyLength(pts);
    if (totalL < 1e-4) return Array(targetN).fill(pts[0]);
    const step = totalL / (targetN - 1);
    const out = [pts[0]];
    let accum = 0, pIdx = 0;
    for (let i = 1; i < targetN - 1; i++) {
      const targetDist = i * step;
      while (pIdx < pts.length - 1) {
        const dSeg = distPt(pts[pIdx], pts[pIdx + 1]);
        if (accum + dSeg >= targetDist) {
          const t = (targetDist - accum) / Math.max(1e-6, dSeg);
          out.push({
            x: pts[pIdx].x + t * (pts[pIdx + 1].x - pts[pIdx].x),
            y: pts[pIdx].y + t * (pts[pIdx + 1].y - pts[pIdx].y)
          });
          break;
        }
        accum += dSeg;
        pIdx++;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function rdpSimplify(pts, eps) {
    if (pts.length <= 2) return pts.slice();
    let dmax = 0, idx = 0;
    const p0 = pts[0], pend = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) {
      const d = distToSegment(pts[i].x, pts[i].y, p0.x, p0.y, pend.x, pend.y);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
      const left = rdpSimplify(pts.slice(0, idx + 1), eps);
      const right = rdpSimplify(pts.slice(idx), eps);
      return left.slice(0, -1).concat(right);
    }
    return [p0, pend];
  }

  function recognizeHeTrucOxy(pts) {
    if (pts.length < 10) return null;
    const p0 = pts[0], pend = pts[pts.length - 1];
    const chord = distPt(p0, pend), totalLen = polyLength(pts);
    if (totalLen < 45 || chord < 22) return null;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (maxX - minX < 18 || maxY - minY < 18) return null;

    const ux = (pend.x - p0.x) / chord, uy = (pend.y - p0.y) / chord;
    const nx = -uy, ny = ux;
    let maxDist = 0, cornerIdx = -1;
    for (let i = 2; i < pts.length - 2; i++) {
      const d = Math.abs((pts[i].x - p0.x) * nx + (pts[i].y - p0.y) * ny);
      if (d > maxDist) { maxDist = d; cornerIdx = i; }
    }
    if (cornerIdx <= 0 || maxDist < 15) return null;

    const pc = pts[cornerIdx];
    const kStep = Math.max(2, Math.min(5, Math.floor(pts.length / 10)));
    const pBefore = pts[Math.max(0, cornerIdx - kStep)];
    const pAfter = pts[Math.min(pts.length - 1, cornerIdx + kStep)];
    const vIn = { x: pc.x - pBefore.x, y: pc.y - pBefore.y };
    const vOut = { x: pAfter.x - pc.x, y: pAfter.y - pc.y };
    const magIn = Math.hypot(vIn.x, vIn.y), magOut = Math.hypot(vOut.x, vOut.y);
    if (magIn < 1e-4 || magOut < 1e-4) return null;
    const turnDeg = Math.acos(Math.max(-1, Math.min(1, (vIn.x * vOut.x + vIn.y * vOut.y) / (magIn * magOut)))) * (180 / Math.PI);
    if (turnDeg < 48) return null;

    const v1 = { x: p0.x - pc.x, y: p0.y - pc.y };
    const v2 = { x: pend.x - pc.x, y: pend.y - pc.y };
    const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
    if (m1 < 16 || m2 < 16) return null;

    const angleDeg = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)))) * (180 / Math.PI);
    if (angleDeg < 65 || angleDeg > 115) return null;

    const n1x = -v1.y / m1, n1y = v1.x / m1;
    let dev1 = 0;
    for (let i = 0; i <= cornerIdx; i++) dev1 = Math.max(dev1, Math.abs((pts[i].x - pc.x) * n1x + (pts[i].y - pc.y) * n1y));
    if (dev1 / m1 > 0.18) return null;

    const n2x = -v2.y / m2, n2y = v2.x / m2;
    let dev2 = 0;
    for (let i = cornerIdx; i < pts.length; i++) dev2 = Math.max(dev2, Math.abs((pts[i].x - pc.x) * n2x + (pts[i].y - pc.y) * n2y));
    if (dev2 / m2 > 0.18) return null;

    const arm1Vert = Math.abs(v1.y) > Math.abs(v1.x);
    const arm2Vert = Math.abs(v2.y) > Math.abs(v2.x);
    if (arm1Vert === arm2Vert) return null;

    const ptVert = arm1Vert ? p0 : pend;
    const ptHoriz = arm1Vert ? pend : p0;
    const O = { x: pc.x, y: pc.y };
    return { O, Py: { x: O.x, y: ptVert.y }, Px: { x: ptHoriz.x, y: O.y } };
  }

  function recognizeSqrtSymbol(pts) {
    const n = pts.length;
    if (n < 5) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX, h = maxY - minY;
    if (w < 14 || h < 10) return null;

    let idxBot = 0;
    for (let i = 1; i < n; i++) if (pts[i].y > pts[idxBot].y) idxBot = i;
    if (idxBot < 2 || idxBot >= n - 2) return null;
    const xBot = pts[idxBot].x, yBot = pts[idxBot].y;
    if (xBot - minX > 0.62 * w) return null;

    let hasTick = false, xTick = xBot, yTick = yBot;
    let idxTick = 0;
    for (let i = 1; i <= idxBot; i++) if (pts[i].y < pts[idxTick].y) idxTick = i;
    xTick = pts[idxTick].x; yTick = pts[idxTick].y;
    if (yBot - yTick >= Math.max(8.0, 0.14 * h) && xBot - xTick >= 2.0) hasTick = true;
    // Bắt buộc dấu căn phải có nét móc đi xuống trước đáy (tránh nhận nhầm cung tròn đi lên)
    if (!hasTick) return null;

    const xEnd = pts[n - 1].x, yEnd = pts[n - 1].y;
    if (xEnd - minX < 0.42 * w || yEnd - minY > 0.65 * h) return null;

    const dxBe = xEnd - xBot, dyBe = yEnd - yBot, lenBe = Math.hypot(dxBe, dyBe);
    if (lenBe < 12) return null;

    let bestCorner = -1, maxDTl = -1e9;
    for (let i = idxBot + 1; i < n - 1; i++) {
      const dTl = ((pts[i].x - xBot) * dyBe - (pts[i].y - yBot) * dxBe) / lenBe;
      if (dTl > maxDTl) { maxDTl = dTl; bestCorner = i; }
    }
    if (bestCorner === -1 || maxDTl < Math.max(4.5, 0.09 * Math.min(w, h))) return null;

    const xCor = pts[bestCorner].x, yCor = pts[bestCorner].y;
    if (yCor - minY > 0.40 * h || xEnd - xCor < Math.max(10, 0.18 * w) || yBot - yCor < 0.42 * h) return null;
    if ((yBot - yCor) / Math.max(1, xCor - xBot) < 0.55) return null;
    if (Math.abs(yEnd - yCor) > 0.24 * h || Math.abs(yEnd - yCor) / Math.max(1, xEnd - xCor) > 0.28) return null;

    // Kiểm tra góc gập sắc nét tại đỉnh nối lên-ngang và độ thẳng của thanh ngang
    const vUpX = xCor - xBot, vUpY = yCor - yBot, lenUp = Math.hypot(vUpX, vUpY);
    const vBarX = xEnd - xCor, vBarY = yEnd - yCor, lenBar = Math.hypot(vBarX, vBarY);
    if (lenUp < 8 || lenBar < 10) return null;
    const cosTurn = Math.max(-1, Math.min(1, (vUpX * vBarX + vUpY * vBarY) / (lenUp * lenBar)));
    const turnDeg = Math.acos(cosTurn) * (180 / Math.PI);
    if (turnDeg < 28) return null;

    const barDx = Math.max(1, xEnd - xCor);
    for (let i = bestCorner; i < n; i++) {
      const expY = yCor + ((pts[i].x - xCor) * (yEnd - yCor)) / barDx;
      if (Math.abs(pts[i].y - expY) > Math.max(8.0, 0.14 * h)) return null;
    }

    const yTop = (yCor + yEnd) * 0.5;
    const xV2 = Math.max(xBot + Math.max(3, 0.04 * h), xCor);
    const xV0 = hasTick ? Math.min(xTick, xBot - Math.max(4, 0.08 * h)) : xBot - Math.max(6, 0.08 * w);
    const yV0 = hasTick ? Math.min(Math.max(yTick, yTop + 0.25 * h), yBot - Math.max(5, 0.15 * h)) : yBot - Math.max(8, 0.28 * h);

    return [{ x: xV0, y: yV0 }, { x: xBot, y: yBot }, { x: xV2, y: yTop }, { x: xEnd, y: yTop }];
  }

  function recognizeSineCosineWave(pts) {
    if (pts.length < 12) return null;
    const p0 = pts[0], pend = pts[pts.length - 1];
    const dx = pend.x - p0.x, dy = pend.y - p0.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 35 || polyLength(pts) / chord < 1.08) return null;

    const ux = dx / chord, uy = dy / chord, vxAxis = -uy, vyAxis = ux;
    const us = [], vs = [];
    for (const p of pts) {
      const rx = p.x - p0.x, ry = p.y - p0.y;
      us.push(rx * ux + ry * uy);
      vs.push(rx * vxAxis + ry * vyAxis);
    }
    const maxV = Math.max(...vs), minV = Math.min(...vs);
    if (!(maxV > 10 && minV < -10)) return null;

    const vMean = vs.reduce((a, b) => a + b, 0) / vs.length;
    const centered = vs.map((v) => v - vMean);
    let zc = 0;
    for (let i = 0; i < centered.length - 1; i++) {
      if ((centered[i] <= 0 && centered[i + 1] > 0) || (centered[i] >= 0 && centered[i + 1] < 0)) zc++;
    }
    const smoothV = vs.map((_, i) => {
      const sub = vs.slice(Math.max(0, i - 3), Math.min(vs.length, i + 4));
      return sub.reduce((a, b) => a + b, 0) / sub.length;
    });
    let extrema = 0;
    for (let i = 1; i < smoothV.length - 1; i++) {
      if ((smoothV[i] > smoothV[i - 1] && smoothV[i] > smoothV[i + 1]) ||
          (smoothV[i] < smoothV[i - 1] && smoothV[i] < smoothV[i + 1])) extrema++;
    }
    if (zc < 1 || extrema < 2) return null;

    const halfCands = new Set();
    for (const hc of [zc, extrema, Math.max(zc, extrema)]) {
      if (hc >= 2) {
        halfCands.add(hc);
        if (hc > 2) halfCands.add(hc - 1);
        halfCands.add(hc + 1);
        halfCands.add(hc + 2);
      }
    }

    let bestR2 = -1, bestParams = null, bestW = (Math.PI * Math.max(2, zc, extrema)) / chord, bestK = 2;
    const ssTot = vs.reduce((acc, v) => acc + (v - vMean) ** 2, 0);

    for (const k of Array.from(halfCands)) {
      const baseOmega = (Math.PI * k) / chord;
      for (const mult of [0.85, 0.92, 1.0, 1.08, 1.15]) {
        const w = baseOmega * mult;
        let s11 = 0, s12 = 0, s13 = 0, s22 = 0, s23 = 0, b1 = 0, b2 = 0, b3 = 0;
        const s33 = us.length;
        for (let i = 0; i < us.length; i++) {
          const u = us[i], v = vs[i], sw = Math.sin(w * u), cw = Math.cos(w * u);
          s11 += sw * sw; s12 += sw * cw; s13 += sw;
          s22 += cw * cw; s23 += cw;
          b1 += v * sw; b2 += v * cw; b3 += v;
        }
        const sol = solve3x3Linear([[s11, s12, s13], [s12, s22, s23], [s13, s23, s33]], [b1, b2, b3]);
        if (sol) {
          const [c1, c2, c0] = sol;
          let ssRes = 0;
          for (let i = 0; i < us.length; i++) {
            ssRes += (vs[i] - (c1 * Math.sin(w * us[i]) + c2 * Math.cos(w * us[i]) + c0)) ** 2;
          }
          const r2 = 1.0 - ssRes / Math.max(1e-6, ssTot);
          if (r2 > bestR2) { bestR2 = r2; bestParams = sol; bestW = w; bestK = k; }
        }
      }
    }
    if (bestR2 < 0.55 || !bestParams) return null;

    const [c1, c2, c0] = bestParams;
    const dense = [];
    for (let i = 0; i < 80; i++) {
      const uVal = (i / 79) * chord;
      const vVal = c1 * Math.sin(bestW * uVal) + c2 * Math.cos(bestW * uVal) + c0;
      dense.push({ x: p0.x + uVal * ux + vVal * vxAxis, y: p0.y + uVal * uy + vVal * vyAxis });
    }
    return { dense, halfWaves: bestK };
  }

  function fitKasaCircle(pts) {
    let sx2 = 0, sxy = 0, sx = 0, sy2 = 0, sy = 0, bx = 0, by = 0, b0 = 0;
    const N = pts.length;
    for (const p of pts) {
      const r2 = p.x * p.x + p.y * p.y;
      sx2 += p.x * p.x; sxy += p.x * p.y; sx += p.x;
      sy2 += p.y * p.y; sy += p.y;
      bx += p.x * r2; by += p.y * r2; b0 += r2;
    }
    const sol = solve3x3Linear([[sx2, sxy, sx], [sxy, sy2, sy], [sx, sy, N]], [bx, by, b0]);
    if (!sol) return null;
    const cx = sol[0] * 0.5, cy = sol[1] * 0.5;
    const val = sol[2] + cx * cx + cy * cy;
    if (val <= 0) return null;
    const R = Math.sqrt(val);
    let errSum = 0;
    for (const p of pts) errSum += Math.abs(Math.hypot(p.x - cx, p.y - cy) - R);
    return { cx, cy, R, relErr: (errSum / N) / Math.max(1, R) };
  }

  function recognizeCircularArc(pts, chord, totalLen, maxV, minV, maxAbsV) {
    if (chord < 16) return null;
    const lenRatio = totalLen / chord;
    if (lenRatio < 1.02 || lenRatio > 2.85) return null;
    if (Math.min(maxV, -minV) > Math.max(10, 0.22 * maxAbsV)) return null;

    const kasa = fitKasaCircle(pts);
    if (!kasa) return null;
    const { cx, cy, R, relErr } = kasa;
    if (R < 0.45 * chord || R > 4.2 * chord || relErr > 0.07) return null;

    const p0 = pts[0], pend = pts[pts.length - 1], pmid = pts[Math.floor(pts.length / 2)];
    const th0 = Math.atan2(p0.y - cy, p0.x - cx);
    const thEnd = Math.atan2(pend.y - cy, pend.x - cx);
    const thMid = Math.atan2(pmid.y - cy, pmid.x - cx);

    function normAng(a) {
      while (a <= -Math.PI) a += 2 * Math.PI;
      while (a > Math.PI) a -= 2 * Math.PI;
      return a;
    }
    const d1 = normAng(thMid - th0), d2 = normAng(thEnd - thMid);
    let delta;
    if (d1 > 0 && d2 > 0) delta = ((thEnd - th0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    else if (d1 < 0 && d2 < 0) delta = -(((th0 - thEnd) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
    else delta = normAng(thEnd - th0);

    const spanDeg = Math.abs(delta) * (180 / Math.PI);
    if (spanDeg < 22 || spanDeg > 315) return null;

    if (spanDeg < 160 && pts.length >= 8) {
      const pStart = pts[0], pEnd = pts[pts.length - 1];
      const dxC = pEnd.x - pStart.x, dyC = pEnd.y - pStart.y;
      const ch = Math.hypot(dxC, dyC) || 1;
      const nxC = -dyC / ch, nyC = dxC / ch;
      const q1 = pts[Math.floor(pts.length * 0.22)], q3 = pts[Math.floor(pts.length * 0.78)];
      const v1 = Math.abs((q1.x - pStart.x) * nxC + (q1.y - pStart.y) * nyC);
      const v3 = Math.abs((q3.x - pStart.x) * nxC + (q3.y - pStart.y) * nyC);
      if (Math.abs(v1 - v3) / Math.max(1, maxAbsV) > 0.45) return null;
    }

    const dense = [];
    for (let i = 0; i < 60; i++) {
      const th = th0 + (i / 59) * delta;
      dense.push({ x: cx + R * Math.cos(th), y: cy + R * Math.sin(th) });
    }
    return { dense, conf: Math.max(0.7, 0.995 - 1.5 * relErr) };
  }

  function recognizeParabola(pts, p0, chord, ux, uy, nx, ny, us, vs, maxV, minV, maxAbsV) {
    if (chord < 25 || (maxV > 8 && minV < -8) || maxAbsV / chord < 0.11) return null;
    let peakIdx = 0;
    for (let i = 1; i < vs.length; i++) if (Math.abs(vs[i]) > Math.abs(vs[peakIdx])) peakIdx = i;
    const peakU = us[peakIdx];
    if (peakU < 0.20 * chord || peakU > 0.80 * chord) return null;

    let s0 = us.length, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (let i = 0; i < us.length; i++) {
      const u = us[i], v = vs[i], u2 = u * u;
      s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2;
      t0 += v; t1 += u * v; t2 += u2 * v;
    }
    const sol = solve3x3Linear([[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]], [t2, t1, t0]);
    if (!sol) return null;
    const [a, b, c] = sol;
    if (Math.abs(a) < 1e-6) return null;

    const vMean = t0 / s0;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < us.length; i++) {
      ssTot += (vs[i] - vMean) ** 2;
      ssRes += (vs[i] - (a * us[i] * us[i] + b * us[i] + c)) ** 2;
    }
    const r2 = 1.0 - ssRes / Math.max(1e-6, ssTot);
    if (r2 < 0.86) return null;

    const dense = [];
    for (let i = 0; i < 60; i++) {
      const uVal = (i / 59) * chord;
      const vVal = a * uVal * uVal + b * uVal + c;
      dense.push({ x: p0.x + uVal * ux + vVal * nx, y: p0.y + uVal * uy + vVal * ny });
    }
    return { dense, conf: 0.94 * r2 };
  }

  function recognizeHyperbola(pts, chord, totalLen, maxAbsV) {
    if (chord < 30 || totalLen / chord < 1.04 || maxAbsV / chord < 0.06) return null;
    const n = pts.length;
    let posDx = 0, negDx = 0, posDy = 0, negDy = 0;
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      if (dx >= -0.5) posDx++;
      if (dx <= 0.5) negDx++;
      if (dy >= -0.5) posDy++;
      if (dy <= 0.5) negDy++;
    }
    if (!(posDx / (n - 1) > 0.88 || negDx / (n - 1) > 0.88)) return null;
    if (!(posDy / (n - 1) > 0.88 || negDy / (n - 1) > 0.88)) return null;

    const slope1 = Math.abs(pts[3].y - pts[0].y) / Math.max(1e-4, Math.abs(pts[3].x - pts[0].x));
    const slope2 = Math.abs(pts[n - 1].y - pts[n - 4].y) / Math.max(1e-4, Math.abs(pts[n - 1].x - pts[n - 4].x));
    if (Math.max(slope1, slope2) / Math.max(0.01, Math.min(slope1, slope2)) < 2.2) return null;

    let sy2 = 0, sxy = 0, sy = 0, sx2 = 0, sx = 0, rhs1 = 0, rhs2 = 0, rhs3 = 0;
    for (const p of pts) {
      sy2 += p.y * p.y; sxy += p.x * p.y; sy += p.y;
      sx2 += p.x * p.x; sx += p.x;
      rhs1 += p.x * p.y * p.y; rhs2 += p.x * p.x * p.y; rhs3 += p.x * p.y;
    }
    const sol = solve3x3Linear([[sy2, sxy, sy], [sxy, sx2, sx], [sy, sx, n]], [rhs1, rhs2, rhs3]);
    if (!sol) return null;
    const [x0Fit, y0Fit, c3] = sol;
    const kFit = c3 + x0Fit * y0Fit;

    const allPos = pts.every((p) => p.x - x0Fit > 0.5);
    const allNeg = pts.every((p) => p.x - x0Fit < -0.5);
    if (!allPos && !allNeg) return null;

    const yMean = sy / n;
    let ssTot = 0, ssRes = 0;
    for (const p of pts) {
      const denom = p.x - x0Fit;
      if (Math.abs(denom) < 1e-4) return null;
      ssTot += (p.y - yMean) ** 2;
      ssRes += (p.y - (y0Fit + kFit / denom)) ** 2;
    }
    const r2 = 1.0 - ssRes / Math.max(1e-6, ssTot);
    if (r2 < 0.85) return null;

    const dense = [];
    const xStart = pts[0].x, xEnd = pts[n - 1].x;
    for (let i = 0; i < 60; i++) {
      const xVal = xStart + (i / 59) * (xEnd - xStart);
      dense.push({ x: xVal, y: y0Fit + kFit / (xVal - x0Fit) });
    }
    return { dense, conf: Math.max(0.96, 0.99 * r2) };
  }

  function recognizeArrow(pts, style) {
    if (!pts || pts.length < 6) return null;
    const n = pts.length;
    const p0 = pts[0];
    let tipIdx = -1, maxDist = 0;
    const minSearch = Math.max(2, Math.floor(n * 0.25));
    for (let i = minSearch; i < n - 1; i++) {
      const d = distPt(p0, pts[i]);
      if (d > maxDist) { maxDist = d; tipIdx = i; }
    }
    if (tipIdx < 3 || tipIdx >= n - 1 || maxDist < 22) return null;

    const pTip = pts[tipIdx];
    const shaftPts = pts.slice(0, tipIdx + 1);
    const shaftPoly = polyLength(shaftPts);
    if (shaftPoly / maxDist > 1.14) return null;

    const ux = (pTip.x - p0.x) / maxDist, uy = (pTip.y - p0.y) / maxDist;
    const nx = -uy, ny = ux;
    let maxShaftDev = 0;
    for (const p of shaftPts) {
      const dev = Math.abs((p.x - p0.x) * nx + (p.y - p0.y) * ny);
      if (dev > maxShaftDev) maxShaftDev = dev;
    }
    if (maxShaftDev / maxDist > 0.095 && maxShaftDev > 7) return null;

    const tailPts = pts.slice(tipIdx);
    const tailLen = polyLength(tailPts);
    if (tailLen < 7 || tailLen > maxDist * 0.72) return null;

    let maxBack = 0, maxPerp = 0, maxFromTip = 0;
    for (const p of tailPts) {
      const dx = p.x - pTip.x, dy = p.y - pTip.y;
      const dTip = Math.hypot(dx, dy);
      if (dTip > maxFromTip) maxFromTip = dTip;
      const back = -(dx * ux + dy * uy);
      const perp = Math.abs(dx * nx + dy * ny);
      if (back > maxBack) maxBack = back;
      if (perp > maxPerp) maxPerp = perp;
    }
    if (maxFromTip > maxDist * 0.52 || maxBack < 4.5 || maxPerp < 3.5) return null;

    let x2 = pTip.x, y2 = pTip.y;
    const angDeg = Math.abs((Math.atan2(y2 - p0.y, x2 - p0.x) * 180) / Math.PI);
    if (angDeg <= 7.5 || Math.abs(angDeg - 180.0) <= 7.5) y2 = p0.y;
    else if (Math.abs(angDeg - 90.0) <= 7.5) x2 = p0.x;

    return {
      type: 'mui_ten',
      x1: p0.x, y1: p0.y, x2, y2,
      color: style.color, width: style.width, dashed: style.dashed,
      shapeLabel: 'Mũi tên chuẩn (→) — Dịch bút để xoay hoặc kéo dài!'
    };
  }

  function recognizeCornerAngle(pts) {
    if (!pts || pts.length < 6) return null;
    const n = pts.length, p0 = pts[0], pend = pts[n - 1];
    const chord = distPt(p0, pend);
    if (chord < 10) return null;
    const ux = (pend.x - p0.x) / chord, uy = (pend.y - p0.y) / chord;
    const nx = -uy, ny = ux;
    let bestIdx = -1, maxD = 0;
    const iMin = Math.max(2, Math.floor(n * 0.18)), iMax = Math.min(n - 3, Math.ceil(n * 0.82));
    for (let i = iMin; i <= iMax; i++) {
      const d = Math.abs((pts[i].x - p0.x) * nx + (pts[i].y - p0.y) * ny);
      if (d > maxD) { maxD = d; bestIdx = i; }
    }
    if (bestIdx < 0 || maxD < Math.max(8, chord * 0.22)) return null;

    const pc = pts[bestIdx];
    const l1 = distPt(p0, pc), l2 = distPt(pc, pend);
    if (l1 < 10 || l2 < 10) return null;
    const segDev = (sub, a, b, len) => {
      const sx = (b.x - a.x) / len, sy = (b.y - a.y) / len;
      let md = 0;
      for (const p of sub) {
        const d = Math.abs((p.x - a.x) * (-sy) + (p.y - a.y) * sx);
        if (d > md) md = d;
      }
      return md;
    };
    if (segDev(pts.slice(0, bestIdx + 1), p0, pc, l1) > Math.max(3.5, l1 * 0.08)) return null;
    if (segDev(pts.slice(bestIdx), pc, pend, l2) > Math.max(3.5, l2 * 0.08)) return null;

    const v1x = (p0.x - pc.x) / l1, v1y = (p0.y - pc.y) / l1;
    const v2x = (pend.x - pc.x) / l2, v2y = (pend.y - pc.y) / l2;
    const cosAng = Math.max(-1, Math.min(1, v1x * v2x + v1y * v2y));
    const angDeg = (Math.acos(cosAng) * 180) / Math.PI;
    if (angDeg < 25 || angDeg > 135) return null;
    return [p0, pc, pend];
  }

  function recognizeSemicircle(pts, diag) {
    const n = pts.length;
    if (n < 14 || diag < 36) return null;

    let bestScore = Infinity;
    let bestMatch = null;

    const evalSplit = (flatPts, arcPts, pa, pb, diam) => {
      if (flatPts.length < 3 || arcPts.length < 6) return;
      const lenFlat = polyLength(flatPts);
      if (lenFlat / diam > 1.09) return;
      let maxFlatErr = 0;
      for (const p of flatPts) {
        const d = distToSegment(p.x, p.y, pa.x, pa.y, pb.x, pb.y);
        if (d > maxFlatErr) maxFlatErr = d;
      }
      if (maxFlatErr > Math.max(9, 0.085 * diam)) return;

      const lenArc = polyLength(arcPts);
      const ratioArc = lenArc / diam;
      if (ratioArc < 1.16 || ratioArc > 2.08) return;

      const ox = (pa.x + pb.x) * 0.5;
      const oy = (pa.y + pb.y) * 0.5;
      const R = diam * 0.5;
      if (R < 14) return;

      let sumErr = 0;
      let maxRadErr = 0;
      const ux = (pb.x - pa.x) / diam;
      const uy = (pb.y - pa.y) / diam;
      let signedSum = 0;
      for (const p of arcPts) {
        const dr = Math.abs(Math.hypot(p.x - ox, p.y - oy) - R);
        sumErr += dr;
        if (dr > maxRadErr) maxRadErr = dr;
        signedSum += (p.x - pa.x) * (-uy) + (p.y - pa.y) * ux;
      }
      const meanErr = sumErr / arcPts.length;
      if (meanErr / R > 0.17 || maxRadErr / R > 0.34) return;

      const score = meanErr / R + maxFlatErr / diam;
      if (score < bestScore) {
        bestScore = score;
        bestMatch = { pa, pb, ox, oy, R, dir: signedSum >= 0 ? 1 : -1 };
      }
    };

    const step = n > 64 ? 2 : 1;
    for (let i = 0; i < n; i += step) {
      for (let j = i + 4; j < n; j += step) {
        const pa = pts[i], pb = pts[j];
        const diam = distPt(pa, pb);
        if (diam < 0.45 * diag) continue;
        const slice1 = pts.slice(i, j + 1);
        const slice2 = pts.slice(j).concat(pts.slice(0, i + 1));
        evalSplit(slice1, slice2, pa, pb, diam);
        evalSplit(slice2, slice1, pb, pa, diam);
      }
    }

    if (!bestMatch) return null;
    let ang0 = Math.atan2(bestMatch.pb.y - bestMatch.pa.y, bestMatch.pb.x - bestMatch.pa.x);
    const deg = (ang0 * 180) / Math.PI;
    const snapTargets = [-180, -90, 0, 90, 180];
    for (const t of snapTargets) {
      if (Math.abs(deg - t) <= 8.0) {
        ang0 = (t * Math.PI) / 180;
        break;
      }
    }

    const { ox, oy, R, dir } = bestMatch;
    const STEPS = 48;
    const semiPts = [];
    for (let k = 0; k <= STEPS; k++) {
      const a = ang0 + dir * (k / STEPS) * Math.PI;
      semiPts.push({ x: ox + R * Math.cos(a), y: oy + R * Math.sin(a) });
    }
    return { ox, oy, R, points: semiPts };
  }

  function recognizeSpecialShape(rawPts, style, isHandwriting = false) {
    if (!rawPts || rawPts.length < 4) return null;
    // Khử mạnh nhiễu rung đầu bút khi dừng giữ trên mặt kính iPad (bán kính 9.0px)
    const pruned = pruneHoldDwellPoints(cleanRawPoints(rawPts, 0.8), 9.0);
    if (pruned.length < 3) return null;
    const pts = resampleStroke(pruned, Math.max(36, Math.min(96, pruned.length)));
    const p0 = pts[0], pend = pts[pts.length - 1];
    const chord = distPt(p0, pend), totalLen = polyLength(pts);
    if (totalLen < 14) return null;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = Math.max(1e-4, maxX - minX), h = Math.max(1e-4, maxY - minY), diag = Math.hypot(w, h);
    if (diag < 16) return null;

    // Ưu tiên kiểm tra Dấu căn bậc hai (√‾‾‾‾) trước cả kiểm tra chữ viết tay
    const sqrtPts = recognizeSqrtSymbol(pts);
    if (sqrtPts) {
      return {
        type: 'but',
        points: sqrtPts,
        origSqrtPts: sqrtPts.map((p) => ({ ...p })),
        isPolyline: true,
        isSqrt: true,
        color: style.color, width: style.width, dashed: style.dashed,
        shapeLabel: 'Dấu căn bậc hai chuẩn (√) — Dịch bút để kéo dài/co ngắn thanh ngang!'
      };
    }

    const isClosed = (chord / totalLen < 0.25) || (chord < Math.max(18, diag * 0.26));
    const ux = chord > 1e-4 ? (pend.x - p0.x) / chord : 1;
    const uy = chord > 1e-4 ? (pend.y - p0.y) / chord : 0;
    const nx = -uy, ny = ux;

    const us = [], vs = [];
    for (const p of pts) {
      const rx = p.x - p0.x, ry = p.y - p0.y;
      us.push(rx * ux + ry * uy);
      vs.push(rx * nx + ry * ny);
    }
    const maxV = Math.max(...vs), minV = Math.min(...vs), maxAbsV = Math.max(Math.abs(maxV), Math.abs(minV));
    const lenRatio = totalLen / Math.max(1e-4, chord);

    if (!isClosed) {
      // Nhận diện nhanh Mũi tên 1 nét vẽ tay trước khi nắn thẳng
      const arrowObj = recognizeArrow(pts, style);
      if (arrowObj) return arrowObj;

      // Nới ngưỡng nhận diện đoạn thẳng thân thiện với mặt kính trơn & Apple Pencil 120Hz của iPad:
      // Đường cong nhẹ (nhất là nét xiên ~30° do xoay cổ tay) vẫn nắn thẳng; chỉ giữ cong khi thực sự cong rõ hoặc là sóng dao động nhiều chu kì!
      const devRatio = maxAbsV / Math.max(1, chord);
      const isOscillatingWave = lenRatio > 1.10 && Math.min(maxV, -minV) > Math.max(16, chord * 0.09);
      const isStraight = !isOscillatingWave && (
        (devRatio <= 0.115 && lenRatio <= 1.085) ||
        (maxAbsV <= 7.0 && devRatio <= 0.13 && lenRatio <= 1.085)
      );
      if (isStraight && chord >= 12) {
        let x2 = pend.x, y2 = pend.y;
        const angDeg = Math.abs((Math.atan2(y2 - p0.y, x2 - p0.x) * 180) / Math.PI);
        if (angDeg <= 7.5 || Math.abs(angDeg - 180.0) <= 7.5) {
          y2 = p0.y;
        } else if (Math.abs(angDeg - 90.0) <= 7.5) {
          x2 = p0.x;
        }
        return {
          type: 'duong',
          x1: p0.x, y1: p0.y, x2, y2,
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Đoạn thẳng chuẩn — Dịch bút để xoay hoặc kéo tới điểm bất kỳ!'
        };
      }

      const oxy = recognizeHeTrucOxy(pts);
      if (oxy) {
        return {
          type: 'he_truc_oxy_nan',
          O: oxy.O, Py: oxy.Py, Px: oxy.Px,
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Hệ trục tọa độ Oxy (2 mũi tên vuông góc) — Dịch bút để kéo dài trục!'
        };
      }

      if (isHandwriting) {
        return null;
      }

      // Bảo vệ chữ S viết tay (chiều cao >= chiều rộng, đi từ trên xuống dưới và uốn lượn) để giữ tay làm đẹp thành chữ S mượt
      if (h >= w * 0.95 && p0.y < pend.y - h * 0.45 && pts.length >= 6 && totalLen / Math.max(1, chord) >= 1.35) {
        return null;
      }

      const sinRes = recognizeSineCosineWave(pts);
      if (sinRes) {
        return attachCurveControls({
          type: 'but',
          points: sinRes.dense,
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Sóng hình Sin/Cos — Dịch bút để co giãn/xoay, hoặc kéo 3 điểm tròn!'
        }, 'sin_cos', { halfWaves: sinRes.halfWaves });
      }

      const cornerPts = recognizeCornerAngle(pts);
      if (cornerPts) {
        return {
          type: 'but',
          points: cornerPts,
          isPolyline: true,
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Nét gấp khúc sắc nét (∠ / <) — Đã nắn thẳng 2 cạnh!'
        };
      }

      const cands = [];
      const arcRes = recognizeCircularArc(pts, chord, totalLen, maxV, minV, maxAbsV);
      if (arcRes) cands.push({ pts: arcRes.dense, conf: arcRes.conf, ctype: 'cung_tron', label: 'Cung tròn chuẩn — Dịch bút để co giãn/xoay, hoặc kéo 3 điểm tròn!' });

      const parabRes = recognizeParabola(pts, p0, chord, ux, uy, nx, ny, us, vs, maxV, minV, maxAbsV);
      if (parabRes) {
        const conf = (arcRes && arcRes.conf >= 0.90) ? parabRes.conf * 0.88 : parabRes.conf;
        cands.push({ pts: parabRes.dense, conf, ctype: 'parabol', label: 'Đồ thị Parabol chuẩn — Dịch bút để co giãn/xoay, hoặc kéo đỉnh!' });
      }

      const hypRes = recognizeHyperbola(pts, chord, totalLen, maxAbsV);
      if (hypRes) cands.push({ pts: hypRes.dense, conf: hypRes.conf, ctype: 'hyperbol', label: 'Nhánh Hyperbol đẳng nhiệt p-V — Dịch bút để co giãn/xoay!' });

      if (cands.length > 0) {
        cands.sort((a, b) => b.conf - a.conf);
        const best = cands[0];
        if (best.conf >= 0.72) {
          return attachCurveControls({
            type: 'but',
            points: best.pts,
            color: style.color, width: style.width, dashed: style.dashed,
            shapeLabel: best.label
          }, best.ctype);
        }
      }

      // Fallback chuẩn bản PC (FreeCurveEngineV3 — Schneider Cubic Bézier):
      // Mọi đường cong mở vẽ tay khi giữ bút đều được làm mượt thành Đường cong Bézier chuẩn
      // và có thể dịch bút để co giãn/xoay ngay hoặc chỉnh 2 tay nắm tiếp tuyến C1, C2!
      if (chord >= 18) {
        const ctrl4 = fitSingleCubicBezier(pruned);
        const bezPts = smoothFreeCurve(pruned, 2.8) || sampleCubicBezierPts(ctrl4[0], ctrl4[1], ctrl4[2], ctrl4[3], 48);
        if (bezPts && bezPts.length >= 4) {
          return attachCurveControls({
            type: 'but',
            points: bezPts,
            color: style.color, width: style.width, dashed: style.dashed,
            shapeLabel: 'Đường cong mượt chuẩn (Bézier) — Dịch bút để co giãn/xoay, hoặc kéo tay đòn tiếp tuyến!'
          }, 'duong_cong', { bezierCtrlPts: ctrl4 });
        }
      }
      return null;
    }

    // Không nắn hình kín (Tròn, Tam giác, Chữ nhật, Elip) cho nét chữ viết tay quá nhỏ (như α, a, o, e, 0)
    if (diag < 36) return null;

    const area = shoelaceArea(pts), areaRatio = area / Math.max(1, w * h), aspect = w / h;
    if (aspect >= 0.72 && aspect <= 1.35) {
      const kasa = fitKasaCircle(pts);
      if (kasa && kasa.R >= 14) {
        const circleArea = Math.PI * kasa.R * kasa.R;
        if (kasa.relErr <= 0.09 && Math.abs(area - circleArea) / circleArea <= 0.26) {
          return {
            type: 'elip',
            x: kasa.cx - kasa.R, y: kasa.cy - kasa.R, w: kasa.R * 2, h: kasa.R * 2,
            origCenter: { x: kasa.cx, y: kasa.cy, isCircle: true },
            holdStartPos: { x: pend.x, y: pend.y },
            color: style.color, width: style.width, dashed: style.dashed,
            shapeLabel: 'Đường tròn chuẩn — Dịch bút để phóng to / thu nhỏ bán kính!'
          };
        }
      }
    }

    const semi = recognizeSemicircle(pts, diag);
    if (semi) {
      return {
        type: 'tam_giac',
        isSemicircle: true,
        semiCenter: { x: semi.ox, y: semi.oy },
        semiRadius: semi.R,
        points: semi.points,
        color: style.color, width: style.width, dashed: style.dashed,
        shapeLabel: 'Nửa đường tròn chuẩn (có tâm O)!'
      };
    }

    const eps = Math.max(7, diag * 0.075);
    let corners = rdpSimplify(pts, eps);
    if (corners.length >= 2 && distPt(corners[0], corners[corners.length - 1]) < eps * 1.5) corners = corners.slice(0, -1);

    // Chỉ nhận Tam giác khi hình đủ lớn (diag >= 44px), có đúng 3 cạnh thẳng thực sự (không phải chữ α hay nét cong có đuôi!)
    if (diag >= 44 && areaRatio >= 0.22 && areaRatio <= 0.62 && (corners.length === 3 || corners.length === 4)) {
      const tri = corners.slice(0, 3);
      const triPerim = distPt(tri[0], tri[1]) + distPt(tri[1], tri[2]) + distPt(tri[2], tri[0]);
      // Kiểm tra độ thẳng thực sự của 3 cạnh (mọi điểm trên nét vẽ phải bám sát 1 trong 3 cạnh tam giác)
      let maxEdgeErr = 0;
      for (const p of pts) {
        const d0 = distToSegment(p.x, p.y, tri[0].x, tri[0].y, tri[1].x, tri[1].y);
        const d1 = distToSegment(p.x, p.y, tri[1].x, tri[1].y, tri[2].x, tri[2].y);
        const d2 = distToSegment(p.x, p.y, tri[2].x, tri[2].y, tri[0].x, tri[0].y);
        const dMin = Math.min(d0, d1, d2);
        if (dMin > maxEdgeErr) maxEdgeErr = dMin;
      }
      if (triPerim > 60 && totalLen / triPerim <= 1.24 && maxEdgeErr / diag <= 0.11) {
        return {
          type: 'tam_giac',
          points: tri.map((p) => ({ x: p.x, y: p.y })),
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Tam giác chuẩn — Dịch bút để kéo đỉnh!'
        };
      }
    }

    if (areaRatio >= 0.62 && (corners.length === 4 || corners.length === 5)) {
      const verts = corners.slice(0, 4);
      let allRight = true;
      for (let i = 0; i < 4; i++) {
        const pPrev = verts[(i + 3) % 4], pCurr = verts[i], pNext = verts[(i + 1) % 4];
        const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y }, v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
        const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
        if (m1 < 5 || m2 < 5) { allRight = false; break; }
        const ang = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)))) * (180 / Math.PI);
        if (ang < 58 || ang > 122) { allRight = false; break; }
      }
      if (allRight) {
        // Chọn góc ĐỐI DIỆN xa vị trí đầu bút hiện tại nhất làm mốc cố định origP0 -> không bao giờ co nhỏ thành hình 8x8!
        const c4 = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY }
        ];
        let farCorner = c4[0], maxD = -1;
        for (const c of c4) {
          const d = distPt(c, pend);
          if (d > maxD) { maxD = d; farCorner = c; }
        }
        return {
          type: 'hcn',
          x: minX, y: minY, w, h,
          origP0: farCorner,
          holdStartPos: { x: pend.x, y: pend.y },
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Hình chữ nhật chuẩn — Dịch bút để co giãn kích thước!'
        };
      }
    }

    if (areaRatio >= 0.50 && areaRatio <= 0.90) {
      const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, a = w * 0.5, b = h * 0.5;
      let errSum = 0;
      for (const p of pts) errSum += Math.abs(Math.hypot((p.x - cx) / a, (p.y - cy) / b) - 1.0);
      if (errSum / pts.length <= 0.15) {
        return {
          type: 'elip',
          x: minX, y: minY, w, h,
          origCenter: { x: cx, y: cy, isCircle: false },
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Đường Elip chuẩn — Dịch bút để co giãn hai bán trục!'
        };
      }
    }

    return null;
  }

  // ============================================================================
  // 4B. NHẬN DIỆN XOÁY BÚT NHIỀU VÒNG ĐỂ XÓA NHANH (GOODNOTES SCRIBBLE-TO-ERASE)
  // Khi viết vòng vòng nhiều vòng xoáy hoặc gạch dích dắc qua lại đè lên đối tượng:
  // Tự động hủy nét xoáy và xóa ngay các đối tượng bên dưới mà không cần đổi sang Cục tẩy!
  // ============================================================================
  function detectScribbleErase(rawPts, existingList = [], hitRadius = 18) {
    const emptyRes = { isScribble: false, isStrongSwirl: false, hitIndices: [] };
    if (!rawPts || rawPts.length < 18) return emptyRes;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of rawPts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX, h = maxY - minY;
    const diag = Math.hypot(w, h);
    if (diag < 16) return emptyRes;

    const totalLen = polyLength(rawPts);
    const density = totalLen / Math.max(1, diag);
    // 1 vòng tròn chỉ có mật độ ~2.22; xoáy 5-6 vòng trở lên luôn có mật độ >= 6.5 (tuyệt đối không nhầm khi vẽ hình tròn/elip!)
    if (density < 6.2) return emptyRes;

    // Lọc bước điểm >= 4.5px để loại bỏ nhiễu cảm ứng nhỏ khi tính góc quay
    const sub = [rawPts[0]];
    for (let i = 1; i < rawPts.length; i++) {
      if (distPt(rawPts[i], sub[sub.length - 1]) >= 4.5) {
        sub.push(rawPts[i]);
      }
    }
    if (sub.length < 10) return emptyRes;

    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;

    // 1. Tính tổng số vòng cuốn quanh tâm (Winding Cycles) và tổng góc ngoặt tiếp tuyến (Tangent Turn Cycles)
    let absWindingRad = 0;
    let prevAngCenter = null;
    for (const p of sub) {
      if (Math.hypot(p.x - cx, p.y - cy) >= 3.0) {
        const ang = Math.atan2(p.y - cy, p.x - cx);
        if (prevAngCenter !== null) {
          let d = ang - prevAngCenter;
          while (d <= -Math.PI) d += 2 * Math.PI;
          while (d > Math.PI) d -= 2 * Math.PI;
          absWindingRad += Math.abs(d);
        }
        prevAngCenter = ang;
      }
    }

    let totalTurnRad = 0;
    let sharpReversals = 0;
    let prevSegAng = null;
    for (let i = 0; i < sub.length - 1; i++) {
      const dx = sub[i + 1].x - sub[i].x, dy = sub[i + 1].y - sub[i].y;
      if (Math.hypot(dx, dy) < 3.0) continue;
      const segAng = Math.atan2(dy, dx);
      if (prevSegAng !== null) {
        let d = segAng - prevSegAng;
        while (d <= -Math.PI) d += 2 * Math.PI;
        while (d > Math.PI) d -= 2 * Math.PI;
        const absD = Math.abs(d);
        totalTurnRad += absD;
        if (absD >= 2.0) sharpReversals++; // Ngoặt ngược chiều > ~115°
      }
      prevSegAng = segAng;
    }

    // Tính chính xác số vòng quay quanh tâm (không cộng nhiễu góc nhỏ) để đảm bảo PHẢI xoáy >= 5 vòng mới xóa!
    const centerLoops = absWindingRad / (2 * Math.PI);

    // 2. Kiểm tra độ tập trung tại chỗ (Phân biệt xoáy xóa tại chỗ với việc viết chữ dài hoặc vẽ lò xo tiến đều)
    const third = Math.max(3, Math.floor(sub.length / 3));
    const centroidOf = (arr) => {
      let sx = 0, sy = 0;
      for (const p of arr) { sx += p.x; sy += p.y; }
      return { x: sx / arr.length, y: sy / arr.length };
    };
    const c1 = centroidOf(sub.slice(0, third));
    const c3 = centroidOf(sub.slice(sub.length - third));
    const driftRatio = Math.hypot(c3.x - c1.x, c3.y - c1.y) / Math.max(1, diag);

    // Mẫu A: Xoáy tròn liên tiếp từ 5 vòng trở lên tại chỗ (>= 4.6 vòng thực quanh tâm & mật độ >= 7.2)
    const isMultiLoopSwirl = centerLoops >= 4.6 && density >= 7.2 && driftRatio <= 0.72;
    // Mẫu B: Gạch xoáy dích dắc qua lại rất nhiều lần (>= 8 lần đảo chiều gấp & mật độ >= 6.5)
    const isZigZagScratch = sharpReversals >= 8 && density >= 6.5 && driftRatio <= 0.72;

    if (!isMultiLoopSwirl && !isZigZagScratch) return emptyRes;

    const isStrongSwirl = (centerLoops >= 5.2 && density >= 8.5) || (sharpReversals >= 10 && density >= 7.5);

    // 3. Tìm CHÍNH XÁC các đối tượng thực sự ĐỤNG / GIAO với nét xoáy bút (bán kính siêu hẹp 3.5-5px)
    // Ví dụ viết ax^2 rồi xoáy vào x -> CHỈ xóa chữ x, KHÔNG làm bay chữ a và số 2 bên cạnh!
    const hitIndices = [];
    if (existingList && existingList.length > 0) {
      const step = Math.max(1, Math.floor(sub.length / 48));
      const testPts = [];
      for (let i = 0; i < sub.length; i += step) testPts.push(sub[i]);

      const pad = Math.max(3.0, Math.min(6.0, hitRadius));
      const sx0 = minX - pad, sy0 = minY - pad, sx1 = maxX + pad, sy1 = maxY + pad;

      existingList.forEach((obj, idx) => {
        if (!obj || obj.hidden) return;
        const b = getObjectBBox(obj);
        if (b.x1 < sx0 || b.x0 > sx1 || b.y1 < sy0 || b.y0 > sy1) return;

        const touchTol = Math.max(pad, (obj.width || 2.6) * 0.65 + 2.2);
        for (const tp of testPts) {
          if (hitDistanceToObject(obj, tp.x, tp.y) <= touchTol) {
            hitIndices.push(idx);
            break;
          }
        }
      });
    }

    return {
      isScribble: hitIndices.length > 0 || isStrongSwirl,
      isStrongSwirl,
      hitIndices
    };
  }

  // ============================================================================
  // 5. ĐỈNH ĐIỀU KHIỂN ĐỐI TƯỢNG, XOAY 360° & ĐƯỜNG CONG (GET/SET VERTICES)
  // ============================================================================
  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi)) inside = !inside;
    }
    return inside;
  }

  function computeShape3DGeometry(obj) {
    const kind = obj.kind3d || 'chop_tu_giac';
    const cx = obj.cx || 0;
    const cy = obj.cy || 0;
    const s = Math.max(24, obj.size || 110);
    const yaw = obj.yaw !== undefined ? obj.yaw : 0.42;
    const pitch = obj.pitch !== undefined ? obj.pitch : 0.34;
    const showAux = obj.showAux !== false;
    const ap = obj.apexOffset || { dx: 0, dy: 0, dz: 0 };

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

    const projectPt = (x, y, z) => {
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      const y1 = y;
      const y2 = y1 * cosP - z1 * sinP;
      const z2 = y1 * sinP + z1 * cosP;
      return { x: cx + x1 * s, y: cy - y2 * s, x3: x1, y3: y2, z3: z2 };
    };

    const lines = [];
    const arcs = [];
    const vertices = [];

    const addPolyhedron = (verts3d, labels, faces, auxPairs, apexIdx = -1) => {
      // Tính trọng tâm khối để tự định hướng pháp tuyến mặt ra ngoài 100%
      let mx = 0, my = 0, mz = 0;
      for (const v of verts3d) { mx += v[0]; my += v[1]; mz += v[2]; }
      mx /= verts3d.length; my /= verts3d.length; mz /= verts3d.length;

      const proj = verts3d.map((v) => projectPt(v[0], v[1], v[2]));
      const faceVisible = faces.map((f) => {
        const a = verts3d[f[0]], b = verts3d[f[1]], c = verts3d[f[2]];
        const u1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const u2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nx = u1[1] * u2[2] - u1[2] * u2[1];
        let ny = u1[2] * u2[0] - u1[0] * u2[2];
        let nz = u1[0] * u2[1] - u1[1] * u2[0];
        // Hướng ra ngoài so với trọng tâm khối
        let fcx = 0, fcy = 0, fcz = 0;
        for (const vi of f) { fcx += verts3d[vi][0]; fcy += verts3d[vi][1]; fcz += verts3d[vi][2]; }
        fcx /= f.length; fcy /= f.length; fcz /= f.length;
        if (nx * (fcx - mx) + ny * (fcy - my) + nz * (fcz - mz) < 0) {
          nx = -nx; ny = -ny; nz = -nz;
        }
        // Chiếu pháp tuyến sang không gian camera (+z3 hướng về người nhìn)
        const nx1 = nx * cosY + nz * sinY;
        const nz1 = -nx * sinY + nz * cosY;
        const ny1 = ny;
        const nz2 = ny1 * sinP + nz1 * cosP;
        return nz2 > 1e-4;
      });

      const edgeMap = new Map();
      faces.forEach((f, fi) => {
        for (let i = 0; i < f.length; i++) {
          const u = f[i], v = f[(i + 1) % f.length];
          const key = u < v ? `${u}_${v}` : `${v}_${u}`;
          if (!edgeMap.has(key)) edgeMap.set(key, { u, v, vis: false });
          if (faceVisible[fi]) edgeMap.get(key).vis = true;
        }
      });

      for (const e of edgeMap.values()) {
        lines.push({
          x1: proj[e.u].x, y1: proj[e.u].y,
          x2: proj[e.v].x, y2: proj[e.v].y,
          dashed: !e.vis
        });
      }

      if (showAux && auxPairs) {
        for (const [u, v] of auxPairs) {
          lines.push({
            x1: proj[u].x, y1: proj[u].y,
            x2: proj[v].x, y2: proj[v].y,
            dashed: true,
            isAux: true
          });
        }
      }

      proj.forEach((p, idx) => {
        const lbl = labels[idx];
        if (!lbl) return;
        const isCenter = lbl === 'O' || lbl === "O'";
        if (isCenter && !showAux) return;
        vertices.push({
          x: p.x, y: p.y,
          label: lbl,
          role: idx === apexIdx ? 'apex' : `v3d_${idx}`,
          isCenter
        });
      });
    };

    if (kind === 'chop_tg') {
      const yB = -0.52, r = 0.96;
      const a0 = [r * Math.cos(Math.PI * 0.85), yB, r * Math.sin(Math.PI * 0.85)];
      const a1 = [r * Math.cos(Math.PI * 0.12), yB, r * Math.sin(Math.PI * 0.12)];
      const a2 = [r * Math.cos(-Math.PI * 0.55), yB, r * Math.sin(-Math.PI * 0.55)];
      const oPt = [(a0[0] + a1[0] + a2[0]) / 3, yB, (a0[2] + a1[2] + a2[2]) / 3];
      const sPt = [oPt[0] + (ap.dx || 0), 0.92 + (ap.dy || 0), oPt[2] + (ap.dz || 0)];
      addPolyhedron(
        [a0, a1, a2, sPt, oPt],
        ['A', 'C', 'B', 'S', 'O'],
        [[0, 1, 2], [3, 0, 1], [3, 1, 2], [3, 2, 0]],
        [[3, 4]],
        3
      );
    } else if (kind === 'chop_tu_giac') {
      const yB = -0.52, r = 0.82;
      const verts = [
        [-r, yB, -r], [r, yB, -r], [r, yB, r], [-r, yB, r],
        [ap.dx || 0, 0.92 + (ap.dy || 0), ap.dz || 0],
        [0, yB, 0]
      ];
      addPolyhedron(
        verts,
        ['A', 'B', 'C', 'D', 'S', 'O'],
        [[0, 1, 2, 3], [4, 0, 1], [4, 1, 2], [4, 2, 3], [4, 3, 0]],
        [[0, 2], [1, 3], [4, 5]],
        4
      );
    } else if (kind === 'lap_phuong') {
      const r = 0.72, h = 0.72;
      const verts = [
        [-r, -h, -r], [r, -h, -r], [r, -h, r], [-r, -h, r],
        [-r, h, -r], [r, h, -r], [r, h, r], [-r, h, r]
      ];
      addPolyhedron(
        verts,
        ['A', 'B', 'C', 'D', "A'", "B'", "C'", "D'"],
        [
          [0, 1, 2, 3], [4, 5, 6, 7],
          [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]
        ],
        [],
        -1
      );
    } else if (kind === 'lang_tru_tg') {
      const yB = -0.68, yT = 0.72, r = 0.85;
      const b0 = [r * Math.cos(Math.PI * 0.85), yB, r * Math.sin(Math.PI * 0.85)];
      const b1 = [r * Math.cos(Math.PI * 0.12), yB, r * Math.sin(Math.PI * 0.12)];
      const b2 = [r * Math.cos(-Math.PI * 0.55), yB, r * Math.sin(-Math.PI * 0.55)];
      const t0 = [b0[0], yT, b0[2]], t1 = [b1[0], yT, b1[2]], t2 = [b2[0], yT, b2[2]];
      addPolyhedron(
        [b0, b1, b2, t0, t1, t2],
        ['A', 'C', 'B', "A'", "C'", "B'"],
        [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]],
        [],
        -1
      );
    } else if (kind === 'hinh_non') {
      const yB = -0.52, R = 0.92;
      const pO = projectPt(0, yB, 0);
      const pS = projectPt(ap.dx || 0, 0.95 + (ap.dy || 0), ap.dz || 0);
      const rx = R * s;
      const ry = Math.max(8, rx * Math.max(0.14, Math.abs(sinP)));
      const pA = { x: pO.x + rx, y: pO.y };
      const u = (pS.x - pO.x) / rx, v = (pS.y - pO.y) / ry;
      const d2 = u * u + v * v;
      if (d2 > 1.02) {
        const baseA = Math.atan2(v, u);
        const da = Math.acos(1.0 / Math.sqrt(d2));
        const th1 = baseA - da, th2 = baseA + da;
        const t1 = { x: pO.x + rx * Math.cos(th1), y: pO.y + ry * Math.sin(th1) };
        const t2 = { x: pO.x + rx * Math.cos(th2), y: pO.y + ry * Math.sin(th2) };
        lines.push({ x1: pS.x, y1: pS.y, x2: t1.x, y2: t1.y, dashed: false });
        lines.push({ x1: pS.x, y1: pS.y, x2: t2.x, y2: t2.y, dashed: false });
        // Chọn cung quay về phía trước (có sin(mid) ngược dấu với v, tức phía đối diện S trên màn hình)
        let norm1 = ((th2 - th1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        const mid1 = th1 + norm1 * 0.5;
        const mid2 = th2 + (Math.PI * 2 - norm1) * 0.5;
        const s1 = (Math.sin(mid1) * (pS.y <= pO.y ? 1 : -1)) > (Math.sin(mid2) * (pS.y <= pO.y ? 1 : -1));
        arcs.push({ cx: pO.x, cy: pO.y, rx, ry, startAngle: th1, endAngle: th2, ccw: false, dashed: !s1 });
        arcs.push({ cx: pO.x, cy: pO.y, rx, ry, startAngle: th2, endAngle: th1, ccw: false, dashed: s1 });
      } else {
        arcs.push({ cx: pO.x, cy: pO.y, rx, ry, startAngle: 0, endAngle: Math.PI * 2, ccw: false, dashed: false });
      }
      if (showAux) {
        lines.push({ x1: pS.x, y1: pS.y, x2: pO.x, y2: pO.y, dashed: true, isAux: true });
        lines.push({ x1: pO.x, y1: pO.y, x2: pA.x, y2: pA.y, dashed: true, isAux: true });
      }
      vertices.push({ x: pS.x, y: pS.y, label: 'S', role: 'apex', isCenter: false });
      if (showAux) {
        vertices.push({ x: pO.x, y: pO.y, label: 'O', role: 'v3d_center', isCenter: true });
        vertices.push({ x: pA.x, y: pA.y, label: 'A', role: 'v3d_rim', isCenter: false });
      }
    } else if (kind === 'hinh_tru') {
      const yB = -0.65, yT = 0.65, R = 0.85;
      const pO = projectPt(0, yB, 0);
      const pOp = projectPt(0, yT, 0);
      const rx = R * s;
      const ry = Math.max(8, rx * Math.max(0.14, Math.abs(sinP)));
      const topFrontAll = sinP >= 0;
      arcs.push({ cx: pOp.x, cy: pOp.y, rx, ry, startAngle: 0, endAngle: Math.PI * 2, ccw: false, dashed: !topFrontAll });
      if (!topFrontAll) {
        arcs.push({ cx: pOp.x, cy: pOp.y, rx, ry, startAngle: Math.PI, endAngle: Math.PI * 2, ccw: false, dashed: false });
      }
      // Đáy dưới: nửa trước nét liền, nửa sau nét đứt
      arcs.push({ cx: pO.x, cy: pO.y, rx, ry, startAngle: 0, endAngle: Math.PI, ccw: false, dashed: !topFrontAll });
      arcs.push({ cx: pO.x, cy: pO.y, rx, ry, startAngle: Math.PI, endAngle: Math.PI * 2, ccw: false, dashed: topFrontAll });
      lines.push({ x1: pOp.x - rx, y1: pOp.y, x2: pO.x - rx, y2: pO.y, dashed: false });
      lines.push({ x1: pOp.x + rx, y1: pOp.y, x2: pO.x + rx, y2: pO.y, dashed: false });
      if (showAux) {
        lines.push({ x1: pOp.x, y1: pOp.y, x2: pO.x, y2: pO.y, dashed: true, isAux: true });
        lines.push({ x1: pO.x, y1: pO.y, x2: pO.x + rx, y2: pO.y, dashed: true, isAux: true });
        vertices.push({ x: pO.x, y: pO.y, label: 'O', role: 'v3d_o', isCenter: true });
        vertices.push({ x: pOp.x, y: pOp.y, label: "O'", role: 'v3d_op', isCenter: true });
      }
    } else if (kind === 'mat_cau') {
      const r = 0.92 * s;
      const ry = Math.max(8, r * Math.max(0.18, Math.abs(sinP)));
      arcs.push({ cx, cy, rx: r, ry: r, startAngle: 0, endAngle: Math.PI * 2, ccw: false, dashed: false });
      arcs.push({ cx, cy, rx: r, ry, startAngle: 0, endAngle: Math.PI, ccw: false, dashed: false });
      arcs.push({ cx, cy, rx: r, ry, startAngle: Math.PI, endAngle: Math.PI * 2, ccw: false, dashed: true });
      if (showAux) {
        lines.push({ x1: cx, y1: cy, x2: cx + r, y2: cy, dashed: true, isAux: true });
        vertices.push({ x: cx, y: cy, label: 'O', role: 'v3d_o', isCenter: true });
        vertices.push({ x: cx + r, y: cy, label: 'A', role: 'v3d_a', isCenter: false });
      }
    }

    let x0 = cx - s, y0 = cy - s, x1 = cx + s, y1 = cy + s;
    if (lines.length || arcs.length) {
      x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
      for (const ln of lines) {
        x0 = Math.min(x0, ln.x1, ln.x2); y0 = Math.min(y0, ln.y1, ln.y2);
        x1 = Math.max(x1, ln.x1, ln.x2); y1 = Math.max(y1, ln.y1, ln.y2);
      }
      for (const ar of arcs) {
        x0 = Math.min(x0, ar.cx - ar.rx); y0 = Math.min(y0, ar.cy - ar.ry);
        x1 = Math.max(x1, ar.cx + ar.rx); y1 = Math.max(y1, ar.cy + ar.ry);
      }
    }
    return { lines, arcs, vertices, bbox: { x0, y0, x1, y1 } };
  }

  function explodeShape3D(obj) {
    const geom = computeShape3DGeometry(obj);
    const out = [];
    const c = obj.color || '#ffd60a';
    const w = obj.width || 2.4;
    for (const ln of geom.lines) {
      out.push({ type: 'duong', x1: ln.x1, y1: ln.y1, x2: ln.x2, y2: ln.y2, color: c, width: ln.dashed ? Math.max(1.5, w * 0.85) : w, dashed: Boolean(ln.dashed) });
    }
    for (const ar of geom.arcs) {
      let span = ar.endAngle - ar.startAngle;
      while (span <= 0) span += Math.PI * 2;
      if (Math.abs(ar.endAngle - ar.startAngle - Math.PI * 2) < 1e-4) span = Math.PI * 2;
      const steps = Math.max(16, Math.round((span / (Math.PI * 2)) * 48));
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = ar.startAngle + span * (i / steps);
        pts.push({ x: ar.cx + ar.rx * Math.cos(a), y: ar.cy + ar.ry * Math.sin(a) });
      }
      out.push({ type: 'but', points: pts, isPolyline: true, color: c, width: ar.dashed ? Math.max(1.5, w * 0.85) : w, dashed: Boolean(ar.dashed) });
    }
    for (const v of geom.vertices) {
      out.push({ type: 'diem', x: v.x, y: v.y, text: v.label, color: c });
    }
    return out;
  }

  function getObjectBBox(obj) {
    if (obj.type === 'shape3d') {
      return computeShape3DGeometry(obj).bbox;
    }
    if (obj.type === 'shape3d') {
      const geom = computeShape3DGeometry(obj);
      const col = obj.color || '#ffd60a';
      const w = obj.width || 2.4;
      ctx.save();
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const ln of geom.lines) {
        ctx.save();
        const isDash = !obj.solidForMask && ln.dashed;
        ctx.lineWidth = isDash ? Math.max(1.4, w * 0.82) : w;
        if (isDash) ctx.setLineDash([w * 2.5, w * 1.9]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ln.x1, ln.y1);
        ctx.lineTo(ln.x2, ln.y2);
        ctx.stroke();
        ctx.restore();
      }
      for (const ar of geom.arcs) {
        ctx.save();
        const isDash = !obj.solidForMask && ar.dashed;
        ctx.lineWidth = isDash ? Math.max(1.4, w * 0.82) : w;
        if (isDash) ctx.setLineDash([w * 2.5, w * 1.9]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(ar.cx, ar.cy, ar.rx, ar.ry, 0, ar.startAngle, ar.endAngle, Boolean(ar.ccw));
        ctx.stroke();
        ctx.restore();
      }
      if (!obj.solidForMask) {
        const show3DLbls = obj.show3DLabels !== undefined ? obj.show3DLabels : showLabels;
        for (const v of geom.vertices) {
          if (showPointDots || v.isCenter) {
            ctx.beginPath();
            ctx.arc(v.x, v.y, v.isCenter ? 3.2 : 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
          if (show3DLbls && v.label) {
            ctx.font = 'bold 14px "Segoe UI", sans-serif';
            ctx.fillText(v.label, v.x + 6, v.y - 6);
          }
        }
      }
      ctx.restore();
      return;
    }
    if (obj.type === 'he_truc_oxy_nan') {
      return {
        x0: Math.min(obj.O.x, obj.Py.x, obj.Px.x),
        y0: Math.min(obj.O.y, obj.Py.y, obj.Px.y),
        x1: Math.max(obj.O.x, obj.Py.x, obj.Px.x),
        y1: Math.max(obj.O.y, obj.Py.y, obj.Px.y)
      };
    }
    if (obj.points && obj.points.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of obj.points) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      return { x0, y0, x1, y1 };
    } else if (obj.type === 'duong' || obj.type === 'mui_ten') {
      return {
        x0: Math.min(obj.x1, obj.x2), y0: Math.min(obj.y1, obj.y2),
        x1: Math.max(obj.x1, obj.x2), y1: Math.max(obj.y1, obj.y2)
      };
    } else if (obj.w !== undefined && obj.h !== undefined) {
      return {
        x0: Math.min(obj.x, obj.x + obj.w), y0: Math.min(obj.y, obj.y + obj.h),
        x1: Math.max(obj.x, obj.x + obj.w), y1: Math.max(obj.y, obj.y + obj.h)
      };
    } else if (obj.type === 'chu' || obj.type === 'cong_thuc' || obj.type === 'ghi_chu' || obj.type === 'diem') {
      if (obj.type === 'cong_thuc' && (obj.rawTex || obj.text)) {
        const m = measureMathFormula(obj.rawTex || obj.text, obj.fontSize || 24);
        return { x0: obj.x - 6, y0: obj.y - m.ascent - 6, x1: obj.x + m.width + 8, y1: obj.y + m.descent + 6 };
      }
      const fs = obj.fontSize || 20;
      const lines = String(obj.text || '').split('\n');
      const maxLen = Math.max(1, ...lines.map((l) => l.length));
      const w = Math.max(24, maxLen * fs * 0.56 + 14);
      const h = fs * 1.32 * lines.length;
      return { x0: obj.x - 6, y0: obj.y - fs, x1: obj.x + w, y1: obj.y - fs + h + 6 };
    }
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  function hitDistanceToObject(obj, px, py) {
    if (obj.type === 'diem') return Math.hypot(px - obj.x, py - obj.y);
    if (obj.type === 'but' || obj.type === 'to_sang' || obj.type === 'gach_chan' || obj.type === 'gach_ngang') {
      const pts = obj.points || [];
      if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y);
      let minD = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (d < minD) minD = d;
      }
      return minD;
    } else if (obj.type === 'duong' || obj.type === 'mui_ten') {
      return distToSegment(px, py, obj.x1, obj.y1, obj.x2, obj.y2);
    } else if (obj.type === 'hcn') {
      const b = getObjectBBox(obj);
      if (obj.isTimeAxisDDH) {
        const cy = (b.y0 + b.y1) * 0.5;
        if (px >= b.x0 && px <= b.x1 && Math.abs(py - cy) <= 18) return 0;
        return distToSegment(px, py, b.x0, cy, b.x1, cy);
      }
      const edges = [
        [b.x0, b.y0, b.x1, b.y0], [b.x1, b.y0, b.x1, b.y1],
        [b.x1, b.y1, b.x0, b.y1], [b.x0, b.y1, b.x0, b.y0]
      ];
      return Math.min(...edges.map((e) => distToSegment(px, py, e[0], e[1], e[2], e[3])));
    } else if (obj.type === 'xoa_vung' || obj.type === 'anh') {
      const b = getObjectBBox(obj);
      return (px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1) ? 0 : Infinity;
    } else if (obj.type === 'elip') {
      const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
      const rx = Math.max(2, Math.abs(obj.w) * 0.5), ry = Math.max(2, Math.abs(obj.h) * 0.5);
      let d = Math.abs(Math.hypot((px - cx) / rx, (py - cy) / ry) - 1.0) * Math.min(rx, ry);
      if (obj.isTrigCircle) {
        d = Math.min(
          d,
          distToSegment(px, py, cx - rx * 1.26, cy, cx + rx * 1.36, cy),
          distToSegment(px, py, cx, cy + ry * 1.26, cx, cy - ry * 1.36)
        );
      }
      return d;
    } else if (obj.type === 'tam_giac' || obj.type === 'to_trong_suot') {
      const pts = obj.points || [];
      if (pts.length < 3) return Infinity;
      if ((obj.type === 'to_trong_suot' || obj.hatch) && pointInPolygon(px, py, pts)) return 0;
      let minD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
        const d = distToSegment(px, py, p1.x, p1.y, p2.x, p2.y);
        if (d < minD) minD = d;
      }
      return minD;
    } else if (obj.type === 'shape3d') {
      const geom = computeShape3DGeometry(obj);
      let minD = Infinity;
      for (const ln of geom.lines) {
        const d = distToSegment(px, py, ln.x1, ln.y1, ln.x2, ln.y2);
        if (d < minD) minD = d;
      }
      for (const ar of geom.arcs) {
        const d = Math.abs(Math.hypot((px - ar.cx) / Math.max(1, ar.rx), (py - ar.cy) / Math.max(1, ar.ry)) - 1.0) * Math.min(ar.rx, ar.ry);
        if (d < minD) minD = d;
      }
      return minD;
    } else if (obj.type === 'chu' || obj.type === 'cong_thuc' || obj.type === 'ghi_chu') {
      const b = getObjectBBox(obj);
      return (px >= b.x0 - 4 && px <= b.x1 + 4 && py >= b.y0 - 4 && py <= b.y1 + 4) ? 0 : Infinity;
    }
    return Infinity;
  }

  function translateObject(obj, dx, dy) {
    if (obj.type === 'shape3d') {
      obj.cx = (obj.cx || 0) + dx;
      obj.cy = (obj.cy || 0) + dy;
      return;
    }
    if (obj.waveParams) {
      obj.waveParams.cx = (obj.waveParams.cx || 0) + dx;
      obj.waveParams.cy = (obj.waveParams.cy || 0) + dy;
    }
    if (obj.points) for (const p of obj.points) { p.x += dx; p.y += dy; }
    if (obj.curveControls) for (const c of obj.curveControls) { c.x += dx; c.y += dy; }
    if (obj.bezierCtrlPts) for (const c of obj.bezierCtrlPts) { c.x += dx; c.y += dy; }
    if (obj.type === 'duong' || obj.type === 'mui_ten') {
      obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy;
    } else if (obj.x !== undefined && obj.y !== undefined) {
      obj.x += dx; obj.y += dy;
    }
  }

  function rotateObject(obj, rad, cx, cy) {
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const rotPt = (p) => {
      const rx = p.x - cx, ry = p.y - cy;
      p.x = cx + rx * cosA - ry * sinA;
      p.y = cy + rx * sinA + ry * cosA;
    };
    if (obj.points) obj.points.forEach(rotPt);
    if (obj.curveControls) obj.curveControls.forEach(rotPt);
    if (obj.bezierCtrlPts) obj.bezierCtrlPts.forEach(rotPt);
    if (obj.type === 'duong' || obj.type === 'mui_ten') {
      const p1 = { x: obj.x1, y: obj.y1 }, p2 = { x: obj.x2, y: obj.y2 };
      rotPt(p1); rotPt(p2);
      obj.x1 = p1.x; obj.y1 = p1.y; obj.x2 = p2.x; obj.y2 = p2.y;
    } else if (obj.type === 'hcn') {
      // Chuyển HCN thành đa giác 4 đỉnh khi xoay để xoay tự do mọi góc
      const pts = [
        { x: obj.x, y: obj.y },
        { x: obj.x + obj.w, y: obj.y },
        { x: obj.x + obj.w, y: obj.y + obj.h },
        { x: obj.x, y: obj.y + obj.h }
      ];
      pts.forEach(rotPt);
      obj.type = 'tam_giac';
      obj.points = pts;
      delete obj.x; delete obj.y; delete obj.w; delete obj.h;
    } else if (obj.x !== undefined && obj.y !== undefined) {
      const c = { x: obj.x + (obj.w || 0) * 0.5, y: obj.y + (obj.h || 0) * 0.5 };
      rotPt(c);
      obj.x = c.x - (obj.w || 0) * 0.5;
      obj.y = c.y - (obj.h || 0) * 0.5;
      obj.angle = (obj.angle || 0) + rad;
    }
  }

  function scaleObjectFromAnchor(obj, ax, ay, sx, sy) {
    const mapX = (x) => ax + (x - ax) * sx;
    const mapY = (y) => ay + (y - ay) * sy;

    if (obj.type === 'shape3d') {
      obj.cx = mapX(obj.cx || 0);
      obj.cy = mapY(obj.cy || 0);
      obj.size = Math.max(24, (obj.size || 110) * Math.max(Math.abs(sx), Math.abs(sy)));
      return;
    }
    if (obj.points) for (const p of obj.points) { p.x = mapX(p.x); p.y = mapY(p.y); }
    if (obj.curveControls) for (const c of obj.curveControls) { c.x = mapX(c.x); c.y = mapY(c.y); }
    if (obj.bezierCtrlPts) for (const c of obj.bezierCtrlPts) { c.x = mapX(c.x); c.y = mapY(c.y); }
    if (obj.type === 'duong' || obj.type === 'mui_ten') {
      obj.x1 = mapX(obj.x1); obj.y1 = mapY(obj.y1);
      obj.x2 = mapX(obj.x2); obj.y2 = mapY(obj.y2);
    } else if (obj.w !== undefined && obj.h !== undefined) {
      const x0 = mapX(obj.x), y0 = mapY(obj.y);
      const x1 = mapX(obj.x + obj.w), y1 = mapY(obj.y + obj.h);
      obj.x = Math.min(x0, x1); obj.y = Math.min(y0, y1);
      obj.w = Math.max(2, Math.abs(x1 - x0)); obj.h = Math.max(2, Math.abs(y1 - y0));
    } else if (obj.x !== undefined && obj.y !== undefined) {
      obj.x = mapX(obj.x); obj.y = mapY(obj.y);
      if (obj.fontSize) {
        const scaleAvg = (Math.abs(sx) + Math.abs(sy)) * 0.5;
        obj.fontSize = Math.max(10, Math.min(96, Math.round(obj.fontSize * scaleAvg)));
      }
    }
  }

  function scaleObject(obj, oldBox, newBox) {
    const ow = Math.max(1, oldBox.x1 - oldBox.x0), oh = Math.max(1, oldBox.y1 - oldBox.y0);
    const nw = Math.max(2, newBox.x1 - newBox.x0), nh = Math.max(2, newBox.y1 - newBox.y0);
    const mapX = (x) => newBox.x0 + ((x - oldBox.x0) / ow) * nw;
    const mapY = (y) => newBox.y0 + ((y - oldBox.y0) / oh) * nh;

    if (obj.type === 'shape3d') {
      obj.cx = mapX(obj.cx || 0);
      obj.cy = mapY(obj.cy || 0);
      obj.size = Math.max(24, (obj.size || 110) * Math.max(Math.abs(sx), Math.abs(sy)));
      return;
    }
    if (obj.points) for (const p of obj.points) { p.x = mapX(p.x); p.y = mapY(p.y); }
    if (obj.curveControls) for (const c of obj.curveControls) { c.x = mapX(c.x); c.y = mapY(c.y); }
    if (obj.bezierCtrlPts) for (const c of obj.bezierCtrlPts) { c.x = mapX(c.x); c.y = mapY(c.y); }
    if (obj.type === 'duong' || obj.type === 'mui_ten') {
      obj.x1 = mapX(obj.x1); obj.y1 = mapY(obj.y1);
      obj.x2 = mapX(obj.x2); obj.y2 = mapY(obj.y2);
    } else if (obj.w !== undefined && obj.h !== undefined) {
      const b = getObjectBBox(obj);
      const x0 = mapX(b.x0), y0 = mapY(b.y0), x1 = mapX(b.x1), y1 = mapY(b.y1);
      obj.x = Math.min(x0, x1); obj.y = Math.min(y0, y1);
      obj.w = Math.abs(x1 - x0); obj.h = Math.abs(y1 - y0);
    } else if (obj.x !== undefined && obj.y !== undefined) {
      obj.x = mapX(obj.x); obj.y = mapY(obj.y);
      if (obj.fontSize) {
        const scaleAvg = (Math.abs(sx) + Math.abs(sy)) * 0.5;
        obj.fontSize = Math.max(10, Math.min(96, Math.round(obj.fontSize * scaleAvg)));
      }
    }
  }

  /**
   * Trả về danh sách các đỉnh điều khiển của đối tượng:
   * - Đường cong Bézier (duong_cong): 4 điểm điều khiển (P0, C1, C2, P3) với 2 cánh tay đòn tiếp tuyến!
   * - Đường cong Toán-Lý (Parabol, Cung tròn, Sóng Sin, Hyperbol): 3 điểm điều khiển (Đầu, Đỉnh/Giữa, Cuối)
   * - Dấu căn bậc 2: 4 đỉnh (V0 móc trái, V1 đáy nhọn, V2 đỉnh góc, V3 đầu mút thanh ngang)
   */
  function getObjectVertices(obj) {
    if (obj.type === 'diem') return [{ x: obj.x, y: obj.y, role: 'pt' }];
    if (obj.type === 'duong' || obj.type === 'mui_ten') {
      return [
        { x: obj.x1, y: obj.y1, role: 'p1' },
        { x: obj.x2, y: obj.y2, role: 'p2' },
        { x: (obj.x1 + obj.x2) * 0.5, y: (obj.y1 + obj.y2) * 0.5, role: 'mid', readOnly: true }
      ];
    } else if (obj.waveRole === 'hyperbola' && obj.waveParams && Array.isArray(obj.points) && obj.points.length >= 3) {
      const midIdx = Math.floor(obj.points.length / 2);
      return [
        { x: obj.points[0].x, y: obj.points[0].y, role: 'wave_top', isCurveControl: true },
        { x: obj.points[midIdx].x, y: obj.points[midIdx].y, role: 'wave_vertex' },
        { x: obj.points[obj.points.length - 1].x, y: obj.points[obj.points.length - 1].y, role: 'wave_bot', isCurveControl: true }
      ];
    } else if (obj.type === 'tam_giac' || obj.type === 'to_trong_suot' || obj.isPolyline) {
      return (obj.points || []).map((p, idx) => ({ x: p.x, y: p.y, role: idx, isCurveControl: Boolean(obj.isSqrt) }));
    } else if (obj.type === 'hcn') {
      return [
        { x: obj.x, y: obj.y, role: 'nw' },
        { x: obj.x + obj.w, y: obj.y, role: 'ne' },
        { x: obj.x + obj.w, y: obj.y + obj.h, role: 'se' },
        { x: obj.x, y: obj.y + obj.h, role: 'sw' }
      ];
    } else if (obj.type === 'elip') {
      const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
      return [
        { x: cx, y: cy, role: 'center', readOnly: true },
        { x: cx, y: obj.y, role: 'n' },
        { x: obj.x + obj.w, y: cy, role: 'e' },
        { x: cx, y: obj.y + obj.h, role: 's' },
        { x: obj.x, y: cy, role: 'w' }
      ];
    } else if (obj.type === 'but' && obj.points && obj.points.length >= 3) {
      // Chỉ hiển thị 4 điểm điều khiển Cubic Bézier cho đường cong thực sự (có curveType hoặc bezierCtrlPts);
      // KHÔNG tự biến nét bút viết tay thường thành đường cong Bézier khi ở chế độ Dựng hình / Hình động!
      if (!obj.curveType && (!obj.bezierCtrlPts || obj.bezierCtrlPts.length !== 4)) {
        return [];
      }
      if (!obj.bezierCtrlPts || obj.bezierCtrlPts.length !== 4) {
        obj.bezierCtrlPts = fitSingleCubicBezier(obj.points).map((p) => ({ x: p.x, y: p.y }));
      }
      return obj.bezierCtrlPts.map((c, idx) => ({
        x: c.x,
        y: c.y,
        role: `bezier_cp_${idx}`,
        isCurveControl: true,
        isTangentHandle: idx === 1 || idx === 2
      }));
    }
    if (obj.type === 'shape3d') {
      return computeShape3DGeometry(obj).vertices;
    }
    return [];
  }

  function buildWaveHyperbolaPoints(cx, cy, sign, a, b, maxY) {
    const pts = [];
    const steps = 48;
    const safeB = Math.max(12, b || 60);
    const safeMaxY = Math.max(24, maxY || 140);
    for (let i = 0; i <= steps; i++) {
      const yi = -safeMaxY + (2 * safeMaxY * i) / steps;
      const xVal = sign * a * Math.sqrt(1 + (yi / safeB) * (yi / safeB));
      pts.push({ x: cx + xVal, y: cy + yi });
    }
    return pts;
  }

  function updateObjectVertex(obj, role, newX, newY) {
    if (obj.waveRole === 'hyperbola' && obj.waveParams) {
      const wp = obj.waveParams;
      if (role === 'wave_top' || role === 'wave_bot') {
        const newMaxY = Math.max(24, Math.abs(newY - wp.cy));
        const dx = Math.max(wp.a + 6, Math.abs(newX - wp.cx));
        const ratioSq = (dx / wp.a) * (dx / wp.a);
        const newB = Math.max(18, Math.min(2500, newMaxY / Math.sqrt(Math.max(0.02, ratioSq - 1))));
        wp.b = newB;
        wp.maxY = newMaxY;
        obj.points = buildWaveHyperbolaPoints(wp.cx, wp.cy, wp.sign, wp.a, wp.b, wp.maxY);
        return;
      }
      if (role === 'wave_vertex') {
        const maxA = Math.max(16, (wp.dHalf || 140) - 6);
        wp.a = Math.max(8, Math.min(maxA, Math.abs(newX - wp.cx)));
        obj.points = buildWaveHyperbolaPoints(wp.cx, wp.cy, wp.sign, wp.a, wp.b, wp.maxY);
        return;
      }
    }
    if (obj.type === 'diem') {
      obj.x = newX; obj.y = newY;
    } else if (obj.type === 'duong' || obj.type === 'mui_ten') {
      if (obj.axisLock === 'h') {
        if (role === 'p1') obj.x1 = newX;
        else if (role === 'p2') obj.x2 = newX;
      } else if (obj.axisLock === 'v') {
        if (role === 'p1') obj.y1 = newY;
        else if (role === 'p2') obj.y2 = newY;
      } else {
        if (role === 'p1') { obj.x1 = newX; obj.y1 = newY; }
        else if (role === 'p2') { obj.x2 = newX; obj.y2 = newY; }
      }
    } else if (obj.type === 'hcn') {
      const x0 = obj.x, y0 = obj.y, x1 = obj.x + obj.w, y1 = obj.y + obj.h;
      let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
      if (String(role).includes('w')) nx0 = Math.min(newX, x1 - 6);
      if (String(role).includes('e')) nx1 = Math.max(newX, x0 + 6);
      if (String(role).includes('n')) ny0 = Math.min(newY, y1 - 6);
      if (String(role).includes('s')) ny1 = Math.max(newY, y0 + 6);
      obj.x = nx0; obj.y = ny0; obj.w = nx1 - nx0; obj.h = ny1 - ny0;
    } else if (obj.type === 'elip') {
      if (obj.isCircle) {
        const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
        const r = Math.max(8, Math.hypot(newX - cx, newY - cy));
        obj.x = cx - r; obj.y = cy - r; obj.w = r * 2; obj.h = r * 2;
      } else {
        const x0 = obj.x, y0 = obj.y, x1 = obj.x + obj.w, y1 = obj.y + obj.h;
        if (role === 'n') { obj.y = Math.min(newY, y1 - 8); obj.h = y1 - obj.y; }
        else if (role === 's') { obj.h = Math.max(8, newY - y0); }
        else if (role === 'w') { obj.x = Math.min(newX, x1 - 8); obj.w = x1 - obj.x; }
        else if (role === 'e') { obj.w = Math.max(8, newX - x0); }
      }
    } else if (obj.type === 'shape3d') {
      if (role === 'apex') {
        const geom = computeShape3DGeometry(obj);
        const curApex = geom.vertices.find((v) => v.role === 'apex');
        if (curApex) {
          const s = Math.max(24, obj.size || 110);
          const yaw = obj.yaw !== undefined ? obj.yaw : 0.42;
          const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
          const dx2d = (newX - curApex.x) / s;
          const dy2d = -(newY - curApex.y) / s;
          obj.apexOffset = obj.apexOffset || { dx: 0, dy: 0, dz: 0 };
          obj.apexOffset.dx += dx2d * cosY;
          obj.apexOffset.dz += dx2d * sinY;
          obj.apexOffset.dy += dy2d / Math.max(0.25, Math.cos(obj.pitch !== undefined ? obj.pitch : 0.34));
        }
      }
    } else if (typeof role === 'string' && role.startsWith('bezier_cp_')) {
      const cpIdx = parseInt(role.replace('bezier_cp_', ''), 10);
      if (obj.bezierCtrlPts && obj.bezierCtrlPts[cpIdx]) {
        // Điều khiển độc lập từng điểm trong 4 điểm (P0, C1, C2, P3) giống hệt view.py dòng 2348-2355 trên bản EXE!
        obj.bezierCtrlPts[cpIdx].x = newX;
        obj.bezierCtrlPts[cpIdx].y = newY;
        rebuildCurveFromControls(obj);
      }
    } else if (typeof role === 'string' && role.startsWith('curve_cp_')) {
      const cpIdx = parseInt(role.replace('curve_cp_', ''), 10);
      if (obj.curveControls && obj.curveControls[cpIdx]) {
        obj.curveControls[cpIdx].x = newX;
        obj.curveControls[cpIdx].y = newY;
        rebuildCurveFromControls(obj);
      }
    } else if (typeof role === 'string' && role.startsWith('free_cp_')) {
      const anchorIdx = parseInt(role.replace('free_cp_', ''), 10);
      deformFreeCurve(obj, anchorIdx, newX, newY);
    } else if (obj.points && typeof role === 'number' && obj.points[role]) {
      if (obj.isSqrt && role === 3 && obj.points.length >= 4) {
        // Kéo đầu mút phải của dấu căn bậc 2: giữ thanh ngang phẳng hoặc nâng hạ đồng bộ với đỉnh V2
        obj.points[3].x = Math.max(obj.points[2].x + 10, newX);
        obj.points[3].y = newY;
        obj.points[2].y = newY;
      } else if (obj.isSqrt && role === 2 && obj.points.length >= 4) {
        obj.points[2].x = newX;
        obj.points[2].y = newY;
        obj.points[3].y = newY;
      } else if (obj.geomConstraint && applyPolygonGeomConstraint(obj, role, newX, newY)) {
        // Đã giải ràng buộc hình học chuẩn (Tam giác đều/cân/vuông, Hình vuông/chữ nhật/bình hành/thang)
      } else {
        obj.points[role].x = newX;
        obj.points[role].y = newY;
      }
    }
  }

  function applyPolygonGeomConstraint(obj, role, newX, newY) {
    const pts = obj.points;
    const kind = obj.geomConstraint;
    if (!pts || !kind) return false;
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    if (kind === 'tam_giac_deu' && pts.length === 3) {
      // Đảm bảo bảo toàn hướng tam giác đều (CW/CCW)
      if (!obj.geomSign) {
        const cross = (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[0].x);
        obj.geomSign = cross >= 0 ? 1 : -1;
      }
      const s = obj.geomSign;
      const cos60 = 0.5, sin60 = Math.sqrt(3) * 0.5 * s;
      if (role === 0 || role === 1) {
        pts[role].x = newX; pts[role].y = newY;
        const vx = pts[1].x - pts[0].x, vy = pts[1].y - pts[0].y;
        pts[2].x = pts[0].x + vx * cos60 - vy * sin60;
        pts[2].y = pts[0].y + vx * sin60 + vy * cos60;
      } else if (role === 2) {
        pts[2].x = newX; pts[2].y = newY;
        const vx = pts[2].x - pts[0].x, vy = pts[2].y - pts[0].y;
        pts[1].x = pts[0].x + vx * cos60 + vy * sin60;
        pts[1].y = pts[0].y - vx * sin60 + vy * cos60;
      }
      return true;
    }

    if (kind === 'tam_giac_can' && pts.length === 3) {
      if (role === 0 || role === 1) {
        const oldMx = (pts[0].x + pts[1].x) * 0.5, oldMy = (pts[0].y + pts[1].y) * 0.5;
        const oldDx = pts[1].x - pts[0].x, oldDy = pts[1].y - pts[0].y;
        const oldLen = Math.max(1e-4, Math.hypot(oldDx, oldDy));
        const oldNx = -oldDy / oldLen, oldNy = oldDx / oldLen;
        const hSigned = (pts[2].x - oldMx) * oldNx + (pts[2].y - oldMy) * oldNy;

        pts[role].x = newX; pts[role].y = newY;
        const mx = (pts[0].x + pts[1].x) * 0.5, my = (pts[0].y + pts[1].y) * 0.5;
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const len = Math.max(1e-4, Math.hypot(dx, dy));
        const nx = -dy / len, ny = dx / len;
        pts[2].x = mx + hSigned * nx;
        pts[2].y = my + hSigned * ny;
      } else if (role === 2) {
        // Đỉnh C trượt trên đường trung trực của AB (CA = CB luôn đúng)
        const mx = (pts[0].x + pts[1].x) * 0.5, my = (pts[0].y + pts[1].y) * 0.5;
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const len = Math.max(1e-4, Math.hypot(dx, dy));
        const nx = -dy / len, ny = dx / len;
        const proj = (newX - mx) * nx + (newY - my) * ny;
        pts[2].x = mx + proj * nx;
        pts[2].y = my + proj * ny;
      }
      return true;
    }

    if (kind === 'tam_giac_vuong' && pts.length === 3) {
      // pts = [B, A, C], góc vuông tại A = pts[1]
      const A = pts[1];
      if (role === 0) {
        const lenAC = Math.max(20, dist(A, pts[2]));
        const cross = (pts[0].x - A.x) * (pts[2].y - A.y) - (pts[0].y - A.y) * (pts[2].x - A.x);
        const s = cross >= 0 ? 1 : -1;
        pts[0].x = newX; pts[0].y = newY;
        const dx = pts[0].x - A.x, dy = pts[0].y - A.y;
        const lenAB = Math.max(1e-4, Math.hypot(dx, dy));
        pts[2].x = A.x + (-dy / lenAB) * s * lenAC;
        pts[2].y = A.y + (dx / lenAB) * s * lenAC;
      } else if (role === 2) {
        const lenAB = Math.max(20, dist(A, pts[0]));
        const cross = (pts[2].x - A.x) * (pts[0].y - A.y) - (pts[2].y - A.y) * (pts[0].x - A.x);
        const s = cross >= 0 ? 1 : -1;
        pts[2].x = newX; pts[2].y = newY;
        const dx = pts[2].x - A.x, dy = pts[2].y - A.y;
        const lenAC = Math.max(1e-4, Math.hypot(dx, dy));
        pts[0].x = A.x + (-dy / lenAC) * s * lenAB;
        pts[0].y = A.y + (dx / lenAC) * s * lenAB;
      } else if (role === 1) {
        // Đỉnh góc vuông A trượt trên đường tròn Thales đường kính BC
        const B = pts[0], C = pts[2];
        const mx = (B.x + C.x) * 0.5, my = (B.y + C.y) * 0.5;
        const r = Math.max(10, dist(B, C) * 0.5);
        const vx = newX - mx, vy = newY - my;
        const vLen = Math.max(1e-4, Math.hypot(vx, vy));
        pts[1].x = mx + (vx / vLen) * r;
        pts[1].y = my + (vy / vLen) * r;
      }
      return true;
    }

    if (kind === 'hinh_vuong' && pts.length === 4) {
      const opp = (role + 2) % 4;
      const prev = (role + 3) % 4;
      const next = (role + 1) % 4;
      pts[role].x = newX; pts[role].y = newY;
      const mx = (pts[role].x + pts[opp].x) * 0.5;
      const my = (pts[role].y + pts[opp].y) * 0.5;
      const hx = (pts[role].x - pts[opp].x) * 0.5;
      const hy = (pts[role].y - pts[opp].y) * 0.5;
      pts[next].x = mx - hy; pts[next].y = my + hx;
      pts[prev].x = mx + hy; pts[prev].y = my - hx;
      return true;
    }

    if (kind === 'hinh_chu_nhat' && pts.length === 4) {
      const opp = (role + 2) % 4;
      const prev = (role + 3) % 4;
      const next = (role + 1) % 4;
      const ex = pts[next].x - pts[opp].x, ey = pts[next].y - pts[opp].y;
      const eLen = Math.hypot(ex, ey);
      const fx = pts[prev].x - pts[opp].x, fy = pts[prev].y - pts[opp].y;
      const fLen = Math.hypot(fx, fy);
      let ux = 1, uy = 0, vx = 0, vy = 1;
      if (eLen > 1e-3) { ux = ex / eLen; uy = ey / eLen; vx = -uy; vy = ux; }
      else if (fLen > 1e-3) { vx = fx / fLen; vy = fy / fLen; ux = vy; uy = -vx; }
      pts[role].x = newX; pts[role].y = newY;
      const dx = pts[role].x - pts[opp].x, dy = pts[role].y - pts[opp].y;
      const projU = dx * ux + dy * uy;
      const projV = dx * vx + dy * vy;
      pts[next].x = pts[opp].x + projU * ux;
      pts[next].y = pts[opp].y + projU * uy;
      pts[prev].x = pts[opp].x + projV * vx;
      pts[prev].y = pts[opp].y + projV * vy;
      return true;
    }

    if (kind === 'hinh_binh_hanh' && pts.length === 4) {
      // [A, B, C, D]: luôn giữ AB // DC và AD // BC
      pts[role].x = newX; pts[role].y = newY;
      if (role === 0 || role === 1 || role === 3) {
        pts[2].x = pts[1].x + pts[3].x - pts[0].x;
        pts[2].y = pts[1].y + pts[3].y - pts[0].y;
      } else if (role === 2) {
        pts[1].x = pts[0].x + pts[2].x - pts[3].x;
        pts[1].y = pts[0].y + pts[2].y - pts[3].y;
      }
      return true;
    }

    if (kind === 'hinh_thang' && pts.length === 4) {
      // [A, B, C, D]: luôn giữ 2 đáy AB // DC
      if (role === 0) {
        const lenAB = Math.max(20, dist(pts[0], pts[1]));
        const dcX = pts[2].x - pts[3].x, dcY = pts[2].y - pts[3].y;
        const dcLen = Math.max(1e-4, Math.hypot(dcX, dcY));
        const ux = dcX / dcLen, uy = dcY / dcLen;
        const sign = ((pts[1].x - pts[0].x) * ux + (pts[1].y - pts[0].y) * uy) >= 0 ? 1 : -1;
        pts[0].x = newX; pts[0].y = newY;
        pts[1].x = pts[0].x + sign * lenAB * ux;
        pts[1].y = pts[0].y + sign * lenAB * uy;
      } else if (role === 1) {
        const dcX = pts[2].x - pts[3].x, dcY = pts[2].y - pts[3].y;
        const dcLen = Math.max(1e-4, Math.hypot(dcX, dcY));
        const ux = dcX / dcLen, uy = dcY / dcLen;
        const proj = (newX - pts[0].x) * ux + (newY - pts[0].y) * uy;
        pts[1].x = pts[0].x + proj * ux;
        pts[1].y = pts[0].y + proj * uy;
      } else if (role === 3) {
        const lenDC = Math.max(20, dist(pts[3], pts[2]));
        const abX = pts[1].x - pts[0].x, abY = pts[1].y - pts[0].y;
        const abLen = Math.max(1e-4, Math.hypot(abX, abY));
        const ux = abX / abLen, uy = abY / abLen;
        const sign = ((pts[2].x - pts[3].x) * ux + (pts[2].y - pts[3].y) * uy) >= 0 ? 1 : -1;
        pts[3].x = newX; pts[3].y = newY;
        pts[2].x = pts[3].x + sign * lenDC * ux;
        pts[2].y = pts[3].y + sign * lenDC * uy;
      } else if (role === 2) {
        const abX = pts[1].x - pts[0].x, abY = pts[1].y - pts[0].y;
        const abLen = Math.max(1e-4, Math.hypot(abX, abY));
        const ux = abX / abLen, uy = abY / abLen;
        const proj = (newX - pts[3].x) * ux + (newY - pts[3].y) * uy;
        pts[2].x = pts[3].x + proj * ux;
        pts[2].y = pts[3].y + proj * uy;
      }
      return true;
    }

    if (kind === 'hinh_thang_vuong' && pts.length === 4) {
      // [A, B, C, D]: AB // DC và góc vuông tại A (pts[0]) và D (pts[3])
      const oldDx = pts[1].x - pts[0].x, oldDy = pts[1].y - pts[0].y;
      const oldLen = Math.max(1e-4, Math.hypot(oldDx, oldDy));
      const ux = oldDx / oldLen, uy = oldDy / oldLen;
      const adX = pts[3].x - pts[0].x, adY = pts[3].y - pts[0].y;
      const vx = -uy, vy = ux;
      const vSign = (adX * vx + adY * vy) >= 0 ? 1 : -1;
      const nx = vx * vSign, ny = vy * vSign;
      if (role === 1) {
        const projU = (newX - pts[0].x) * ux + (newY - pts[0].y) * uy;
        pts[1].x = pts[0].x + Math.max(20, projU) * ux;
        pts[1].y = pts[0].y + Math.max(20, projU) * uy;
      } else if (role === 2) {
        const projU = (newX - pts[3].x) * ux + (newY - pts[3].y) * uy;
        const projN = (newX - pts[0].x) * nx + (newY - pts[0].y) * ny;
        const h = Math.max(20, projN);
        pts[3].x = pts[0].x + h * nx; pts[3].y = pts[0].y + h * ny;
        pts[2].x = pts[3].x + Math.max(20, projU) * ux;
        pts[2].y = pts[3].y + Math.max(20, projU) * uy;
      } else if (role === 3) {
        const lenDC = Math.max(20, dist(pts[3], pts[2]));
        const projN = (newX - pts[0].x) * nx + (newY - pts[0].y) * ny;
        const h = Math.max(20, projN);
        pts[3].x = pts[0].x + h * nx; pts[3].y = pts[0].y + h * ny;
        pts[2].x = pts[3].x + lenDC * ux; pts[2].y = pts[3].y + lenDC * uy;
      } else if (role === 0) {
        const dx = newX - pts[0].x, dy = newY - pts[0].y;
        pts[0].x = newX; pts[0].y = newY;
        pts[1].x += dx; pts[1].y += dy;
        pts[3].x += dx; pts[3].y += dy;
        pts[2].x += dx; pts[2].y += dy;
      }
      return true;
    }

    return false;
  }

  function findNearestSnapPoint(list, x, y, radius = 14, excludePt = null) {
    let best = null, minD = radius;
    for (const obj of list) {
      if (!obj || obj.hidden) continue;
      for (const v of getObjectVertices(obj)) {
        if (v.isTangentHandle) continue;
        if (excludePt && Math.hypot(v.x - excludePt.x, v.y - excludePt.y) < 3.0) continue;
        const d = Math.hypot(x - v.x, y - v.y);
        if (d < minD) {
          minD = d;
          best = { x: v.x, y: v.y, label: v.role === 'mid' ? 'Trung điểm' : (v.role === 'center' ? 'Tâm' : 'Đỉnh / Đầu mút') };
        }
      }
    }
    return best;
  }

  function snapAnglePoint(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 12) return { x: x2, y: y2, angleLabel: null };
    const deg = Math.atan2(dy, dx) * (180 / Math.PI);
    const targets = [-180, -150, -135, -120, -90, -60, -45, -30, 0, 30, 45, 60, 90, 120, 135, 150, 180];
    for (const t of targets) {
      if (Math.abs(deg - t) <= 4.5) {
        const rad = t * (Math.PI / 180);
        return { x: x1 + len * Math.cos(rad), y: y1 + len * Math.sin(rad), angleLabel: `${Math.abs(t)}°` };
      }
    }
    return { x: x2, y: y2, angleLabel: null };
  }

  function drawRightAngleMark(ctx, prevPt, cornerPt, nextPt, size = 12) {
    if (!prevPt || !cornerPt || !nextPt) return;
    const d1x = prevPt.x - cornerPt.x, d1y = prevPt.y - cornerPt.y;
    const d2x = nextPt.x - cornerPt.x, d2y = nextPt.y - cornerPt.y;
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    if (l1 < 8 || l2 < 8) return;
    const s = Math.min(size, l1 * 0.35, l2 * 0.35);
    const u1x = (d1x / l1) * s, u1y = (d1y / l1) * s;
    const u2x = (d2x / l2) * s, u2y = (d2y / l2) * s;
    ctx.save();
    ctx.lineWidth = Math.max(1.1, ctx.lineWidth * 0.72);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cornerPt.x + u1x, cornerPt.y + u1y);
    ctx.lineTo(cornerPt.x + u1x + u2x, cornerPt.y + u1y + u2y);
    ctx.lineTo(cornerPt.x + u2x, cornerPt.y + u2y);
    ctx.stroke();
    ctx.restore();
  }

  function drawPolygonHatch(ctx, pts, hatchMode, color, opacity = 0.28) {
    if (!pts || pts.length < 3) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    if (!hatchMode || hatchMode === 'solid') {
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.clip();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    const w = x1 - x0, h = y1 - y0, span = w + h + 20, step = 10;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = Math.min(1.0, opacity * 2.2);

    if (hatchMode === 'diagonal' || hatchMode === 'cross') {
      ctx.beginPath();
      for (let d = -h; d <= span; d += step) { ctx.moveTo(x0 + d, y0); ctx.lineTo(x0 + d - h, y1); }
      ctx.stroke();
    }
    if (hatchMode === 'back_diagonal' || hatchMode === 'cross') {
      ctx.beginPath();
      for (let d = -h; d <= span; d += step) { ctx.moveTo(x0 + d, y0); ctx.lineTo(x0 + d + h, y1); }
      ctx.stroke();
    }
    if (hatchMode === 'horizontal') {
      ctx.beginPath();
      for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    }
    if (hatchMode === 'vertical') {
      ctx.beginPath();
      for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      ctx.stroke();
    }
    if (hatchMode === 'dots') {
      for (let x = x0 + 4; x <= x1; x += step) {
        for (let y = y0 + 4; y <= y1; y += step) {
          ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  // ============================================================================
  // BỘ DỰNG CÔNG THỨC TOÁN - LÝ LATEX VECTOR TRỰC TIẾP TRÊN CANVAS (PHÂN SỐ, CĂN THỨC, VECTƠ, MŨ/CHỈ SỐ)
  // ============================================================================
  const LATEX_SYM_MAP = {
    '\\omega': 'ω', '\\varphi': 'φ', '\\phi': 'ϕ', '\\alpha': 'α', '\\beta': 'β',
    '\\gamma': 'γ', '\\delta': 'δ', '\\Delta': 'Δ', '\\pi': 'π', '\\lambda': 'λ',
    '\\mu': 'μ', '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ', '\\theta': 'θ',
    '\\varepsilon': 'ε', '\\epsilon': 'ϵ', '\\eta': 'η', '\\Omega': 'Ω',
    '\\ell': 'ℓ', '\\mathcal{E}': 'ℰ', '\\infty': '∞', '\\pm': '±', '\\mp': '∓',
    '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\le': '≤', '\\ge': '≥',
    '\\neq': '≠', '\\approx': '≈', '\\equiv': '≡', '\\rightarrow': '→',
    '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftrightarrow': '⇔',
    '\\partial': '∂', '\\nabla': '∇', '\\degree': '°', '\\circ': '°',
    '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan', '\\cot': 'cot',
    '\\ln': 'ln', '\\log': 'log', '\\lim': 'lim', '\\max': 'max', '\\min': 'min',
    '\\const': 'const', '\\,': ' ', '\\;': ' ', '\\quad': '  '
  };

  function readBracedArg(str, startIdx) {
    let i = startIdx;
    while (i < str.length && str[i] === ' ') i++;
    if (i >= str.length) return { content: '', nextIdx: i };
    if (str[i] !== '{') {
      if (str[i] === '\\') {
        let j = i + 1;
        while (j < str.length && /[a-zA-Z]/.test(str[j])) j++;
        return { content: str.slice(i, j), nextIdx: j };
      }
      return { content: str[i], nextIdx: i + 1 };
    }
    let depth = 0, j = i;
    for (; j < str.length; j++) {
      if (str[j] === '{') depth++;
      else if (str[j] === '}') {
        depth--;
        if (depth === 0) return { content: str.slice(i + 1, j), nextIdx: j + 1 };
      }
    }
    return { content: str.slice(i + 1), nextIdx: str.length };
  }

  function parseMathAst(tex) {
    const s = String(tex || '').trim();
    const nodes = [];
    let i = 0;
    while (i < s.length) {
      if (s.startsWith('\\frac', i)) {
        const a1 = readBracedArg(s, i + 5);
        const a2 = readBracedArg(s, a1.nextIdx);
        nodes.push({ type: 'frac', num: parseMathAst(a1.content), den: parseMathAst(a2.content) });
        i = a2.nextIdx;
      } else if (s.startsWith('\\sqrt', i)) {
        let nextI = i + 5;
        let degNode = null;
        if (s[nextI] === '[') {
          const closeB = s.indexOf(']', nextI);
          if (closeB !== -1) {
            degNode = parseMathAst(s.slice(nextI + 1, closeB));
            nextI = closeB + 1;
          }
        }
        const a1 = readBracedArg(s, nextI);
        nodes.push({ type: 'sqrt', deg: degNode, rad: parseMathAst(a1.content) });
        i = a1.nextIdx;
      } else if (s.startsWith('\\vec', i) || s.startsWith('\\overrightarrow', i)) {
        const cmdLen = s.startsWith('\\overrightarrow', i) ? 15 : 4;
        const a1 = readBracedArg(s, i + cmdLen);
        nodes.push({ type: 'vec', body: parseMathAst(a1.content) });
        i = a1.nextIdx;
      } else if (s.startsWith('\\overline', i) || s.startsWith('\\bar', i)) {
        const cmdLen = s.startsWith('\\overline', i) ? 9 : 4;
        const a1 = readBracedArg(s, i + cmdLen);
        nodes.push({ type: 'bar', body: parseMathAst(a1.content) });
        i = a1.nextIdx;
      } else if (s.startsWith('\\int', i) || s.startsWith('\\sum', i)) {
        const sym = s.startsWith('\\int', i) ? '∫' : '∑';
        i += 4;
        let sub = null, sup = null;
        while (i < s.length && (s[i] === '_' || s[i] === '^' || s[i] === ' ')) {
          if (s[i] === ' ') { i++; continue; }
          const kind = s[i];
          const arg = readBracedArg(s, i + 1);
          if (kind === '_') sub = parseMathAst(arg.content);
          else sup = parseMathAst(arg.content);
          i = arg.nextIdx;
        }
        nodes.push({ type: 'bigop', sym, sub, sup });
      } else if (s.startsWith('\\text', i) || s.startsWith('\\mathrm', i)) {
        const cmdLen = s.startsWith('\\mathrm', i) ? 7 : 5;
        const a1 = readBracedArg(s, i + cmdLen);
        nodes.push({ type: 'text', val: a1.content, roman: true });
        i = a1.nextIdx;
      } else if (s[i] === '^' || s[i] === '_') {
        const kind = s[i];
        const arg = readBracedArg(s, i + 1);
        const last = nodes[nodes.length - 1];
        if (last && (last.type === 'script' || last.type === 'text' || last.type === 'vec' || last.type === 'frac' || last.type === 'sqrt')) {
          if (last.type !== 'script') {
            const baseNode = nodes.pop();
            nodes.push({
              type: 'script',
              base: [baseNode],
              sup: kind === '^' ? parseMathAst(arg.content) : null,
              sub: kind === '_' ? parseMathAst(arg.content) : null
            });
          } else {
            if (kind === '^') last.sup = parseMathAst(arg.content);
            else last.sub = parseMathAst(arg.content);
          }
        } else {
          nodes.push({
            type: 'script',
            base: [],
            sup: kind === '^' ? parseMathAst(arg.content) : null,
            sub: kind === '_' ? parseMathAst(arg.content) : null
          });
        }
        i = arg.nextIdx;
      } else if (s[i] === '\\') {
        let matched = false;
        if (s.startsWith('\\mathcal{E}', i)) {
          nodes.push({ type: 'text', val: 'ℰ' });
          i += 11;
          matched = true;
        } else {
          for (const k of Object.keys(LATEX_SYM_MAP)) {
            if (s.startsWith(k, i) && (!/[a-zA-Z]/.test(k[k.length - 1]) || !/[a-zA-Z]/.test(s[i + k.length] || ''))) {
              const rep = LATEX_SYM_MAP[k];
              nodes.push({ type: 'text', val: rep, roman: /^[a-z]{2,}$/.test(rep) });
              i += k.length;
              matched = true;
              break;
            }
          }
        }
        if (!matched) {
          let j = i + 1;
          while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
          const cmd = s.slice(i + 1, j);
          nodes.push({ type: 'text', val: cmd || s[i] });
          i = Math.max(i + 1, j);
        }
      } else if (s[i] === '{' || s[i] === '}') {
        i++;
      } else {
        let j = i;
        while (j < s.length && !['\\', '^', '_', '{', '}'].includes(s[j])) j++;
        const chunk = s.slice(i, j).replace(/-/g, '−');
        for (const ch of chunk) {
          nodes.push({ type: 'text', val: ch, roman: /[0-9()+\-−=<>.,/|[\]]/.test(ch) });
        }
        i = j;
      }
    }
    return nodes;
  }

  function layoutMathNodes(nodes, fs) {
    let totalW = 0, maxAsc = fs * 0.82, maxDesc = fs * 0.24;
    const items = [];
    for (const n of nodes) {
      let box;
      if (n.type === 'text') {
        const w = n.val === ' ' ? fs * 0.28 : Math.max(fs * 0.34, n.val.length * fs * (/[WMMΩ⇔]/.test(n.val) ? 0.82 : 0.56));
        box = { node: n, w, asc: fs * 0.82, desc: fs * 0.22, fs };
      } else if (n.type === 'frac') {
        const childFs = Math.max(11, fs * 0.82);
        const numL = layoutMathNodes(n.num, childFs);
        const denL = layoutMathNodes(n.den, childFs);
        const w = Math.max(numL.width, denL.width) + fs * 0.45;
        const asc = numL.ascent + numL.descent + fs * 0.42;
        const desc = denL.ascent + denL.descent + fs * 0.18;
        box = { node: n, w, asc, desc, fs, numL, denL };
      } else if (n.type === 'sqrt') {
        const radL = layoutMathNodes(n.rad, fs);
        const degL = n.deg ? layoutMathNodes(n.deg, Math.max(10, fs * 0.55)) : null;
        const hookW = Math.max(fs * 0.58, (degL ? degL.width + 4 : 0));
        const w = hookW + radL.width + fs * 0.22;
        const asc = radL.ascent + fs * 0.28;
        const desc = radL.descent + fs * 0.12;
        box = { node: n, w, asc, desc, fs, radL, degL, hookW };
      } else if (n.type === 'vec' || n.type === 'bar') {
        const bodyL = layoutMathNodes(n.body, fs);
        box = { node: n, w: bodyL.width + 2, asc: bodyL.ascent + fs * 0.26, desc: bodyL.descent, fs, bodyL };
      } else if (n.type === 'script') {
        const baseL = layoutMathNodes(n.base, fs);
        const sFs = Math.max(10, fs * 0.64);
        const supL = n.sup ? layoutMathNodes(n.sup, sFs) : null;
        const subL = n.sub ? layoutMathNodes(n.sub, sFs) : null;
        const scriptW = Math.max(supL ? supL.width : 0, subL ? subL.width : 0);
        const w = baseL.width + scriptW + 2;
        const asc = Math.max(baseL.ascent, supL ? baseL.ascent * 0.55 + supL.ascent : 0);
        const desc = Math.max(baseL.descent, subL ? baseL.descent + subL.ascent * 0.65 : 0);
        box = { node: n, w, asc, desc, fs, baseL, supL, subL };
      } else if (n.type === 'bigop') {
        const sFs = Math.max(10, fs * 0.60);
        const supL = n.sup ? layoutMathNodes(n.sup, sFs) : null;
        const subL = n.sub ? layoutMathNodes(n.sub, sFs) : null;
        const opW = fs * 0.72;
        const limW = Math.max(supL ? supL.width : 0, subL ? subL.width : 0);
        box = { node: n, w: opW + limW + 4, asc: fs * 1.15, desc: fs * 0.55, fs, opW, supL, subL };
      }
      if (box) {
        items.push(box);
        totalW += box.w;
        if (box.asc > maxAsc) maxAsc = box.asc;
        if (box.desc > maxDesc) maxDesc = box.desc;
      }
    }
    return { items, width: Math.max(12, totalW), ascent: maxAsc, descent: maxDesc };
  }

  function renderMathLayout(ctx, layout, x, y, color) {
    let curX = x;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    for (const it of layout.items) {
      const n = it.node, fs = it.fs;
      if (n.type === 'text') {
        ctx.font = `${n.roman ? '700' : 'italic 700'} ${Math.round(fs)}px "Times New Roman", "Be Vietnam Pro", serif`;
        ctx.fillText(n.val, curX, y);
      } else if (n.type === 'frac') {
        const barY = y - fs * 0.28;
        const numX = curX + (it.w - it.numL.width) * 0.5;
        const denX = curX + (it.w - it.denL.width) * 0.5;
        const numY = barY - it.numL.descent - fs * 0.14;
        const denY = barY + it.denL.ascent + fs * 0.16;
        renderMathLayout(ctx, it.numL, numX, numY, color);
        renderMathLayout(ctx, it.denL, denX, denY, color);
        ctx.save();
        ctx.lineWidth = Math.max(1.4, fs * 0.075);
        ctx.beginPath();
        ctx.moveTo(curX + 2, barY);
        ctx.lineTo(curX + it.w - 2, barY);
        ctx.stroke();
        ctx.restore();
      } else if (n.type === 'sqrt') {
        const radX = curX + it.hookW;
        renderMathLayout(ctx, it.radL, radX, y, color);
        const topY = y - it.radL.ascent - fs * 0.14;
        const botY = y + it.radL.descent + fs * 0.06;
        const midY = (topY + botY) * 0.52;
        if (it.degL) {
          renderMathLayout(ctx, it.degL, curX + 1, midY - 3, color);
        }
        ctx.save();
        ctx.lineWidth = Math.max(1.5, fs * 0.08);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(curX + 1, midY + 2);
        ctx.lineTo(curX + it.hookW * 0.28, midY - 1);
        ctx.lineTo(curX + it.hookW * 0.58, botY);
        ctx.lineTo(radX - 1, topY);
        ctx.lineTo(curX + it.w - 1, topY);
        ctx.stroke();
        ctx.restore();
      } else if (n.type === 'vec' || n.type === 'bar') {
        renderMathLayout(ctx, it.bodyL, curX, y, color);
        const ay = y - it.bodyL.ascent - fs * 0.10;
        const x1 = curX + 1, x2 = curX + it.bodyL.width + 1;
        ctx.save();
        ctx.lineWidth = Math.max(1.3, fs * 0.068);
        ctx.beginPath();
        ctx.moveTo(x1, ay);
        ctx.lineTo(x2, ay);
        if (n.type === 'vec') {
          ctx.moveTo(x2 - 4.5, ay - 3.2);
          ctx.lineTo(x2, ay);
          ctx.lineTo(x2 - 4.5, ay + 3.2);
        }
        ctx.stroke();
        ctx.restore();
      } else if (n.type === 'script') {
        renderMathLayout(ctx, it.baseL, curX, y, color);
        const sx = curX + it.baseL.width + 1;
        if (it.supL) renderMathLayout(ctx, it.supL, sx, y - it.baseL.ascent * 0.52, color);
        if (it.subL) renderMathLayout(ctx, it.subL, sx, y + it.baseL.descent + fs * 0.22, color);
      } else if (n.type === 'bigop') {
        ctx.font = `700 ${Math.round(fs * 1.38)}px "Times New Roman", serif`;
        ctx.fillText(n.sym, curX, y + fs * 0.12);
        const lx = curX + it.opW;
        if (it.supL) renderMathLayout(ctx, it.supL, lx, y - fs * 0.58, color);
        if (it.subL) renderMathLayout(ctx, it.subL, lx, y + fs * 0.42, color);
      }
      curX += it.w;
    }
  }

  function measureMathFormula(rawTex, fontSize = 24) {
    const ast = parseMathAst(rawTex);
    return layoutMathNodes(ast, fontSize);
  }

  function drawMathFormula(ctx, obj) {
    const fs = obj.fontSize || 24;
    const raw = obj.rawTex || obj.text || '';
    const layout = measureMathFormula(raw, fs);
    renderMathLayout(ctx, layout, obj.x, obj.y, obj.color || '#0066e0');
  }

  const imageCache = {};

  function drawObject(ctx, obj, showPointDots = true, showLabels = true) {
    if (obj.hidden) return;
    if (obj.type === 'shape3d') {
      const geom = computeShape3DGeometry(obj);
      const col = obj.color || '#ffd60a';
      const w = obj.width || 2.4;
      ctx.save();
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const ln of geom.lines) {
        ctx.save();
        const isDash = !obj.solidForMask && ln.dashed;
        ctx.lineWidth = isDash ? Math.max(1.4, w * 0.82) : w;
        if (isDash) ctx.setLineDash([w * 2.5, w * 1.9]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ln.x1, ln.y1);
        ctx.lineTo(ln.x2, ln.y2);
        ctx.stroke();
        ctx.restore();
      }
      for (const ar of geom.arcs) {
        ctx.save();
        const isDash = !obj.solidForMask && ar.dashed;
        ctx.lineWidth = isDash ? Math.max(1.4, w * 0.82) : w;
        if (isDash) ctx.setLineDash([w * 2.5, w * 1.9]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(ar.cx, ar.cy, ar.rx, ar.ry, 0, ar.startAngle, ar.endAngle, Boolean(ar.ccw));
        ctx.stroke();
        ctx.restore();
      }
      if (!obj.solidForMask) {
        const show3DLbls = obj.show3DLabels !== undefined ? obj.show3DLabels : showLabels;
        for (const v of geom.vertices) {
          if (showPointDots || v.isCenter) {
            ctx.beginPath();
            ctx.arc(v.x, v.y, v.isCenter ? 3.2 : 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
          if (show3DLbls && v.label) {
            ctx.font = 'bold 14px "Segoe UI", sans-serif';
            ctx.fillText(v.label, v.x + 6, v.y - 6);
          }
        }
      }
      ctx.restore();
      return;
    }
    if (obj.type === 'he_truc_oxy_nan') {
      drawObject(ctx, { type: 'mui_ten', x1: obj.O.x, y1: obj.O.y, x2: obj.Py.x, y2: obj.Py.y, color: obj.color, width: obj.width });
      drawObject(ctx, { type: 'mui_ten', x1: obj.O.x, y1: obj.O.y, x2: obj.Px.x, y2: obj.Px.y, color: obj.color, width: obj.width });
      // Ký hiệu góc vuông nhỏ tại O giống hệt bản PC
      ctx.save();
      ctx.strokeStyle = obj.color || '#0066e0';
      ctx.lineWidth = Math.max(1.0, (obj.width || 2.6) * 0.75);
      const lenY = Math.hypot(obj.Py.x - obj.O.x, obj.Py.y - obj.O.y);
      const lenX = Math.hypot(obj.Px.x - obj.O.x, obj.Px.y - obj.O.y);
      const sq = Math.min(12.0, Math.min(lenY, lenX) * 0.22);
      const dx = obj.Px.x >= obj.O.x ? 1.0 : -1.0;
      const dy = obj.Py.y >= obj.O.y ? 1.0 : -1.0;
      ctx.beginPath();
      ctx.moveTo(obj.O.x + dx * sq, obj.O.y);
      ctx.lineTo(obj.O.x + dx * sq, obj.O.y + dy * sq);
      ctx.lineTo(obj.O.x, obj.O.y + dy * sq);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.strokeStyle = obj.color || '#0066e0';
    ctx.fillStyle = obj.color || '#0066e0';
    ctx.lineWidth = obj.width || 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (obj.dashed) {
      const w = obj.width || 2.6;
      ctx.setLineDash([w * 2.5, w * 1.9]);
    } else {
      ctx.setLineDash([]);
    }

    if (obj.type === 'diem') {
      if (showPointDots) {
        ctx.beginPath(); ctx.arc(obj.x, obj.y, 4.2, 0, Math.PI * 2); ctx.fill();
      }
      if (showLabels && obj.text) {
        const lox = typeof obj.labelDx === 'number' ? obj.labelDx : 7;
        const loy = typeof obj.labelDy === 'number' ? obj.labelDy : -6;
        ctx.font = 'bold 15px "Times New Roman", serif';
        ctx.fillText(obj.text, obj.x + lox, obj.y + loy);
      }
      ctx.restore();
      return;
    }

    if (obj.type === 'to_sang') {
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = (obj.width || 2.6) * 5.5;
      ctx.lineCap = 'square';
    }

    if (obj.type === 'but' || obj.type === 'to_sang' || obj.type === 'gach_chan' || obj.type === 'gach_ngang') {
      const pts = obj.points || [];
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, (obj.width || 2.6) * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        if (obj.isPolyline || obj.curveType) {
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        } else {
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) * 0.5;
            const my = (pts[i].y + pts[i + 1].y) * 0.5;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        }
        ctx.stroke();
        if (obj.hasArrowEnd && pts.length >= 2) {
          const pEnd = pts[pts.length - 1], pPrev = pts[pts.length - 2];
          const adx = pEnd.x - pPrev.x, ady = pEnd.y - pPrev.y;
          if (Math.hypot(adx, ady) > 0.5) {
            const ang = Math.atan2(ady, adx);
            const headLen = Math.max(10, (obj.width || 2.4) * 4.0);
            ctx.save();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(pEnd.x, pEnd.y);
            ctx.lineTo(pEnd.x - headLen * Math.cos(ang - 0.42), pEnd.y - headLen * Math.sin(ang - 0.42));
            ctx.lineTo(pEnd.x - headLen * 0.72 * Math.cos(ang), pEnd.y - headLen * 0.72 * Math.sin(ang));
            ctx.lineTo(pEnd.x - headLen * Math.cos(ang + 0.42), pEnd.y - headLen * Math.sin(ang + 0.42));
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }
      }
    } else if (obj.type === 'duong') {
      if (obj.isHighlighter) ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke();
    } else if (obj.type === 'mui_ten') {
      const dx = obj.x2 - obj.x1, dy = obj.y2 - obj.y1, dist = Math.hypot(dx, dy);
      if (dist > 6) {
        const ang = Math.atan2(dy, dx);
        const headLen = Math.min(dist * 0.45, Math.max(11, (obj.width || 2.6) * 4.2));
        const shaftEndX = obj.x2 - headLen * 0.72 * Math.cos(ang);
        const shaftEndY = obj.y2 - headLen * 0.72 * Math.sin(ang);
        ctx.beginPath(); ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(shaftEndX, shaftEndY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(obj.x2, obj.y2);
        ctx.lineTo(obj.x2 - headLen * Math.cos(ang - 0.42), obj.y2 - headLen * Math.sin(ang - 0.42));
        ctx.lineTo(obj.x2 - headLen * 0.75 * Math.cos(ang), obj.y2 - headLen * 0.75 * Math.sin(ang));
        ctx.lineTo(obj.x2 - headLen * Math.cos(ang + 0.42), obj.y2 - headLen * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke();
      }
      if (showLabels && obj.text) {
        const mx = (obj.x1 + obj.x2) * 0.5, my = (obj.y1 + obj.y2) * 0.5;
        const lox = typeof obj.labelDx === 'number' ? obj.labelDx : 8;
        const loy = typeof obj.labelDy === 'number' ? obj.labelDy : -8;
        ctx.font = 'bold 15px "Times New Roman", serif';
        ctx.fillText(obj.text, mx + lox, my + loy);
      }
    } else if (obj.type === 'hcn') {
      if (obj.isTimeAxisDDH) {
        const x0 = obj.x, w = Math.abs(obj.w), cy = obj.y + obj.h * 0.5;
        const ox = x0 + w * 0.47, A = w * 0.40;
        const xStart = ox - A - w * 0.06, xEnd = ox + A + w * 0.11;
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineWidth = Math.max(1.5, obj.width || 2.0);
        // Trục Ox + mũi tên
        ctx.beginPath(); ctx.moveTo(xStart, cy); ctx.lineTo(xEnd, cy); ctx.stroke();
        const headLen = 10;
        ctx.beginPath();
        ctx.moveTo(xEnd, cy);
        ctx.lineTo(xEnd - headLen, cy - 4.2);
        ctx.lineTo(xEnd - headLen * 0.72, cy);
        ctx.lineTo(xEnd - headLen, cy + 4.2);
        ctx.closePath();
        ctx.fill();
        // Các vạch chia chuẩn: -A, -A√3/2, -A√2/2, -A/2, 0, +A/2, +A√2/2, +A√3/2, +A
        const ratios = [-1, -Math.sqrt(3) * 0.5, -Math.SQRT1_2, -0.5, 0, 0.5, Math.SQRT1_2, Math.sqrt(3) * 0.5, 1];
        const xs = ratios.map((r) => ox + r * A);
        ctx.lineWidth = Math.max(1.2, (obj.width || 2.0) * 0.75);
        xs.forEach((tx) => {
          ctx.beginPath(); ctx.moveTo(tx, cy - 5); ctx.lineTo(tx, cy + 5); ctx.stroke();
        });
        // 8 ngoặc nhọn dưới nối các cặp vạch chia
        ctx.lineWidth = Math.max(1.1, (obj.width || 2.0) * 0.65);
        for (let i = 0; i < xs.length - 1; i++) {
          const lx = xs[i], rx = xs[i + 1], mx = (lx + rx) * 0.5;
          const by = cy + 7, tipY = cy + 16, midY = cy + 11.5;
          const cr = Math.min(5, (rx - lx) * 0.22);
          ctx.beginPath();
          ctx.moveTo(lx, by);
          ctx.quadraticCurveTo(lx, midY, lx + cr, midY);
          ctx.lineTo(mx - cr, midY);
          ctx.quadraticCurveTo(mx, midY, mx, tipY);
          ctx.quadraticCurveTo(mx, midY, mx + cr, midY);
          ctx.lineTo(rx - cr, midY);
          ctx.quadraticCurveTo(rx, midY, rx, by);
          ctx.stroke();
        }
        // Nhãn -A, O, +A, x
        if (showLabels) {
          ctx.font = 'bold 16px "Times New Roman", serif';
          ctx.textAlign = 'center';
          ctx.fillText('−A', xs[0], cy - 12);
          ctx.fillText('O', xs[4], cy - 12);
          ctx.fillText('+A', xs[8], cy - 12);
          ctx.textAlign = 'left';
          ctx.font = 'bold 15px "Times New Roman", serif';
          ctx.fillText('x', xEnd + 5, cy + 5);
        }
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
      }
    } else if (obj.type === 'xoa_vung') {
      ctx.setLineDash([]);
      if (obj.isPreview) {
        // Khi đang kéo chọn vùng xóa: hiển thị khung bán trong suốt để vẫn nhìn rõ chữ và lưới bên dưới
        ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 4]);
        ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
        ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
      } else if (obj.isBoardErase) {
        // Trên Bảng Xanh: Xóa vùng dùng destination-out để chỉ tẩy lớp mực trên bảng, GIỮ NGUYÊN 100% LƯỚI Ô LY bên dưới!
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
        ctx.restore();
      } else {
        // Trên PDF: Xóa vùng chỉ vẽ lớp che nền ở lớp mực bên dưới; lưới ô ly CSS nằm ở lớp trên cùng (z-index: 4) nên luôn thẳng hàng tuyệt đối 100%!
        ctx.fillStyle = obj.fillColor || '#FFFFFF';
        ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
      }
    } else if (obj.type === 'elip') {
      const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
      if (obj.fillSphere) {
        const r = Math.max(4, Math.min(Math.abs(obj.w), Math.abs(obj.h)) * 0.5);
        ctx.save();
        const grad = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.32, r * 0.08, cx, cy, r);
        grad.addColorStop(0, '#E0E7FF');
        grad.addColorStop(0.35, '#6366F1');
        grad.addColorStop(1, '#312E81');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(obj.w * 0.5), Math.abs(obj.h * 0.5), obj.angle || 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(obj.w * 0.5), Math.abs(obj.h * 0.5), obj.angle || 0, 0, Math.PI * 2);
      ctx.stroke();
      if (obj.isTrigCircle) {
        const rx = Math.abs(obj.w * 0.5), ry = Math.abs(obj.h * 0.5);
        const axW = Math.max(1.4, (obj.width || 2.6) * 0.78);
        const drawAxisArrow = (x1, y1, x2, y2) => {
          ctx.save();
          ctx.setLineDash([]);
          ctx.lineWidth = axW;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          const ang = Math.atan2(y2 - y1, x2 - x1), headLen = Math.max(9, axW * 4.0);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(ang - 0.42), y2 - headLen * Math.sin(ang - 0.42));
          ctx.lineTo(x2 - headLen * 0.72 * Math.cos(ang), y2 - headLen * 0.72 * Math.sin(ang));
          ctx.lineTo(x2 - headLen * Math.cos(ang + 0.42), y2 - headLen * Math.sin(ang + 0.42));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        };
        drawAxisArrow(cx - rx * 1.26, cy, cx + rx * 1.36, cy);
        drawAxisArrow(cx, cy + ry * 1.26, cx, cy - ry * 1.36);
        const specialDegs = [30, 45, 60, 120, 150, -30, -45, -60, -120, -150];
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = obj.color || '#ffffff';
        for (const deg of specialDegs) {
          const rad = (-deg * Math.PI) / 180;
          ctx.beginPath();
          ctx.arc(cx + rx * Math.cos(rad), cy + ry * Math.sin(rad), 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        if (showLabels) {
          ctx.save();
          ctx.font = 'italic bold 16px "Times New Roman", serif';
          ctx.fillText('O', cx - 17, cy + 17);
          ctx.restore();
        }
      }
      if (obj.isCircle && !obj.fillSphere) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = obj.color || '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
        ctx.fill();
        if (obj.previewRadiusEnd) {
          ctx.strokeStyle = obj.color || '#ffffff';
          ctx.lineWidth = 1.2;
          ctx.globalAlpha = 0.65;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(obj.previewRadiusEnd.x, obj.previewRadiusEnd.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    } else if (obj.type === 'tam_giac' || obj.type === 'to_trong_suot') {
      const pts = obj.points || [];
      if (pts.length >= 3) {
        if (obj.type === 'to_trong_suot' || obj.hatch) {
          drawPolygonHatch(ctx, pts, obj.hatch || 'diagonal', obj.fillColor || obj.color || '#0066e0', obj.fillOpacity || 0.25);
        }
        if (obj.showBorder !== false) {
          const est = obj.edgeStyles;
          if (est && Object.keys(est).length > 0) {
            const lw = obj.width || 2.4;
            for (let i = 0; i < pts.length; i++) {
              const pA = pts[i], pB = pts[(i + 1) % pts.length];
              const st = est[i] || est[String(i)] || {};
              const eCol = st.color || obj.color || '#0066e0';
              const eDash = st.dashed !== undefined ? Boolean(st.dashed) : Boolean(obj.dashed);
              ctx.save();
              ctx.strokeStyle = eCol;
              if (eDash) ctx.setLineDash([lw * 2.5, lw * 1.9]);
              else ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(pA.x, pA.y);
              ctx.lineTo(pB.x, pB.y);
              ctx.stroke();
              ctx.restore();
            }
          } else {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            ctx.stroke();
          }
        }
        if (showLabels && obj.vertexLabels) {
          ctx.font = 'bold 14px "Times New Roman", serif';
          pts.forEach((p, idx) => {
            if (obj.vertexLabels[idx]) ctx.fillText(obj.vertexLabels[idx], p.x + 6, p.y - 6);
          });
        }
      }
    } else if (obj.type === 'cong_thuc') {
      drawMathFormula(ctx, obj);
    } else if (obj.type === 'chu') {
      if (!showLabels && obj.isPresetLabel) {
        ctx.restore();
        return;
      }
      const fs = obj.fontSize || 20;
      ctx.font = `700 ${fs}px "Be Vietnam Pro", "Segoe UI", sans-serif`;
      const lines = String(obj.text || '').split('\n');
      lines.forEach((line, idx) => {
        ctx.fillText(line, obj.x, obj.y + idx * (fs * 1.32));
      });
    } else if (obj.type === 'ghi_chu') {
      const b = getObjectBBox(obj);
      ctx.fillStyle = '#FEF08A'; ctx.strokeStyle = '#D97706'; ctx.lineWidth = 1.4;
      ctx.fillRect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
      ctx.strokeRect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
      const fs = obj.fontSize || 15;
      ctx.fillStyle = '#1E293B'; ctx.font = `600 ${fs}px "Be Vietnam Pro", sans-serif`;
      const lines = String(obj.text || '').split('\n');
      lines.forEach((line, idx) => {
        ctx.fillText((idx === 0 ? '📌 ' : '   ') + line, obj.x, obj.y + idx * (fs * 1.32));
      });
    } else if (obj.type === 'anh' && (obj._bitmapCanvas || obj.dataUrl)) {
      const bmp = (obj._bitmapCanvas && typeof obj._bitmapCanvas.getContext === 'function' && obj._bitmapCanvas.width > 0)
        ? obj._bitmapCanvas
        : (obj.dataUrl && imageCache[obj.dataUrl] && imageCache[obj.dataUrl]._isCanvas ? imageCache[obj.dataUrl] : null);
      if (bmp) {
        try { ctx.drawImage(bmp, obj.x, obj.y, obj.w, obj.h); } catch (_) {}
      } else if (obj.dataUrl) {
        let img = imageCache[obj.dataUrl];
        if (!img) {
          img = new Image();
          img.onload = () => {
            if (typeof window !== 'undefined' && typeof window.nkRedrawAllSurfaces === 'function') {
              window.nkRedrawAllSurfaces();
            }
          };
          img.src = obj.dataUrl;
          imageCache[obj.dataUrl] = img;
        }
        if (img.complete && img.naturalWidth > 0) {
          try { ctx.drawImage(img, obj.x, obj.y, obj.w, obj.h); } catch (_) {}
        }
      }
    }
    ctx.restore();
  }

  function createMathPhysicsPresets(shapeId, cx, cy, style) {
    const c = style.color || '#0066e0', w = style.width || 2.6, out = [];
    if (shapeId === 'he_truc_oxy' || shapeId === 'oxy_mini') {
      out.push({ type: 'mui_ten', x1: cx - 120, y1: cy, x2: cx + 135, y2: cy, axisLock: 'h', color: c, width: w });
      out.push({ type: 'mui_ten', x1: cx, y1: cy + 110, x2: cx, y2: cy - 125, axisLock: 'v', color: c, width: w });
      out.push({ type: 'chu', x: cx - 16, y: cy + 16, text: 'O', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 125, y: cy + 18, text: 'x', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 8, y: cy - 112, text: 'y', color: c, fontSize: 16 });
    } else if (shapeId === 'duong_tron_luong_giac') {
      const r = 110;
      out.push({
        type: 'elip',
        isCircle: true,
        isTrigCircle: true,
        x: cx - r,
        y: cy - r,
        w: r * 2,
        h: r * 2,
        color: c,
        width: w
      });
    } else if (shapeId === 'duong_tron_luong_giac_ddh') {
      const r = 115;
      const uid = `dtlgf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const circleId = `${uid}_C`, originId = `${uid}_O`;
      const m1Id = `${uid}_M1`, m2Id = `${uid}_M2`;
      const h1Id = `${uid}_H1`, h2Id = `${uid}_H2`;
      const th1 = -Math.PI / 6;
      const th2 = (-2 * Math.PI) / 3;
      const m1x = cx + r * Math.cos(th1), m1y = cy + r * Math.sin(th1);
      const m2x = cx + r * Math.cos(th2), m2y = cy + r * Math.sin(th2);
      out.push({
        type: 'elip',
        id: circleId,
        isCircle: true,
        isTrigCircle: true,
        x: cx - r,
        y: cy - r,
        w: r * 2,
        h: r * 2,
        centerRef: { kind: 'diem', id: originId, x: cx, y: cy },
        color: c,
        width: w
      });
      out.push({ type: 'diem', id: originId, x: cx, y: cy, text: '', color: c });
      out.push({ type: 'diem', id: h1Id, x: m1x, y: cy, text: '', color: '#0284C7', cosProjRef: { circleId, ptId: m1Id } });
      out.push({ type: 'diem', id: h2Id, x: m2x, y: cy, text: '', color: '#DC2626', cosProjRef: { circleId, ptId: m2Id } });
      out.push({ type: 'duong', x1: m1x, y1: m1y, x2: m1x, y2: cy, p1Ref: { kind: 'diem', id: m1Id }, p2Ref: { kind: 'diem', id: h1Id }, color: '#0284C7', width: 1.6, dashed: true });
      out.push({ type: 'duong', x1: m2x, y1: m2y, x2: m2x, y2: cy, p1Ref: { kind: 'diem', id: m2Id }, p2Ref: { kind: 'diem', id: h2Id }, color: '#DC2626', width: 1.6, dashed: true });
      out.push({ type: 'mui_ten', x1: cx, y1: cy, x2: m1x, y2: m1y, p1Ref: { kind: 'diem', id: originId }, p2Ref: { kind: 'diem', id: m1Id }, color: '#0284C7', width: 2.0 });
      out.push({ type: 'mui_ten', x1: cx, y1: cy, x2: m2x, y2: m2y, p1Ref: { kind: 'diem', id: originId }, p2Ref: { kind: 'diem', id: m2Id }, color: '#DC2626', width: 2.0 });
      const sweepPts = [];
      let sweep = ((th1 - th2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const rOut = r + 14, steps = Math.max(24, Math.ceil(sweep * 24));
      for (let i = 0; i <= steps; i++) {
        const th = th1 - (i / steps) * sweep;
        sweepPts.push({ x: cx + rOut * Math.cos(th), y: cy + rOut * Math.sin(th) });
      }
      out.push({
        type: 'but',
        points: sweepPts,
        isPolyline: true,
        hasArrowEnd: true,
        trigSweepRef: { circleId, p1Ref: { kind: 'diem', id: m1Id }, p2Ref: { kind: 'diem', id: m2Id }, offset: 14 },
        color: '#0F766E',
        width: 2.2
      });
      out.push({ type: 'diem', id: m1Id, x: m1x, y: m1y, text: 'M₁', color: '#0284C7', onObjRef: { kind: 'elip', id: circleId, theta: th1 } });
      out.push({ type: 'diem', id: m2Id, x: m2x, y: m2y, text: 'M₂', color: '#DC2626', onObjRef: { kind: 'elip', id: circleId, theta: th2 } });
    } else if (shapeId === 'nua_duong_tron') {
      const r = 115;
      const uid = `ndt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const aId = `${uid}_A`, bId = `${uid}_B`, oId = `${uid}_O`;
      const ax = cx - r, ay = cy, bx = cx + r, by = cy;
      const arcPts = [];
      for (let i = 0; i <= 64; i++) {
        const th = -(i / 64) * Math.PI;
        arcPts.push({ x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) });
      }
      out.push({
        type: 'but',
        points: arcPts,
        isPolyline: true,
        semiCircleRef: { p1Ref: { kind: 'diem', id: aId }, p2Ref: { kind: 'diem', id: bId } },
        color: c,
        width: w
      });
      out.push({
        type: 'duong',
        x1: ax, y1: ay, x2: bx, y2: by,
        p1Ref: { kind: 'diem', id: aId },
        p2Ref: { kind: 'diem', id: bId },
        color: c,
        width: w
      });
      out.push({ type: 'diem', id: aId, x: ax, y: ay, text: 'A', color: c });
      out.push({ type: 'diem', id: bId, x: bx, y: by, text: 'B', color: c });
      out.push({
        type: 'diem',
        id: oId,
        x: cx, y: cy,
        text: 'O',
        color: c,
        midRef: [{ kind: 'diem', id: aId }, { kind: 'diem', id: bId }]
      });
    } else if (shapeId === 'tam_giac_deu') {
      const a = 130, h = a * Math.sqrt(3) * 0.5;
      out.push({
        type: 'tam_giac',
        geomConstraint: 'tam_giac_deu',
        geomSign: -1,
        points: [{ x: cx - a * 0.5, y: cy + h * 0.4 }, { x: cx + a * 0.5, y: cy + h * 0.4 }, { x: cx, y: cy - h * 0.6 }],
        vertexLabels: ['B', 'C', 'A'], color: c, width: w
      });
    } else if (shapeId === 'tam_giac_can') {
      out.push({
        type: 'tam_giac',
        geomConstraint: 'tam_giac_can',
        points: [{ x: cx - 65, y: cy + 60 }, { x: cx + 65, y: cy + 60 }, { x: cx, y: cy - 85 }],
        vertexLabels: ['B', 'C', 'A'], color: c, width: w
      });
    } else if (shapeId === 'tam_giac_vuong') {
      out.push({
        type: 'tam_giac',
        geomConstraint: 'tam_giac_vuong',
        points: [{ x: cx - 65, y: cy - 75 }, { x: cx - 65, y: cy + 55 }, { x: cx + 85, y: cy + 55 }],
        vertexLabels: ['B', 'A', 'C'], color: c, width: w
      });
    } else if (shapeId === 'hinh_vuong') {
      out.push({
        type: 'tam_giac',
        geomConstraint: 'hinh_vuong',
        points: [{ x: cx - 60, y: cy - 60 }, { x: cx + 60, y: cy - 60 }, { x: cx + 60, y: cy + 60 }, { x: cx - 60, y: cy + 60 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'hinh_chu_nhat') {
      out.push({
        type: 'tam_giac',
        geomConstraint: 'hinh_chu_nhat',
        points: [{ x: cx - 90, y: cy - 50 }, { x: cx + 90, y: cy - 50 }, { x: cx + 90, y: cy + 50 }, { x: cx - 90, y: cy + 50 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'hinh_binh_hanh') {
      out.push({
        type: 'tam_giac',
        geomConstraint: 'hinh_binh_hanh',
        points: [{ x: cx - 55, y: cy - 45 }, { x: cx + 85, y: cy - 45 }, { x: cx + 55, y: cy + 45 }, { x: cx - 85, y: cy + 45 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'hinh_thang') {
      out.push({
        type: 'tam_giac',
        geomConstraint: 'hinh_thang',
        points: [{ x: cx - 45, y: cy - 48 }, { x: cx + 45, y: cy - 48 }, { x: cx + 85, y: cy + 48 }, { x: cx - 85, y: cy + 48 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'hinh_thang_vuong') {
      out.push({
        type: 'tam_giac',
        geomConstraint: 'hinh_thang_vuong',
        points: [{ x: cx - 75, y: cy - 48 }, { x: cx + 25, y: cy - 48 }, { x: cx + 85, y: cy + 48 }, { x: cx - 75, y: cy + 48 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'conic_parabol') {
      const pts = [];
      for (let i = -30; i <= 30; i++) {
        const u = i * 3.5;
        pts.push({ x: cx + u, y: cy + 65 - 0.012 * u * u });
      }
      out.push(attachCurveControls({ type: 'but', points: pts, color: c, width: w }, 'parabol'));
    } else if (shapeId === 'conic_hyperbol') {
      const pts1 = [], pts2 = [];
      for (let i = 1; i <= 45; i++) {
        const u = 18 + i * 2.5, v = 2400 / u;
        pts1.push({ x: cx + u * 0.6, y: cy - v * 0.6 });
        pts2.push({ x: cx - u * 0.6, y: cy + v * 0.6 });
      }
      out.push(attachCurveControls({ type: 'but', points: pts1, color: c, width: w }, 'hyperbol'));
      out.push(attachCurveControls({ type: 'but', points: pts2, color: c, width: w }, 'hyperbol'));
    } else if (shapeId === 'dang_nhiet_pv') {
      out.push({ type: 'mui_ten', x1: cx - 110, y1: cy + 85, x2: cx + 130, y2: cy + 85, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 110, y1: cy + 85, x2: cx - 110, y2: cy - 110, color: c, width: 1.8 });
      out.push({ type: 'chu', x: cx + 118, y: cy + 104, text: 'V', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx - 126, y: cy - 98, text: 'p', color: c, fontSize: 16 });
      [2600, 4400].forEach((kVal, idx) => {
        const pts = [];
        for (let s = 0; s <= 44; s++) {
          const v = 26 + s * 4.2, p = kVal / v;
          pts.push({ x: cx - 110 + v, y: cy + 85 - p });
        }
        out.push(attachCurveControls({ type: 'but', points: pts, color: idx === 0 ? c : '#d92626', width: w }, 'hyperbol'));
        const last = pts[pts.length - 1];
        out.push({ type: 'chu', x: last.x + 6, y: last.y + 4, text: idx === 0 ? 'T₁' : 'T₂ > T₁', color: idx === 0 ? c : '#d92626', fontSize: 14 });
      });
    } else if (shapeId === 'song_dung' || shapeId === 'song_dung_2co') {
      const halfL = 140, amp = 46;
      out.push({ type: 'duong', x1: cx - halfL, y1: cy, x2: cx + halfL, y2: cy, color: c, width: 1.4, dashed: true });
      out.push({ type: 'duong', x1: cx - halfL, y1: cy - amp - 10, x2: cx - halfL, y2: cy + amp + 10, color: c, width: w * 1.3 });
      out.push({ type: 'duong', x1: cx + halfL, y1: cy - amp - 10, x2: cx + halfL, y2: cy + amp + 10, color: c, width: w * 1.3 });
      const pts1 = [], pts2 = [];
      for (let i = 0; i <= 96; i++) {
        const t = i / 96, x = cx - halfL + t * (halfL * 2), dy = Math.sin(t * Math.PI * 3) * amp;
        pts1.push({ x, y: cy - dy });
        pts2.push({ x, y: cy + dy });
      }
      out.push({ type: 'but', points: pts1, isPolyline: true, color: c, width: w });
      out.push({ type: 'but', points: pts2, isPolyline: true, color: c, width: w, dashed: true });
      [0, 1 / 3, 2 / 3, 1].forEach((t) => {
        out.push({ type: 'diem', x: cx - halfL + t * (halfL * 2), y: cy, text: '', color: c });
      });
    } else if (shapeId === 'song_dung_1co_1tu') {
      const halfL = 140, amp = 46;
      out.push({ type: 'duong', x1: cx - halfL, y1: cy, x2: cx + halfL + 10, y2: cy, color: c, width: 1.4, dashed: true });
      out.push({ type: 'duong', x1: cx - halfL, y1: cy - amp - 10, x2: cx - halfL, y2: cy + amp + 10, color: c, width: w * 1.3 });
      out.push({ type: 'duong', x1: cx + halfL, y1: cy - amp, x2: cx + halfL, y2: cy + amp, color: '#d92626', width: 1.4, dashed: true });
      const pts1 = [], pts2 = [];
      for (let i = 0; i <= 100; i++) {
        const t = i / 100, x = cx - halfL + t * (halfL * 2), dy = Math.sin(t * Math.PI * 2.5) * amp;
        pts1.push({ x, y: cy - dy });
        pts2.push({ x, y: cy + dy });
      }
      out.push({ type: 'but', points: pts1, isPolyline: true, color: c, width: w });
      out.push({ type: 'but', points: pts2, isPolyline: true, color: c, width: w, dashed: true });
      [0, 0.4, 0.8].forEach((t) => {
        out.push({ type: 'diem', x: cx - halfL + t * (halfL * 2), y: cy, text: '', color: c });
      });
      out.push({ type: 'elip', isCircle: true, x: cx + halfL - 5, y: cy - 5, w: 10, h: 10, color: '#d92626', width: 1.8 });
    } else if (shapeId === 'song_sin') {
      out.push({ type: 'mui_ten', x1: cx - 140, y1: cy, x2: cx + 155, y2: cy, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 130, y1: cy + 80, x2: cx - 130, y2: cy - 85, color: c, width: 1.8 });
      const pts = [];
      for (let i = 0; i <= 90; i++) {
        const t = i / 90;
        pts.push({ x: cx - 130 + t * 260, y: cy - Math.sin(t * Math.PI * 3) * 58 });
      }
      out.push(attachCurveControls({ type: 'but', points: pts, color: c, width: w }, 'sin_cos', { halfWaves: 3 }));
      out.push({ type: 'chu', x: cx + 145, y: cy + 18, text: 't (s)', color: c, fontSize: 15 });
      out.push({ type: 'chu', x: cx - 122, y: cy - 72, text: 'x', color: c, fontSize: 16 });
    } else if (shapeId === 'truc_thoi_gian_ddh') {
      out.push({
        type: 'hcn',
        isTimeAxisDDH: true,
        x: cx - 230,
        y: cy - 34,
        w: 460,
        h: 68,
        color: c,
        width: w
      });
    } else if (shapeId === 'con_lac_lo_xo' || shapeId === 'con_lac_lo_xo_dung') {
      const buildHelix = (x1, y1, x2, y2, coils, ampP, ampA) => {
        const dx = x2 - x1, dy = y2 - y1, total = Math.hypot(dx, dy);
        const ux = dx / total, uy = dy / total, nx = -uy, ny = ux;
        const lead = 12, span = Math.max(20, total - lead * 2);
        const pts = [{ x: x1, y: y1 }, { x: x1 + ux * lead, y: y1 + uy * lead }];
        const maxT = coils * Math.PI * 2, steps = coils * 20;
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * maxT;
          const along = lead + (i / steps) * span - ampA * Math.sin(t);
          const perp = -ampP * Math.cos(t);
          pts.push({ x: x1 + ux * along + nx * perp, y: y1 + uy * along + ny * perp });
        }
        pts.push({ x: x2 - ux * lead, y: y2 - uy * lead }, { x: x2, y: y2 });
        return pts;
      };
      if (shapeId === 'con_lac_lo_xo') {
        const wx = cx - 140, fy = cy + 26;
        out.push({ type: 'duong', x1: wx, y1: cy - 55, x2: wx, y2: fy, axisLock: 'v', color: c, width: w * 1.2 });
        out.push({ type: 'duong', x1: wx, y1: fy, x2: cx + 150, y2: fy, axisLock: 'h', color: c, width: w * 1.2 });
        for (let y = cy - 50; y <= fy; y += 11) out.push({ type: 'duong', x1: wx, y1: y, x2: wx - 7, y2: y + 7, color: c, width: 1.1 });
        for (let x = wx; x <= cx + 146; x += 11) out.push({ type: 'duong', x1: x, y1: fy, x2: x - 7, y2: fy + 7, color: c, width: 1.1 });
        out.push({ type: 'but', points: buildHelix(wx, cy, cx + 68, cy, 11, 13, 5.2), isPolyline: true, color: c, width: Math.max(1.8, w * 0.85) });
        out.push({ type: 'elip', isCircle: true, fillSphere: true, x: cx + 68, y: cy - 26, w: 52, h: 52, color: '#312E81', width: 1.4 });
      } else {
        const topY = cy - 125;
        out.push({ type: 'duong', x1: cx - 55, y1: topY, x2: cx + 55, y2: topY, axisLock: 'h', color: c, width: w * 1.2 });
        for (let x = cx - 50; x <= cx + 55; x += 11) out.push({ type: 'duong', x1: x, y1: topY, x2: x + 7, y2: topY - 7, color: c, width: 1.1 });
        out.push({ type: 'but', points: buildHelix(cx, topY, cx, cy + 70, 12, 13, 5.2), isPolyline: true, color: c, width: Math.max(1.8, w * 0.85) });
        out.push({ type: 'elip', isCircle: true, fillSphere: true, x: cx - 26, y: cy + 70, w: 52, h: 52, color: '#312E81', width: 1.4 });
      }
    } else if (shapeId === 'con_lac_don') {
      out.push({ type: 'duong', x1: cx - 60, y1: cy - 90, x2: cx + 60, y2: cy - 90, color: c, width: w * 1.3 });
      out.push({ type: 'duong', x1: cx, y1: cy - 90, x2: cx, y2: cy + 75, color: c, width: 1.5, dashed: true });
      out.push({ type: 'duong', x1: cx, y1: cy - 90, x2: cx + 65, y2: cy + 50, color: c, width: w });
      out.push({ type: 'elip', x: cx + 51, y: cy + 36, w: 28, h: 28, color: c, width: w });
      out.push({ type: 'chu', x: cx + 10, y: cy - 42, text: 'α', color: c, fontSize: 16 });
    } else if (shapeId === 'ptl_keo_day_ngang') {
      const gy = cy + 45;
      out.push({ type: 'duong', x1: cx - 150, y1: gy, x2: cx + 150, y2: gy, axisLock: 'h', color: c, width: w * 1.2 });
      out.push({ type: 'hcn', x: cx - 115, y: gy - 68, w: 72, h: 68, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 43, y1: gy - 34, x2: cx + 115, y2: gy - 34, axisLock: 'h', color: c, width: w });
    } else if (shapeId === 'ptl_treo_tuong_nghieng') {
      const wx = cx - 65, ty = cy - 75, bx = cx + 35, by = cy + 35;
      out.push({ type: 'duong', x1: wx, y1: cy - 105, x2: wx, y2: cy + 95, axisLock: 'v', color: c, width: w * 1.2 });
      for (let y = cy - 100; y <= cy + 90; y += 14) {
        out.push({ type: 'duong', x1: wx, y1: y, x2: wx - 8, y2: y + 8, color: c, width: 1.2 });
      }
      out.push({ type: 'duong', x1: wx, y1: ty, x2: bx, y2: by, color: c, width: w });
      out.push({ type: 'elip', isCircle: true, x: bx - 5, y: by - 5, w: 10, h: 10, color: c, width: 1.8 });
      const arcPts = [];
      const angCord = Math.atan2(by - ty, bx - wx);
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI * 0.5 + (i / 16) * (angCord - Math.PI * 0.5);
        arcPts.push({ x: wx + 28 * Math.cos(a), y: ty + 28 * Math.sin(a) });
      }
      out.push({ type: 'but', points: arcPts, isPolyline: true, color: c, width: 1.5 });
    } else if (shapeId === 'ptl_treo_goc_tuong') {
      const rx = cx + 80, ty = cy - 85, ox = cx - 20, oy = cy - 5;
      const bx = cx - 75;
      out.push({ type: 'duong', x1: cx - 115, y1: ty, x2: rx, y2: ty, axisLock: 'h', color: c, width: w * 1.1 });
      out.push({ type: 'duong', x1: rx, y1: ty, x2: rx, y2: cy + 95, axisLock: 'v', color: c, width: w * 1.1 });
      for (let x = cx - 110; x <= rx; x += 12) out.push({ type: 'duong', x1: x, y1: ty, x2: x + 7, y2: ty - 7, color: c, width: 1.1 });
      for (let y = ty; y <= cy + 90; y += 12) out.push({ type: 'duong', x1: rx, y1: y, x2: rx + 7, y2: y - 7, color: c, width: 1.1 });
      out.push({ type: 'duong', x1: bx, y1: ty, x2: ox, y2: oy, color: c, width: w });
      out.push({ type: 'duong', x1: ox, y1: oy, x2: rx, y2: oy, color: c, width: w });
      out.push({ type: 'duong', x1: ox, y1: oy, x2: ox, y2: oy + 52, color: c, width: 1.8 });
      out.push({ type: 'elip', isCircle: true, x: ox - 6, y: oy - 6, w: 12, h: 12, color: c, width: 1.8 });
      out.push({ type: 'elip', isCircle: true, x: ox - 14, y: oy + 52, w: 28, h: 28, color: c, width: w });
      out.push({ type: 'chu', x: bx - 16, y: ty + 20, text: 'B', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: rx + 12, y: oy + 6, text: 'A', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: ox - 24, y: oy + 6, text: 'O', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: ox - 6, y: oy + 71, text: 'm', color: c, fontSize: 15 });
    } else if (shapeId === 'ptl_treo_2_cot_lech') {
      const lx = cx - 125, rx = cx + 125, gy = cy + 75;
      const ay = cy - 65, by = cy - 52, ox = cx + 18, oy = cy - 12;
      out.push({ type: 'duong', x1: lx - 20, y1: gy, x2: rx + 20, y2: gy, axisLock: 'h', color: c, width: 1.6 });
      out.push({ type: 'duong', x1: lx, y1: ay, x2: lx, y2: gy, axisLock: 'v', color: c, width: w * 1.4 });
      out.push({ type: 'duong', x1: rx, y1: by, x2: rx, y2: gy, axisLock: 'v', color: c, width: w * 1.4 });
      out.push({ type: 'duong', x1: lx, y1: ay, x2: ox, y2: oy, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: rx, y1: by, x2: ox, y2: oy, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: ox - 85, y1: oy, x2: ox + 75, y2: oy, color: c, width: 1.3, dashed: true });
      out.push({ type: 'elip', isCircle: true, x: ox - 4, y: oy - 4, w: 8, h: 8, color: c, width: 1.8 });
      out.push({ type: 'chu', x: lx - 6, y: ay - 12, text: 'A', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: rx - 6, y: by - 12, text: 'B', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: ox - 6, y: oy - 14, text: 'O', color: c, fontSize: 16 });
    } else if (shapeId === 'ptl_mp_nghieng_day') {
      const pTop = { x: cx - 125, y: cy - 65 }, pBot = { x: cx + 135, y: cy + 75 };
      const dx = pBot.x - pTop.x, dy = pBot.y - pTop.y, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len, nx = uy, ny = -ux;
      const sx = pTop.x - ux * 18, sy = pTop.y - uy * 18;
      out.push({ type: 'duong', x1: cx - 145, y1: pBot.y, x2: pBot.x + 10, y2: pBot.y, axisLock: 'h', color: c, width: w });
      out.push({ type: 'duong', x1: sx, y1: sy, x2: pBot.x, y2: pBot.y, color: c, width: w });
      out.push({ type: 'duong', x1: sx, y1: sy, x2: sx + nx * 24, y2: sy + ny * 24, color: c, width: w * 1.2 });
      const bx = pTop.x + 0.45 * dx, by = pTop.y + 0.45 * dy, hw = 22, hh = 30;
      out.push({
        type: 'tam_giac',
        points: [
          { x: bx - hw * ux, y: by - hw * uy },
          { x: bx + hw * ux, y: by + hw * uy },
          { x: bx + hw * ux + hh * nx, y: by + hw * uy + hh * ny },
          { x: bx - hw * ux + hh * nx, y: by - hw * uy + hh * ny }
        ],
        color: c, width: w
      });
      out.push({ type: 'duong', x1: sx + nx * (hh * 0.5), y1: sy + ny * (hh * 0.5), x2: bx - hw * ux + nx * (hh * 0.5), y2: by - hw * uy + ny * (hh * 0.5), color: c, width: 1.8 });
    } else if (shapeId === 'ptl_thanh_ngang_day') {
      const wx = cx - 75, cy0 = cy - 65, ay = cy + 25, ax = cx + 45;
      out.push({ type: 'duong', x1: wx, y1: cy - 100, x2: wx, y2: cy + 85, axisLock: 'v', color: c, width: w * 1.2 });
      for (let y = cy - 95; y <= cy + 80; y += 14) out.push({ type: 'duong', x1: wx, y1: y, x2: wx - 8, y2: y + 8, color: c, width: 1.2 });
      out.push({ type: 'duong', x1: wx, y1: ay, x2: ax, y2: ay, axisLock: 'h', color: c, width: w * 1.8 });
      out.push({ type: 'duong', x1: wx, y1: cy0, x2: ax, y2: ay, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: ax, y1: ay, x2: ax, y2: ay + 30, color: c, width: 1.8 });
      out.push({ type: 'hcn', x: ax - 14, y: ay + 30, w: 28, h: 34, color: c, width: w });
      out.push({ type: 'elip', isCircle: true, x: ax - 4, y: ay - 4, w: 8, h: 8, color: c, width: 1.8 });
      out.push({ type: 'chu', x: wx - 22, y: cy0 + 6, text: 'C', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: wx - 22, y: ay + 6, text: 'B', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: ax + 10, y: ay + 6, text: 'A', color: c, fontSize: 16 });
    } else if (shapeId === 'vat_mat_phang_nghieng') {
      const uid = `mpn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const slopeId = `${uid}_S`, blockId = `${uid}_B`, gId = `${uid}_G`;
      const pTop = { x: cx - 125, y: cy - 65 };
      const pBotLeft = { x: cx - 125, y: cy + 75 };
      const pBotRight = { x: cx + 135, y: cy + 75 };
      const dx = pBotRight.x - pTop.x, dy = pBotRight.y - pTop.y, slLen = Math.hypot(dx, dy);
      const ux = dx / slLen, uy = dy / slLen;
      const nx = uy, ny = -ux;
      const t0 = 0.48, halfW = 34, halfH = 19;
      const bx = pTop.x + t0 * dx, by = pTop.y + t0 * dy;
      const gx = bx + halfH * nx, gy = by + halfH * ny;
      out.push({
        type: 'tam_giac', id: slopeId, geomConstraint: 'tam_giac_vuong',
        points: [pBotRight, pBotLeft, pTop], color: c, width: w
      });
      out.push({
        type: 'tam_giac', id: blockId,
        onSlopeBlockRef: { slopeId, segIdx: 2, t: t0, halfW, halfH },
        points: [
          { x: bx - halfW * ux, y: by - halfW * uy },
          { x: bx + halfW * ux, y: by + halfW * uy },
          { x: bx + halfW * ux + 2 * halfH * nx, y: by + halfW * uy + 2 * halfH * ny },
          { x: bx - halfW * ux + 2 * halfH * nx, y: by - halfW * uy + 2 * halfH * ny }
        ],
        color: c, width: w
      });
      out.push({ type: 'diem', id: gId, x: gx, y: gy, text: '', color: '#0F172A', onSlopeCenterRef: { slopeId, segIdx: 2, t: t0, halfH, blockId } });
    } else if (shapeId === 'vat_mat_phang_ngang') {
      const uid = `mpng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const slopeId = `${uid}_Gnd`, blockId = `${uid}_B`, gId = `${uid}_G`;
      const gy0 = cy + 40, t0 = 0.5, halfW = 40, halfH = 22;
      const gx = cx, gy = gy0 - halfH;
      out.push({ type: 'duong', id: slopeId, x1: cx - 155, y1: gy0, x2: cx + 155, y2: gy0, axisLock: 'h', color: c, width: w });
      out.push({
        type: 'tam_giac', id: blockId,
        onSlopeBlockRef: { slopeId, segIdx: 0, t: t0, halfW, halfH },
        points: [
          { x: cx - halfW, y: gy0 }, { x: cx + halfW, y: gy0 },
          { x: cx + halfW, y: gy0 - 2 * halfH }, { x: cx - halfW, y: gy0 - 2 * halfH }
        ],
        color: c, width: w
      });
      out.push({ type: 'diem', id: gId, x: gx, y: gy, text: '', color: '#0F172A', onSlopeCenterRef: { slopeId, segIdx: 0, t: t0, halfH, blockId } });
    } else if (shapeId === 'vat_treo_day') {
      out.push({ type: 'duong', x1: cx - 80, y1: cy - 85, x2: cx + 80, y2: cy - 85, color: c, width: w * 1.2 });
      out.push({ type: 'duong', x1: cx, y1: cy - 85, x2: cx, y2: cy + 5, color: c, width: 1.8 });
      out.push({ type: 'elip', isCircle: true, x: cx - 18, y: cy + 5, w: 36, h: 36, color: c, width: w });
    } else if (shapeId === 'vat_treo_2_day') {
      out.push({ type: 'duong', x1: cx - 95, y1: cy - 75, x2: cx - 95, y2: cy + 75, color: c, width: w * 1.3 });
      out.push({ type: 'duong', x1: cx + 95, y1: cy - 75, x2: cx + 95, y2: cy + 75, color: c, width: w * 1.3 });
      out.push({ type: 'duong', x1: cx - 95, y1: cy - 75, x2: cx + 95, y2: cy - 75, color: c, width: 1.6 });
      out.push({ type: 'duong', x1: cx, y1: cy - 75, x2: cx, y2: cy - 28, color: c, width: 1.5, dashed: true });
      out.push({ type: 'duong', x1: cx - 95, y1: cy - 75, x2: cx, y2: cy - 28, color: c, width: w });
      out.push({ type: 'duong', x1: cx + 95, y1: cy - 75, x2: cx, y2: cy - 28, color: c, width: w });
      out.push({ type: 'duong', x1: cx, y1: cy - 28, x2: cx, y2: cy + 12, color: c, width: 1.8 });
      out.push({ type: 'elip', isCircle: true, x: cx - 14, y: cy + 12, w: 28, h: 28, color: c, width: w });
      out.push({ type: 'chu', x: cx - 118, y: cy - 70, text: 'A', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 104, y: cy - 70, text: "A'", color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx - 118, y: cy + 76, text: 'B', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 104, y: cy + 76, text: "B'", color: c, fontSize: 16 });
    } else if (shapeId === 'mat_phang_nghieng') {
      out.push({
        type: 'tam_giac',
        points: [{ x: cx - 110, y: cy - 55 }, { x: cx - 110, y: cy + 55 }, { x: cx + 110, y: cy + 55 }],
        color: c, width: w
      });
      out.push({
        type: 'tam_giac',
        points: [{ x: cx - 35, y: cy - 18 }, { x: cx + 5, y: cy + 2 }, { x: cx + 16, y: cy - 20 }],
        color: c, width: w
      });
      out.push({ type: 'chu', x: cx + 62, y: cy + 48, text: 'α', color: c, fontSize: 16 });
    } else if (shapeId === 'thau_kinh_hoi_tu') {
      out.push({ type: 'duong', x1: cx - 140, y1: cy, x2: cx + 140, y2: cy, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx, y1: cy - 75, x2: cx, y2: cy + 75, color: c, width: w });
      out.push({ type: 'chu', x: cx - 6, y: cy - 78, text: '▲', color: c, fontSize: 14 });
      out.push({ type: 'chu', x: cx - 6, y: cy + 88, text: '▼', color: c, fontSize: 14 });
      out.push({ type: 'chu', x: cx - 75, y: cy + 18, text: 'F', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 68, y: cy + 18, text: "F'", color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 6, y: cy + 18, text: 'O', color: c, fontSize: 16 });
    } else if (shapeId === 'mach_rlc') {
      out.push({ type: 'duong', x1: cx - 145, y1: cy, x2: cx - 95, y2: cy, color: c, width: w });
      out.push({ type: 'hcn', x: cx - 95, y: cy - 14, w: 50, h: 28, color: c, width: w });
      out.push({ type: 'chu', x: cx - 76, y: cy + 6, text: 'R', color: c, fontSize: 16 });
      out.push({ type: 'duong', x1: cx - 45, y1: cy, x2: cx - 10, y2: cy, color: c, width: w });
      const coilPts = [];
      for (let i = 0; i <= 36; i++) {
        const t = i / 36;
        coilPts.push({ x: cx - 10 + t * 55, y: cy - Math.abs(Math.sin(t * Math.PI * 3)) * 18 });
      }
      out.push({ type: 'but', points: coilPts, color: c, width: w });
      out.push({ type: 'chu', x: cx + 12, y: cy - 24, text: 'L', color: c, fontSize: 16 });
      out.push({ type: 'duong', x1: cx + 45, y1: cy, x2: cx + 85, y2: cy, color: c, width: w });
      out.push({ type: 'duong', x1: cx + 85, y1: cy - 20, x2: cx + 85, y2: cy + 20, color: c, width: w * 1.2 });
      out.push({ type: 'duong', x1: cx + 97, y1: cy - 20, x2: cx + 97, y2: cy + 20, color: c, width: w * 1.2 });
      out.push({ type: 'chu', x: cx + 85, y: cy - 26, text: 'C', color: c, fontSize: 16 });
      out.push({ type: 'duong', x1: cx + 97, y1: cy, x2: cx + 145, y2: cy, color: c, width: w });
    } else if (shapeId === 'hinh_chop') {
      const S = { x: cx - 10, y: cy - 95 }, A = { x: cx - 95, y: cy + 25 }, B = { x: cx - 45, y: cy + 75 }, C = { x: cx + 85, y: cy + 75 }, D = { x: cx + 45, y: cy + 25 };
      out.push({ type: 'duong', x1: S.x, y1: S.y, x2: A.x, y2: A.y, color: c, width: w });
      out.push({ type: 'duong', x1: S.x, y1: S.y, x2: B.x, y2: B.y, color: c, width: w });
      out.push({ type: 'duong', x1: S.x, y1: S.y, x2: C.x, y2: C.y, color: c, width: w });
      out.push({ type: 'duong', x1: A.x, y1: A.y, x2: B.x, y2: B.y, color: c, width: w });
      out.push({ type: 'duong', x1: B.x, y1: B.y, x2: C.x, y2: C.y, color: c, width: w });
      out.push({ type: 'duong', x1: C.x, y1: C.y, x2: D.x, y2: D.y, color: c, width: w });
      out.push({ type: 'duong', x1: S.x, y1: S.y, x2: D.x, y2: D.y, color: c, width: w, dashed: true });
      out.push({ type: 'duong', x1: A.x, y1: A.y, x2: D.x, y2: D.y, color: c, width: w, dashed: true });
      out.push({ type: 'chu', x: S.x - 5, y: S.y - 8, text: 'S', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: A.x - 16, y: A.y + 5, text: 'A', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: B.x - 14, y: B.y + 16, text: 'B', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: C.x + 8, y: C.y + 14, text: 'C', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: D.x + 8, y: D.y - 2, text: 'D', color: c, fontSize: 16 });
    } else if (shapeId === 'nem_ngang') {
      const x0 = cx - 140, y0 = cy - 85, groundY = cy + 95, L = 260, H = groundY - y0;
      out.push({ type: 'duong', x1: x0 - 45, y1: y0, x2: x0, y2: y0, color: c, width: w });
      out.push({ type: 'duong', x1: x0, y1: y0, x2: x0, y2: groundY, color: c, width: w });
      out.push({ type: 'duong', x1: x0 - 25, y1: groundY, x2: x0 + L + 40, y2: groundY, color: c, width: w });
      const pts = [];
      for (let i = 0; i <= 50; i++) {
        const dx = (L * i) / 50;
        pts.push({ x: x0 + dx, y: y0 + (H / (L * L)) * dx * dx });
      }
      out.push(attachCurveControls({ type: 'but', points: pts, color: c, width: w }, 'parabol'));
      out.push({ type: 'mui_ten', x1: x0, y1: y0, x2: x0 + 65, y2: y0, color: '#d92626', width: w });
      out.push({ type: 'chu', x: x0 + 70, y: y0 - 4, text: 'v⃗₀', color: '#d92626', fontSize: 16 });
    } else if (shapeId === 'nem_xien') {
      const ox = cx - 150, oy = cy + 85, L = 300, Hmax = 135;
      out.push({ type: 'mui_ten', x1: ox - 20, y1: oy, x2: ox + L + 45, y2: oy, color: c, width: 2.0 });
      out.push({ type: 'mui_ten', x1: ox, y1: oy + 20, x2: ox, y2: oy - Hmax - 40, color: c, width: 2.0 });
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const x = (L * i) / 60;
        const y = 4 * Hmax * (x / L) * (1 - x / L);
        pts.push({ x: ox + x, y: oy - y });
      }
      out.push(attachCurveControls({ type: 'but', points: pts, color: c, width: w }, 'parabol'));
      out.push({ type: 'mui_ten', x1: ox, y1: oy, x2: ox + 55, y2: oy - 55, color: '#d92626', width: w });
      out.push({ type: 'chu', x: ox + 60, y: oy - 58, text: 'v⃗₀', color: '#d92626', fontSize: 16 });
      out.push({ type: 'duong', x1: ox + L * 0.5, y1: oy, x2: ox + L * 0.5, y2: oy - Hmax, color: c, width: 1.5, dashed: true });
      out.push({ type: 'chu', x: ox + L * 0.5 - 18, y: oy - Hmax - 8, text: 'Hmax', color: c, fontSize: 14 });
    } else if (shapeId === 'giao_thoa_song') {
      const wgId = 'wg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const dHalf = 140, ax = cx - dHalf, bx = cx + dHalf, wl = 56;
      out.push({ id: wgId + '_axis', type: 'duong', x1: ax, y1: cy, x2: bx, y2: cy, color: c, width: 1.8, axisLock: 'h', waveGroupId: wgId, waveRole: 'axis' });
      out.push({ id: wgId + '_bis', type: 'duong', x1: cx, y1: cy - 180, x2: cx, y2: cy + 180, color: c, width: 1.8, dashed: false, axisLock: 'v', waveGroupId: wgId, waveRole: 'bisector', waveOrder: 0 });
      out.push({ id: wgId + '_perp', type: 'duong', x1: bx, y1: cy - 180, x2: bx, y2: cy + 180, color: '#38BDF8', width: 2.0, axisLock: 'v', waveGroupId: wgId, waveRole: 'perp_line' });
      [
        { k: 0.5, maxY: 168, dashed: true, wLine: 1.6 },
        { k: 1.0, maxY: 152, dashed: false, wLine: 1.8 },
        { k: 1.5, maxY: 136, dashed: true, wLine: 1.6 },
        { k: 2.0, maxY: 120, dashed: false, wLine: 1.8 }
      ].forEach(({ k, maxY, dashed, wLine }) => {
        const a = (k * wl) * 0.5;
        if (a < dHalf - 4) {
          const b = Math.sqrt(dHalf * dHalf - a * a);
          [1, -1].forEach((sign) => {
            const pts = buildWaveHyperbolaPoints(cx, cy, sign, a, b, maxY);
            out.push({
              type: 'but',
              points: pts,
              isPolyline: true,
              color: c,
              width: wLine,
              dashed,
              waveGroupId: wgId,
              waveRole: 'hyperbola',
              waveOrder: k,
              waveSign: sign,
              waveParams: { cx, cy, sign, a, b, maxY, dHalf }
            });
            out.push({
              type: 'diem',
              x: cx + sign * a,
              y: cy,
              color: '#FACC15',
              radius: 4.5,
              waveGroupId: wgId,
              waveRole: 'intersect_dot',
              waveOrder: k,
              waveSign: sign
            });
          });
        }
      });
      out.push({ type: 'diem', x: cx, y: cy, color: '#FACC15', radius: 4.5, waveGroupId: wgId, waveRole: 'intersect_dot', waveOrder: 0, waveSign: 0 });
      out.push({ type: 'diem', x: ax, y: cy, text: 'A', color: c, waveGroupId: wgId, waveRole: 'source', waveSign: -1 });
      out.push({ type: 'diem', x: bx, y: cy, text: 'B', color: c, waveGroupId: wgId, waveRole: 'source', waveSign: 1 });
    } else if (shapeId === 'ngoi_sao') {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI * 0.5 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 52 : 22;
        pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
      }
      out.push({ type: 'tam_giac', points: pts, color: c, width: w });
    } else if (shapeId === 'trai_tim') {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        pts.push({ x: cx + hx * 3.1, y: cy + hy * 3.1 });
      }
      out.push({ type: 'but', points: pts, isPolyline: true, color: c, width: w });
    } else if (shapeId === 'mat_trang') {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const a = -Math.PI * 0.42 + (i / 24) * (Math.PI * 1.15);
        pts.push({ x: cx + 48 * Math.cos(a), y: cy + 48 * Math.sin(a) });
      }
      for (let i = 24; i >= 0; i--) {
        const a = -Math.PI * 0.36 + (i / 24) * (Math.PI * 1.02);
        pts.push({ x: cx + 18 + 38 * Math.cos(a), y: cy - 6 + 38 * Math.sin(a) });
      }
      out.push({ type: 'but', points: pts, isPolyline: true, color: c, width: w });
    } else if (shapeId === 'mat_troi') {
      const rIn = 26, r1 = 34, r2 = 52;
      out.push({ type: 'elip', x: cx - rIn, y: cy - rIn, w: rIn * 2, h: rIn * 2, color: c, width: w });
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        out.push({ type: 'duong', x1: cx + r1 * Math.cos(a), y1: cy + r1 * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cy + r2 * Math.sin(a), color: c, width: w });
      }
    } else if (shapeId === 'dam_may') {
      const pts = [];
      const puffs = [
        { x: -34, y: 12, r: 20, a0: Math.PI * 0.5, a1: Math.PI * 1.65 },
        { x: -12, y: -12, r: 24, a0: Math.PI * 1.05, a1: Math.PI * 1.95 },
        { x: 18, y: -8, r: 22, a0: Math.PI * 1.15, a1: Math.PI * 2.1 },
        { x: 38, y: 12, r: 19, a0: -Math.PI * 0.35, a1: Math.PI * 0.5 }
      ];
      puffs.forEach((pf) => {
        for (let i = 0; i <= 10; i++) {
          const a = pf.a0 + (i / 10) * (pf.a1 - pf.a0);
          pts.push({ x: cx + pf.x + pf.r * Math.cos(a), y: cy + pf.y + pf.r * Math.sin(a) });
        }
      });
      pts.push({ x: cx - 34, y: cy + 32 });
      out.push({ type: 'but', points: pts, isPolyline: true, color: c, width: w });
    } else if (shapeId === 'tia_set') {
      const pts = [
        { x: cx + 10, y: cy - 54 },
        { x: cx - 22, y: cy + 2 },
        { x: cx + 2, y: cy + 2 },
        { x: cx - 14, y: cy + 54 },
        { x: cx + 26, y: cy - 6 },
        { x: cx + 2, y: cy - 6 }
      ];
      out.push({ type: 'tam_giac', points: pts, color: c, width: w });
    } else if (shapeId === 'kim_cuong') {
      const pts = [
        { x: cx - 32, y: cy - 30 },
        { x: cx + 32, y: cy - 30 },
        { x: cx + 50, y: cy - 6 },
        { x: cx, y: cy + 46 },
        { x: cx - 50, y: cy - 6 }
      ];
      out.push({ type: 'tam_giac', points: pts, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 50, y1: cy - 6, x2: cx + 50, y2: cy - 6, color: c, width: Math.max(1.5, w * 0.75) });
      out.push({ type: 'duong', x1: cx - 16, y1: cy - 30, x2: cx, y2: cy + 46, color: c, width: Math.max(1.5, w * 0.75) });
      out.push({ type: 'duong', x1: cx + 16, y1: cy - 30, x2: cx, y2: cy + 46, color: c, width: Math.max(1.5, w * 0.75) });
    } else if (shapeId === 'bong_hoa') {
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const t = (i / 120) * Math.PI * 2;
        const r = 22 + 26 * Math.abs(Math.sin(2.5 * t));
        pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
      out.push({ type: 'but', points: pts, isPolyline: true, color: c, width: w });
      out.push({ type: 'elip', x: cx - 10, y: cy - 10, w: 20, h: 20, color: c, width: Math.max(1.6, w * 0.8) });
    } else if (shapeId === 'dau_tich') {
      out.push({ type: 'but', points: [{ x: cx - 38, y: cy + 4 }, { x: cx - 10, y: cy + 32 }, { x: cx + 42, y: cy - 32 }], isPolyline: true, color: c, width: Math.max(3.0, w * 1.2) });
    } else if (shapeId === 'dau_nhan') {
      const sw = Math.max(3.0, w * 1.2);
      out.push({ type: 'duong', x1: cx - 34, y1: cy - 34, x2: cx + 34, y2: cy + 34, color: c, width: sw });
      out.push({ type: 'duong', x1: cx + 34, y1: cy - 34, x2: cx - 34, y2: cy + 34, color: c, width: sw });
    } else if (shapeId === 'mat_cuoi') {
      out.push({ type: 'elip', x: cx - 44, y: cy - 44, w: 88, h: 88, color: c, width: w });
      out.push({ type: 'elip', x: cx - 19, y: cy - 18, w: 8, h: 8, color: c, width: w });
      out.push({ type: 'elip', x: cx + 11, y: cy - 18, w: 8, h: 8, color: c, width: w });
      const sm = [];
      for (let i = 0; i <= 18; i++) {
        const a = Math.PI * 0.18 + (i / 18) * (Math.PI * 0.64);
        sm.push({ x: cx + 22 * Math.cos(a), y: cy + 4 + 20 * Math.sin(a) });
      }
      out.push({ type: 'but', points: sm, isPolyline: true, color: c, width: w });
    } else if (shapeId === 'vuong_mien') {
      const pts = [
        { x: cx - 46, y: cy + 28 },
        { x: cx - 50, y: cy - 22 },
        { x: cx - 22, y: cy + 4 },
        { x: cx, y: cy - 36 },
        { x: cx + 22, y: cy + 4 },
        { x: cx + 50, y: cy - 22 },
        { x: cx + 46, y: cy + 28 }
      ];
      out.push({ type: 'tam_giac', points: pts, color: c, width: w });
    } else if (shapeId === 'tia_so_tu_nhien') {
      const x0 = cx - 150, step = 46;
      out.push({ type: 'mui_ten', x1: x0 - 12, y1: cy, x2: x0 + step * 5 + 38, y2: cy, color: c, width: w });
      for (let i = 0; i <= 5; i++) {
        const tx = x0 + i * step;
        out.push({ type: 'duong', x1: tx, y1: cy - 6, x2: tx, y2: cy + 6, color: c, width: Math.max(1.6, w * 0.8) });
        out.push({ type: 'chu', x: tx - 4, y: cy + 24, text: String(i), fontSize: 14, color: c });
      }
    } else if (shapeId === 'truc_so_nguyen') {
      const step = 40;
      out.push({ type: 'mui_ten', x1: cx - step * 3 - 34, y1: cy, x2: cx + step * 3 + 38, y2: cy, color: c, width: w });
      for (let i = -3; i <= 3; i++) {
        const tx = cx + i * step;
        out.push({ type: 'duong', x1: tx, y1: cy - (i === 0 ? 8 : 5), x2: tx, y2: cy + (i === 0 ? 8 : 5), color: c, width: Math.max(1.6, w * 0.8) });
        out.push({ type: 'chu', x: tx - (i < 0 ? 8 : 4), y: cy + 24, text: String(i), fontSize: 14, color: c });
      }
    } else if (shapeId === 'khoang_nghiem_bpt') {
      const xL = cx - 160, xR = cx + 160, aX = cx - 55, bX = cx + 65;
      out.push({ type: 'mui_ten', x1: xL, y1: cy, x2: xR, y2: cy, color: c, width: w });
      out.push({ type: 'duong', x1: aX, y1: cy, x2: bX, y2: cy, color: '#EF4444', width: Math.max(3.6, w * 1.4) });
      out.push({ type: 'chu', x: aX - 5, y: cy + 5, text: '[', fontSize: 22, color: '#EF4444' });
      out.push({ type: 'chu', x: bX - 4, y: cy + 5, text: ')', fontSize: 22, color: '#EF4444' });
      out.push({ type: 'chu', x: aX - 4, y: cy + 26, text: 'a', fontSize: 14, color: c });
      out.push({ type: 'chu', x: bX - 4, y: cy + 26, text: 'b', fontSize: 14, color: c });
      for (let sx = xL + 12; sx < aX - 8; sx += 12) {
        out.push({ type: 'duong', x1: sx - 5, y1: cy + 7, x2: sx + 5, y2: cy - 7, color: c, width: 1.4 });
      }
      for (let sx = bX + 10; sx < xR - 18; sx += 12) {
        out.push({ type: 'duong', x1: sx - 5, y1: cy + 7, x2: sx + 5, y2: cy - 7, color: c, width: 1.4 });
      }
    } else if (shapeId === 'bieu_do_ven') {
      out.push({ type: 'elip', x: cx - 95, y: cy - 55, w: 120, h: 110, color: '#2563EB', width: w });
      out.push({ type: 'elip', x: cx - 25, y: cy - 55, w: 120, h: 110, color: '#16A34A', width: w });
      out.push({ type: 'chu', x: cx - 68, y: cy - 60, text: 'A', fontSize: 16, color: '#2563EB' });
      out.push({ type: 'chu', x: cx + 56, y: cy - 60, text: 'B', fontSize: 16, color: '#16A34A' });
    } else if (shapeId === 'do_thi_bac_nhat') {
      out.push({ type: 'mui_ten', x1: cx - 120, y1: cy + 30, x2: cx + 130, y2: cy + 30, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 30, y1: cy + 100, x2: cx - 30, y2: cy - 100, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx - 95, y1: cy + 78, x2: cx + 95, y2: cy - 82, color: '#EF4444', width: Math.max(2.4, w) });
      out.push({ type: 'chu', x: cx - 44, y: cy + 48, text: 'O', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx + 120, y: cy + 48, text: 'x', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx - 20, y: cy - 92, text: 'y', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx + 52, y: cy - 72, text: 'y = ax + b', fontSize: 14, color: '#EF4444' });
    } else if (shapeId === 'hinh_thoi') {
      const pts = [
        { x: cx, y: cy - 62 },
        { x: cx + 82, y: cy },
        { x: cx, y: cy + 62 },
        { x: cx - 82, y: cy }
      ];
      out.push({ type: 'tam_giac', points: pts, color: c, width: w });
      out.push({ type: 'duong', x1: cx, y1: cy - 62, x2: cx, y2: cy + 62, color: c, width: 1.5, dashed: true });
      out.push({ type: 'duong', x1: cx - 82, y1: cy, x2: cx + 82, y2: cy, color: c, width: 1.5, dashed: true });
      out.push({ type: 'but', points: [{ x: cx, y: cy - 11 }, { x: cx + 11, y: cy - 11 }, { x: cx + 11, y: cy }], isPolyline: true, color: c, width: 1.4 });
    } else if (shapeId === 'hinh_thang_can') {
      const pts = [
        { x: cx - 50, y: cy - 48 },
        { x: cx + 50, y: cy - 48 },
        { x: cx + 92, y: cy + 48 },
        { x: cx - 92, y: cy + 48 }
      ];
      out.push({ type: 'tam_giac', points: pts, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 50, y1: cy - 48, x2: cx + 92, y2: cy + 48, color: c, width: 1.4, dashed: true });
      out.push({ type: 'duong', x1: cx + 50, y1: cy - 48, x2: cx - 92, y2: cy + 48, color: c, width: 1.4, dashed: true });
    } else if (shapeId === 'hai_song_song_cat_tuyen') {
      out.push({ type: 'duong', x1: cx - 120, y1: cy - 40, x2: cx + 120, y2: cy - 40, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 120, y1: cy + 40, x2: cx + 120, y2: cy + 40, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 65, y1: cy + 85, x2: cx + 65, y2: cy - 85, color: '#2563EB', width: w });
      out.push({ type: 'chu', x: cx - 116, y: cy - 46, text: 'a', fontSize: 15, color: c });
      out.push({ type: 'chu', x: cx - 116, y: cy + 34, text: 'b', fontSize: 15, color: c });
      out.push({ type: 'chu', x: cx + 52, y: cy - 72, text: 'c', fontSize: 15, color: '#2563EB' });
    } else if (shapeId === 'hinh_hop_chu_nhat') {
      const wB = 110, hB = 76, dx = 36, dy = -26;
      const A = { x: cx - 65, y: cy + 40 }, B = { x: A.x + wB, y: A.y }, C = { x: B.x, y: B.y - hB }, D = { x: A.x, y: A.y - hB };
      const A1 = { x: A.x + dx, y: A.y + dy }, B1 = { x: B.x + dx, y: B.y + dy }, C1 = { x: C.x + dx, y: C.y + dy }, D1 = { x: D.x + dx, y: D.y + dy };
      [[A, B], [B, C], [C, D], [D, A], [D, D1], [D1, C1], [C1, C], [C1, B1], [B1, B]].forEach(([p1, p2]) => {
        out.push({ type: 'duong', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, color: c, width: w });
      });
      [[A, A1], [A1, D1], [A1, B1]].forEach(([p1, p2]) => {
        out.push({ type: 'duong', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, color: c, width: Math.max(1.5, w * 0.75), dashed: true });
      });
    } else if (shapeId === 'hinh_chop_tam_giac') {
      const A = { x: cx - 75, y: cy + 36 }, B = { x: cx + 10, y: cy + 62 }, C = { x: cx + 82, y: cy + 20 }, S = { x: cx - 10, y: cy - 68 };
      [[S, A], [S, B], [S, C], [A, B], [B, C]].forEach(([p1, p2]) => {
        out.push({ type: 'duong', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, color: c, width: w });
      });
      out.push({ type: 'duong', x1: A.x, y1: A.y, x2: C.x, y2: C.y, color: c, width: Math.max(1.5, w * 0.75), dashed: true });
      out.push({ type: 'chu', x: S.x - 5, y: S.y - 10, text: 'S', fontSize: 15, color: c });
      out.push({ type: 'chu', x: A.x - 16, y: A.y + 6, text: 'A', fontSize: 15, color: c });
      out.push({ type: 'chu', x: B.x - 4, y: B.y + 20, text: 'B', fontSize: 15, color: c });
      out.push({ type: 'chu', x: C.x + 8, y: C.y + 6, text: 'C', fontSize: 15, color: c });
    } else if (shapeId === 'ong_nghiem') {
      out.push({ type: 'duong', x1: cx - 18, y1: cy - 60, x2: cx - 18, y2: cy + 36, color: c, width: w });
      out.push({ type: 'duong', x1: cx + 18, y1: cy - 60, x2: cx + 18, y2: cy + 36, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 23, y1: cy - 60, x2: cx + 23, y2: cy - 60, color: c, width: w });
      const arc = [];
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI;
        arc.push({ x: cx + 18 * Math.cos(a), y: cy + 36 + 18 * Math.sin(a) });
      }
      out.push({ type: 'but', points: arc, isPolyline: true, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 17, y1: cy + 8, x2: cx + 17, y2: cy + 8, color: '#38BDF8', width: 2, dashed: true });
    } else if (shapeId === 'binh_tam_giac') {
      const pts = [
        { x: cx - 14, y: cy - 62 },
        { x: cx + 14, y: cy - 62 },
        { x: cx + 14, y: cy - 26 },
        { x: cx + 52, y: cy + 48 },
        { x: cx - 52, y: cy + 48 },
        { x: cx - 14, y: cy - 26 }
      ];
      out.push({ type: 'tam_giac', points: pts, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 34, y1: cy + 14, x2: cx + 34, y2: cy + 14, color: '#38BDF8', width: 2, dashed: true });
    } else if (shapeId === 'nguyen_tu_bo') {
      out.push({ type: 'elip', x: cx - 12, y: cy - 12, w: 24, h: 24, color: '#EF4444', width: w });
      out.push({ type: 'elip', x: cx - 38, y: cy - 38, w: 76, h: 76, color: c, width: 1.5, dashed: true });
      out.push({ type: 'elip', x: cx - 64, y: cy - 64, w: 128, h: 128, color: c, width: 1.5, dashed: true });
      out.push({ type: 'chu', x: cx - 7, y: cy + 5, text: '+Z', fontSize: 12, color: '#EF4444' });
    } else if (shapeId === 'vl12_chuyen_the') {
      out.push({ type: 'mui_ten', x1: cx - 125, y1: cy + 65, x2: cx + 135, y2: cy + 65, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 105, y1: cy + 80, x2: cx - 105, y2: cy - 85, color: c, width: 1.8 });
      out.push({ type: 'but', points: [{ x: cx - 105, y: cy + 55 }, { x: cx - 55, y: cy + 15 }, { x: cx + 5, y: cy + 15 }, { x: cx + 55, y: cy - 45 }, { x: cx + 115, y: cy - 45 }], isPolyline: true, color: '#EF4444', width: Math.max(2.4, w) });
      out.push({ type: 'duong', x1: cx - 105, y1: cy + 15, x2: cx - 55, y2: cy + 15, color: c, width: 1.3, dashed: true });
      out.push({ type: 'duong', x1: cx - 105, y1: cy - 45, x2: cx + 55, y2: cy - 45, color: c, width: 1.3, dashed: true });
      out.push({ type: 'chu', x: cx + 112, y: cy + 82, text: 'τ (phút)', fontSize: 12, color: c });
      out.push({ type: 'chu', x: cx - 128, y: cy - 78, text: 't(°C)', fontSize: 12, color: c });
      out.push({ type: 'chu', x: cx - 48, y: cy + 8, text: 'Nóng chảy', fontSize: 11, color: '#EF4444' });
      out.push({ type: 'chu', x: cx + 66, y: cy - 52, text: 'Sôi', fontSize: 11, color: '#EF4444' });
    } else if (shapeId === 'vl12_nhiet_dung_rieng') {
      out.push({ type: 'hcn', x: cx - 52, y: cy - 35, w: 104, h: 95, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 48, y1: cy + 5, x2: cx + 48, y2: cy + 5, color: '#38BDF8', width: 2, dashed: true });
      out.push({ type: 'duong', x1: cx - 18, y1: cy - 68, x2: cx - 18, y2: cy + 36, color: '#EF4444', width: 2.2 });
      out.push({ type: 'duong', x1: cx + 22, y1: cy - 72, x2: cx + 22, y2: cy + 30, color: '#FACC15', width: 2 });
      out.push({ type: 'elip', x: cx + 18, y: cy + 28, w: 8, h: 8, color: '#EF4444', width: 2 });
      out.push({ type: 'chu', x: cx - 50, y: cy - 75, text: 'Nhiệt lượng kế', fontSize: 12, color: c });
    } else if (shapeId === 'vl12_ran_long_khi') {
      [-92, 0, 92].forEach((ox, gIdx) => {
        out.push({ type: 'hcn', x: cx + ox - 36, y: cy - 42, w: 72, h: 72, color: c, width: 1.6 });
        out.push({ type: 'chu', x: cx + ox - 18, y: cy + 48, text: ['Rắn', 'Lỏng', 'Khí'][gIdx], fontSize: 13, color: c });
        for (let r = -1; r <= 1; r++) {
          for (let col = -1; col <= 1; col++) {
            const jx = gIdx === 0 ? 0 : (gIdx === 1 ? (r * 4) : (col * 7));
            const jy = gIdx === 0 ? 0 : (gIdx === 1 ? (col * 3) : (r * -6));
            out.push({ type: 'elip', x: cx + ox + col * 18 + jx - 5, y: cy - 6 + r * 18 + jy - 5, w: 10, h: 10, color: '#38BDF8', width: 1.6 });
          }
        }
      });
    } else if (shapeId === 'vl12_dang_ap') {
      out.push({ type: 'mui_ten', x1: cx - 110, y1: cy + 60, x2: cx + 120, y2: cy + 60, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 80, y1: cy + 80, x2: cx - 80, y2: cy - 80, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx - 80, y1: cy + 60, x2: cx - 20, y2: cy + 15, color: '#EF4444', width: 1.6, dashed: true });
      out.push({ type: 'duong', x1: cx - 20, y1: cy + 15, x2: cx + 90, y2: cy - 68, color: '#EF4444', width: Math.max(2.4, w) });
      out.push({ type: 'chu', x: cx - 94, y: cy - 72, text: 'V', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx + 105, y: cy + 78, text: 'T (K)', fontSize: 13, color: c });
      out.push({ type: 'chu', x: cx + 30, y: cy - 48, text: 'Đẳng áp', fontSize: 12, color: '#EF4444' });
    } else if (shapeId === 'vl12_dang_tich') {
      out.push({ type: 'mui_ten', x1: cx - 110, y1: cy + 60, x2: cx + 120, y2: cy + 60, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 80, y1: cy + 80, x2: cx - 80, y2: cy - 80, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx - 80, y1: cy + 60, x2: cx - 25, y2: cy + 18, color: '#2563EB', width: 1.6, dashed: true });
      out.push({ type: 'duong', x1: cx - 25, y1: cy + 18, x2: cx + 92, y2: cy - 70, color: '#2563EB', width: Math.max(2.4, w) });
      out.push({ type: 'chu', x: cx - 94, y: cy - 72, text: 'p', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx + 105, y: cy + 78, text: 'T (K)', fontSize: 13, color: c });
      out.push({ type: 'chu', x: cx + 30, y: cy - 48, text: 'Đẳng tích', fontSize: 12, color: '#2563EB' });
    } else if (shapeId === 'vl12_chu_trinh_khi') {
      out.push({ type: 'mui_ten', x1: cx - 115, y1: cy + 65, x2: cx + 125, y2: cy + 65, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 95, y1: cy + 82, x2: cx - 95, y2: cy - 85, color: c, width: 1.8 });
      const p1 = { x: cx - 55, y: cy - 45 }, p2 = { x: cx + 70, y: cy - 45 }, p3 = { x: cx + 70, y: cy + 30 }, p4 = { x: cx - 55, y: cy + 30 };
      out.push({ type: 'mui_ten', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, color: '#EF4444', width: w });
      out.push({ type: 'mui_ten', x1: p2.x, y1: p2.y, x2: p3.x, y2: p3.y, color: '#EF4444', width: w });
      out.push({ type: 'mui_ten', x1: p3.x, y1: p3.y, x2: p4.x, y2: p4.y, color: '#EF4444', width: w });
      out.push({ type: 'mui_ten', x1: p4.x, y1: p4.y, x2: p1.x, y2: p1.y, color: '#EF4444', width: w });
      out.push({ type: 'chu', x: cx - 110, y: cy - 75, text: 'p', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx + 115, y: cy + 82, text: 'V', fontSize: 14, color: c });
      out.push({ type: 'chu', x: p1.x - 14, y: p1.y - 6, text: '(1)', fontSize: 12, color: c });
      out.push({ x: p2.x + 6, y: p2.y - 6, type: 'chu', text: '(2)', fontSize: 12, color: c });
      out.push({ x: p3.x + 6, y: p3.y + 14, type: 'chu', text: '(3)', fontSize: 12, color: c });
      out.push({ x: p4.x - 18, y: p4.y + 14, type: 'chu', text: '(4)', fontSize: 12, color: c });
    } else if (shapeId === 'vl12_xilanh_pittong') {
      out.push({ type: 'duong', x1: cx - 42, y1: cy - 65, x2: cx - 42, y2: cy + 68, color: c, width: w });
      out.push({ type: 'duong', x1: cx + 42, y1: cy - 65, x2: cx + 42, y2: cy + 68, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 42, y1: cy + 68, x2: cx + 42, y2: cy + 68, color: c, width: w });
      out.push({ type: 'hcn', x: cx - 40, y: cy - 12, w: 80, h: 16, color: '#94A3B8', width: 2 });
      out.push({ type: 'duong', x1: cx, y1: cy - 12, x2: cx, y2: cy - 58, color: '#94A3B8', width: 4 });
      out.push({ type: 'chu', x: cx - 18, y: cy + 38, text: 'Khí (p,V,T)', fontSize: 11, color: '#38BDF8' });
    } else if (shapeId === 'vl12_ong_chu_u') {
      out.push({ type: 'duong', x1: cx - 42, y1: cy - 65, x2: cx - 42, y2: cy + 45, color: c, width: w });
      out.push({ type: 'duong', x1: cx + 42, y1: cy - 65, x2: cx + 42, y2: cy + 45, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 22, y1: cy - 65, x2: cx - 22, y2: cy + 32, color: c, width: w });
      out.push({ type: 'duong', x1: cx + 22, y1: cy - 65, x2: cx + 22, y2: cy + 32, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 42, y1: cy + 45, x2: cx + 42, y2: cy + 45, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 22, y1: cy + 32, x2: cx + 22, y2: cy + 32, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 42, y1: cy - 10, x2: cx - 22, y2: cy - 10, color: '#94A3B8', width: 2.4 });
      out.push({ type: 'duong', x1: cx + 22, y1: cy - 30, x2: cx + 42, y2: cy - 30, color: '#94A3B8', width: 2.4 });
      out.push({ type: 'chu', x: cx - 14, y: cy + 62, text: 'Thủy ngân (Hg)', fontSize: 11, color: c });
    } else if (shapeId === 'vl12_tu_truong_day') {
      out.push({ type: 'mui_ten', x1: cx - 95, y1: cy, x2: cx + 95, y2: cy, color: '#EF4444', width: Math.max(2.6, w) });
      out.push({ type: 'chu', x: cx + 82, y: cy - 10, text: 'I', fontSize: 15, color: '#EF4444' });
      [-48, 0, 48].forEach((ox) => {
        out.push({ type: 'elip', x: cx + ox - 8, y: cy - 38, w: 16, h: 16, color: '#38BDF8', width: 1.6 });
        out.push({ type: 'elip', x: cx + ox - 2, y: cy - 32, w: 4, h: 4, color: '#38BDF8', width: 2 });
        out.push({ type: 'elip', x: cx + ox - 8, y: cy + 22, w: 16, h: 16, color: '#38BDF8', width: 1.6 });
        out.push({ type: 'duong', x1: cx + ox - 5, y1: cy + 25, x2: cx + ox + 5, y2: cy + 35, color: '#38BDF8', width: 1.5 });
        out.push({ type: 'duong', x1: cx + ox + 5, y1: cy + 25, x2: cx + ox - 5, y2: cy + 35, color: '#38BDF8', width: 1.5 });
      });
      out.push({ type: 'chu', x: cx - 22, y: cy - 52, text: 'B (⊙ / ⊗)', fontSize: 12, color: '#38BDF8' });
    } else if (shapeId === 'vl12_luc_tu_ray') {
      out.push({ type: 'duong', x1: cx - 110, y1: cy - 32, x2: cx + 110, y2: cy - 32, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx - 110, y1: cy + 32, x2: cx + 110, y2: cy + 32, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx - 10, y1: cy - 42, x2: cx - 10, y2: cy + 42, color: '#FACC15', width: 4 });
      out.push({ type: 'mui_ten', x1: cx - 10, y1: cy, x2: cx + 52, y2: cy, color: '#EF4444', width: 2.6 });
      out.push({ type: 'chu', x: cx + 38, y: cy - 10, text: 'F', fontSize: 14, color: '#EF4444' });
      out.push({ type: 'elip', x: cx - 65, y: cy - 10, w: 20, h: 20, color: '#38BDF8', width: 1.6 });
      out.push({ type: 'chu', x: cx - 60, y: cy + 4, text: '×', fontSize: 13, color: '#38BDF8' });
      out.push({ type: 'chu', x: cx - 72, y: cy - 16, text: 'B', fontSize: 13, color: '#38BDF8' });
    } else if (shapeId === 'vl12_khung_day_quay') {
      const pts = [{ x: cx - 45, y: cy - 36 }, { x: cx + 45, y: cy - 52 }, { x: cx + 45, y: cy + 36 }, { x: cx - 45, y: cy + 52 }];
      out.push({ type: 'tam_giac', points: pts, color: '#FACC15', width: Math.max(2.4, w) });
      out.push({ type: 'duong', x1: cx, y1: cy - 68, x2: cx, y2: cy + 68, color: c, width: 1.4, dashed: true });
      out.push({ type: 'mui_ten', x1: cx - 105, y1: cy, x2: cx + 105, y2: cy, color: '#38BDF8', width: 1.8 });
      out.push({ type: 'chu', x: cx + 92, y: cy - 10, text: 'B', fontSize: 14, color: '#38BDF8' });
    } else if (shapeId === 'vl12_do_thi_ac') {
      out.push({ type: 'mui_ten', x1: cx - 125, y1: cy, x2: cx + 135, y2: cy, color: c, width: 1.6 });
      out.push({ type: 'mui_ten', x1: cx - 105, y1: cy + 68, x2: cx - 105, y2: cy - 68, color: c, width: 1.6 });
      const spts = [];
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 3;
        spts.push({ x: cx - 105 + (i / 64) * 215, y: cy - 48 * Math.sin(t) });
      }
      out.push({ type: 'but', points: spts, isPolyline: true, color: '#EF4444', width: Math.max(2.2, w) });
      out.push({ type: 'chu', x: cx - 124, y: cy - 54, text: 'E₀', fontSize: 13, color: c });
      out.push({ type: 'chu', x: cx + 122, y: cy + 16, text: 't', fontSize: 13, color: c });
    } else if (shapeId === 'vl12_may_bien_ap') {
      out.push({ type: 'hcn', x: cx - 64, y: cy - 48, w: 128, h: 96, color: c, width: w });
      out.push({ type: 'hcn', x: cx - 34, y: cy - 24, w: 68, h: 48, color: c, width: 1.6 });
      for (let i = 0; i < 4; i++) {
        const yy = cy - 22 + i * 14;
        out.push({ type: 'duong', x1: cx - 72, y1: yy, x2: cx - 26, y2: yy + 5, color: '#EF4444', width: 2.2 });
        out.push({ type: 'duong', x1: cx + 26, y1: yy, x2: cx + 72, y2: yy + 5, color: '#38BDF8', width: 2.2 });
      }
      out.push({ type: 'chu', x: cx - 92, y: cy + 5, text: 'N₁', fontSize: 14, color: '#EF4444' });
      out.push({ type: 'chu', x: cx + 78, y: cy + 5, text: 'N₂', fontSize: 14, color: '#38BDF8' });
    } else if (shapeId === 'vl12_song_dien_tu') {
      out.push({ type: 'mui_ten', x1: cx - 120, y1: cy, x2: cx + 130, y2: cy, color: c, width: 1.8 });
      const ePts = [], bPts = [];
      for (let i = 0; i <= 56; i++) {
        const t = (i / 56) * Math.PI * 2.5;
        const px = cx - 105 + (i / 56) * 210;
        const amp = Math.sin(t);
        ePts.push({ x: px, y: cy - 44 * amp });
        bPts.push({ x: px - 18 * amp, y: cy + 20 * amp });
      }
      out.push({ type: 'but', points: ePts, isPolyline: true, color: '#EF4444', width: 2.2 });
      out.push({ type: 'but', points: bPts, isPolyline: true, color: '#38BDF8', width: 2.2, dashed: true });
      out.push({ type: 'chu', x: cx + 118, y: cy - 10, text: 'v', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx - 80, y: cy - 52, text: 'E', fontSize: 13, color: '#EF4444' });
      out.push({ type: 'chu', x: cx - 55, y: cy + 44, text: 'B', fontSize: 13, color: '#38BDF8' });
    } else if (shapeId === 'vl12_hat_nhan') {
      [[-10, -8, '#EF4444'], [8, -10, '#94A3B8'], [-14, 10, '#94A3B8'], [6, 8, '#EF4444'], [0, -2, '#EF4444'], [18, 2, '#94A3B8'], [-2, 16, '#EF4444']].forEach(([ox, oy, colP]) => {
        out.push({ type: 'elip', x: cx + ox - 10, y: cy + oy - 10, w: 20, h: 20, color: colP, width: 2 });
      });
      out.push({ type: 'chu', x: cx - 42, y: cy + 44, text: 'Hạt nhân (p, n)', fontSize: 13, color: c });
    } else if (shapeId === 'vl12_phan_ra') {
      out.push({ type: 'mui_ten', x1: cx - 115, y1: cy + 65, x2: cx + 125, y2: cy + 65, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 95, y1: cy + 82, x2: cx - 95, y2: cy - 82, color: c, width: 1.8 });
      const dPts = [];
      for (let i = 0; i <= 40; i++) {
        const u = (i / 40) * 3.0;
        dPts.push({ x: cx - 95 + u * 66, y: cy + 65 - 120 * Math.pow(2, -u) });
      }
      out.push({ type: 'but', points: dPts, isPolyline: true, color: '#EF4444', width: Math.max(2.4, w) });
      out.push({ type: 'chu', x: cx - 116, y: cy - 55, text: 'N₀', fontSize: 13, color: c });
      out.push({ type: 'chu', x: cx - 34, y: cy + 80, text: 'T', fontSize: 12, color: c });
      out.push({ type: 'chu', x: cx + 30, y: cy + 80, text: '2T', fontSize: 12, color: c });
    } else if (shapeId === 'vl12_phan_hach') {
      out.push({ type: 'mui_ten', x1: cx - 115, y1: cy, x2: cx - 48, y2: cy, color: c, width: 2.2 });
      out.push({ type: 'elip', x: cx - 45, y: cy - 22, w: 44, h: 44, color: '#F59E0B', width: 2.2 });
      out.push({ type: 'chu', x: cx - 33, y: cy + 5, text: 'U', fontSize: 15, color: '#F59E0B' });
      out.push({ type: 'mui_ten', x1: cx, y1: cy - 10, x2: cx + 62, y2: cy - 42, color: '#EF4444', width: 2 });
      out.push({ type: 'mui_ten', x1: cx, y1: cy + 10, x2: cx + 62, y2: cy + 42, color: '#38BDF8', width: 2 });
      out.push({ type: 'elip', x: cx + 65, y: cy - 58, w: 28, h: 28, color: '#EF4444', width: 2 });
      out.push({ type: 'elip', x: cx + 65, y: cy + 30, w: 28, h: 28, color: '#38BDF8', width: 2 });
      out.push({ type: 'chu', x: cx - 108, y: cy - 10, text: 'n', fontSize: 13, color: c });
    } else if (shapeId === 'vl12_nhiet_hach') {
      out.push({ type: 'elip', x: cx - 95, y: cy - 38, w: 28, h: 28, color: '#38BDF8', width: 2 });
      out.push({ type: 'elip', x: cx - 95, y: cy + 10, w: 28, h: 28, color: '#22C55E', width: 2 });
      out.push({ type: 'chu', x: cx - 86, y: cy - 19, text: 'D', fontSize: 13, color: '#38BDF8' });
      out.push({ type: 'chu', x: cx - 86, y: cy + 29, text: 'T', fontSize: 13, color: '#22C55E' });
      out.push({ type: 'mui_ten', x1: cx - 58, y1: cy, x2: cx + 8, y2: cy, color: c, width: 2.2 });
      out.push({ type: 'elip', x: cx + 14, y: cy - 22, w: 38, h: 38, color: '#F59E0B', width: 2.2 });
      out.push({ type: 'chu', x: cx + 23, y: cy + 3, text: 'He', fontSize: 13, color: '#F59E0B' });
      out.push({ type: 'mui_ten', x1: cx + 56, y1: cy - 4, x2: cx + 102, y2: cy - 28, color: c, width: 2 });
      out.push({ type: 'chu', x: cx + 96, y: cy - 34, text: 'n', fontSize: 13, color: c });
    } else if (shapeId === 'vl10_do_thi_dt') {
      out.push({ type: 'mui_ten', x1: cx - 115, y1: cy + 65, x2: cx + 125, y2: cy + 65, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 95, y1: cy + 80, x2: cx - 95, y2: cy - 82, color: c, width: 1.8 });
      out.push({ type: 'but', points: [{ x: cx - 95, y: cy + 65 }, { x: cx - 15, y: cy - 25 }, { x: cx + 45, y: cy - 25 }, { x: cx + 105, y: cy + 45 }], isPolyline: true, color: '#EF4444', width: Math.max(2.4, w) });
      out.push({ type: 'chu', x: cx - 110, y: cy - 72, text: 'd', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx + 115, y: cy + 82, text: 't', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx - 110, y: cy + 80, text: 'O', fontSize: 13, color: c });
    } else if (shapeId === 'vl10_do_thi_vt') {
      out.push({ type: 'mui_ten', x1: cx - 115, y1: cy + 65, x2: cx + 125, y2: cy + 65, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx - 95, y1: cy + 80, x2: cx - 95, y2: cy - 82, color: c, width: 1.8 });
      out.push({ type: 'but', points: [{ x: cx - 95, y: cy + 35 }, { x: cx - 10, y: cy - 45 }, { x: cx + 55, y: cy - 45 }, { x: cx + 105, y: cy + 65 }], isPolyline: true, color: '#2563EB', width: Math.max(2.4, w) });
      out.push({ type: 'duong', x1: cx - 10, y1: cy - 45, x2: cx - 10, y2: cy + 65, color: c, width: 1.3, dashed: true });
      out.push({ type: 'duong', x1: cx + 55, y1: cy - 45, x2: cx + 55, y2: cy + 65, color: c, width: 1.3, dashed: true });
      out.push({ type: 'chu', x: cx - 110, y: cy - 72, text: 'v', fontSize: 14, color: c });
      out.push({ type: 'chu', x: cx + 115, y: cy + 82, text: 't', fontSize: 14, color: c });
    } else if (shapeId === 'vl10_roi_tu_do') {
      out.push({ type: 'duong', x1: cx - 36, y1: cy - 75, x2: cx - 36, y2: cy + 75, color: c, width: 2 });
      out.push({ type: 'mui_ten', x1: cx + 28, y1: cy - 60, x2: cx + 28, y2: cy + 15, color: '#EF4444', width: 2.2 });
      out.push({ type: 'chu', x: cx + 36, y: cy - 22, text: 'g', fontSize: 14, color: '#EF4444' });
      [-60, -40, 0, 62].forEach((oy, idx) => {
        out.push({ type: 'elip', x: cx - 8, y: cy + oy - 8, w: 16, h: 16, color: '#F59E0B', width: 2 });
        out.push({ type: 'duong', x1: cx - 42, y1: cy + oy, x2: cx - 30, y2: cy + oy, color: c, width: 1.6 });
        out.push({ type: 'chu', x: cx - 64, y: cy + oy + 4, text: `${idx}t`, fontSize: 12, color: c });
      });
    } else if (shapeId === 'vl10_rong_roc_2vat') {
      out.push({ type: 'duong', x1: cx, y1: cy - 75, x2: cx, y2: cy - 45, color: c, width: 2.5 });
      out.push({ type: 'elip', x: cx - 26, y: cy - 45, w: 52, h: 52, color: c, width: w });
      out.push({ type: 'duong', x1: cx - 26, y1: cy - 19, x2: cx - 26, y2: cy + 32, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx + 26, y1: cy - 19, x2: cx + 26, y2: cy + 52, color: c, width: 1.8 });
      out.push({ type: 'hcn', x: cx - 42, y: cy + 32, w: 32, h: 28, color: '#38BDF8', width: 2 });
      out.push({ type: 'hcn', x: cx + 10, y: cy + 52, w: 32, h: 28, color: '#22C55E', width: 2 });
      out.push({ type: 'chu', x: cx - 35, y: cy + 50, text: 'm₁', fontSize: 12, color: '#38BDF8' });
      out.push({ type: 'chu', x: cx + 17, y: cy + 70, text: 'm₂', fontSize: 12, color: '#22C55E' });
    } else if (shapeId === 'vl10_moment_luc') {
      out.push({ type: 'duong', x1: cx - 120, y1: cy, x2: cx + 120, y2: cy, color: c, width: 3.5 });
      out.push({ type: 'elip', x: cx - 15 - 6, y: cy - 6, w: 12, h: 12, color: '#FACC15', width: 2 });
      out.push({ type: 'chu', x: cx - 20, y: cy - 12, text: 'O', fontSize: 14, color: '#FACC15' });
      out.push({ type: 'mui_ten', x1: cx - 90, y1: cy, x2: cx - 90, y2: cy + 58, color: '#EF4444', width: 2.4 });
      out.push({ type: 'mui_ten', x1: cx + 85, y1: cy, x2: cx + 85, y2: cy + 44, color: '#38BDF8', width: 2.4 });
      out.push({ type: 'chu', x: cx - 110, y: cy + 52, text: 'F₁', fontSize: 13, color: '#EF4444' });
      out.push({ type: 'chu', x: cx + 92, y: cy + 42, text: 'F₂', fontSize: 13, color: '#38BDF8' });
    } else if (shapeId === 'vl10_cong_co_hoc') {
      out.push({ type: 'duong', x1: cx - 125, y1: cy + 36, x2: cx + 125, y2: cy + 36, color: c, width: 2 });
      out.push({ type: 'hcn', x: cx - 95, y: cy - 4, w: 48, h: 40, color: '#38BDF8', width: 2 });
      out.push({ type: 'hcn', x: cx + 45, y: cy - 4, w: 48, h: 40, color: '#38BDF8', width: 1.6, dashed: true });
      out.push({ type: 'mui_ten', x1: cx - 47, y1: cy + 16, x2: cx + 38, y2: cy + 16, color: '#22C55E', width: 2 });
      out.push({ type: 'mui_ten', x1: cx - 65, y1: cy + 8, x2: cx - 5, y2: cy - 38, color: '#EF4444', width: 2.5 });
      out.push({ type: 'chu', x: cx - 12, y: cy - 42, text: 'F', fontSize: 14, color: '#EF4444' });
      out.push({ type: 'chu', x: cx - 32, y: cy + 4, text: 'α', fontSize: 13, color: '#FACC15' });
      out.push({ type: 'chu', x: cx - 4, y: cy + 30, text: 's', fontSize: 13, color: '#22C55E' });
    } else if (shapeId === 'vl10_bao_toan_co_nang') {
      const arc = [];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const x = cx - 105 + t * 210;
        const y = cy + 40 - 95 * Math.pow((t - 0.5) * 2, 2) * (t < 0.5 ? 1 : 0.72);
        arc.push({ x, y });
      }
      out.push({ type: 'but', points: arc, isPolyline: true, color: c, width: 2.6 });
      out.push({ type: 'elip', x: cx - 102, y: cy - 55, w: 18, h: 18, color: '#EF4444', width: 2 });
      out.push({ type: 'elip', x: cx - 9, y: cy + 24, w: 18, h: 18, color: '#FACC15', width: 2 });
      out.push({ type: 'duong', x1: cx - 120, y1: cy + 42, x2: cx + 120, y2: cy + 42, color: '#38BDF8', width: 1.5, dashed: true });
      out.push({ type: 'chu', x: cx - 118, y: cy - 62, text: 'A (h)', fontSize: 12, color: '#EF4444' });
      out.push({ type: 'chu', x: cx - 6, y: cy + 58, text: 'O (Wt=0)', fontSize: 12, color: '#38BDF8' });
    } else if (shapeId === 'vl10_va_cham') {
      out.push({ type: 'duong', x1: cx - 130, y1: cy + 32, x2: cx + 130, y2: cy + 32, color: c, width: 2 });
      out.push({ type: 'elip', x: cx - 85, y: cy - 4, w: 36, h: 36, color: '#38BDF8', width: 2.2 });
      out.push({ type: 'elip', x: cx + 35, y: cy - 4, w: 36, h: 36, color: '#EF4444', width: 2.2 });
      out.push({ type: 'mui_ten', x1: cx - 49, y1: cy + 14, x2: cx - 10, y2: cy + 14, color: '#38BDF8', width: 2.4 });
      out.push({ type: 'mui_ten', x1: cx + 35, y1: cy + 14, x2: cx - 2, y2: cy + 14, color: '#EF4444', width: 2.4 });
      out.push({ type: 'chu', x: cx - 75, y: cy + 18, text: 'm₁', fontSize: 12, color: '#38BDF8' });
      out.push({ type: 'chu', x: cx + 45, y: cy + 18, text: 'm₂', fontSize: 12, color: '#EF4444' });
      out.push({ type: 'chu', x: cx - 35, y: cy - 8, text: 'v₁', fontSize: 12, color: '#38BDF8' });
      out.push({ type: 'chu', x: cx + 10, y: cy - 8, text: 'v₂', fontSize: 12, color: '#EF4444' });
    } else if (shapeId === 'vl10_tron_deu') {
      const r = 64;
      out.push({ type: 'elip', x: cx - r, y: cy - r, w: r * 2, h: r * 2, color: c, width: 2, dashed: true });
      out.push({ type: 'diem', x: cx, y: cy, text: 'O', color: c });
      out.push({ type: 'duong', x1: cx, y1: cy, x2: cx + r, y2: cy, color: c, width: 1.6 });
      out.push({ type: 'elip', x: cx + r - 7, y: cy - 7, w: 14, h: 14, color: '#FACC15', width: 2 });
      out.push({ type: 'mui_ten', x1: cx + r, y1: cy, x2: cx + r, y2: cy - 58, color: '#22C55E', width: 2.4 });
      out.push({ type: 'mui_ten', x1: cx + r, y1: cy, x2: cx + 16, y2: cy, color: '#EF4444', width: 2.4 });
      out.push({ type: 'chu', x: cx + r + 8, y: cy - 48, text: 'v', fontSize: 14, color: '#22C55E' });
      out.push({ type: 'chu', x: cx + 18, y: cy - 10, text: 'Fht / aht', fontSize: 12, color: '#EF4444' });
    } else if (shapeId === 'vl10_dinh_luat_hooke') {
      out.push({ type: 'duong', x1: cx - 45, y1: cy - 72, x2: cx + 45, y2: cy - 72, color: c, width: 3 });
      const sp = [{ x: cx, y: cy - 72 }, { x: cx, y: cy - 56 }];
      for (let i = 0; i < 6; i++) {
        sp.push({ x: cx + (i % 2 === 0 ? -12 : 12), y: cy - 48 + i * 12 });
      }
      sp.push({ x: cx, y: cy + 20 }, { x: cx, y: cy + 34 });
      out.push({ type: 'but', points: sp, isPolyline: true, color: '#94A3B8', width: 2 });
      out.push({ type: 'hcn', x: cx - 18, y: cy + 34, w: 36, h: 32, color: '#38BDF8', width: 2 });
      out.push({ type: 'chu', x: cx - 8, y: cy + 54, text: 'm', fontSize: 13, color: '#38BDF8' });
      out.push({ type: 'duong', x1: cx + 28, y1: cy - 72, x2: cx + 28, y2: cy - 6, color: '#FACC15', width: 1.5, dashed: true });
      out.push({ type: 'duong', x1: cx + 28, y1: cy - 6, x2: cx + 28, y2: cy + 34, color: '#EF4444', width: 1.8 });
      out.push({ type: 'chu', x: cx + 34, y: cy - 36, text: 'l₀', fontSize: 12, color: '#FACC15' });
      out.push({ type: 'chu', x: cx + 34, y: cy + 18, text: 'Δl', fontSize: 12, color: '#EF4444' });
    } else if (shapeId === 'vl11_nang_luong_ddh') {
      out.push({ type: 'mui_ten', x1: cx - 115, y1: cy + 65, x2: cx + 115, y2: cy + 65, color: c, width: 1.8 });
      out.push({ type: 'mui_ten', x1: cx, y1: cy + 78, x2: cx, y2: cy - 82, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx - 85, y1: cy - 45, x2: cx + 85, y2: cy - 45, color: '#FACC15', width: 2, dashed: true });
      const wtPts = [], wdPts = [];
      for (let i = -24; i <= 24; i++) {
        const u = i / 24;
        wtPts.push({ x: cx + u * 82, y: cy + 65 - 110 * u * u });
        wdPts.push({ x: cx + u * 82, y: cy - 45 + 110 * u * u });
      }
      out.push({ type: 'but', points: wtPts, isPolyline: true, color: '#EF4444', width: 2.2 });
      out.push({ type: 'but', points: wdPts, isPolyline: true, color: '#38BDF8', width: 2.2 });
      out.push({ type: 'chu', x: cx + 8, y: cy - 68, text: 'W', fontSize: 13, color: '#FACC15' });
      out.push({ type: 'chu', x: cx + 52, y: cy - 28, text: 'Wt', fontSize: 12, color: '#EF4444' });
      out.push({ type: 'chu', x: cx + 18, y: cy + 48, text: 'Wđ', fontSize: 12, color: '#38BDF8' });
    } else if (shapeId === 'vl11_giao_thoa_yang') {
      out.push({ type: 'duong', x1: cx - 75, y1: cy - 70, x2: cx - 75, y2: cy - 32, color: c, width: 3 });
      out.push({ type: 'duong', x1: cx - 75, y1: cy - 20, x2: cx - 75, y2: cy + 20, color: c, width: 3 });
      out.push({ type: 'duong', x1: cx - 75, y1: cy + 32, x2: cx - 75, y2: cy + 70, color: c, width: 3 });
      out.push({ type: 'duong', x1: cx + 85, y1: cy - 75, x2: cx + 85, y2: cy + 75, color: c, width: 2.5 });
      out.push({ type: 'duong', x1: cx - 90, y1: cy, x2: cx + 95, y2: cy, color: c, width: 1.3, dashed: true });
      out.push({ type: 'duong', x1: cx - 75, y1: cy - 26, x2: cx + 85, y2: cy - 34, color: '#EF4444', width: 1.8 });
      out.push({ type: 'duong', x1: cx - 75, y1: cy + 26, x2: cx + 85, y2: cy - 34, color: '#EF4444', width: 1.8 });
      out.push({ type: 'chu', x: cx - 96, y: cy - 22, text: 'S₁', fontSize: 12, color: c });
      out.push({ type: 'chu', x: cx - 96, y: cy + 30, text: 'S₂', fontSize: 12, color: c });
      out.push({ type: 'chu', x: cx + 92, y: cy - 30, text: 'M', fontSize: 12, color: '#EF4444' });
      out.push({ type: 'chu', x: cx + 92, y: cy + 4, text: 'O', fontSize: 12, color: c });
    } else if (shapeId === 'vl11_coulomb') {
      out.push({ type: 'duong', x1: cx - 120, y1: cy, x2: cx + 120, y2: cy, color: c, width: 1.4, dashed: true });
      out.push({ type: 'elip', x: cx - 64, y: cy - 14, w: 28, h: 28, color: '#EF4444', width: 2.2 });
      out.push({ type: 'elip', x: cx + 36, y: cy - 14, w: 28, h: 28, color: '#38BDF8', width: 2.2 });
      out.push({ type: 'chu', x: cx - 56, y: cy + 5, text: '+q₁', fontSize: 12, color: '#EF4444' });
      out.push({ type: 'chu', x: cx + 44, y: cy + 5, text: '-q₂', fontSize: 12, color: '#38BDF8' });
      out.push({ type: 'mui_ten', x1: cx - 36, y1: cy, x2: cx - 4, y2: cy, color: '#22C55E', width: 2.2 });
      out.push({ type: 'mui_ten', x1: cx + 36, y1: cy, x2: cx + 4, y2: cy, color: '#22C55E', width: 2.2 });
      out.push({ type: 'chu', x: cx - 18, y: cy - 10, text: 'F₁₂', fontSize: 11, color: '#22C55E' });
      out.push({ type: 'chu', x: cx + 8, y: cy - 10, text: 'F₂₁', fontSize: 11, color: '#22C55E' });
    } else if (shapeId === 'vl11_dien_truong_deu') {
      out.push({ type: 'duong', x1: cx - 80, y1: cy - 45, x2: cx + 80, y2: cy - 45, color: '#EF4444', width: 3.5 });
      out.push({ type: 'duong', x1: cx - 80, y1: cy + 45, x2: cx + 80, y2: cy + 45, color: '#38BDF8', width: 3.5 });
      [-48, 0, 48].forEach((ox) => {
        out.push({ type: 'mui_ten', x1: cx + ox, y1: cy - 42, x2: cx + ox, y2: cy + 42, color: '#FACC15', width: 1.8 });
      });
      out.push({ type: 'elip', x: cx - 8, y: cy - 8, w: 16, h: 16, color: '#22C55E', width: 2 });
      out.push({ type: 'chu', x: cx + 86, y: cy - 40, text: '+ + +', fontSize: 12, color: '#EF4444' });
      out.push({ type: 'chu', x: cx + 86, y: cy + 48, text: '- - -', fontSize: 12, color: '#38BDF8' });
      out.push({ type: 'chu', x: cx + 14, y: cy + 4, text: 'q, E', fontSize: 12, color: '#22C55E' });
    } else if (shapeId === 'vl11_tu_dien') {
      out.push({ type: 'duong', x1: cx - 70, y1: cy, x2: cx - 10, y2: cy, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx + 10, y1: cy, x2: cx + 70, y2: cy, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx - 10, y1: cy - 32, x2: cx - 10, y2: cy + 32, color: c, width: 3.2 });
      out.push({ type: 'duong', x1: cx + 10, y1: cy - 32, x2: cx + 10, y2: cy + 32, color: c, width: 3.2 });
      out.push({ type: 'chu', x: cx - 6, y: cy - 40, text: 'C', fontSize: 15, color: c });
    } else if (shapeId === 'vl11_mach_kin') {
      out.push({ type: 'duong', x1: cx - 85, y1: cy - 45, x2: cx - 12, y2: cy - 45, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx + 10, y1: cy - 45, x2: cx + 85, y2: cy - 45, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx - 12, y1: cy - 64, x2: cx - 12, y2: cy - 26, color: '#EF4444', width: 2.8 });
      out.push({ type: 'duong', x1: cx + 10, y1: cy - 55, x2: cx + 10, y2: cy - 35, color: '#38BDF8', width: 3.8 });
      out.push({ type: 'duong', x1: cx - 85, y1: cy - 45, x2: cx - 85, y2: cy + 45, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx + 85, y1: cy - 45, x2: cx + 85, y2: cy + 45, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx - 85, y1: cy + 45, x2: cx - 32, y2: cy + 45, color: c, width: 2 });
      out.push({ type: 'hcn', x: cx - 32, y: cy + 32, w: 64, h: 26, color: '#FACC15', width: 2.2 });
      out.push({ type: 'duong', x1: cx + 32, y1: cy + 45, x2: cx + 85, y2: cy + 45, color: c, width: 2 });
      out.push({ type: 'chu', x: cx - 16, y: cy - 70, text: 'E, r', fontSize: 13, color: c });
      out.push({ type: 'chu', x: cx - 6, y: cy + 50, text: 'R', fontSize: 13, color: '#FACC15' });
    } else if (shapeId === 'vl11_ghep_dien_tro') {
      out.push({ type: 'duong', x1: cx - 105, y1: cy - 28, x2: cx - 75, y2: cy - 28, color: c, width: 2 });
      out.push({ type: 'hcn', x: cx - 75, y: cy - 40, w: 54, h: 24, color: '#38BDF8', width: 2 });
      out.push({ type: 'duong', x1: cx - 21, y1: cy - 28, x2: cx + 21, y2: cy - 28, color: c, width: 2 });
      out.push({ type: 'hcn', x: cx + 21, y: cy - 40, w: 54, h: 24, color: '#22C55E', width: 2 });
      out.push({ type: 'duong', x1: cx + 75, y1: cy - 28, x2: cx + 105, y2: cy - 28, color: c, width: 2 });
      out.push({ type: 'chu', x: cx - 55, y: cy - 23, text: 'R₁', fontSize: 12, color: '#38BDF8' });
      out.push({ type: 'chu', x: cx + 41, y: cy - 23, text: 'R₂', fontSize: 12, color: '#22C55E' });
      out.push({ type: 'duong', x1: cx - 80, y1: cy + 36, x2: cx - 50, y2: cy + 36, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx - 50, y1: cy + 16, x2: cx - 50, y2: cy + 56, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx + 50, y1: cy + 16, x2: cx + 50, y2: cy + 56, color: c, width: 2 });
      out.push({ type: 'duong', x1: cx + 50, y1: cy + 36, x2: cx + 80, y2: cy + 36, color: c, width: 2 });
      out.push({ type: 'hcn', x: cx - 26, y: cy + 6, w: 52, h: 20, color: '#38BDF8', width: 1.8 });
      out.push({ type: 'hcn', x: cx - 26, y: cy + 46, w: 52, h: 20, color: '#22C55E', width: 1.8 });
      out.push({ type: 'duong', x1: cx - 50, y1: cy + 16, x2: cx - 26, y2: cy + 16, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx + 26, y1: cy + 16, x2: cx + 50, y2: cy + 16, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx - 50, y1: cy + 56, x2: cx - 26, y2: cy + 56, color: c, width: 1.8 });
      out.push({ type: 'duong', x1: cx + 26, y1: cy + 56, x2: cx + 50, y2: cy + 56, color: c, width: 1.8 });
    }
    for (const o of out) {
      if (o && o.type === 'chu') o.isPresetLabel = true;
    }
    return out;
  }

  function beautifyHandwritingStroke(rawPts, style) {
    if (!rawPts || rawPts.length < 4) return null;
    const cleaned = cleanRawPoints(rawPts, 0.7);
    const pts = pruneHoldDwellPoints(cleaned, 6.0);
    if (pts.length < 4) return null;

    // 1. Phát hiện các đỉnh gập / đảo chiều sắc nét (như 2 chân gấp của chữ m, n, w, F, 2)
    const cusps = [0];
    const n = pts.length;
    for (let i = 2; i < n - 2; i++) {
      let li = i - 1;
      while (li > 0 && distPt(pts[i], pts[li]) < 3.5) li--;
      let ri = i + 1;
      while (ri < n - 1 && distPt(pts[i], pts[ri]) < 3.5) ri++;
      const v1x = pts[i].x - pts[li].x, v1y = pts[i].y - pts[li].y;
      const v2x = pts[ri].x - pts[i].x, v2y = pts[ri].y - pts[i].y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 < 2.2 || l2 < 2.2) continue;
      const cosA = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
      const turnDeg = Math.acos(cosA) * (180 / Math.PI);
      if (turnDeg >= 52.0) {
        const lastCusp = cusps[cusps.length - 1];
        if (i - lastCusp >= 3 && distPt(pts[i], pts[lastCusp]) >= 4.5) {
          cusps.push(i);
        }
      }
    }
    if (cusps[cusps.length - 1] !== n - 1) cusps.push(n - 1);

    // 2. Làm đẹp từng phân đoạn giữa các đỉnh gập: giữ sắc đỉnh gập, nắn thẳng nhẹ nét thẳng, làm mượt vòng cung
    const out = [];
    for (let ci = 0; ci < cusps.length - 1; ci++) {
      const i0 = cusps[ci], i1 = cusps[ci + 1];
      let seg = pts.slice(i0, i1 + 1).map((p) => ({ x: p.x, y: p.y }));
      if (seg.length >= 3) {
        const a = seg[0], b = seg[seg.length - 1];
        const segChord = distPt(a, b);
        const segLen = polyLength(seg);
        let maxPerp = 0;
        for (let j = 1; j < seg.length - 1; j++) {
          const d = distToSegment(seg[j].x, seg[j].y, a.x, a.y, b.x, b.y);
          if (d > maxPerp) maxPerp = d;
        }
        if (segChord >= 6 && maxPerp / segChord <= 0.085 && segLen / segChord <= 1.08) {
          // Nét thân thẳng (cột dọc chữ m, n, F, 1): nắn thẳng nhẹ nhàng 80% giữ độ nghiêng tự nhiên
          for (let j = 1; j < seg.length - 1; j++) {
            const t = j / (seg.length - 1);
            const lx = a.x + (b.x - a.x) * t;
            const ly = a.y + (b.y - a.y) * t;
            seg[j] = { x: seg[j].x * 0.2 + lx * 0.8, y: seg[j].y * 0.2 + ly * 0.8 };
          }
        } else {
          // Vòng cung (nhịp vòm chữ m, n, u, a, 2): làm mượt 3 lượt Laplacian giữ nguyên 2 đầu mút
          for (let pass = 0; pass < 3; pass++) {
            const next = [seg[0]];
            for (let j = 1; j < seg.length - 1; j++) {
              next.push({
                x: 0.24 * seg[j - 1].x + 0.52 * seg[j].x + 0.24 * seg[j + 1].x,
                y: 0.24 * seg[j - 1].y + 0.52 * seg[j].y + 0.24 * seg[j + 1].y
              });
            }
            next.push(seg[seg.length - 1]);
            seg = next;
          }
        }
      }
      for (let j = ci === 0 ? 0 : 1; j < seg.length; j++) {
        out.push(seg[j]);
      }
    }
    if (out.length < 2) return null;
    return {
      type: 'but',
      points: out,
      isBeautifiedHandwriting: true,
      color: style.color,
      width: style.width,
      dashed: style.dashed,
      shapeLabel: 'Làm đẹp nét chữ viết tay ✨'
    };
  }

  function tryAutoTwoStrokeSymbol(prevObj, curObj, contextObjs = null) {
    if (!prevObj || !curObj) return null;
    if (prevObj.hidden || curObj.hidden || prevObj.isHighlighter || curObj.isHighlighter) return null;
    const validType = (t) => t === 'but' || t === 'duong';
    if (!validType(prevObj.type) || !validType(curObj.type)) return null;

    const extract = (o) => {
      const pts = o.type === 'duong'
        ? [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }]
        : (o.points || []);
      if (pts.length < 2) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return {
        pts,
        pStart: pts[0],
        pEnd: pts[pts.length - 1],
        minX, maxX, minY, maxY,
        w: maxX - minX,
        h: maxY - minY,
        len: polyLength(pts)
      };
    };

    const p1 = extract(prevObj);
    const p2 = extract(curObj);
    if (!p1 || !p2) return null;

    const style = {
      color: curObj.color || prevObj.color || '#ffffff',
      width: curObj.width || prevObj.width || 2.8,
      dashed: Boolean(curObj.dashed)
    };

    // 1. Hai dấu gạch ngang ngắn -> Dấu bằng (=)
    const isShortHoriz = (info) => {
      const ch = distPt(info.pStart, info.pEnd);
      if (ch < 9 || ch > 64) return false;
      if (info.len / Math.max(1, ch) > 1.24) return false;
      const dx = Math.abs(info.pEnd.x - info.pStart.x);
      const dy = Math.abs(info.pEnd.y - info.pStart.y);
      return dx >= 9 && dy <= Math.max(8, dx * 0.34) && info.h <= Math.max(10, info.w * 0.45);
    };
    if (isShortHoriz(p1) && isShortHoriz(p2)) {
      const cx1 = (p1.minX + p1.maxX) * 0.5, cy1 = (p1.minY + p1.maxY) * 0.5;
      const cx2 = (p2.minX + p2.maxX) * 0.5, cy2 = (p2.minY + p2.maxY) * 0.5;
      const maxW = Math.max(p1.w, p2.w), minW = Math.min(p1.w, p2.w);
      const dyGap = Math.abs(cy2 - cy1);
      if (
        minW / Math.max(1, maxW) >= 0.68 &&
        Math.abs(p1.minX - p2.minX) <= Math.max(8, maxW * 0.25) &&
        Math.abs(cx2 - cx1) <= Math.max(10, maxW * 0.35) &&
        dyGap >= 3.5 &&
        dyGap <= Math.min(20, Math.max(12, maxW * 0.65))
      ) {
        let hasVerticalStem = false;
        if (Array.isArray(contextObjs)) {
          const leftRef = Math.min(p1.minX, p2.minX);
          const topRef = Math.min(p1.minY, p2.minY) - 8;
          const botRef = Math.max(p1.maxY, p2.maxY) + 12;
          const recent = contextObjs.slice(-12);
          for (const co of recent) {
            if (!co || co === prevObj || co === curObj || co.hidden) continue;
            if (co.type !== 'but' && co.type !== 'duong') continue;
            const ci = extract(co);
            if (!ci || ci.h < 14) continue;
            if (ci.h >= ci.w * 1.15 && Math.abs(ci.minX - leftRef) <= 14 && ci.minY <= botRef && ci.maxY >= topRef) {
              hasVerticalStem = true;
              break;
            }
          }
        }
        if (!hasVerticalStem) {
          const L = (p1.w + p2.w) * 0.5;
          const cx = (cx1 + cx2) * 0.5;
          const midY = (cy1 + cy2) * 0.5;
          const gap = Math.max(5.5, dyGap);
          return {
            label: 'Dấu bằng chuẩn (=)',
            items: [
              { type: 'duong', x1: cx - L * 0.5, y1: midY - gap * 0.5, x2: cx + L * 0.5, y2: midY - gap * 0.5, ...style },
              { type: 'duong', x1: cx - L * 0.5, y1: midY + gap * 0.5, x2: cx + L * 0.5, y2: midY + gap * 0.5, ...style }
            ]
          };
        }
      }
    }

    const isShortVert = (inf) => {
      const ch = distPt(inf.pStart, inf.pEnd);
      if (ch < 9 || ch > 48 || inf.len / Math.max(1, ch) > 1.18) return false;
      const dx = Math.abs(inf.pEnd.x - inf.pStart.x);
      const dy = Math.abs(inf.pEnd.y - inf.pStart.y);
      return dy >= 9 && dx <= Math.max(5, dy * 0.25) && inf.w <= Math.max(7, inf.h * 0.32);
    };

    // 1b. Một nét dọc ngắn + một nét ngang ngắn giao nhau tại trung điểm -> Dấu cộng (+) (không nhầm với x hay t)
    const vStroke = isShortVert(p1) && isShortHoriz(p2) ? p1 : (isShortVert(p2) && isShortHoriz(p1) ? p2 : null);
    const hStroke = vStroke === p1 ? p2 : (vStroke === p2 ? p1 : null);
    if (vStroke && hStroke && vStroke.h <= 46 && hStroke.w <= 46) {
      const ratioVH = hStroke.w / Math.max(1, vStroke.h);
      const cxV = (vStroke.minX + vStroke.maxX) * 0.5, cyV = (vStroke.minY + vStroke.maxY) * 0.5;
      const cxH = (hStroke.minX + hStroke.maxX) * 0.5, cyH = (hStroke.minY + hStroke.maxY) * 0.5;
      const relY = (cyH - vStroke.minY) / Math.max(1, vStroke.h);
      if (
        ratioVH >= 0.55 && ratioVH <= 1.75 &&
        relY >= 0.33 && relY <= 0.67 &&
        Math.abs(cxV - cxH) <= Math.max(6, hStroke.w * 0.30) &&
        Math.abs(cyV - cyH) <= Math.max(6, vStroke.h * 0.30)
      ) {
        const L = (hStroke.w + vStroke.h) * 0.5;
        return {
          label: 'Dấu cộng chuẩn (+)',
          items: [
            { type: 'duong', x1: cxV - L * 0.5, y1: cyH, x2: cxV + L * 0.5, y2: cyH, ...style },
            { type: 'duong', x1: cxV, y1: cyH - L * 0.5, x2: cxV, y2: cyH + L * 0.5, ...style }
          ]
        };
      }
    }

    // 2. Một gạch đủ dài + 1 dấu nhọn (>) -> Mũi tên chuẩn (→)
    const shaftChord = distPt(p1.pStart, p1.pEnd);
    const tipDiag = Math.hypot(p2.w, p2.h);
    if (shaftChord >= 22 && p1.len / shaftChord <= 1.16 && p2.pts.length >= 3 && tipDiag >= 7 && tipDiag <= 48) {
      let apexIdx = -1, apexDist = -1;
      for (let i = 1; i < p2.pts.length - 1; i++) {
        const d = distToSegment(p2.pts[i].x, p2.pts[i].y, p2.pStart.x, p2.pStart.y, p2.pEnd.x, p2.pEnd.y);
        if (d > apexDist) { apexDist = d; apexIdx = i; }
      }
      if (apexIdx > 0 && apexDist >= 2.5) {
        const apex = p2.pts[apexIdx];
        const dEnd = distPt(apex, p1.pEnd);
        const dStart = distPt(apex, p1.pStart);
        const tailPt = dEnd <= dStart ? p1.pStart : p1.pEnd;
        const headRaw = dEnd <= dStart ? p1.pEnd : p1.pStart;
        const dApex = Math.min(dEnd, dStart);
        const ux = (headRaw.x - tailPt.x) / shaftChord;
        const uy = (headRaw.y - tailPt.y) / shaftChord;
        const perpApex = Math.abs((apex.x - tailPt.x) * uy - (apex.y - tailPt.y) * ux);
        if (dApex <= Math.min(14, Math.max(8, tipDiag * 0.5)) && perpApex <= 9 && distPt(p2.pStart, p2.pEnd) >= 5) {
          const w1x = p2.pStart.x - apex.x, w1y = p2.pStart.y - apex.y;
          const w2x = p2.pEnd.x - apex.x, w2y = p2.pEnd.y - apex.y;
          const l1 = Math.hypot(w1x, w1y), l2 = Math.hypot(w2x, w2y);
          if (l1 >= 3 && l2 >= 3 && Math.min(l1, l2) / Math.max(l1, l2) >= 0.45) {
            const dot1 = (w1x * ux + w1y * uy) / l1;
            const dot2 = (w2x * ux + w2y * uy) / l2;
            const cross1 = ux * w1y - uy * w1x;
            const cross2 = ux * w2y - uy * w2x;
            if (dot1 <= -0.25 && dot2 <= -0.25 && cross1 * cross2 < 0 && Math.abs(cross1) >= 2.5 && Math.abs(cross2) >= 2.5) {
              let x2 = headRaw.x, y2 = headRaw.y;
              const angDeg = Math.abs((Math.atan2(y2 - tailPt.y, x2 - tailPt.x) * 180) / Math.PI);
              if (angDeg <= 7.0 || Math.abs(angDeg - 180) <= 7.0) y2 = tailPt.y;
              else if (Math.abs(angDeg - 90) <= 7.0) x2 = tailPt.x;
              return {
                label: 'Mũi tên chuẩn (→)',
                items: [{ type: 'mui_ten', x1: tailPt.x, y1: tailPt.y, x2, y2, ...style }]
              };
            }
          }
        }
      }
    }

    // 3. Một thân dọc/móc dưới (chữ t) + 1 gạch ngang ngắn ở phần trên -> Chữ t chuẩn đẹp
    if (p1.h >= 18 && p1.h >= p1.w * 1.05 && isShortHoriz(p2)) {
      const cy2 = (p2.minY + p2.maxY) * 0.5;
      const cx2 = (p2.minX + p2.maxX) * 0.5;
      const relY = (cy2 - p1.minY) / Math.max(1, p1.h);
      if (relY >= 0.10 && relY <= 0.62) {
        let stemX = p1.pStart.x;
        let bestDy = Infinity;
        for (const pt of p1.pts) {
          const dy = Math.abs(pt.y - cy2);
          if (dy < bestDy) { bestDy = dy; stemX = pt.x; }
        }
        if (Math.abs(cx2 - stemX) <= Math.max(14, p2.w * 0.65)) {
          const beauStem = prevObj.type === 'but' ? beautifyHandwritingStroke(p1.pts, {
            color: prevObj.color || style.color,
            width: prevObj.width || style.width,
            dashed: Boolean(prevObj.dashed)
          }) : null;
          const stemItem = beauStem || prevObj;
          const barLen = Math.max(12, p2.w);
          return {
            label: 'Chữ t chuẩn đẹp ✨',
            items: [
              stemItem,
              { type: 'duong', x1: stemX - barLen * 0.5, y1: cy2, x2: stemX + barLen * 0.5, y2: cy2, ...style }
            ]
          };
        }
      }
    }

    return null;
  }

  return {
    AdaptiveInkProcessor,
    distToSegment,
    getObjectBBox,
    hitDistanceToObject,
    translateObject,
    rotateObject,
    scaleObject,
    scaleObjectFromAnchor,
    getObjectVertices,
    updateObjectVertex,
    buildWaveHyperbolaPoints,
    attachCurveControls,
    updateHeldShapeOnMove,
    fitSingleCubicBezier,
    sampleCubicBezierPts,
    smoothFreeCurve,
    findNearestSnapPoint,
    snapAnglePoint,
    recognizeSpecialShape,
    beautifyHandwritingStroke,
    tryAutoTwoStrokeSymbol,
    cacheCanvasBitmap: (key, canvas) => {
      if (!key || !canvas) return;
      canvas._isCanvas = true;
      imageCache[key] = canvas;
    },
    detectScribbleErase,
    createMathPhysicsPresets,
    computeShape3DGeometry,
    explodeShape3D,
    drawObject
  };
})();
