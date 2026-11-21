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
      // Lọc nhiễu siêu nhỏ < 1.5px để không sinh răng cưa nhưng vẫn giữ độ nhạy cao
      if (dist < 1.5) return false;

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
      if (!isClosed && this.cornerIndices.size >= 3 && (chord / Math.max(1.0, totalLen) < 0.72)) {
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

    // 6. TAM GIÁC: Kéo đỉnh cuối theo mũi bút
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
    if (idxBot >= n - 2) return null;
    const xBot = pts[idxBot].x, yBot = pts[idxBot].y;
    if (xBot - minX > 0.62 * w) return null;

    let hasTick = false, xTick = xBot, yTick = yBot;
    if (idxBot >= 1) {
      let idxTick = 0;
      for (let i = 1; i <= idxBot; i++) if (pts[i].y < pts[idxTick].y) idxTick = i;
      xTick = pts[idxTick].x; yTick = pts[idxTick].y;
      if (yBot - yTick >= Math.max(3.0, 0.05 * h)) hasTick = true;
    }

    const xEnd = pts[n - 1].x, yEnd = pts[n - 1].y;
    if (xEnd - minX < 0.42 * w || yEnd - minY > 0.65 * h) return null;

    const dxBe = xEnd - xBot, dyBe = yEnd - yBot, lenBe = Math.hypot(dxBe, dyBe);
    if (lenBe < 12) return null;

    let bestCorner = -1, maxDTl = -1e9;
    for (let i = idxBot + 1; i < n - 1; i++) {
      const dTl = ((pts[i].x - xBot) * dyBe - (pts[i].y - yBot) * dxBe) / lenBe;
      if (dTl > maxDTl) { maxDTl = dTl; bestCorner = i; }
    }
    if (bestCorner === -1 || maxDTl < Math.max(3.5, 0.07 * Math.min(w, h))) return null;

    const xCor = pts[bestCorner].x, yCor = pts[bestCorner].y;
    if (yCor - minY > 0.40 * h || xEnd - xCor < Math.max(10, 0.18 * w) || yBot - yCor < 0.42 * h) return null;
    if ((yBot - yCor) / Math.max(1, xCor - xBot) < 0.55) return null;
    if (Math.abs(yEnd - yCor) > 0.24 * h || Math.abs(yEnd - yCor) / Math.max(1, xEnd - xCor) > 0.28) return null;

    const barDx = Math.max(1, xEnd - xCor);
    for (let i = bestCorner; i < n; i++) {
      const expY = yCor + ((pts[i].x - xCor) * (yEnd - yCor)) / barDx;
      if (Math.abs(pts[i].y - expY) > Math.max(12, 0.38 * h)) return null;
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
    if (chord < 20) return null;
    const lenRatio = totalLen / chord;
    if (lenRatio < 1.035 || lenRatio > 2.85) return null;
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
      // Nới ngưỡng nhận diện đoạn thẳng thân thiện với mặt kính trơn & Apple Pencil 120Hz của iPad:
      // Tự động nắn thẳng khi độ võng <= 14% (hoặc <= 11px) và tự làm phẳng ngang/dọc nếu lệch <= 7.5°!
      const devRatio = maxAbsV / Math.max(1, chord);
      const isStraight =
        (devRatio <= 0.14 && lenRatio <= 1.24) ||
        (maxAbsV <= 11.0 && lenRatio <= 1.20);
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

      const sinRes = recognizeSineCosineWave(pts);
      if (sinRes) {
        return attachCurveControls({
          type: 'but',
          points: sinRes.dense,
          color: style.color, width: style.width, dashed: style.dashed,
          shapeLabel: 'Sóng hình Sin/Cos — Dịch bút để co giãn/xoay, hoặc kéo 3 điểm tròn!'
        }, 'sin_cos', { halfWaves: sinRes.halfWaves });
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
      if (!isHandwriting && chord >= 18) {
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

  function getObjectBBox(obj) {
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
      const edges = [
        [b.x0, b.y0, b.x1, b.y0], [b.x1, b.y0, b.x1, b.y1],
        [b.x1, b.y1, b.x0, b.y1], [b.x0, b.y1, b.x0, b.y0]
      ];
      return Math.min(...edges.map((e) => distToSegment(px, py, e[0], e[1], e[2], e[3])));
    } else if (obj.type === 'xoa_vung' || obj.type === 'anh') {
      const b = getObjectBBox(obj);
      return (px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1) ? 0 : Infinity;
    } else if (obj.type === 'elip') {
      const b = getObjectBBox(obj);
      const cx = (b.x0 + b.x1) * 0.5, cy = (b.y0 + b.y1) * 0.5;
      const rx = Math.max(2, (b.x1 - b.x0) * 0.5), ry = Math.max(2, (b.y1 - b.y0) * 0.5);
      return Math.abs(Math.hypot((px - cx) / rx, (py - cy) / ry) - 1.0) * Math.min(rx, ry);
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
    } else if (obj.type === 'chu' || obj.type === 'cong_thuc' || obj.type === 'ghi_chu') {
      const b = getObjectBBox(obj);
      return (px >= b.x0 - 4 && px <= b.x1 + 4 && py >= b.y0 - 4 && py <= b.y1 + 4) ? 0 : Infinity;
    }
    return Infinity;
  }

  function translateObject(obj, dx, dy) {
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
      // MỌI ĐƯỜNG CONG TRÊN IPAD ĐỒNG BỘ 100% VỚI BẢN EXE TRÊN PC:
      // Luôn dùng ĐÚNG 4 điểm điều khiển Cubic Bézier: P0 (Đầu), C1 (Tiếp tuyến đầu), C2 (Tiếp tuyến đuôi), P3 (Cuối)!
      if (!obj.bezierCtrlPts || obj.bezierCtrlPts.length !== 4) {
        obj.bezierCtrlPts = fitSingleCubicBezier(obj.points).map((p) => ({ x: p.x, y: p.y }));
        if (!obj.curveType) obj.curveType = 'duong_cong';
      }
      return obj.bezierCtrlPts.map((c, idx) => ({
        x: c.x,
        y: c.y,
        role: `bezier_cp_${idx}`,
        isCurveControl: true,
        isTangentHandle: idx === 1 || idx === 2
      }));
    }
    return [];
  }

  function updateObjectVertex(obj, role, newX, newY) {
    if (obj.type === 'diem') {
      obj.x = newX; obj.y = newY;
    } else if (obj.type === 'duong' || obj.type === 'mui_ten') {
      if (role === 'p1') { obj.x1 = newX; obj.y1 = newY; }
      else if (role === 'p2') { obj.x2 = newX; obj.y2 = newY; }
    } else if (obj.type === 'hcn') {
      const x0 = obj.x, y0 = obj.y, x1 = obj.x + obj.w, y1 = obj.y + obj.h;
      let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
      if (String(role).includes('w')) nx0 = Math.min(newX, x1 - 6);
      if (String(role).includes('e')) nx1 = Math.max(newX, x0 + 6);
      if (String(role).includes('n')) ny0 = Math.min(newY, y1 - 6);
      if (String(role).includes('s')) ny1 = Math.max(newY, y0 + 6);
      obj.x = nx0; obj.y = ny0; obj.w = nx1 - nx0; obj.h = ny1 - ny0;
    } else if (obj.type === 'elip') {
      const x0 = obj.x, y0 = obj.y, x1 = obj.x + obj.w, y1 = obj.y + obj.h;
      if (role === 'n') { obj.y = Math.min(newY, y1 - 8); obj.h = y1 - obj.y; }
      else if (role === 's') { obj.h = Math.max(8, newY - y0); }
      else if (role === 'w') { obj.x = Math.min(newX, x1 - 8); obj.w = x1 - obj.x; }
      else if (role === 'e') { obj.w = Math.max(8, newX - x0); }
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
      } else {
        obj.points[role].x = newX;
        obj.points[role].y = newY;
      }
    }
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
        ctx.font = 'bold 15px "Times New Roman", serif';
        ctx.fillText(obj.text, obj.x + 7, obj.y - 6);
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
      }
    } else if (obj.type === 'duong') {
      if (obj.isHighlighter) ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke();
    } else if (obj.type === 'mui_ten') {
      const dx = obj.x2 - obj.x1, dy = obj.y2 - obj.y1, dist = Math.hypot(dx, dy);
      ctx.beginPath(); ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke();
      if (dist > 6) {
        const ang = Math.atan2(dy, dx);
        const headLen = Math.min(dist * 0.45, Math.max(11, (obj.width || 2.6) * 4.2));
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(obj.x2, obj.y2);
        ctx.lineTo(obj.x2 - headLen * Math.cos(ang - 0.42), obj.y2 - headLen * Math.sin(ang - 0.42));
        ctx.lineTo(obj.x2 - headLen * 0.75 * Math.cos(ang), obj.y2 - headLen * 0.75 * Math.sin(ang));
        ctx.lineTo(obj.x2 - headLen * Math.cos(ang + 0.42), obj.y2 - headLen * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
      }
    } else if (obj.type === 'hcn') {
      ctx.beginPath(); ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
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
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(obj.w * 0.5), Math.abs(obj.h * 0.5), obj.angle || 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj.type === 'tam_giac' || obj.type === 'to_trong_suot') {
      const pts = obj.points || [];
      if (pts.length >= 3) {
        if (obj.type === 'to_trong_suot' || obj.hatch) {
          drawPolygonHatch(ctx, pts, obj.hatch || 'diagonal', obj.fillColor || obj.color || '#0066e0', obj.fillOpacity || 0.25);
        }
        if (obj.showBorder !== false) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.stroke();
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
    } else if (obj.type === 'anh' && obj.dataUrl) {
      let img = imageCache[obj.dataUrl];
      if (!img) {
        img = new Image(); img.src = obj.dataUrl; imageCache[obj.dataUrl] = img;
      }
      if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
    }
    ctx.restore();
  }

  function createMathPhysicsPresets(shapeId, cx, cy, style) {
    const c = style.color || '#0066e0', w = style.width || 2.6, out = [];
    if (shapeId === 'he_truc_oxy' || shapeId === 'oxy_mini') {
      out.push({ type: 'mui_ten', x1: cx - 120, y1: cy, x2: cx + 135, y2: cy, color: c, width: w });
      out.push({ type: 'mui_ten', x1: cx, y1: cy + 110, x2: cx, y2: cy - 125, color: c, width: w });
      for (let k = -4; k <= 4; k++) {
        if (k === 0) continue;
        out.push({ type: 'duong', x1: cx + k * 25, y1: cy - 3, x2: cx + k * 25, y2: cy + 3, color: c, width: 1.4 });
        out.push({ type: 'duong', x1: cx - 3, y1: cy - k * 25, x2: cx + 3, y2: cy - k * 25, color: c, width: 1.4 });
      }
      out.push({ type: 'chu', x: cx - 16, y: cy + 16, text: 'O', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 125, y: cy + 18, text: 'x', color: c, fontSize: 16 });
      out.push({ type: 'chu', x: cx + 8, y: cy - 112, text: 'y', color: c, fontSize: 16 });
    } else if (shapeId === 'tam_giac_deu') {
      const a = 130, h = a * Math.sqrt(3) * 0.5;
      out.push({
        type: 'tam_giac',
        points: [{ x: cx, y: cy - h * 0.6 }, { x: cx - a * 0.5, y: cy + h * 0.4 }, { x: cx + a * 0.5, y: cy + h * 0.4 }],
        vertexLabels: ['A', 'B', 'C'], color: c, width: w
      });
    } else if (shapeId === 'tam_giac_can') {
      out.push({
        type: 'tam_giac',
        points: [{ x: cx, y: cy - 85 }, { x: cx - 65, y: cy + 60 }, { x: cx + 65, y: cy + 60 }],
        vertexLabels: ['A', 'B', 'C'], color: c, width: w
      });
    } else if (shapeId === 'tam_giac_vuong') {
      out.push({
        type: 'tam_giac',
        points: [{ x: cx - 65, y: cy - 75 }, { x: cx - 65, y: cy + 55 }, { x: cx + 85, y: cy + 55 }],
        vertexLabels: ['B', 'A', 'C'], color: c, width: w
      });
      out.push({ type: 'hcn', x: cx - 65, y: cy + 43, w: 12, h: 12, color: c, width: 1.3 });
    } else if (shapeId === 'hinh_vuong') {
      out.push({
        type: 'tam_giac',
        points: [{ x: cx - 60, y: cy - 60 }, { x: cx + 60, y: cy - 60 }, { x: cx + 60, y: cy + 60 }, { x: cx - 60, y: cy + 60 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'hinh_binh_hanh') {
      out.push({
        type: 'tam_giac',
        points: [{ x: cx - 55, y: cy - 45 }, { x: cx + 85, y: cy - 45 }, { x: cx + 55, y: cy + 45 }, { x: cx - 85, y: cy + 45 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'hinh_thang') {
      out.push({
        type: 'tam_giac',
        points: [{ x: cx - 45, y: cy - 48 }, { x: cx + 45, y: cy - 48 }, { x: cx + 85, y: cy + 48 }, { x: cx - 85, y: cy + 48 }],
        vertexLabels: ['A', 'B', 'C', 'D'], color: c, width: w
      });
    } else if (shapeId === 'hinh_thang_vuong') {
      out.push({
        type: 'tam_giac',
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
    } else if (shapeId === 'song_dung') {
      const pts1 = [], pts2 = [];
      for (let i = 0; i <= 90; i++) {
        const t = i / 90, x = cx - 135 + t * 270, dy = Math.sin(t * Math.PI * 3) * 48;
        pts1.push({ x, y: cy - dy });
        pts2.push({ x, y: cy + dy });
      }
      out.push(attachCurveControls({ type: 'but', points: pts1, color: c, width: w }, 'sin_cos', { halfWaves: 3 }));
      out.push(attachCurveControls({ type: 'but', points: pts2, color: c, width: w, dashed: true }, 'sin_cos', { halfWaves: 3 }));
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
    } else if (shapeId === 'con_lac_lo_xo') {
      out.push({ type: 'duong', x1: cx - 120, y1: cy - 45, x2: cx - 120, y2: cy + 25, color: c, width: w * 1.3 });
      out.push({ type: 'duong', x1: cx - 125, y1: cy + 25, x2: cx + 120, y2: cy + 25, color: c, width: 1.6 });
      const springPts = [{ x: cx - 120, y: cy }];
      for (let i = 1; i <= 10; i++) springPts.push({ x: cx - 120 + i * 14, y: cy + (i % 2 === 1 ? -14 : 14) });
      springPts.push({ x: cx + 30, y: cy });
      out.push({ type: 'but', points: springPts, isPolyline: true, color: c, width: w });
      out.push({ type: 'hcn', x: cx + 30, y: cy - 22, w: 48, h: 44, color: c, width: w });
      out.push({ type: 'chu', x: cx + 47, y: cy + 6, text: 'm', color: c, fontSize: 18 });
    } else if (shapeId === 'con_lac_don') {
      out.push({ type: 'duong', x1: cx - 60, y1: cy - 90, x2: cx + 60, y2: cy - 90, color: c, width: w * 1.3 });
      out.push({ type: 'duong', x1: cx, y1: cy - 90, x2: cx, y2: cy + 75, color: c, width: 1.5, dashed: true });
      out.push({ type: 'duong', x1: cx, y1: cy - 90, x2: cx + 65, y2: cy + 50, color: c, width: w });
      out.push({ type: 'elip', x: cx + 51, y: cy + 36, w: 28, h: 28, color: c, width: w });
      out.push({ type: 'chu', x: cx + 10, y: cy - 42, text: 'α', color: c, fontSize: 16 });
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
      const dHalf = 95, s1x = cx - dHalf, s2x = cx + dHalf, wl = 34;
      out.push({ type: 'duong', x1: s1x - 25, y1: cy, x2: s2x + 25, y2: cy, color: c, width: 1.8 });
      out.push({ type: 'diem', x: s1x, y: cy, text: 'S₁', color: '#d92626' });
      out.push({ type: 'diem', x: s2x, y: cy, text: 'S₂', color: '#d92626' });
      out.push({ type: 'duong', x1: cx, y1: cy - 115, x2: cx, y2: cy + 115, color: c, width: 2.4 });
      [1, 2].forEach((k) => {
        const a = (k * wl) * 0.5;
        if (a < dHalf) {
          const b = Math.sqrt(dHalf * dHalf - a * a);
          [1, -1].forEach((sign) => {
            const pts = [];
            for (let yi = -110; yi <= 110; yi += 8) {
              const xVal = sign * a * Math.sqrt(1 + (yi / b) ** 2);
              pts.push({ x: cx + xVal, y: cy + yi });
            }
            out.push(attachCurveControls({ type: 'but', points: pts, color: c, width: 2.0 }, 'hyperbol'));
          });
        }
      });
      [0.5, 1.5].forEach((k) => {
        const a = (k * wl) * 0.5;
        if (a < dHalf) {
          const b = Math.sqrt(dHalf * dHalf - a * a);
          [1, -1].forEach((sign) => {
            const pts = [];
            for (let yi = -110; yi <= 110; yi += 8) {
              const xVal = sign * a * Math.sqrt(1 + (yi / b) ** 2);
              pts.push({ x: cx + xVal, y: cy + yi });
            }
            out.push(attachCurveControls({ type: 'but', points: pts, color: '#d92626', width: 1.6, dashed: true }, 'hyperbol'));
          });
        }
      });
    }
    return out;
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
    attachCurveControls,
    updateHeldShapeOnMove,
    fitSingleCubicBezier,
    sampleCubicBezierPts,
    smoothFreeCurve,
    findNearestSnapPoint,
    snapAnglePoint,
    recognizeSpecialShape,
    detectScribbleErase,
    createMathPhysicsPresets,
    drawObject
  };
})();
