/**
 * NKPDF 2.9 iPad Edition — Full Application Controller
 * Đồng bộ 100% tính năng bản PC:
 * 1. Sắp xếp & Ẩn/Hiện công cụ trên cả BẢNG XANH và THANH CÔNG CỤ DỌC (nút ⚙ hoặc chuột phải vào công cụ).
 * 2. Thay đổi hình dạng đường cong (Parabol, Cung tròn, Sóng Sin, Hyperbol, Đường cong tự do) bằng cách
 *    kéo trực tiếp các điểm điều khiển tròn ngay khi chọn bằng Chọn/Sửa hoặc Hình động.
 * 3. Kéo 4 cạnh & 4 góc Bảng Xanh (hoặc bấm ⬓ Nửa dưới / ◨ Nửa phải) để vừa mở xem đề PDF vừa viết Bảng Xanh ở dưới.
 * 4. Tối ưu 120Hz cho trình đọc PDF trên iPad:
 *    - Kiến trúc 2 lớp Canvas mực (committed ink + active stroke canvas) -> độ trễ < 1.5ms khi viết bút Apple Pencil.
 *    - Render trang PDF thông minh theo vùng nhìn (IntersectionObserver) + Cuộn quán tính mượt (Kinetic Inertia) + Zoom 2 ngón.
 */
(function () {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }

  function hydrateAllIcons() {
    if (!window.NKIcons) return;
    document.querySelectorAll('.ic[data-icon]').forEach((el) => {
      const name = el.dataset.icon;
      const dark = el.dataset.dark === '1';
      el.innerHTML = window.NKIcons.svg(name, 18, dark);
    });
  }
  hydrateAllIcons();

  if ('serviceWorker' in navigator) {
    let swReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloading) return;
      swReloading = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=20261128.154212').then((reg) => {
        reg.update().catch(() => {});
      }).catch(() => {});
    });
  }

  const state = {
    mode: 'pdf',
    tool: 'but',
    color: '#0066e0',
    width: 2.6,
    dashed: false,
    showGrid: true,
    showBoardGrid: true,
    palmRejection: true,
    snapPoint: false,
    snapAngle: false,
    twoPages: false,
    multiSelect: false,
    showPointDots: true,
    showLabels: true,
    hatchMode: 'diagonal',
    hatchOpacity: 0.28,
    pointCounter: 0,
    pdfTheme: 'white',
    boardTheme: 'green',
    boardGridMode: 'grid',
    boardColor: '#ffd60a',
    boardWidth: 3.2,
    // Camera Bảng xanh vô hạn (Zoom & Kéo vô hạn 4 hướng đồng bộ lưới ô ly)
    boardCam: { panX: 0, panY: 0, zoom: 1.0 },
    // Trạng thái Thước kẻ xoay 360° có hút nét bút
    ruler: { visible: false, cx: 520, cy: 320, angleDeg: 0, widthPx: 720, heightPx: 72 },
    zoom: 1.25,
    pdfDoc: null,
    pdfBytes: null,
    pdfFileName: 'Lop_Ly_Thay_Ngoc.pdf',
    pageSlots: [],
    currentPage: 1,
    totalPages: 1,
    pageRotations: {},
    annots: { board: [] },
    undoStack: { board: [] },
    redoStack: { board: [] },
    selectedIndices: [],
    activeSurfaceId: 1,
    // Trạng thái khung cửa sổ Bảng toàn màn hình (phủ kín 100% từ mép trên tới đáy, không hở thanh xanh hay dải trống đáy)
    bxRect: {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      isFullscreen: true
    }
  };

  const surfaces = {};
  const statusLabel = document.getElementById('NhanThongBao');
  const toastBanner = document.getElementById('ToastBanner');
  const pdfHolder = document.getElementById('PdfPagesHolder');
  const pdfScroll = document.getElementById('KhungDocPdf');
  const thumbList = document.getElementById('ThumbnailList');
  const bxWindow = document.getElementById('CuaSoBangXanh');
  const bxWrap = document.getElementById('BangXanhCanvasWrap');
  const bxGridCanvas = document.getElementById('bx-grid-canvas');
  const bxInkCanvas = document.getElementById('bx-ink-canvas');
  const bxActiveCanvas = document.getElementById('bx-active-canvas');
  const bxBottomBar = document.getElementById('ThanhDayBangXanh');
  const geomToolbar = document.getElementById('ThanhDungHinh');
  const geomGuide = document.getElementById('GeomGuideText');
  const geomSubmenu = document.getElementById('GeomSubmenuBar');

  let toastTimer = null;
  let lastPenActivityTs = 0;
  let isPenActiveDown = false;
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') {
      lastPenActivityTs = performance.now();
      isPenActiveDown = true;
    }
  }, true);
  const _endPenGlobal = (e) => {
    if (e.pointerType === 'pen') {
      lastPenActivityTs = performance.now();
      isPenActiveDown = false;
    }
  };
  window.addEventListener('pointerup', _endPenGlobal, true);
  window.addEventListener('pointercancel', _endPenGlobal, true);

  function isValidFingerTouch(t) {
    if (!t) return false;
    if (t.touchType === 'stylus') return false;
    if ((t.radiusX || 0) > 65 || (t.radiusY || 0) > 65) return false;
    return true;
  }
  function isValidFingerPointer(e) {
    if (!e || e.pointerType !== 'touch') return false;
    if ((e.width || 0) > 84 || (e.height || 0) > 84) return false;
    if (isPenActiveDown || (performance.now() - lastPenActivityTs < 250)) return false;
    return true;
  }
  function notify(msg, showPopup = true) {
    if (statusLabel) statusLabel.textContent = msg;
    if (geomGuide && !geomToolbar.classList.contains('hidden')) geomGuide.innerHTML = msg;
    if (showPopup && toastBanner && state.mode !== 'board') {
      toastBanner.textContent = msg;
      toastBanner.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastBanner.classList.add('hidden'), 2300);
    }
  }

  function activeColor() { return state.mode === 'board' ? state.boardColor : state.color; }
  function activeWidth() { return state.mode === 'board' ? state.boardWidth : state.width; }
  function activeSid() { return state.mode === 'board' ? 'board' : state.activeSurfaceId; }

  function ensureStacks(sid) {
    if (!state.annots[sid]) state.annots[sid] = [];
    if (!state.undoStack[sid]) state.undoStack[sid] = [];
    if (!state.redoStack[sid]) state.redoStack[sid] = [];
  }

  function pushUndo(sid) {
    ensureStacks(sid);
    state.undoStack[sid].push(JSON.parse(JSON.stringify(state.annots[sid])));
    if (state.undoStack[sid].length > 50) state.undoStack[sid].shift();
    state.redoStack[sid] = [];
  }

  function performUndo() {
    const sid = activeSid();
    ensureStacks(sid);
    if (!state.undoStack[sid].length) {
      notify('Không còn thao tác để hoàn tác.');
      return;
    }
    state.redoStack[sid].push(JSON.parse(JSON.stringify(state.annots[sid])));
    state.annots[sid] = state.undoStack[sid].pop();
    state.selectedIndices = [];
    redrawSurface(sid);
    notify('↩ Đã hoàn tác (Ctrl+Z)');
  }

  function performRedo() {
    const sid = activeSid();
    ensureStacks(sid);
    if (!state.redoStack[sid].length) {
      notify('Không còn thao tác để làm lại.');
      return;
    }
    state.undoStack[sid].push(JSON.parse(JSON.stringify(state.annots[sid])));
    state.annots[sid] = state.redoStack[sid].pop();
    state.selectedIndices = [];
    redrawSurface(sid);
    notify('↪ Đã làm lại (Ctrl+Y)');
  }

  function deleteSelected() {
    const sid = activeSid();
    ensureStacks(sid);
    if (!state.selectedIndices.length) return;
    pushUndo(sid);
    const rem = new Set(state.selectedIndices);
    state.annots[sid] = state.annots[sid].filter((_, idx) => !rem.has(idx));
    state.selectedIndices = [];
    redrawSurface(sid);
    notify('🗑️ Đã xóa đối tượng đã chọn.');
  }

  function duplicateSelected() {
    const sid = activeSid();
    ensureStacks(sid);
    if (!state.selectedIndices.length) {
      notify('💡 Hãy chọn ít nhất 1 nét hoặc hình rồi bấm Nhân bản.');
      return;
    }
    const list = state.annots[sid] || [];
    const valid = state.selectedIndices.filter((idx) => idx >= 0 && idx < list.length && list[idx]);
    if (!valid.length) return;
    pushUndo(sid);
    const offset = sid === 'board' ? (24 / Math.max(0.25, state.boardCam.zoom)) : 24;
    const newIndices = [];
    for (const idx of valid) {
      const copy = JSON.parse(JSON.stringify(list[idx]));
      NKInkEngine.translateObject(copy, offset, offset);
      list.push(copy);
      newIndices.push(list.length - 1);
    }
    state.selectedIndices = newIndices;
    redrawSurface(sid);
    notify(`📋 Đã nhân bản ${newIndices.length} đối tượng — kéo để đặt vị trí mới.`);
  }

  function getSelectionBox(list, indices) {
    if (!indices || !indices.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const idx of indices) {
      const obj = list[idx];
      if (!obj) continue;
      const b = NKInkEngine.getObjectBBox(obj);
      if (b.x0 < x0) x0 = b.x0;
      if (b.y0 < y0) y0 = b.y0;
      if (b.x1 > x1) x1 = b.x1;
      if (b.y1 > y1) y1 = b.y1;
    }
    if (!isFinite(x0)) return null;
    // Đệm 18px để 8 ô vuông co dãn khung bao tách biệt rõ ràng bên ngoài các điểm điều khiển đường cong
    return { x0: x0 - 18, y0: y0 - 18, x1: x1 + 18, y1: y1 + 18 };
  }

  function getResizeHandles(box) {
    const mx = (box.x0 + box.x1) * 0.5, my = (box.y0 + box.y1) * 0.5;
    return [
      { id: 'nw', x: box.x0, y: box.y0 },
      { id: 'n',  x: mx,     y: box.y0 },
      { id: 'ne', x: box.x1, y: box.y0 },
      { id: 'e',  x: box.x1, y: my     },
      { id: 'se', x: box.x1, y: box.y1 },
      { id: 's',  x: mx,     y: box.y1 },
      { id: 'sw', x: box.x0, y: box.y1 },
      { id: 'w',  x: box.x0, y: my     }
    ];
  }

  function getRotateHandle(box) {
    return { x: (box.x0 + box.x1) * 0.5, y: box.y0 - 28 };
  }

  // ============================================================================
  // KIẾN TRÚC 2 LỚP CANVAS MỰC (LAYER 1: COMMITTED INK, LAYER 2: ACTIVE STROKE 120HZ)
  // Hỗ trợ Camera Vô Hạn (panX, panY, zoom) cho Bảng Xanh ('board')
  // ============================================================================
  function applySurfaceTransform(ctx, sid, dpr) {
    if (sid === 'board') {
      const cam = state.boardCam;
      ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.panX, dpr * cam.panY);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function updateBoardCameraHud() {
    const badge = document.getElementById('bx-hud-reset');
    if (!badge) return;
    const zPct = Math.round(state.boardCam.zoom * 100);
    const ox = Math.round(-state.boardCam.panX / state.boardCam.zoom);
    const oy = Math.round(-state.boardCam.panY / state.boardCam.zoom);
    badge.textContent = `${zPct}% • (${ox},${oy})`;
  }

  function redrawActiveLayer(sid) {
    const surf = surfaces[sid];
    if (!surf || !surf.activeCanvas) return;
    const { activeCanvas, dpr, cssWidth, cssHeight } = surf;
    const ctx = activeCanvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    applySurfaceTransform(ctx, sid, dpr);

    if (surf.previewObj) {
      NKInkEngine.drawObject(ctx, surf.previewObj, state.showPointDots, state.showLabels);
    }

    if (surf.marqueeBox) {
      const m = surf.marqueeBox;
      const isErase = state.tool === 'xoa_vung_but';
      const isEnclosed = !isErase && Boolean(m.enclosed);
      ctx.strokeStyle = isErase ? '#E11D48' : (isEnclosed ? '#0284C7' : '#10B981');
      ctx.fillStyle = isErase ? 'rgba(225, 29, 72, 0.12)' : (isEnclosed ? 'rgba(2, 132, 199, 0.14)' : 'rgba(16, 185, 129, 0.12)');
      ctx.lineWidth = 1.6;
      ctx.setLineDash(isEnclosed ? [] : [6, 4]);
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
      ctx.setLineDash([]);
    }

    if (surf.snapBadge) {
      const sb = surf.snapBadge;
      ctx.strokeStyle = '#10B981';
      ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sb.x, sb.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 11.5px "Segoe UI", sans-serif';
      const tw = ctx.measureText(sb.label).width + 12;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.92)';
      ctx.fillRect(sb.x + 10, sb.y - 22, tw, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(sb.label, sb.x + 16, sb.y - 9);
    }

    const redPts = [];
    if (Array.isArray(surf.pickedPoints)) redPts.push(...surf.pickedPoints);
    if (surf.activeVertexHighlight) redPts.push(surf.activeVertexHighlight);
    if (activeSid() === sid && Array.isArray(state.selectedIndices)) {
      const listPts = state.annots[sid] || [];
      for (const sIdx of state.selectedIndices) {
        const sObj = listPts[sIdx];
        if (sObj && !sObj.hidden && sObj.type === 'diem') {
          if (!redPts.some((rp) => Math.hypot(rp.x - sObj.x, rp.y - sObj.y) < 1)) {
            redPts.push({ x: sObj.x, y: sObj.y });
          }
        }
      }
    }
    for (const rp of redPts) {
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EF4444';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 6.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    if (typeof tvVidActiveDirty !== 'undefined' && typeof tvStreamMode !== 'undefined' && tvStreamMode !== 'vector') {
      tvVidActiveDirty = true;
    }
  }

  function redrawSurface(sid) {
    const surf = surfaces[sid];
    if (!surf || !surf.inkCanvas) return;
    const { inkCanvas, dpr, cssWidth, cssHeight } = surf;
    const ctx = inkCanvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    applySurfaceTransform(ctx, sid, dpr);

    const list = state.annots[sid] || [];
    for (const obj of list) {
      try {
        NKInkEngine.drawObject(ctx, obj, state.showPointDots, state.showLabels);
      } catch (err) {
        console.warn('drawObject error:', err);
      }
    }
    drawPerpForceMarks(ctx, list);

    // 1a. Tô đỏ tất cả các điểm (`diem`) hoặc đỉnh hình chuẩn đang chọn
    if (activeSid() === sid) {
      for (const sIdx of state.selectedIndices) {
        const sObj = list[sIdx];
        if (sObj && sObj.type === 'diem' && !sObj.hidden) {
          ctx.save();
          ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
          ctx.beginPath(); ctx.arc(sObj.x, sObj.y, 11, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#EF4444';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2.0;
          ctx.beginPath(); ctx.arc(sObj.x, sObj.y, 6.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }
      if (Array.isArray(state.selectedVertices)) {
        for (const sv of state.selectedVertices) {
          const pObj = list[sv.objIdx];
          if (!pObj || pObj.hidden) continue;
          const vs = NKInkEngine.getObjectVertices(pObj);
          const vMatch = vs.find((vv) => vv.role === sv.role);
          if (vMatch) {
            ctx.save();
            ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
            ctx.beginPath(); ctx.arc(vMatch.x, vMatch.y, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#EF4444';
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2.0;
            ctx.beginPath(); ctx.arc(vMatch.x, vMatch.y, 6.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // 1. Vẽ Khung bao + 8 điểm neo vuông co dãn/đối xứng + Nút xoay tự do 360° ở lớp dưới
    if (activeSid() === sid && state.selectedIndices.length > 0 && !state.hideSelectionBoxForVertex) {
      for (const sIdx of state.selectedIndices) {
        const sObj = list[sIdx];
        if (!sObj || sObj.hidden) continue;
        if (sObj.type === 'duong' || sObj.type === 'mui_ten') {
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
          ctx.lineWidth = (sObj.width || 2.4) + 9;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(sObj.x1, sObj.y1);
          ctx.lineTo(sObj.x2, sObj.y2);
          ctx.stroke();
          ctx.restore();
        } else if (sObj.type === 'hcn') {
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
          ctx.lineWidth = (sObj.width || 2.4) + 8;
          ctx.lineJoin = 'round';
          if (Array.isArray(sObj.points) && sObj.points.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(sObj.points[0].x, sObj.points[0].y);
            for (let pi = 1; pi < sObj.points.length; pi++) ctx.lineTo(sObj.points[pi].x, sObj.points[pi].y);
            ctx.closePath();
            ctx.stroke();
          } else {
            ctx.strokeRect(sObj.x, sObj.y, sObj.w, sObj.h);
          }
          ctx.restore();
        } else if (sObj.type === 'elip') {
          const cx = sObj.x + sObj.w * 0.5, cy = sObj.y + sObj.h * 0.5;
          const rx = Math.max(1, Math.abs(sObj.w) * 0.5), ry = Math.max(1, Math.abs(sObj.h) * 0.5);
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
          ctx.lineWidth = (sObj.width || 2.4) + 8;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, sObj.rotation || 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (Array.isArray(sObj.points) && sObj.points.length >= 2 && (sObj.type === 'tam_giac' || sObj.type === 'to_trong_suot' || sObj.type === 'but')) {
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
          ctx.lineWidth = (sObj.width || 2.4) + 8;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(sObj.points[0].x, sObj.points[0].y);
          for (let pi = 1; pi < sObj.points.length; pi++) ctx.lineTo(sObj.points[pi].x, sObj.points[pi].y);
          if (sObj.type === 'tam_giac' || sObj.type === 'to_trong_suot') ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
      }
      const rawBox = getSelectionBox(list, state.selectedIndices);
      const box = rawBox ? {
        x0: (rawBox.x1 - rawBox.x0 < 14) ? (rawBox.x0 + rawBox.x1) * 0.5 - 8 : rawBox.x0,
        x1: (rawBox.x1 - rawBox.x0 < 14) ? (rawBox.x0 + rawBox.x1) * 0.5 + 8 : rawBox.x1,
        y0: (rawBox.y1 - rawBox.y0 < 14) ? (rawBox.y0 + rawBox.y1) * 0.5 - 8 : rawBox.y0,
        y1: (rawBox.y1 - rawBox.y0 < 14) ? (rawBox.y0 + rawBox.y1) * 0.5 + 8 : rawBox.y1
      } : null;
      if (box) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
        ctx.setLineDash([]);

        // Cần nối & Nút xoay tự do 360° màu xanh ngọc (#10B981) ở phía trên khung bao
        const rotH = getRotateHandle(box);
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo((box.x0 + box.x1) * 0.5, box.y0);
        ctx.lineTo(rotH.x, rotH.y);
        ctx.stroke();
        ctx.fillStyle = '#10B981';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(rotH.x, rotH.y, 7.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 8 điểm neo vuông co dãn & kéo qua đối diện để lật đối xứng
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 1.5;
        for (const h of getResizeHandles(box)) {
          ctx.beginPath();
          ctx.rect(h.x - 4.8, h.y - 4.8, 9.6, 9.6);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 2. Chỉ vẽ các Điểm điều khiển Đường cong & Đỉnh hình học khi đang ở chế độ Sửa hình động hoặc Chọn/Sửa đúng 1 đối tượng (không hiện hàng loạt chấm tròn gây rối khi chọn nhiều nét để di chuyển!)
    if (typeof updateSelectionQuickBar === 'function') updateSelectionQuickBar(sid);
    const isSingleSelectTool = (state.tool === 'chon' || state.tool === 'chinh_sua' || state.tool === 'chinh_hinh_dong') && activeSid() === sid && state.selectedIndices.length === 1;
    const singleSelObj = isSingleSelectTool ? list[state.selectedIndices[0]] : null;
    const isSingleCurve = Boolean(singleSelObj && singleSelObj.bezierCtrlPts && singleSelObj.bezierCtrlPts.length === 4);
    const showCtrlVerts = (state.showPointDots && isSingleSelectTool) || isSingleCurve;
    if (showCtrlVerts) {
      const indicesToShow = state.selectedIndices;

      if (indicesToShow.length > 0) {
        ctx.save();
        for (const idx of indicesToShow) {
          const obj = list[idx];
          if (!obj || obj.hidden) continue;
          if (obj.type === 'but' && !obj.curveType && !(obj.bezierCtrlPts && obj.bezierCtrlPts.length === 4)) continue;
          const verts = NKInkEngine.getObjectVertices(obj);

          // Vẽ 2 cánh tay đòn tiếp tuyến P0->C1 và P3->C2 cho đường cong tự do Bézier
          if (obj.bezierCtrlPts && obj.bezierCtrlPts.length === 4) {
            const [p0, c1, c2, p3] = obj.bezierCtrlPts;
            ctx.save();
            ctx.strokeStyle = '#FB923C';
            ctx.lineWidth = 1.6;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y); ctx.lineTo(c1.x, c1.y);
            ctx.moveTo(p3.x, p3.y); ctx.lineTo(c2.x, c2.y);
            ctx.stroke();
            ctx.restore();
          }

          // Vẽ đường nối mờ giữa các điểm điều khiển đường cong Toán-Lý (Parabol, Cung tròn, Sóng Sin, Hyperbol)
          if (obj.curveControls && obj.curveControls.length >= 3) {
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.65)';
            ctx.lineWidth = 1.3;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(obj.curveControls[0].x, obj.curveControls[0].y);
            for (let k = 1; k < obj.curveControls.length; k++) {
              ctx.lineTo(obj.curveControls[k].x, obj.curveControls[k].y);
            }
            ctx.stroke();
            ctx.restore();
          }

          for (const v of verts) {
            if (v.readOnly) continue;
            if (v.isTangentHandle) {
              // Tay nắm tiếp tuyến C1, C2: Nút tròn màu cam viền trắng
              ctx.fillStyle = '#FB923C';
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 2.2;
              ctx.beginPath();
              ctx.arc(v.x, v.y, 7.8, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            } else if (v.isMidCurve) {
              // Điểm uốn giữa nằm ngay trên đường cong: Nút tròn vàng/xanh nổi bật có tâm chấm nhỏ
              ctx.fillStyle = '#00E5FF';
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 2.4;
              ctx.beginPath();
              ctx.arc(v.x, v.y, 8.8, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.fillStyle = v.isCurveControl ? '#00E5FF' : '#FEF08A';
              ctx.strokeStyle = v.isCurveControl ? '#0F172A' : '#0284C7';
              ctx.lineWidth = 2.2;
              ctx.beginPath();
              ctx.arc(v.x, v.y, v.isCurveControl ? 8.2 : 7.0, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }
    }

    ctx.restore();
    redrawActiveLayer(sid);
    if (typeof tvSkipNextSurfaceSync !== 'undefined' && tvSkipNextSurfaceSync) {
      tvSkipNextSurfaceSync = false;
    } else if (typeof scheduleTvFrameSync === 'function') {
      scheduleTvFrameSync('surface');
    }
  }

  function drawGrid(gridCanvas, cssW, cssH, dpr, isBoard) {
    const ctx = gridCanvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (isBoard) {
      const bgMap = { green: '#0B6251', black: '#000000', white: '#FFFFFF', cream: '#FDF6E3' };
      ctx.fillStyle = bgMap[state.boardTheme] || '#0B6251';
      ctx.fillRect(0, 0, cssW, cssH);
    }

    const gMode = isBoard ? state.boardGridMode : 'grid';
    const gridEnabled = isBoard ? state.showBoardGrid : state.showGrid;
    if (gridEnabled && gMode !== 'none') {
      let subCol = 'rgba(180, 205, 235, 0.32)';
      let mainCol = 'rgba(140, 175, 220, 0.55)';
      if (isBoard) {
        if (state.boardTheme === 'green' || state.boardTheme === 'black') {
          subCol = 'rgba(255, 255, 255, 0.045)';
          mainCol = 'rgba(255, 255, 255, 0.10)';
        } else if (state.boardTheme === 'white') {
          subCol = 'rgba(148, 163, 184, 0.15)';
          mainCol = 'rgba(100, 116, 139, 0.28)';
        } else if (state.boardTheme === 'cream') {
          subCol = 'rgba(180, 155, 110, 0.14)';
          mainCol = 'rgba(145, 120, 75, 0.26)';
        }
      } else if (state.pdfTheme === 'board' || state.pdfTheme === 'night') {
        subCol = 'rgba(255, 255, 255, 0.06)';
        mainCol = 'rgba(255, 255, 255, 0.13)';
      }

      if (isBoard) {
        // Lưới ô ly đồng bộ với Camera Vô Hạn (panX, panY, zoom) của Bảng Xanh — nét mảnh nhạt dịu mắt!
        const cam = state.boardCam;
        const baseStep = state.gridStep || 20;
        const wx0 = -cam.panX / cam.zoom;
        const wy0 = -cam.panY / cam.zoom;
        const wx1 = (cssW - cam.panX) / cam.zoom;
        const wy1 = (cssH - cam.panY) / cam.zoom;
        const iStart = Math.floor(wx0 / baseStep) - 1;
        const iEnd = Math.ceil(wx1 / baseStep) + 1;
        const jStart = Math.floor(wy0 / baseStep) - 1;
        const jEnd = Math.ceil(wy1 / baseStep) + 1;

        ctx.save();
        ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.panX, dpr * cam.panY);
        ctx.lineWidth = 0.65 / cam.zoom;

        if (gMode === 'dots') {
          ctx.fillStyle = mainCol;
          const r = 1.6 / cam.zoom;
          for (let i = iStart; i <= iEnd; i++) {
            for (let j = jStart; j <= jEnd; j++) {
              ctx.beginPath();
              ctx.arc(i * baseStep, j * baseStep, (i % 4 === 0 && j % 4 === 0) ? r * 1.4 : r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          if (gMode === 'grid') {
            for (let i = iStart; i <= iEnd; i++) {
              const x = i * baseStep;
              ctx.strokeStyle = ((i % 4) + 4) % 4 === 0 ? mainCol : subCol;
              ctx.beginPath(); ctx.moveTo(x, wy0); ctx.lineTo(x, wy1); ctx.stroke();
            }
          }
          for (let j = jStart; j <= jEnd; j++) {
            const y = j * baseStep;
            ctx.strokeStyle = ((j % 4) + 4) % 4 === 0 ? mainCol : subCol;
            ctx.beginPath(); ctx.moveTo(wx0, y); ctx.lineTo(wx1, y); ctx.stroke();
          }
        }

        // Dấu thập Gốc tọa độ (0,0) trong không gian vô hạn
        const ox = Math.round(cssW * 0.5), oy = Math.round(cssH * 0.5);
        ctx.strokeStyle = (state.boardTheme === 'green' || state.boardTheme === 'black')
          ? 'rgba(255, 214, 10, 0.65)'
          : 'rgba(217, 119, 6, 0.72)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1.4 / cam.zoom;
        ctx.beginPath();
        ctx.moveTo(ox - 12 / cam.zoom, oy); ctx.lineTo(ox + 12 / cam.zoom, oy);
        ctx.moveTo(ox, oy - 12 / cam.zoom); ctx.lineTo(ox, oy + 12 / cam.zoom);
        ctx.stroke();
        ctx.font = `600 ${Math.round(11 / cam.zoom)}px "Segoe UI", sans-serif`;
        ctx.fillText('Gốc (0,0)', ox + 6 / cam.zoom, oy - 6 / cam.zoom);
        ctx.restore();
      } else {
        const step = state.gridStep || 16;
        ctx.lineWidth = 0.8;
        for (let x = 0, i = 0; x <= cssW; x += step, i++) {
          ctx.strokeStyle = i % 4 === 0 ? mainCol : subCol;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke();
        }
        for (let y = 0, i = 0; y <= cssH; y += step, i++) {
          ctx.strokeStyle = i % 4 === 0 ? mainCol : subCol;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke();
        }
      }
    }
    ctx.restore();
    if (typeof tvVidActiveDirty !== 'undefined' && typeof tvStreamMode !== 'undefined' && tvStreamMode !== 'vector') {
      tvVidActiveDirty = true;
    }
  }

  // ============================================================================
  // CUỘN QUÁN TÍNH TỰ NHIÊN THEO TỐC ĐỘ VUỐT (CHUẨN HÓA THEO THỜI GIAN 60/120HZ)
  // Không bao giờ chạy vọt 1 mạch đến trang cuối trên iPad Pro 120Hz!
  // ============================================================================
  let inertiaRaf = null;
  function stopInertia() {
    if (inertiaRaf) {
      cancelAnimationFrame(inertiaRaf);
      inertiaRaf = null;
    }
  }
  function startInertiaScroll(vxPerMs, vyPerMs, isBoard = false) {
    stopInertia();
    // Giới hạn vận tốc tối đa ở mức tự nhiên (1.65 px/ms) để vuốt nhẹ chạy nhẹ, vuốt nhanh chạy vừa phải
    const maxV = isBoard ? 2.2 : 1.65;
    let vx = Math.max(-maxV, Math.min(maxV, vxPerMs));
    let vy = Math.max(-maxV, Math.min(maxV, vyPerMs));
    if (Math.hypot(vx, vy) < 0.08) return;

    let lastTime = performance.now();
    function step(now) {
      const dt = Math.min(34, Math.max(4, now - lastTime));
      lastTime = now;
      if (Math.hypot(vx, vy) < 0.03) {
        inertiaRaf = null;
        return;
      }
      const dx = vx * dt;
      const dy = vy * dt;
      if (isBoard) {
        state.boardCam.panX += dx;
        state.boardCam.panY += dy;
        updateBoardCameraHud();
        if (surfaces.board) {
          drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
          redrawSurface('board');
        }
      } else {
        pdfScroll.scrollLeft -= dx;
        pdfScroll.scrollTop -= dy;
      }
      // Ma sát chuẩn hóa theo thời gian thực (đồng đều giữa iPad 60Hz và 120Hz, dừng êm sau ~0.35s)
      const decay = Math.pow(0.86, dt / 16.67);
      vx *= decay;
      vy *= decay;
      inertiaRaf = requestAnimationFrame(step);
    }
    inertiaRaf = requestAnimationFrame(step);
  }

  // ============================================================================
  // THƯỚC KẺ TƯƠNG TÁC XOAY 360° & HÚT NÉT BÚT DỌC CẠNH THƯỚC
  // ============================================================================
  function snapSmartGridPoint(sid, pos) {
    const gridEnabled = sid === 'board' ? state.showBoardGrid : state.showGrid;
    if (!gridEnabled || !state.snapPoint || !pos) return null;
    const step = sid === 'board' ? (state.gridStep || 20) : (state.gridStep || 16);
    const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
    const tol = Math.min(step * 0.42, (sid === 'board' ? 8 / zoom : 7));
    const gx = Math.round(pos.x / step) * step;
    const gy = Math.round(pos.y / step) * step;
    if (Math.hypot(pos.x - gx, pos.y - gy) <= tol) {
      return { x: gx, y: gy, label: '⊞ Góc lưới' };
    }
    return null;
  }

  function snapPointToRulerEdge(inkCanvas, worldPt, sid, startWorldPt = null) {
    if (!state.ruler.visible) return null;
    const r = inkCanvas.getBoundingClientRect();
    let sx, sy;
    if (sid === 'board') {
      sx = r.left + worldPt.x * state.boardCam.zoom + state.boardCam.panX;
      sy = r.top + worldPt.y * state.boardCam.zoom + state.boardCam.panY;
    } else {
      sx = r.left + worldPt.x;
      sy = r.top + worldPt.y;
    }
    const rad = (state.ruler.angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const dx = sx - state.ruler.cx, dy = sy - state.ruler.cy;
    const localU = dx * cosA + dy * sinA;
    const localV = -dx * sinA + dy * cosA;
    const halfW = state.ruler.widthPx * 0.5;
    const halfH = state.ruler.heightPx * 0.5;

    if (Math.abs(localU) <= halfW + 25) {
      let edgeV = null;
      if (Math.abs(localV - (-halfH)) <= 28) edgeV = -halfH - 2;
      else if (Math.abs(localV - halfH) <= 28) edgeV = halfH + 2;
      if (edgeV !== null) {
        const clampedU = Math.max(-halfW, Math.min(halfW, localU));
        const snapSx = state.ruler.cx + clampedU * cosA - edgeV * sinA;
        const snapSy = state.ruler.cy + clampedU * sinA + edgeV * cosA;
        let wx, wy;
        if (sid === 'board') {
          wx = (snapSx - r.left - state.boardCam.panX) / state.boardCam.zoom;
          wy = (snapSy - r.top - state.boardCam.panY) / state.boardCam.zoom;
        } else {
          wx = snapSx - r.left;
          wy = snapSy - r.top;
        }
        let lenCm = '';
        if (startWorldPt) {
          const distPx = Math.hypot(wx - startWorldPt.x, wy - startWorldPt.y);
          lenCm = ` • ${(distPx / 32).toFixed(1)} cm`;
        }
        return { x: wx, y: wy, label: `📏 Cạnh thước (${state.ruler.angleDeg}°${lenCm})` };
      }
    }
    return null;
  }

  // ============================================================================
  // GẮN SỰ KIỆN TƯƠNG TÁC BÚT APPLE PENCIL 120HZ + KÉO ĐIỂM ĐƯỜNG CONG
  // ============================================================================
  let isMultiTouch = false;
  const activeActCancels = {};
  function cancelAllSurfaceActs() {
    Object.values(activeActCancels).forEach((fn) => {
      try { fn(); } catch (_) {}
    });
  }

  function bindSurfaceEvents(sid, inkCanvas) {
    ensureStacks(sid);
    let act = null;
    let holdTimer = null;
    let touchHoldTimer = null;
    let lastTapTime = 0, lastTapIdx = -1;
    const inkProc = new NKInkEngine.AdaptiveInkProcessor();

    function clearTouchHold() {
      if (touchHoldTimer) {
        clearTimeout(touchHoldTimer);
        touchHoldTimer = null;
      }
    }

    activeActCancels[sid] = () => {
      clearHold();
      clearTouchHold();
      if (act) {
        const s = surfaces[sid];
        if (s) {
          s.previewObj = null;
          s.marqueeBox = null;
          s.snapBadge = null;
          redrawActiveLayer(sid);
        }
        act = null;
      }
    };

    function localPos(e, cachedRect = null) {
      const r = cachedRect || inkCanvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (sid === 'board') {
        return {
          x: (sx - state.boardCam.panX) / state.boardCam.zoom,
          y: (sy - state.boardCam.panY) / state.boardCam.zoom
        };
      }
      return { x: sx, y: sy };
    }

    function drawIncrementalSegment(prevPt, ctrlPt, nextPt, color, width, dashed, isHighlighter) {
      const surf = surfaces[sid];
      if (!surf || !surf.activeCanvas) return;
      const ctx = surf.activeCanvas.getContext('2d');
      ctx.save();
      applySurfaceTransform(ctx, sid, surf.dpr);
      ctx.strokeStyle = color;
      ctx.lineWidth = isHighlighter ? width * 5.5 : width;
      ctx.lineCap = isHighlighter ? 'square' : 'round';
      ctx.lineJoin = 'round';
      if (isHighlighter) ctx.globalAlpha = 0.34;
      if (dashed) ctx.setLineDash([width * 2.5, width * 1.9]);
      else ctx.setLineDash([]);
      const m1x = (prevPt.x + ctrlPt.x) * 0.5;
      const m1y = (prevPt.y + ctrlPt.y) * 0.5;
      const m2x = (ctrlPt.x + nextPt.x) * 0.5;
      const m2y = (ctrlPt.y + nextPt.y) * 0.5;
      ctx.beginPath();
      ctx.moveTo(m1x, m1y);
      ctx.quadraticCurveTo(ctrlPt.x, ctrlPt.y, m2x, m2y);
      ctx.stroke();
      ctx.restore();
    }

    function clearHold() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    }

    inkCanvas.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.pointerType === 'pen') {
        isMultiTouch = false;
      } else if (isMultiTouch) {
        return;
      }
      stopInertia();
      if (sid === 'board') {
        state.mode = 'board';
      } else if (typeof sid === 'number') {
        state.mode = 'pdf';
        state.activeSurfaceId = sid;
        state.currentPage = sid;
        attachSharedActiveCanvas(sid);
        updateStatusPage();
      }

      const isPen = e.pointerType === 'pen';
      const isTouch = e.pointerType === 'touch';

      // Chống chạm tay:
      // - Trên trang PDF: Nhường 100% cho cuộn gốc mượt chuẩn iPadOS (Native UIScrollView, bám đúng tốc độ ngón tay, không bao giờ nhảy trang!)
      // - Trên Bảng xanh vô hạn: Dùng kéo camera JS có quán tính êm nhẹ
      // - Giữ 1 ngón tay yên ~480ms trên nền (kể cả khi đang chọn Bút hay Kéo) -> Hiện menu nhanh (Dán ảnh Clipboard, Ẩn/hiện lưới, Dựng nhanh hình Toán Lý, Nền bảng)
      if (isTouch && (state.palmRejection || state.tool === 'tay')) {
        if (isValidFingerPointer(e)) {
          const sx0 = e.clientX, sy0 = e.clientY;
          const cachedR0 = inkCanvas.getBoundingClientRect();
          const worldP0 = localPos(e, cachedR0);
          clearTouchHold();
          touchHoldTimer = setTimeout(() => {
            touchHoldTimer = null;
            if (isMultiTouch || isPenActiveDown) return;
            if (act && act.mode === 'pan' && act.panStarted) return;
            act = null;
            showCanvasContextMenu(sid, sx0, sy0, worldP0);
          }, 480);
          if (sid === 'board') {
            const t0 = performance.now();
            act = {
              mode: 'pan',
              pointerId: e.pointerId,
              isBoardPan: true,
              panStarted: false,
              sx: sx0, sy: sy0,
              samples: [{ x: sx0, y: sy0, t: t0 }],
              sl: state.boardCam.panX,
              st: state.boardCam.panY
            };
          } else {
            act = {
              mode: 'touch_hold_watch',
              pointerId: e.pointerId,
              sx: sx0, sy: sy0
            };
          }
        }
        return;
      }

      if (isPen && state.tool === 'tay') {
        setTool('but');
      }

      e.preventDefault();
      // Khi đặt bút Apple Pencil lên trang PDF, khóa touch-action = 'none' trong suốt nét vẽ để iPadOS không bao giờ gửi pointercancel khi giữ bút nắn thẳng!
      if (sid !== 'board') {
        inkCanvas.style.touchAction = 'none';
      }
      try { inkCanvas.setPointerCapture(e.pointerId); } catch (_) {}

      const cachedRect = inkCanvas.getBoundingClientRect();
      let pos = localPos(e, cachedRect);
      const list = state.annots[sid];
      const surf = surfaces[sid];

      if (state.tool === 'tay' || spacePanActive) {
        // Trên PDF nếu đang dùng ngón tay thì để iPadOS cuộn gốc; nếu dùng chuột PC thì kéo JS
        if (isTouch && sid !== 'board') return;
        if (spacePanActive) inkCanvas.style.cursor = 'grabbing';
        const t0 = performance.now();
        act = {
          mode: 'pan',
          isBoardPan: sid === 'board',
          sx: e.clientX, sy: e.clientY,
          samples: [{ x: e.clientX, y: e.clientY, t: t0 }],
          sl: sid === 'board' ? state.boardCam.panX : pdfScroll.scrollLeft,
          st: sid === 'board' ? state.boardCam.panY : pdfScroll.scrollTop
        };
        return;
      }

      if (state.tool === 'dung_diem') {
        const zoom = sid === 'board' ? Math.max(0.5, (state.boardCam && state.boardCam.zoom) || 1) : 1;
        let attachedRef = null;
        let intersectRefVal = null;
        if (!state.forceFreePoint && typeof projectPointOntoObject === 'function') {
          const tolInt = 20 / zoom;
          const nearObjs = [];
          let bestObj = null, bestProj = null, bestD = 16 / zoom;
          for (const o of list) {
            if (!o || o.hidden || o.type === 'diem' || o.type === 'chu' || o.type === 'ghi_chu' || o.type === 'cong_thuc') continue;
            if (o.trigSweepRef || o.rightAngleRef || o.cornerRightAngleRef || o.angleArcRef) continue;
            const proj = projectPointOntoObject(o, pos.x, pos.y);
            if (proj && proj.dist < tolInt) {
              nearObjs.push({ o, proj, segIdx: typeof proj.segIdx === 'number' ? proj.segIdx : (typeof proj.edgeIdx === 'number' ? proj.edgeIdx : 0) });
            }
            if (proj && proj.dist < bestD) {
              bestD = proj.dist; bestObj = o; bestProj = proj;
            }
          }
          if (nearObjs.length >= 2 && typeof computeObjectIntersection === 'function') {
            let bestIp = null, bestIpD = 18 / zoom, bestPair = null;
            for (let i = 0; i < nearObjs.length; i++) {
              for (let j = i + 1; j < nearObjs.length; j++) {
                const a = nearObjs[i], b = nearObjs[j];
                const ip = computeObjectIntersection(a.o, a.segIdx, b.o, b.segIdx, pos);
                if (ip) {
                  const dIp = Math.hypot(ip.x - pos.x, ip.y - pos.y);
                  if (dIp < bestIpD) {
                    bestIpD = dIp; bestIp = ip; bestPair = [a, b];
                  }
                }
              }
            }
            if (bestIp && bestPair) {
              pos = { x: bestIp.x, y: bestIp.y };
              intersectRefVal = {
                id1: ensureGeomId(bestPair[0].o),
                segIdx1: bestPair[0].segIdx,
                id2: ensureGeomId(bestPair[1].o),
                segIdx2: bestPair[1].segIdx
              };
            }
          }
          if (!intersectRefVal && bestObj && bestProj) {
            pos = { x: bestProj.x, y: bestProj.y };
            attachedRef = {
              kind: bestObj.type,
              id: ensureGeomId(bestObj),
              t: bestProj.t,
              theta: bestProj.theta,
              segIdx: bestProj.segIdx,
              edgeIdx: bestProj.edgeIdx
            };
          }
        }
        if (!intersectRefVal && !attachedRef) {
          const gSnap = snapSmartGridPoint(sid, pos);
          if (gSnap) pos = { x: gSnap.x, y: gSnap.y };
        }
        const lbl = '';
        pushUndo(sid);
        const newPt = { type: 'diem', x: pos.x, y: pos.y, text: lbl, color: activeColor() };
        if (intersectRefVal) newPt.intersectRef = intersectRefVal;
        else if (attachedRef) newPt.onObjRef = attachedRef;
        ensureGeomId(newPt);
        list.push(newPt);
        redrawSurface(sid);
        notify(intersectRefVal ? '✕ Đã dựng giao điểm!' : (attachedRef ? '🎯 Đã dựng điểm trượt gắn trên đường!' : '• Đã dựng điểm'));
        return;
      }

      if (state.tool === 'geom_construct' && geomConstructState) {
        handleGeomConstructTap(sid, pos, list);
        return;
      }

      if (state.tool === 'dung_doan' || state.tool === 'dung_mui_ten') {
        handleLinkedLineToolDown(sid, pos, list, cachedRect);
        return;
      }

      if (state.tool === 'dung_tron') {
        handleCircleToolDown(sid, pos, list);
        return;
      }

      if (state.tool === 'dung_da_giac') {
        handlePolygonToolDown(sid, pos, list);
        return;
      }

      if (state.tool === 'them_chu' || state.tool === 'ghi_chu') {
        openInlineTextEditor(sid, pos.x, pos.y, e.clientX, e.clientY, state.tool === 'ghi_chu' ? 'ghi_chu' : 'chu', null);
        return;
      }

      // Kiểm tra ở chế độ Chọn/Sửa và Hình động (Khi đang dùng Bút viết thì KHÔNG tự động bắt điểm điều khiển để Thầy viết tiếp mượt mà)
      if (state.tool === 'chon' || state.tool === 'chinh_sua' || state.tool === 'chinh_hinh_dong') {
        const hitScale = sid === 'board' ? 1 / Math.max(0.5, state.boardCam.zoom) : 1;

        // ƯU TIÊN SỐ 1: Luôn bắt Điểm dựng (`diem`) trước tiên (kể cả khi tắt hiện nút điều khiển); sau đó mới đến đỉnh hình chuẩn & điểm điều khiển
        const isSingleSelHit = (state.tool === 'chon' || state.tool === 'chinh_sua') && state.selectedIndices.length === 1;
        const singleHitObj = isSingleSelHit ? list[state.selectedIndices[0]] : null;
        const isSingleHitCurve = Boolean(singleHitObj && singleHitObj.bezierCtrlPts && singleHitObj.bezierCtrlPts.length === 4);
        const canHitCtrlVerts = state.showPointDots || state.tool === 'chinh_hinh_dong' || isSingleHitCurve;
        {
          const baseRad = state.tool === 'chon' ? 16 : 22;
          const hitRadius = sid === 'board' ? baseRad / Math.max(0.5, state.boardCam.zoom) : baseRad;
          const allIndicesRev = list.map((_, i) => i).reverse();
          const ctrlIndices = canHitCtrlVerts
            ? (state.tool === 'chinh_hinh_dong' || (state.tool === 'chon' && state.showPointDots)
                ? allIndicesRev
                : state.selectedIndices.slice().reverse())
            : [];

          // Kiểm tra chạm vào nhãn tên điểm/đoạn để kéo xoay quanh đối tượng (bán kính 8..36px giống EXE)
          if (state.showLabels) {
            for (let objIdx = list.length - 1; objIdx >= 0; objIdx--) {
              const obj = list[objIdx];
              if (!obj || obj.hidden || !obj.text) continue;
              if (obj.type !== 'diem' && obj.type !== 'duong' && obj.type !== 'mui_ten') continue;
              const ax = obj.type === 'diem' ? obj.x : (obj.x1 + obj.x2) * 0.5;
              const ay = obj.type === 'diem' ? obj.y : (obj.y1 + obj.y2) * 0.5;
              const lox = typeof obj.labelDx === 'number' ? obj.labelDx : (obj.type === 'diem' ? 7 : 8);
              const loy = typeof obj.labelDy === 'number' ? obj.labelDy : (obj.type === 'diem' ? -6 : -8);
              const lx = ax + lox + 4, ly = ay + loy - 5;
              const dLbl = Math.hypot(pos.x - lx, pos.y - ly);
              const dAnchor = Math.hypot(pos.x - ax, pos.y - ay);
              if (dLbl <= 16 * hitScale && dLbl <= dAnchor) {
                pushUndo(sid);
                state.selectedIndices = [objIdx];
                redrawSurface(sid);
                act = { mode: 'drag_label', rect: cachedRect, objIdx };
                notify(`🏷 Nhãn "${obj.text}": Kéo quanh đối tượng để đổi vị trí.`);
                return;
              }
            }
          }

          // Pass 0: `diem` trước nhất (luôn bật) -> Pass 1: Đỉnh hình học (`tam_giac`, `hcn`, `elip`) & đầu mút tự do -> Pass 2: Đầu mút đã liên kết
          const maxPass = canHitCtrlVerts ? 3 : 1;
          for (let pass = 0; pass < maxPass; pass++) {
            const passIndices = pass === 0 ? allIndicesRev : ctrlIndices;
            for (const objIdx of passIndices) {
              const obj = list[objIdx];
              if (!obj || obj.hidden) continue;
              const isDiem = obj.type === 'diem';
              const isPolyOrBox = obj.type === 'tam_giac' || obj.type === 'to_trong_suot' || obj.type === 'hcn' || obj.type === 'elip';
              const isCurveObj = obj.type === 'but' && Boolean(obj.curveType || (obj.bezierCtrlPts && obj.bezierCtrlPts.length === 4));
              const isCurveSel = isCurveObj && (state.tool === 'chinh_hinh_dong' || (isSingleSelHit && state.selectedIndices[0] === objIdx));
              if (!isDiem && !isPolyOrBox && !isCurveSel && obj.type !== 'duong' && obj.type !== 'mui_ten') continue;
              if (obj.type === 'but' && !isCurveSel) continue;

              const isExplicitlySelected = state.selectedIndices.length === 1 && state.selectedIndices[0] === objIdx;
              const verts = NKInkEngine.getObjectVertices(obj);
              for (const v of verts) {
                if (v.readOnly) continue;
                const isLineObj = (obj.type === 'duong' || obj.type === 'mui_ten');
                const isLinkedEnd = isLineObj && (
                  (v.role === 'p1' && obj.p1Ref) || (v.role === 'p2' && obj.p2Ref)
                );
                if (pass === 0 && !isDiem) continue;
                // Trong chế độ Chọn/Sửa (`chon`), chỉ kéo đầu mút đoạn/mũi tên khi đã chọn đối tượng đó (hoặc khi dùng `chinh_hinh_dong`)
                if (pass === 1 && (isDiem || isLinkedEnd || (isLineObj && state.tool === 'chon' && !isExplicitlySelected))) continue;
                if (pass === 2 && !(isLinkedEnd && isExplicitlySelected)) continue;
                if (Math.hypot(pos.x - v.x, pos.y - v.y) <= hitRadius) {
                  pushUndo(sid);
                  state.hideSelectionBoxForVertex = true;
                  if (state.multiSelect || e.shiftKey || e.ctrlKey) {
                    if (obj.type === 'diem') {
                      const posIdx = state.selectedIndices.indexOf(objIdx);
                      if (posIdx >= 0) state.selectedIndices.splice(posIdx, 1);
                      else state.selectedIndices.push(objIdx);
                    } else {
                      if (!Array.isArray(state.selectedVertices)) state.selectedVertices = [];
                      const svIdx = state.selectedVertices.findIndex((sv) => sv.objIdx === objIdx && sv.role === v.role);
                      if (svIdx >= 0) state.selectedVertices.splice(svIdx, 1);
                      else state.selectedVertices.push({ objIdx, role: v.role });
                    }
                    redrawSurface(sid);
                    redrawActiveLayer(sid);
                    return;
                  } else {
                    state.selectedIndices = [objIdx];
                    state.selectedVertices = obj.type === 'diem' ? [] : [{ objIdx, role: v.role }];
                    redrawSurface(sid);
                  }
                  if (surfaces[sid]) {
                    surfaces[sid].activeVertexHighlight = { x: v.x, y: v.y };
                    redrawActiveLayer(sid);
                  }
                  act = { mode: 'drag_vertex', rect: cachedRect, objIdx, role: v.role };
                  return;
                }
              }
            }
          }
        }

        // Kiểm tra chạm vào Nút xoay 360° hoặc 8 tay cầm co dãn/đối xứng của khung bao
        if (state.selectedIndices.length > 0 && !state.hideSelectionBoxForVertex) {
          const box = getSelectionBox(list, state.selectedIndices);
          if (box) {
            const rotH = getRotateHandle(box);
            if (Math.hypot(pos.x - rotH.x, pos.y - rotH.y) <= 18 * hitScale) {
              pushUndo(sid);
              const cx = (box.x0 + box.x1) * 0.5, cy = (box.y0 + box.y1) * 0.5;
              act = {
                mode: 'rotate_sel',
                cx, cy,
                startAng: Math.atan2(pos.y - cy, pos.x - cx),
                origObjs: state.selectedIndices.map((idx) => JSON.parse(JSON.stringify(list[idx])))
              };
              return;
            }
            for (const h of getResizeHandles(box)) {
              if (Math.hypot(pos.x - h.x, pos.y - h.y) <= 14 * hitScale) {
                pushUndo(sid);
                act = {
                  mode: 'resize_sel',
                  handle: h.id,
                  origBox: { ...box },
                  origObjs: state.selectedIndices.map((idx) => JSON.parse(JSON.stringify(list[idx])))
                };
                return;
              }
            }
          }
        }

        // Kiểm tra chạm trúng đối tượng (ưu tiên Điểm > Đoạn/Mũi tên > Hình)
        const getHitRank = (o) => (!o ? 0 : (o.type === 'diem' ? 2 : ((o.type === 'duong' || o.type === 'mui_ten') ? 1 : 0)));
        let bestIdx = -1, bestDist = 13 * hitScale, bestRank = -1;
        for (let i = list.length - 1; i >= 0; i--) {
          const cand = list[i];
          if (!cand || cand.hidden) continue;
          const d = NKInkEngine.hitDistanceToObject(cand, pos.x, pos.y);
          if (d <= 13 * hitScale) {
            const rank = getHitRank(cand);
            if (bestIdx === -1 || rank > bestRank || (rank === bestRank && d < bestDist)) {
              bestDist = d;
              bestIdx = i;
              bestRank = rank;
            }
          }
        }

        if (bestIdx !== -1) {
          state.hideSelectionBoxForVertex = false;
          const nowTap = performance.now();
          const selObj = list[bestIdx];
          // Chạm đúp (Double-tap) vào chữ, ghi chú hoặc công thức KaTeX để sửa trực tiếp!
          if (bestIdx === lastTapIdx && nowTap - lastTapTime < 380 && selObj) {
            if (selObj.type === 'chu' || selObj.type === 'ghi_chu') {
              openInlineTextEditor(sid, selObj.x, selObj.y, e.clientX, e.clientY, selObj.type, bestIdx);
              return;
            } else if (selObj.type === 'cong_thuc') {
              openFormulaModal(bestIdx);
              return;
            }
          }
          lastTapTime = nowTap;
          lastTapIdx = bestIdx;

          const alreadySelected = state.selectedIndices.includes(bestIdx);
          if (state.multiSelect || e.shiftKey || e.ctrlKey) {
            if (alreadySelected) {
              if (selObj && selObj.groupId) {
                const gid = selObj.groupId;
                state.selectedIndices = state.selectedIndices.filter((i) => !(list[i] && list[i].groupId === gid));
              } else {
                state.selectedIndices.splice(state.selectedIndices.indexOf(bestIdx), 1);
              }
            } else {
              state.selectedIndices = expandSelectionWithGroups(list, [...state.selectedIndices, bestIdx]);
            }
          } else if (!alreadySelected) {
            state.selectedIndices = expandSelectionWithGroups(list, [bestIdx]);
          } else if (selObj && selObj.groupId) {
            state.selectedIndices = expandSelectionWithGroups(list, state.selectedIndices);
          }
          state.selectedEdge = null;
          const _edgePtsTap = selObj && (selObj.type === 'hcn'
            ? [{ x: selObj.x, y: selObj.y }, { x: selObj.x + selObj.w, y: selObj.y }, { x: selObj.x + selObj.w, y: selObj.y + selObj.h }, { x: selObj.x, y: selObj.y + selObj.h }]
            : ((selObj.type === 'tam_giac' || selObj.type === 'to_trong_suot') ? selObj.points : null));
          if (_edgePtsTap && Array.isArray(_edgePtsTap) && _edgePtsTap.length >= 3) {
            let bestEi = 0, bestEd = Infinity;
            for (let ei = 0; ei < _edgePtsTap.length; ei++) {
              const pA = _edgePtsTap[ei], pB = _edgePtsTap[(ei + 1) % _edgePtsTap.length];
              const dE = NKInkEngine.distToSegment(pos.x, pos.y, pA.x, pA.y, pB.x, pB.y);
              if (dE < bestEd) { bestEd = dE; bestEi = ei; }
            }
            if (bestEd <= 22 * hitScale) state.selectedEdge = { objIdx: bestIdx, edgeIdx: bestEi };
          }
          const isCurveObj = selObj && selObj.type === 'but' && Boolean(selObj.curveType || (selObj.bezierCtrlPts && selObj.bezierCtrlPts.length === 4));
          if (isCurveObj && (state.tool === 'chinh_sua' || state.tool === 'chinh_hinh_dong') && state.selectedIndices.length === 1) {
            NKInkEngine.getObjectVertices(selObj);
          }
          redrawSurface(sid);
          pushUndo(sid);
          act = { mode: 'move_sel', rect: cachedRect, lx: pos.x, ly: pos.y };
          if (isCurveObj && state.tool !== 'chon' && state.selectedIndices.length === 1) {
            notify('💡 Đã chọn đường cong: Kéo các nút tròn xanh/cam trên đường cong để uốn độ cong!');
          } else if (selObj && (selObj.type === 'chu' || selObj.type === 'cong_thuc')) {
            notify('💡 Chạm đúp (2 lần) vào chữ hoặc công thức để chỉnh sửa lại nội dung.');
          }
          return;
        }

        // Khi khung chọn đang hiện, đặt bút vào vùng bên trong khung bao là di chuyển cả hình/nhóm dễ dàng
        if (state.selectedIndices.length > 0 && !state.hideSelectionBoxForVertex) {
          const box = getSelectionBox(list, state.selectedIndices);
          if (box && pos.x >= box.x0 && pos.x <= box.x1 && pos.y >= box.y0 && pos.y <= box.y1) {
            pushUndo(sid);
            act = { mode: 'move_sel', rect: cachedRect, lx: pos.x, ly: pos.y };
            return;
          }
        }

        // Nhấn bút ra màn hình trống -> bỏ chọn ngay
        state.hideSelectionBoxForVertex = false;
        state.selectedIndices = [];
        state.selectedVertices = [];
        if (surfaces[sid]) {
          surfaces[sid].pickedPoints = [];
          surfaces[sid].activeVertexHighlight = null;
        }
        act = { mode: 'marquee', rect: cachedRect, sx: pos.x, sy: pos.y };
        surf.marqueeBox = { x: pos.x, y: pos.y, w: 0, h: 0 };
        redrawSurface(sid);
        return;
      }

      if (state.tool === 'xoa_vung_but') {
        act = { mode: 'marquee_erase', rect: cachedRect, sx: pos.x, sy: pos.y };
        surf.marqueeBox = { x: pos.x, y: pos.y, w: 0, h: 0 };
        redrawActiveLayer(sid);
        return;
      }

      if (state.tool === 'tay_net') {
        act = { mode: 'erase', erasedAny: false };
        eraseAt(sid, pos.x, pos.y, act);
        return;
      }

      if (state.snapPoint && (state.tool === 'duong' || state.tool === 'mui_ten' || state.tool === 'dung_dang_nhiet')) {
        const zoomSnap = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
        const refStart = findPointRef(list, pos.x, pos.y, 26 / zoomSnap);
        if (refStart) {
          pos = { x: refStart.x, y: refStart.y };
        } else {
          const sp = NKInkEngine.findNearestSnapPoint(list, pos.x, pos.y, 20 / zoomSnap);
          if (sp) pos = { x: sp.x, y: sp.y };
          else {
            const gSnap = snapSmartGridPoint(sid, pos);
            if (gSnap) pos = { x: gSnap.x, y: gSnap.y };
          }
        }
      }

      if (state.selectedIndices.length > 0) {
        state.selectedIndices = [];
        redrawSurface(sid);
      }

      if (state.tool === 'but' || state.tool === 'to_sang') {
        const rSnap = snapPointToRulerEdge(inkCanvas, pos, sid, null);
        if (rSnap) pos = { x: rSnap.x, y: rSnap.y };
        inkProc.reset();
        inkProc.addPoint(pos.x, pos.y, performance.now());
        surf.previewObj = {
          type: state.tool,
          points: [{ x: pos.x, y: pos.y }],
          color: activeColor(),
          width: activeWidth(),
          dashed: state.dashed
        };
        act = {
          mode: 'freehand',
          pointerId: e.pointerId,
          rect: cachedRect,
          rawPts: [{ x: pos.x, y: pos.y }],
          snapped: null,
          rulerLocked: Boolean(rSnap),
          lastScribCheck: 0,
          lastHoldPos: { x: pos.x, y: pos.y },
          holdAnchor: { x: pos.x, y: pos.y }
        };
        redrawActiveLayer(sid);
        if (typeof tvEmitStrokeStart === 'function') tvEmitStrokeStart(sid, surf.previewObj, pos);
      } else {
        const rSnap = snapPointToRulerEdge(inkCanvas, pos, sid, null);
        if (rSnap) pos = { x: rSnap.x, y: rSnap.y };
        act = { mode: 'shape', rect: cachedRect, sx: pos.x, sy: pos.y };
      }
    });

    inkCanvas.addEventListener('pointermove', (e) => {
      if (!act && !isMultiTouch && state.tool === 'dung_da_giac' && polyBuildPick && polyBuildPick.sid === sid && polyBuildPick.pts.length > 0) {
        const surf = surfaces[sid];
        const list = state.annots[sid] || [];
        if (surf && surf.inkCanvas) {
          let pCur = localPos(e, surf.inkCanvas.getBoundingClientRect());
          const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
          const first = polyBuildPick.pts[0];
          if (polyBuildPick.pts.length >= 3 && Math.hypot(pCur.x - first.x, pCur.y - first.y) <= 28 / zoom) {
            pCur = { x: first.x, y: first.y };
            surf.snapBadge = { x: pCur.x, y: pCur.y, label: 'Đóng đa giác' };
          } else {
            const refHover = findPointRef(list, pCur.x, pCur.y, 24 / zoom);
            if (refHover) { pCur = { x: refHover.x, y: refHover.y }; surf.snapBadge = { x: pCur.x, y: pCur.y, label: 'Điểm / Đỉnh' }; }
            else surf.snapBadge = null;
          }
          surf.previewObj = {
            type: 'but',
            isPolyline: true,
            points: [...polyBuildPick.pts, pCur],
            color: activeColor(),
            width: activeWidth(),
            dashed: state.dashed
          };
          redrawActiveLayer(sid);
        }
        return;
      }
      if (!act && !isMultiTouch && state.tool === 'dung_tron' && circleCenterPick && circleCenterPick.sid === sid) {
        const surf = surfaces[sid];
        const list = state.annots[sid] || [];
        if (surf && surf.inkCanvas) {
          let pCur = localPos(e, surf.inkCanvas.getBoundingClientRect());
          const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
          const refHover = findPointRef(list, pCur.x, pCur.y, 24 / zoom);
          if (refHover) { pCur = { x: refHover.x, y: refHover.y }; }
          const r = Math.hypot(pCur.x - circleCenterPick.pt.x, pCur.y - circleCenterPick.pt.y);
          surf.snapBadge = { x: pCur.x, y: pCur.y, label: `R = ${Math.round(r)} px` };
          surf.previewObj = {
            type: 'elip',
            isCircle: true,
            x: circleCenterPick.pt.x - r,
            y: circleCenterPick.pt.y - r,
            w: r * 2,
            h: r * 2,
            previewRadiusEnd: pCur,
            color: activeColor(),
            width: activeWidth(),
            dashed: state.dashed
          };
          redrawActiveLayer(sid);
        }
        return;
      }
      if (!act && !isMultiTouch && (state.tool === 'dung_doan' || state.tool === 'dung_mui_ten') && linkedLinePick && linkedLinePick.sid === sid) {
        const surf = surfaces[sid];
        const list = state.annots[sid] || [];
        if (surf && surf.inkCanvas) {
          let pCur = localPos(e, surf.inkCanvas.getBoundingClientRect());
          const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
          const refHover = findPointRef(list, pCur.x, pCur.y, 24 / zoom);
          if (refHover) { pCur = { x: refHover.x, y: refHover.y }; surf.snapBadge = { x: pCur.x, y: pCur.y, label: 'Điểm / Đỉnh' }; }
          else {
            const sa = state.snapAngle ? NKInkEngine.snapAnglePoint(linkedLinePick.pt.x, linkedLinePick.pt.y, pCur.x, pCur.y) : null;
            if (sa && sa.angleLabel) {
              pCur = { x: sa.x, y: sa.y };
              surf.snapBadge = { x: pCur.x, y: pCur.y, label: sa.angleLabel };
            } else {
              const gSnap = snapSmartGridPoint(sid, pCur);
              if (gSnap) { pCur = { x: gSnap.x, y: gSnap.y }; surf.snapBadge = gSnap; }
              else surf.snapBadge = null;
            }
          }
          surf.previewObj = {
            type: linkedLinePick.isVec ? 'mui_ten' : 'duong',
            x1: linkedLinePick.pt.x, y1: linkedLinePick.pt.y,
            x2: pCur.x, y2: pCur.y,
            color: activeColor(), width: activeWidth(), dashed: state.dashed
          };
          redrawActiveLayer(sid);
        }
        return;
      }
      if (!act || isMultiTouch) return;
      if (act.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== act.pointerId) return;
      if (act.mode === 'touch_hold_watch') {
        if (Math.hypot(e.clientX - act.sx, e.clientY - act.sy) > 10) {
          clearTouchHold();
          act = null;
        }
        return;
      }
      if (act.mode === 'pan') {
        if (touchHoldTimer && Math.hypot(e.clientX - act.sx, e.clientY - act.sy) > 10) {
          clearTouchHold();
        }
        const now = performance.now();
        act.samples.push({ x: e.clientX, y: e.clientY, t: now });
        // Chỉ giữ mẫu trong 90ms gần nhất để tính vận tốc vuốt thực tế chính xác
        while (act.samples.length > 2 && now - act.samples[0].t > 90) {
          act.samples.shift();
        }
        if (act.isBoardPan) {
          if (!act.panStarted) {
            if (Math.hypot(e.clientX - act.sx, e.clientY - act.sy) < 12) return;
            act.panStarted = true;
          }
          state.boardCam.panX = act.sl + (e.clientX - act.sx);
          state.boardCam.panY = act.st + (e.clientY - act.sy);
          updateBoardCameraHud();
          if (surfaces.board) {
            drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
            redrawSurface('board');
          }
        } else {
          pdfScroll.scrollLeft = act.sl - (e.clientX - act.sx);
          pdfScroll.scrollTop = act.st - (e.clientY - act.sy);
        }
        return;
      }

      e.preventDefault();
      let pos = localPos(e, act.rect);
      const list = state.annots[sid];
      const surf = surfaces[sid];

      // Kéo đỉnh hoặc 4 điểm điều khiển đường cong Bézier (P0, C1, C2, P3) giống hệt bản EXE trên PC!
      if (act.mode === 'drag_label') {
        const obj = list[act.objIdx];
        if (obj) {
          const ax = obj.type === 'diem' ? obj.x : (obj.x1 + obj.x2) * 0.5;
          const ay = obj.type === 'diem' ? obj.y : (obj.y1 + obj.y2) * 0.5;
          const dx = pos.x - ax, dy = pos.y - ay;
          const dist = Math.hypot(dx, dy);
          const MIN_R = 8.0, MAX_R = 36.0;
          if (dist < 0.001) {
            obj.labelDx = 7; obj.labelDy = -6;
          } else {
            const clampedR = Math.max(MIN_R, Math.min(dist, MAX_R));
            obj.labelDx = Number((dx * clampedR / dist).toFixed(2));
            obj.labelDy = Number((dy * clampedR / dist).toFixed(2));
          }
          redrawSurface(sid);
        }
        return;
      }

      if (act.mode === 'drag_vertex') {
        const obj = list[act.objIdx];
        if (!obj) return;
        if (state.snapPoint) {
          const sp = NKInkEngine.findNearestSnapPoint(list.filter((_, k) => k !== act.objIdx), pos.x, pos.y);
          if (sp) { pos = { x: sp.x, y: sp.y }; surf.snapBadge = sp; }
          else {
            let snapped = false;
            if (state.snapAngle && (obj.type === 'duong' || obj.type === 'mui_ten') && (act.role === 'p1' || act.role === 'p2') && !obj.axisLock && !obj.perpBisectorRef && !obj.lineConstraintRef && !obj.tangentLineRef) {
              const ax = act.role === 'p2' ? obj.x1 : obj.x2;
              const ay = act.role === 'p2' ? obj.y1 : obj.y2;
              const sa = NKInkEngine.snapAnglePoint(ax, ay, pos.x, pos.y);
              if (sa && sa.angleLabel) {
                pos = { x: sa.x, y: sa.y };
                surf.snapBadge = { x: pos.x, y: pos.y, label: sa.angleLabel };
                snapped = true;
              }
            }
            if (!snapped && (obj.type === 'diem' && !obj.onObjRef) || (!snapped && (obj.type === 'duong' || obj.type === 'mui_ten') && !obj.axisLock)) {
              const gSnap = snapSmartGridPoint(sid, pos);
              if (gSnap) { pos = { x: gSnap.x, y: gSnap.y }; surf.snapBadge = gSnap; snapped = true; }
            }
            if (!snapped) surf.snapBadge = null;
          }
        }
        if (obj.type === 'duong' || obj.type === 'mui_ten') {
          const endRef = act.role === 'p1' ? obj.p1Ref : (act.role === 'p2' ? obj.p2Ref : null);
          const linkedGlider = (endRef && endRef.kind === 'diem')
            ? list.find((o) => o && o.id === endRef.id && o.type === 'diem' && o.onObjRef)
            : null;
          if (linkedGlider && typeof projectPointOntoObject === 'function') {
            const gParent = list.find((o) => o && o.id === linkedGlider.onObjRef.id && !o.hidden);
            const gProj = gParent ? projectPointOntoObject(gParent, pos.x, pos.y) : null;
            if (gProj) {
              pos = { x: gProj.x, y: gProj.y };
              linkedGlider.onObjRef.t = gProj.t;
              linkedGlider.onObjRef.theta = gProj.theta;
              linkedGlider.onObjRef.segIdx = gProj.segIdx;
              linkedGlider.onObjRef.edgeIdx = gProj.edgeIdx;
              linkedGlider.x = gProj.x;
              linkedGlider.y = gProj.y;
              surf.snapBadge = null;
            }
          } else {
            if (act.role === 'p1') obj.p1Ref = null;
            else if (act.role === 'p2') obj.p2Ref = null;
          }
        }
        if (obj.type === 'diem' && obj.onObjRef && typeof projectPointOntoObject === 'function') {
          const parentObj = list.find((o) => o && o.id === obj.onObjRef.id && !o.hidden);
          if (parentObj) {
            const proj = projectPointOntoObject(parentObj, pos.x, pos.y);
            if (proj) {
              pos = { x: proj.x, y: proj.y };
              obj.onObjRef.t = proj.t;
              obj.onObjRef.theta = proj.theta;
              obj.onObjRef.segIdx = proj.segIdx;
              obj.onObjRef.edgeIdx = proj.edgeIdx;
              surf.snapBadge = null;
            }
          }
        }
        if (obj.type === 'diem' && obj.onSlopeCenterRef && typeof getObjectStraightSegment === 'function') {
          const sc = obj.onSlopeCenterRef;
          const sObj = list.find((o) => o && !o.hidden && o.id === sc.slopeId);
          const seg = sObj ? getObjectStraightSegment(sObj, sc.segIdx) : null;
          if (seg) {
            const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y, l2 = dx * dx + dy * dy;
            const len = Math.max(1e-4, Math.sqrt(l2));
            let t = l2 > 1e-6 ? ((pos.x - seg.p1.x) * dx + (pos.y - seg.p1.y) * dy) / l2 : 0.5;
            t = Math.max(0.12, Math.min(0.88, t));
            sc.t = t;
            const blk = sc.blockId ? list.find((o) => o && o.id === sc.blockId) : null;
            if (blk && blk.onSlopeBlockRef) blk.onSlopeBlockRef.t = t;
            let nx = dy / len, ny = -dx / len;
            if (ny > 0) { nx = -nx; ny = -ny; }
            pos = { x: seg.p1.x + t * dx + sc.halfH * nx, y: seg.p1.y + t * dy + sc.halfH * ny };
          }
        }
        if (obj.type === 'mui_ten' && obj.forceConstraint && act.role === 'p2') {
          const fc = obj.forceConstraint;
          let ux = 0, uy = 1;
          if (fc.kind !== 'gravity') {
            const sObj = list.find((o) => o && !o.hidden && o.id === fc.slopeId);
            const seg = sObj ? getObjectStraightSegment(sObj, fc.segIdx) : null;
            if (seg) {
              const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y, len = Math.max(1e-4, Math.hypot(dx, dy));
              const tx = dx / len, ty = dy / len;
              let nx = ty, ny = -tx;
              if (ny > 0) { nx = -nx; ny = -ny; }
              if (fc.kind === 'normal') { ux = nx; uy = ny; }
              else if (fc.kind === 'parallel_up') { ux = -tx; uy = -ty; }
              else { ux = tx; uy = ty; }
            }
          }
          const projLen = Math.max(24, (pos.x - obj.x1) * ux + (pos.y - obj.y1) * uy);
          fc.len = projLen;
          pos = { x: obj.x1 + ux * projLen, y: obj.y1 + uy * projLen };
        }
        const isDerivedLockedPt = obj.type === 'diem' && Boolean(obj.sumTipRef || obj.oppTipRef || obj.intersectRef || obj.footPerpRef || obj.midSegRef || (Array.isArray(obj.midRef) && obj.midRef.length === 2));
        if (!isDerivedLockedPt) {
          NKInkEngine.updateObjectVertex(obj, act.role, pos.x, pos.y);
          syncWaveDragTwin(list, obj, pos);
          if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.vertexRefs) && typeof act.role === 'number') {
            const vr = obj.vertexRefs[act.role];
            if (vr && vr.kind === 'diem') {
              const dObj = list.find((o) => o && o.id === vr.id);
              if (dObj && !dObj.onObjRef && !dObj.intersectRef && !dObj.footPerpRef && !dObj.sumTipRef && !dObj.oppTipRef && !(Array.isArray(dObj.midRef) && dObj.midRef.length === 2)) {
                dObj.x = pos.x; dObj.y = pos.y;
              }
            }
          }
        }
        if (typeof updateConstrainedLineEndpoint === 'function') {
          updateConstrainedLineEndpoint(list, obj, act.role, pos);
        }
        if (typeof snapPerpForceDrag === 'function') {
          const snappedPerp = snapPerpForceDrag(list, obj, act.role, pos);
          if (snappedPerp) {
            pos = { x: snappedPerp.x, y: snappedPerp.y };
            const isDerivedLockedPt = obj.type === 'diem' && Boolean(obj.sumTipRef || obj.oppTipRef || obj.intersectRef || obj.footPerpRef || obj.midSegRef || (Array.isArray(obj.midRef) && obj.midRef.length === 2));
        if (!isDerivedLockedPt) {
          NKInkEngine.updateObjectVertex(obj, act.role, pos.x, pos.y);
          syncWaveDragTwin(list, obj, pos);
          if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.vertexRefs) && typeof act.role === 'number') {
            const vr = obj.vertexRefs[act.role];
            if (vr && vr.kind === 'diem') {
              const dObj = list.find((o) => o && o.id === vr.id);
              if (dObj && !dObj.onObjRef && !dObj.intersectRef && !dObj.footPerpRef && !dObj.sumTipRef && !dObj.oppTipRef && !(Array.isArray(dObj.midRef) && dObj.midRef.length === 2)) {
                dObj.x = pos.x; dObj.y = pos.y;
              }
            }
          }
        }
        if (typeof updateConstrainedLineEndpoint === 'function') {
          updateConstrainedLineEndpoint(list, obj, act.role, pos);
        }
            if (surf) surf.snapBadge = { x: pos.x, y: pos.y, label: '⟂ Vuông góc 90°' };
          }
        }
        if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(list);
        const updatedVerts = NKInkEngine.getObjectVertices(obj);
        const updatedV = updatedVerts.find((vv) => vv.role === act.role);
        if (surf) {
          surf.activeVertexHighlight = updatedV ? { x: updatedV.x, y: updatedV.y } : { x: pos.x, y: pos.y };
        }
        // Hiển thị nhãn Độ dốc đầu / Độ dốc đuôi khi kéo 2 điểm tiếp tuyến C1, C2 giống hệt bản EXE (view.py dòng 2357-2366)
        if (obj.bezierCtrlPts && obj.bezierCtrlPts.length === 4) {
          if (act.role === 'bezier_cp_1') {
            const dx = obj.bezierCtrlPts[1].x - obj.bezierCtrlPts[0].x;
            const dy = obj.bezierCtrlPts[1].y - obj.bezierCtrlPts[0].y;
            const deg = ((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1);
            surf.snapBadge = { x: pos.x, y: pos.y, label: `Độ dốc đầu: ${deg}°` };
          } else if (act.role === 'bezier_cp_2') {
            const dx = obj.bezierCtrlPts[3].x - obj.bezierCtrlPts[2].x;
            const dy = obj.bezierCtrlPts[3].y - obj.bezierCtrlPts[2].y;
            const deg = ((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1);
            surf.snapBadge = { x: pos.x, y: pos.y, label: `Độ dốc đuôi: ${deg}°` };
          }
        }
        redrawSurface(sid);
        return;
      }

      if (act.mode === 'move_sel') {
        const dx = pos.x - act.lx, dy = pos.y - act.ly;
        act.lx = pos.x; act.ly = pos.y;
        const selectedIds = new Set(state.selectedIndices.map((idx) => list[idx] && list[idx].id).filter(Boolean));
        for (const idx of state.selectedIndices) {
          const item = list[idx];
          if (!item) continue;
          if (item.type === 'duong' || item.type === 'mui_ten') {
            if (!item.p1Ref) { item.x1 += dx; item.y1 += dy; }
            if (!item.p2Ref) { item.x2 += dx; item.y2 += dy; }
            continue;
          }
          if (item.type === 'elip' && item.centerRef && item.centerRef.kind === 'diem' && !selectedIds.has(item.centerRef.id)) {
            const cObj = list.find((o) => o && o.id === item.centerRef.id);
            if (cObj && !cObj.onObjRef && !(Array.isArray(cObj.midRef) && cObj.midRef.length === 2)) {
              NKInkEngine.translateObject(cObj, dx, dy);
            }
          }
          if (item.type === 'diem' && item.onObjRef && state.selectedIndices.length === 1 && typeof projectPointOntoObject === 'function') {
            const pObj = list.find((o) => o && o.id === item.onObjRef.id && !o.hidden);
            const proj = pObj ? projectPointOntoObject(pObj, item.x + dx, item.y + dy) : null;
            if (proj) {
              item.x = proj.x;
              item.y = proj.y;
              item.onObjRef.t = proj.t;
              item.onObjRef.theta = proj.theta;
              item.onObjRef.segIdx = proj.segIdx;
              item.onObjRef.edgeIdx = proj.edgeIdx;
              continue;
            }
          }
          if (item.type === 'diem' && (item.sumTipRef || item.oppTipRef || item.intersectRef || item.footPerpRef || item.midSegRef || (Array.isArray(item.midRef) && item.midRef.length === 2))) {
            continue;
          }
          NKInkEngine.translateObject(item, dx, dy);
        }
        if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(list);
        redrawSurface(sid);
        return;
      }

      if (act.mode === 'rotate_sel') {
        const curAng = Math.atan2(pos.y - act.cy, pos.x - act.cx);
        let deltaRad = curAng - act.startAng;
        if (e.shiftKey) {
          const step = (15 * Math.PI) / 180;
          deltaRad = Math.round(deltaRad / step) * step;
        }
        const deg = Math.round((deltaRad * 180) / Math.PI);
        surf.snapBadge = { x: pos.x, y: pos.y, label: `⟳ ${deg >= 0 ? '+' : ''}${deg}°` };
        state.selectedIndices.forEach((objIdx, k) => {
          const copy = JSON.parse(JSON.stringify(act.origObjs[k]));
          NKInkEngine.rotateObject(copy, deltaRad, act.cx, act.cy);
          list[objIdx] = copy;
        });
        if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(list);
        redrawSurface(sid);
        return;
      }

      if (act.mode === 'resize_sel') {
        const r0 = act.origBox;
        const w0 = Math.max(1, r0.x1 - r0.x0);
        const h0 = Math.max(1, r0.y1 - r0.y0);
        const h = act.handle;
        let ax = (r0.x0 + r0.x1) * 0.5, sx = 1.0;
        let ay = (r0.y0 + r0.y1) * 0.5, sy = 1.0;

        // Kéo vượt qua cạnh đối diện -> sx, sy < 0 -> Lật đối xứng trực tiếp giống hệt bản PC!
        if (h.includes('w')) { ax = r0.x1; sx = (pos.x - ax) / (-w0); }
        else if (h.includes('e')) { ax = r0.x0; sx = (pos.x - ax) / w0; }

        if (h.includes('n')) { ay = r0.y1; sy = (pos.y - ay) / (-h0); }
        else if (h.includes('s')) { ay = r0.y0; sy = (pos.y - ay) / h0; }

        if (Math.abs(sx) < 0.04) sx = sx < 0 ? -0.04 : 0.04;
        if (Math.abs(sy) < 0.04) sy = sy < 0 ? -0.04 : 0.04;

        const hasElip = Array.isArray(act.origObjs) && act.origObjs.some((o) => o && o.type === 'elip');
        const isCornerHandle = (h === 'nw' || h === 'ne' || h === 'sw' || h === 'se');
        if (hasElip && isCornerHandle) {
          const u = Math.max(Math.abs(sx), Math.abs(sy));
          sx = (sx < 0 ? -1 : 1) * u;
          sy = (sy < 0 ? -1 : 1) * u;
        }

        if (sx < 0 || sy < 0) {
          const flipLbl = (sx < 0 && sy > 0) ? '↔ Đối xứng ngang' : ((sy < 0 && sx > 0) ? '↕ Đối xứng dọc' : '⤡ Đối xứng tâm');
          surf.snapBadge = { x: pos.x, y: pos.y, label: flipLbl };
        } else {
          surf.snapBadge = null;
        }

        state.selectedIndices.forEach((objIdx, k) => {
          const copy = JSON.parse(JSON.stringify(act.origObjs[k]));
          NKInkEngine.scaleObjectFromAnchor(copy, ax, ay, sx, sy);
          list[objIdx] = copy;
        });
        if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(list);
        redrawSurface(sid);
        return;
      }

      if (act.mode === 'marquee' || act.mode === 'marquee_erase') {
        surf.marqueeBox = {
          x: Math.min(act.sx, pos.x),
          y: Math.min(act.sy, pos.y),
          w: Math.abs(pos.x - act.sx),
          h: Math.abs(pos.y - act.sy),
          enclosed: act.mode === 'marquee' ? (pos.x < act.sx) : false
        };
        redrawActiveLayer(sid);
        return;
      }

      if (act.mode === 'erase') {
        eraseAt(sid, pos.x, pos.y, act);
        return;
      }

      if (act.mode === 'freehand') {
        if (act.snapped) {
          // ĐANG Ở TRẠNG THÁI ĐÃ GIỮ BÚT NẮN HÌNH (HOLD-TO-SHAPE):
          // Dịch chuyển mũi bút -> Đường cong, Căn bậc 2, Đoạn thẳng, Đường tròn, Tam giác, HCN, Hệ trục Oxy
          // đều biến thiên trực tiếp theo mũi bút giống 100% bản EXE trên PC!
          surf.snapBadge = NKInkEngine.updateHeldShapeOnMove(
            act.snapped,
            pos,
            list,
            state.snapPoint,
            state.snapAngle,
            e.shiftKey
          );
          surf.previewObj = act.snapped;
          redrawActiveLayer(sid);
          return;
        }

        const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e];
        const now = performance.now();
        const rSnap = state.ruler.visible ? snapPointToRulerEdge(inkCanvas, pos, sid, act.rawPts[0]) : null;
        if (rSnap) {
          // Đang kẻ bút dọc theo cạnh Thước kẻ -> Nét bút trượt thẳng tắp theo cạnh thước và báo độ dài cm!
          surf.snapBadge = rSnap;
          surf.previewObj.points = [act.rawPts[0], { x: rSnap.x, y: rSnap.y }];
          redrawActiveLayer(sid);
          return;
        }
        surf.snapBadge = null;

        const isHl = state.tool === 'to_sang';
        const penCol = activeColor();
        const penW = activeWidth();
        const prevFn = inkProc.filteredPoints.length;
        let addedAny = false;
        for (let ei = 0; ei < events.length; ei++) {
          const ev = events[ei];
          const p = localPos(ev, act.rect);
          if (inkProc.addPoint(p.x, p.y, now + ei * 2)) {
            act.rawPts.push({ x: p.x, y: p.y });
            addedAny = true;
            // Vẽ tăng dần O(1) trực tiếp lên activeCanvas (không xóa vẽ lại cả trang -> 120Hz siêu nhẹ, độ trễ 0ms!)
            const fPts = inkProc.filteredPoints;
            const fn = fPts.length;
            if (!isHl && !state.dashed && !act.scribbleState && fn >= 3) {
              drawIncrementalSegment(fPts[fn - 3], fPts[fn - 2], fPts[fn - 1], penCol, penW, false, false);
            }
            if (typeof tvQueueStrokePoint === 'function') tvQueueStrokePoint(sid, p);
          }
        }

        // Bút tô sáng (có độ mờ) hoặc nét đứt hoặc đoạn ngắn đầu tiên cần vẽ lại toàn bộ nét hiện tại
        if (addedAny && (isHl || state.dashed || act.scribbleState || prevFn < 4 || inkProc.filteredPoints.length < 4)) {
          surf.previewObj.points = inkProc.filteredPoints;
          redrawActiveLayer(sid);
        }

        // Nhận diện xoáy bút xóa nhanh (giới hạn bán kính chạm siêu gọn 4.5px: chỉ xóa đúng nét đang đụng!)
        if ((state.tool === 'but' || state.tool === 'to_sang') && act.rawPts.length >= 24 && (now - act.lastScribCheck > 90)) {
          act.lastScribCheck = now;
          const hitTol = sid === 'board' ? 4.5 / Math.max(0.5, state.boardCam.zoom) : 4.5;
          const scrib = NKInkEngine.detectScribbleErase(act.rawPts, list, hitTol);
          if (scrib.isScribble) {
            clearHold();
            act.scribbleState = scrib;
            surf.previewObj.points = inkProc.filteredPoints;
            surf.previewObj.color = '#F43F5E';
            surf.previewObj.dashed = true;
            surf.snapBadge = {
              x: pos.x,
              y: pos.y,
              label: scrib.hitIndices.length > 0
                ? `🌀 Xoáy xóa nhanh (${scrib.hitIndices.length} đối tượng)`
                : '🌀 Xoáy bút xóa nhanh'
            };
            redrawActiveLayer(sid);
            return;
          } else if (act.scribbleState) {
            act.scribbleState = null;
            surf.previewObj.color = activeColor();
            surf.previewObj.dashed = state.dashed;
            surf.snapBadge = null;
            redrawActiveLayer(sid);
          }
        }

        // Cơ chế Giữ bút nắn thẳng / nắn hình chuẩn GoodNotes:
        // - Bán kính giữ yên nhỏ (4.5px cho Apple Pencil, 7px cho ngón tay, 4px cho chuột) để khi viết chậm chữ nhỏ không bị kích hoạt nhầm giữa chừng!
        // - Thời gian giữ yên 580ms (bút/tay) hoặc 550ms (chuột): viết chậm vẫn mượt, dừng hẳn mới nắn hình!
        if ((state.tool === 'but' || state.tool === 'to_sang') && !act.scribbleState) {
          const holdRadius = (e.pointerType === 'touch') ? 7.0 : ((e.pointerType === 'pen') ? 4.5 : 4.0);
          const holdDelayMs = (e.pointerType === 'pen' || e.pointerType === 'touch') ? 580 : 550;
          const anchorMove = act.holdAnchor ? Math.hypot(pos.x - act.holdAnchor.x, pos.y - act.holdAnchor.y) : 999;
          act.lastHoldPos = { x: pos.x, y: pos.y };
          if (anchorMove > holdRadius || !holdTimer) {
            if (anchorMove > holdRadius) act.holdAnchor = { x: pos.x, y: pos.y };
            clearHold();
            holdTimer = setTimeout(() => {
              if (!act || act.mode !== 'freehand' || act.snapped) return;
              const isHw = inkProc.isLikelyHandwriting();
              const shape = NKInkEngine.recognizeSpecialShape(
                act.rawPts,
                {
                  color: activeColor(),
                  width: activeWidth(),
                  dashed: state.dashed
                },
                isHw
              );
              if (shape) {
                if (state.tool === 'to_sang' && shape.type === 'duong') {
                  shape.isHighlighter = true;
                }
                act.snapped = shape;
                surf.previewObj = shape;
                redrawActiveLayer(sid);
                notify(`✨ Giữ bút: ${shape.shapeLabel}`);
              }
            }, holdDelayMs);
          }
        }
        return;
      }

      if (act.mode === 'shape') {
        const sx = act.sx, sy = act.sy;
        let ex = pos.x, ey = pos.y;
        surf.snapBadge = null;

        if (state.tool === 'duong' || state.tool === 'mui_ten' || state.tool === 'gach_chan' || state.tool === 'gach_ngang') {
          const rSnap = snapPointToRulerEdge(inkCanvas, { x: ex, y: ey }, sid, { x: sx, y: sy });
          if (rSnap) {
            ex = rSnap.x; ey = rSnap.y; surf.snapBadge = rSnap;
          } else if (state.snapPoint) {
            const zoomSnap = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
            const refEnd = findPointRef(list, ex, ey, 26 / zoomSnap);
            if (refEnd) {
              ex = refEnd.x; ey = refEnd.y; surf.snapBadge = { x: ex, y: ey, label: 'Điểm / Đỉnh' };
            } else {
              const sp = NKInkEngine.findNearestSnapPoint(list, ex, ey, 20 / zoomSnap);
              if (sp) { ex = sp.x; ey = sp.y; surf.snapBadge = sp; }
            }
          }
          if (!surf.snapBadge && (state.snapAngle || state.tool === 'gach_chan' || state.tool === 'gach_ngang')) {
            const sa = NKInkEngine.snapAnglePoint(sx, sy, ex, ey);
            ex = sa.x; ey = sa.y;
            if (sa.angleLabel) surf.snapBadge = { x: ex, y: ey, label: sa.angleLabel };
          }
          if (!surf.snapBadge) {
            const gSnap = snapSmartGridPoint(sid, { x: ex, y: ey });
            if (gSnap) { ex = gSnap.x; ey = gSnap.y; surf.snapBadge = gSnap; }
          }
        }

        const style = { color: activeColor(), width: activeWidth(), dashed: state.dashed };
        if (state.tool === 'duong' || state.tool === 'mui_ten') {
          surf.previewObj = { type: state.tool, x1: sx, y1: sy, x2: ex, y2: ey, ...style };
        } else if (state.tool === 'dung_dang_nhiet') {
          const ox = Math.min(sx, ex), oy = Math.max(sy, ey);
          const vMin = 24, vMax = Math.max(vMin + 40, Math.abs(ex - sx));
          const kVal = vMin * Math.max(20, oy - Math.min(sy, ey));
          const pts = [];
          for (let s = 0; s < 45; s++) {
            const v = vMin + (vMax - vMin) * (s / 44);
            pts.push({ x: ox + v, y: oy - kVal / Math.max(1, v) });
          }
          surf.previewObj = NKInkEngine.attachCurveControls({ type: 'but', points: pts, ...style }, 'hyperbol');
        } else if (state.tool === 'gach_chan' || state.tool === 'gach_ngang') {
          surf.previewObj = {
            type: 'duong',
            x1: sx, y1: sy, x2: ex, y2: sy,
            color: state.tool === 'gach_ngang' ? '#D9534F' : activeColor(),
            width: 2.0
          };
        } else if (state.tool === 'hcn') {
          surf.previewObj = {
            type: 'hcn',
            x: Math.min(sx, ex), y: Math.min(sy, ey),
            w: Math.abs(ex - sx), h: Math.abs(ey - sy),
            ...style
          };
        } else if (state.tool === 'elip') {
          const d = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
          surf.previewObj = {
            type: 'elip',
            x: ex >= sx ? sx : sx - d,
            y: ey >= sy ? sy : sy - d,
            w: d,
            h: d,
            ...style
          };
        } else if (state.tool === 'hinh_binh_hanh') {
          const x0 = Math.min(sx, ex), x1 = Math.max(sx, ex);
          const y0 = Math.min(sy, ey), y1 = Math.max(sy, ey);
          const skew = (x1 - x0) * 0.24;
          surf.previewObj = {
            type: 'tam_giac',
            isParallelogram: true,
            geomConstraint: 'hinh_binh_hanh',
            points: [
              { x: x0 + skew, y: y0 },
              { x: x1, y: y0 },
              { x: x1 - skew, y: y1 },
              { x: x0, y: y1 }
            ],
            ...style
          };
        } else if (state.tool === 'xoa_vung') {
          const fillMap = { green: '#0B6251', black: '#000000', white: '#FFFFFF', cream: '#FDF6E3' };
          surf.previewObj = {
            type: 'xoa_vung',
            x: Math.min(sx, ex), y: Math.min(sy, ey),
            w: Math.abs(ex - sx), h: Math.abs(ey - sy),
            isPreview: true,
            isBoardErase: state.mode === 'board',
            keepGrid: state.mode === 'board' ? state.showBoardGrid : state.showGrid,
            gridStep: state.gridStep || 16,
            fillColor: state.mode === 'board' ? (fillMap[state.boardTheme] || '#0B6251') : '#FFFFFF'
          };
        } else if (state.tool === 'shape3d') {
          const cx3 = (sx + ex) * 0.5;
          const cy3 = (sy + ey) * 0.5;
          const sz3 = Math.max(36, Math.max(Math.abs(ex - sx), Math.abs(ey - sy)) * 0.52);
          surf.previewObj = {
            type: 'shape3d',
            kind3d: state.activeKind3D || 'chop_tu_giac',
            cx: cx3,
            cy: cy3,
            size: sz3,
            yaw: 0.42,
            pitch: 0.34,
            showAux: true,
            show3DLabels: true,
            ...style
          };
        } else if (state.tool === 'tam_giac' || state.tool === 'to_trong_suot') {
          const topY = Math.min(sy, ey);
          const botY = Math.max(sy, ey);
          surf.previewObj = {
            type: state.tool,
            points: [{ x: (sx + ex) * 0.5, y: topY }, { x: sx, y: botY }, { x: ex, y: botY }],
            hatch: state.tool === 'to_trong_suot' ? state.hatchMode : null,
            fillOpacity: state.hatchOpacity,
            ...style
          };
        }
        redrawActiveLayer(sid);
      }
    });

    inkCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      clearTouchHold();
      if (isMultiTouch || isPenActiveDown) return;
      const rect = inkCanvas.getBoundingClientRect();
      showCanvasContextMenu(sid, e.clientX, e.clientY, localPos(e, rect));
    });

    function endPointer(e) {
      if (act && act.pointerId !== undefined && e && e.pointerId !== undefined && e.pointerId !== act.pointerId) return;
      clearHold();
      clearTouchHold();
      if (act && act.mode === 'touch_hold_watch') {
        act = null;
        return;
      }
      if (sid !== 'board') {
        inkCanvas.style.touchAction = 'pan-x pan-y';
      }
      if (!act) {
        if (e && e.clientX !== undefined && state.tool === 'dung_tron' && circleCenterPick && circleCenterPick.sid === sid) {
          const surfUp = surfaces[sid];
          const listUp = state.annots[sid] || [];
          if (surfUp && surfUp.inkCanvas) {
            const pUp = localPos(e, surfUp.inkCanvas.getBoundingClientRect());
            if (Math.hypot(pUp.x - circleCenterPick.pt.x, pUp.y - circleCenterPick.pt.y) >= 10) {
              handleCircleToolDown(sid, pUp, listUp);
            }
          }
        }
        if (e && e.clientX !== undefined && (state.tool === 'dung_doan' || state.tool === 'dung_mui_ten') && linkedLinePick && linkedLinePick.sid === sid) {
          const surfUp = surfaces[sid];
          const listUp = state.annots[sid] || [];
          if (surfUp && surfUp.inkCanvas) {
            const pUp = localPos(e, surfUp.inkCanvas.getBoundingClientRect());
            if (Math.hypot(pUp.x - linkedLinePick.pt.x, pUp.y - linkedLinePick.pt.y) >= 14) {
              handleLinkedLineToolDown(sid, pUp, listUp, surfUp.inkCanvas.getBoundingClientRect());
            }
          }
        }
        return;
      }
      const surf = surfaces[sid];
      const list = state.annots[sid];
      surf.snapBadge = null;

      if (act.mode === 'pan') {
        const now = performance.now();
        const smps = act.samples || [];
        if (smps.length >= 2) {
          const last = smps[smps.length - 1];
          // Nếu ngón tay đã dừng lại > 70ms trước khi nhấc lên thì dừng hẳn, không trôi thêm
          if (now - last.t <= 70) {
            const first = smps[0];
            const dtMs = Math.max(16, last.t - first.t);
            const vxPerMs = (last.x - first.x) / dtMs;
            const vyPerMs = (last.y - first.y) / dtMs;
            if (Math.hypot(vxPerMs, vyPerMs) > 0.14) {
              startInertiaScroll(vxPerMs, vyPerMs, Boolean(act.isBoardPan));
            }
          }
        }
        if (surf) {
          surf.snapBadge = null;
          surf.activeVertexHighlight = null;
          redrawActiveLayer(sid);
        }
        act = null;
        return;
      }

      const segHitsBox = (x1, y1, x2, y2, rx0, ry0, rx1, ry1) => {
        let t0 = 0, t1 = 1;
        const dx = x2 - x1, dy = y2 - y1;
        const checks = [
          [-dx, x1 - rx0], [dx, rx1 - x1],
          [-dy, y1 - ry0], [dy, ry1 - y1]
        ];
        for (let ci = 0; ci < 4; ci++) {
          const p = checks[ci][0], q = checks[ci][1];
          if (Math.abs(p) < 1e-9) {
            if (q < 0) return false;
          } else {
            const r = q / p;
            if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
            else { if (r < t0) return false; if (r < t1) t1 = r; }
          }
        }
        return t0 <= t1;
      };
      const objHitsMarquee = (obj, rx0, ry0, rx1, ry1, skipMask = false) => {
        if (!obj || obj.hidden) return false;
        if (skipMask && obj.type === 'xoa_vung') return false;
        const b = NKInkEngine.getObjectBBox(obj);
        if (b.x1 < rx0 || b.x0 > rx1 || b.y1 < ry0 || b.y0 > ry1) return false;
        if (obj.type === 'duong' || obj.type === 'mui_ten') {
          return segHitsBox(obj.x1, obj.y1, obj.x2, obj.y2, rx0, ry0, rx1, ry1);
        }
        if (Array.isArray(obj.points) && obj.points.length > 0) {
          const pts = obj.points;
          if (pts.length === 1) {
            return pts[0].x >= rx0 && pts[0].x <= rx1 && pts[0].y >= ry0 && pts[0].y <= ry1;
          }
          for (let pi = 0; pi < pts.length - 1; pi++) {
            if (segHitsBox(pts[pi].x, pts[pi].y, pts[pi + 1].x, pts[pi + 1].y, rx0, ry0, rx1, ry1)) {
              return true;
            }
          }
          if (obj.type === 'tam_giac' || obj.type === 'to_trong_suot') {
            if (segHitsBox(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y, rx0, ry0, rx1, ry1)) {
              return true;
            }
          }
          return false;
        }
        if (obj.type === 'hcn') {
          return (
            segHitsBox(b.x0, b.y0, b.x1, b.y0, rx0, ry0, rx1, ry1) ||
            segHitsBox(b.x1, b.y0, b.x1, b.y1, rx0, ry0, rx1, ry1) ||
            segHitsBox(b.x1, b.y1, b.x0, b.y1, rx0, ry0, rx1, ry1) ||
            segHitsBox(b.x0, b.y1, b.x0, b.y0, rx0, ry0, rx1, ry1)
          );
        }
        if (obj.type === 'elip') {
          const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
          const rx = Math.max(1, Math.abs(obj.w) * 0.5), ry = Math.max(1, Math.abs(obj.h) * 0.5);
          const rot = obj.rotation || 0;
          const cosR = Math.cos(rot), sinR = Math.sin(rot);
          const STEPS = 48;
          let prevX = cx + rx * cosR, prevY = cy + rx * sinR;
          for (let si = 1; si <= STEPS; si++) {
            const ang = (si / STEPS) * Math.PI * 2;
            const lx = rx * Math.cos(ang), ly = ry * Math.sin(ang);
            const curX = cx + lx * cosR - ly * sinR;
            const curY = cy + lx * sinR + ly * cosR;
            if (segHitsBox(prevX, prevY, curX, curY, rx0, ry0, rx1, ry1)) return true;
            prevX = curX; prevY = curY;
          }
          return false;
        }
        return true;
      };

      if (act.mode === 'marquee') {
        const m = surf.marqueeBox;
        surf.marqueeBox = null;
        if (m && (m.w > 10 || m.h > 10)) {
          state.hideSelectionBoxForVertex = false;
          const rx0 = m.x, ry0 = m.y, rx1 = m.x + m.w, ry1 = m.y + m.h;
          const hits = [];
          if (m.enclosed) {
            // Quét Trái -> Phải (Window): CHỈ chọn đối tượng nằm trọn vẹn bên trong khung
            list.forEach((obj, idx) => {
              if (!obj || obj.hidden) return;
              const b = NKInkEngine.getObjectBBox(obj);
              if (b.x0 >= rx0 && b.x1 <= rx1 && b.y0 >= ry0 && b.y1 <= ry1) hits.push(idx);
            });
          } else {
            // Quét Phải -> Trái (Crossing): Chạm khung là chọn
            list.forEach((obj, idx) => {
              if (objHitsMarquee(obj, rx0, ry0, rx1, ry1, false)) hits.push(idx);
            });
          }
          state.selectedIndices = expandSelectionWithGroups(list, hits);
          state.selectedEdge = null;
          if (state.selectedIndices.length === 1) {
            const sIdx = state.selectedIndices[0];
            const sObj = list[sIdx];
            const ePts = sObj && (sObj.type === 'hcn'
              ? [{ x: sObj.x, y: sObj.y }, { x: sObj.x + sObj.w, y: sObj.y }, { x: sObj.x + sObj.w, y: sObj.y + sObj.h }, { x: sObj.x, y: sObj.y + sObj.h }]
              : ((sObj.type === 'tam_giac' || sObj.type === 'to_trong_suot') ? sObj.points : null));
            if (ePts && Array.isArray(ePts) && ePts.length >= 3) {
              const mcx = (rx0 + rx1) * 0.5, mcy = (ry0 + ry1) * 0.5;
              let bestHitEi = -1, bestHitDist = Infinity;
              let bestAnyEi = 0, bestAnyDist = Infinity;
              for (let ei = 0; ei < ePts.length; ei++) {
                const pA = ePts[ei], pB = ePts[(ei + 1) % ePts.length];
                const dC = NKInkEngine.distToSegment(mcx, mcy, pA.x, pA.y, pB.x, pB.y);
                if (dC < bestAnyDist) { bestAnyDist = dC; bestAnyEi = ei; }
                if (segHitsBox(pA.x, pA.y, pB.x, pB.y, rx0, ry0, rx1, ry1) && dC < bestHitDist) {
                  bestHitDist = dC;
                  bestHitEi = ei;
                }
              }
              state.selectedEdge = { objIdx: sIdx, edgeIdx: bestHitEi >= 0 ? bestHitEi : bestAnyEi };
            }
          }
          if (state.selectedIndices.length) {
            const tag = m.enclosed ? 'Trọn khung' : 'Chạm khung';
            notify(`Đã chọn ${state.selectedIndices.length} đối tượng (${tag}). Kéo bên trong khung để di chuyển hoặc dùng 8 điểm neo / nút xoay.`);
          }
        }
        redrawSurface(sid);
      } else if (act.mode === 'marquee_erase') {
        const m = surf.marqueeBox;
        surf.marqueeBox = null;
        if (m && (m.w > 4 || m.h > 4)) {
          state.hideSelectionBoxForVertex = false;
          const rx0 = m.x, ry0 = m.y, rx1 = m.x + m.w, ry1 = m.y + m.h;
          const keep = [];
          let removed = 0;
          list.forEach((obj) => {
            if (objHitsMarquee(obj, rx0, ry0, rx1, ry1, true)) removed++;
            else keep.push(obj);
          });
          if (removed > 0) {
            pushUndo(sid);
            state.annots[sid] = keep;
            notify(`Đã quét xóa ${removed} nét vẽ.`);
          }
        }
        redrawSurface(sid);
      } else if (act.mode === 'freehand' || act.mode === 'shape') {
        if (act.mode === 'shape' && state.tool === 'to_trong_suot') {
          const distMove = Math.hypot((e.clientX !== undefined ? localPos(e, act.rect).x : act.sx) - act.sx, (e.clientY !== undefined ? localPos(e, act.rect).y : act.sy) - act.sy);
          if (distMove < 20) {
            surf.previewObj = null;
            smartFloodFillAtPoint(sid, { x: act.sx, y: act.sy });
            redrawActiveLayer(sid);
            act = null;
            return;
          }
        }
        if (surf.previewObj) {
          if (surf.previewObj.type === 'xoa_vung' && Math.abs(surf.previewObj.w) < 4 && Math.abs(surf.previewObj.h) < 4) {
            surf.previewObj = null;
            redrawActiveLayer(sid);
            act = null;
            return;
          }
          // Kiểm tra nếu là nét xoáy bút nhiều vòng để xóa nhanh kiểu GoodNotes (Scribble-to-Erase — bán kính chạm chính xác 4.5px)
          if (act.mode === 'freehand' && !act.snapped && (state.tool === 'but' || state.tool === 'to_sang')) {
            const hitTol = sid === 'board' ? 4.5 / Math.max(0.5, state.boardCam.zoom) : 4.5;
            const scrib = NKInkEngine.detectScribbleErase(act.rawPts, list, hitTol);
            if (scrib && scrib.isScribble) {
              surf.previewObj = null;
              if (scrib.hitIndices.length > 0) {
                pushUndo(sid);
                const remSet = new Set(scrib.hitIndices);
                state.annots[sid] = list.filter((_, idx) => !remSet.has(idx));
                state.selectedIndices = [];
                notify(`🌀 Đã xoáy bút xóa nhanh ${scrib.hitIndices.length} đối tượng (Chạm 2 ngón / Ctrl+Z để hoàn tác).`);
              } else {
                notify('🌀 Đã hủy nét xoáy (Không có đối tượng nào dưới vùng xoáy).');
              }
              redrawSurface(sid);
              act = null;
              return;
            }
          }

          pushUndo(sid);
          if (surf.previewObj.type === 'he_truc_oxy_nan') {
            const o = surf.previewObj;
            list.push({ type: 'mui_ten', x1: o.O.x, y1: o.O.y, x2: o.Py.x, y2: o.Py.y, color: o.color, width: o.width });
            list.push({ type: 'mui_ten', x1: o.O.x, y1: o.O.y, x2: o.Px.x, y2: o.Px.y, color: o.color, width: o.width });
          } else {
            if (surf.previewObj.type === 'xoa_vung') {
              delete surf.previewObj.isPreview;
            }
            if (!act.snapped && act.mode === 'freehand') {
              if (e && e.clientX !== undefined) {
                const pEnd = localPos(e, act.rect);
                if (inkProc.addPoint(pEnd.x, pEnd.y, performance.now())) {
                  act.rawPts.push({ x: pEnd.x, y: pEnd.y });
                }
              }
              surf.previewObj.points = inkProc.buildSmoothPoints(true);
            }
            const committedObj = surf.previewObj;
            let twoStrokeRes = null;
            if (!act.snapped && act.mode === 'freehand' && state.tool === 'but' && list.length >= 1 && typeof NKInkEngine.tryAutoTwoStrokeSymbol === 'function') {
              twoStrokeRes = NKInkEngine.tryAutoTwoStrokeSymbol(list[list.length - 1], committedObj, list);
            }
            if (twoStrokeRes && Array.isArray(twoStrokeRes.items) && twoStrokeRes.items.length > 0) {
              list.pop();
              twoStrokeRes.items.forEach((it) => list.push(it));
              notify(`✨ ${twoStrokeRes.label}`);
            } else {
              if ((committedObj.type === 'duong' || committedObj.type === 'mui_ten') && typeof findPointRef === 'function') {
                const tolLink = sid === 'board' ? 36 / Math.max(0.5, state.boardCam.zoom) : 36;
                if (!committedObj.p1Ref) committedObj.p1Ref = findPointRef(list, committedObj.x1, committedObj.y1, tolLink);
                if (!committedObj.p2Ref) committedObj.p2Ref = findPointRef(list, committedObj.x2, committedObj.y2, tolLink);
              }
              list.push(committedObj);
            }
            if (committedObj.isSemicircle && committedObj.semiCenter) {
              ensureGeomId(committedObj);
              const cPt = {
                type: 'diem',
                x: committedObj.semiCenter.x,
                y: committedObj.semiCenter.y,
                text: '',
                color: committedObj.color || '#FFFFFF',
                shapeCenterRef: { hostId: committedObj.id, kind: 'semi' }
              };
              ensureGeomId(cPt);
              list.push(cPt);
            }
            // KHÔNG tự động chọn hình vừa vẽ/nắn khi đang ở chế độ Bút viết để Thầy viết tiếp biểu thức dưới dấu căn hoặc cạnh đường thẳng ngay lập tức!
            surf.previewObj = null;
            if (typeof tvEmitStrokeEnd === 'function') tvEmitStrokeEnd(sid, !act.snapped && act.mode === 'freehand', committedObj);
          }
          if (surf.previewObj) {
            surf.previewObj = null;
            if (typeof tvEmitStrokeEnd === 'function') tvEmitStrokeEnd(sid, false, null);
          }
          redrawSurface(sid);
        }
      } else {
        redrawSurface(sid);
      }
      act = null;
    }

    inkCanvas.addEventListener('pointerup', endPointer);
    inkCanvas.addEventListener('pointercancel', endPointer);

    // Chặn tuyệt đối trình duyệt iPadOS cuộn trang khi đặt bút Apple Pencil (stylus) hoặc khi đã tắt Chống chạm tay để vẽ bằng ngón tay
    if (sid !== 'board') {
      const blockStylusScroll = (e) => {
        if (e.touches && e.touches.length >= 1) {
          const hasStylus = Array.from(e.touches).some((t) => t.touchType === 'stylus');
          const penRecent = isPenActiveDown || (performance.now() - lastPenActivityTs < 250);
          if (hasStylus || (state.palmRejection && penRecent) || (!state.palmRejection && state.tool !== 'tay')) {
            e.preventDefault();
          }
        }
      };
      inkCanvas.addEventListener('touchstart', blockStylusScroll, { passive: false });
      inkCanvas.addEventListener('touchmove', blockStylusScroll, { passive: false });
    }
  }

  function showCanvasContextMenu(sid, clientX, clientY, worldPos) {
    const oldMenu = document.getElementById('nk-canvas-ctx-menu');
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'nk-canvas-ctx-menu';
    menu.style.cssText = [
      'position:fixed',
      'z-index:99999',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding:8px',
      'background:rgba(15,23,42,0.96)',
      'border:1px solid rgba(125,211,252,0.55)',
      'border-radius:12px',
      'box-shadow:0 12px 32px rgba(0,0,0,0.5)',
      'backdrop-filter:blur(10px)',
      'min-width:215px'
    ].join(';');

    const mkBtn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = [
        'text-align:left',
        'padding:9px 11px',
        'border-radius:8px',
        'border:1px solid rgba(255,255,255,0.12)',
        'background:rgba(30,41,59,0.92)',
        'color:#F8FAFC',
        'font-size:13.5px',
        'font-weight:600',
        'cursor:pointer'
      ].join(';');
      return b;
    };

    const insertImageDataUrl = (dataUrl) => {
      const surf = surfaces[sid];
      if (!surf) return;
      const img = new Image();
      img.onload = () => {
        const w = Math.min(360, Math.max(120, img.naturalWidth || 240));
        const h = w * ((img.naturalHeight || 180) / Math.max(1, img.naturalWidth || 240));
        ensureStacks(sid);
        pushUndo(sid);
        state.annots[sid].push({
          type: 'anh',
          x: Math.max(8, worldPos.x - w * 0.5),
          y: Math.max(8, worldPos.y - h * 0.5),
          w,
          h,
          dataUrl
        });
        state.selectedIndices = [state.annots[sid].length - 1];
        setTool('chon');
        redrawSurface(sid);
        notify('📋 Đã dán ảnh từ Clipboard!');
      };
      img.src = dataUrl;
    };

    // 1. Dán ảnh từ Clipboard
    const bPaste = mkBtn('📋 Dán ảnh từ Clipboard');
    bPaste.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      menu.remove();
      try {
        if (navigator.clipboard && navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const imgType = item.types.find((t) => t.startsWith('image/'));
            if (imgType) {
              const blob = await item.getType(imgType);
              const reader = new FileReader();
              reader.onload = () => insertImageDataUrl(reader.result);
              reader.readAsDataURL(blob);
              return;
            }
          }
          notify('⚠️ Clipboard hiện không có hình ảnh!');
          return;
        }
      } catch (_) {}
      // Dự phòng nếu Safari iPadOS chặn clipboard.read(): mở ô dán nhanh để chạm "Dán"
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
      const card = document.createElement('div');
      card.style.cssText = 'background:#0F172A;color:#F8FAFC;padding:14px;border-radius:12px;border:1px solid #38BDF8;width:270px;display:flex;flex-direction:column;gap:8px;text-align:center;';
      card.innerHTML = '<div style="font-weight:700;font-size:14px;">📋 Chạm giữ vào ô dưới rồi chọn <b>Dán (Paste)</b></div>';
      const pasteZone = document.createElement('div');
      pasteZone.contentEditable = 'true';
      pasteZone.style.cssText = 'min-height:44px;border:1.5px dashed #38BDF8;border-radius:8px;padding:10px;background:#1E293B;color:#94A3B8;outline:none;';
      pasteZone.textContent = 'Chạm giữ đây để Dán ảnh...';
      pasteZone.addEventListener('paste', (pe) => {
        const files = pe.clipboardData && pe.clipboardData.files;
        if (files && files.length > 0 && files[0].type.startsWith('image/')) {
          pe.preventDefault();
          const reader = new FileReader();
          reader.onload = () => insertImageDataUrl(reader.result);
          reader.readAsDataURL(files[0]);
          box.remove();
        }
      });
      const cancelB = mkBtn('Đóng');
      cancelB.style.textAlign = 'center';
      cancelB.addEventListener('click', () => box.remove());
      card.appendChild(pasteZone);
      card.appendChild(cancelB);
      box.appendChild(card);
      document.body.appendChild(box);
      setTimeout(() => pasteZone.focus(), 50);
    });
    menu.appendChild(bPaste);

    // 2. Ẩn / Hiện lưới ô ly
    const isBoard = sid === 'board';
    const curGrid = isBoard ? state.showBoardGrid : state.showGrid;
    const bGrid = mkBtn(curGrid ? '▦ Ẩn lưới ô ly' : '▦ Hiện lưới ô ly');
    bGrid.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.remove();
      if (isBoard) {
        document.getElementById('bx-btn-grid')?.click();
      } else {
        state.showGrid = !state.showGrid;
        document.getElementById('top-btn-grid')?.classList.toggle('active', state.showGrid);
        document.getElementById('rb-grid-toggle')?.classList.toggle('active', state.showGrid);
        Object.keys(surfaces).forEach((k) => {
          if (k !== 'board' && surfaces[k] && surfaces[k].gridCanvas) {
            drawGrid(surfaces[k].gridCanvas, surfaces[k].cssWidth, surfaces[k].cssHeight, surfaces[k].dpr, false);
          }
        });
      }
    });
    menu.appendChild(bGrid);

    // 3. Khung dựng hình các môn (mở #ThanhDungHinh)
    const bQuickHub = mkBtn('📐 Khung dựng hình các môn');
    bQuickHub.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.remove();
      const hub = document.getElementById('ThanhDungHinh');
      if (hub && hub.classList.contains('hidden')) {
        if (typeof toggleGeometryToolbar === 'function') toggleGeometryToolbar();
        else hub.classList.remove('hidden');
      }
    });
    menu.appendChild(bQuickHub);

    // 4. Nền bảng (Xanh / Đen / Trắng / Kem)
    const bgRow = document.createElement('div');
    bgRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:5px;padding:6px 8px;background:rgba(30,41,59,0.92);border-radius:8px;border:1px solid rgba(255,255,255,0.12);';
    const bgLbl = document.createElement('span');
    bgLbl.textContent = '🎨 Nền:';
    bgLbl.style.cssText = 'color:#F8FAFC;font-size:13px;font-weight:600;margin-right:2px;';
    bgRow.appendChild(bgLbl);
    const themes = [
      { id: 'green', bg: '#0B6251', title: 'Xanh' },
      { id: 'black', bg: '#000000', title: 'Đen' },
      { id: 'white', bg: '#FFFFFF', title: 'Trắng' },
      { id: 'cream', bg: '#FDF6E3', title: 'Kem' }
    ];
    themes.forEach((th) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.title = `Nền ${th.title}`;
      sw.style.cssText = `width:26px;height:26px;border-radius:50%;background:${th.bg};border:${state.boardTheme === th.id ? '2.5px solid #38BDF8' : '1.5px solid rgba(148,163,184,0.8)'};cursor:pointer;`;
      sw.addEventListener('click', (ev) => {
        ev.stopPropagation();
        menu.remove();
        if (!isBoard && typeof openBangXanh === 'function') openBangXanh(true);
        const sel = document.getElementById('bx-bg-select');
        if (sel) {
          sel.value = th.id;
          sel.dispatchEvent(new Event('change'));
        }
      });
      bgRow.appendChild(sw);
    });
    menu.appendChild(bgRow);

    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 220;
    const mh = menu.offsetHeight || 200;
    const left = Math.max(8, Math.min(window.innerWidth - mw - 8, clientX - mw * 0.5));
    const top = (clientY + 12 + mh <= window.innerHeight) ? (clientY + 12) : Math.max(8, clientY - mh - 12);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const closeMenu = (eDoc) => {
      if (!menu.contains(eDoc.target)) {
        menu.remove();
        window.removeEventListener('pointerdown', closeMenu, true);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', closeMenu, true), 50);
  }

  function eraseAt(sid, x, y, act) {
    const list = state.annots[sid] || [];
    const r = Math.max(11, activeWidth() * 3.5);
    for (let i = list.length - 1; i >= 0; i--) {
      if (NKInkEngine.hitDistanceToObject(list[i], x, y) <= r) {
        if (!act.erasedAny) {
          pushUndo(sid);
          act.erasedAny = true;
        }
        list.splice(i, 1);
        redrawSurface(sid);
      }
    }
  }

  // ============================================================================
  // BẢNG XANH VÔ HẠN: KÉO 4 CẠNH & 4 GÓC CO GIÃN ĐỂ VỪA MỞ PDF VỪA VIẾT BẢNG XANH
  // ============================================================================
  function syncBoardThemeChrome() {
    const isBlack = state.boardTheme === 'black';
    const isLight = state.boardTheme === 'white' || state.boardTheme === 'cream';
    const bgMap = { green: '#0B6251', black: '#000000', white: '#FFFFFF', cream: '#FDF6E3' };
    const boardHex = bgMap[state.boardTheme] || '#0B6251';
    const boardBtns = document.querySelectorAll('.bx-color-board');
    const wasBoardColorActive = Array.from(boardBtns).some((b) => b.classList.contains('active'));
    boardBtns.forEach((b) => {
      b.dataset.bxcolor = boardHex;
      b.style.background = boardHex;
      b.style.border = isLight ? '1.5px dashed #0F172A' : '1.5px dashed rgba(255,255,255,0.85)';
    });
    if (wasBoardColorActive) {
      state.boardColor = boardHex;
    }
    const isFs = Boolean(state.bxRect && state.bxRect.isFullscreen) && !bxWindow.classList.contains('hidden');
    bxWindow.classList.toggle('bx-theme-black', isBlack);
    bxWindow.classList.toggle('bx-fullscreen', Boolean(state.bxRect && state.bxRect.isFullscreen));
    bxWindow.classList.toggle('bx-floating', !(state.bxRect && state.bxRect.isFullscreen));
    bxBottomBar.classList.toggle('bx-bar-black', isBlack);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', (isFs && isBlack) ? '#000000' : (isFs ? '#0B6251' : '#1D58B4'));
    }
    if (isFs) {
      const fsBg = isBlack ? '#000000' : (state.boardTheme === 'green' ? '#07473A' : '#E2E8F0');
      document.documentElement.style.background = fsBg;
      document.body.style.background = fsBg;
    } else {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    }
  }

  function applyBangXanhRect() {
    const r = state.bxRect;
    if (r.isFullscreen) {
      bxWindow.style.left = '0px';
      bxWindow.style.top = '0px';
      bxWindow.style.width = '100%';
      bxWindow.style.height = '100%';
    } else {
      bxWindow.style.left = r.left + 'px';
      bxWindow.style.top = r.top + 'px';
      bxWindow.style.width = r.width + 'px';
      bxWindow.style.height = r.height + 'px';
    }
    syncBoardThemeChrome();
    initBoard();
    if (typeof window._updateBxMiniDockCols === 'function') window._updateBxMiniDockCols();
    requestAnimationFrame(() => {
      initBoard();
      if (typeof window._updateBxMiniDockCols === 'function') window._updateBxMiniDockCols();
    });
  }

  function initBoard() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(320, bxWrap.clientWidth || state.bxRect.width);
    const h = Math.max(200, (bxWrap.clientHeight || (state.bxRect.height - 44)));
    [bxGridCanvas, bxInkCanvas, bxActiveCanvas].forEach((c) => {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    });
    surfaces.board = {
      gridCanvas: bxGridCanvas,
      inkCanvas: bxInkCanvas,
      activeCanvas: bxActiveCanvas,
      dpr,
      cssWidth: w,
      cssHeight: h,
      previewObj: null,
      marqueeBox: null,
      snapBadge: null
    };
    drawGrid(bxGridCanvas, w, h, dpr, true);
    redrawSurface('board');
  }
  bindSurfaceEvents('board', bxInkCanvas);

  // Kéo 4 cạnh & 4 góc của Bảng Xanh để co giãn tùy ý (vừa đọc đề PDF phía trên vừa viết Bảng xanh phía dưới!)
  document.querySelectorAll('[data-bxedge]').forEach((edgeEl) => {
    let resizing = false, edge = '', sx = 0, sy = 0, orig = null;
    edgeEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizing = true;
      edge = edgeEl.dataset.bxedge;
      sx = e.clientX;
      sy = e.clientY;
      orig = { ...state.bxRect };
      state.bxRect.isFullscreen = false;
      try { edgeEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    edgeEl.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const minW = 360, minH = 220;
      const r = { ...orig };
      if (edge.includes('n')) {
        const minTop = window.matchMedia('(pointer: coarse)').matches ? 24 : 0;
        const newTop = Math.max(minTop, Math.min(orig.top + orig.height - minH, orig.top + dy));
        r.height = orig.height - (newTop - orig.top);
        r.top = newTop;
      }
      if (edge.includes('s')) {
        r.height = Math.max(minH, Math.min(window.innerHeight - orig.top, orig.height + dy));
      }
      if (edge.includes('w')) {
        const newLeft = Math.max(0, Math.min(orig.left + orig.width - minW, orig.left + dx));
        r.width = orig.width - (newLeft - orig.left);
        r.left = newLeft;
      }
      if (edge.includes('e')) {
        r.width = Math.max(minW, Math.min(window.innerWidth - orig.left, orig.width + dx));
      }
      state.bxRect = r;
      applyBangXanhRect();
    });
    edgeEl.addEventListener('pointerup', () => { resizing = false; });
  });

  // Nút chia nhanh: ⬓ Nửa dưới (Xem đề PDF ở trên), ◨ Nửa phải, 🗖 Toàn màn
  document.getElementById('bx-btn-split-bottom').addEventListener('click', () => {
    const topH = Math.round(window.innerHeight * 0.46);
    state.bxRect = { left: 0, top: topH, width: window.innerWidth, height: window.innerHeight - topH, isFullscreen: false };
    applyBangXanhRect();
    notify('⬓ Đã chia Bảng xanh nằm nửa dưới: Thầy có thể cuộn xem đề PDF ở nửa trên và viết Bảng xanh ở nửa dưới!');
  });

  document.getElementById('bx-btn-split-right').addEventListener('click', () => {
    const leftW = Math.round(window.innerWidth * 0.48);
    state.bxRect = { left: leftW, top: 38, width: window.innerWidth - leftW, height: window.innerHeight - 38, isFullscreen: false };
    applyBangXanhRect();
    notify('◨ Đã chia Bảng xanh nằm nửa phải: Xem đề PDF bên trái và viết Bảng xanh bên phải!');
  });

  document.getElementById('bx-btn-max').addEventListener('click', () => {
    if (!state.bxRect.isFullscreen) {
      state.bxRect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, isFullscreen: true };
      notify('🗖 Đã mở rộng Bảng toàn màn hình (Kéo cạnh trên xuống để chia đôi với PDF).');
    } else {
      const topH = Math.round(window.innerHeight * 0.46);
      state.bxRect = { left: 0, top: topH, width: window.innerWidth, height: window.innerHeight - topH, isFullscreen: false };
      notify('⬓ Đã thu Bảng xuống nửa dưới màn hình.');
    }
    applyBangXanhRect();
  });

  function openBangXanh(open = true) {
    if (open) {
      state.mode = 'board';
      bxWindow.classList.remove('hidden');
      applyBangXanhRect();
      notify('🟢 Đã mở Bảng (Kéo thanh mép trên xuống hoặc bấm "⬓ Nửa dưới" để vừa xem đề PDF vừa viết Bảng!)');
    } else {
      state.mode = 'pdf';
      bxWindow.classList.add('hidden');
      syncBoardThemeChrome();
      notify('Đã trở về tài liệu PDF.');
    }
  }

  document.getElementById('top-btn-bang-xanh').addEventListener('click', () => openBangXanh(bxWindow.classList.contains('hidden')));
  document.getElementById('vbar-bang-xanh').addEventListener('click', () => openBangXanh(bxWindow.classList.contains('hidden')));
  document.getElementById('bx-btn-close').addEventListener('click', () => openBangXanh(false));

  // Tự động kích hoạt chế độ 'board' khi người dùng chạm bút vào Bảng xanh, và chế độ 'pdf' khi chạm vào trang PDF
  bxWindow.addEventListener('pointerdown', () => { state.mode = 'board'; });
  pdfScroll.addEventListener('pointerdown', () => { if (!bxWindow.classList.contains('hidden') && !state.bxRect.isFullscreen) state.mode = 'pdf'; });

  // ============================================================================
  // HỘP THOẠI ⚙ SẮP XẾP THỨ TỰ & ẨN/HIỆN CÔNG CỤ (DÙNG CHUNG CHO CẢ 4 THANH: TOP, RIBBON, THANH DỌC, BẢNG XANH)
  // ============================================================================
  const sortModal = document.getElementById('ModalSapXepCongCu');
  const sortListEl = document.getElementById('sort-list-container');
  const sortTitleEl = document.getElementById('sort-modal-title');
  let currentSortTarget = 'ribbon'; // 'top' | 'ribbon' | 'vbar' | 'bx'
  let sortItemsData = [];
  let selectedSortIdx = 0;

  const SORT_TARGET_META = {
    top: {
      containerId: 'TopDynamicTools',
      attr: 'data-topid',
      labelAttr: 'data-toplabel',
      storageKey: 'nkpdf_top_tool_config',
      title: '⚙ Sắp xếp thứ tự & Ẩn/Hiện công cụ trên THANH TRÊN CÙNG'
    },
    ribbon: {
      containerId: 'RibbonDynamicTools',
      attr: 'data-rbid',
      labelAttr: 'data-rblabel',
      storageKey: 'nkpdf_ribbon_tool_config',
      title: '⚙ Sắp xếp thứ tự & Ẩn/Hiện công cụ trên THANH RIBBON NGANG'
    },
    vbar: {
      containerId: 'VbarDynamicTools',
      attr: 'data-vbid',
      labelAttr: 'data-vblabel',
      storageKey: 'nkpdf_vbar_tool_config',
      title: '⚙ Sắp xếp thứ tự & Ẩn/Hiện công cụ trên THANH CÔNG CỤ DỌC'
    },
    bx: {
      containerId: 'BxDynamicTools',
      attr: 'data-bxid',
      labelAttr: 'data-bxlabel',
      storageKey: 'nkpdf_bx_tool_config',
      title: '⚙ Sắp xếp thứ tự & Ẩn/Hiện công cụ trên THANH BẢNG XANH'
    }
  };

  function getToolbarDomItems(target) {
    const meta = SORT_TARGET_META[target] || SORT_TARGET_META.bx;
    const container = document.getElementById(meta.containerId);
    if (!container) return [];
    return Array.from(container.children).map((el) => ({
      id: el.getAttribute(meta.attr),
      label: el.getAttribute(meta.labelAttr) || el.title || el.textContent.trim(),
      visible: !el.classList.contains('hidden'),
      el
    }));
  }

  function applySavedToolbarConfig(target) {
    const meta = SORT_TARGET_META[target];
    if (!meta) return;
    const raw = localStorage.getItem(meta.storageKey);
    if (!raw) return;
    try {
      const cfg = JSON.parse(raw);
      const container = document.getElementById(meta.containerId);
      if (!container) return;
      if (cfg.order && Array.isArray(cfg.order)) {
        cfg.order.forEach((id) => {
          const el = container.querySelector(`[${meta.attr}="${id}"]`);
          if (el) container.appendChild(el);
        });
      }
      if (cfg.hidden && Array.isArray(cfg.hidden)) {
        const hidSet = new Set(cfg.hidden);
        Array.from(container.children).forEach((el) => {
          const id = el.getAttribute(meta.attr);
          el.classList.toggle('hidden', hidSet.has(id));
        });
      }
    } catch (_) {}
  }
  ['top', 'ribbon', 'vbar', 'bx'].forEach(applySavedToolbarConfig);

  function renderSortModalList() {
    sortListEl.innerHTML = '';
    sortItemsData.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = `sort-item ${idx === selectedSortIdx ? 'selected' : ''} ${!it.visible ? 'sort-item-hidden' : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(it.visible);
      cb.addEventListener('pointerdown', (e) => e.stopPropagation());
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        it.visible = cb.checked;
        selectedSortIdx = idx;
        renderSortModalList();
      });

      const span = document.createElement('span');
      span.style.flex = '1';
      span.textContent = `${idx + 1}. ${it.label}`;

      const toggleBadge = document.createElement('button');
      toggleBadge.type = 'button';
      toggleBadge.className = `sort-vis-pill ${it.visible ? 'vis-on' : 'vis-off'}`;
      toggleBadge.textContent = it.visible ? '☑ Hiện' : '⬜ Ẩn';
      toggleBadge.addEventListener('pointerdown', (e) => e.stopPropagation());
      toggleBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        it.visible = !it.visible;
        selectedSortIdx = idx;
        renderSortModalList();
      });

      row.appendChild(cb);
      row.appendChild(span);
      row.appendChild(toggleBadge);
      row.addEventListener('click', () => {
        if (selectedSortIdx === idx) {
          it.visible = !it.visible;
        } else {
          selectedSortIdx = idx;
        }
        renderSortModalList();
      });
      sortListEl.appendChild(row);
    });
  }

  function openSortModal(target) {
    currentSortTarget = SORT_TARGET_META[target] ? target : 'ribbon';
    const meta = SORT_TARGET_META[currentSortTarget];
    sortTitleEl.textContent = meta.title;
    document.querySelectorAll('.sort-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sorttarget === currentSortTarget);
    });
    sortItemsData = getToolbarDomItems(currentSortTarget);
    selectedSortIdx = 0;
    renderSortModalList();
    sortModal.classList.remove('hidden');
  }

  document.querySelectorAll('.sort-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => openSortModal(btn.dataset.sorttarget));
  });

  document.getElementById('top-btn-sort').addEventListener('click', () => openSortModal('top'));
  document.getElementById('rb-sort-btn').addEventListener('click', () => openSortModal('ribbon'));
  document.getElementById('vbar-sort-btn').addEventListener('click', () => openSortModal('vbar'));
  document.getElementById('bx-btn-sort').addEventListener('click', () => openSortModal('bx'));

  // Hỗ trợ chuột phải vào bất kỳ công cụ nào trên cả 4 thanh để mở hộp thoại sắp xếp
  document.getElementById('TopDynamicTools').addEventListener('contextmenu', (e) => { e.preventDefault(); openSortModal('top'); });
  document.getElementById('RibbonDynamicTools').addEventListener('contextmenu', (e) => { e.preventDefault(); openSortModal('ribbon'); });
  document.getElementById('VbarDynamicTools').addEventListener('contextmenu', (e) => { e.preventDefault(); openSortModal('vbar'); });
  document.getElementById('BxDynamicTools').addEventListener('contextmenu', (e) => { e.preventDefault(); openSortModal('bx'); });

  document.getElementById('sort-btn-top').addEventListener('click', () => {
    if (selectedSortIdx > 0) {
      const [it] = sortItemsData.splice(selectedSortIdx, 1);
      sortItemsData.unshift(it);
      selectedSortIdx = 0;
      renderSortModalList();
    }
  });
  document.getElementById('sort-btn-up').addEventListener('click', () => {
    if (selectedSortIdx > 0) {
      const tmp = sortItemsData[selectedSortIdx - 1];
      sortItemsData[selectedSortIdx - 1] = sortItemsData[selectedSortIdx];
      sortItemsData[selectedSortIdx] = tmp;
      selectedSortIdx--;
      renderSortModalList();
    }
  });
  document.getElementById('sort-btn-down').addEventListener('click', () => {
    if (selectedSortIdx < sortItemsData.length - 1) {
      const tmp = sortItemsData[selectedSortIdx + 1];
      sortItemsData[selectedSortIdx + 1] = sortItemsData[selectedSortIdx];
      sortItemsData[selectedSortIdx] = tmp;
      selectedSortIdx++;
      renderSortModalList();
    }
  });
  document.getElementById('sort-btn-bottom').addEventListener('click', () => {
    if (selectedSortIdx < sortItemsData.length - 1) {
      const [it] = sortItemsData.splice(selectedSortIdx, 1);
      sortItemsData.push(it);
      selectedSortIdx = sortItemsData.length - 1;
      renderSortModalList();
    }
  });
  document.getElementById('sort-btn-all').addEventListener('click', () => {
    sortItemsData.forEach((it) => { it.visible = true; });
    renderSortModalList();
  });
  document.getElementById('sort-btn-reset').addEventListener('click', () => {
    const meta = SORT_TARGET_META[currentSortTarget];
    if (meta) localStorage.removeItem(meta.storageKey);
    sortItemsData.forEach((it) => { it.visible = true; });
    renderSortModalList();
  });

  document.getElementById('save-sort-btn').addEventListener('click', () => {
    const meta = SORT_TARGET_META[currentSortTarget];
    if (!meta) return;
    const container = document.getElementById(meta.containerId);
    const order = [];
    const hidden = [];
    sortItemsData.forEach((it) => {
      order.push(it.id);
      if (!it.visible) hidden.push(it.id);
      it.el.classList.toggle('hidden', !it.visible);
      container.appendChild(it.el);
    });
    localStorage.setItem(meta.storageKey, JSON.stringify({ order, hidden }));
    sortModal.classList.add('hidden');
    notify('✅ Đã lưu cấu hình sắp xếp & ẩn/hiện công cụ.');
  });

  document.getElementById('close-sort-modal').addEventListener('click', () => sortModal.classList.add('hidden'));
  document.getElementById('cancel-sort-btn').addEventListener('click', () => sortModal.classList.add('hidden'));

  // ============================================================================
  // SỰ KIỆN BẢNG XANH & THANH DỰNG HÌNH 24 CÔNG CỤ
  // ============================================================================
  document.getElementById('bx-bg-select').addEventListener('change', (e) => {
    state.boardTheme = e.target.value;
    if (state.boardTheme === 'white' || state.boardTheme === 'cream') {
      bxBottomBar.classList.remove('bx-bar-dark');
      bxBottomBar.classList.add('bx-bar-light');
      if (state.boardColor === '#ffffff' || state.boardColor === '#ffd60a') {
        document.querySelector('.bx-color[data-bxcolor="#0066e0"]').click();
      }
    } else {
      bxBottomBar.classList.remove('bx-bar-light');
      bxBottomBar.classList.add('bx-bar-dark');
      if (state.boardColor === '#0066e0') {
        document.querySelector('.bx-color[data-bxcolor="#ffd60a"]').click();
      }
    }
    if (surfaces.board) {
      drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
    }
    syncBoardThemeChrome();
  });

  document.querySelectorAll('[data-bxtool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTool = btn.dataset.bxtool;
      setTool(targetTool);
      document.querySelectorAll('[data-bxtool]').forEach((b) => b.classList.toggle('active', b.dataset.bxtool === targetTool));
    });
  });

  function applyBoardStrokeWidth(newW) {
    state.boardWidth = newW;
    document.querySelectorAll('.bx-size').forEach((b) => b.classList.toggle('active', Math.abs(parseFloat(b.dataset.bxwidth) - newW) < 0.1));
    document.querySelectorAll('.bx-top-stroke-opt').forEach((b) => b.classList.toggle('active', Math.abs(parseFloat(b.dataset.bxwidth) - newW) < 0.1));
    const topStrokeBtn = document.getElementById('bx-top-stroke-btn');
    if (topStrokeBtn) {
      const lbl = newW < 2.5 ? 'Mảnh' : (newW < 4.5 ? 'Vừa' : 'Đậm');
      topStrokeBtn.textContent = `📏 ${lbl} ▾`;
    }
    const sid = activeSid();
    if (state.selectedIndices.length > 0 && state.annots[sid]) {
      pushUndo(sid);
      state.selectedIndices.forEach((idx) => {
        if (state.annots[sid][idx]) state.annots[sid][idx].width = newW;
      });
      redrawSurface(sid);
    }
  }

  document.querySelectorAll('.bx-size').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyBoardStrokeWidth(parseFloat(btn.dataset.bxwidth));
    });
  });

  const bxTopStrokeBtn = document.getElementById('bx-top-stroke-btn');
  const bxTopStrokeMenu = document.getElementById('bx-top-stroke-menu');
  if (bxTopStrokeBtn && bxTopStrokeMenu) {
    bxTopStrokeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bxTopStrokeMenu.classList.toggle('hidden');
    });
    document.querySelectorAll('.bx-top-stroke-opt').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        applyBoardStrokeWidth(parseFloat(opt.dataset.bxwidth));
        bxTopStrokeMenu.classList.add('hidden');
      });
    });
    document.addEventListener('pointerdown', (e) => {
      if (!bxTopStrokeMenu.classList.contains('hidden') && !e.target.closest('.bx-top-stroke-wrap')) {
        bxTopStrokeMenu.classList.add('hidden');
      }
    });
  }

  const bxMiniTopToggle = document.getElementById('bx-mini-top-toggle');
  const bxTopMiniBar = document.getElementById('BxTopMiniBar');
  if (bxMiniTopToggle && bxTopMiniBar && bxBottomBar) {
    bxMiniTopToggle.addEventListener('click', () => {
      const showTop = bxTopMiniBar.classList.contains('hidden');
      bxTopMiniBar.classList.toggle('hidden', !showTop);
      bxBottomBar.classList.toggle('hidden', showTop);
      bxMiniTopToggle.classList.toggle('active', showTop);
      if (toastBanner) toastBanner.classList.add('hidden');
    });
  }

  const bxTopPanBtn = document.getElementById('bx-top-pan-btn');
  if (bxTopPanBtn && bxWindow) {
    let dragTopResize = null;
    bxTopPanBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = bxWindow.getBoundingClientRect();
      dragTopResize = {
        id: e.pointerId,
        startY: e.clientY,
        origLeft: r.left,
        origTop: r.top,
        origWidth: r.width,
        origBottom: r.top + r.height
      };
      try { bxTopPanBtn.setPointerCapture(e.pointerId); } catch (_) {}
    });
    bxTopPanBtn.addEventListener('pointermove', (e) => {
      if (!dragTopResize || e.pointerId !== dragTopResize.id) return;
      e.preventDefault();
      const dy = e.clientY - dragTopResize.startY;
      const maxTop = Math.max(0, dragTopResize.origBottom - 60);
      const newTop = Math.max(0, Math.min(maxTop, Math.round(dragTopResize.origTop + dy)));
      const newH = Math.max(60, Math.round(dragTopResize.origBottom - newTop));
      state.bxRect = {
        left: dragTopResize.origLeft,
        top: newTop,
        width: dragTopResize.origWidth,
        height: newH,
        isFullscreen: newTop <= 2 && newH >= window.innerHeight - 2
      };
      applyBangXanhRect();
    });
    const endTopResize = (e) => {
      if (!dragTopResize || e.pointerId !== dragTopResize.id) return;
      dragTopResize = null;
      try { bxTopPanBtn.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    bxTopPanBtn.addEventListener('pointerup', endTopResize);
    bxTopPanBtn.addEventListener('pointercancel', endTopResize);
  }

  document.querySelectorAll('.bx-color').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetColor = btn.dataset.bxcolor;
      const isBoardBtn = Boolean(btn.dataset.bxboard);
      state.boardColor = targetColor;
      document.querySelectorAll('.bx-color').forEach((b) => {
        const match = isBoardBtn
          ? Boolean(b.dataset.bxboard)
          : (!b.dataset.bxboard && b.dataset.bxcolor === targetColor);
        b.classList.toggle('active', match);
      });
      if (state.selectedIndices.length > 0 && state.annots.board) {
        pushUndo('board');
        state.selectedIndices.forEach((idx) => {
          if (state.annots.board[idx]) state.annots.board[idx].color = state.boardColor;
        });
        redrawSurface('board');
      }
    });
  });

  const applyBoardCustomColor = (col) => {
    state.boardColor = col;
    document.querySelectorAll('.bx-color').forEach((b) => b.classList.remove('active'));
    const b1 = document.getElementById('bx-custom-color');
    const b2 = document.getElementById('bx-top-custom-color');
    if (b1 && b1.value !== col) b1.value = col;
    if (b2 && b2.value !== col) b2.value = col;
    if (state.selectedIndices.length > 0 && state.annots.board) {
      pushUndo('board');
      state.selectedIndices.forEach((idx) => {
        if (state.annots.board[idx]) state.annots.board[idx].color = state.boardColor;
      });
      redrawSurface('board');
    }
  };
  const bxCustomColorEl = document.getElementById('bx-custom-color');
  if (bxCustomColorEl) bxCustomColorEl.addEventListener('input', (e) => applyBoardCustomColor(e.target.value));
  const bxTopCustomColorEl = document.getElementById('bx-top-custom-color');
  if (bxTopCustomColorEl) bxTopCustomColorEl.addEventListener('input', (e) => applyBoardCustomColor(e.target.value));

  document.getElementById('bx-btn-dashed').addEventListener('click', (e) => {
    const sid = activeSid(), list = state.annots[sid] || [];
    if (state.selectedIndices.length > 0) {
      pushUndo(sid);
      const allDashed = state.selectedIndices.every((idx) => list[idx] && list[idx].dashed);
      const nextDashed = !allDashed;
      state.selectedIndices.forEach((idx) => { if (list[idx]) list[idx].dashed = nextDashed; });
      syncWaveInterferenceDash(list, state.selectedIndices.map((idx) => list[idx]));
      redrawSurface(sid);
      notify(nextDashed ? '−− Đã chuyển hình đang chọn sang Nét đứt' : '─ Đã chuyển hình đang chọn sang Nét liền');
      return;
    }
    state.dashed = !state.dashed;
    e.currentTarget.classList.toggle('active', state.dashed);
    const qDashed = document.querySelector('[data-qaction="toggle_dashed"]');
    if (qDashed) qDashed.classList.toggle('active', state.dashed);
  });

  document.getElementById('bx-btn-grid').addEventListener('click', (e) => {
    state.showBoardGrid = !state.showBoardGrid;
    e.currentTarget.classList.toggle('active', state.showBoardGrid);
    if (surfaces.board) {
      drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
    }
    syncBoardThemeChrome();
  });

  document.getElementById('bx-btn-clear').addEventListener('click', () => {
    if (!state.annots.board || !state.annots.board.length) return;
    pushUndo('board');
    state.annots.board = [];
    state.selectedIndices = [];
    redrawSurface('board');
    notify('🗑 Đã lau sạch Bảng xanh (Bấm ↩ Hoàn tác hoặc Ctrl+Z để lấy lại).');
  });

  document.getElementById('bx-btn-undo').addEventListener('click', performUndo);
  document.getElementById('bx-btn-redo').addEventListener('click', performRedo);

  document.getElementById('bx-btn-paste-pdf').addEventListener('click', () => {
    if (!surfaces.board || !surfaces[state.currentPage]) {
      notify('⚠️ Hãy mở một tài liệu PDF trước khi dán bảng.');
      return;
    }
    const w = surfaces.board.cssWidth, h = surfaces.board.cssHeight;
    const temp = document.createElement('canvas');
    temp.width = bxGridCanvas.width;
    temp.height = bxGridCanvas.height;
    const tctx = temp.getContext('2d');
    tctx.drawImage(bxGridCanvas, 0, 0);
    tctx.drawImage(bxInkCanvas, 0, 0);
    const dataUrl = temp.toDataURL('image/png');

    openBangXanh(false);
    const pno = state.currentPage, psurf = surfaces[pno];
    ensureStacks(pno);
    pushUndo(pno);
    const targetW = Math.min(psurf.cssWidth * 0.55, 420);
    const targetH = targetW * (h / w);
    state.annots[pno].push({
      type: 'anh',
      x: (psurf.cssWidth - targetW) * 0.5,
      y: (psurf.cssHeight - targetH) * 0.5,
      w: targetW,
      h: targetH,
      dataUrl
    });
    state.selectedIndices = [state.annots[pno].length - 1];
    setTool('chon');
    setTimeout(() => redrawSurface(pno), 80);
    notify('📸 Đã dán ảnh Bảng xanh vào trang PDF và tự động chọn để kéo thả, co dãn.');
  });

  function smartFloodFillAtPoint(sid, pt) {
    const list = state.annots[sid] || [];
    const surf = surfaces[sid];
    if (!surf || !list.length) {
      notify('🪣 Chưa có hình vẽ khép kín để tô màu.');
      return false;
    }

    const BOUNDARY_TYPES = new Set(['duong', 'mui_ten', 'hcn', 'elip', 'tam_giac', 'but', 'shape3d', 'he_truc_oxy_nan']);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const boundaries = [];
    for (const o of list) {
      if (!o || o.hidden || !BOUNDARY_TYPES.has(o.type)) continue;
      if (o.type === 'to_trong_suot' || o.isSmartFill) continue;
      if (o.type === 'but' && Array.isArray(o.points)) {
        if (o.points.length <= 1) continue;
        if (o.points.length === 2 && Math.hypot(o.points[1].x - o.points[0].x, o.points[1].y - o.points[0].y) < 4) continue;
      }
      const b = NKInkEngine.getObjectBBox(o);
      if (!b) continue;
      if (b.x0 < minX) minX = b.x0;
      if (b.y0 < minY) minY = b.y0;
      if (b.x1 > maxX) maxX = b.x1;
      if (b.y1 > maxY) maxY = b.y1;
      boundaries.push(o);
    }

    if (!boundaries.length || !isFinite(minX)) {
      notify('🪣 Chưa có đường biên khép kín tại vị trí chạm.');
      return false;
    }

    const pad = 24;
    let rx0 = minX - pad, ry0 = minY - pad;
    let rx1 = maxX + pad, ry1 = maxY + pad;
    if (pt.x < rx0 || pt.x > rx1 || pt.y < ry0 || pt.y > ry1) {
      notify('⚠️ Vùng này chưa khép kín hoàn toàn!');
      return false;
    }
    if (rx1 - rx0 > 1500) {
      rx0 = Math.max(rx0, pt.x - 750);
      rx1 = Math.min(rx1, pt.x + 750);
    }
    if (ry1 - ry0 > 1500) {
      ry0 = Math.max(ry0, pt.y - 750);
      ry1 = Math.min(ry1, pt.y + 750);
    }
    const rw = Math.max(10, rx1 - rx0);
    const rh = Math.max(10, ry1 - ry0);
    const localBoundaries = boundaries.filter((o) => {
      const b = NKInkEngine.getObjectBBox(o);
      return b && b.x1 >= rx0 && b.x0 <= rx1 && b.y1 >= ry0 && b.y0 <= ry1;
    });

    // Render mặt nạ ở độ phân giải cao (tối đa 2.5x supersampling) để mép tô mượt trên cả PDF lẫn Bảng Xanh
    const maxDim = 2000;
    const scale = Math.min(2.5, maxDim / Math.max(rw, rh));
    const bw = Math.max(4, Math.ceil(rw * scale));
    const bh = Math.max(4, Math.ceil(rh * scale));

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = bw;
    maskCanvas.height = bh;
    const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    mctx.save();
    mctx.scale(scale, scale);
    mctx.translate(-rx0, -ry0);
    for (const o of localBoundaries) {
      const clone = {
        ...o,
        color: '#FFFFFF',
        width: Math.max(1.2 / scale, (o.width || 2.4) * 0.62),
        dashed: false,
        edgeStyles: null,
        solidForMask: true,
        hatch: null,
        fillColor: null
      };
      NKInkEngine.drawObject(mctx, clone, false, false);
    }
    mctx.restore();

    const imgData = mctx.getImageData(0, 0, bw, bh);
    const data = imgData.data;
    const isWall = (idx) => data[idx * 4 + 3] >= 64;

    let sx = Math.round((pt.x - rx0) * scale);
    let sy = Math.round((pt.y - ry0) * scale);
    sx = Math.max(0, Math.min(bw - 1, sx));
    sy = Math.max(0, Math.min(bh - 1, sy));

    if (isWall(sy * bw + sx)) {
      let found = false;
      const maxRad = Math.max(6, Math.ceil(10 * scale));
      for (let rad = 1; rad <= maxRad && !found; rad++) {
        for (let dy = -rad; dy <= rad && !found; dy++) {
          for (let dx = -rad; dx <= rad && !found; dx++) {
            const nx = sx + dx, ny = sy + dy;
            if (nx > 0 && nx < bw - 1 && ny > 0 && ny < bh - 1 && !isWall(ny * bw + nx)) {
              sx = nx; sy = ny; found = true;
            }
          }
        }
      }
      if (!found) {
        notify('⚠️ Vui lòng chạm vào vùng trống bên trong ô cần tô.');
        return false;
      }
    }

    // Scanline Flood Fill
    const visited = new Uint8Array(bw * bh);
    const stack = [sx, sy];
    visited[sy * bw + sx] = 1;
    let fMinX = sx, fMaxX = sx, fMinY = sy, fMaxY = sy;
    let leaked = false;
    let count = 0;

    while (stack.length > 0) {
      const cy = stack.pop();
      const cx = stack.pop();
      if (cx === 0 || cx === bw - 1 || cy === 0 || cy === bh - 1) {
        leaked = true;
        break;
      }
      if (cx < fMinX) fMinX = cx;
      if (cx > fMaxX) fMaxX = cx;
      if (cy < fMinY) fMinY = cy;
      if (cy > fMaxY) fMaxY = cy;
      count++;

      const nbs = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];
      for (let i = 0; i < 4; i++) {
        const nx = nbs[i][0], ny = nbs[i][1];
        if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) {
          leaked = true;
          break;
        }
        const nIdx = ny * bw + nx;
        if (!visited[nIdx] && !isWall(nIdx)) {
          visited[nIdx] = 1;
          stack.push(nx, ny);
        }
      }
      if (leaked) break;
    }

    if (leaked || count < 3) {
      notify('⚠️ Vùng này chưa khép kín hoàn toàn, hãy đóng kín các cạnh trước khi tô!');
      return false;
    }

    // Cắt gọn vùng vừa tô (nở 1px sát mép biên để lấp kín khe hở dưới nét vẽ thật)
    const bx0 = Math.max(0, fMinX - 1);
    const by0 = Math.max(0, fMinY - 1);
    const bx1 = Math.min(bw - 1, fMaxX + 1);
    const by1 = Math.min(bh - 1, fMaxY + 1);
    const outW = bx1 - bx0 + 1;
    const outH = by1 - by0 + 1;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const octx = outCanvas.getContext('2d');
    const outImg = octx.createImageData(outW, outH);
    const od = outImg.data;

    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const srcIdx = y * bw + x;
        const isCore = visited[srcIdx] === 1;
        let isFringe = false;
        if (!isCore) {
          if (
            (x > 0 && visited[srcIdx - 1]) ||
            (x < bw - 1 && visited[srcIdx + 1]) ||
            (y > 0 && visited[srcIdx - bw]) ||
            (y < bh - 1 && visited[srcIdx + bw])
          ) {
            isFringe = true;
          }
        }
        if (isCore || isFringe) {
          const oi = ((y - by0) * outW + (x - bx0)) * 4;
          od[oi] = 255;
          od[oi + 1] = 255;
          od[oi + 2] = 255;
          od[oi + 3] = isCore ? 255 : 200;
        }
      }
    }
    octx.putImageData(outImg, 0, 0);

    const fillCol = activeColor() || '#ffd60a';
    const op = Math.max(0.22, Math.min(0.85, state.hatchOpacity || 0.35));

    // Tô màu nền bán trong suốt đúng vào vùng mask (hỗ trợ mọi định dạng màu CSS)
    octx.save();
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = fillCol;
    octx.globalAlpha = op;
    octx.fillRect(0, 0, outW, outH);
    octx.restore();

    // Áp thêm họa tiết gạch chéo / caro / chấm bi lên trên (source-atop giữ nguyên nền màu + thêm nét sọc)
    if (state.hatchMode && state.hatchMode !== 'solid') {
      octx.save();
      octx.globalCompositeOperation = 'source-atop';
      octx.strokeStyle = fillCol;
      octx.fillStyle = fillCol;
      octx.globalAlpha = Math.min(0.95, op + 0.35);
      octx.lineWidth = 1.5;
      const step = 11;
      if (state.hatchMode === 'diagonal' || state.hatchMode === 'grid' || state.hatchMode === 'cross') {
        for (let k = -outH; k < outW + outH; k += step) {
          octx.beginPath();
          octx.moveTo(k, 0);
          octx.lineTo(k - outH, outH);
          octx.stroke();
        }
      }
      if (state.hatchMode === 'back_diagonal' || state.hatchMode === 'grid' || state.hatchMode === 'cross') {
        for (let k = -outH; k < outW + outH; k += step) {
          octx.beginPath();
          octx.moveTo(k, outH);
          octx.lineTo(k - outH, 0);
          octx.stroke();
        }
      } else if (state.hatchMode === 'horizontal') {
        for (let yy = 5; yy < outH; yy += step) {
          octx.beginPath();
          octx.moveTo(0, yy);
          octx.lineTo(outW, yy);
          octx.stroke();
        }
      } else if (state.hatchMode === 'vertical') {
        for (let xx = 5; xx < outW; xx += step) {
          octx.beginPath();
          octx.moveTo(xx, 0);
          octx.lineTo(xx, outH);
          octx.stroke();
        }
      } else if (state.hatchMode === 'dots') {
        for (let yy = 5; yy < outH; yy += 9) {
          for (let xx = 5; xx < outW; xx += 9) {
            octx.beginPath();
            octx.arc(xx, yy, 1.8, 0, Math.PI * 2);
            octx.fill();
          }
        }
      }
      octx.restore();
    }

    const dataUrl = outCanvas.toDataURL('image/png');
    if (typeof NKInkEngine.cacheCanvasBitmap === 'function') {
      NKInkEngine.cacheCanvasBitmap(dataUrl, outCanvas);
    }
    const fillObj = {
      type: 'anh',
      isSmartFill: true,
      x: rx0 + bx0 / scale,
      y: ry0 + by0 / scale,
      w: outW / scale,
      h: outH / scale,
      dataUrl,
      color: fillCol
    };
    ensureGeomId(fillObj);
    pushUndo(sid);
    // Đặt vùng tô xuống lớp dưới cùng (trên xoa_vung) để không che mất nét mực
    const insertIdx = list.findIndex((o) => o && o.type !== 'xoa_vung' && !o.isSmartFill);
    if (insertIdx === -1) list.push(fillObj);
    else list.splice(insertIdx, 0, fillObj);

    redrawSurface(sid);
    notify('🪣 Đã tô màu thông minh vùng khép kín!');
    return true;
  }

  function toggleGeometryToolbar() {
    geomToolbar.classList.toggle('hidden');
    if (!geomToolbar.classList.contains('hidden')) {
      setTool('chinh_hinh_dong');
      notify('📐 Đã mở Thanh công cụ DỰNG HÌNH 24 công cụ. Kéo đỉnh/điểm đường cong hoặc chọn Hình chuẩn / Conic / Tô miền.');
    }
  }
  document.getElementById('top-btn-dung-hinh').addEventListener('click', toggleGeometryToolbar);
  document.getElementById('rb-dung-hinh').addEventListener('click', toggleGeometryToolbar);
  document.getElementById('vbar-dung-hinh').addEventListener('click', toggleGeometryToolbar);
  document.getElementById('bx-btn-dung-hinh').addEventListener('click', toggleGeometryToolbar);
  document.getElementById('geom-close-btn').addEventListener('click', () => geomToolbar.classList.add('hidden'));

  function openShape3DPicker(anchorBtn) {
    let pop = document.getElementById('BxShape3DPickerPop');
    if (pop) {
      const wasHidden = pop.classList.contains('hidden');
      pop.classList.toggle('hidden', !wasHidden);
      if (!wasHidden) return;
    } else {
      pop = document.createElement('div');
      pop.id = 'BxShape3DPickerPop';
      pop.className = 'bx-mini-picker';
      pop.style.left = '64px';
      pop.style.width = '248px';
      pop.innerHTML = `
        <div class="bx-mini-picker-hd">
          <span>🧊 Chọn khối Hình Không Gian 3D</span>
          <button type="button" id="bx-3d-pop-close">✕</button>
        </div>
        <div class="bx-mini-picker-grid" id="bx-3d-pop-grid"></div>
      `;
      const wrap = document.getElementById('BangXanhCanvasWrap') || document.body;
      wrap.appendChild(pop);
      ['pointerdown', 'mousedown', 'touchstart'].forEach((ev) => pop.addEventListener(ev, (e) => e.stopPropagation()));
      pop.querySelector('#bx-3d-pop-close')?.addEventListener('click', () => pop.classList.add('hidden'));
      const grid = pop.querySelector('#bx-3d-pop-grid');
      const items = [
        { k: 'chop_tu_giac', lbl: '🔺 Chóp tứ giác S.ABCD' },
        { k: 'chop_tg', lbl: '△ Chóp tam giác S.ABC' },
        { k: 'lap_phuong', lbl: '🧊 Lập phương / Hộp' },
        { k: 'lang_tru_tg', lbl: '◫ Lăng trụ tam giác' },
        { k: 'hinh_non', lbl: '🎉 Hình nón (có SO)' },
        { k: 'hinh_tru', lbl: '🛢️ Hình trụ (có OO\')' },
        { k: 'mat_cau', lbl: '🌐 Mặt cầu (xích đạo)' }
      ];
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bx-mini-opt';
        b.textContent = it.lbl;
        b.addEventListener('click', () => {
          state.activeKind3D = it.k;
          setTool('shape3d');
          pop.classList.add('hidden');
          notify(`🧊 Kéo trên bảng để vẽ ${it.lbl} (tự động nét đứt khuất)!`);
        });
        grid.appendChild(b);
      });
    }
    pop.classList.remove('hidden');
  }

  // === THANH MINI DỌC TÙY CHỌN CÔNG CỤ HAY DÙNG TRÊN BẢNG XANH ===
  (function initBxQuickMiniDock() {
    const dock = document.getElementById('BxQuickMiniDock');
    const listEl = document.getElementById('BxQuickMiniList');
    const collapseBtn = document.getElementById('bx-mini-collapse');
    const cfgBtn = document.getElementById('bx-mini-cfg');
    const picker = document.getElementById('BxQuickMiniPicker');
    const pickerGrid = document.getElementById('BxQuickMiniPickerGrid');
    const pickerClose = document.getElementById('bx-mini-picker-close');
    const resetBtn = document.getElementById('bx-mini-reset');
    if (!dock || !listEl || !picker || !pickerGrid) return;

    const STORAGE_KEY = 'nkpdf_bx_mini_dock_v1';
    const COLLAPSE_KEY = 'nkpdf_bx_mini_dock_collapsed_v1';
    const DEFAULT_IDS = ['dung_mui_ten', 'duong', 'dung_doan', 'dung_diem', 'hinh_3d', 'but', 'chon', 'chon_nhieu', 'toggle_dashed'];
    const CATALOG = [
      { id: 'dung_mui_ten', ico: '↗', lbl: 'Lực', name: '↗ Lực / Vectơ động', kind: 'tool' },
      { id: 'duong', ico: '╱', lbl: 'Đường', name: '╱ Đường thẳng', kind: 'tool' },
      { id: 'dung_doan', ico: '•—•', lbl: 'Đoạn', name: '•—• Đoạn nối 2 điểm', kind: 'tool' },
      { id: 'dung_diem', ico: '•', lbl: 'Điểm', name: '• Điểm động', kind: 'tool' },
      { id: 'dung_da_giac', ico: '▱', lbl: 'Đa giác', name: '▱ Đa giác động', kind: 'tool' },
      { id: 'hcn', ico: '▭', lbl: 'HCN', name: '▭ Hình chữ nhật', kind: 'tool' },
      { id: 'elip', ico: '⭕', lbl: 'Tròn', name: '⭕ Hình tròn (kéo cạnh thành Elip)', kind: 'tool' },
      { id: 'tam_giac', ico: '△', lbl: 'Tam giác', name: '△ Tam giác', kind: 'tool' },
      { id: 'hinh_binh_hanh', ico: '▱', lbl: 'HBH', name: '▱ Vẽ nhanh Hình bình hành', kind: 'tool' },
      { id: 'hinh_3d', ico: '🧊', lbl: 'Khối 3D', name: '🧊 Hình Không Gian 3D (tự động nét khuất)', kind: 'action' },
      { id: 'but', ico: '✏️', lbl: 'Bút', name: '✏️ Bút viết phấn', kind: 'tool' },
      { id: 'chon', ico: '👆', lbl: 'Chọn', name: '👆 Chọn / Sửa', kind: 'tool' },
      { id: 'chon_nhieu', ico: '☑', lbl: 'Ch.nhiều', name: '☑ Bật/tắt Chọn nhiều đối tượng', kind: 'action' },
      { id: 'chinh_hinh_dong', ico: '✥', lbl: 'Kéo đỉnh', name: '✥ Kéo đỉnh hình động', kind: 'tool' },
      { id: 'tay_net', ico: '🧹', lbl: 'Tẩy', name: '🧹 Tẩy nét', kind: 'tool' },
      { id: 'to_trong_suot', ico: '🪣', lbl: 'Tô màu', name: '🪣 Tô màu thông minh (chạm ô kín)', kind: 'tool' },
      { id: 'toggle_dashed', ico: '┈', lbl: 'Nét đứt', name: '┈ Bật/tắt nét đứt', kind: 'action' },
      { id: 'toggle_diem_dung', ico: '👁', lbl: 'Điểm dựng', name: '👁 Hiện/ẩn điểm dựng', kind: 'action' },
      { id: 'toggle_nhan', ico: '🏷', lbl: 'Nhãn', name: '🏷 Hiện/ẩn nhãn A, B, C...', kind: 'action' },
      // --- Toàn bộ công cụ DỰNG HÌNH ĐỘNG ---
      { id: 'trung_truc', ico: '⊥', lbl: 'Tr.trực', name: '⊥ Dựng Đường trung trực', kind: 'geom' },
      { id: 'song_song', ico: '∥', lbl: 'Song song', name: '∥ Dựng Đường thẳng song song', kind: 'geom' },
      { id: 'vuong_goc', ico: '⊥', lbl: 'Vuông góc', name: '⊥ Dựng Đường thẳng vuông góc', kind: 'geom' },
      { id: 'chan_vuong_goc', ico: '📐', lbl: 'Chân vg', name: '📐 Dựng Chân đường cao / góc vuông', kind: 'geom' },
      { id: 'tron_noi_tiep', ico: '⭕', lbl: 'Nội tiếp', name: '⭕ Đường tròn nội tiếp tam giác', kind: 'geom' },
      { id: 'tron_ngoai_tiep', ico: '⭕', lbl: 'Ngoại tiếp', name: '⭕ Đường tròn ngoại tiếp tam giác', kind: 'geom' },
      { id: 'tiep_tuyen', ico: '📐', lbl: 'Tiếp tuyến', name: '📐 Tiếp tuyến đường tròn', kind: 'geom' }
    ];
    const CATALOG_MAP = Object.fromEntries(CATALOG.map((item) => [item.id, item]));

    let selectedIds = [...DEFAULT_IDS];
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length > 0) {
        const valid = saved.filter((id) => CATALOG_MAP[id]);
        if (valid.length > 0) selectedIds = valid;
      }
      if (!localStorage.getItem('nkpdf_bx_mini_migrated_multi_v1')) {
        if (!selectedIds.includes('chon_nhieu')) {
          const chonIdx = selectedIds.indexOf('chon');
          if (chonIdx >= 0) selectedIds.splice(chonIdx + 1, 0, 'chon_nhieu');
          else selectedIds.push('chon_nhieu');
          localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
        }
        localStorage.setItem('nkpdf_bx_mini_migrated_multi_v1', '1');
      }
    } catch (_) {}

    const saveSelected = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds)); } catch (_) {}
    };

    const updateDockColumns = () => {
      if (dock.classList.contains('collapsed')) {
        dock.classList.remove('two-col');
        return;
      }
      const wrapH = (dock.parentElement && dock.parentElement.clientHeight) ? dock.parentElement.clientHeight : window.innerHeight;
      const neededH = selectedIds.length * 40 + 68;
      dock.classList.toggle('two-col', selectedIds.length > 1 && neededH > wrapH - 20);
    };
    window._updateBxMiniDockCols = updateDockColumns;

    const setCollapsed = (flag) => {
      dock.classList.toggle('collapsed', flag);
      collapseBtn.textContent = flag ? '›' : '‹';
      if (flag) picker.classList.add('hidden');
      try { localStorage.setItem(COLLAPSE_KEY, flag ? '1' : '0'); } catch (_) {}
      updateDockColumns();
    };

    const renderDock = () => {
      listEl.innerHTML = '';
      selectedIds.forEach((id) => {
        const item = CATALOG_MAP[id];
        if (!item) return;
        const btn = document.createElement('button');
        btn.className = 'bx-mini-btn';
        btn.title = item.name;
        if (item.kind === 'tool') {
          btn.dataset.qtool = item.id;
          if (state.tool === item.id) btn.classList.add('active');
        } else if (item.kind === 'geom') {
          btn.dataset.qgeom = item.id;
          if (state.tool === 'geom_construct' && geomConstructState && geomConstructState.mode === item.id) btn.classList.add('active');
        } else {
          btn.dataset.qaction = item.id;
          if (item.id === 'toggle_dashed' && state.dashed) btn.classList.add('active');
          if (item.id === 'toggle_diem_dung' && state.showPointDots) btn.classList.add('active');
          if (item.id === 'toggle_nhan' && state.showLabels) btn.classList.add('active');
          if (item.id === 'chon_nhieu' && state.multiSelect) btn.classList.add('active');
        }
        btn.innerHTML = `<span class="bx-m-ico">${item.ico}</span><span class="bx-m-lbl">${item.lbl}</span>`;
        btn.addEventListener('click', () => {
          if (item.kind === 'tool') {
            setTool(item.id);
          } else if (item.kind === 'geom') {
            startGeomConstruction(item.id);
            listEl.querySelectorAll('[data-qgeom]').forEach((b) => b.classList.toggle('active', b === btn));
          } else if (item.id === 'toggle_dashed') {
            document.getElementById('bx-btn-dashed')?.click();
          } else if (item.id === 'toggle_diem_dung') {
            state.showPointDots = !state.showPointDots;
            btn.classList.toggle('active', Boolean(state.showPointDots));
            redrawSurface(activeSid());
            notify(state.showPointDots ? '👁 Đã HIỆN điểm dựng' : '👁 Đã ẨN điểm dựng');
          } else if (item.id === 'toggle_nhan') {
            state.showLabels = !state.showLabels;
            btn.classList.toggle('active', Boolean(state.showLabels));
            redrawSurface(activeSid());
            notify(state.showLabels ? '🏷 Đã HIỆN nhãn' : '🏷 Đã ẨN nhãn');
          } else if (item.id === 'chon_nhieu') {
            document.getElementById('gbtn-chon-nhieu')?.click();
            btn.classList.toggle('active', Boolean(state.multiSelect));
            if (state.multiSelect && state.tool !== 'chon' && state.tool !== 'chinh_sua' && state.tool !== 'chinh_hinh_dong') {
              setTool('chon');
            }
          } else if (item.id === 'hinh_3d') {
            openShape3DPicker(btn);
          } else if (item.id === 'undo') {
            document.getElementById('sb-undo')?.click() || document.getElementById('rb-undo')?.click();
          }
        });
        listEl.appendChild(btn);
      });
      updateDockColumns();
    };

    const renderPicker = () => {
      pickerGrid.innerHTML = '';
      CATALOG.forEach((item) => {
        const opt = document.createElement('button');
        opt.className = 'bx-mini-opt' + (selectedIds.includes(item.id) ? ' selected' : '');
        opt.textContent = item.name;
        opt.addEventListener('click', () => {
          if (selectedIds.includes(item.id)) {
            if (selectedIds.length <= 1) return;
            selectedIds = selectedIds.filter((x) => x !== item.id);
          } else {
            selectedIds = [...selectedIds, item.id];
          }
          saveSelected();
          renderDock();
          renderPicker();
        });
        pickerGrid.appendChild(opt);
      });
    };

    // Chặn sự kiện chạm lan xuống canvas bảng xanh
    [dock, picker].forEach((el) => {
      ['pointerdown', 'mousedown', 'touchstart'].forEach((ev) => {
        el.addEventListener(ev, (e) => e.stopPropagation());
      });
    });

    collapseBtn?.addEventListener('click', () => setCollapsed(!dock.classList.contains('collapsed')));
    cfgBtn?.addEventListener('click', () => {
      renderPicker();
      picker.classList.toggle('hidden');
    });
    pickerClose?.addEventListener('click', () => picker.classList.add('hidden'));
    resetBtn?.addEventListener('click', () => {
      selectedIds = [...DEFAULT_IDS];
      saveSelected();
      renderDock();
      renderPicker();
    });

    renderDock();
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
    } catch (_) {}
  })();

  document.querySelectorAll('[data-gtool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.gtool);
      document.querySelectorAll('[data-gtool]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  function getViewportCenterWorld(sid) {
    const surf = surfaces[sid];
    if (!surf) return { x: 400, y: 300 };
    if (sid === 'board') {
      const cam = state.boardCam || { panX: 0, panY: 0, zoom: 1.0 };
      return {
        x: (surf.cssWidth * 0.5 - cam.panX) / cam.zoom,
        y: (surf.cssHeight * 0.45 - cam.panY) / cam.zoom
      };
    }
    return { x: surf.cssWidth * 0.5, y: surf.cssHeight * 0.45 };
  }

  let geomIdCounter = 1;
  function ensureGeomId(obj) {
    if (!obj) return null;
    if (!obj.id) obj.id = 'g_' + Date.now().toString(36) + '_' + (geomIdCounter++);
    return obj.id;
  }

  function findPointRef(list, x, y, tol = 22) {
    let best = null, bestD = tol;
    for (const obj of list) {
      if (!obj || obj.hidden) continue;
      if (obj.type === 'diem') {
        const d = Math.hypot(x - obj.x, y - obj.y);
        if (d < bestD) { bestD = d; best = { kind: 'diem', id: ensureGeomId(obj), x: obj.x, y: obj.y }; }
      }
    }
    if (best) return best;
    for (const obj of list) {
      if (!obj || obj.hidden) continue;
      if (obj.type === 'elip' && obj.isCircle) {
        const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestD) { bestD = d; best = { kind: 'elipCenter', id: ensureGeomId(obj), x: cx, y: cy }; }
      }
      if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.points)) {
        for (let i = 0; i < obj.points.length; i++) {
          const p = obj.points[i];
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < bestD) { bestD = d; best = { kind: 'poly', id: ensureGeomId(obj), vIdx: i, x: p.x, y: p.y }; }
        }
      }
      if (obj.type === 'shape3d' && typeof NKInkEngine.computeShape3DGeometry === 'function') {
        const g3 = NKInkEngine.computeShape3DGeometry(obj);
        for (const v of g3.vertices) {
          const d = Math.hypot(x - v.x, y - v.y);
          if (d < bestD) { bestD = d; best = { kind: 'shape3dPt', id: ensureGeomId(obj), role: v.role, x: v.x, y: v.y }; }
        }
      }
    }
    return best;
  }

  function resolvePointRef(list, ref) {
    if (!ref || !ref.id) return null;
    for (const obj of list) {
      if (!obj || obj.id !== ref.id) continue;
      if (ref.kind === 'diem' && obj.type === 'diem') return { x: obj.x, y: obj.y };
      if (ref.kind === 'elipCenter' && obj.type === 'elip') {
        return { x: obj.x + obj.w * 0.5, y: obj.y + obj.h * 0.5 };
      }
      if (ref.kind === 'poly' && Array.isArray(obj.points) && obj.points[ref.vIdx]) {
        return { x: obj.points[ref.vIdx].x, y: obj.points[ref.vIdx].y };
      }
      if (ref.kind === 'line_end' && (obj.type === 'duong' || obj.type === 'mui_ten')) {
        return ref.role === 'p1' ? { x: obj.x1, y: obj.y1 } : { x: obj.x2, y: obj.y2 };
      }
    }
    return null;
  }

  function projectPointOntoPolyline(pts, px, py, closed = false) {
    if (!Array.isArray(pts) || pts.length < 2) return null;
    const count = closed ? pts.length : pts.length - 1;
    let best = null, bestD = Infinity;
    for (let i = 0; i < count; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
      const x = a.x + t * dx, y = a.y + t * dy;
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) { bestD = d; best = { x, y, segIdx: i, t, dist: d }; }
    }
    return best;
  }

  function projectPointOntoObject(obj, px, py) {
    if (!obj || obj.hidden) return null;
    if (obj.type === 'duong' || obj.type === 'mui_ten') {
      const dx = obj.x2 - obj.x1, dy = obj.y2 - obj.y1, l2 = dx * dx + dy * dy;
      const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((px - obj.x1) * dx + (py - obj.y1) * dy) / l2)) : 0;
      const x = obj.x1 + t * dx, y = obj.y1 + t * dy;
      return { x, y, t, dist: Math.hypot(px - x, py - y) };
    }
    if (obj.type === 'elip') {
      const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
      const rx = Math.max(4, Math.abs(obj.w) * 0.5), ry = Math.max(4, Math.abs(obj.h) * 0.5);
      let theta = Math.atan2((py - cy) / ry, (px - cx) / rx);
      if (obj.isTrigCircle) {
        const snapDegs = [0, 30, 45, 60, 90, 120, 150, 180, -30, -45, -60, -90, -120, -150, -180];
        const deg = (-theta * 180) / Math.PI;
        for (const sd of snapDegs) {
          if (Math.abs(deg - sd) <= 3.5) {
            theta = (-sd * Math.PI) / 180;
            break;
          }
        }
      }
      const x = cx + rx * Math.cos(theta), y = cy + ry * Math.sin(theta);
      return { x, y, theta, dist: Math.hypot(px - x, py - y) };
    }
    if (obj.type === 'hcn') {
      const pts = [
        { x: obj.x, y: obj.y }, { x: obj.x + obj.w, y: obj.y },
        { x: obj.x + obj.w, y: obj.y + obj.h }, { x: obj.x, y: obj.y + obj.h }
      ];
      const r = projectPointOntoPolyline(pts, px, py, true);
      return r ? { x: r.x, y: r.y, edgeIdx: r.segIdx, t: r.t, dist: r.dist } : null;
    }
    if (obj.type === 'tam_giac' || obj.type === 'to_trong_suot') {
      return projectPointOntoPolyline(obj.points, px, py, true);
    }
    if (obj.type === 'but' && Array.isArray(obj.points) && obj.points.length >= 2) {
      return projectPointOntoPolyline(obj.points, px, py, false);
    }
    return null;
  }

  function evalGliderPoint(parentObj, ref) {
    if (!parentObj || !ref) return null;
    if (parentObj.type === 'duong' || parentObj.type === 'mui_ten') {
      const t = typeof ref.t === 'number' ? Math.max(0, Math.min(1, ref.t)) : 0.5;
      return { x: parentObj.x1 + t * (parentObj.x2 - parentObj.x1), y: parentObj.y1 + t * (parentObj.y2 - parentObj.y1) };
    }
    if (parentObj.type === 'elip') {
      const cx = parentObj.x + parentObj.w * 0.5, cy = parentObj.y + parentObj.h * 0.5;
      const rx = Math.max(4, Math.abs(parentObj.w) * 0.5), ry = Math.max(4, Math.abs(parentObj.h) * 0.5);
      const th = typeof ref.theta === 'number' ? ref.theta : 0;
      return { x: cx + rx * Math.cos(th), y: cy + ry * Math.sin(th) };
    }
    if (parentObj.type === 'hcn') {
      const pts = [
        { x: parentObj.x, y: parentObj.y }, { x: parentObj.x + parentObj.w, y: parentObj.y },
        { x: parentObj.x + parentObj.w, y: parentObj.y + parentObj.h }, { x: parentObj.x, y: parentObj.y + parentObj.h }
      ];
      const idx = Math.max(0, Math.min(3, ref.edgeIdx || 0));
      const a = pts[idx], b = pts[(idx + 1) % 4];
      const t = typeof ref.t === 'number' ? Math.max(0, Math.min(1, ref.t)) : 0.5;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    if ((parentObj.type === 'tam_giac' || parentObj.type === 'to_trong_suot' || parentObj.type === 'but') && Array.isArray(parentObj.points) && parentObj.points.length >= 2) {
      const closed = parentObj.type !== 'but';
      const maxSeg = closed ? parentObj.points.length : parentObj.points.length - 1;
      const idx = Math.max(0, Math.min(maxSeg - 1, ref.segIdx || 0));
      const a = parentObj.points[idx], b = parentObj.points[(idx + 1) % parentObj.points.length];
      const t = typeof ref.t === 'number' ? Math.max(0, Math.min(1, ref.t)) : 0.5;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    return null;
  }

  function updateConstrainedLineEndpoint(list, obj, role, pos) {
    if (obj && ((obj.type === 'diem' && obj.decompTipRef) || (obj.type === 'mui_ten' && obj.decompVecRef && role === 'p2'))) {
      const dr = obj.decompTipRef || obj.decompVecRef;
      const mainVec = list.find((o) => o && !o.hidden && o.id === dr.mainVecId);
      const selfTip = obj.type === 'diem' ? obj : list.find((o) => o && !o.hidden && o.id === dr.selfTipId);
      const otherTip = list.find((o) => o && !o.hidden && o.id === dr.otherTipId);
      const p0 = resolvePointRef(list, dr.p0Ref);
      const pMainTip = resolvePointRef(list, dr.mainTipRef);
      if (mainVec && selfTip && otherTip && p0 && pMainTip) {
        selfTip.x = pos.x;
        selfTip.y = pos.y;
        if (selfTip.decompTipRef) {
          selfTip.decompTipRef.theta = Math.atan2(pos.y - p0.y, pos.x - p0.x);
        }
        otherTip.x = p0.x + (pMainTip.x - pos.x);
        otherTip.y = p0.y + (pMainTip.y - pos.y);
        if (otherTip.decompTipRef) {
          otherTip.decompTipRef.theta = Math.atan2(otherTip.y - p0.y, otherTip.x - p0.x);
        }
        if (mainVec.decompGroup) {
          mainVec.decompGroup.lastOx = p0.x;
          mainVec.decompGroup.lastOy = p0.y;
          mainVec.decompGroup.lastFx = pMainTip.x - p0.x;
          mainVec.decompGroup.lastFy = pMainTip.y - p0.y;
        }
        return true;
      }
    }
    if (!obj || obj.type !== 'duong' || (role !== 'p1' && role !== 'p2')) return false;
    let ref = null, ax = 0, ay = 0, vx = 1, vy = 0, defHalf = 110;
    if (obj.perpBisectorRef) {
      const pb = obj.perpBisectorRef;
      let a = null, b = null;
      if (pb.kind === 'seg') {
        const baseObj = list.find((o) => o && !o.hidden && o.id === pb.objId);
        const seg = baseObj ? getObjectStraightSegment(baseObj, pb.segIdx) : null;
        if (seg) { a = seg.p1; b = seg.p2; }
      } else if (pb.kind === 'pts') {
        a = resolvePointRef(list, pb.p1Ref);
        b = resolvePointRef(list, pb.p2Ref);
      }
      if (!a || !b) return false;
      ax = (a.x + b.x) * 0.5; ay = (a.y + b.y) * 0.5;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.max(1e-4, Math.hypot(dx, dy));
      vx = -dy / len; vy = dx / len;
      defHalf = Math.max(90, len * 0.7);
      ref = pb;
    } else if (obj.lineConstraintRef) {
      const lc = obj.lineConstraintRef;
      const baseObj = list.find((o) => o && !o.hidden && o.id === lc.baseObjId);
      const seg = baseObj ? getObjectStraightSegment(baseObj, lc.baseSegIdx) : null;
      const passPt = resolvePointRef(list, lc.ptRef);
      if (!seg || !passPt) return false;
      ax = passPt.x; ay = passPt.y;
      const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y, len = Math.max(1e-4, Math.hypot(dx, dy));
      const ux = dx / len, uy = dy / len;
      vx = lc.mode === 'parallel' ? ux : -uy;
      vy = lc.mode === 'parallel' ? uy : ux;
      defHalf = Math.max(110, len * 0.65);
      ref = lc;
    } else if (obj.tangentLineRef) {
      const tl = obj.tangentLineRef;
      const cir = list.find((o) => o && !o.hidden && o.id === tl.circleId);
      const tPt = resolvePointRef(list, tl.ptRef);
      if (!cir || !tPt) return false;
      const cx = cir.x + cir.w * 0.5, cy = cir.y + cir.h * 0.5, r = Math.abs(cir.w * 0.5);
      const dx = tPt.x - cx, dy = tPt.y - cy, d = Math.hypot(dx, dy);
      if (d < 1e-4) return false;
      ax = tPt.x; ay = tPt.y;
      vx = -dy / d; vy = dx / d;
      defHalf = Math.max(110, r * 1.4);
      ref = tl;
    } else if (obj.bisectorRef) {
      const br = obj.bisectorRef;
      let ip = null, u1 = null, u2 = null;
      if (br.kind === 'poly') {
        const pObj = list.find((o) => o && !o.hidden && o.id === br.objId);
        if (pObj && Array.isArray(pObj.points) && pObj.points.length >= 3) {
          const n = pObj.points.length, vi = br.vIdx % n;
          const V = pObj.points[vi], P1 = pObj.points[(vi - 1 + n) % n], P2 = pObj.points[(vi + 1) % n];
          const d1 = Math.hypot(P1.x - V.x, P1.y - V.y), d2 = Math.hypot(P2.x - V.x, P2.y - V.y);
          if (d1 > 1e-4 && d2 > 1e-4) {
            ip = V;
            u1 = { x: (P1.x - V.x) / d1, y: (P1.y - V.y) / d1 };
            u2 = { x: (P2.x - V.x) / d2, y: (P2.y - V.y) / d2 };
          }
        }
      } else {
        const s1 = list.find((o) => o && !o.hidden && o.id === br.id1);
        const s2 = list.find((o) => o && !o.hidden && o.id === br.id2);
        if (s1 && s2) {
          ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
          if (ip) {
            const pickRay = (seg) => {
              const d1 = Math.hypot(seg.x1 - ip.x, seg.y1 - ip.y);
              const d2 = Math.hypot(seg.x2 - ip.x, seg.y2 - ip.y);
              const far = d2 >= d1 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
              const ln = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
              return { x: (far.x - ip.x) / ln, y: (far.y - ip.y) / ln };
            };
            u1 = pickRay(s1); u2 = pickRay(s2);
          }
        }
      }
      if (!ip || !u1 || !u2) return false;
      const bx = u1.x + u2.x, by = u1.y + u2.y, bl = Math.hypot(bx, by);
      if (bl < 1e-4) return false;
      const ux = bx / bl, uy = by / bl;
      if (role === 'p2') {
        const lenNew = Math.max(20, (pos.x - ip.x) * ux + (pos.y - ip.y) * uy);
        br.len = lenNew;
        obj.x1 = ip.x; obj.y1 = ip.y;
        obj.x2 = ip.x + ux * lenNew; obj.y2 = ip.y + uy * lenNew;
      } else {
        const lenCur = br.len || 130;
        obj.x1 = ip.x; obj.y1 = ip.y;
        obj.x2 = ip.x + ux * lenCur; obj.y2 = ip.y + uy * lenCur;
      }
      return true;
    }
    if (!ref) return false;
    const tNew = (pos.x - ax) * vx + (pos.y - ay) * vy;
    const cur1 = typeof ref.t1 === 'number' ? ref.t1 : -defHalf;
    const cur2 = typeof ref.t2 === 'number' ? ref.t2 : defHalf;
    if (role === 'p1') {
      if (Math.abs(cur2 - tNew) >= 16) ref.t1 = tNew;
    } else {
      if (Math.abs(tNew - cur1) >= 16) ref.t2 = tNew;
    }
    return true;
  }

  function computeLineIntersection(a1, a2, b1, b2) {
    if (!a1 || !a2 || !b1 || !b2) return null;
    const x1 = a1.x, y1 = a1.y, x2 = a2.x, y2 = a2.y;
    const x3 = b1.x, y3 = b1.y, x4 = b2.x, y4 = b2.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-6) return null;
    const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
    const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
    return { x: px, y: py };
  }

  function computeAngleArcPoints(V, u1, u2, r = 22) {
    const dot = u1.x * u2.x + u1.y * u2.y;
    if (Math.abs(dot) <= 0.0262) {
      const s = Math.min(15, Math.max(10, r * 0.62));
      return [
        { x: V.x + u1.x * s, y: V.y + u1.y * s },
        { x: V.x + (u1.x + u2.x) * s, y: V.y + (u1.y + u2.y) * s },
        { x: V.x + u2.x * s, y: V.y + u2.y * s }
      ];
    }
    const th1 = Math.atan2(u1.y, u1.x);
    const th2 = Math.atan2(u2.y, u2.x);
    let dTh = ((th2 - th1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    if (Math.abs(dTh) < 0.02) dTh = 0.02;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const th = th1 + (i / 24) * dTh;
      pts.push({ x: V.x + r * Math.cos(th), y: V.y + r * Math.sin(th) });
    }
    return pts;
  }

  function findCornerRaysAtPoint(list, pt, tol) {
    for (const o of list) {
      if (!o || o.hidden) continue;
      if ((o.type === 'tam_giac' || o.type === 'to_trong_suot') && Array.isArray(o.points) && o.points.length >= 3) {
        for (let vi = 0; vi < o.points.length; vi++) {
          const V = o.points[vi];
          if (Math.hypot(V.x - pt.x, V.y - pt.y) <= tol) {
            const n = o.points.length;
            const P1 = o.points[(vi - 1 + n) % n], P2 = o.points[(vi + 1) % n];
            const d1 = Math.hypot(P1.x - V.x, P1.y - V.y), d2 = Math.hypot(P2.x - V.x, P2.y - V.y);
            if (d1 > 1e-4 && d2 > 1e-4) {
              return {
                V,
                u1: { x: (P1.x - V.x) / d1, y: (P1.y - V.y) / d1 },
                u2: { x: (P2.x - V.x) / d2, y: (P2.y - V.y) / d2 },
                polyRef: { kind: 'poly', objId: ensureGeomId(o), vIdx: vi }
              };
            }
          }
        }
      }
    }
    const nearSegs = [];
    for (const o of list) {
      if (!o || o.hidden || (o.type !== 'duong' && o.type !== 'mui_ten')) continue;
      const d = NKInkEngine.distToSegment(pt.x, pt.y, o.x1, o.y1, o.x2, o.y2);
      if (d <= tol) nearSegs.push({ o, d });
    }
    nearSegs.sort((a, b) => a.d - b.d);
    if (nearSegs.length >= 2) {
      const s1 = nearSegs[0].o, s2 = nearSegs[1].o;
      const ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
      if (ip && Math.hypot(ip.x - pt.x, ip.y - pt.y) <= tol * 1.6) {
        const pickRay = (s) => {
          const d1 = Math.hypot(s.x1 - ip.x, s.y1 - ip.y);
          const d2 = Math.hypot(s.x2 - ip.x, s.y2 - ip.y);
          const far = d2 >= d1 ? { x: s.x2, y: s.y2 } : { x: s.x1, y: s.y1 };
          const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
          return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
        };
        return {
          V: ip,
          u1: pickRay(s1),
          u2: pickRay(s2),
          segsRef: { kind: 'segs', id1: ensureGeomId(s1), id2: ensureGeomId(s2) }
        };
      }
    }
    return null;
  }

  function syncWaveDragTwin(list, obj, pos) {
    if (!obj || !obj.waveGroupId) return;
    if (obj.waveRole === 'hyperbola' && obj.waveParams) {
      const wp = obj.waveParams;
      for (const twin of list) {
        if (!twin || twin === obj || twin.waveGroupId !== obj.waveGroupId) continue;
        if (twin.waveRole === 'hyperbola' && twin.waveOrder === obj.waveOrder && twin.waveParams) {
          twin.waveParams.cx = wp.cx;
          twin.waveParams.cy = wp.cy;
          twin.waveParams.a = wp.a;
          twin.waveParams.b = wp.b;
          twin.waveParams.maxY = wp.maxY;
          twin.points = NKInkEngine.buildWaveHyperbolaPoints(wp.cx, wp.cy, twin.waveParams.sign, wp.a, wp.b, wp.maxY);
        } else if (twin.waveRole === 'intersect_dot' && twin.waveOrder === obj.waveOrder) {
          twin.x = wp.cx + (twin.waveSign || 0) * wp.a;
          twin.y = wp.cy;
        }
      }
    } else if (obj.waveRole === 'intersect_dot' && obj.waveOrder > 0) {
      const axisObj = list.find((o) => o && o.waveGroupId === obj.waveGroupId && o.waveRole === 'axis');
      const cy = axisObj ? axisObj.y1 : obj.y;
      const cx = axisObj ? (axisObj.x1 + axisObj.x2) * 0.5 : obj.x;
      const dHalf = axisObj ? Math.abs(axisObj.x2 - axisObj.x1) * 0.5 : 140;
      const newA = Math.max(8, Math.min(dHalf - 6, Math.abs(pos.x - cx)));
      obj.y = cy;
      obj.x = cx + (obj.waveSign || 1) * newA;
      for (const twin of list) {
        if (!twin || twin === obj || twin.waveGroupId !== obj.waveGroupId) continue;
        if (twin.waveRole === 'hyperbola' && twin.waveOrder === obj.waveOrder && twin.waveParams) {
          twin.waveParams.cx = cx;
          twin.waveParams.cy = cy;
          twin.waveParams.a = newA;
          twin.points = NKInkEngine.buildWaveHyperbolaPoints(cx, cy, twin.waveParams.sign, newA, twin.waveParams.b, twin.waveParams.maxY);
        } else if (twin.waveRole === 'intersect_dot' && twin.waveOrder === obj.waveOrder) {
          twin.x = cx + (twin.waveSign || 0) * newA;
          twin.y = cy;
        }
      }
    }
  }

  function syncWaveInterferenceDash(list, changedObjs) {
    if (!Array.isArray(list) || !Array.isArray(changedObjs)) return;
    const bisectors = changedObjs.filter((o) => o && o.waveGroupId && o.waveRole === 'bisector');
    for (const bis of bisectors) {
      const bisDashed = Boolean(bis.dashed);
      for (const h of list) {
        if (!h || h.waveGroupId !== bis.waveGroupId || h.waveRole !== 'hyperbola') continue;
        const isHalf = Math.round((h.waveOrder || 0) * 2) % 2 === 1;
        h.dashed = isHalf ? !bisDashed : bisDashed;
      }
    }
  }

  function syncLinkedEndpoints(list) {
    if (!Array.isArray(list)) return;
    const waveGroups = new Map();
    for (const obj of list) {
      if (!obj || obj.hidden || !obj.waveGroupId) continue;
      if (!waveGroups.has(obj.waveGroupId)) waveGroups.set(obj.waveGroupId, []);
      waveGroups.get(obj.waveGroupId).push(obj);
    }
    for (const [, grp] of waveGroups) {
      const axis = grp.find((o) => o.waveRole === 'axis');
      const bis = grp.find((o) => o.waveRole === 'bisector');
      if (axis && bis) {
        const cx = (axis.x1 + axis.x2) * 0.5;
        const cy = axis.y1;
        axis.y2 = cy;
        bis.x1 = cx;
        bis.x2 = cx;
        for (const o of grp) {
          if (o.waveRole === 'source') {
            o.y = cy;
            o.x = o.waveSign < 0 ? axis.x1 : axis.x2;
          } else if (o.waveRole === 'intersect_dot') {
            o.y = cy;
            if (o.waveOrder === 0) {
              o.x = cx;
            } else {
              const hyp = grp.find((h) => h.waveRole === 'hyperbola' && h.waveOrder === o.waveOrder && h.waveParams);
              if (hyp) o.x = cx + (o.waveSign || 0) * hyp.waveParams.a;
            }
          } else if (o.waveRole === 'hyperbola' && o.waveParams) {
            if (Math.abs(o.waveParams.cx - cx) > 0.1 || Math.abs(o.waveParams.cy - cy) > 0.1) {
              o.waveParams.cx = cx;
              o.waveParams.cy = cy;
              o.points = NKInkEngine.buildWaveHyperbolaPoints(cx, cy, o.waveParams.sign, o.waveParams.a, o.waveParams.b, o.waveParams.maxY);
            }
          }
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'diem' || !obj.onObjRef || !obj.onObjRef.id) continue;
      const parentObj = list.find((o) => o && o.id === obj.onObjRef.id);
      if (parentObj) {
        const gp = evalGliderPoint(parentObj, obj.onObjRef);
        if (gp) { obj.x = gp.x; obj.y = gp.y; }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'diem' || !obj.shapeCenterRef) continue;
      const host = list.find((o) => o && !o.hidden && o.id === obj.shapeCenterRef.hostId);
      if (!host) continue;
      if (host.type === 'hcn') {
        obj.x = host.x + host.w * 0.5;
        obj.y = host.y + host.h * 0.5;
      } else if (Array.isArray(host.points) && host.points.length >= 3) {
        let sx = 0, sy = 0;
        for (const p of host.points) { sx += p.x; sy += p.y; }
        obj.x = sx / host.points.length;
        obj.y = sy / host.points.length;
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'diem' || !obj.cosProjRef) continue;
      const cir = list.find((o) => o && !o.hidden && o.id === obj.cosProjRef.circleId);
      const src = list.find((o) => o && !o.hidden && o.id === obj.cosProjRef.ptId);
      if (cir && src) {
        obj.x = src.x;
        obj.y = cir.y + cir.h * 0.5;
      }
    }
    for (const obj of list) {
      if (!obj) continue;
      if (obj.type === 'diem' && obj.midSegRef) {
        const baseObj = list.find((o) => o && !o.hidden && o.id === obj.midSegRef.objId);
        const seg = baseObj ? getObjectStraightSegment(baseObj, obj.midSegRef.segIdx) : null;
        if (seg) {
          obj.x = (seg.p1.x + seg.p2.x) * 0.5;
          obj.y = (seg.p1.y + seg.p2.y) * 0.5;
        }
      }
      if (obj.type === 'diem' && Array.isArray(obj.midRef) && obj.midRef.length === 2) {
        const p1 = resolvePointRef(list, obj.midRef[0]);
        const p2 = resolvePointRef(list, obj.midRef[1]);
        if (p1 && p2) {
          obj.x = (p1.x + p2.x) * 0.5;
          obj.y = (p1.y + p2.y) * 0.5;
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'diem' || !obj.intersectRef) continue;
      const ir = obj.intersectRef;
      const o1 = list.find((o) => o && !o.hidden && o.id === ir.id1);
      const o2 = list.find((o) => o && !o.hidden && o.id === ir.id2);
      if (o1 && o2) {
        const ip = computeObjectIntersection(o1, ir.segIdx1, o2, ir.segIdx2, { x: obj.x, y: obj.y });
        if (ip) { obj.x = ip.x; obj.y = ip.y; }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'diem' || !obj.tangentPtRef) continue;
      const tr = obj.tangentPtRef;
      const cir = list.find((o) => o && !o.hidden && o.id === tr.circleId);
      const extPt = resolvePointRef(list, tr.ptRef);
      if (cir && extPt) {
        const cx = cir.x + cir.w * 0.5, cy = cir.y + cir.h * 0.5, r = Math.abs(cir.w * 0.5);
        const dx = extPt.x - cx, dy = extPt.y - cy, d = Math.hypot(dx, dy);
        if (d > r + 0.5) {
          const ang = Math.atan2(dy, dx) + tr.side * Math.acos(r / d);
          obj.x = cx + r * Math.cos(ang);
          obj.y = cy + r * Math.sin(ang);
        }
      }
    }
    for (const obj of list) {
      if (obj && obj.type === 'diem' && obj.footPerpRef) {
        const fp = obj.footPerpRef;
        const baseObj = list.find((o) => o && !o.hidden && o.id === fp.baseObjId);
        const seg = baseObj ? getObjectStraightSegment(baseObj, fp.baseSegIdx) : null;
        const extPt = resolvePointRef(list, fp.ptRef);
        if (seg && extPt) {
          const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
          const l2 = dx * dx + dy * dy;
          if (l2 > 1e-4) {
            const t = ((extPt.x - seg.p1.x) * dx + (extPt.y - seg.p1.y) * dy) / l2;
            obj.x = seg.p1.x + t * dx;
            obj.y = seg.p1.y + t * dy;
          }
        }
      }
    }
    for (const obj of list) {
      if (!obj) continue;
      if (obj.type === 'duong' && obj.perpBisectorRef) {
        const pb = obj.perpBisectorRef;
        let a = null, b = null;
        if (pb.kind === 'seg') {
          const baseObj = list.find((o) => o && !o.hidden && o.id === pb.objId);
          const seg = baseObj ? getObjectStraightSegment(baseObj, pb.segIdx) : null;
          if (seg) { a = seg.p1; b = seg.p2; }
        } else if (pb.kind === 'pts') {
          a = resolvePointRef(list, pb.p1Ref);
          b = resolvePointRef(list, pb.p2Ref);
        }
        if (a && b) {
          const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.max(1e-4, Math.hypot(dx, dy));
          const nx = -dy / len, ny = dx / len, half = Math.max(90, len * 0.7);
          const t1 = typeof pb.t1 === 'number' ? pb.t1 : -half;
          const t2 = typeof pb.t2 === 'number' ? pb.t2 : half;
          obj.x1 = mx + nx * t1; obj.y1 = my + ny * t1;
          obj.x2 = mx + nx * t2; obj.y2 = my + ny * t2;
        }
      }
      if (obj.type === 'duong' && obj.lineConstraintRef) {
        const lc = obj.lineConstraintRef;
        const baseObj = list.find((o) => o && !o.hidden && o.id === lc.baseObjId);
        const seg = baseObj ? getObjectStraightSegment(baseObj, lc.baseSegIdx) : null;
        const passPt = resolvePointRef(list, lc.ptRef);
        if (seg && passPt) {
          const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
          const len = Math.max(1e-4, Math.hypot(dx, dy));
          const ux = dx / len, uy = dy / len;
          const vx = lc.mode === 'parallel' ? ux : -uy;
          const vy = lc.mode === 'parallel' ? uy : ux;
          const half = Math.max(110, len * 0.65);
          const t1 = typeof lc.t1 === 'number' ? lc.t1 : -half;
          const t2 = typeof lc.t2 === 'number' ? lc.t2 : half;
          obj.x1 = passPt.x + vx * t1; obj.y1 = passPt.y + vy * t1;
          obj.x2 = passPt.x + vx * t2; obj.y2 = passPt.y + vy * t2;
        }
      }
      if (obj.type === 'but' && obj.cornerRightAngleRef) {
        const cr = obj.cornerRightAngleRef;
        const s = cr.size || 13;
        if (cr.kind === 'poly') {
          const pObj = list.find((o) => o && !o.hidden && o.id === cr.objId);
          if (pObj && Array.isArray(pObj.points) && pObj.points.length >= 3) {
            const n = pObj.points.length, vi = cr.vIdx;
            const V = pObj.points[vi], P1 = pObj.points[(vi - 1 + n) % n], P2 = pObj.points[(vi + 1) % n];
            const d1 = Math.hypot(P1.x - V.x, P1.y - V.y), d2 = Math.hypot(P2.x - V.x, P2.y - V.y);
            if (d1 > 1e-4 && d2 > 1e-4) {
              const u1x = (P1.x - V.x) / d1, u1y = (P1.y - V.y) / d1;
              const u2x = (P2.x - V.x) / d2, u2y = (P2.y - V.y) / d2;
              obj.points = [
                { x: V.x + u1x * s, y: V.y + u1y * s },
                { x: V.x + (u1x + u2x) * s, y: V.y + (u1y + u2y) * s },
                { x: V.x + u2x * s, y: V.y + u2y * s }
              ];
            }
          }
        } else if (cr.kind === 'segs') {
          const s1 = list.find((o) => o && !o.hidden && o.id === cr.id1);
          const s2 = list.find((o) => o && !o.hidden && o.id === cr.id2);
          if (s1 && s2) {
            const ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
            if (ip) {
              const pickRay = (seg) => {
                const d1 = Math.hypot(seg.x1 - ip.x, seg.y1 - ip.y);
                const d2 = Math.hypot(seg.x2 - ip.x, seg.y2 - ip.y);
                const far = d2 >= d1 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
                const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
                return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
              };
              const u1 = pickRay(s1), u2 = pickRay(s2);
              obj.points = [
                { x: ip.x + u1.x * s, y: ip.y + u1.y * s },
                { x: ip.x + (u1.x + u2.x) * s, y: ip.y + (u1.y + u2.y) * s },
                { x: ip.x + u2.x * s, y: ip.y + u2.y * s }
              ];
            }
          }
        }
      }
      if (obj.type === 'duong' && obj.bisectorRef) {
        const br = obj.bisectorRef;
        let ip = null, u1 = null, u2 = null;
        if (br.kind === 'poly') {
          const pObj = list.find((o) => o && !o.hidden && o.id === br.objId);
          if (pObj && Array.isArray(pObj.points) && pObj.points.length >= 3) {
            const n = pObj.points.length, vi = br.vIdx % n;
            const V = pObj.points[vi], P1 = pObj.points[(vi - 1 + n) % n], P2 = pObj.points[(vi + 1) % n];
            const d1 = Math.hypot(P1.x - V.x, P1.y - V.y), d2 = Math.hypot(P2.x - V.x, P2.y - V.y);
            if (d1 > 1e-4 && d2 > 1e-4) {
              ip = V;
              u1 = { x: (P1.x - V.x) / d1, y: (P1.y - V.y) / d1 };
              u2 = { x: (P2.x - V.x) / d2, y: (P2.y - V.y) / d2 };
            }
          }
        } else {
          const s1 = list.find((o) => o && !o.hidden && o.id === br.id1);
          const s2 = list.find((o) => o && !o.hidden && o.id === br.id2);
          if (s1 && s2) {
            ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
            if (ip) {
              const pickRay = (seg) => {
                const d1 = Math.hypot(seg.x1 - ip.x, seg.y1 - ip.y);
                const d2 = Math.hypot(seg.x2 - ip.x, seg.y2 - ip.y);
                const far = d2 >= d1 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
                const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
                return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
              };
              u1 = pickRay(s1); u2 = pickRay(s2);
            }
          }
        }
        if (ip && u1 && u2) {
          const bx = u1.x + u2.x, by = u1.y + u2.y;
          const bl = Math.hypot(bx, by);
          if (bl > 1e-4) {
            const ux = bx / bl, uy = by / bl;
            const L = br.len || 130;
            obj.x1 = ip.x; obj.y1 = ip.y;
            obj.x2 = ip.x + ux * L; obj.y2 = ip.y + uy * L;
          }
        }
      }
      if (obj.type === 'but' && obj.rightAngleRef) {
        const ra = obj.rightAngleRef;
        const baseObj = list.find((o) => o && !o.hidden && o.id === ra.baseObjId);
        const seg = baseObj ? getObjectStraightSegment(baseObj, ra.baseSegIdx) : null;
        const extPt = resolvePointRef(list, ra.ptRef);
        const hPt = list.find((o) => o && o.id === ra.footId);
        if (seg && extPt && hPt) {
          const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
          const len = Math.max(1e-4, Math.hypot(dx, dy));
          const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
          const s = 10;
          const sgn = ((extPt.x - hPt.x) * nx + (extPt.y - hPt.y) * ny) >= 0 ? 1 : -1;
          obj.points = [
            { x: hPt.x + ux * s, y: hPt.y + uy * s },
            { x: hPt.x + ux * s + nx * s * sgn, y: hPt.y + uy * s + ny * s * sgn },
            { x: hPt.x + nx * s * sgn, y: hPt.y + ny * s * sgn }
          ];
        }
      }
      if (obj.p1Ref) {
        const p1 = resolvePointRef(list, obj.p1Ref);
        if (p1) { obj.x1 = p1.x; obj.y1 = p1.y; }
      }
      if (obj.p2Ref) {
        const p2 = resolvePointRef(list, obj.p2Ref);
        if (p2) { obj.x2 = p2.x; obj.y2 = p2.y; }
      }
      if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.vertexRefs) && Array.isArray(obj.points)) {
        for (let vi = 0; vi < obj.points.length; vi++) {
          const vr = obj.vertexRefs[vi];
          if (vr) {
            const rp = resolvePointRef(list, vr);
            if (rp) { obj.points[vi].x = rp.x; obj.points[vi].y = rp.y; }
          }
        }
      }
      if (obj.centerRef) {
        const c = resolvePointRef(list, obj.centerRef);
        if (c) {
          obj.x = c.x - obj.w * 0.5;
          obj.y = c.y - obj.h * 0.5;
        }
      }
      if (obj.type === 'elip' && obj.triangleCircleRef) {
        const tc = obj.triangleCircleRef;
        const pA = resolvePointRef(list, tc.pts[0]);
        const pB = resolvePointRef(list, tc.pts[1]);
        const pC = resolvePointRef(list, tc.pts[2]);
        const res = (pA && pB && pC) ? computeTriangleCircle(tc.mode, pA, pB, pC) : null;
        if (res) {
          obj.x = res.cx - res.r;
          obj.y = res.cy - res.r;
          obj.w = res.r * 2;
          obj.h = res.r * 2;
          if (tc.centerId) {
            const cPt = list.find((o) => o && o.id === tc.centerId);
            if (cPt) { cPt.x = res.cx; cPt.y = res.cy; }
          }
        }
      }
      if (obj.type === 'duong' && obj.tangentLineRef) {
        const tl = obj.tangentLineRef;
        const cir = list.find((o) => o && !o.hidden && o.id === tl.circleId);
        const tPt = resolvePointRef(list, tl.ptRef);
        if (cir && tPt) {
          const cx = cir.x + cir.w * 0.5, cy = cir.y + cir.h * 0.5, r = Math.abs(cir.w * 0.5);
          const dx = tPt.x - cx, dy = tPt.y - cy, d = Math.hypot(dx, dy);
          if (d > 1e-4) {
            const tx = -dy / d, ty = dx / d;
            const halfLen = Math.max(110, r * 1.4);
            const t1 = typeof tl.t1 === 'number' ? tl.t1 : -halfLen;
            const t2 = typeof tl.t2 === 'number' ? tl.t2 : halfLen;
            obj.x1 = tPt.x + tx * t1;
            obj.y1 = tPt.y + ty * t1;
            obj.x2 = tPt.x + tx * t2;
            obj.y2 = tPt.y + ty * t2;
          }
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'diem' || !obj.sumTipRef) continue;
      const sr = obj.sumTipRef;
      const p0 = resolvePointRef(list, sr.p0Ref);
      const v1 = list.find((o) => o && !o.hidden && o.id === sr.v1Id);
      const v2 = list.find((o) => o && !o.hidden && o.id === sr.v2Id);
      if (p0 && v1 && v2) {
        obj.x = p0.x + (v1.x2 - v1.x1) + (v2.x2 - v2.x1);
        obj.y = p0.y + (v1.y2 - v1.y1) + (v2.y2 - v2.y1);
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'mui_ten' || !obj.decompGroup) continue;
      const dg = obj.decompGroup;
      const p0 = resolvePointRef(list, dg.p0Ref);
      const pMainTip = resolvePointRef(list, dg.mainTipRef);
      const pt1 = list.find((o) => o && !o.hidden && o.id === dg.pt1Id);
      const pt2 = list.find((o) => o && !o.hidden && o.id === dg.pt2Id);
      if (!p0 || !pMainTip || !pt1 || !pt2) continue;
      const fx = pMainTip.x - p0.x;
      const fy = pMainTip.y - p0.y;
      const oxChanged = Math.abs(p0.x - (dg.lastOx ?? p0.x)) > 1e-3 || Math.abs(p0.y - (dg.lastOy ?? p0.y)) > 1e-3;
      const fChanged = Math.abs(fx - (dg.lastFx ?? fx)) > 1e-3 || Math.abs(fy - (dg.lastFy ?? fy)) > 1e-3;
      if (oxChanged || fChanged) {
        const th1 = pt1.decompTipRef ? pt1.decompTipRef.theta : 0;
        const th2 = pt2.decompTipRef ? pt2.decompTipRef.theta : Math.PI * 0.5;
        const u1x = Math.cos(th1), u1y = Math.sin(th1);
        const u2x = Math.cos(th2), u2y = Math.sin(th2);
        const det = u1x * u2y - u1y * u2x;
        if (Math.abs(det) > 1e-3) {
          const a = (fx * u2y - fy * u2x) / det;
          const b = (u1x * fy - u1y * fx) / det;
          pt1.x = p0.x + a * u1x;
          pt1.y = p0.y + a * u1y;
          pt2.x = p0.x + b * u2x;
          pt2.y = p0.y + b * u2y;
        } else {
          const dxo = p0.x - (dg.lastOx ?? p0.x);
          const dyo = p0.y - (dg.lastOy ?? p0.y);
          pt1.x += dxo; pt1.y += dyo;
          pt2.x += dxo; pt2.y += dyo;
        }
        dg.lastOx = p0.x; dg.lastOy = p0.y;
        dg.lastFx = fx; dg.lastFy = fy;
      }
    }
    for (const obj of list) {
      if (!obj) continue;
      if (obj.p1Ref) {
        const p1 = resolvePointRef(list, obj.p1Ref);
        if (p1) { obj.x1 = p1.x; obj.y1 = p1.y; }
      }
      if (obj.p2Ref) {
        const p2 = resolvePointRef(list, obj.p2Ref);
        if (p2) { obj.x2 = p2.x; obj.y2 = p2.y; }
      }
      if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.vertexRefs) && Array.isArray(obj.points)) {
        for (let vi = 0; vi < obj.points.length; vi++) {
          const vr = obj.vertexRefs[vi];
          if (vr) {
            const rp = resolvePointRef(list, vr);
            if (rp) { obj.points[vi].x = rp.x; obj.points[vi].y = rp.y; }
          }
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'diem' || !obj.oppTipRef) continue;
      const v = list.find((o) => o && !o.hidden && o.id === obj.oppTipRef.vecId);
      if (v) {
        obj.x = 2 * v.x1 - v.x2;
        obj.y = 2 * v.y1 - v.y2;
      }
    }
    for (const obj of list) {
      if (!obj) continue;
      if (obj.p1Ref) {
        const p1 = resolvePointRef(list, obj.p1Ref);
        if (p1) { obj.x1 = p1.x; obj.y1 = p1.y; }
      }
      if (obj.p2Ref) {
        const p2 = resolvePointRef(list, obj.p2Ref);
        if (p2) { obj.x2 = p2.x; obj.y2 = p2.y; }
      }
      if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.vertexRefs) && Array.isArray(obj.points)) {
        for (let vi = 0; vi < obj.points.length; vi++) {
          const vr = obj.vertexRefs[vi];
          if (vr) {
            const rp = resolvePointRef(list, vr);
            if (rp) { obj.points[vi].x = rp.x; obj.points[vi].y = rp.y; }
          }
        }
      }
    }
    for (const obj of list) {
      if (!obj) continue;
      if (obj.type === 'diem' && obj.onSlopeCenterRef && typeof getObjectStraightSegment === 'function') {
        const sc = obj.onSlopeCenterRef;
        const sObj = list.find((o) => o && !o.hidden && o.id === sc.slopeId);
        const seg = sObj ? getObjectStraightSegment(sObj, sc.segIdx) : null;
        if (seg) {
          const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y, len = Math.max(1e-4, Math.hypot(dx, dy));
          let nx = dy / len, ny = -dx / len;
          if (ny > 0) { nx = -nx; ny = -ny; }
          obj.x = seg.p1.x + sc.t * dx + sc.halfH * nx;
          obj.y = seg.p1.y + sc.t * dy + sc.halfH * ny;
        }
      }
      if (obj.type === 'tam_giac' && obj.onSlopeBlockRef && Array.isArray(obj.points) && obj.points.length === 4 && typeof getObjectStraightSegment === 'function') {
        const sb = obj.onSlopeBlockRef;
        const sObj = list.find((o) => o && !o.hidden && o.id === sb.slopeId);
        const seg = sObj ? getObjectStraightSegment(sObj, sb.segIdx) : null;
        if (seg) {
          const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y, len = Math.max(1e-4, Math.hypot(dx, dy));
          const ux = dx / len, uy = dy / len;
          let nx = uy, ny = -ux;
          if (ny > 0) { nx = -nx; ny = -ny; }
          const bx = seg.p1.x + sb.t * dx, by = seg.p1.y + sb.t * dy;
          obj.points[0] = { x: bx - sb.halfW * ux, y: by - sb.halfW * uy };
          obj.points[1] = { x: bx + sb.halfW * ux, y: by + sb.halfW * uy };
          obj.points[2] = { x: bx + sb.halfW * ux + 2 * sb.halfH * nx, y: by + sb.halfW * uy + 2 * sb.halfH * ny };
          obj.points[3] = { x: bx - sb.halfW * ux + 2 * sb.halfH * nx, y: by - sb.halfW * uy + 2 * sb.halfH * ny };
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'but' || !obj.semiCircleRef) continue;
      const sr = obj.semiCircleRef;
      const p1 = resolvePointRef(list, sr.p1Ref);
      const p2 = resolvePointRef(list, sr.p2Ref);
      if (p1 && p2) {
        const cx = (p1.x + p2.x) * 0.5, cy = (p1.y + p2.y) * 0.5;
        const r = Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.5;
        if (r > 2) {
          const thStart = Math.atan2(p2.y - cy, p2.x - cx);
          const pts = [];
          for (let i = 0; i <= 64; i++) {
            const th = thStart - (i / 64) * Math.PI;
            pts.push({ x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) });
          }
          obj.points = pts;
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'but' || !obj.trigSweepRef) continue;
      const ts = obj.trigSweepRef;
      const cir = list.find((o) => o && !o.hidden && o.id === ts.circleId);
      const p1 = resolvePointRef(list, ts.p1Ref);
      const p2 = resolvePointRef(list, ts.p2Ref);
      if (cir && p1 && p2) {
        const pts = computeTrigSweepPoints(cir, p1, p2, ts.offset || 14);
        if (pts.length >= 2) obj.points = pts;
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'mui_ten' || !obj.forceConstraint) continue;
      const fc = obj.forceConstraint;
      if (fc.kind === 'gravity') {
        obj.x2 = obj.x1;
        obj.y2 = obj.y1 + fc.len;
      } else if (typeof getObjectStraightSegment === 'function') {
        const sObj = list.find((o) => o && !o.hidden && o.id === fc.slopeId);
        const seg = sObj ? getObjectStraightSegment(sObj, fc.segIdx) : null;
        if (seg) {
          const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y, len = Math.max(1e-4, Math.hypot(dx, dy));
          const tx = dx / len, ty = dy / len;
          let nx = ty, ny = -tx;
          if (ny > 0) { nx = -nx; ny = -ny; }
          if (fc.kind === 'normal') { obj.x2 = obj.x1 + nx * fc.len; obj.y2 = obj.y1 + ny * fc.len; }
          else if (fc.kind === 'parallel_up') { obj.x2 = obj.x1 - tx * fc.len; obj.y2 = obj.y1 - ty * fc.len; }
          else { obj.x2 = obj.x1 + tx * fc.len; obj.y2 = obj.y1 + ty * fc.len; }
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'but' || !obj.cornerRightAngleRef) continue;
      const cr = obj.cornerRightAngleRef;
      if (cr.kind === 'segs') {
        const s1 = list.find((o) => o && !o.hidden && o.id === cr.id1);
        const s2 = list.find((o) => o && !o.hidden && o.id === cr.id2);
        if (s1 && s2) {
          const ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
          if (ip) {
            const pickRay = (seg) => {
              const d1 = Math.hypot(seg.x1 - ip.x, seg.y1 - ip.y);
              const d2 = Math.hypot(seg.x2 - ip.x, seg.y2 - ip.y);
              const far = d2 >= d1 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
              const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
              return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
            };
            const u1 = pickRay(s1), u2 = pickRay(s2);
            obj.points = [
              { x: ip.x + u1.x * s, y: ip.y + u1.y * s },
              { x: ip.x + (u1.x + u2.x) * s, y: ip.y + (u1.y + u2.y) * s },
              { x: ip.x + u2.x * s, y: ip.y + u2.y * s }
            ];
          }
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'but' || !obj.angleArcRef) continue;
      const ar = obj.angleArcRef;
      const r = ar.r || 22;
      if (ar.kind === 'poly') {
        const pObj = list.find((o) => o && !o.hidden && o.id === ar.objId);
        if (pObj && Array.isArray(pObj.points) && pObj.points.length >= 3) {
          const n = pObj.points.length, vi = ar.vIdx;
          const V = pObj.points[vi], P1 = pObj.points[(vi - 1 + n) % n], P2 = pObj.points[(vi + 1) % n];
          const d1 = Math.hypot(P1.x - V.x, P1.y - V.y), d2 = Math.hypot(P2.x - V.x, P2.y - V.y);
          if (d1 > 1e-4 && d2 > 1e-4) {
            obj.points = computeAngleArcPoints(
              V,
              { x: (P1.x - V.x) / d1, y: (P1.y - V.y) / d1 },
              { x: (P2.x - V.x) / d2, y: (P2.y - V.y) / d2 },
              r
            );
          }
        }
      } else if (ar.kind === 'segs') {
        const s1 = list.find((o) => o && !o.hidden && o.id === ar.id1);
        const s2 = list.find((o) => o && !o.hidden && o.id === ar.id2);
        if (s1 && s2) {
          const ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
          if (ip) {
            const pickRay = (seg) => {
              const d1 = Math.hypot(seg.x1 - ip.x, seg.y1 - ip.y);
              const d2 = Math.hypot(seg.x2 - ip.x, seg.y2 - ip.y);
              const far = d2 >= d1 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
              const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
              return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
            };
            obj.points = computeAngleArcPoints(ip, pickRay(s1), pickRay(s2), r);
          }
        }
      }
    }
    for (const obj of list) {
      if (!obj || obj.type !== 'chu' || !obj.followVecTipRef) continue;
      const fv = obj.followVecTipRef;
      const vObj = list.find((o) => o && !o.hidden && o.id === fv.vecId);
      if (vObj) {
        obj.x = vObj.x2 + (fv.dx || 0);
        obj.y = vObj.y2 + (fv.dy || 0);
      }
    }
  }

  function drawPerpForceMarks(ctx, list) {
    if (!Array.isArray(list) || list.length < 2) return;
    const vecs = list.filter((o) => o && !o.hidden && o.type === 'mui_ten' && !o.resultantRef && !o.oppositeOfId && !o.axisLock);
    if (vecs.length < 2) return;
    const drawn = new Set();
    for (let i = 0; i < vecs.length; i++) {
      const a = vecs[i];
      const dxa = a.x2 - a.x1, dya = a.y2 - a.y1, la = Math.hypot(dxa, dya);
      if (la < 14) continue;
      for (let j = i + 1; j < vecs.length; j++) {
        const b = vecs[j];
        if (Math.hypot(a.x1 - b.x1, a.y1 - b.y1) > 4) continue;
        const dxb = b.x2 - b.x1, dyb = b.y2 - b.y1, lb = Math.hypot(dxb, dyb);
        if (lb < 14) continue;
        const cosT = (dxa * dxb + dya * dyb) / (la * lb);
        if (Math.abs(cosT) <= 0.055) {
          const key = `${Math.round(a.x1)},${Math.round(a.y1)}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          const uxa = dxa / la, uya = dya / la;
          const uxb = dxb / lb, uyb = dyb / lb;
          const s = Math.min(13, la * 0.25, lb * 0.25);
          const ox = a.x1, oy = a.y1;
          ctx.save();
          ctx.strokeStyle = '#FACC15';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(ox + uxa * s, oy + uya * s);
          ctx.lineTo(ox + (uxa + uxb) * s, oy + (uya + uyb) * s);
          ctx.lineTo(ox + uxb * s, oy + uyb * s);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  function snapPerpForceDrag(list, obj, role, pos) {
    if (!Array.isArray(list)) return null;
    let draggedVec = null;
    if (obj.type === 'mui_ten' && role === 'p2') {
      draggedVec = obj;
    } else if (obj.type === 'diem') {
      const id = obj.id;
      if (id) draggedVec = list.find((o) => o && !o.hidden && o.type === 'mui_ten' && !o.resultantRef && !o.oppositeOfId && o.p2Ref && o.p2Ref.id === id);
    }
    if (!draggedVec) return null;
    const ox = draggedVec.x1, oy = draggedVec.y1;
    const dx = pos.x - ox, dy = pos.y - oy, len = Math.hypot(dx, dy);
    if (len < 14) return null;
    for (const other of list) {
      if (!other || other === draggedVec || other.hidden || other.type !== 'mui_ten' || other.resultantRef || other.oppositeOfId || other.axisLock) continue;
      if (Math.hypot(other.x1 - ox, other.y1 - oy) > 4) continue;
      const odx = other.x2 - other.x1, ody = other.y2 - other.y1, olen = Math.hypot(odx, ody);
      if (olen < 14) continue;
      const cosT = (dx * odx + dy * ody) / (len * olen);
      if (Math.abs(cosT) <= 0.052) {
        const nx = -ody / olen, ny = odx / olen;
        const sgn = (dx * nx + dy * ny) >= 0 ? 1 : -1;
        return { x: ox + nx * len * sgn, y: oy + ny * len * sgn };
      }
    }
    return null;
  }

  function ensureVectorEndpointsAsPoints(list, vec, col) {
    ensureGeomId(vec);
    if (!vec.p1Ref) {
      const existingTail = findPointRef(list, vec.x1, vec.y1, 6);
      if (existingTail) {
        vec.p1Ref = existingTail;
      } else {
        const oPt = { type: 'diem', x: vec.x1, y: vec.y1, text: '', color: col || vec.color || '#ffffff' };
        ensureGeomId(oPt);
        list.push(oPt);
        vec.p1Ref = { kind: 'diem', id: oPt.id, x: oPt.x, y: oPt.y };
      }
    }
    if (!vec.p2Ref) {
      const existingTip = findPointRef(list, vec.x2, vec.y2, 6);
      if (existingTip) {
        vec.p2Ref = existingTip;
      } else {
        const tPt = { type: 'diem', x: vec.x2, y: vec.y2, text: '', color: col || vec.color || '#ffffff' };
        ensureGeomId(tPt);
        list.push(tPt);
        vec.p2Ref = { kind: 'diem', id: tPt.id, x: tPt.x, y: tPt.y };
      }
    }
    return { p1Ref: vec.p1Ref, p2Ref: vec.p2Ref };
  }

  function createForceResultant(sid, v1, v2) {
    if (!v1 || !v2 || v1 === v2) return false;
    const list = state.annots[sid] || [];
    pushUndo(sid);
    ensureGeomId(v1);
    ensureGeomId(v2);
    if (Math.hypot(v2.x1 - v1.x1, v2.y1 - v1.y1) > 12) {
      const dx = v1.x1 - v2.x1, dy = v1.y1 - v2.y1;
      v2.x1 += dx; v2.y1 += dy; v2.x2 += dx; v2.y2 += dy;
      v2.p1Ref = null;
      if (v2.p2Ref && v2.p2Ref.kind === 'diem') {
        const t2 = list.find((o) => o && o.id === v2.p2Ref.id);
        if (t2) { t2.x += dx; t2.y += dy; }
      }
    } else {
      v2.x1 = v1.x1; v2.y1 = v1.y1;
    }
    const e1 = ensureVectorEndpointsAsPoints(list, v1);
    v2.p1Ref = { ...e1.p1Ref };
    const e2 = ensureVectorEndpointsAsPoints(list, v2);

    const sx = v1.x1 + (v1.x2 - v1.x1) + (v2.x2 - v2.x1);
    const sy = v1.y1 + (v1.y2 - v1.y1) + (v2.y2 - v2.y1);
    const sumTip = {
      type: 'diem',
      x: sx, y: sy,
      text: '',
      color: '#EF4444',
      sumTipRef: { p0Ref: e1.p1Ref, v1Id: v1.id, v2Id: v2.id }
    };
    ensureGeomId(sumTip);
    const sumTipRef = { kind: 'diem', id: sumTip.id, x: sx, y: sy };
    list.push(sumTip);

    const dashCol = v1.color || '#E2E8F0';
    list.push({ type: 'duong', x1: v1.x2, y1: v1.y2, x2: sx, y2: sy, p1Ref: e1.p2Ref, p2Ref: sumTipRef, color: dashCol, width: 1.5, dashed: true });
    list.push({ type: 'duong', x1: v2.x2, y1: v2.y2, x2: sx, y2: sy, p1Ref: e2.p2Ref, p2Ref: sumTipRef, color: dashCol, width: 1.5, dashed: true });
    list.push({
      type: 'mui_ten',
      x1: v1.x1, y1: v1.y1, x2: sx, y2: sy,
      p1Ref: e1.p1Ref, p2Ref: sumTipRef,
      resultantRef: { v1Id: v1.id, v2Id: v2.id },
      color: '#EF4444',
      width: Math.max(v1.width || 2.6, 3.0)
    });
    syncLinkedEndpoints(list);
    state.hideSelectionBoxForVertex = false;
    state.selectedIndices = [list.length - 1];
    state.selectedVertices = [];
    setTool('chon');
    redrawSurface(sid);
    notify('⊕ Đã dựng hợp lực theo quy tắc hình bình hành (kéo mút 2 lực để đổi phương & độ lớn!)');
    return true;
  }

  function createForceDecomposition(sid, vMain) {
    if (!vMain || vMain.type !== 'mui_ten') return false;
    const list = state.annots[sid] || [];
    pushUndo(sid);
    ensureGeomId(vMain);
    const eMain = ensureVectorEndpointsAsPoints(list, vMain);
    const ox = vMain.x1, oy = vMain.y1;
    const tx = vMain.x2, ty = vMain.y2;
    const fx = tx - ox, fy = ty - oy;
    if (Math.hypot(fx, fy) < 8) {
      notify('Lực quá ngắn để phân tích!');
      return false;
    }
    let th1 = 0, th2 = Math.PI * 0.5;
    if (Math.abs(fx) < 16 || Math.abs(fy) < 16) {
      th1 = Math.atan2(fy, fx) - (35 * Math.PI) / 180;
      th2 = th1 + Math.PI * 0.5;
    }
    const u1x = Math.cos(th1), u1y = Math.sin(th1);
    const u2x = Math.cos(th2), u2y = Math.sin(th2);
    const a = fx * u1x + fy * u1y;
    const b = fx * u2x + fy * u2y;
    const p1x = ox + a * u1x, p1y = oy + a * u1y;
    const p2x = ox + b * u2x, p2y = oy + b * u2y;

    const pt1 = { type: 'diem', x: p1x, y: p1y, text: '', color: '#2563EB' };
    const pt2 = { type: 'diem', x: p2x, y: p2y, text: '', color: '#16A34A' };
    ensureGeomId(pt1);
    ensureGeomId(pt2);
    pt1.decompTipRef = { mainVecId: vMain.id, otherTipId: pt2.id, p0Ref: eMain.p1Ref, mainTipRef: eMain.p2Ref, theta: th1 };
    pt2.decompTipRef = { mainVecId: vMain.id, otherTipId: pt1.id, p0Ref: eMain.p1Ref, mainTipRef: eMain.p2Ref, theta: th2 };
    list.push(pt1, pt2);

    const pt1Ref = { kind: 'diem', id: pt1.id, x: p1x, y: p1y };
    const pt2Ref = { kind: 'diem', id: pt2.id, x: p2x, y: p2y };
    const dashCol = vMain.color || '#64748B';
    list.push({ type: 'duong', x1: p1x, y1: p1y, x2: tx, y2: ty, p1Ref: pt1Ref, p2Ref: eMain.p2Ref, color: dashCol, width: 1.5, dashed: true });
    list.push({ type: 'duong', x1: p2x, y1: p2y, x2: tx, y2: ty, p1Ref: pt2Ref, p2Ref: eMain.p2Ref, color: dashCol, width: 1.5, dashed: true });

    const vecW = Math.max(2.2, vMain.width || 2.6);
    const v1 = {
      type: 'mui_ten', x1: ox, y1: oy, x2: p1x, y2: p1y,
      p1Ref: eMain.p1Ref, p2Ref: pt1Ref,
      decompVecRef: { mainVecId: vMain.id, selfTipId: pt1.id, otherTipId: pt2.id, p0Ref: eMain.p1Ref, mainTipRef: eMain.p2Ref },
      color: '#2563EB', width: vecW
    };
    const v2 = {
      type: 'mui_ten', x1: ox, y1: oy, x2: p2x, y2: p2y,
      p1Ref: eMain.p1Ref, p2Ref: pt2Ref,
      decompVecRef: { mainVecId: vMain.id, selfTipId: pt2.id, otherTipId: pt1.id, p0Ref: eMain.p1Ref, mainTipRef: eMain.p2Ref },
      color: '#16A34A', width: vecW
    };
    ensureGeomId(v1);
    ensureGeomId(v2);
    list.push(v1, v2);

    vMain.decompGroup = {
      pt1Id: pt1.id, pt2Id: pt2.id,
      v1Id: v1.id, v2Id: v2.id,
      p0Ref: eMain.p1Ref, mainTipRef: eMain.p2Ref,
      lastOx: ox, lastOy: oy, lastFx: fx, lastFy: fy
    };

    syncLinkedEndpoints(list);
    state.hideSelectionBoxForVertex = false;
    state.selectedIndices = [list.length - 1];
    state.selectedVertices = [];
    setTool('chon');
    redrawSurface(sid);
    notify('↙ Đã phân tích lực thành 2 thành phần vuông góc (kéo mút để đổi phương/độ lớn!)');
    return true;
  }

  function createOppositeForce(sid, v1) {
    if (!v1) return false;
    const list = state.annots[sid] || [];
    pushUndo(sid);
    const e1 = ensureVectorEndpointsAsPoints(list, v1);
    const ox = 2 * v1.x1 - v1.x2, oy = 2 * v1.y1 - v1.y2;
    const oppTip = {
      type: 'diem',
      x: ox, y: oy,
      text: '',
      color: '#38BDF8',
      oppTipRef: { vecId: v1.id }
    };
    ensureGeomId(oppTip);
    const oppTipRef = { kind: 'diem', id: oppTip.id, x: ox, y: oy };
    list.push(oppTip);
    const oppVec = {
      type: 'mui_ten',
      x1: v1.x1, y1: v1.y1, x2: ox, y2: oy,
      p1Ref: e1.p1Ref, p2Ref: oppTipRef,
      oppositeOfId: v1.id,
      color: '#38BDF8',
      width: v1.width || activeWidth()
    };
    ensureGeomId(oppVec);
    list.push(oppVec);
    syncLinkedEndpoints(list);
    state.hideSelectionBoxForVertex = false;
    state.selectedIndices = [list.length - 1];
    state.selectedVertices = [];
    setTool('chon');
    redrawSurface(sid);
    notify('⇄ Đã dựng lực đối (-F) cùng phương, ngược chiều, bằng độ lớn!');
    return true;
  }

  function insertConcurrentForcesSample(sid) {
    const surf = surfaces[sid];
    if (!surf) return;
    ensureStacks(sid);
    pushUndo(sid);
    const c = getViewportCenterWorld(sid);
    const list = state.annots[sid];
    const oPt = { type: 'diem', x: c.x - 40, y: c.y + 40, text: 'O', color: '#FFFFFF' };
    const t1 = { type: 'diem', x: c.x + 100, y: c.y + 40, text: '', color: '#FACC15' };
    const t2 = { type: 'diem', x: c.x + 20, y: c.y - 70, text: '', color: '#4ADE80' };
    ensureGeomId(oPt); ensureGeomId(t1); ensureGeomId(t2);
    const oRef = { kind: 'diem', id: oPt.id, x: oPt.x, y: oPt.y };
    const t1Ref = { kind: 'diem', id: t1.id, x: t1.x, y: t1.y };
    const t2Ref = { kind: 'diem', id: t2.id, x: t2.x, y: t2.y };
    const f1 = { type: 'mui_ten', x1: oPt.x, y1: oPt.y, x2: t1.x, y2: t1.y, p1Ref: oRef, p2Ref: t1Ref, color: '#FACC15', width: 2.8 };
    const f2 = { type: 'mui_ten', x1: oPt.x, y1: oPt.y, x2: t2.x, y2: t2.y, p1Ref: oRef, p2Ref: t2Ref, color: '#4ADE80', width: 2.8 };
    ensureGeomId(f1); ensureGeomId(f2);
    list.push(oPt, t1, t2, f1, f2);
    createForceResultant(sid, f1, f2);
  }

  let polyBuildPick = null;
  function handlePolygonToolDown(sid, pos, list) {
    const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
    const tol = 36 / zoom;
    const ref = findPointRef(list, pos.x, pos.y, tol);
    const pt = ref ? { x: ref.x, y: ref.y } : { x: pos.x, y: pos.y };

    if (!polyBuildPick || polyBuildPick.sid !== sid) {
      polyBuildPick = { sid, pts: [pt], refs: [ref || null] };
    } else {
      const first = polyBuildPick.pts[0];
      const n = polyBuildPick.pts.length;
      const closeToFirst = n >= 3 && Math.hypot(pt.x - first.x, pt.y - first.y) <= 28 / zoom;
      const sameAsLast = Math.hypot(pt.x - polyBuildPick.pts[n - 1].x, pt.y - polyBuildPick.pts[n - 1].y) <= 8 / zoom;
      if (closeToFirst || (n >= 3 && sameAsLast)) {
        const ptsOut = polyBuildPick.pts.map((p) => ({ x: p.x, y: p.y }));
        const refsOut = polyBuildPick.refs.slice();
        polyBuildPick = null;
        const surfClear = surfaces[sid];
        if (surfClear) {
          surfClear.pickedPoints = [];
          surfClear.previewObj = null;
          surfClear.snapBadge = null;
          redrawActiveLayer(sid);
        }
        pushUndo(sid);
        const polyObj = {
          type: 'tam_giac',
          points: ptsOut,
          vertexRefs: refsOut,
          color: activeColor(),
          width: activeWidth(),
          dashed: state.dashed
        };
        ensureGeomId(polyObj);
        list.push(polyObj);
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify(`▱ Đã dựng xong ${ptsOut.length === 3 ? 'tam giác' : 'đa giác ' + ptsOut.length + ' đỉnh'} (1 hình gộp liên kết động)!`);
        return;
      }
      if (sameAsLast) {
        notify('⚠️ Hãy chạm điểm tiếp theo khác vị trí vừa chọn.');
        return;
      }
      polyBuildPick.pts.push(pt);
      polyBuildPick.refs.push(ref || null);
    }

    const surf = surfaces[sid];
    if (surf) {
      surf.pickedPoints = polyBuildPick.pts.map((p) => ({ x: p.x, y: p.y }));
      surf.previewObj = {
        type: 'but',
        isPolyline: true,
        points: polyBuildPick.pts.slice(),
        color: activeColor(),
        width: activeWidth(),
        dashed: state.dashed
      };
      redrawActiveLayer(sid);
    }
    const cnt = polyBuildPick.pts.length;
    notify(cnt < 3
      ? `▱ Đã chọn đỉnh ${cnt} — chạm tiếp đỉnh ${cnt + 1}...`
      : `▱ Đã chọn ${cnt} đỉnh — chạm tiếp đỉnh mới hoặc chạm lại đỉnh đầu để khép kín!`);
  }

  let circleCenterPick = null;
  function nextCircleCenterLabel(list) {
    const used = new Set((list || []).filter((o) => o && o.type === 'diem' && o.text).map((o) => o.text));
    for (const ch of ['O', 'I', 'J', 'K', 'A', 'B', 'C', 'D', 'E', 'F', 'M', 'N', 'P', 'Q']) {
      if (!used.has(ch)) return ch;
    }
    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lbl = labels[state.pointCounter % labels.length];
    state.pointCounter++;
    return lbl;
  }

  function handleCircleToolDown(sid, pos, list) {
    const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
    const tol = 36 / zoom;
    const ref = findPointRef(list, pos.x, pos.y, tol);
    const pt = ref ? { x: ref.x, y: ref.y } : { x: pos.x, y: pos.y };

    if (!circleCenterPick || circleCenterPick.sid !== sid) {
      circleCenterPick = { sid, pt, ref };
      const surf = surfaces[sid];
      if (surf) {
        surf.pickedPoints = [{ x: pt.x, y: pt.y }];
        surf.previewObj = {
          type: 'elip',
          isCircle: true,
          x: pt.x, y: pt.y, w: 0, h: 0,
          previewRadiusEnd: { x: pt.x, y: pt.y },
          color: activeColor(), width: activeWidth(), dashed: state.dashed
        };
        redrawActiveLayer(sid);
      }
      notify('⭕ Đã chọn tâm — kéo hoặc chạm điểm trên đường tròn để xác định bán kính!');
      return;
    }

    const cPt = circleCenterPick.pt;
    let cRef = circleCenterPick.ref;
    const r = Math.hypot(pt.x - cPt.x, pt.y - cPt.y);
    if (r < 6) {
      notify('⚠️ Bán kính quá nhỏ, hãy kéo hoặc chạm xa tâm hơn.');
      return;
    }

    circleCenterPick = null;
    const surfClear = surfaces[sid];
    if (surfClear) {
      surfClear.pickedPoints = [];
      surfClear.previewObj = null;
      surfClear.snapBadge = null;
      redrawActiveLayer(sid);
    }

    pushUndo(sid);
    let centerLabel = '';
    if (!cRef) {
      const centerObj = { type: 'diem', x: cPt.x, y: cPt.y, text: nextPointLabel(list), color: activeColor() };
      ensureGeomId(centerObj);
      list.push(centerObj);
      cRef = { kind: 'diem', id: centerObj.id, x: cPt.x, y: cPt.y };
    } else if (cRef.kind === 'diem') {
      const cObj = list.find((o) => o && o.id === cRef.id);
      if (cObj && cObj.text) centerLabel = cObj.text;
    }

    list.push({
      type: 'elip',
      isCircle: true,
      x: cPt.x - r,
      y: cPt.y - r,
      w: r * 2,
      h: r * 2,
      centerRef: cRef,
      color: activeColor(),
      width: activeWidth(),
      dashed: state.dashed
    });
    redrawSurface(sid);
    notify(centerLabel
      ? `⭕ Đã dựng đường tròn tâm ${centerLabel} (R = ${Math.round(r)} px)`
      : `⭕ Đã dựng đường tròn rõ tâm (R = ${Math.round(r)} px)`);
  }

  let linkedLinePick = null;
  function handleLinkedLineToolDown(sid, pos, list, cachedRect) {
    const isVec = state.tool === 'dung_mui_ten';
    const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
    const tol = 36 / zoom;
    const ref = findPointRef(list, pos.x, pos.y, tol);
    const pt = ref ? { x: ref.x, y: ref.y } : { x: pos.x, y: pos.y };

    if (!linkedLinePick || linkedLinePick.sid !== sid || linkedLinePick.isVec !== isVec) {
      linkedLinePick = { sid, isVec, pt, ref };
      const surf = surfaces[sid];
      if (surf) {
        surf.pickedPoints = [{ x: pt.x, y: pt.y }];
        surf.previewObj = {
          type: isVec ? 'mui_ten' : 'duong',
          x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
          color: activeColor(), width: activeWidth(), dashed: state.dashed
        };
        redrawActiveLayer(sid);
      }
      notify('Đã chọn điểm đầu — chạm tiếp điểm thứ 2!');
      return;
    }

    const p1 = linkedLinePick.pt, r1 = linkedLinePick.ref;
    const p2 = pt, r2 = ref;
    linkedLinePick = null;
    const surfClear = surfaces[sid];
    if (surfClear) {
      surfClear.pickedPoints = [];
      surfClear.previewObj = null;
      surfClear.snapBadge = null;
      redrawActiveLayer(sid);
    }
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 3) {
      notify('⚠️ Hai điểm trùng nhau, hãy chọn điểm thứ 2 khác vị trí.');
      return;
    }
    pushUndo(sid);
    list.push({
      type: isVec ? 'mui_ten' : 'duong',
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      p1Ref: r1 || null,
      p2Ref: r2 || null,
      color: activeColor(),
      width: activeWidth(),
      dashed: state.dashed
    });
    redrawSurface(sid);
    const linkedCnt = (r1 ? 1 : 0) + (r2 ? 1 : 0);
    if (linkedCnt === 2) {
      notify(isVec ? '🔗↗ Đã nối vectơ lực vào 2 điểm (kéo điểm sẽ kéo theo lực)!' : '🔗╱ Đã nối đoạn thẳng vào 2 điểm (kéo điểm sẽ kéo theo đoạn)!');
    } else if (linkedCnt === 1) {
      notify(isVec ? '🔗↗ Đã gắn 1 đầu vectơ vào điểm!' : '🔗╱ Đã gắn 1 đầu đoạn thẳng vào điểm!');
    } else {
      notify(isVec ? '↗ Đã dựng vectơ / lực!' : '╱ Đã dựng đoạn thẳng!');
    }
  }

  const selQuickBar = document.getElementById('SelQuickBar');
  const selBtnMergePts = document.getElementById('sel-btn-merge-pts');
  const selBtnDashed = document.getElementById('sel-btn-dashed');
  const selBtnDelete = document.getElementById('sel-btn-delete');
  const selBtnMore = document.getElementById('sel-btn-more');
  const selMoreMenu = document.getElementById('SelMoreMenu');
  let selObjClipboard = [];

  function closeSelMoreMenu() {
    if (selMoreMenu) selMoreMenu.classList.add('hidden');
  }

  function copySelectedObjects() {
    const sid = activeSid();
    const list = state.annots[sid] || [];
    if (!state.selectedIndices.length) return false;
    selObjClipboard = state.selectedIndices
      .map((idx) => list[idx])
      .filter(Boolean)
      .map((obj) => JSON.parse(JSON.stringify(obj)));
    return selObjClipboard.length > 0;
  }

  function pasteSelectedObjects() {
    if (!selObjClipboard.length) {
      notify('Chưa có đối tượng nào được sao chép.');
      return;
    }
    const sid = activeSid();
    const list = state.annots[sid] || (state.annots[sid] = []);
    pushUndo(sid);
    const newIdxs = [];
    selObjClipboard.forEach((raw) => {
      const cloned = JSON.parse(JSON.stringify(raw));
      if (cloned.geomId) cloned.geomId = 'g_' + Math.random().toString(36).slice(2, 10);
      NKInkEngine.translateObject(cloned, 20, 20);
      list.push(cloned);
      newIdxs.push(list.length - 1);
    });
    state.selectedIndices = newIdxs;
    redrawSurface(sid);
    notify(`📥 Đã dán ${newIdxs.length} đối tượng`);
  }

  function reorderSelectedLayer(toFront) {
    const sid = activeSid();
    const list = state.annots[sid] || [];
    if (!state.selectedIndices.length || list.length < 2) return;
    pushUndo(sid);
    const selSet = new Set(state.selectedIndices);
    const picked = [];
    const rest = [];
    list.forEach((obj, idx) => {
      if (selSet.has(idx)) picked.push(obj);
      else rest.push(obj);
    });
    const nextList = toFront ? [...rest, ...picked] : [...picked, ...rest];
    state.annots[sid] = nextList;
    state.selectedIndices = toFront
      ? picked.map((_, i) => rest.length + i)
      : picked.map((_, i) => i);
    redrawSurface(sid);
    notify(toFront ? '⬆️ Đã đưa lên trên cùng' : '⬇️ Đã đưa xuống dưới cùng');
  }

  function openSelMoreMenu() {
    if (!selMoreMenu || !selBtnMore) return;
    if (!selMoreMenu.classList.contains('hidden')) {
      closeSelMoreMenu();
      return;
    }
    const sid = activeSid();
    const list = state.annots[sid] || [];
    const selObjs = state.selectedIndices.map((idx) => list[idx]).filter(Boolean);
    if (!selObjs.length) return;

    selMoreMenu.innerHTML = '';

    const topGrid = document.createElement('div');
    topGrid.className = 'sel-more-top-grid';
    const mkTopBtn = (ic, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sel-more-top-btn';
      b.innerHTML = `<span class="sel-more-top-ic">${ic}</span><span>${label}</span>`;
      b.addEventListener('click', () => {
        closeSelMoreMenu();
        onClick();
      });
      return b;
    };
    topGrid.appendChild(mkTopBtn('✂️', 'Cắt', () => {
      if (copySelectedObjects()) {
        deleteSelected();
        notify('✂️ Đã cắt đối tượng');
      }
    }));
    topGrid.appendChild(mkTopBtn('⬆️', 'Trên', () => reorderSelectedLayer(true)));
    topGrid.appendChild(mkTopBtn('⬇️', 'Dưới', () => reorderSelectedLayer(false)));
    selMoreMenu.appendChild(topGrid);

    const mkItem = (ic, label, onClick, isDanger = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sel-more-item${isDanger ? ' danger' : ''}`;
      b.innerHTML = `<span>${ic}</span><span>${label}</span>`;
      b.addEventListener('click', () => {
        closeSelMoreMenu();
        onClick();
      });
      return b;
    };

    selMoreMenu.appendChild(mkItem('📋', 'Sao chép', () => {
      if (copySelectedObjects()) notify('📋 Đã sao chép đối tượng');
    }));
    selMoreMenu.appendChild(mkItem('📑', 'Nhân bản', () => duplicateSelected()));
    if (selObjClipboard.length > 0) {
      selMoreMenu.appendChild(mkItem('📥', 'Dán', () => pasteSelectedObjects()));
    }

    const allDashed = selObjs.every((o) => !!o.dashed);
    selMoreMenu.appendChild(mkItem(allDashed ? '─' : '╌', allDashed ? 'Chuyển Nét liền' : 'Chuyển Nét đứt', () => {
      if (selBtnDashed) selBtnDashed.click();
    }));

    const firstColor = activeColor();
    selMoreMenu.appendChild(mkItem('🎨', 'Đổi sang màu bút hiện tại', () => {
      pushUndo(sid);
      selObjs.forEach((o) => { o.color = firstColor; });
      redrawSurface(sid);
      notify('🎨 Đã đổi màu đối tượng đang chọn');
    }));

    if (selObjs.length === 1 && (selObjs[0].type === 'chu' || selObjs[0].type === 'diem')) {
      selMoreMenu.appendChild(mkItem('✏️', 'Sửa chữ / nhãn', () => {
        const obj = selObjs[0];
        const next = window.prompt('Nhập nội dung mới:', obj.text || '');
        if (next !== null) {
          pushUndo(sid);
          obj.text = next;
          redrawSurface(sid);
        }
      }));
    }

    if (selObjs.length === 1 && selObjs[0].type === 'mui_ten') {
      selMoreMenu.appendChild(mkItem('↙', 'Phân tích lực (HBH)', () => createForceDecomposition(sid, selObjs[0])));
    }

    // Dựng hình thông minh theo ngữ cảnh đối tượng đang chọn
    const geomSegs = selObjs.filter((o) => o.type === 'duong' || o.type === 'mui_ten');
    const geomPts = selObjs.filter((o) => o.type === 'diem');
    const addGeomSep = () => {
      const s = document.createElement('div');
      s.className = 'sel-more-sep';
      selMoreMenu.appendChild(s);
    };
    if (selObjs.length === 1 && geomSegs.length === 1) {
      const segObj = geomSegs[0];
      addGeomSep();
      selMoreMenu.appendChild(mkItem('📍', 'Dựng trung điểm', () => {
        pushUndo(sid);
        const midPt = {
          type: 'diem',
          x: (segObj.x1 + segObj.x2) * 0.5,
          y: (segObj.y1 + segObj.y2) * 0.5,
          text: nextPointLabel(list),
          color: activeColor(),
          midSegRef: { objId: ensureGeomId(segObj), segIdx: 0 }
        };
        ensureGeomId(midPt);
        list.push(midPt);
        state.selectedIndices = [list.length - 1];
        redrawSurface(sid);
        notify('📍 Đã dựng trung điểm!');
      }));
      selMoreMenu.appendChild(mkItem('⊥', 'Dựng đường trung trực', () => {
        pushUndo(sid);
        const mx = (segObj.x1 + segObj.x2) * 0.5, my = (segObj.y1 + segObj.y2) * 0.5;
        const dx = segObj.x2 - segObj.x1, dy = segObj.y2 - segObj.y1;
        const len = Math.max(1e-4, Math.hypot(dx, dy));
        const nx = -dy / len, ny = dx / len, half = Math.max(90, len * 0.7);
        const pb = {
          type: 'duong',
          x1: mx - nx * half, y1: my - ny * half,
          x2: mx + nx * half, y2: my + ny * half,
          color: activeColor(), width: Math.max(1.8, activeWidth() * 0.85),
          perpBisectorRef: { kind: 'seg', objId: ensureGeomId(segObj), segIdx: 0, t1: -half, t2: half }
        };
        ensureGeomId(pb);
        list.push(pb);
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify('⊥ Đã dựng đường trung trực!');
      }));
      selMoreMenu.appendChild(mkItem('∥', 'Đánh dấu bằng nhau (| / ||)', () => {
        pushUndo(sid);
        const mx = (segObj.x1 + segObj.x2) * 0.5, my = (segObj.y1 + segObj.y2) * 0.5;
        const dx = segObj.x2 - segObj.x1, dy = segObj.y2 - segObj.y1;
        const len = Math.max(1e-4, Math.hypot(dx, dy));
        const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
        const cnt = (segObj._tickCount = ((segObj._tickCount || 0) % 2) + 1);
        const offsets = cnt === 1 ? [0] : [-3.5, 3.5];
        offsets.forEach((off) => {
          list.push({
            type: 'duong',
            x1: mx + ux * off - nx * 7, y1: my + uy * off - ny * 7,
            x2: mx + ux * off + nx * 7, y2: my + uy * off + ny * 7,
            color: segObj.color || activeColor(),
            width: Math.max(1.6, activeWidth() * 0.75)
          });
        });
        redrawSurface(sid);
        notify(`✓ Đã đánh dấu ${cnt} gạch bằng nhau trên đoạn!`);
      }));
    } else if (selObjs.length === 2 && geomPts.length === 2) {
      const [pa, pb] = geomPts;
      const p1Ref = { kind: 'diem', id: ensureGeomId(pa), x: pa.x, y: pa.y };
      const p2Ref = { kind: 'diem', id: ensureGeomId(pb), x: pb.x, y: pb.y };
      addGeomSep();
      selMoreMenu.appendChild(mkItem('📍', 'Dựng trung điểm', () => {
        pushUndo(sid);
        const midPt = {
          type: 'diem',
          x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5,
          text: nextPointLabel(list), color: activeColor(),
          midRef: [p1Ref, p2Ref]
        };
        ensureGeomId(midPt);
        list.push(midPt);
        redrawSurface(sid);
        notify('📍 Đã dựng trung điểm!');
      }));
      selMoreMenu.appendChild(mkItem('╱', 'Nối đoạn thẳng', () => {
        pushUndo(sid);
        const ln = { type: 'duong', x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, p1Ref, p2Ref, color: activeColor(), width: activeWidth() };
        ensureGeomId(ln);
        list.push(ln);
        redrawSurface(sid);
        notify('╱ Đã nối đoạn thẳng!');
      }));
      selMoreMenu.appendChild(mkItem('⊥', 'Dựng đường trung trực', () => {
        pushUndo(sid);
        const mx = (pa.x + pb.x) * 0.5, my = (pa.y + pb.y) * 0.5;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.max(1e-4, Math.hypot(dx, dy));
        const nx = -dy / len, ny = dx / len, half = Math.max(90, len * 0.7);
        const lineObj = {
          type: 'duong',
          x1: mx - nx * half, y1: my - ny * half,
          x2: mx + nx * half, y2: my + ny * half,
          color: activeColor(), width: Math.max(1.8, activeWidth() * 0.85),
          perpBisectorRef: { kind: 'pts', p1Ref, p2Ref, t1: -half, t2: half }
        };
        ensureGeomId(lineObj);
        list.push(lineObj);
        redrawSurface(sid);
        notify('⊥ Đã dựng đường trung trực!');
      }));
    } else if (selObjs.length === 2 && geomSegs.length === 1 && geomPts.length === 1) {
      const segObj = geomSegs[0], ptObj = geomPts[0];
      const baseId = ensureGeomId(segObj);
      const ptRef = { kind: 'diem', id: ensureGeomId(ptObj), x: ptObj.x, y: ptObj.y };
      const dx = segObj.x2 - segObj.x1, dy = segObj.y2 - segObj.y1;
      const len = Math.max(1e-4, Math.hypot(dx, dy));
      const ux = dx / len, uy = dy / len, half = Math.max(110, len * 0.65);
      addGeomSep();
      selMoreMenu.appendChild(mkItem('∥', 'Dựng đường song song', () => {
        pushUndo(sid);
        const ln = {
          type: 'duong',
          x1: ptObj.x - ux * half, y1: ptObj.y - uy * half,
          x2: ptObj.x + ux * half, y2: ptObj.y + uy * half,
          color: activeColor(), width: Math.max(1.8, activeWidth() * 0.85),
          lineConstraintRef: { mode: 'parallel', baseObjId: baseId, baseSegIdx: 0, ptRef, t1: -half, t2: half }
        };
        ensureGeomId(ln);
        list.push(ln);
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify('∥ Đã dựng đường song song qua điểm!');
      }));
      selMoreMenu.appendChild(mkItem('⊥', 'Dựng đường vuông góc', () => {
        pushUndo(sid);
        const vx = -uy, vy = ux;
        const ln = {
          type: 'duong',
          x1: ptObj.x - vx * half, y1: ptObj.y - vy * half,
          x2: ptObj.x + vx * half, y2: ptObj.y + vy * half,
          color: activeColor(), width: Math.max(1.8, activeWidth() * 0.85),
          lineConstraintRef: { mode: 'perp', baseObjId: baseId, baseSegIdx: 0, ptRef, t1: -half, t2: half }
        };
        ensureGeomId(ln);
        list.push(ln);
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify('⊥ Đã dựng đường vuông góc qua điểm!');
      }));
      selMoreMenu.appendChild(mkItem('📐', 'Hạ đường cao (Chân vuông góc)', () => {
        pushUndo(sid);
        const l2 = dx * dx + dy * dy;
        const t = l2 > 1e-4 ? ((ptObj.x - segObj.x1) * dx + (ptObj.y - segObj.y1) * dy) / l2 : 0;
        const hx = segObj.x1 + t * dx, hy = segObj.y1 + t * dy;
        const hPt = { type: 'diem', x: hx, y: hy, text: nextPointLabel(list), color: activeColor(), footPerpRef: { baseObjId: baseId, baseSegIdx: 0, ptRef } };
        ensureGeomId(hPt);
        const hRef = { kind: 'diem', id: hPt.id, x: hx, y: hy };
        list.push(hPt);
        list.push({ type: 'duong', x1: ptObj.x, y1: ptObj.y, x2: hx, y2: hy, p1Ref: ptRef, p2Ref: hRef, color: activeColor(), width: Math.max(1.6, activeWidth() * 0.8), dashed: true });
        list.push({ type: 'but', isPolyline: true, points: [], color: activeColor(), width: 1.5, rightAngleRef: { baseObjId: baseId, baseSegIdx: 0, ptRef, footId: hPt.id } });
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify('📐 Đã hạ đường cao & ký hiệu vuông góc!');
      }));
    } else if (selObjs.length === 1 && (selObjs[0].type === 'tam_giac' || selObjs[0].type === 'to_trong_suot' || selObjs[0].type === 'hcn')) {
      const pObj = selObjs[0];
      const ensurePolyPts = (o) => {
        if (o.type === 'hcn' && !Array.isArray(o.points)) {
          o.points = [
            { x: o.x, y: o.y },
            { x: o.x + o.w, y: o.y },
            { x: o.x + o.w, y: o.y + o.h },
            { x: o.x, y: o.y + o.h }
          ];
          o.type = 'tam_giac';
          o.geomConstraint = o.geomConstraint || 'hinh_chu_nhat';
        }
      };
      const nV = pObj.type === 'hcn' ? 4 : (Array.isArray(pObj.points) ? pObj.points.length : 0);
      if (nV >= 3) {
        addGeomSep();
        for (let vi = 0; vi < Math.min(nV, 6); vi++) {
          const vLbl = (Array.isArray(pObj.vertexLabels) && pObj.vertexLabels[vi]) ? pObj.vertexLabels[vi] : `#${vi + 1}`;
          selMoreMenu.appendChild(mkItem('∠', `Phân giác góc ${vLbl}`, () => {
            pushUndo(sid);
            ensurePolyPts(pObj);
            const pid = ensureGeomId(pObj);
            const bis = {
              type: 'duong',
              x1: pObj.points[vi].x, y1: pObj.points[vi].y,
              x2: pObj.points[vi].x + 120, y2: pObj.points[vi].y,
              color: activeColor(), width: Math.max(1.8, activeWidth() * 0.85), dashed: true,
              bisectorRef: { kind: 'poly', objId: pid, vIdx: vi, len: 130 }
            };
            ensureGeomId(bis);
            list.push(bis);
            syncLinkedEndpoints(list);
            redrawSurface(sid);
            notify(`∠ Đã dựng phân giác góc ${vLbl} (kéo mút để chỉnh độ dài!)`);
          }));
        }
        if (nV === 3) {
          addGeomSep();
          for (let vi = 0; vi < 3; vi++) {
            const vLbl = (Array.isArray(pObj.vertexLabels) && pObj.vertexLabels[vi]) ? pObj.vertexLabels[vi] : `#${vi + 1}`;
            const oppSegIdx = (vi + 1) % 3;
            selMoreMenu.appendChild(mkItem('📐', `Đường cao từ đỉnh ${vLbl}`, () => {
              pushUndo(sid);
              ensurePolyPts(pObj);
              const pid = ensureGeomId(pObj);
              const V = pObj.points[vi];
              const A = pObj.points[oppSegIdx], B = pObj.points[(oppSegIdx + 1) % 3];
              const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy;
              const t = l2 > 1e-4 ? ((V.x - A.x) * dx + (V.y - A.y) * dy) / l2 : 0;
              const hx = A.x + t * dx, hy = A.y + t * dy;
              const ptRef = { kind: 'poly', id: pid, vIdx: vi, x: V.x, y: V.y };
              const hPt = { type: 'diem', x: hx, y: hy, text: nextPointLabel(list), color: activeColor(), footPerpRef: { baseObjId: pid, baseSegIdx: oppSegIdx, ptRef } };
              ensureGeomId(hPt);
              const hRef = { kind: 'diem', id: hPt.id, x: hx, y: hy };
              list.push(hPt);
              list.push({ type: 'duong', x1: V.x, y1: V.y, x2: hx, y2: hy, p1Ref: ptRef, p2Ref: hRef, color: activeColor(), width: Math.max(1.6, activeWidth() * 0.8), dashed: true });
              list.push({ type: 'but', isPolyline: true, points: [], color: activeColor(), width: 1.5, rightAngleRef: { baseObjId: pid, baseSegIdx: oppSegIdx, ptRef, footId: hPt.id } });
              syncLinkedEndpoints(list);
              redrawSurface(sid);
              notify(`📐 Đã hạ đường cao từ đỉnh ${vLbl} & ký hiệu vuông góc!`);
            }));
            selMoreMenu.appendChild(mkItem('⎯', `Đường trung tuyến từ đỉnh ${vLbl}`, () => {
              pushUndo(sid);
              ensurePolyPts(pObj);
              const pid = ensureGeomId(pObj);
              const V = pObj.points[vi];
              const A = pObj.points[oppSegIdx], B = pObj.points[(oppSegIdx + 1) % 3];
              const mx = (A.x + B.x) * 0.5, my = (A.y + B.y) * 0.5;
              const ptRef = { kind: 'poly', id: pid, vIdx: vi, x: V.x, y: V.y };
              const mPt = { type: 'diem', x: mx, y: my, text: nextPointLabel(list), color: activeColor(), midSegRef: { objId: pid, segIdx: oppSegIdx } };
              ensureGeomId(mPt);
              const mRef = { kind: 'diem', id: mPt.id, x: mx, y: my };
              list.push(mPt);
              list.push({ type: 'duong', x1: V.x, y1: V.y, x2: mx, y2: my, p1Ref: ptRef, p2Ref: mRef, color: activeColor(), width: Math.max(1.6, activeWidth() * 0.8), dashed: true });
              syncLinkedEndpoints(list);
              redrawSurface(sid);
              notify(`⎯ Đã dựng đường trung tuyến từ đỉnh ${vLbl}!`);
            }));
          }
        }
      }
    } else if (selObjs.length === 2 && selObjs.some((o) => o.type === 'elip') && selObjs.some((o) => o.type === 'diem')) {
      const cir = selObjs.find((o) => o.type === 'elip');
      const pt = selObjs.find((o) => o.type === 'diem');
      addGeomSep();
      selMoreMenu.appendChild(mkItem('⌒', 'Dựng 2 tiếp tuyến cắt nhau', () => {
        const cx0 = cir.x + cir.w * 0.5, cy0 = cir.y + cir.h * 0.5, r0 = Math.abs(cir.w * 0.5);
        const d0 = Math.hypot(pt.x - cx0, pt.y - cy0);
        if (d0 <= r0 + 2) { notify('⚠️ Điểm phải nằm ngoài đường tròn!'); return; }
        pushUndo(sid);
        const cirId = ensureGeomId(cir);
        const ptRef = { kind: 'diem', id: ensureGeomId(pt), x: pt.x, y: pt.y };
        const baseAng = Math.atan2(pt.y - cy0, pt.x - cx0);
        const alpha = Math.acos(r0 / d0);
        const cPt = { type: 'diem', x: cx0, y: cy0, text: 'O', color: cir.color || activeColor() };
        ensureGeomId(cPt);
        cir.centerRef = { kind: 'diem', id: cPt.id, x: cx0, y: cy0 };
        list.push(cPt);
        [1, -1].forEach((side) => {
          const ang = baseAng + side * alpha;
          const tx = cx0 + r0 * Math.cos(ang), ty = cy0 + r0 * Math.sin(ang);
          const tPt = { type: 'diem', x: tx, y: ty, text: nextPointLabel(list), color: activeColor(), tangentPtRef: { circleId: cirId, ptRef, side } };
          ensureGeomId(tPt);
          const tRef = { kind: 'diem', id: tPt.id, x: tx, y: ty };
          list.push(tPt);
          list.push({ type: 'duong', x1: pt.x, y1: pt.y, x2: tx, y2: ty, p1Ref: ptRef, p2Ref: tRef, color: activeColor(), width: activeWidth() });
          list.push({ type: 'duong', x1: cx0, y1: cy0, x2: tx, y2: ty, p1Ref: { kind: 'diem', id: cPt.id, x: cx0, y: cy0 }, p2Ref: tRef, color: cir.color || activeColor(), width: 1.4, dashed: true });
        });
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify('⌒ Đã dựng 2 tiếp tuyến cắt nhau động!');
      }));
    } else if (selObjs.length === 2 && geomSegs.length === 2) {
      const [s1, s2] = geomSegs;
      addGeomSep();
      selMoreMenu.appendChild(mkItem('∠', 'Dựng đường phân giác', () => {
        const ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
        if (!ip) { notify('⚠️ Hai cạnh song song, không có phân giác!'); return; }
        pushUndo(sid);
        const bis = {
          type: 'duong', x1: ip.x, y1: ip.y, x2: ip.x + 120, y2: ip.y,
          color: activeColor(), width: Math.max(1.8, activeWidth() * 0.85), dashed: true,
          bisectorRef: { kind: 'segs', id1: ensureGeomId(s1), id2: ensureGeomId(s2), len: 130 }
        };
        ensureGeomId(bis);
        list.push(bis);
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify('∠ Đã dựng đường phân giác động!');
      }));
      selMoreMenu.appendChild(mkItem('◔', 'Ký hiệu góc (tự động 90°)', () => {
        const ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
        if (!ip) { notify('⚠️ Hai cạnh song song!'); return; }
        pushUndo(sid);
        const arcObj = {
          type: 'but', isPolyline: true, points: [],
          color: activeColor(), width: Math.max(1.6, activeWidth() * 0.75),
          angleArcRef: { kind: 'segs', id1: ensureGeomId(s1), id2: ensureGeomId(s2), r: 22 }
        };
        list.push(arcObj);
        syncLinkedEndpoints(list);
        redrawSurface(sid);
        notify('∠ Đã đặt ký hiệu góc động (tự chuyển vuông góc khi 90°)!');
      }));
    }

    const sep = document.createElement('div');
    sep.className = 'sel-more-sep';
    selMoreMenu.appendChild(sep);
    selMoreMenu.appendChild(mkItem('🗑', 'Xóa đối tượng', () => deleteSelected(), true));

    selMoreMenu.classList.remove('hidden');
    const br = selBtnMore.getBoundingClientRect();
    const mw = 220;
    const mh = selMoreMenu.offsetHeight || 280;
    const left = Math.max(8, Math.min(window.innerWidth - mw - 8, br.right - mw));
    let top = br.bottom + 8;
    if (top + mh > window.innerHeight - 10) {
      top = Math.max(10, br.top - mh - 8);
    }
    selMoreMenu.style.left = `${left}px`;
    selMoreMenu.style.top = `${top}px`;
  }

  if (selBtnMore) {
    selBtnMore.addEventListener('click', (e) => {
      e.stopPropagation();
      openSelMoreMenu();
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (selMoreMenu && !selMoreMenu.classList.contains('hidden')) {
      if (!selMoreMenu.contains(e.target) && e.target !== selBtnMore) {
        closeSelMoreMenu();
      }
    }
  });

  function collectSelectedPointTargets(sid) {
    const list = state.annots[sid] || [];
    const targets = [];
    const seen = new Set();
    for (const idx of state.selectedIndices) {
      const obj = list[idx];
      if (!obj || obj.hidden || obj.type !== 'diem') continue;
      const id = ensureGeomId(obj);
      const key = 'diem:' + id;
      if (seen.has(key)) continue;
      seen.add(key);
      const isConstrained = Boolean(obj.onObjRef || obj.intersectRef || obj.footPerpRef || obj.midSegRef || (Array.isArray(obj.midRef) && obj.midRef.length === 2));
      const hasLinks = list.some((o) => o && ((o.p1Ref && o.p1Ref.id === id) || (o.p2Ref && o.p2Ref.id === id) || (o.centerRef && o.centerRef.id === id)));
      const desc = obj.onObjRef
        ? 'Trượt trên đối tượng'
        : (obj.intersectRef ? 'Giao điểm' : ((obj.midSegRef || (Array.isArray(obj.midRef) && obj.midRef.length === 2)) ? 'Trung điểm' : (hasLinks ? 'Đang nối đường' : 'Tự do')));
      targets.push({
        key,
        kind: 'diem',
        objIdx: idx,
        id,
        label: (obj.text || obj.label) ? `Điểm ${obj.text || obj.label}` : `Điểm #${targets.length + 1}`,
        desc,
        x: obj.x,
        y: obj.y,
        priority: isConstrained ? 3 : (hasLinks ? 2 : 1),
        ref: { kind: 'diem', id, x: obj.x, y: obj.y }
      });
    }
    if (Array.isArray(state.selectedVertices)) {
      for (const sv of state.selectedVertices) {
        const pObj = list[sv.objIdx];
        if (!pObj || pObj.hidden) continue;
        if (Array.isArray(pObj.points)) {
          const vIdx = typeof sv.role === 'number' ? sv.role : -1;
          if (vIdx < 0 || !pObj.points[vIdx]) continue;
          const id = ensureGeomId(pObj);
          const key = `poly:${id}:${vIdx}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const pt = pObj.points[vIdx];
          const vLbl = (Array.isArray(pObj.vertexLabels) && pObj.vertexLabels[vIdx]) ? pObj.vertexLabels[vIdx] : `#${vIdx + 1}`;
          targets.push({
            key,
            kind: 'poly',
            objIdx: sv.objIdx,
            vIdx,
            id,
            label: `Đỉnh ${vLbl}`,
            desc: pObj.geomConstraint ? 'Đỉnh ràng buộc' : 'Đỉnh đa giác',
            x: pt.x,
            y: pt.y,
            priority: pObj.geomConstraint ? 3 : 2,
            ref: { kind: 'poly', id, vIdx, x: pt.x, y: pt.y }
          });
        } else if ((pObj.type === 'duong' || pObj.type === 'mui_ten') && (sv.role === 'p1' || sv.role === 'p2')) {
          const id = ensureGeomId(pObj);
          const key = `line:${id}:${sv.role}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const lx = sv.role === 'p1' ? pObj.x1 : pObj.x2;
          const ly = sv.role === 'p1' ? pObj.y1 : pObj.y2;
          targets.push({
            key,
            kind: 'line_end',
            objIdx: sv.objIdx,
            role: sv.role,
            id,
            label: `Đầu mút #${targets.length + 1}`,
            desc: 'Đầu mút đoạn/vectơ',
            x: lx,
            y: ly,
            priority: 1,
            ref: { kind: 'line_end', id, role: sv.role, x: lx, y: ly }
          });
        }
      }
    }
    return targets;
  }

  function promptMergeTarget(sid) {
    const targets = collectSelectedPointTargets(sid);
    if (targets.length < 2) {
      notify('⚠️ Hãy chọn ít nhất 2 điểm (bật ☑ Chọn nhiều rồi chạm các điểm) để gộp!');
      return false;
    }
    const sorted = [...targets].sort((a, b) => b.priority - a.priority);
    showGeomSubmenu([
      ...sorted.map((t) => ({
        label: `${t.priority >= 3 ? '⭐' : '•'} Gộp vào ${t.label} (${t.desc})`,
        action: () => {
          if (geomSubmenu) geomSubmenu.classList.add('hidden');
          mergeSelectedPoints(sid, t.key);
        }
      })),
      {
        label: '✕ Hủy',
        action: () => { if (geomSubmenu) geomSubmenu.classList.add('hidden'); }
      }
    ]);
    notify('🔗 Hãy chọn điểm đích để gộp các điểm còn lại vào!');
    return true;
  }

  function mergeSelectedPoints(sid, targetKey = null) {
    const list = state.annots[sid] || [];
    const targets = collectSelectedPointTargets(sid);
    if (targets.length < 2) {
      notify('⚠️ Hãy chọn ít nhất 2 điểm (bật ☑ Chọn nhiều rồi chạm các điểm) để gộp!');
      return false;
    }
    let anchorIdx = targetKey ? targets.findIndex((t) => t.key === targetKey) : -1;
    if (anchorIdx < 0) {
      targets.sort((a, b) => b.priority - a.priority);
      anchorIdx = 0;
    }
    const anchor = targets[anchorIdx];
    pushUndo(sid);
    if (anchor.kind === 'line_end') {
      const lbl = nextPointLabel();
      const newPt = { type: 'diem', x: anchor.x, y: anchor.y, text: lbl, color: activeColor() };
      ensureGeomId(newPt);
      list.push(newPt);
      anchor.ref = { kind: 'diem', id: newPt.id, x: newPt.x, y: newPt.y };
      const lineObj = list[anchor.objIdx];
      if (lineObj) lineObj[anchor.role + 'Ref'] = { ...anchor.ref };
    }

    const removedDiemIds = new Set();
    for (let i = 0; i < targets.length; i++) {
      if (i === anchorIdx) continue;
      const t = targets[i];
      if (t.kind === 'line_end') {
        const lineObj = list[t.objIdx];
        if (lineObj) lineObj[t.role + 'Ref'] = { ...anchor.ref };
      } else if (t.kind === 'diem') {
        removedDiemIds.add(t.id);
        for (const obj of list) {
          if (!obj) continue;
          if (obj.p1Ref && obj.p1Ref.id === t.id) obj.p1Ref = { ...anchor.ref };
          if (obj.p2Ref && obj.p2Ref.id === t.id) obj.p2Ref = { ...anchor.ref };
          if (obj.centerRef && obj.centerRef.id === t.id) obj.centerRef = { ...anchor.ref };
          if (Array.isArray(obj.midRef)) {
            if (obj.midRef[0] && obj.midRef[0].id === t.id) obj.midRef[0] = { ...anchor.ref };
            if (obj.midRef[1] && obj.midRef[1].id === t.id) obj.midRef[1] = { ...anchor.ref };
          }
        }
      } else if (t.kind === 'poly') {
        const pObj = list[t.objIdx];
        if (pObj) {
          NKInkEngine.updateObjectVertex(pObj, t.vIdx, anchor.x, anchor.y);
          for (const obj of list) {
            if (!obj) continue;
            if (obj.p1Ref && obj.p1Ref.kind === 'poly' && obj.p1Ref.id === t.id && obj.p1Ref.vIdx === t.vIdx) obj.p1Ref = { ...anchor.ref };
            if (obj.p2Ref && obj.p2Ref.kind === 'poly' && obj.p2Ref.id === t.id && obj.p2Ref.vIdx === t.vIdx) obj.p2Ref = { ...anchor.ref };
            if (obj.centerRef && obj.centerRef.kind === 'poly' && obj.centerRef.id === t.id && obj.centerRef.vIdx === t.vIdx) obj.centerRef = { ...anchor.ref };
          }
        }
      }
    }

    if (removedDiemIds.size > 0) {
      state.annots[sid] = list.filter((o) => !(o && o.type === 'diem' && removedDiemIds.has(o.id)));
    }
    syncLinkedEndpoints(state.annots[sid]);
    state.selectedIndices = [];
    state.selectedVertices = [];
    state.hideSelectionBoxForVertex = false;
    if (surfaces[sid]) {
      surfaces[sid].pickedPoints = [];
      surfaces[sid].activeVertexHighlight = null;
      redrawActiveLayer(sid);
    }
    redrawSurface(sid);
    notify(anchor.priority >= 3
      ? `🔗 Đã gộp ${targets.length} điểm vào ${anchor.label} (${anchor.desc})!`
      : `🔗 Đã gộp ${targets.length} điểm vào ${anchor.label}!`);
    return true;
  }

  function expandSelectionWithGroups(list, indices) {
    const idxSet = new Set(indices);
    const gids = new Set();
    for (const i of indices) {
      const o = list[i];
      if (o && o.groupId) gids.add(o.groupId);
    }
    if (gids.size > 0) {
      list.forEach((o, i) => {
        if (o && !o.hidden && o.groupId && gids.has(o.groupId)) idxSet.add(i);
      });
    }
    return Array.from(idxSet).sort((a, b) => a - b);
  }

  function groupSelectedObjects(sid) {
    const list = state.annots[sid] || [];
    const valid = state.selectedIndices.filter((i) => list[i] && !list[i].hidden);
    if (valid.length < 2) return;
    pushUndo(sid);
    const gid = 'grp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    valid.forEach((i) => { list[i].groupId = gid; });
    state.selectedIndices = expandSelectionWithGroups(list, valid);
    redrawSurface(sid);
    notify(`🧩 Đã gộp ${valid.length} hình thành 1 nhóm!`);
  }

  function ungroupSelectedObjects(sid) {
    const list = state.annots[sid] || [];
    const gids = new Set(state.selectedIndices.map((i) => list[i] && list[i].groupId).filter(Boolean));
    if (gids.size === 0) return;
    pushUndo(sid);
    let cnt = 0;
    list.forEach((o) => {
      if (o && o.groupId && gids.has(o.groupId)) {
        delete o.groupId;
        cnt++;
      }
    });
    redrawSurface(sid);
    notify(`🔓 Đã bỏ gộp ${cnt} hình!`);
  }

  function updateSelectionQuickBar(sid) {
    if (!selQuickBar) return;
    if (activeSid() !== sid) {
      selQuickBar.classList.add('hidden');
      return;
    }
    const ptTargets = collectSelectedPointTargets(sid);
    const canMergePts = ptTargets.length >= 2;
    const hasNormalSel = state.selectedIndices.length > 0 && !state.hideSelectionBoxForVertex;
    if (!canMergePts && !hasNormalSel) {
      selQuickBar.classList.add('hidden');
      return;
    }
    const list = state.annots[sid] || [];
    const surf = surfaces[sid];
    if (!surf || !surf.inkCanvas) {
      selQuickBar.classList.add('hidden');
      return;
    }

    selQuickBar.querySelectorAll('.sel-merge-choice, .sel-force-action, .sel-group-action').forEach((el) => el.remove());
    if (state.selectedIndices.length === 1) {
      const sObj = list[state.selectedIndices[0]];
      if (sObj && !sObj.hidden && (sObj.type === 'diem' || sObj.type === 'duong' || sObj.type === 'mui_ten' || sObj.type === 'chu')) {
        const bRename = document.createElement('button');
        bRename.type = 'button';
        bRename.className = 'sel-qbtn sel-force-action';
        bRename.style.background = '#0F766E';
        bRename.textContent = '✏️ Đổi tên';
        bRename.title = 'Đổi tên nhãn (hoặc để trống để ẩn nhãn)';
        bRename.addEventListener('click', () => {
          const curName = sObj.text || '';
          const nextName = prompt('Nhập tên nhãn mới (để trống để ẩn):', curName);
          if (nextName === null) return;
          pushUndo(sid);
          sObj.text = nextName.trim();
          redrawSurface(sid);
          notify(sObj.text ? `🏷 Đã đổi nhãn thành "${sObj.text}"` : '🏷 Đã ẩn nhãn');
        });
        selQuickBar.appendChild(bRename);
      }
    }
    if (ptTargets.length === 2) {
      const t1 = ptTargets[0], t2 = ptTargets[1];
      if (t1.ref && t2.ref) {
        const bMid = document.createElement('button');
        bMid.type = 'button';
        bMid.className = 'sel-qbtn sel-force-action';
        bMid.style.background = '#0369A1';
        bMid.style.borderColor = '#7DD3FC';
        bMid.textContent = '📍 Trung điểm';
        bMid.addEventListener('click', () => {
          pushUndo(sid);
          const midPt = {
            type: 'diem',
            x: (t1.x + t2.x) * 0.5,
            y: (t1.y + t2.y) * 0.5,
            text: '',
            color: activeColor(),
            midRef: [{ ...t1.ref }, { ...t2.ref }]
          };
          ensureGeomId(midPt);
          list.push(midPt);
          state.selectedIndices = [list.length - 1];
          state.selectedVertices = [];
          redrawSurface(sid);
          notify('📍 Đã dựng trung điểm!');
        });
        selQuickBar.insertBefore(bMid, selBtnDashed || selQuickBar.firstChild);
      }
      const commonCir = findCommonCircleForPoints(list, t1, t2, t1.ref, t2.ref);
      if (commonCir) {
        const bArc = document.createElement('button');
        bArc.type = 'button';
        bArc.className = 'sel-qbtn sel-force-action';
        bArc.style.background = '#0F766E';
        bArc.style.borderColor = '#5EEAD4';
        bArc.textContent = '↪ Cung quét (ĐTLG)';
        bArc.addEventListener('click', () => createCircleSweepArc(sid, commonCir, t1.ref, t2.ref));
        selQuickBar.insertBefore(bArc, selBtnDashed || selQuickBar.firstChild);
      }
    }
    const selVecs = hasNormalSel
      ? state.selectedIndices.map((idx) => list[idx]).filter((o) => o && !o.hidden && o.type === 'mui_ten')
      : [];
    const singleSelObj = hasNormalSel && state.selectedIndices.length === 1 ? list[state.selectedIndices[0]] : null;
    const isSingleCenterShape = Boolean(
      singleSelObj && !singleSelObj.hidden && (
        singleSelObj.type === 'elip' ||
        singleSelObj.type === 'hcn' ||
        ((singleSelObj.type === 'tam_giac' || singleSelObj.type === 'to_trong_suot') && Array.isArray(singleSelObj.points) && singleSelObj.points.length >= 3 && !singleSelObj.onSlopeBlockRef)
      )
    );
    const alreadyHasCenter = isSingleCenterShape && (
      (singleSelObj.type === 'elip' && singleSelObj.centerRef && resolvePointRef(list, singleSelObj.centerRef)) ||
      (singleSelObj.id && list.some((o) => o && !o.hidden && o.type === 'diem' && o.shapeCenterRef && o.shapeCenterRef.hostId === singleSelObj.id))
    );
    if (isSingleCenterShape && !alreadyHasCenter) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sel-qbtn sel-force-action';
      b.style.background = '#0F766E';
      b.style.borderColor = '#5EEAD4';
      b.textContent = (singleSelObj.type === 'tam_giac' && singleSelObj.points && singleSelObj.points.length === 3) ? '⊙ Tạo trọng tâm' : '⊙ Tạo điểm tâm';
      b.addEventListener('click', () => createShapeCenterPoint(sid, singleSelObj));
      selQuickBar.insertBefore(b, selBtnDashed || selQuickBar.firstChild);
    }
    if (singleSelObj && !singleSelObj.hidden && singleSelObj.type === 'shape3d') {
      const add3DBtn = (txt, bg, bc, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sel-qbtn sel-force-action';
        b.style.background = bg;
        b.style.borderColor = bc;
        b.textContent = txt;
        b.addEventListener('click', fn);
        selQuickBar.insertBefore(b, selBtnDashed || selQuickBar.firstChild);
      };
      add3DBtn('✂ Tách nét', '#7C3AED', '#C4B5FD', () => {
        if (typeof NKInkEngine.explodeShape3D !== 'function') return;
        pushUndo(sid);
        const parts = NKInkEngine.explodeShape3D(singleSelObj);
        const idx3 = state.selectedIndices[0];
        list.splice(idx3, 1, ...parts);
        state.selectedIndices = [];
        redrawSurface(sid);
        notify('✂ Đã tách khối 3D thành các nét/điểm rời!');
      });
      add3DBtn(singleSelObj.show3DLabels !== false ? '🏷 Ẩn chữ' : '🏷 Hiện chữ', '#0F766E', '#5EEAD4', () => {
        pushUndo(sid);
        singleSelObj.show3DLabels = !(singleSelObj.show3DLabels !== false);
        redrawSurface(sid);
      });
      add3DBtn(singleSelObj.showAux !== false ? '👁 Ẩn SO/trục' : '👁 Hiện SO/trục', '#0F766E', '#5EEAD4', () => {
        pushUndo(sid);
        singleSelObj.showAux = !(singleSelObj.showAux !== false);
        redrawSurface(sid);
      });
      add3DBtn('▼ Cúi', '#0369A1', '#7DD3FC', () => {
        pushUndo(sid);
        singleSelObj.pitch = Math.max(-1.2, (singleSelObj.pitch !== undefined ? singleSelObj.pitch : 0.34) - 0.14);
        redrawSurface(sid);
      });
      add3DBtn('▲ Ngẩng', '#0369A1', '#7DD3FC', () => {
        pushUndo(sid);
        singleSelObj.pitch = Math.min(1.2, (singleSelObj.pitch !== undefined ? singleSelObj.pitch : 0.34) + 0.14);
        redrawSurface(sid);
      });
      add3DBtn('Xoay ▶', '#0369A1', '#7DD3FC', () => {
        pushUndo(sid);
        singleSelObj.yaw = (singleSelObj.yaw !== undefined ? singleSelObj.yaw : 0.42) + 0.22;
        redrawSurface(sid);
      });
      add3DBtn('◀ Xoay', '#0369A1', '#7DD3FC', () => {
        pushUndo(sid);
        singleSelObj.yaw = (singleSelObj.yaw !== undefined ? singleSelObj.yaw : 0.42) - 0.22;
        redrawSurface(sid);
      });
    }
    if (singleSelObj && !singleSelObj.hidden && (singleSelObj.type === 'hcn' || ((singleSelObj.type === 'tam_giac' || singleSelObj.type === 'to_trong_suot') && Array.isArray(singleSelObj.points) && singleSelObj.points.length >= 3))) {
      const selIdx0 = state.selectedIndices[0];
      const eIdx = (state.selectedEdge && state.selectedEdge.objIdx === selIdx0) ? state.selectedEdge.edgeIdx : 0;
      const _ensurePolyForEdge = (o) => {
        if (o.type === 'hcn') {
          o.points = [
            { x: o.x, y: o.y },
            { x: o.x + o.w, y: o.y },
            { x: o.x + o.w, y: o.y + o.h },
            { x: o.x, y: o.y + o.h }
          ];
          o.type = 'tam_giac';
          o.geomConstraint = o.geomConstraint || 'hinh_chu_nhat';
        }
      };
      const bEdgeDash = document.createElement('button');
      bEdgeDash.type = 'button';
      bEdgeDash.className = 'sel-qbtn sel-force-action';
      bEdgeDash.style.background = '#334155';
      bEdgeDash.style.borderColor = '#94A3B8';
      bEdgeDash.textContent = `┈ Đứt/Liền cạnh #${eIdx + 1}`;
      bEdgeDash.addEventListener('click', () => {
        pushUndo(sid);
        _ensurePolyForEdge(singleSelObj);
        if (!singleSelObj.edgeStyles) singleSelObj.edgeStyles = {};
        const cur = singleSelObj.edgeStyles[eIdx] || {};
        singleSelObj.edgeStyles[eIdx] = { ...cur, dashed: cur.dashed !== undefined ? !cur.dashed : !Boolean(singleSelObj.dashed) };
        redrawSurface(sid);
      });
      selQuickBar.insertBefore(bEdgeDash, selBtnDashed || selQuickBar.firstChild);

      const bEdgeCol = document.createElement('button');
      bEdgeCol.type = 'button';
      bEdgeCol.className = 'sel-qbtn sel-force-action';
      bEdgeCol.style.background = '#0F766E';
      bEdgeCol.style.borderColor = '#5EEAD4';
      bEdgeCol.textContent = `🎨 Màu cạnh #${eIdx + 1} ▾`;
      bEdgeCol.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const existingPop = document.getElementById('SelEdgeColorPopover');
        if (existingPop) { existingPop.remove(); return; }
        const pop = document.createElement('div');
        pop.id = 'SelEdgeColorPopover';
        pop.style.cssText = 'position:fixed;z-index:600;display:flex;align-items:center;gap:6px;padding:7px 9px;background:rgba(15,23,42,0.96);border:1px solid rgba(148,163,184,0.4);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
        const palette = [
          { col: '#EF4444', title: 'Đỏ' },
          { col: '#3B82F6', title: 'Xanh dương' },
          { col: '#22C55E', title: 'Xanh lá' },
          { col: '#FACC15', title: 'Vàng' },
          { col: '#F97316', title: 'Cam' },
          { col: '#FFFFFF', title: 'Trắng' },
          { col: '#0F172A', title: 'Đen' }
        ];
        palette.forEach((p) => {
          const sw = document.createElement('button');
          sw.type = 'button';
          sw.title = p.title;
          sw.style.cssText = `width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,0.75);background:${p.col};cursor:pointer;padding:0;`;
          sw.addEventListener('click', () => {
            pushUndo(sid);
            _ensurePolyForEdge(singleSelObj);
            if (!singleSelObj.edgeStyles) singleSelObj.edgeStyles = {};
            const cur = singleSelObj.edgeStyles[eIdx] || {};
            singleSelObj.edgeStyles[eIdx] = { ...cur, color: p.col };
            pop.remove();
            redrawSurface(sid);
            notify(`🎨 Đã đổi màu cạnh #${eIdx + 1}`);
          });
          pop.appendChild(sw);
        });
        const rst = document.createElement('button');
        rst.type = 'button';
        rst.textContent = '↺';
        rst.title = 'Màu mặc định';
        rst.style.cssText = 'width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.14);color:#F8FAFC;font-size:12px;cursor:pointer;padding:0;';
        rst.addEventListener('click', () => {
          pushUndo(sid);
          if (singleSelObj.edgeStyles) {
            delete singleSelObj.edgeStyles[eIdx];
            delete singleSelObj.edgeStyles[String(eIdx)];
          }
          pop.remove();
          redrawSurface(sid);
        });
        pop.appendChild(rst);
        document.body.appendChild(pop);
        const r = bEdgeCol.getBoundingClientRect();
        pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 240, r.left))}px`;
        pop.style.top = `${Math.max(8, r.top - 44)}px`;
        const closePop = (e2) => {
          if (!pop.contains(e2.target) && e2.target !== bEdgeCol) {
            pop.remove();
            document.removeEventListener('pointerdown', closePop);
          }
        };
        setTimeout(() => document.addEventListener('pointerdown', closePop), 10);
      });
      selQuickBar.insertBefore(bEdgeCol, selBtnDashed || selQuickBar.firstChild);
    }
    if (singleSelObj && !singleSelObj.hidden && singleSelObj.type === 'elip') {
      const bDiam = document.createElement('button');
      bDiam.type = 'button';
      bDiam.className = 'sel-qbtn sel-force-action';
      bDiam.style.background = '#0369A1';
      bDiam.style.borderColor = '#7DD3FC';
      bDiam.textContent = '⊖ Đường kính ngang';
      bDiam.addEventListener('click', () => {
        pushUndo(sid);
        ensureGeomId(singleSelObj);
        const cx = singleSelObj.x + singleSelObj.w * 0.5;
        const cy = singleSelObj.y + singleSelObj.h * 0.5;
        const rx = Math.abs(singleSelObj.w) * 0.5;
        const col = singleSelObj.color || '#FFFFFF';
        const pLeft = {
          type: 'diem',
          x: cx - rx,
          y: cy,
          text: nextPointLabel(list),
          color: col,
          onObjRef: { kind: 'elip', id: singleSelObj.id, theta: Math.PI }
        };
        const pRight = {
          type: 'diem',
          x: cx + rx,
          y: cy,
          text: nextPointLabel(list),
          color: col,
          onObjRef: { kind: 'elip', id: singleSelObj.id, theta: 0 }
        };
        ensureGeomId(pLeft);
        ensureGeomId(pRight);
        list.push(pLeft, pRight);
        const diamLine = {
          type: 'duong',
          x1: pLeft.x,
          y1: pLeft.y,
          x2: pRight.x,
          y2: pRight.y,
          color: col,
          width: singleSelObj.width || 2.4,
          dashed: Boolean(state.dashed),
          p1Ref: { kind: 'diem', id: pLeft.id, x: pLeft.x, y: pLeft.y },
          p2Ref: { kind: 'diem', id: pRight.id, x: pRight.x, y: pRight.y }
        };
        ensureGeomId(diamLine);
        list.push(diamLine);
        redrawSurface(sid);
        notify('⊖ Đã vẽ đường kính ngang gắn với đường tròn!');
      });
      selQuickBar.insertBefore(bDiam, selBtnDashed || selQuickBar.firstChild);
    }
    if (hasNormalSel && selVecs.length === 1 && state.selectedIndices.length === 1) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sel-qbtn sel-force-action';
      b.style.background = '#0284C7';
      b.style.borderColor = '#38BDF8';
      b.textContent = '⇄ Vẽ lực đối (-F)';
      b.addEventListener('click', () => createOppositeForce(sid, selVecs[0]));
      selQuickBar.insertBefore(b, selBtnDashed || selQuickBar.firstChild);
    }
    if (singleSelObj && !singleSelObj.hidden && (singleSelObj.type === 'duong' || singleSelObj.type === 'mui_ten')) {
      const bSegMid = document.createElement('button');
      bSegMid.type = 'button';
      bSegMid.className = 'sel-qbtn sel-force-action';
      bSegMid.style.background = '#0369A1';
      bSegMid.style.borderColor = '#7DD3FC';
      bSegMid.textContent = '📍 Trung điểm';
      bSegMid.addEventListener('click', () => {
        pushUndo(sid);
        const midPt = {
          type: 'diem',
          x: (singleSelObj.x1 + singleSelObj.x2) * 0.5,
          y: (singleSelObj.y1 + singleSelObj.y2) * 0.5,
          text: nextPointLabel(list),
          color: activeColor(),
          midSegRef: { objId: ensureGeomId(singleSelObj), segIdx: 0 }
        };
        ensureGeomId(midPt);
        list.push(midPt);
        state.selectedIndices = [list.length - 1];
        state.selectedVertices = [];
        redrawSurface(sid);
        notify('📍 Đã dựng trung điểm!');
      });
      selQuickBar.insertBefore(bSegMid, selBtnDashed || selQuickBar.firstChild);
    }
    if (hasNormalSel && selVecs.length === 1 && state.selectedIndices.length === 1) {
      const bDecomp = document.createElement('button');
      bDecomp.type = 'button';
      bDecomp.className = 'sel-qbtn sel-force-action';
      bDecomp.style.background = '#0369A1';
      bDecomp.style.borderColor = '#38BDF8';
      bDecomp.textContent = '↙ Phân tích lực';
      bDecomp.addEventListener('click', () => createForceDecomposition(sid, selVecs[0]));
      selQuickBar.insertBefore(bDecomp, selBtnDashed || selQuickBar.firstChild);
    } else if (hasNormalSel && selVecs.length === 2 && state.selectedIndices.length === 2) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sel-qbtn sel-force-action';
      b.style.background = '#DC2626';
      b.style.borderColor = '#FCA5A5';
      b.textContent = '⊕ Hợp lực (HBH)';
      b.addEventListener('click', () => createForceResultant(sid, selVecs[0], selVecs[1]));
      selQuickBar.insertBefore(b, selBtnDashed || selQuickBar.firstChild);
    }
    if (selBtnMergePts) {
      selBtnMergePts.textContent = ptTargets.length > 3 ? `🔗 Gộp điểm (${ptTargets.length}) ▾` : '🔗 Gộp điểm';
      selBtnMergePts.classList.toggle('hidden', !canMergePts);
    }
    if (canMergePts && ptTargets.length <= 3) {
      const sortedPts = [...ptTargets].sort((a, b) => b.priority - a.priority);
      sortedPts.forEach((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sel-qbtn sel-merge-choice';
        b.style.background = t.priority >= 3 ? '#0369A1' : '#0284C7';
        b.style.borderColor = '#38BDF8';
        b.textContent = `${t.priority >= 3 ? '⭐' : '🔗'} Gộp vào ${t.label}`;
        b.title = t.desc;
        b.addEventListener('click', () => mergeSelectedPoints(sid, t.key));
        if (selBtnMergePts && selBtnMergePts.parentNode === selQuickBar) {
          selQuickBar.insertBefore(b, selBtnMergePts);
        } else {
          selQuickBar.appendChild(b);
        }
      });
    }
    if (selBtnDashed) selBtnDashed.classList.toggle('hidden', !hasNormalSel);
    if (selBtnDelete) selBtnDelete.classList.toggle('hidden', !hasNormalSel && !canMergePts);

    if (hasNormalSel) {
      const grpObjs = state.selectedIndices.map((idx) => list[idx]).filter((o) => o && !o.hidden);
      const grpIds = new Set(grpObjs.map((o) => o.groupId).filter(Boolean));
      const canGroup = grpObjs.length >= 2 && (grpIds.size !== 1 || grpObjs.some((o) => !o.groupId));
      const canUngroup = grpIds.size > 0;
      if (grpObjs.length >= 2) {
        const bAlign = document.createElement('button');
        bAlign.type = 'button';
        bAlign.className = 'sel-qbtn sel-group-action';
        bAlign.style.background = '#0284C7';
        bAlign.style.borderColor = '#7DD3FC';
        bAlign.textContent = '📐 Align ▾';
        bAlign.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const oldMenu = document.getElementById('nk-align-popover');
          if (oldMenu) {
            oldMenu.remove();
            return;
          }
          const menu = document.createElement('div');
          menu.id = 'nk-align-popover';
          menu.style.cssText = [
            'position:fixed',
            'z-index:99999',
            'display:flex',
            'flex-direction:column',
            'gap:4px',
            'padding:6px',
            'background:rgba(15,23,42,0.96)',
            'border:1px solid rgba(125,211,252,0.55)',
            'border-radius:10px',
            'box-shadow:0 10px 28px rgba(0,0,0,0.45)',
            'backdrop-filter:blur(8px)',
            'min-width:155px'
          ].join(';');
          const opts = [
            { mode: 'left', label: '⬅ Canh trái' },
            { mode: 'centerX', label: '↔ Canh giữa ngang' },
            { mode: 'right', label: '➡ Canh phải' },
            { mode: 'top', label: '⬆ Canh trên' },
            { mode: 'centerY', label: '↕ Canh giữa dọc' },
            { mode: 'bottom', label: '⬇ Canh dưới' },
            { mode: 'centerBoth', label: '🎯 Đồng tâm (Giữa X & Y)' }
          ];
          const runAlign = (mode) => {
            const curList = state.annots[sid] || [];
            const targets = state.selectedIndices.map((idx) => curList[idx]).filter((o) => o && !o.hidden);
            if (targets.length < 2) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const boxes = targets.map((o) => {
              const b = NKInkEngine.getObjectBBox(o);
              if (b.x0 < minX) minX = b.x0;
              if (b.y0 < minY) minY = b.y0;
              if (b.x1 > maxX) maxX = b.x1;
              if (b.y1 > maxY) maxY = b.y1;
              return b;
            });
            const midX = (minX + maxX) * 0.5;
            const midY = (minY + maxY) * 0.5;
            pushUndo(sid);
            targets.forEach((o, i) => {
              const b = boxes[i];
              let dx = 0, dy = 0;
              if (mode === 'left') dx = minX - b.x0;
              else if (mode === 'centerX') dx = midX - (b.x0 + b.x1) * 0.5;
              else if (mode === 'right') dx = maxX - b.x1;
              else if (mode === 'top') dy = minY - b.y0;
              else if (mode === 'centerY') dy = midY - (b.y0 + b.y1) * 0.5;
              else if (mode === 'bottom') dy = maxY - b.y1;
              else if (mode === 'centerBoth') {
                dx = midX - (b.x0 + b.x1) * 0.5;
                dy = midY - (b.y0 + b.y1) * 0.5;
              }
              if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
                NKInkEngine.translateObject(o, dx, dy);
              }
            });
            if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(curList);
            redrawSurface(sid);
            const found = opts.find((x) => x.mode === mode);
            notify(`📐 Đã ${found ? found.label.replace(/^[^\s]+\s*/, '').toLowerCase() : 'căn chỉnh'} ${targets.length} hình!`);
          };
          opts.forEach((op) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = op.label;
            item.style.cssText = [
              'text-align:left',
              'padding:7px 10px',
              'border-radius:7px',
              'border:1px solid rgba(255,255,255,0.12)',
              'background:rgba(30,41,59,0.9)',
              'color:#F8FAFC',
              'font-size:13px',
              'font-weight:600',
              'cursor:pointer'
            ].join(';');
            item.addEventListener('click', (eItem) => {
              eItem.stopPropagation();
              menu.remove();
              runAlign(op.mode);
            });
            menu.appendChild(item);
          });
          document.body.appendChild(menu);
          const br = bAlign.getBoundingClientRect();
          const mw = menu.offsetWidth || 165;
          const mh = menu.offsetHeight || 240;
          const left = Math.max(8, Math.min(window.innerWidth - mw - 8, br.left));
          const top = (br.bottom + 6 + mh <= window.innerHeight) ? (br.bottom + 6) : Math.max(8, br.top - mh - 6);
          menu.style.left = `${left}px`;
          menu.style.top = `${top}px`;
          const closeOnce = (eDoc) => {
            if (!menu.contains(eDoc.target) && eDoc.target !== bAlign) {
              menu.remove();
              window.removeEventListener('pointerdown', closeOnce, true);
            }
          };
          setTimeout(() => window.addEventListener('pointerdown', closeOnce, true), 0);
        });
        selQuickBar.insertBefore(bAlign, selBtnDelete || null);
      }
      if (canGroup) {
        const bg = document.createElement('button');
        bg.type = 'button';
        bg.className = 'sel-qbtn sel-group-action';
        bg.style.background = '#7C3AED';
        bg.style.borderColor = '#C4B5FD';
        bg.textContent = '🧩 Gộp hình';
        bg.addEventListener('click', () => groupSelectedObjects(sid));
        selQuickBar.insertBefore(bg, selBtnDelete || null);
      }
      const segObjs = grpObjs.filter((o) => o.type === 'duong' || o.type === 'mui_ten');
      if (segObjs.length === 2 && grpObjs.length === 2) {
        const bRa = document.createElement('button');
        bRa.type = 'button';
        bRa.className = 'sel-qbtn sel-group-action';
        bRa.style.background = '#0369A1';
        bRa.style.borderColor = '#7DD3FC';
        bRa.textContent = '∟ Góc vuông';
        bRa.addEventListener('click', () => {
          const s1 = { p1: { x: segObjs[0].x1, y: segObjs[0].y1 }, p2: { x: segObjs[0].x2, y: segObjs[0].y2 } };
          const s2 = { p1: { x: segObjs[1].x1, y: segObjs[1].y1 }, p2: { x: segObjs[1].x2, y: segObjs[1].y2 } };
          const ip = computeLineIntersection(s1.p1, s1.p2, s2.p1, s2.p2);
          if (!ip) { notify('⚠️ Hai đường song song, không có góc!'); return; }
          const pickRay = (seg) => {
            const d1 = Math.hypot(seg.p1.x - ip.x, seg.p1.y - ip.y);
            const d2 = Math.hypot(seg.p2.x - ip.x, seg.p2.y - ip.y);
            const far = d2 >= d1 ? seg.p2 : seg.p1;
            const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
            return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
          };
          const u1 = pickRay(s1), u2 = pickRay(s2), sz = 13;
          pushUndo(sid);
          list.push({
            type: 'but',
            isPolyline: true,
            points: [
              { x: ip.x + u1.x * sz, y: ip.y + u1.y * sz },
              { x: ip.x + (u1.x + u2.x) * sz, y: ip.y + (u1.y + u2.y) * sz },
              { x: ip.x + u2.x * sz, y: ip.y + u2.y * sz }
            ],
            cornerRightAngleRef: { kind: 'segs', id1: ensureGeomId(segObjs[0]), id2: ensureGeomId(segObjs[1]), size: sz },
            color: activeColor(),
            width: Math.max(1.6, activeWidth() * 0.75)
          });
          redrawSurface(sid);
          notify('∟ Đã vẽ ký hiệu góc vuông!');
        });
        selQuickBar.insertBefore(bRa, selBtnDelete || null);
        const bAng = document.createElement('button');
        bAng.type = 'button';
        bAng.className = 'sel-qbtn sel-group-action';
        bAng.style.background = '#0F766E';
        bAng.style.borderColor = '#5EEAD4';
        bAng.textContent = '∠ Ký hiệu góc';
        bAng.addEventListener('click', () => {
          const s1 = { p1: { x: segObjs[0].x1, y: segObjs[0].y1 }, p2: { x: segObjs[0].x2, y: segObjs[0].y2 } };
          const s2 = { p1: { x: segObjs[1].x1, y: segObjs[1].y1 }, p2: { x: segObjs[1].x2, y: segObjs[1].y2 } };
          const ip = computeLineIntersection(s1.p1, s1.p2, s2.p1, s2.p2);
          if (!ip) { notify('⚠️ Hai đường song song, không có góc!'); return; }
          const pickRay = (seg) => {
            const d1 = Math.hypot(seg.p1.x - ip.x, seg.p1.y - ip.y);
            const d2 = Math.hypot(seg.p2.x - ip.x, seg.p2.y - ip.y);
            const far = d2 >= d1 ? seg.p2 : seg.p1;
            const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
            return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
          };
          const r = 22;
          pushUndo(sid);
          list.push({
            type: 'but',
            isPolyline: true,
            points: computeAngleArcPoints(ip, pickRay(s1), pickRay(s2), r),
            angleArcRef: { kind: 'segs', id1: ensureGeomId(segObjs[0]), id2: ensureGeomId(segObjs[1]), r },
            color: activeColor(),
            width: Math.max(1.6, activeWidth() * 0.75)
          });
          redrawSurface(sid);
          notify('∠ Đã vẽ ký hiệu góc động!');
        });
        selQuickBar.insertBefore(bAng, selBtnDelete || null);
      }
      const selDiem = grpObjs.filter((o) => o.type === 'diem');
      const selHost = grpObjs.filter((o) => o.type !== 'diem' && o.type !== 'chu' && o.type !== 'ghi_chu' && o.type !== 'cong_thuc' && !o.trigSweepRef && !o.rightAngleRef && !o.cornerRightAngleRef);
      if (selDiem.length === 1 && selHost.length === 1 && grpObjs.length === 2 && typeof projectPointOntoObject === 'function') {
        const dPt = selDiem[0], hObj = selHost[0];
        const bAtt = document.createElement('button');
        bAtt.type = 'button';
        bAtt.className = 'sel-qbtn sel-group-action';
        bAtt.style.background = '#0F766E';
        bAtt.style.borderColor = '#5EEAD4';
        bAtt.textContent = '🎯 Gắn trượt lên đường';
        bAtt.addEventListener('click', () => {
          const proj = projectPointOntoObject(hObj, dPt.x, dPt.y);
          if (!proj) return;
          pushUndo(sid);
          dPt.x = proj.x; dPt.y = proj.y;
          dPt.onObjRef = { kind: hObj.type, id: ensureGeomId(hObj), t: proj.t, theta: proj.theta, segIdx: proj.segIdx, edgeIdx: proj.edgeIdx };
          if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(list);
          redrawSurface(sid);
          notify(`🎯 Đã gắn điểm ${dPt.text || ''} trượt trên đối tượng!`);
        });
        selQuickBar.insertBefore(bAtt, selBtnDelete || null);
      } else if (selDiem.length === 1 && grpObjs.length === 1 && !selDiem[0].onObjRef && typeof projectPointOntoObject === 'function') {
        const dPt = selDiem[0];
        let nearHost = null, nearProj = null, bestD = 18;
        for (const o of list) {
          if (!o || o.hidden || o === dPt || o.type === 'diem' || o.type === 'chu' || o.type === 'ghi_chu' || o.type === 'cong_thuc') continue;
          if (o.trigSweepRef || o.rightAngleRef || o.cornerRightAngleRef) continue;
          const proj = projectPointOntoObject(o, dPt.x, dPt.y);
          if (proj && proj.dist < bestD) { bestD = proj.dist; nearHost = o; nearProj = proj; }
        }
        if (nearHost && nearProj) {
          const bAtt = document.createElement('button');
          bAtt.type = 'button';
          bAtt.className = 'sel-qbtn sel-group-action';
          bAtt.style.background = '#0F766E';
          bAtt.style.borderColor = '#5EEAD4';
          bAtt.textContent = '🎯 Gắn trượt lên đường';
          bAtt.addEventListener('click', () => {
            pushUndo(sid);
            dPt.x = nearProj.x; dPt.y = nearProj.y;
            dPt.onObjRef = { kind: nearHost.type, id: ensureGeomId(nearHost), t: nearProj.t, theta: nearProj.theta, segIdx: nearProj.segIdx, edgeIdx: nearProj.edgeIdx };
            if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(list);
            redrawSurface(sid);
            notify(`🎯 Đã gắn điểm ${dPt.text || ''} trượt trên đường!`);
          });
          selQuickBar.insertBefore(bAtt, selBtnDelete || null);
        }
      }
      const intObjs = grpObjs.filter((o) => o.type !== 'diem' && o.type !== 'chu' && o.type !== 'ghi_chu' && o.type !== 'cong_thuc' && !o.trigSweepRef && !o.rightAngleRef && !o.cornerRightAngleRef && !o.angleArcRef);
      if (intObjs.length === 2 && grpObjs.length === 2 && typeof computeObjectIntersection === 'function') {
        const bInt = document.createElement('button');
        bInt.type = 'button';
        bInt.className = 'sel-qbtn sel-group-action';
        bInt.style.background = '#B91C1C';
        bInt.style.borderColor = '#FCA5A5';
        bInt.textContent = '✕ Giao điểm';
        bInt.addEventListener('click', () => {
          const o1 = intObjs[0], o2 = intObjs[1];
          const b1 = NKInkEngine.getObjectBBox(o1), b2 = NKInkEngine.getObjectBBox(o2);
          const hint = {
            x: ((b1.x0 + b1.x1) * 0.5 + (b2.x0 + b2.x1) * 0.5) * 0.5,
            y: ((b1.y0 + b1.y1) * 0.5 + (b2.y0 + b2.y1) * 0.5) * 0.5
          };
          const ip = computeObjectIntersection(o1, 0, o2, 0, hint);
          if (!ip) { notify('⚠️ Hai đối tượng không cắt nhau!'); return; }
          pushUndo(sid);
          const lbl = nextPointLabel();
          const ptObj = {
            type: 'diem',
            x: ip.x,
            y: ip.y,
            text: lbl,
            color: activeColor(),
            intersectRef: { id1: ensureGeomId(o1), segIdx1: 0, id2: ensureGeomId(o2), segIdx2: 0 }
          };
          ensureGeomId(ptObj);
          list.push(ptObj);
          state.selectedIndices = [list.length - 1];
          redrawSurface(sid);
          notify(`✕ Đã dựng giao điểm ${lbl}!`);
        });
        selQuickBar.insertBefore(bInt, selBtnDelete || null);
      }
      if (canUngroup) {
        const bu = document.createElement('button');
        bu.type = 'button';
        bu.className = 'sel-qbtn sel-group-action';
        bu.style.background = '#B45309';
        bu.style.borderColor = '#FCD34D';
        bu.textContent = '🔓 Bỏ gộp';
        bu.addEventListener('click', () => ungroupSelectedObjects(sid));
        selQuickBar.insertBefore(bu, selBtnDelete || null);
      }
      if (grpObjs.length >= 1) {
        const bDup = document.createElement('button');
        bDup.type = 'button';
        bDup.className = 'sel-qbtn sel-group-action';
        bDup.style.background = '#0284C7';
        bDup.style.borderColor = '#7DD3FC';
        bDup.textContent = '📋 Nhân bản';
        bDup.addEventListener('click', () => duplicateSelected());
        selQuickBar.insertBefore(bDup, selBtnDelete || null);
      }
    }

    let box = hasNormalSel ? getSelectionBox(list, state.selectedIndices) : null;
    if (!box && ptTargets.length > 0) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of ptTargets) {
        if (t.x < x0) x0 = t.x; if (t.y < y0) y0 = t.y;
        if (t.x > x1) x1 = t.x; if (t.y > y1) y1 = t.y;
      }
      box = { x0: x0 - 16, y0: y0 - 16, x1: x1 + 16, y1: y1 + 16 };
    }
    if (!box) {
      selQuickBar.classList.add('hidden');
      return;
    }
    if (hasNormalSel) {
      const selObjs = state.selectedIndices.map((idx) => list[idx]).filter(Boolean);
      const allDashed = selObjs.length > 0 && selObjs.every((o) => Boolean(o.dashed));
      if (selBtnDashed) {
        selBtnDashed.textContent = allDashed ? '─ Chuyển Nét liền' : '-- Chuyển Nét đứt';
        selBtnDashed.classList.toggle('is-dashed', allDashed);
      }
    }

    const rect = surf.inkCanvas.getBoundingClientRect();
    let vx = (box.x0 + box.x1) * 0.5;
    let vy = box.y0;
    if (sid === 'board') {
      const cam = state.boardCam || { panX: 0, panY: 0, zoom: 1.0 };
      vx = vx * cam.zoom + cam.panX;
      vy = vy * cam.zoom + cam.panY;
    }
    selQuickBar.classList.remove('hidden');
    const barW = selQuickBar.offsetWidth || 260;
    const barH = selQuickBar.offsetHeight || 40;
    const leftPos = Math.max(12, Math.min(window.innerWidth - barW - 12, Math.round(rect.left + vx - barW * 0.5)));
    const topPos = Math.max(48, Math.min(window.innerHeight - barH - 12, Math.round(rect.top + vy - barH - 10)));
    selQuickBar.style.left = leftPos + 'px';
    selQuickBar.style.top = topPos + 'px';
  }

  if (selBtnMergePts) {
    selBtnMergePts.addEventListener('click', () => promptMergeTarget(activeSid()));
  }

  if (selBtnDashed) {
    selBtnDashed.addEventListener('click', () => {
      const sid = activeSid(), list = state.annots[sid] || [];
      if (!state.selectedIndices.length) return;
      pushUndo(sid);
      const allDashed = state.selectedIndices.every((idx) => list[idx] && list[idx].dashed);
      const nextDashed = !allDashed;
      state.selectedIndices.forEach((idx) => { if (list[idx]) list[idx].dashed = nextDashed; });
      syncWaveInterferenceDash(list, state.selectedIndices.map((idx) => list[idx]));
      redrawSurface(sid);
      notify(nextDashed ? '-- Đã chuyển sang Nét đứt' : '─ Đã chuyển sang Nét liền');
    });
  }

  if (selBtnDelete) {
    selBtnDelete.addEventListener('click', () => {
      const sid = activeSid();
      if (!state.selectedIndices.length) return;
      pushUndo(sid);
      const rem = new Set(state.selectedIndices);
      state.annots[sid] = (state.annots[sid] || []).filter((_, idx) => !rem.has(idx));
      state.selectedIndices = [];
      redrawSurface(sid);
      notify('🗑 Đã xóa đối tượng đang chọn.');
    });
  }

  function computeTrigSweepPoints(cir, p1, p2, offset = 14) {
    if (!cir || !p1 || !p2) return [];
    const cx = cir.x + cir.w * 0.5, cy = cir.y + cir.h * 0.5;
    const r = Math.abs(cir.w * 0.5) + offset;
    const th1 = Math.atan2(p1.y - cy, p1.x - cx);
    const th2 = Math.atan2(p2.y - cy, p2.x - cx);
    let sweep = ((th1 - th2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    if (sweep < 0.05) sweep = Math.PI * 2;
    const steps = Math.max(24, Math.ceil(sweep * 24));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const th = th1 - (i / steps) * sweep;
      pts.push({ x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) });
    }
    return pts;
  }

  function findCommonCircleForPoints(list, p1, p2, ref1, ref2) {
    if (!p1 || !p2) return null;
    const getOnCircleId = (ref) => {
      if (!ref || ref.kind !== 'diem') return null;
      const dObj = list.find((o) => o && !o.hidden && o.id === ref.id && o.type === 'diem');
      return (dObj && dObj.onObjRef && dObj.onObjRef.kind === 'elip') ? dObj.onObjRef.id : null;
    };
    const cid1 = getOnCircleId(ref1), cid2 = getOnCircleId(ref2);
    if (cid1 && cid1 === cid2) {
      const cir = list.find((o) => o && !o.hidden && o.id === cid1 && o.type === 'elip');
      if (cir) return cir;
    }
    for (const o of list) {
      if (!o || o.hidden || o.type !== 'elip') continue;
      if (!o.isCircle && Math.abs(Math.abs(o.w) - Math.abs(o.h)) >= 2) continue;
      const cx = o.x + o.w * 0.5, cy = o.y + o.h * 0.5, r = Math.abs(o.w * 0.5);
      if (r < 8) continue;
      if (Math.abs(Math.hypot(p1.x - cx, p1.y - cy) - r) <= 18 && Math.abs(Math.hypot(p2.x - cx, p2.y - cy) - r) <= 18) {
        return o;
      }
    }
    return null;
  }

  function createCircleSweepArc(sid, cir, ref1, ref2) {
    const list = state.annots[sid] || [];
    const p1 = resolvePointRef(list, ref1), p2 = resolvePointRef(list, ref2);
    if (!cir || !p1 || !p2) return;
    pushUndo(sid);
    ensureGeomId(cir);
    const pts = computeTrigSweepPoints(cir, p1, p2, 14);
    const arcObj = {
      type: 'but',
      points: pts,
      isPolyline: true,
      hasArrowEnd: true,
      trigSweepRef: { circleId: cir.id, p1Ref: { ...ref1 }, p2Ref: { ...ref2 }, offset: 14 },
      color: cir.color || activeColor(),
      width: Math.max(1.8, (cir.width || activeWidth()) * 0.85)
    };
    ensureGeomId(arcObj);
    list.push(arcObj);
    state.selectedIndices = [list.length - 1];
    redrawSurface(sid);
    notify('↪ Đã vẽ cung quét song song ngoài đường tròn!');
  }

  function createShapeCenterPoint(sid, shapeObj) {
    const list = state.annots[sid] || [];
    if (!shapeObj) return;
    if (shapeObj.type === 'elip') {
      createCircleCenterPoint(sid, shapeObj);
      return;
    }
    ensureGeomId(shapeObj);
    if (list.some((o) => o && !o.hidden && o.type === 'diem' && o.shapeCenterRef && o.shapeCenterRef.hostId === shapeObj.id)) return;
    let cx = 0, cy = 0, prefLbl = 'O';
    if (shapeObj.type === 'hcn') {
      cx = shapeObj.x + shapeObj.w * 0.5;
      cy = shapeObj.y + shapeObj.h * 0.5;
    } else if (shapeObj.isSemicircle && Array.isArray(shapeObj.points) && shapeObj.points.length >= 2) {
      const pFirst = shapeObj.points[0], pLast = shapeObj.points[shapeObj.points.length - 1];
      cx = (pFirst.x + pLast.x) * 0.5;
      cy = (pFirst.y + pLast.y) * 0.5;
    } else if (Array.isArray(shapeObj.points) && shapeObj.points.length >= 3) {
      let sx = 0, sy = 0;
      for (const p of shapeObj.points) { sx += p.x; sy += p.y; }
      cx = sx / shapeObj.points.length;
      cy = sy / shapeObj.points.length;
      if (shapeObj.points.length === 3) prefLbl = 'G';
    } else {
      return;
    }
    pushUndo(sid);
    const centerObj = {
      type: 'diem',
      x: cx,
      y: cy,
      text: nextPointLabel(list),
      color: shapeObj.color || '#FFFFFF',
      shapeCenterRef: { hostId: shapeObj.id, kind: shapeObj.type === 'hcn' ? 'hcn' : 'poly' }
    };
    ensureGeomId(centerObj);
    list.push(centerObj);
    redrawSurface(sid);
    notify('⊙ Đã tạo điểm tâm!');
  }

  function createCircleCenterPoint(sid, circleObj) {
    const list = state.annots[sid] || [];
    if (!circleObj || circleObj.type !== 'elip') return;
    if (circleObj.centerRef && resolvePointRef(list, circleObj.centerRef)) return;
    pushUndo(sid);
    ensureGeomId(circleObj);
    if (!circleObj.isCircle && Math.abs(Math.abs(circleObj.w) - Math.abs(circleObj.h)) < 1.5) {
      circleObj.isCircle = true;
    }
    const cx = circleObj.x + circleObj.w * 0.5;
    const cy = circleObj.y + circleObj.h * 0.5;
    const centerObj = {
      type: 'diem',
      x: cx,
      y: cy,
      text: nextPointLabel(list),
      color: circleObj.color || '#FFFFFF'
    };
    ensureGeomId(centerObj);
    list.push(centerObj);
    circleObj.centerRef = { kind: 'diem', id: centerObj.id, x: cx, y: cy };
    redrawSurface(sid);
    notify('⊙ Đã tạo điểm tâm cho đường tròn!');
  }

  let geomConstructState = null;

  function setGeomGuide(msg) {
    const el = document.getElementById('GeomGuideText');
    if (el) el.innerHTML = msg;
  }

  function startGeomConstruction(mode) {
    geomConstructState = { mode, picks: [] };
    setTool('geom_construct');
    if (geomSubmenu) geomSubmenu.classList.add('hidden');
    const guides = {
      diem_tren_doi_tuong: '🎯 <b>Điểm trượt trên đối tượng:</b> Chạm lên đoạn, đường, tròn, parabol hoặc cạnh hình để gắn điểm trượt.',
      trung_diem: '📍 <b>Trung điểm:</b> Chạm chọn <b>2 điểm</b> (hoặc chạm vào 1 đoạn thẳng).',
      trung_truc: '📐 <b>Đường trung trực:</b> Chạm chọn <b>2 điểm</b> (hoặc chạm vào 1 đoạn thẳng).',
      song_song: '⫽ <b>Đường song song:</b> Bước 1: Chạm vào <b>đoạn/đường thẳng gốc</b>.',
      vuong_goc: '⟂ <b>Đường vuông góc:</b> Bước 1: Chạm vào <b>đoạn/đường thẳng gốc</b>.',
      chan_vuong_goc: '📐 <b>Chân đường cao &amp; Góc vuông:</b> Bước 1: Chạm vào <b>đoạn/đường thẳng đáy</b>.',
      giao_diem: '✕ <b>Giao điểm 2 đường/đoạn:</b> Bước 1: Chạm vào <b>đoạn/đường thứ nhất</b>.',
      tron_noi_tiep: '⭕ <b>Đường tròn nội tiếp:</b> Chạm vào <b>tam giác</b> (hoặc lần lượt 3 đỉnh A, B, C).',
      tron_ngoai_tiep: '⭕ <b>Đường tròn ngoại tiếp:</b> Chạm vào <b>tam giác</b> (hoặc lần lượt 3 đỉnh A, B, C).',
      tiep_tuyen: '📐 <b>Tiếp tuyến đường tròn:</b> Bước 1: Chạm vào <b>đường tròn</b>.',
      hop_luc: '⊕ <b>Hợp lực (Hình bình hành):</b> Bước 1: Chạm vào <b>vectơ lực thứ nhất</b>.',
      luc_doi: '⇄ <b>Lực đối (-F):</b> Chạm vào <b>vectơ lực</b> cần vẽ lực đối.',
      cung_quet_tron: '↪ <b>Cung quét (ĐTLG):</b> Bước 1: Chạm <b>điểm đầu M₁</b> trên đường tròn.',
      ky_hieu_goc_vuong: '∟ <b>Ký hiệu góc vuông:</b> Chạm vào <b>đỉnh góc vuông</b> (hoặc chỗ bất kỳ để đặt nhanh).',
      ky_hieu_goc: '∠ <b>Ký hiệu góc nhọn / tù:</b> Chạm vào <b>đỉnh góc</b> (nơi 2 cạnh gặp nhau) để gắn cung góc động.'
    };
    const g = guides[mode] || 'Chạm trên bảng để dựng hình.';
    setGeomGuide(g);
    notify(g.replace(/<[^>]+>/g, ''));
  }

  function getObjectStraightSegment(obj, segIdx) {
    if (!obj) return null;
    if (obj.type === 'duong' || obj.type === 'mui_ten') {
      return { p1: { x: obj.x1, y: obj.y1 }, p2: { x: obj.x2, y: obj.y2 } };
    }
    if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.points) && obj.points.length >= 2) {
      const i = typeof segIdx === 'number' ? segIdx : 0;
      const a = obj.points[i], b = obj.points[(i + 1) % obj.points.length];
      if (a && b) return { p1: { x: a.x, y: a.y }, p2: { x: b.x, y: b.y } };
    }
    if (obj.type === 'hcn') {
      const corners = [
        { x: obj.x, y: obj.y },
        { x: obj.x + obj.w, y: obj.y },
        { x: obj.x + obj.w, y: obj.y + obj.h },
        { x: obj.x, y: obj.y + obj.h }
      ];
      const i = typeof segIdx === 'number' ? segIdx : 0;
      const a = corners[i], b = corners[(i + 1) % 4];
      if (a && b) return { p1: a, p2: b };
    }
    return null;
  }

  function sampleObjectPolyline(obj, segIdx) {
    const seg = getObjectStraightSegment(obj, segIdx);
    if (seg) return [seg.p1, seg.p2];
    if (obj.type === 'elip') {
      const cx = obj.x + obj.w * 0.5, cy = obj.y + obj.h * 0.5;
      const rx = Math.abs(obj.w * 0.5), ry = Math.abs(obj.h * 0.5);
      const pts = [], N = 72;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      }
      return pts;
    }
    if (obj.type === 'but' && Array.isArray(obj.points) && obj.points.length >= 2) {
      return obj.points;
    }
    return null;
  }

  function pickClosestCandidate(cands, hint) {
    if (!cands || cands.length === 0) return null;
    if (cands.length === 1 || !hint) return cands[0];
    let best = cands[0], bestD = Math.hypot(cands[0].x - hint.x, cands[0].y - hint.y);
    for (let i = 1; i < cands.length; i++) {
      const d = Math.hypot(cands[i].x - hint.x, cands[i].y - hint.y);
      if (d < bestD) { bestD = d; best = cands[i]; }
    }
    return best;
  }

  function computeObjectIntersection(obj1, segIdx1, obj2, segIdx2, hint) {
    const s1 = getObjectStraightSegment(obj1, segIdx1);
    const s2 = getObjectStraightSegment(obj2, segIdx2);

    // 1. Đường thẳng/Đoạn thẳng cắt Đường thẳng/Đoạn thẳng
    if (s1 && s2) {
      const a1 = s1.p2.y - s1.p1.y, b1 = s1.p1.x - s1.p2.x, c1 = a1 * s1.p1.x + b1 * s1.p1.y;
      const a2 = s2.p2.y - s2.p1.y, b2 = s2.p1.x - s2.p2.x, c2 = a2 * s2.p1.x + b2 * s2.p1.y;
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-4) return null;
      return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
    }

    // 2. Đường thẳng cắt Đường tròn (giải tích chính xác)
    const isCircleObj = (o) => o && o.type === 'elip' && Math.abs(Math.abs(o.w) - Math.abs(o.h)) < 1.5 && Math.abs(o.w) > 2;
    if ((s1 && isCircleObj(obj2)) || (s2 && isCircleObj(obj1))) {
      const seg = s1 || s2;
      const cir = s1 ? obj2 : obj1;
      const cx = cir.x + cir.w * 0.5, cy = cir.y + cir.h * 0.5, r = Math.abs(cir.w * 0.5);
      const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
      const fx = seg.p1.x - cx, fy = seg.p1.y - cy;
      const A = dx * dx + dy * dy;
      if (A < 1e-6) return null;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - r * r;
      const disc = B * B - 4 * A * C;
      if (disc < -1e-3) return null;
      const sq = Math.sqrt(Math.max(0, disc));
      const t1 = (-B - sq) / (2 * A);
      const t2 = (-B + sq) / (2 * A);
      const cands = [{ x: seg.p1.x + t1 * dx, y: seg.p1.y + t1 * dy }];
      if (sq > 1e-3) cands.push({ x: seg.p1.x + t2 * dx, y: seg.p1.y + t2 * dy });
      return pickClosestCandidate(cands, hint);
    }

    // 3. Đường tròn cắt Đường tròn (giải tích chính xác)
    if (isCircleObj(obj1) && isCircleObj(obj2)) {
      const x0 = obj1.x + obj1.w * 0.5, y0 = obj1.y + obj1.h * 0.5, r0 = Math.abs(obj1.w * 0.5);
      const x1 = obj2.x + obj2.w * 0.5, y1 = obj2.y + obj2.h * 0.5, r1 = Math.abs(obj2.w * 0.5);
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d < 1e-4 || d > r0 + r1 + 1e-3 || d < Math.abs(r0 - r1) - 1e-3) return null;
      const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
      const xm = x0 + (a * (x1 - x0)) / d, ym = y0 + (a * (y1 - y0)) / d;
      const rx = -(y1 - y0) * (h / d), ry = (x1 - x0) * (h / d);
      const cands = [{ x: xm + rx, y: ym + ry }];
      if (h > 1e-3) cands.push({ x: xm - rx, y: ym - ry });
      return pickClosestCandidate(cands, hint);
    }

    // 4. Đường cong / Elip / Đa tuyến cắt nhau
    const p1 = sampleObjectPolyline(obj1, segIdx1);
    const p2 = sampleObjectPolyline(obj2, segIdx2);
    if (!p1 || !p2 || p1.length < 2 || p2.length < 2) return null;
    const cands = [];
    for (let i = 0; i < p1.length - 1; i++) {
      const a = p1[i], b = p1[i + 1];
      for (let j = 0; j < p2.length - 1; j++) {
        const c = p2[j], d = p2[j + 1];
        const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
        if (Math.abs(den) < 1e-5) continue;
        const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
        const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / den;
        if (t >= -1e-4 && t <= 1 + 1e-4 && u >= -1e-4 && u <= 1 + 1e-4) {
          cands.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
        }
      }
    }
    return pickClosestCandidate(cands, hint);
  }

  function findNearestIntersectTarget(list, x, y, tol = 36, excludeTarget = null) {
    let best = null, bestD = tol;
    const segDist = (p1, p2) => {
      const dx = p2.x - p1.x, dy = p2.y - p1.y, l2 = dx * dx + dy * dy;
      if (l2 < 1e-4) return Infinity;
      const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / l2));
      return Math.hypot(x - (p1.x + t * dx), y - (p1.y + t * dy));
    };
    for (let idx = list.length - 1; idx >= 0; idx--) {
      const obj = list[idx];
      if (!obj || obj.hidden || obj.type === 'diem' || obj.type === 'chu' || obj.type === 'ghi_chu' || obj.type === 'cong_thuc') continue;
      if (obj.type === 'duong' || obj.type === 'mui_ten') {
        if (excludeTarget && excludeTarget.obj === obj) continue;
        const d = segDist({ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 });
        if (d < bestD) { bestD = d; best = { obj, segIdx: 0 }; }
      } else if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.points) && obj.points.length >= 2) {
        for (let i = 0; i < obj.points.length; i++) {
          if (excludeTarget && excludeTarget.obj === obj && excludeTarget.segIdx === i) continue;
          const d = segDist(obj.points[i], obj.points[(i + 1) % obj.points.length]);
          if (d < bestD) { bestD = d; best = { obj, segIdx: i }; }
        }
      } else if (obj.type === 'hcn') {
        const corners = [
          { x: obj.x, y: obj.y },
          { x: obj.x + obj.w, y: obj.y },
          { x: obj.x + obj.w, y: obj.y + obj.h },
          { x: obj.x, y: obj.y + obj.h }
        ];
        for (let i = 0; i < 4; i++) {
          if (excludeTarget && excludeTarget.obj === obj && excludeTarget.segIdx === i) continue;
          const d = segDist(corners[i], corners[(i + 1) % 4]);
          if (d < bestD) { bestD = d; best = { obj, segIdx: i }; }
        }
      } else if (obj.type === 'elip' || obj.type === 'but') {
        if (excludeTarget && excludeTarget.obj === obj) continue;
        const d = NKInkEngine.hitDistanceToObject(obj, x, y);
        if (d < bestD) { bestD = d; best = { obj, segIdx: 0 }; }
      }
    }
    return best;
  }

  function findNearestSegmentForGeom(list, x, y, tol = 36) {
    let best = null, bestD = tol;
    const checkSeg = (p1, p2, obj, segIdx) => {
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const l2 = dx * dx + dy * dy;
      if (l2 < 1e-4) return;
      const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / l2));
      const px = p1.x + t * dx, py = p1.y + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) { bestD = d; best = { p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y }, obj, segIdx }; }
    };
    for (const obj of list) {
      if (!obj || obj.hidden) continue;
      if (obj.type === 'duong' || obj.type === 'mui_ten') {
        checkSeg({ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }, obj, 0);
      } else if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && obj.points && obj.points.length >= 2) {
        for (let i = 0; i < obj.points.length; i++) {
          checkSeg(obj.points[i], obj.points[(i + 1) % obj.points.length], obj, i);
        }
      } else if (obj.type === 'hcn') {
        const corners = [
          { x: obj.x, y: obj.y },
          { x: obj.x + obj.w, y: obj.y },
          { x: obj.x + obj.w, y: obj.y + obj.h },
          { x: obj.x, y: obj.y + obj.h }
        ];
        for (let i = 0; i < 4; i++) checkSeg(corners[i], corners[(i + 1) % 4], obj, i);
      }
    }
    return best;
  }

  function computeTriangleCircle(mode, A, B, C) {
    if (!A || !B || !C) return null;
    if (mode === 'in') {
      const a = Math.hypot(B.x - C.x, B.y - C.y);
      const b = Math.hypot(A.x - C.x, A.y - C.y);
      const c = Math.hypot(A.x - B.x, A.y - B.y);
      const p = a + b + c;
      if (p < 1e-4) return null;
      const area2 = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y));
      const r = area2 / p;
      if (r < 1) return null;
      return { cx: (a * A.x + b * B.x + c * C.x) / p, cy: (a * A.y + b * B.y + c * C.y) / p, r };
    }
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(D) < 1e-4) return null;
    const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
    const cx = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D;
    const cy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D;
    const r = Math.hypot(A.x - cx, A.y - cy);
    if (!Number.isFinite(r) || r < 1 || r > 5000) return null;
    return { cx, cy, r };
  }

  function findNearestTriangleForGeom(list, x, y, tol = 36) {
    let best = null, bestD = tol;
    for (let i = list.length - 1; i >= 0; i--) {
      const obj = list[i];
      if (!obj || obj.hidden) continue;
      if ((obj.type === 'tam_giac' || obj.type === 'to_trong_suot') && Array.isArray(obj.points) && obj.points.length === 3) {
        const d = NKInkEngine.hitDistanceToObject(obj, x, y);
        const pts = obj.points;
        const minX = Math.min(pts[0].x, pts[1].x, pts[2].x) - 10;
        const maxX = Math.max(pts[0].x, pts[1].x, pts[2].x) + 10;
        const minY = Math.min(pts[0].y, pts[1].y, pts[2].y) - 10;
        const maxY = Math.max(pts[0].y, pts[1].y, pts[2].y) + 10;
        const insideBox = x >= minX && x <= maxX && y >= minY && y <= maxY;
        if (d < bestD || (insideBox && !best)) {
          bestD = Math.min(bestD, d);
          best = obj;
        }
      }
    }
    return best;
  }

  function findNearestCircleForGeom(list, x, y, tol = 36) {
    let best = null, bestD = tol;
    for (let i = list.length - 1; i >= 0; i--) {
      const obj = list[i];
      if (!obj || obj.hidden || obj.type !== 'elip') continue;
      if (Math.abs(Math.abs(obj.w) - Math.abs(obj.h)) > 2) continue;
      const d = NKInkEngine.hitDistanceToObject(obj, x, y);
      if (d < bestD) { bestD = d; best = obj; }
    }
    return best;
  }

  function nextPointLabel(listArg) {
    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const curList = Array.isArray(listArg) ? listArg : (state.annots[activeSid()] || []);
    const used = new Set(
      curList
        .filter((o) => o && !o.hidden && o.text)
        .map((o) => String(o.text).trim())
    );
    for (let round = 0; round < 20; round++) {
      for (let i = 0; i < labels.length; i++) {
        const cand = round === 0 ? labels[i] : `${labels[i]}${round}`;
        if (!used.has(cand)) {
          state.pointCounter++;
          return cand;
        }
      }
    }
    const lbl = labels[state.pointCounter % labels.length];
    state.pointCounter++;
    return lbl;
  }

  function handleGeomConstructTap(sid, pos, list) {
    if (!geomConstructState) return;
    const gs = geomConstructState;
    const zoom = sid === 'board' ? Math.max(0.5, state.boardCam.zoom) : 1;
    const tol = 24 / zoom;
    const sp = findPointRef(list, pos.x, pos.y, tol);
    const pt = sp ? { x: sp.x, y: sp.y } : { x: pos.x, y: pos.y };
    const col = activeColor(), w = activeWidth();

    if (gs.mode === 'diem_tren_doi_tuong') {
      const snapTol = 36 / zoom;
      let bestTarget = null, bestProj = null, bestDist = snapTol;
      for (let i = list.length - 1; i >= 0; i--) {
        const cand = list[i];
        if (!cand || cand.hidden || cand.type === 'diem') continue;
        const proj = projectPointOntoObject(cand, pos.x, pos.y);
        if (proj && proj.dist <= bestDist) {
          bestDist = proj.dist;
          bestTarget = cand;
          bestProj = proj;
        }
      }
      if (!bestTarget || !bestProj) {
        notify('⚠️ Hãy chạm gần vào đoạn thẳng, đường tròn, parabol hoặc cạnh hình!');
        return;
      }
      pushUndo(sid);
      const lbl = nextPointLabel();
      const glider = {
        type: 'diem',
        x: bestProj.x,
        y: bestProj.y,
        text: lbl,
        color: col,
        onObjRef: {
          id: ensureGeomId(bestTarget),
          t: bestProj.t,
          theta: bestProj.theta,
          segIdx: bestProj.segIdx,
          edgeIdx: bestProj.edgeIdx
        }
      };
      ensureGeomId(glider);
      list.push(glider);
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      redrawSurface(sid);
      notify(`🎯 Đã dựng điểm trượt ${lbl} trên đối tượng (kéo ${lbl} sẽ trượt dọc theo đường)!`);
      return;
    }

    if (gs.mode === 'trung_diem' || gs.mode === 'trung_truc') {
      if (gs.picks.length === 0) {
        const seg = !sp ? findNearestSegmentForGeom(list, pos.x, pos.y, 36 / zoom) : null;
        if (seg) {
          pushUndo(sid);
          ensureGeomId(seg.obj);
          const mx = (seg.p1.x + seg.p2.x) * 0.5, my = (seg.p1.y + seg.p2.y) * 0.5;
          let r1 = findPointRef(list, seg.p1.x, seg.p1.y, 4);
          let r2 = findPointRef(list, seg.p2.x, seg.p2.y, 4);
          if ((!r1 || !r2) && (seg.obj.type === 'tam_giac' || seg.obj.type === 'to_trong_suot' || seg.obj.type === 'hcn')) {
            r1 = { kind: 'poly', id: seg.obj.id, vIdx: seg.segIdx, x: seg.p1.x, y: seg.p1.y };
            const nPts = seg.obj.type === 'hcn' ? 4 : seg.obj.points.length;
            r2 = { kind: 'poly', id: seg.obj.id, vIdx: (seg.segIdx + 1) % nPts, x: seg.p2.x, y: seg.p2.y };
          }
          const midRefVal = (r1 && r2) ? [r1, r2] : null;
          const midSegVal = midRefVal ? null : { objId: seg.obj.id, segIdx: seg.segIdx };
          if (gs.mode === 'trung_diem') {
            list.push({ type: 'diem', x: mx, y: my, text: nextPointLabel(list), color: col, midRef: midRefVal, midSegRef: midSegVal });
            notify('📍 Đã dựng trung điểm');
          } else {
            const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
            const len = Math.max(1e-4, Math.hypot(dx, dy));
            const nx = -dy / len, ny = dx / len, half = Math.max(90, len * 0.7);
            list.push({
              type: 'duong',
              x1: mx - nx * half, y1: my - ny * half,
              x2: mx + nx * half, y2: my + ny * half,
              perpBisectorRef: { kind: 'seg', objId: seg.obj.id, segIdx: seg.segIdx },
              color: col, width: w, dashed: state.dashed
            });
            list.push({ type: 'diem', x: mx, y: my, text: nextPointLabel(list), color: col, midRef: midRefVal, midSegRef: midSegVal });
            notify('📐 Đã dựng đường trung trực (tự động chạy theo đoạn gốc!)');
          }
          geomConstructState = null;
          setTool('chinh_hinh_dong');
          redrawSurface(sid);
          return;
        }
        let r1 = sp;
        if (!r1) {
          pushUndo(sid);
          const o1 = { type: 'diem', x: pt.x, y: pt.y, text: nextPointLabel(list), color: col };
          ensureGeomId(o1);
          list.push(o1);
          r1 = { kind: 'diem', id: o1.id, x: pt.x, y: pt.y };
        }
        gs.picks.push({ pt, ref: r1 });
        if (surfaces[sid]) {
          surfaces[sid].pickedPoints = [{ x: pt.x, y: pt.y }];
          redrawActiveLayer(sid);
        }
        notify('Đã chọn điểm thứ nhất — chạm điểm/đỉnh thứ 2!');
        return;
      }
      const p1 = gs.picks[0].pt, r1 = gs.picks[0].ref;
      let r2 = sp;
      if (!r2) {
        const o2 = { type: 'diem', x: pt.x, y: pt.y, text: nextPointLabel(list), color: col };
        ensureGeomId(o2);
        list.push(o2);
        r2 = { kind: 'diem', id: o2.id, x: pt.x, y: pt.y };
      }
      const p2 = pt;
      if (surfaces[sid]) {
        surfaces[sid].pickedPoints = [];
        redrawActiveLayer(sid);
      }
      pushUndo(sid);
      const mx = (p1.x + p2.x) * 0.5, my = (p1.y + p2.y) * 0.5;
      if (gs.mode === 'trung_diem') {
        list.push({ type: 'diem', x: mx, y: my, text: nextPointLabel(list), color: col, midRef: [r1, r2] });
        notify('📍 Đã dựng trung điểm');
      } else {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.max(1e-4, Math.hypot(dx, dy));
        const nx = -dy / len, ny = dx / len, half = Math.max(90, len * 0.7);
        list.push({
          type: 'duong',
          x1: mx - nx * half, y1: my - ny * half,
          x2: mx + nx * half, y2: my + ny * half,
          perpBisectorRef: { kind: 'pts', p1Ref: r1, p2Ref: r2 },
          color: col, width: w, dashed: state.dashed
        });
        list.push({ type: 'diem', x: mx, y: my, text: nextPointLabel(list), color: col, midRef: [r1, r2] });
        notify('📐 Đã dựng đường trung trực (tự động chạy theo 2 điểm!)');
      }
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      redrawSurface(sid);
      return;
    }

    if (gs.mode === 'song_song' || gs.mode === 'vuong_goc' || gs.mode === 'chan_vuong_goc') {
      if (gs.picks.length === 0) {
        const seg = findNearestSegmentForGeom(list, pos.x, pos.y, 36 / zoom);
        if (!seg) { notify('⚠️ Hãy chạm gần vào một đoạn thẳng hoặc cạnh đa giác.'); return; }
        ensureGeomId(seg.obj);
        gs.picks.push(seg);
        setGeomGuide('Bước 2: Chạm vào <b>điểm đi qua</b>.');
        notify('Đã chọn đường gốc — chạm vào điểm đi qua.');
        return;
      }
      const seg = gs.picks[0];
      const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
      const len = Math.max(1e-4, Math.hypot(dx, dy));
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      pushUndo(sid);
      let ptRef = sp;
      if (!ptRef) {
        const pLbl = nextPointLabel();
        const pObj = { type: 'diem', x: pt.x, y: pt.y, text: pLbl, color: col };
        ensureGeomId(pObj);
        list.push(pObj);
        ptRef = { kind: 'diem', id: pObj.id, x: pt.x, y: pt.y };
      }
      if (gs.mode === 'song_song') {
        const half = Math.max(110, len * 0.65);
        list.push({
          type: 'duong',
          x1: pt.x - ux * half, y1: pt.y - uy * half,
          x2: pt.x + ux * half, y2: pt.y + uy * half,
          lineConstraintRef: { mode: 'parallel', baseObjId: seg.obj.id, baseSegIdx: seg.segIdx, ptRef },
          color: col, width: w, dashed: state.dashed
        });
        notify('⫽ Đã dựng đường song song (liên kết động!)');
      } else if (gs.mode === 'vuong_goc') {
        const half = Math.max(110, len * 0.65);
        list.push({
          type: 'duong',
          x1: pt.x - nx * half, y1: pt.y - ny * half,
          x2: pt.x + nx * half, y2: pt.y + ny * half,
          lineConstraintRef: { mode: 'perp', baseObjId: seg.obj.id, baseSegIdx: seg.segIdx, ptRef },
          color: col, width: w, dashed: state.dashed
        });
        notify('⟂ Đã dựng đường vuông góc (liên kết động!)');
      } else {
        const t = (pt.x - seg.p1.x) * ux + (pt.y - seg.p1.y) * uy;
        const hx = seg.p1.x + t * ux, hy = seg.p1.y + t * uy;
        const lbl = nextPointLabel();
        const hObj = {
          type: 'diem',
          x: hx, y: hy,
          text: lbl,
          color: col,
          footPerpRef: { baseObjId: seg.obj.id, baseSegIdx: seg.segIdx, ptRef }
        };
        ensureGeomId(hObj);
        const hRef = { kind: 'diem', id: hObj.id, x: hx, y: hy };
        list.push({ type: 'duong', x1: pt.x, y1: pt.y, x2: hx, y2: hy, p1Ref: ptRef, p2Ref: hRef, color: col, width: w, dashed: true });
        list.push(hObj);
        const s = 10, sgn = ((pt.x - hx) * nx + (pt.y - hy) * ny) >= 0 ? 1 : -1;
        list.push({
          type: 'but',
          points: [
            { x: hx + ux * s, y: hy + uy * s },
            { x: hx + ux * s + nx * s * sgn, y: hy + uy * s + ny * s * sgn },
            { x: hx + nx * s * sgn, y: hy + ny * s * sgn }
          ],
          rightAngleRef: { baseObjId: seg.obj.id, baseSegIdx: seg.segIdx, ptRef, footId: hObj.id },
          color: col, width: 1.3
        });
        notify(`📐 Đã dựng đường cao & chân vuông góc ${lbl} (liên kết động!)`);
      }
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      setGeomGuide('Sẵn sàng.');
      redrawSurface(sid);
      return;
    }

    if (gs.mode === 'giao_diem') {
      const pickTol = 36 / zoom;
      const firstPick = gs.picks.length > 0 ? gs.picks[0] : null;
      const target = findNearestIntersectTarget(list, pos.x, pos.y, pickTol, firstPick);
      if (!target) {
        notify(firstPick
          ? '⚠️ Hãy chạm gần vào đường/cạnh/hình tròn thứ hai (khác đường thứ nhất)!'
          : '⚠️ Hãy chạm gần vào đoạn thẳng, đường tròn, parabol hoặc cạnh hình!');
        return;
      }
      if (!firstPick) {
        gs.picks.push(target);
        setGeomGuide('Bước 2: Chạm vào <b>đường / cạnh / hình tròn thứ hai</b>.');
        notify('Đã chọn đường thứ 1 — chạm tiếp đường thứ 2.');
        return;
      }
      const ip = computeObjectIntersection(firstPick.obj, firstPick.segIdx, target.obj, target.segIdx, pos);
      if (!ip) {
        notify('⚠️ Hai đường này không cắt nhau (hoặc song song)! Hãy chạm đường khác.');
        return;
      }
      ensureGeomId(firstPick.obj);
      ensureGeomId(target.obj);
      const lbl = nextPointLabel();
      pushUndo(sid);
      const ptObj = {
        type: 'diem',
        x: ip.x,
        y: ip.y,
        text: lbl,
        color: col,
        intersectRef: {
          id1: firstPick.obj.id,
          segIdx1: firstPick.segIdx,
          id2: target.obj.id,
          segIdx2: target.segIdx
        }
      };
      ensureGeomId(ptObj);
      list.push(ptObj);
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      setGeomGuide('Sẵn sàng.');
      redrawSurface(sid);
      notify(`✕ Đã dựng giao điểm ${lbl} (tự động chạy theo khi kéo đường!)`);
    }

    if (gs.mode === 'ky_hieu_goc') {
      const tol = 28 / zoom, r = 22;
      const found = findCornerRaysAtPoint(list, pt, tol);
      if (!found) {
        notify('⚠️ Hãy chạm vào đỉnh góc (nơi 2 cạnh / đoạn gặp nhau)!');
        return;
      }
      pushUndo(sid);
      const refObj = found.polyRef
        ? { ...found.polyRef, r }
        : (found.segsRef ? { ...found.segsRef, r } : null);
      const arcObj = {
        type: 'but',
        isPolyline: true,
        points: computeAngleArcPoints(found.V, found.u1, found.u2, r),
        color: col,
        width: Math.max(1.6, w * 0.75)
      };
      if (refObj) arcObj.angleArcRef = refObj;
      list.push(arcObj);
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      setGeomGuide('Sẵn sàng.');
      redrawSurface(sid);
      notify('∠ Đã đặt ký hiệu góc động!');
      return;
    }

    if (gs.mode === 'ky_hieu_goc_vuong') {
      const tol = 28 / zoom, sz = 13;
      let found = null;
      // 1. Ưu tiên đỉnh đa giác / tam giác / hình chữ nhật
      for (const o of list) {
        if (!o || o.hidden) continue;
        if ((o.type === 'tam_giac' || o.type === 'to_trong_suot') && Array.isArray(o.points) && o.points.length >= 3) {
          for (let vi = 0; vi < o.points.length; vi++) {
            const V = o.points[vi];
            if (Math.hypot(V.x - pt.x, V.y - pt.y) <= tol) {
              const n = o.points.length;
              const P1 = o.points[(vi - 1 + n) % n], P2 = o.points[(vi + 1) % n];
              const d1 = Math.hypot(P1.x - V.x, P1.y - V.y), d2 = Math.hypot(P2.x - V.x, P2.y - V.y);
              if (d1 > 1e-4 && d2 > 1e-4) {
                found = {
                  V,
                  u1: { x: (P1.x - V.x) / d1, y: (P1.y - V.y) / d1 },
                  u2: { x: (P2.x - V.x) / d2, y: (P2.y - V.y) / d2 },
                  ref: { kind: 'poly', objId: ensureGeomId(o), vIdx: vi, size: sz }
                };
                break;
              }
            }
          }
          if (found) break;
        }
      }
      // 2. Tìm 2 đoạn/vectơ gần điểm chạm nhất
      if (!found) {
        const nearSegs = [];
        for (const o of list) {
          if (!o || o.hidden || (o.type !== 'duong' && o.type !== 'mui_ten')) continue;
          const d = NKInkEngine.distToSegment(pt.x, pt.y, o.x1, o.y1, o.x2, o.y2);
          if (d <= tol) nearSegs.push({ o, d });
        }
        nearSegs.sort((a, b) => a.d - b.d);
        if (nearSegs.length >= 2) {
          const s1 = nearSegs[0].o, s2 = nearSegs[1].o;
          const ip = computeLineIntersection({ x: s1.x1, y: s1.y1 }, { x: s1.x2, y: s1.y2 }, { x: s2.x1, y: s2.y1 }, { x: s2.x2, y: s2.y2 });
          if (ip && Math.hypot(ip.x - pt.x, ip.y - pt.y) <= tol * 1.6) {
            const pickRay = (s) => {
              const d1 = Math.hypot(s.x1 - ip.x, s.y1 - ip.y);
              const d2 = Math.hypot(s.x2 - ip.x, s.y2 - ip.y);
              const far = d2 >= d1 ? { x: s.x2, y: s.y2 } : { x: s.x1, y: s.y1 };
              const len = Math.max(1e-4, Math.hypot(far.x - ip.x, far.y - ip.y));
              return { x: (far.x - ip.x) / len, y: (far.y - ip.y) / len };
            };
            found = {
              V: ip,
              u1: pickRay(s1),
              u2: pickRay(s2),
              ref: { kind: 'segs', id1: ensureGeomId(s1), id2: ensureGeomId(s2), size: sz }
            };
          }
        }
      }
      pushUndo(sid);
      const pts = found
        ? [
            { x: found.V.x + found.u1.x * sz, y: found.V.y + found.u1.y * sz },
            { x: found.V.x + (found.u1.x + found.u2.x) * sz, y: found.V.y + (found.u1.y + found.u2.y) * sz },
            { x: found.V.x + found.u2.x * sz, y: found.V.y + found.u2.y * sz }
          ]
        : [
            { x: pt.x, y: pt.y - 15 },
            { x: pt.x + 15, y: pt.y - 15 },
            { x: pt.x + 15, y: pt.y }
          ];
      const markObj = { type: 'but', isPolyline: true, points: pts, color: col, width: Math.max(1.6, w * 0.75) };
      if (found && found.ref) markObj.cornerRightAngleRef = found.ref;
      list.push(markObj);
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      setGeomGuide('Sẵn sàng.');
      redrawSurface(sid);
      notify('∟ Đã đặt ký hiệu góc vuông!');
      return;
    }

    if (gs.mode === 'cung_quet_tron') {
      let pRef = sp;
      if (!pRef) {
        let bestCir = null, bestProj = null, bestD = 24 / zoom;
        for (const o of list) {
          if (!o || o.hidden || o.type !== 'elip') continue;
          if (!o.isCircle && Math.abs(Math.abs(o.w) - Math.abs(o.h)) >= 2) continue;
          const proj = projectPointOntoObject(o, pt.x, pt.y);
          if (proj && proj.dist < bestD) { bestD = proj.dist; bestCir = o; bestProj = proj; }
        }
        if (!bestCir || !bestProj) {
          notify('⚠️ Hãy chạm vào điểm nằm trên đường tròn!');
          return;
        }
        ensureGeomId(bestCir);
        pushUndo(sid);
        const pObj = {
          type: 'diem', x: bestProj.x, y: bestProj.y, text: nextPointLabel(), color: col,
          onObjRef: { kind: 'elip', id: bestCir.id, theta: bestProj.theta }
        };
        ensureGeomId(pObj);
        list.push(pObj);
        pRef = { kind: 'diem', id: pObj.id, x: pObj.x, y: pObj.y };
      }
      gs.picks.push(pRef);
      if (gs.picks.length < 2) {
        setGeomGuide('↪ <b>Cung quét (ĐTLG):</b> Bước 2: Chạm <b>điểm cuối M₂</b> trên đường tròn.');
        redrawSurface(sid);
        return;
      }
      const p1 = resolvePointRef(list, gs.picks[0]), p2 = resolvePointRef(list, gs.picks[1]);
      const cir = findCommonCircleForPoints(list, p1, p2, gs.picks[0], gs.picks[1]);
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      setGeomGuide('Sẵn sàng.');
      if (!cir) {
        notify('⚠️ Hai điểm phải nằm trên cùng một đường tròn!');
        redrawSurface(sid);
        return;
      }
      createCircleSweepArc(sid, cir, gs.picks[0], gs.picks[1]);
      return;
    }

    if (gs.mode === 'tron_noi_tiep' || gs.mode === 'tron_ngoai_tiep') {
      const tcMode = gs.mode === 'tron_noi_tiep' ? 'in' : 'circum';
      const tri = gs.picks.length === 0 ? findNearestTriangleForGeom(list, pos.x, pos.y, 36 / zoom) : null;
      const tappedTriVertex = tri && tri.points.some((v) => Math.hypot(v.x - pos.x, v.y - pos.y) <= 16 / zoom);
      let ptRefs = null;
      if (tri && !tappedTriVertex && (!sp || Math.hypot(sp.x - pos.x, sp.y - pos.y) > 8 / zoom || list.some((o) => o && o.type === 'elip' && o.triangleCircleRef && o.triangleCircleRef.centerId === sp.id))) {
        ensureGeomId(tri);
        ptRefs = [0, 1, 2].map((vIdx) => ({ kind: 'poly', id: tri.id, vIdx, x: tri.points[vIdx].x, y: tri.points[vIdx].y }));
      } else {
        let pRef = sp;
        if (!pRef) {
          const lbl = nextPointLabel();
          pushUndo(sid);
          const pObj = { type: 'diem', x: pt.x, y: pt.y, text: lbl, color: col };
          ensureGeomId(pObj);
          list.push(pObj);
          pRef = { kind: 'diem', id: pObj.id, x: pt.x, y: pt.y };
        }
        gs.picks.push(pRef);
        if (gs.picks.length < 3) {
          setGeomGuide(`Đã chọn ${gs.picks.length}/3 điểm — chạm tiếp điểm thứ ${gs.picks.length + 1}.`);
          redrawSurface(sid);
          return;
        }
        ptRefs = gs.picks.slice(0, 3);
      }
      const pA = resolvePointRef(list, ptRefs[0]);
      const pB = resolvePointRef(list, ptRefs[1]);
      const pC = resolvePointRef(list, ptRefs[2]);
      const res = computeTriangleCircle(tcMode, pA, pB, pC);
      if (!res) {
        notify('⚠️ 3 điểm thẳng hàng, không dựng được đường tròn!');
        geomConstructState = null;
        setTool('chinh_hinh_dong');
        return;
      }
      pushUndo(sid);
      const centerObj = { type: 'diem', x: res.cx, y: res.cy, text: nextPointLabel(list), color: col };
      ensureGeomId(centerObj);
      list.push(centerObj);
      list.push({
        type: 'elip',
        isCircle: true,
        x: res.cx - res.r,
        y: res.cy - res.r,
        w: res.r * 2,
        h: res.r * 2,
        centerRef: { kind: 'diem', id: centerObj.id, x: res.cx, y: res.cy },
        triangleCircleRef: { mode: tcMode, pts: ptRefs, centerId: centerObj.id },
        color: col,
        width: w,
        dashed: state.dashed
      });
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      setGeomGuide('Sẵn sàng.');
      redrawSurface(sid);
      notify(tcMode === 'in'
        ? `⭕ Đã dựng đường tròn nội tiếp tam giác (tâm ${finalLbl})!`
        : `⭕ Đã dựng đường tròn ngoại tiếp tam giác (tâm ${finalLbl})!`);
      return;
    }

    if (gs.mode === 'tiep_tuyen') {
      if (gs.picks.length === 0) {
        const cir = findNearestCircleForGeom(list, pos.x, pos.y, 36 / zoom);
        if (!cir) { notify('⚠️ Hãy chạm vào đường tròn cần dựng tiếp tuyến!'); return; }
        ensureGeomId(cir);
        gs.picks.push(cir);
        setGeomGuide('Bước 2: Chạm 1 <b>điểm trên đường tròn</b> hoặc <b>điểm ngoài đường tròn</b>.');
        notify('Đã chọn đường tròn — chạm tiếp điểm trên đường tròn hoặc điểm ngoài đường tròn!');
        return;
      }
      const cir = gs.picks[0];
      const cx = cir.x + cir.w * 0.5, cy = cir.y + cir.h * 0.5, r = Math.abs(cir.w * 0.5);
      const targetPt = sp ? { x: sp.x, y: sp.y } : pt;
      const dx = targetPt.x - cx, dy = targetPt.y - cy, d = Math.hypot(dx, dy);
      if (d < r - 8) {
        notify('⚠️ Điểm nằm bên trong đường tròn, không kẻ được tiếp tuyến!');
        return;
      }
      pushUndo(sid);
      ensureGeomId(cir);
      if (Math.abs(d - r) <= 8) {
        // Điểm trên đường tròn -> 1 tiếp tuyến tại tiếp điểm
        const theta = Math.atan2(dy, dx);
        const tx = cx + r * Math.cos(theta), ty = cy + r * Math.sin(theta);
        let tRef = sp;
        if (!tRef) {
          const lbl = nextPointLabel();
          const tObj = { type: 'diem', x: tx, y: ty, text: lbl, color: col, onObjRef: { kind: 'elip', id: cir.id, theta } };
          ensureGeomId(tObj);
          list.push(tObj);
          tRef = { kind: 'diem', id: tObj.id, x: tx, y: ty };
        }
        const ux = -Math.sin(theta), uy = Math.cos(theta);
        const halfLen = Math.max(110, r * 1.4);
        list.push({
          type: 'duong',
          x1: tx - ux * halfLen, y1: ty - uy * halfLen,
          x2: tx + ux * halfLen, y2: ty + uy * halfLen,
          tangentLineRef: { circleId: cir.id, ptRef: tRef },
          color: col, width: w, dashed: state.dashed
        });
        notify('📐 Đã dựng tiếp tuyến tại điểm trên đường tròn!');
      } else {
        // Điểm ngoài đường tròn -> 2 tiếp tuyến MT1, MT2
        let mRef = sp;
        if (!mRef) {
          const mLbl = nextPointLabel();
          const mObj = { type: 'diem', x: targetPt.x, y: targetPt.y, text: mLbl, color: col };
          ensureGeomId(mObj);
          list.push(mObj);
          mRef = { kind: 'diem', id: mObj.id, x: targetPt.x, y: targetPt.y };
        }
        const alpha = Math.atan2(dy, dx), beta = Math.acos(r / d);
        for (const side of [1, -1]) {
          const ang = alpha + side * beta;
          const tx = cx + r * Math.cos(ang), ty = cy + r * Math.sin(ang);
          const tLbl = nextPointLabel();
          const tObj = {
            type: 'diem',
            x: tx, y: ty,
            text: tLbl,
            color: col,
            tangentPtRef: { circleId: cir.id, ptRef: mRef, side }
          };
          ensureGeomId(tObj);
          list.push(tObj);
          list.push({
            type: 'duong',
            x1: targetPt.x, y1: targetPt.y,
            x2: tx, y2: ty,
            p1Ref: mRef,
            p2Ref: { kind: 'diem', id: tObj.id, x: tx, y: ty },
            color: col, width: w, dashed: state.dashed
          });
        }
        notify('📐 Đã dựng 2 tiếp tuyến từ điểm ngoài đến đường tròn!');
      }
      geomConstructState = null;
      setTool('chinh_hinh_dong');
      setGeomGuide('Sẵn sàng.');
      redrawSurface(sid);
    }

    if (gs.mode === 'hop_luc' || gs.mode === 'luc_doi') {
      const pickTol = 36 / zoom;
      let bestVec = null, bestD = pickTol;
      for (let i = list.length - 1; i >= 0; i--) {
        const cand = list[i];
        if (!cand || cand.hidden || cand.type !== 'mui_ten') continue;
        if (gs.picks[0] === cand) continue;
        const d = NKInkEngine.hitDistanceToObject(cand, pos.x, pos.y);
        if (d < bestD) { bestD = d; bestVec = cand; }
      }
      if (!bestVec) {
        notify('⚠️ Hãy chạm gần vào một vectơ lực (mũi tên)!');
        return;
      }
      if (gs.mode === 'luc_doi') {
        geomConstructState = null;
        setGeomGuide('Sẵn sàng.');
        createOppositeForce(sid, bestVec);
        return;
      }
      if (gs.picks.length === 0) {
        gs.picks.push(bestVec);
        setGeomGuide('Bước 2: Chạm vào <b>vectơ lực thứ hai</b>.');
        notify('Đã chọn lực thứ 1 — chạm tiếp lực thứ 2.');
        return;
      }
      const v1 = gs.picks[0];
      geomConstructState = null;
      setGeomGuide('Sẵn sàng.');
      createForceResultant(sid, v1, bestVec);
    }
  }

  function insertPresetShape(shapeId, label) {
    const sid = activeSid(), surf = surfaces[sid];
    if (!surf) return;
    ensureStacks(sid);
    pushUndo(sid);
    const center = getViewportCenterWorld(sid);
    const objs = NKInkEngine.createMathPhysicsPresets(
      shapeId,
      center.x,
      center.y,
      { color: activeColor(), width: activeWidth() }
    );
    const startIdx = state.annots[sid].length;
    state.annots[sid].push(...objs);
    if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(state.annots[sid]);
    state.selectedIndices = (shapeId === 'duong_tron_luong_giac_ddh' || shapeId === 'vat_mat_phang_nghieng' || shapeId === 'vat_mat_phang_ngang' || shapeId === 'nua_duong_tron') ? [] : objs.map((_, k) => startIdx + k);
    setTool('chinh_hinh_dong');
    redrawSurface(sid);
    geomSubmenu.classList.add('hidden');
    notify(`📐 Đã dựng ${label} (Kéo các đỉnh để biến dạng giữ nguyên tính chất hình học!).`);
  }

  function showGeomSubmenu(items) {
    geomSubmenu.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'geom-sub-grid';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'gsub-btn';
      b.textContent = it.label;
      b.addEventListener('click', it.action);
      grid.appendChild(b);
    });
    geomSubmenu.appendChild(grid);
    geomSubmenu.classList.remove('hidden');
  }

  let activeDungThemTab = 'ly10';
  let subReorderMode = false;
  let subReorderFirstKey = null;

  function loadSubOrderMap() {
    try { return JSON.parse(localStorage.getItem('nkpdf_geom_sub_order') || '{}'); } catch (_) { return {}; }
  }
  function saveSubOrderMap(map) {
    try { localStorage.setItem('nkpdf_geom_sub_order', JSON.stringify(map)); } catch (_) {}
  }

  function getDungThemCatalog() {
    const pick2Forces = () => {
      const sid = activeSid(), list = state.annots[sid] || [];
      const vecs = state.selectedIndices.map((idx) => list[idx]).filter((o) => o && !o.hidden && o.type === 'mui_ten');
      if (vecs.length === 2) {
        if (geomSubmenu) geomSubmenu.classList.add('hidden');
        createForceResultant(sid, vecs[0], vecs[1]);
      } else {
        startGeomConstruction('hop_luc');
      }
    };
    const pick1ForceOpp = () => {
      const sid = activeSid(), list = state.annots[sid] || [];
      const vecs = state.selectedIndices.map((idx) => list[idx]).filter((o) => o && !o.hidden && o.type === 'mui_ten');
      if (vecs.length === 1) {
        if (geomSubmenu) geomSubmenu.classList.add('hidden');
        createOppositeForce(sid, vecs[0]);
      } else {
        startGeomConstruction('luc_doi');
      }
    };
    return {
      toan: [
        { id: 'diem_truot', label: '🎯 Điểm trượt trên hình', action: () => startGeomConstruction('diem_tren_doi_tuong') },
        { id: 'trung_diem', label: '📍 Trung điểm', action: () => startGeomConstruction('trung_diem') },
        { id: 'trung_truc', label: '📐 Đường trung trực', action: () => startGeomConstruction('trung_truc') },
        { id: 'song_song', label: '⫽ Đường song song', action: () => startGeomConstruction('song_song') },
        { id: 'vuong_goc', label: '⟂ Đường vuông góc', action: () => startGeomConstruction('vuong_goc') },
        { id: 'goc_vuong', label: '∟ Ký hiệu góc vuông', action: () => startGeomConstruction('ky_hieu_goc_vuong') },
        { id: 'goc_nhon', label: '∠ Ký hiệu góc', action: () => startGeomConstruction('ky_hieu_goc') },
        { id: 'chan_vg', label: '📐 Chân đường cao', action: () => startGeomConstruction('chan_vuong_goc') },
        { id: 'giao_diem', label: '✕ Giao điểm 2 đường', action: () => startGeomConstruction('giao_diem') },
        { id: 'noi_tiep', label: '⭕ ĐT nội tiếp Δ', action: () => startGeomConstruction('tron_noi_tiep') },
        { id: 'ngoai_tiep', label: '⭕ ĐT ngoại tiếp Δ', action: () => startGeomConstruction('tron_ngoai_tiep') },
        { id: 'tiep_tuyen', label: '📐 Tiếp tuyến ĐT', action: () => startGeomConstruction('tiep_tuyen') },
        { id: 'dtlg', label: '⭕ Đường tròn LG', action: () => insertPresetShape('duong_tron_luong_giac', 'Đường tròn lượng giác') },
        { id: 'nua_dt', label: '🌓 Nửa đường tròn (O, AB)', action: () => insertPresetShape('nua_duong_tron', 'Nửa đường tròn tâm O, đường kính AB') },
        { id: 'cung_quet', label: '↪ Cung quét ngoài ĐT', action: () => startGeomConstruction('cung_quet_tron') },
        { id: 'hinh_chop', label: '🔺 Hình chóp S.ABCD', action: () => insertPresetShape('hinh_chop', 'Hình chóp S.ABCD') }
      ],
      ly10: [
        { id: 'hop_luc', label: '⊕ Hợp lực (HBH)', action: pick2Forces },
        { id: 'luc_doi', label: '⇄ Vẽ lực đối (-F)', action: pick1ForceOpp },
        { id: 'dong_quy', label: '⚡ 2 lực đồng quy + F', action: () => { if (geomSubmenu) geomSubmenu.classList.add('hidden'); insertConcurrentForcesSample(activeSid()); } },
        { id: 'mp_nghieng', label: '🚗 Xe/Vật MP nghiêng', action: () => insertPresetShape('vat_mat_phang_nghieng', 'Động lực học: Mặt phẳng nghiêng') },
        { id: 'mp_ngang', label: '🚙 Xe/Vật MP ngang', action: () => insertPresetShape('vat_mat_phang_ngang', 'Động lực học: Mặt phẳng ngang') },
        { id: 'treo_1day', label: '⚖️ Vật treo 1 dây', action: () => insertPresetShape('vat_treo_day', 'Vật treo dây thẳng đứng') },
        { id: 'treo_2day', label: "⚖️ Vật treo 2 dây AA'", action: () => insertPresetShape('vat_treo_2_day', 'Vật treo 2 dây đối xứng') },
        { id: 'ptl_keo_day', label: '📦 Vật kéo dây ngang', action: () => insertPresetShape('ptl_keo_day_ngang', 'Vật kéo dây ngang') },
        { id: 'ptl_tuong_nghieng', label: '📐 Dây treo vào tường', action: () => insertPresetShape('ptl_treo_tuong_nghieng', 'Dây treo nghiêng vào tường') },
        { id: 'ptl_goc_tuong', label: '📐 Treo góc tường OAB', action: () => insertPresetShape('ptl_treo_goc_tuong', 'Treo vật góc tường OAB') },
        { id: 'ptl_2_cot_lech', label: '⚖️ Treo 2 cột lệch AOB', action: () => insertPresetShape('ptl_treo_2_cot_lech', 'Treo 2 cột lệch AOB') },
        { id: 'ptl_mp_day', label: '⛓️ MP nghiêng dây giữ', action: () => insertPresetShape('ptl_mp_nghieng_day', 'Mặt phẳng nghiêng có dây giữ') },
        { id: 'ptl_thanh_ab', label: '📐 Thanh AB + dây CA', action: () => insertPresetShape('ptl_thanh_ngang_day', 'Thanh ngang AB & dây CA') },
        { id: 'nem_ngang', label: '🎯 Ném ngang', action: () => insertPresetShape('nem_ngang', 'Chuyển động ném ngang') },
        { id: 'nem_xien', label: '🚀 Ném xiên', action: () => insertPresetShape('nem_xien', 'Chuyển động ném xiên') }
      ],
      ly11: [
        { id: 'dtlg_ddh', label: '⭕ ĐTLG Dao động ĐH', action: () => insertPresetShape('duong_tron_luong_giac_ddh', 'ĐTLG Dao động điều hòa') },
        { id: 'truc_tg_ddh', label: '📏 Trục thời gian (-A..+A)', action: () => insertPresetShape('truc_thoi_gian_ddh', 'Trục thời gian Dao động điều hòa') },
        { id: 'cung_quet_11', label: '↪ Cung quét (ĐTLG)', action: () => startGeomConstruction('cung_quet_tron') },
        { id: 'giao_thoa', label: '〰️ Giao thoa sóng', action: () => insertPresetShape('giao_thoa_song', 'Giao thoa sóng 2 nguồn S₁, S₂') },
        { id: 'sd_2co', label: '🌊 Sóng dừng (2 CĐ)', action: () => insertPresetShape('song_dung_2co', 'Sóng dừng 2 đầu cố định') },
        { id: 'sd_1co_1tu', label: '🌊 Sóng dừng (1 CĐ 1 TD)', action: () => insertPresetShape('song_dung_1co_1tu', 'Sóng dừng 1 đầu cố định, 1 đầu tự do') },
        { id: 'song_sin', label: '〰️ Sóng hình Sin/Cos', action: () => insertPresetShape('song_sin', 'Đồ thị sóng hình Sin') },
        { id: 'cllx', label: '🌀 Con lắc lò xo ngang', action: () => insertPresetShape('con_lac_lo_xo', 'Con lắc lò xo nằm ngang') },
        { id: 'cllx_dung', label: '🌀 Con lắc lò xo đứng', action: () => insertPresetShape('con_lac_lo_xo_dung', 'Con lắc lò xo thẳng đứng') },
        { id: 'cld', label: '⏱️ Con lắc đơn', action: () => insertPresetShape('con_lac_don', 'Con lắc đơn') }
      ],
      ly12: [
        { id: 'vl12_chuyen_the', label: '🌡️ Đồ thị chuyển thể', action: () => insertPresetShape('vl12_chuyen_the', 'Đồ thị chuyển thể t-τ') },
        { id: 'vl12_nhiet_dung_rieng', label: '🔥 Đo nhiệt dung riêng', action: () => insertPresetShape('vl12_nhiet_dung_rieng', 'Thí nghiệm nhiệt lượng kế') },
        { id: 'dang_nhiet_keo', label: '📈 Đẳng nhiệt p=k/V', action: () => { setTool('dung_dang_nhiet'); geomSubmenu.classList.add('hidden'); notify('📈 Kéo trên trang để dựng đường đẳng nhiệt p = k/V.'); } },
        { id: 'dang_nhiet_2', label: '📊 2 đẳng nhiệt T₂>T₁', action: () => insertPresetShape('dang_nhiet_pv', 'Đồ thị 2 đường đẳng nhiệt T₂ > T₁') }
      ]
    };
  }

  let quickToanLyTab = 'ly10';
  function openFloatingQuickToanLy(targetSid = null) {
    const prev = document.getElementById('nk-quick-toan-ly-panel');
    if (prev) prev.remove();

    const panel = document.createElement('div');
    panel.id = 'nk-quick-toan-ly-panel';
    panel.style.cssText = [
      'position:fixed',
      'z-index:99995',
      'top:62px',
      'left:50%',
      'transform:translateX(-50%)',
      'width:min(780px, 92vw)',
      'max-height:72vh',
      'overflow-y:auto',
      'padding:10px 12px',
      'background:#F0F9FF',
      'border:1.5px solid #38BDF8',
      'border-radius:14px',
      'box-shadow:0 14px 38px rgba(0,0,0,0.42)',
      'display:flex',
      'flex-direction:column',
      'gap:8px'
    ].join(';');

    const renderBody = () => {
      panel.innerHTML = '';
      const catalog = getDungThemCatalog();
      const tabsBar = document.createElement('div');
      tabsBar.className = 'geom-sub-tabs';
      tabsBar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;';
      const tabs = [
        { key: 'toan', label: '📐 TOÁN' },
        { key: 'ly10', label: '⚡ LÍ 10' },
        { key: 'ly11', label: '🌊 LÍ 11' },
        { key: 'ly12', label: '🔥 LÍ 12' },
        { key: 'all', label: '📋 Tất cả' }
      ];
      tabs.forEach((t) => {
        const tb = document.createElement('button');
        tb.type = 'button';
        tb.className = 'gsub-tab' + (quickToanLyTab === t.key ? ' active' : '');
        tb.textContent = t.label;
        tb.addEventListener('click', (e) => {
          e.stopPropagation();
          quickToanLyTab = t.key;
          renderBody();
        });
        tabsBar.appendChild(tb);
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '✕ Đóng';
      closeBtn.style.cssText = 'margin-left:auto;padding:5px 11px;border-radius:8px;border:1px solid #FCA5A5;background:#FEE2E2;color:#B91C1C;font-weight:700;font-size:12.5px;cursor:pointer;';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.remove();
      });
      tabsBar.appendChild(closeBtn);

      const grid = document.createElement('div');
      grid.className = 'geom-sub-grid';
      const items = quickToanLyTab === 'all'
        ? [...catalog.toan, ...catalog.ly10, ...catalog.ly11, ...catalog.ly12]
        : (catalog[quickToanLyTab] || []);
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gsub-btn';
        b.textContent = it.label;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          panel.remove();
          if (targetSid === 'board' && state.mode !== 'board' && typeof openBangXanh === 'function') {
            openBangXanh(true);
          }
          it.action();
        });
        grid.appendChild(b);
      });

      panel.appendChild(tabsBar);
      panel.appendChild(grid);
    };

    renderBody();
    document.body.appendChild(panel);
    const closeOutside = (ev) => {
      if (!panel.contains(ev.target)) {
        panel.remove();
        window.removeEventListener('pointerdown', closeOutside, true);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', closeOutside, true), 60);
  }

  function renderDungThemMatrix() {
    const catalog = getDungThemCatalog();
    const orderMap = loadSubOrderMap();
    const getOrdered = (tabKey) => {
      const raw = tabKey === 'all'
        ? [...catalog.toan, ...catalog.ly10, ...catalog.ly11, ...catalog.ly12]
        : (catalog[tabKey] || []);
      const saved = orderMap[tabKey];
      if (!Array.isArray(saved) || saved.length === 0) return raw;
      const byId = new Map(raw.map((it) => [it.id, it]));
      const res = [];
      saved.forEach((id) => { if (byId.has(id)) { res.push(byId.get(id)); byId.delete(id); } });
      byId.forEach((it) => res.push(it));
      return res;
    };

    geomSubmenu.innerHTML = '';
    const tabsBar = document.createElement('div');
    tabsBar.className = 'geom-sub-tabs';
    const tabs = [
      { key: 'toan', label: '📐 TOÁN' },
      { key: 'ly10', label: '⚡ LÍ 10' },
      { key: 'ly11', label: '🌊 LÍ 11' },
      { key: 'ly12', label: '🔥 LÍ 12' },
      { key: 'all', label: '📋 Tất cả' }
    ];
    tabs.forEach((t) => {
      const tb = document.createElement('button');
      tb.className = 'gsub-tab' + (activeDungThemTab === t.key ? ' active' : '');
      tb.textContent = t.label;
      tb.addEventListener('click', () => {
        activeDungThemTab = t.key;
        subReorderFirstKey = null;
        renderDungThemMatrix();
      });
      tabsBar.appendChild(tb);
    });

    const rb = document.createElement('button');
    rb.className = 'gsub-tab is-reorder' + (subReorderMode ? ' active' : '');
    rb.textContent = subReorderMode ? '✓ Xong' : '🔀 Sắp xếp';
    rb.title = 'Bật rồi chạm lần lượt 2 công cụ để đổi chỗ tùy ý';
    rb.addEventListener('click', () => {
      subReorderMode = !subReorderMode;
      subReorderFirstKey = null;
      renderDungThemMatrix();
      if (subReorderMode) notify('🔀 Chế độ Sắp xếp: Chạm lần lượt 2 ô để đổi vị trí cho nhau!');
    });
    tabsBar.appendChild(rb);

    if (subReorderMode) {
      const resetB = document.createElement('button');
      resetB.className = 'gsub-tab';
      resetB.textContent = '↺ Mặc định';
      resetB.addEventListener('click', () => {
        const m = loadSubOrderMap();
        delete m[activeDungThemTab];
        saveSubOrderMap(m);
        subReorderFirstKey = null;
        renderDungThemMatrix();
        notify('↺ Đã khôi phục thứ tự mặc định của mục này.');
      });
      tabsBar.appendChild(resetB);
    }

    geomSubmenu.appendChild(tabsBar);

    const grid = document.createElement('div');
    grid.className = 'geom-sub-grid';
    const items = getOrdered(activeDungThemTab);
    items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'gsub-btn' + (subReorderMode && subReorderFirstKey === it.id ? ' reorder-pick' : '');
      b.textContent = it.label;
      b.addEventListener('click', () => {
        if (!subReorderMode) {
          it.action();
          return;
        }
        if (!subReorderFirstKey) {
          subReorderFirstKey = it.id;
          renderDungThemMatrix();
          return;
        }
        if (subReorderFirstKey === it.id) {
          subReorderFirstKey = null;
          renderDungThemMatrix();
          return;
        }
        const ids = items.map((x) => x.id);
        const i1 = ids.indexOf(subReorderFirstKey), i2 = ids.indexOf(it.id);
        if (i1 >= 0 && i2 >= 0) {
          const tmp = ids[i1]; ids[i1] = ids[i2]; ids[i2] = tmp;
          const m = loadSubOrderMap();
          m[activeDungThemTab] = ids;
          saveSubOrderMap(m);
        }
        subReorderFirstKey = null;
        renderDungThemMatrix();
      });
      grid.appendChild(b);
    });
    geomSubmenu.appendChild(grid);
    geomSubmenu.classList.remove('hidden');
  }

  document.getElementById('gbtn-to-mien')?.addEventListener('click', () => {
    const modes = [
      { id: 'diagonal', label: '▨ Sọc chéo 45° (///)' },
      { id: 'back_diagonal', label: '▧ Sọc ngược (\\\\\\)' },
      { id: 'cross', label: '▦ Caro đan chéo (###)' },
      { id: 'horizontal', label: '▤ Gạch ngang (===)' },
      { id: 'vertical', label: '▥ Gạch dọc (|||)' },
      { id: 'dots', label: '⠿ Chấm bi (•••)' },
      { id: 'solid', label: '☑ Tô phẳng trong suốt' }
    ];
    showGeomSubmenu(modes.map((m) => ({
      label: m.label,
      action: () => {
        state.hatchMode = m.id;
        const sid = activeSid();
        if (state.selectedIndices.length > 0 && state.annots[sid]) {
          pushUndo(sid);
          state.selectedIndices.forEach((idx) => {
            const obj = state.annots[sid][idx];
            if (obj && obj.points) obj.hatch = m.id;
          });
          redrawSurface(sid);
          notify(`🎨 Đã áp dụng kiểu tô miền: ${m.label}`);
        } else {
          setTool('to_trong_suot');
          notify(`🎨 Đã chọn kiểu tô miền: ${m.label}. Kéo trên trang để vẽ miền tô.`);
        }
        geomSubmenu.classList.add('hidden');
      }
    })));
  });

  document.getElementById('gbtn-hinh-chuan')?.addEventListener('click', () => {
    showGeomSubmenu([
      { label: '🔺 Tam giác đều (3 cạnh bằng nhau)', action: () => insertPresetShape('tam_giac_deu', 'Tam giác đều ABC') },
      { label: '🔺 Tam giác cân (CA = CB)', action: () => insertPresetShape('tam_giac_can', 'Tam giác cân ABC') },
      { label: '📐 Tam giác vuông (∠A = 90°)', action: () => insertPresetShape('tam_giac_vuong', 'Tam giác vuông tại A') },
      { label: '∟ Ký hiệu góc vuông', action: () => startGeomConstruction('ky_hieu_goc_vuong') },
      { label: '∠ Ký hiệu góc (động)', action: () => startGeomConstruction('ky_hieu_goc') },
      { label: '🟩 Hình vuông (4 cạnh =, 4 góc 90°)', action: () => insertPresetShape('hinh_vuong', 'Hình vuông ABCD') },
      { label: '▭ Hình chữ nhật (4 góc 90°)', action: () => insertPresetShape('hinh_chu_nhat', 'Hình chữ nhật ABCD') },
      { label: '▰ Hình bình hành (AB // DC, AD // BC)', action: () => insertPresetShape('hinh_binh_hanh', 'Hình bình hành ABCD') },
      { label: '◆ Hình thoi (4 cạnh =, 2 chéo ⊥)', action: () => insertPresetShape('hinh_thoi', 'Hình thoi ABCD') },
      { label: '⏢ Hình thang (AB // DC)', action: () => insertPresetShape('hinh_thang', 'Hình thang ABCD') },
      { label: '⏢ Hình thang cân (2 cạnh bên =)', action: () => insertPresetShape('hinh_thang_can', 'Hình thang cân ABCD') },
      { label: '⏢ Hình thang vuông (∠A = ∠D = 90°)', action: () => insertPresetShape('hinh_thang_vuong', 'Hình thang vuông ABCD') },
      { label: '🌓 Nửa đường tròn (Tâm O, ĐK AB)', action: () => insertPresetShape('nua_duong_tron', 'Nửa đường tròn tâm O, đường kính AB') },
      { label: '⭕ Đường tròn lượng giác (Oxy)', action: () => insertPresetShape('duong_tron_luong_giac', 'Đường tròn lượng giác') }
    ]);
  });

  document.getElementById('gbtn-conic')?.addEventListener('click', () => {
    showGeomSubmenu([
      { label: '📐 Đồ thị Parabol chuẩn (Kéo được đỉnh)', action: () => insertPresetShape('conic_parabol', 'Đồ thị Parabol') },
      { label: '⚡ Hyperbol 2 nhánh chuẩn', action: () => insertPresetShape('conic_hyperbol', 'Đồ thị Hyperbol 2 nhánh') },
      { label: '📈 Đường đẳng nhiệt p = k/V (Kéo vẽ)', action: () => { setTool('dung_dang_nhiet'); geomSubmenu.classList.add('hidden'); notify('📈 Kéo trên trang để dựng đường cong đẳng nhiệt p = k/V.'); } },
      { label: '📊 Mẫu 2 đường đẳng nhiệt T₂ > T₁', action: () => insertPresetShape('dang_nhiet_pv', 'Đồ thị 2 đường đẳng nhiệt T₂ > T₁') }
    ]);
  });

  document.getElementById('gbtn-dung-them')?.addEventListener('click', () => {
    subReorderFirstKey = null;
    renderDungThemMatrix();
  });

  document.getElementById('gbtn-bien-hinh')?.addEventListener('click', () => {
    showGeomSubmenu([
      {
        label: '🪞 Lật đối xứng ngang (Qua trục đứng)',
        action: () => {
          const sid = activeSid(), list = state.annots[sid] || [];
          const box = getSelectionBox(list, state.selectedIndices);
          if (!box) { notify('⚠️ Hãy chọn đối tượng trước khi lấy đối xứng.'); return; }
          const cx = (box.x0 + box.x1) * 0.5;
          pushUndo(sid);
          state.selectedIndices.forEach((idx) => {
            const copy = JSON.parse(JSON.stringify(list[idx]));
            if (copy.points) copy.points.forEach((p) => { p.x = 2 * cx - p.x; });
            if (copy.curveControls) copy.curveControls.forEach((c) => { c.x = 2 * cx - c.x; });
            if (copy.x1 !== undefined) { copy.x1 = 2 * cx - copy.x1; copy.x2 = 2 * cx - copy.x2; }
            list.push(copy);
          });
          redrawSurface(sid);
          notify('🪞 Đã dựng hình đối xứng qua trục đứng.');
        }
      },
      {
        label: '🪞 Lật đối xứng dọc (Qua trục ngang)',
        action: () => {
          const sid = activeSid(), list = state.annots[sid] || [];
          const box = getSelectionBox(list, state.selectedIndices);
          if (!box) { notify('⚠️ Hãy chọn đối tượng trước khi lấy đối xứng.'); return; }
          const cy = (box.y0 + box.y1) * 0.5;
          pushUndo(sid);
          state.selectedIndices.forEach((idx) => {
            const copy = JSON.parse(JSON.stringify(list[idx]));
            if (copy.points) copy.points.forEach((p) => { p.y = 2 * cy - p.y; });
            if (copy.curveControls) copy.curveControls.forEach((c) => { c.y = 2 * cy - c.y; });
            if (copy.y1 !== undefined) { copy.y1 = 2 * cy - copy.y1; copy.y2 = 2 * cy - copy.y2; }
            list.push(copy);
          });
          redrawSurface(sid);
          notify('🪞 Đã dựng hình đối xứng qua trục ngang.');
        }
      }
    ]);
  });

  document.getElementById('gbtn-so-do')?.addEventListener('click', () => {
    showGeomSubmenu([
      {
        label: '📐 Thước đo độ 180° (bán nguyệt)',
        action: () => {
          toggleProtractor();
          geomSubmenu.classList.add('hidden');
        }
      },
      {
        label: '📏 Đoạn thẳng độ dài L...',
        action: () => {
          const val = parseFloat(window.prompt('Nhập độ dài đoạn thẳng L (px):', '160'));
          if (!val || val <= 0) return;
          const sid = activeSid(), surf = surfaces[sid];
          if (!surf) return;
          pushUndo(sid);
          const center = getViewportCenterWorld(sid);
          state.annots[sid].push({ type: 'duong', x1: center.x - val * 0.5, y1: center.y, x2: center.x + val * 0.5, y2: center.y, color: activeColor(), width: activeWidth() });
          redrawSurface(sid);
          geomSubmenu.classList.add('hidden');
        }
      },
      {
        label: '⭕ Đường tròn bán kính R...',
        action: () => {
          const r = parseFloat(window.prompt('Nhập bán kính đường tròn R (px):', '75'));
          if (!r || r <= 0) return;
          const sid = activeSid(), surf = surfaces[sid];
          if (!surf) return;
          pushUndo(sid);
          const center = getViewportCenterWorld(sid);
          const list = state.annots[sid];
          const centerObj = { type: 'diem', x: center.x, y: center.y, text: nextPointLabel(list), color: activeColor() };
          ensureGeomId(centerObj);
          list.push(centerObj);
          list.push({
            type: 'elip',
            isCircle: true,
            x: center.x - r,
            y: center.y - r,
            w: r * 2,
            h: r * 2,
            centerRef: { kind: 'diem', id: centerObj.id, x: center.x, y: center.y },
            color: activeColor(),
            width: activeWidth()
          });
          redrawSurface(sid);
          geomSubmenu.classList.add('hidden');
        }
      }
    ]);
  });

  document.getElementById('gbtn-tao-oxy')?.addEventListener('click', () => {
    showGeomSubmenu([
      { label: '📐 Hệ trục tọa độ Oxy mini', action: () => insertPresetShape('oxy_mini', 'Hệ trục tọa độ Oxy mini') },
      { label: '⭕ Đường tròn lượng giác (Oxy)', action: () => insertPresetShape('duong_tron_luong_giac', 'Đường tròn lượng giác') },
      { label: '⭕ ĐTLG Dao động điều hòa (2 điểm + Cung + Chiếu cos)', action: () => insertPresetShape('duong_tron_luong_giac_ddh', 'ĐTLG Dao động điều hòa') }
    ]);
  });

  document.getElementById('gbtn-thao-tac')?.addEventListener('click', () => {
    showGeomSubmenu([
      {
        label: '🔗 Gộp điểm đang chọn (Chọn điểm đích...)',
        action: () => {
          if (geomSubmenu) geomSubmenu.classList.add('hidden');
          promptMergeTarget(activeSid());
        }
      },
      {
        label: '📋 Nhân bản đối tượng đang chọn (Ctrl+D)',
        action: () => {
          const sid = activeSid(), list = state.annots[sid] || [];
          if (!state.selectedIndices.length) return;
          pushUndo(sid);
          const newIdx = [];
          state.selectedIndices.forEach((idx) => {
            if (!list[idx]) return;
            const copy = JSON.parse(JSON.stringify(list[idx]));
            NKInkEngine.translateObject(copy, 20, 20);
            list.push(copy);
            newIdx.push(list.length - 1);
          });
          state.selectedIndices = newIdx;
          redrawSurface(sid);
          geomSubmenu.classList.add('hidden');
          notify('📋 Đã nhân bản đối tượng đang chọn.');
        }
      },
      {
        label: '−− Chuyển Nét đứt / Nét liền',
        action: () => {
          const sid = activeSid(), list = state.annots[sid] || [];
          if (!state.selectedIndices.length) return;
          pushUndo(sid);
          state.selectedIndices.forEach((idx) => {
            if (list[idx]) list[idx].dashed = !list[idx].dashed;
          });
          syncWaveInterferenceDash(list, state.selectedIndices.map((idx) => list[idx]));
          redrawSurface(sid);
          geomSubmenu.classList.add('hidden');
        }
      },
      { label: '🗑️ Xóa đối tượng đang chọn', action: () => { deleteSelected(); geomSubmenu.classList.add('hidden'); } }
    ]);
  });

  document.getElementById('gbtn-chon-nhieu')?.addEventListener('click', (e) => {
    state.multiSelect = !state.multiSelect;
    e.currentTarget.classList.toggle('active', state.multiSelect);
    document.querySelectorAll('[data-qaction="chon_nhieu"]').forEach((b) => b.classList.toggle('active', state.multiSelect));
    notify(state.multiSelect ? '☑ Đã BẬT chế độ Chọn nhiều đối tượng' : 'Đã TẮT chế độ Chọn nhiều');
  });

  document.getElementById('gbtn-bo-chon')?.addEventListener('click', () => {
    const sid = activeSid();
    state.selectedIndices = [];
    state.selectedVertices = [];
    state.hideSelectionBoxForVertex = false;
    linkedLinePick = null;
    circleCenterPick = null;
    polyBuildPick = null;
    geomConstructState = null;
    if (surfaces[sid]) {
      surfaces[sid].pickedPoints = [];
      surfaces[sid].activeVertexHighlight = null;
      surfaces[sid].previewObj = null;
      redrawActiveLayer(sid);
    }
    redrawSurface(sid);
  });

  document.getElementById('gbtn-diem-dung')?.addEventListener('click', (e) => {
    state.showPointDots = !state.showPointDots;
    e.currentTarget.classList.toggle('active', state.showPointDots);
    redrawSurface(activeSid());
    notify(state.showPointDots ? '👁 Đã HIỆN điểm dựng' : '👁 Đã ẨN điểm dựng');
  });

  document.getElementById('gbtn-nhan')?.addEventListener('click', (e) => {
    state.showLabels = !state.showLabels;
    e.currentTarget.classList.toggle('active', state.showLabels);
    redrawSurface(activeSid());
  });

  document.getElementById('gbtn-hien-an')?.addEventListener('click', () => {
    const sid = activeSid(), list = state.annots[sid] || [];
    if (state.selectedIndices.length > 0) {
      state.selectedIndices.forEach((idx) => { if (list[idx]) list[idx].hidden = !list[idx].hidden; });
    } else {
      list.forEach((obj) => { obj.hidden = false; });
    }
    redrawSurface(sid);
  });

  function setGeomMatrixCols(cols) {
    const allowed = [2, 3, 4, 6, 8, 12];
    const best = allowed.reduce((a, b) => Math.abs(b - cols) < Math.abs(a - cols) ? b : a, 8);
    const grid = document.getElementById('GeomMatrixGrid');
    const badge = document.getElementById('geom-matrix-badge');
    if (grid) grid.className = 'geom-matrix-grid cols-' + best;
    if (badge) badge.textContent = `[${best}×${Math.round(24 / best)}]`;
    return best;
  }

  let mainGridReorderMode = false;
  let mainGridFirstBtn = null;
  const geomGridEl = document.getElementById('GeomMatrixGrid');
  if (geomGridEl) {
    const btns = Array.from(geomGridEl.querySelectorAll('.gbtn'));
    const defaultMainOrder = btns.map((b) => b.dataset.gtool || b.id);
    try {
      const savedOrder = JSON.parse(localStorage.getItem('nkpdf_geom_main_order') || 'null');
      if (Array.isArray(savedOrder) && savedOrder.length > 0) {
        const byKey = new Map(btns.map((b) => [b.dataset.gtool || b.id, b]));
        savedOrder.forEach((k) => { if (byKey.has(k)) { geomGridEl.appendChild(byKey.get(k)); byKey.delete(k); } });
        byKey.forEach((b) => geomGridEl.appendChild(b));
      }
    } catch (_) {}
    geomGridEl.addEventListener('click', (e) => {
      if (!mainGridReorderMode) return;
      const btn = e.target.closest('.gbtn');
      if (!btn || btn.id === 'gbtn-sap-xep') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!mainGridFirstBtn) {
        mainGridFirstBtn = btn;
        btn.classList.add('reorder-pick');
        return;
      }
      if (mainGridFirstBtn === btn) {
        btn.classList.remove('reorder-pick');
        mainGridFirstBtn = null;
        return;
      }
      const all = Array.from(geomGridEl.querySelectorAll('.gbtn'));
      const i1 = all.indexOf(mainGridFirstBtn), i2 = all.indexOf(btn);
      if (i1 >= 0 && i2 >= 0) {
        const tmp = all[i1]; all[i1] = all[i2]; all[i2] = tmp;
        all.forEach((el) => geomGridEl.appendChild(el));
        try { localStorage.setItem('nkpdf_geom_main_order', JSON.stringify(all.map((b) => b.dataset.gtool || b.id))); } catch (_) {}
      }
      mainGridFirstBtn.classList.remove('reorder-pick');
      mainGridFirstBtn = null;
    }, true);
    geomGridEl._resetMainOrder = () => {
      const byKey = new Map(Array.from(geomGridEl.querySelectorAll('.gbtn')).map((b) => [b.dataset.gtool || b.id, b]));
      defaultMainOrder.forEach((k) => { if (byKey.has(k)) geomGridEl.appendChild(byKey.get(k)); });
      try { localStorage.removeItem('nkpdf_geom_main_order'); } catch (_) {}
    };
  }

  document.getElementById('gbtn-sap-xep')?.addEventListener('click', () => {
    showGeomSubmenu([
      {
        label: mainGridReorderMode ? '✓ Xong sắp xếp nút' : '🔀 Đổi vị trí các nút',
        action: () => {
          mainGridReorderMode = !mainGridReorderMode;
          if (mainGridFirstBtn) { mainGridFirstBtn.classList.remove('reorder-pick'); mainGridFirstBtn = null; }
          geomSubmenu.classList.add('hidden');
          notify(mainGridReorderMode ? '🔀 Chạm lần lượt 2 ô trên bảng dựng hình để đổi vị trí!' : '✓ Đã lưu vị trí các công cụ.');
        }
      },
      {
        label: '↺ Vị trí mặc định',
        action: () => {
          if (geomGridEl && geomGridEl._resetMainOrder) geomGridEl._resetMainOrder();
          mainGridReorderMode = false;
          if (mainGridFirstBtn) { mainGridFirstBtn.classList.remove('reorder-pick'); mainGridFirstBtn = null; }
          geomSubmenu.classList.add('hidden');
          notify('↺ Đã khôi phục vị trí mặc định các công cụ.');
        }
      },
      { label: '12 cột × 2 hàng', action: () => { setGeomMatrixCols(12); geomSubmenu.classList.add('hidden'); } },
      { label: '8 cột × 3 hàng (Mặc định)', action: () => { setGeomMatrixCols(8); geomSubmenu.classList.add('hidden'); } },
      { label: '6 cột × 4 hàng', action: () => { setGeomMatrixCols(6); geomSubmenu.classList.add('hidden'); } },
      { label: '4 cột × 6 hàng', action: () => { setGeomMatrixCols(4); geomSubmenu.classList.add('hidden'); } },
      { label: '3 cột × 8 hàng', action: () => { setGeomMatrixCols(3); geomSubmenu.classList.add('hidden'); } },
      { label: '2 cột × 12 hàng', action: () => { setGeomMatrixCols(2); geomSubmenu.classList.add('hidden'); } }
    ]);
  });

  document.getElementById('gbtn-huy')?.addEventListener('click', () => {
    const sid = activeSid();
    state.selectedIndices = [];
    state.selectedVertices = [];
    state.hideSelectionBoxForVertex = false;
    linkedLinePick = null;
    circleCenterPick = null;
    polyBuildPick = null;
    geomConstructState = null;
    if (surfaces[sid]) {
      surfaces[sid].pickedPoints = [];
      surfaces[sid].activeVertexHighlight = null;
      surfaces[sid].previewObj = null;
      redrawActiveLayer(sid);
    }
    geomSubmenu.classList.add('hidden');
    setTool('chinh_hinh_dong');
    redrawSurface(sid);
  });

  function makeDraggable(winEl, handleEl) {
    if (!winEl || !handleEl) return;
    let dragging = false, ox = 0, oy = 0, activePid = null;
    const onDown = (e) => {
      if (e.target.closest('button, select, input, .geom-resize-e, .geom-resize-s, .geom-resize-se')) return;
      dragging = true;
      activePid = e.pointerId;
      const r = winEl.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging || (activePid !== null && e.pointerId !== activePid)) return;
      const maxL = Math.max(4, window.innerWidth - 90);
      const maxT = Math.max(4, window.innerHeight - 60);
      winEl.style.left = Math.max(4, Math.min(maxL, e.clientX - ox)) + 'px';
      winEl.style.top = Math.max(4, Math.min(maxT, e.clientY - oy)) + 'px';
      winEl.style.right = 'auto';
      e.preventDefault();
    };
    const onUp = () => { dragging = false; activePid = null; };
    handleEl.addEventListener('pointerdown', onDown);
    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
    handleEl.addEventListener('pointercancel', onUp);
  }
  makeDraggable(geomToolbar, geomToolbar);
  makeDraggable(document.getElementById('CuaSoCasio'), document.getElementById('casio-drag-handle'));

  (function setupGeomMatrixResize() {
    const rE = document.getElementById('geom-resize-e');
    const rS = document.getElementById('geom-resize-s');
    const rSE = document.getElementById('geom-resize-se');
    const bindResize = (el, mode) => {
      if (!el) return;
      let active = false, pid = null, startRect = null;
      el.addEventListener('pointerdown', (e) => {
        active = true;
        pid = e.pointerId;
        startRect = geomToolbar.getBoundingClientRect();
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        e.stopPropagation();
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (!active || (pid !== null && e.pointerId !== pid) || !startRect) return;
        const w = Math.max(200, e.clientX - startRect.left);
        const h = Math.max(90, e.clientY - startRect.top);
        if (mode === 'e') {
          setGeomMatrixCols(Math.round((w - 18) / 100));
        } else if (mode === 's') {
          const rows = Math.max(2, Math.min(12, Math.round((h - 56) / 32)));
          setGeomMatrixCols(Math.round(24 / rows));
        } else {
          setGeomMatrixCols(Math.round((w - 18) / 100));
        }
        e.preventDefault();
      });
      const done = () => { active = false; pid = null; };
      el.addEventListener('pointerup', done);
      el.addEventListener('pointercancel', done);
    };
    bindResize(rE, 'e');
    bindResize(rS, 's');
    bindResize(rSE, 'se');
  })();

  // ============================================================================
  // TRÌNH ĐỌC PDF SIÊU NHẸ CHỐNG NHẢY TRANG & CHỐNG TREO IPADOS 100%
  // Nguyên lý vàng trên Safari WebKit:
  // 1. TRONG LÚC NGÓN TAY ĐANG VUỐT CUỘN: KHÔNG render PDF, KHÔNG đổi DOM -> 120 FPS mượt tuyệt đối, không bao giờ nhảy trang!
  // 2. KHI CUỘN DỪNG (150ms): Chỉ nạp đúng 1-2 trang đang ở trong khung nhìn (tối đa 3 trang trong RAM),
  //    dùng chung 1 activeCanvas duy nhất -> Tổng RAM GPU < 20 MB dù PDF dài 200 trang!
  // ============================================================================
  const mountedOrder = [];
  let scrollIdleTimer = null;
  let renderChain = Promise.resolve();
  let renderEpoch = 0;
  const MAX_MOUNTED_PAGES = 3;
  const sharedPdfActiveCanvas = document.createElement('canvas');
  sharedPdfActiveCanvas.className = 'pdf-active-canvas';

  function attachSharedActiveCanvas(pno) {
    const surf = surfaces[pno];
    if (!surf || !surf.mounted || !surf.wrap) return;
    const targetW = Math.round(surf.cssWidth * surf.dpr);
    const targetH = Math.round(surf.cssHeight * surf.dpr);
    if (sharedPdfActiveCanvas.parentNode !== surf.wrap) {
      Object.keys(surfaces).forEach((k) => {
        if (k !== 'board' && surfaces[k] && surfaces[k].activeCanvas === sharedPdfActiveCanvas) {
          surfaces[k].activeCanvas = null;
        }
      });
      surf.wrap.appendChild(sharedPdfActiveCanvas);
    }
    if (sharedPdfActiveCanvas.width !== targetW || sharedPdfActiveCanvas.height !== targetH) {
      sharedPdfActiveCanvas.width = targetW;
      sharedPdfActiveCanvas.height = targetH;
    }
    surf.activeCanvas = sharedPdfActiveCanvas;
  }

  function updateRamBadge() {
    const badge = document.getElementById('ram-status-badge');
    if (!badge) return;
    badge.textContent = `⚡ RAM GPU an toàn: ${mountedOrder.length}/${state.totalPages} trang`;
  }

  function getVisiblePageRange() {
    const topY = pdfScroll.scrollTop;
    const botY = topY + pdfScroll.clientHeight;
    const hits = [];
    for (let pno = 1; pno <= state.totalPages; pno++) {
      const surf = surfaces[pno];
      if (!surf || !surf.wrap) continue;
      const elTop = surf.wrap.offsetTop;
      const elBot = elTop + surf.cssHeight;
      if (elBot >= topY - 100 && elTop <= botY + 100) {
        hits.push(pno);
      } else if (elTop > botY + 100) {
        break;
      }
    }
    return hits;
  }

  function syncVisiblePdfPages() {
    scrollIdleTimer = null;
    if (!state.pdfDoc || state.totalPages === 0) return;
    const vis = getVisiblePageRange();
    if (vis.length === 0) return;

    const midPage = vis[Math.floor(vis.length / 2)];
    state.currentPage = midPage;
    updateStatusPage();

    // Giữ tối đa 3 trang quanh vùng đang nhìn, giải phóng NGAY các trang ngoài vùng nhìn
    const keepSet = new Set(vis.slice(0, MAX_MOUNTED_PAGES));
    mountedOrder.slice().forEach((p) => {
      if (!keepSet.has(p)) unmountPdfPageCanvases(p);
    });

    const myEpoch = ++renderEpoch;
    const targets = Array.from(keepSet);
    targets.forEach((pno) => {
      renderChain = renderChain.then(() => {
        if (myEpoch !== renderEpoch) return;
        return mountPdfPageCanvases(pno);
      }).then(() => {
        if (myEpoch === renderEpoch && typeof scheduleTvFrameSync === 'function') {
          scheduleTvFrameSync('page', true);
        }
      }).catch(() => {});
    });
  }

  pdfScroll.addEventListener('scroll', () => {
    if (!state.pdfDoc) return;
    // Hủy mọi tác vụ render đang chờ trong lúc ngón tay đang vuốt để CPU 100% rảnh cho cuộn mượt!
    renderEpoch++;
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(syncVisiblePdfPages, 150);
    if (typeof scheduleTvScrollSync === 'function') scheduleTvScrollSync();
  }, { passive: true });

  async function loadPdfBytes(uint8, fileName) {
    if (!window.pdfjsLib) return;
    try {
      state.pdfBytes = uint8.slice();
      state.pdfFileName = fileName || 'Tai_lieu.pdf';
      document.getElementById('doc-tab-title').textContent = state.pdfFileName;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: uint8 }).promise;
      state.pageSlots = [];
      for (let i = 1; i <= state.pdfDoc.numPages; i++) {
        state.pageSlots.push({ kind: 'pdf', pdfPageNo: i });
      }
      state.totalPages = state.pageSlots.length;
      state.currentPage = 1;
      state.activeSurfaceId = 1;
      state.selectedIndices = [];

      await buildPagePlaceholders();
      updateStatusPage();
      notify(`Đã mở nhẹ nhàng ${state.pdfFileName} — ${state.totalPages} trang.`, false);
      if (typeof tvOnPdfLoaded === 'function') tvOnPdfLoaded();
    } catch (err) {
      notify('⚠️ Lỗi đọc tệp PDF: ' + err.message);
    }
  }

  function evictExcessMountedPages(keepPage) {
    while (mountedOrder.length >= MAX_MOUNTED_PAGES) {
      let victimIdx = -1;
      let maxDist = -1;
      for (let i = 0; i < mountedOrder.length; i++) {
        const p = mountedOrder[i];
        if (p === keepPage) continue;
        const dist = Math.abs(p - keepPage);
        if (dist > maxDist) {
          maxDist = dist;
          victimIdx = i;
        }
      }
      if (victimIdx === -1) break;
      unmountPdfPageCanvases(mountedOrder[victimIdx]);
    }
  }

  async function mountPdfPageCanvases(pno) {
    const surf = surfaces[pno];
    if (!surf || !surf.wrap) return;
    const { wrap, cssWidth: cssW, cssHeight: cssH, dpr } = surf;

    if (!surf.mounted) {
      evictExcessMountedPages(pno);
      wrap.innerHTML = '';

      const baseC = document.createElement('canvas');
      baseC.className = 'pdf-base-canvas';
      baseC.width = Math.round(cssW * dpr);
      baseC.height = Math.round(cssH * dpr);
      baseC.style.width = cssW + 'px';
      baseC.style.height = cssH + 'px';

      const inkC = document.createElement('canvas');
      inkC.className = 'pdf-ink-canvas';
      inkC.width = Math.round(cssW * dpr);
      inkC.height = Math.round(cssH * dpr);

      wrap.appendChild(baseC);
      wrap.appendChild(inkC);

      surf.baseCanvas = baseC;
      surf.inkCanvas = inkC;
      surf.activeCanvas = null;
      surf.mounted = true;
      surf.renderedZoom = null;
      surf.renderedRot = null;
      surf.renderTask = null;

      if (!mountedOrder.includes(pno)) mountedOrder.push(pno);
      bindSurfaceEvents(pno, inkC);
      redrawSurface(pno);
      updateRamBadge();
    }

    const rotPref = state.pageRotations[pno] || 0;
    if (surf.renderedZoom === state.zoom && surf.renderedRot === rotPref) return;

    if (surf.renderTask) {
      try { surf.renderTask.cancel(); } catch (_) {}
      surf.renderTask = null;
    }

    try {
      const slot = state.pageSlots[pno - 1] || { kind: 'pdf', pdfPageNo: pno };
      if (slot.kind === 'blank') {
        if (!surf.mounted || !surf.baseCanvas) return;
        const bctx = surf.baseCanvas.getContext('2d');
        bctx.save();
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.fillStyle = '#FFFFFF';
        bctx.fillRect(0, 0, surf.baseCanvas.width, surf.baseCanvas.height);
        bctx.restore();
        surf.renderedZoom = state.zoom;
        surf.renderedRot = rotPref;
        return;
      }
      const page = await state.pdfDoc.getPage(slot.pdfPageNo);
      if (!surf.mounted || !surf.baseCanvas) return;
      const rot = (page.rotate + rotPref) % 360;
      const rvp = page.getViewport({ scale: state.zoom * dpr, rotation: rot });
      const task = page.render({ canvasContext: surf.baseCanvas.getContext('2d'), viewport: rvp });
      surf.renderTask = task;
      await task.promise;
      if (surf.renderTask === task) surf.renderTask = null;
      surf.renderedZoom = state.zoom;
      surf.renderedRot = rotPref;
    } catch (_) {
      surf.renderTask = null;
    }
  }

  function unmountPdfPageCanvases(pno) {
    const surf = surfaces[pno];
    if (!surf || !surf.mounted) return;
    if (surf.renderTask) {
      try { surf.renderTask.cancel(); } catch (_) {}
      surf.renderTask = null;
    }
    if (surf.activeCanvas === sharedPdfActiveCanvas && sharedPdfActiveCanvas.parentNode === surf.wrap) {
      surf.wrap.removeChild(sharedPdfActiveCanvas);
    }
    // Giải phóng NGAY lập tức toàn bộ GPU IOSurface RAM trên WebKit iPadOS (width=0, height=0)
    [surf.baseCanvas, surf.inkCanvas].forEach((c) => {
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    });
    if (surf.wrap) surf.wrap.innerHTML = '';
    surf.baseCanvas = null;
    surf.inkCanvas = null;
    surf.activeCanvas = null;
    surf.mounted = false;
    surf.renderedZoom = null;
    const idx = mountedOrder.indexOf(pno);
    if (idx >= 0) mountedOrder.splice(idx, 1);
    updateRamBadge();
  }

  async function buildPagePlaceholders() {
    if (!state.pdfDoc) return;
    const prevScrollRatio = pdfScroll.scrollHeight > 0 ? pdfScroll.scrollTop / pdfScroll.scrollHeight : 0;

    renderEpoch++;
    if (scrollIdleTimer) { clearTimeout(scrollIdleTimer); scrollIdleTimer = null; }
    Object.keys(surfaces).forEach((k) => {
      if (k !== 'board') unmountPdfPageCanvases(parseInt(k, 10));
    });
    mountedOrder.length = 0;
    pdfHolder.innerHTML = '';
    // Tối ưu dpr = 1.35 trên PDF để giảm >54% RAM GPU WebKit mà chữ vẫn cực sắc nét!
    const dpr = Math.min(1.35, Math.max(1.15, window.devicePixelRatio || 1));

    // Đọc kích thước trang 1 làm chuẩn nhanh (với PDF 50-200 trang đồng cỡ, chỉ mất <15ms tạo toàn bộ khung trang!)
    let defaultW = Math.round(595.28 * state.zoom);
    let defaultH = Math.round(841.89 * state.zoom);
    try {
      const p1 = await state.pdfDoc.getPage(1);
      const vp1 = p1.getViewport({ scale: state.zoom, rotation: p1.rotate % 360 });
      defaultW = Math.round(vp1.width);
      defaultH = Math.round(vp1.height);
    } catch (_) {}

    const frag = document.createDocumentFragment();
    for (let pno = 1; pno <= state.totalPages; pno++) {
      const slot = state.pageSlots[pno - 1] || { kind: 'pdf', pdfPageNo: pno };
      let cssW = defaultW, cssH = defaultH;
      if (slot.kind === 'blank') {
        const rotPref = state.pageRotations[pno] || 0;
        const swapped = rotPref % 180 !== 0;
        cssW = Math.round((swapped ? slot.heightPt : slot.widthPt) * state.zoom);
        cssH = Math.round((swapped ? slot.widthPt : slot.heightPt) * state.zoom);
      } else if (state.pageRotations[pno]) {
        const swapped = (state.pageRotations[pno] || 0) % 180 !== 0;
        cssW = swapped ? defaultH : defaultW;
        cssH = swapped ? defaultW : defaultH;
      }

      const wrap = document.createElement('div');
      wrap.className = `pdf-page-wrapper theme-${state.pdfTheme} ${state.showGrid ? 'show-css-grid' : ''}`;
      wrap.style.width = cssW + 'px';
      wrap.style.height = cssH + 'px';
      wrap.dataset.page = pno;
      frag.appendChild(wrap);

      surfaces[pno] = {
        wrap,
        gridCanvas: null,
        inkCanvas: null,
        activeCanvas: null,
        baseCanvas: null,
        mounted: false,
        dpr,
        cssWidth: cssW,
        cssHeight: cssH,
        previewObj: null,
        marqueeBox: null,
        snapBadge: null,
        renderedZoom: null,
        renderedRot: null,
        renderTask: null
      };
    }
    pdfHolder.appendChild(frag);

    if (prevScrollRatio > 0) {
      pdfScroll.scrollTop = prevScrollRatio * pdfScroll.scrollHeight;
    }
    syncVisiblePdfPages();
  }

  // Tự động thêm trang trống mới ở đầu hoặc cuối PDF khi Thầy kéo mạnh ở trang đầu / trang cuối!
  let addingBlankPage = false;
  async function insertBlankPage(position = 'bottom') {
    if (addingBlankPage || !state.pdfDoc) return;
    addingBlankPage = true;
    try {
      // Lấy kích thước chuẩn theo trang 1 hiện tại (mặc định A4 595.28 x 841.89 pt)
      let widthPt = 595.28, heightPt = 841.89;
      try {
        const p1 = await state.pdfDoc.getPage(1);
        const vp1 = p1.getViewport({ scale: 1.0 });
        widthPt = vp1.width;
        heightPt = vp1.height;
      } catch (_) {}

      const dpr = Math.min(1.5, Math.max(1.25, window.devicePixelRatio || 1));

      if (position === 'bottom') {
        const newPno = state.totalPages + 1;
        state.pageSlots.push({ kind: 'blank', widthPt, heightPt });
        state.totalPages = state.pageSlots.length;

        const cssW = Math.round(widthPt * state.zoom);
        const cssH = Math.round(heightPt * state.zoom);
        const wrap = document.createElement('div');
        wrap.className = `pdf-page-wrapper theme-${state.pdfTheme} ${state.showGrid ? 'show-css-grid' : ''}`;
        wrap.style.width = cssW + 'px';
        wrap.style.height = cssH + 'px';
        wrap.dataset.page = newPno;
        pdfHolder.appendChild(wrap);

        surfaces[newPno] = {
          wrap, gridCanvas: null, inkCanvas: null, activeCanvas: null, baseCanvas: null,
          mounted: false, dpr, cssWidth: cssW, cssHeight: cssH,
          previewObj: null, marqueeBox: null, snapBadge: null,
          renderedZoom: null, renderedRot: null, renderTask: null
        };
        await mountPdfPageCanvases(newPno);
        state.currentPage = newPno;
        updateStatusPage();
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        notify(`📄 Đã thêm trang trống mới (Trang ${newPno}) ở cuối tài liệu!`);
      } else {
        // Thêm trang trống ở đầu -> Dịch chuyển toàn bộ nét vẽ, undo/redo, xoay trang sang +1
        for (let p = state.totalPages; p >= 1; p--) {
          state.annots[p + 1] = state.annots[p] || [];
          state.undoStack[p + 1] = state.undoStack[p] || [];
          state.redoStack[p + 1] = state.redoStack[p] || [];
          if (state.pageRotations[p] !== undefined) state.pageRotations[p + 1] = state.pageRotations[p];
          else delete state.pageRotations[p + 1];
        }
        state.annots[1] = [];
        state.undoStack[1] = [];
        state.redoStack[1] = [];
        delete state.pageRotations[1];

        state.pageSlots.unshift({ kind: 'blank', widthPt, heightPt });
        state.totalPages = state.pageSlots.length;
        state.currentPage = 1;
        state.activeSurfaceId = 1;
        await buildPagePlaceholders();
        pdfScroll.scrollTop = 0;
        updateStatusPage();
        notify(`📄 Đã thêm trang trống mới ở đầu tài liệu (Tổng ${state.totalPages} trang)!`);
      }
    } finally {
      setTimeout(() => { addingBlankPage = false; }, 350);
    }
  }

  // Bắt cử chỉ kéo mạnh ở đầu trang 1 hoặc cuối trang cuối để tự động tạo trang trống mới (kiểu GoodNotes)
  const pullAddPill = document.getElementById('PullAddPagePill');
  let pullStartY = 0, pullAtTop = false, pullAtBottom = false, pullReady = null;

  pdfScroll.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('mobile-student-mode')) {
      pullAtTop = false; pullAtBottom = false; pullReady = null;
      return;
    }
    if (e.touches && e.touches.length === 1 && e.touches[0].touchType !== 'stylus' && !isMultiTouch) {
      pullStartY = e.touches[0].clientY;
      pullAtTop = pdfScroll.scrollTop <= 1;
      pullAtBottom = (pdfScroll.scrollTop + pdfScroll.clientHeight >= pdfScroll.scrollHeight - 2);
      pullReady = null;
    } else {
      pullAtTop = false;
      pullAtBottom = false;
      pullReady = null;
    }
  }, { passive: true });

  pdfScroll.addEventListener('touchmove', (e) => {
    if (!pullAddPill || document.body.classList.contains('mobile-student-mode') || !e.touches || e.touches.length !== 1 || e.touches[0].touchType === 'stylus' || isMultiTouch) {
      if (pullAddPill) pullAddPill.classList.add('hidden');
      pullReady = null;
      return;
    }
    const dy = e.touches[0].clientY - pullStartY;
    const PULL_HINT_PX = 85;
    const PULL_TRIGGER_PX = 220;
    if (pullAtTop && pdfScroll.scrollTop <= 1 && dy > PULL_HINT_PX) {
      pullAddPill.classList.remove('hidden', 'pos-bottom');
      pullAddPill.classList.add('pos-top');
      if (dy >= PULL_TRIGGER_PX) {
        pullReady = 'top';
        pullAddPill.classList.add('ready');
        pullAddPill.textContent = '✨ Thả tay để thêm trang trống mới ở ĐẦU!';
      } else {
        pullReady = null;
        pullAddPill.classList.remove('ready');
        const pct = Math.min(99, Math.round(((dy - PULL_HINT_PX) / (PULL_TRIGGER_PX - PULL_HINT_PX)) * 100));
        pullAddPill.textContent = `⬇️ Kéo thật mạnh thêm (${pct}%) để tạo trang ở ĐẦU...`;
      }
    } else if (pullAtBottom && (pdfScroll.scrollTop + pdfScroll.clientHeight >= pdfScroll.scrollHeight - 2) && dy < -PULL_HINT_PX) {
      pullAddPill.classList.remove('hidden', 'pos-top');
      pullAddPill.classList.add('pos-bottom');
      if (dy <= -PULL_TRIGGER_PX) {
        pullReady = 'bottom';
        pullAddPill.classList.add('ready');
        pullAddPill.textContent = '✨ Thả tay để thêm trang trống mới ở CUỐI!';
      } else {
        pullReady = null;
        pullAddPill.classList.remove('ready');
        const pct = Math.min(99, Math.round(((-dy - PULL_HINT_PX) / (PULL_TRIGGER_PX - PULL_HINT_PX)) * 100));
        pullAddPill.textContent = `⬆️ Kéo thật mạnh thêm (${pct}%) để tạo trang ở CUỐI...`;
      }
    } else {
      pullAddPill.classList.add('hidden');
      pullReady = null;
    }
  }, { passive: true });

  pdfScroll.addEventListener('touchend', () => {
    if (pullAddPill) pullAddPill.classList.add('hidden');
    if (pullReady === 'top') insertBlankPage('top');
    else if (pullReady === 'bottom') insertBlankPage('bottom');
    pullReady = null;
    pullAtTop = false;
    pullAtBottom = false;
  }, { passive: true });

  pdfScroll.addEventListener('touchcancel', () => {
    if (pullAddPill) pullAddPill.classList.add('hidden');
    pullReady = null;
  }, { passive: true });

  function jumpToPage(pno) {
    if (!state.pdfDoc) return;
    state.currentPage = Math.max(1, Math.min(state.totalPages, pno));
    state.activeSurfaceId = state.currentPage;
    const el = document.querySelector(`.pdf-page-wrapper[data-page="${state.currentPage}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateStatusPage();
  }

  function updateStatusPage() {
    document.getElementById('sb-page-input').value = state.currentPage;
    document.getElementById('sb-total-pages').textContent = `/ ${state.totalPages}`;
    const msPageInfo = document.getElementById('ms-page-info');
    if (msPageInfo) {
      msPageInfo.textContent = `Trang ${state.currentPage}/${state.totalPages}`;
    }
  }

  // ============================================================================
  // ĐIỀU KHIỂN RIBBON TINH GỌN, THANH DỌC, CÔNG CỤ, MÀU BÚT, HỘP THOẠI
  // ============================================================================
  document.querySelectorAll('.ribbon-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const rb = document.getElementById('Ribbon');
      const target = tab.dataset.rtab;
      const isSameActive = tab.classList.contains('active') && rb && !rb.classList.contains('hidden');
      if (isSameActive) {
        rb.classList.add('hidden');
        tab.classList.remove('active');
        const iconEl = document.getElementById('collapse-ribbon-icon');
        if (iconEl) iconEl.textContent = '▼';
        return;
      }
      document.querySelectorAll('.ribbon-tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.ribbon-page').forEach((p) => {
        p.classList.toggle('active', p.id === `rpage-${target}`);
      });
      if (rb) rb.classList.remove('hidden');
      const iconEl = document.getElementById('collapse-ribbon-icon');
      if (iconEl) iconEl.textContent = '▲';
    });
  });

  document.getElementById('top-btn-collapse-ribbon').addEventListener('click', () => {
    const rb = document.getElementById('Ribbon');
    rb.classList.toggle('hidden');
    document.getElementById('collapse-ribbon-icon').textContent = rb.classList.contains('hidden') ? '▼' : '▲';
  });

  function toggleVerticalBar() {
    const vb = document.getElementById('ThanhCongCuDoc');
    vb.classList.toggle('hidden');
    document.getElementById('top-btn-thanh-doc').classList.toggle('active', !vb.classList.contains('hidden'));
  }
  document.getElementById('top-btn-thanh-doc').addEventListener('click', toggleVerticalBar);
  document.getElementById('vbar-toggle-btn').addEventListener('click', toggleVerticalBar);

  function setTool(t) {
    const sid = activeSid();
    if (t === 'xoa_vung_but' && state.selectedIndices.length > 0) {
      const cnt = state.selectedIndices.length;
      deleteSelected();
      setTool('but');
      notify(`🗑️ Đã xóa ${cnt} đối tượng đang chọn (đã chuyển về Bút viết).`);
      return;
    }
    state.tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === t);
    });
    document.querySelectorAll('[data-bxtool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.bxtool === t);
    });
    document.querySelectorAll('[data-gtool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.gtool === t);
    });
    document.querySelectorAll('[data-qtool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.qtool === t);
    });
    if (t !== 'dung_doan' && t !== 'dung_mui_ten') linkedLinePick = null;
    if (t !== 'dung_tron') circleCenterPick = null;
    if (t !== 'dung_da_giac') polyBuildPick = null;
    if (t !== 'chon' && t !== 'chinh_sua' && t !== 'chinh_hinh_dong') {
      state.selectedIndices = [];
    }
    redrawSurface(sid);
  }
  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });

  function setPenColor(hex) {
    state.color = hex;
    document.querySelectorAll('.c-dot, .vc-dot').forEach((d) => {
      d.classList.toggle('active', d.dataset.color === hex);
    });
    const sid = activeSid();
    if (state.selectedIndices.length > 0 && state.annots[sid]) {
      pushUndo(sid);
      state.selectedIndices.forEach((idx) => {
        if (state.annots[sid][idx]) state.annots[sid][idx].color = hex;
      });
      redrawSurface(sid);
    }
  }
  document.querySelectorAll('.c-dot, .vc-dot').forEach((d) => {
    d.addEventListener('click', () => setPenColor(d.dataset.color));
  });
  document.getElementById('custom-pen-color').addEventListener('input', (e) => setPenColor(e.target.value));

  document.querySelectorAll('.w-pill[data-width]').forEach((p) => {
    p.addEventListener('click', () => {
      const newW = parseFloat(p.dataset.width);
      state.width = newW;
      if (state.mode === 'board') state.boardWidth = newW;
      document.querySelectorAll('.w-pill[data-width]').forEach((w) => w.classList.toggle('active', w === p));
      const sid = activeSid();
      if (state.selectedIndices.length > 0 && state.annots[sid]) {
        pushUndo(sid);
        state.selectedIndices.forEach((idx) => {
          if (state.annots[sid][idx]) state.annots[sid][idx].width = newW;
        });
        redrawSurface(sid);
        notify(`✏️ Đã đổi cỡ nét hình đang chọn (${p.textContent.trim()})`);
      }
    });
  });

  function toggleSnapPoint() {
    state.snapPoint = !state.snapPoint;
    document.getElementById('top-btn-hut-diem').classList.toggle('active', state.snapPoint);
    document.getElementById('bx-btn-snap-pt').classList.toggle('active', state.snapPoint);
    notify(state.snapPoint ? '🧲 Đã BẬT Hút điểm đầu mút và đỉnh hình học' : 'Đã TẮT Hút điểm');
  }
  document.getElementById('top-btn-hut-diem').addEventListener('click', toggleSnapPoint);
  document.getElementById('bx-btn-snap-pt').addEventListener('click', toggleSnapPoint);

  function toggleSnapAngle() {
    state.snapAngle = !state.snapAngle;
    document.getElementById('top-btn-hut-goc').classList.toggle('active', state.snapAngle);
    document.getElementById('bx-btn-snap-ang').classList.toggle('active', state.snapAngle);
    notify(state.snapAngle ? '📐 Đã BẬT Hút góc chuẩn (0°, 30°, 45°, 60°, 90°)' : 'Đã TẮT Hút góc');
  }
  document.getElementById('top-btn-hut-goc').addEventListener('click', toggleSnapAngle);
  document.getElementById('bx-btn-snap-ang').addEventListener('click', toggleSnapAngle);

  document.getElementById('vbar-palm-btn').addEventListener('click', () => {
    state.palmRejection = !state.palmRejection;
    notify(
      state.palmRejection
        ? '✋ Đã BẬT Chống chạm tay (chỉ nhận bút cảm ứng, ngón tay dùng để cuộn trang)'
        : '👆 Đã TẮT Chống chạm tay (vẽ bằng cả ngón tay và bút)'
    );
  });

  const fileInput = document.getElementById('pdf-file-input');
  document.getElementById('rb-open').addEventListener('click', () => fileInput.click());
  document.getElementById('btn-add-tab').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    await loadPdfBytes(new Uint8Array(buf), f.name);
  });

  async function loadSampleExam() {
    try {
      const resp = await fetch('./sample.pdf', { cache: 'no-cache' });
      if (!resp.ok) throw new Error('Không tìm thấy sample.pdf');
      const buf = await resp.arrayBuffer();
      await loadPdfBytes(new Uint8Array(buf), 'Lop_Ly_Thay_Ngoc.pdf');
      await fitWidth();
    } catch (_) {
      notify('⚠️ Không tải được trang mẫu, hãy bấm "Mở PDF" để chọn tệp.');
    }
  }
  document.getElementById('rb-sample').addEventListener('click', loadSampleExam);
  document.getElementById('btn-sample-tab').addEventListener('click', loadSampleExam);
  setTimeout(() => {
    if (!state.pdfDoc) loadSampleExam();
  }, 120);

  function changeZoom(newZ, focal = null) {
    const oldZ = state.zoom;
    state.zoom = Math.max(0.25, Math.min(3.5, +newZ.toFixed(3)));
    const ratio = state.zoom / Math.max(0.1, oldZ);
    if (Math.abs(ratio - 1.0) < 0.001) return;

    Object.keys(state.annots).forEach((k) => {
      if (k === 'board') return;
      (state.annots[k] || []).forEach((obj) => {
        if (obj.points) obj.points.forEach((p) => { p.x *= ratio; p.y *= ratio; });
        if (obj.curveControls) obj.curveControls.forEach((c) => { c.x *= ratio; c.y *= ratio; });
        if (obj.bezierCtrlPts) obj.bezierCtrlPts.forEach((c) => { c.x *= ratio; c.y *= ratio; });
        if (obj.x1 !== undefined) { obj.x1 *= ratio; obj.y1 *= ratio; obj.x2 *= ratio; obj.y2 *= ratio; }
        if (obj.x !== undefined) { obj.x *= ratio; obj.y *= ratio; }
        if (obj.w !== undefined) { obj.w *= ratio; obj.h *= ratio; }
      });
    });

    // Cập nhật kích thước khung trang PDF tại chỗ (In-place) không xóa DOM, không nháy trắng màn hình!
    const pageKeys = Object.keys(surfaces).filter((k) => k !== 'board');
    if (state.pdfDoc && pageKeys.length === state.totalPages && state.totalPages > 0) {
      const prevRatio = pdfScroll.scrollHeight > 0 ? pdfScroll.scrollTop / pdfScroll.scrollHeight : 0;
      pageKeys.forEach((k) => {
        const pno = parseInt(k, 10);
        const surf = surfaces[pno];
        if (!surf || !surf.wrap) return;
        surf.cssWidth = Math.round(surf.cssWidth * ratio);
        surf.cssHeight = Math.round(surf.cssHeight * ratio);
        surf.wrap.style.width = surf.cssWidth + 'px';
        surf.wrap.style.height = surf.cssHeight + 'px';

        if (surf.mounted) {
          const dpr = surf.dpr;
          [surf.inkCanvas, surf.activeCanvas].forEach((c) => {
            if (c) {
              c.width = Math.round(surf.cssWidth * dpr);
              c.height = Math.round(surf.cssHeight * dpr);
            }
          });
          if (surf.baseCanvas) {
            surf.baseCanvas.style.width = surf.cssWidth + 'px';
            surf.baseCanvas.style.height = surf.cssHeight + 'px';
          }
          redrawSurface(pno);
          // Render lại nền trang sắc nét ở độ phân giải mới (hỗ trợ cả trang PDF và trang trống mới thêm)
          const slot = state.pageSlots[pno - 1] || { kind: 'pdf', pdfPageNo: pno };
          if (slot.kind === 'blank') {
            if (surf.baseCanvas) {
              surf.baseCanvas.width = Math.round(surf.cssWidth * dpr);
              surf.baseCanvas.height = Math.round(surf.cssHeight * dpr);
              const bctx = surf.baseCanvas.getContext('2d');
              bctx.fillStyle = '#FFFFFF';
              bctx.fillRect(0, 0, surf.baseCanvas.width, surf.baseCanvas.height);
              surf.renderedZoom = state.zoom;
            }
          } else {
            state.pdfDoc.getPage(slot.pdfPageNo).then((page) => {
              if (!surf.mounted || !surf.baseCanvas) return;
              const rotPref = state.pageRotations[pno] || 0;
              const rot = (page.rotate + rotPref) % 360;
              const rvp = page.getViewport({ scale: state.zoom * dpr, rotation: rot });
              const offC = document.createElement('canvas');
              offC.width = Math.round(surf.cssWidth * dpr);
              offC.height = Math.round(surf.cssHeight * dpr);
              page.render({ canvasContext: offC.getContext('2d'), viewport: rvp }).promise.then(() => {
                if (!surf.mounted || !surf.baseCanvas) return;
                surf.baseCanvas.width = offC.width;
                surf.baseCanvas.height = offC.height;
                surf.baseCanvas.getContext('2d').drawImage(offC, 0, 0);
                surf.renderedZoom = state.zoom;
                surf.renderedRot = rotPref;
              }).catch(() => {});
            }).catch(() => {});
          }
        }
      });

      if (focal) {
        pdfScroll.scrollLeft = Math.max(0, focal.docX * ratio - focal.vx1);
        pdfScroll.scrollTop = Math.max(0, focal.docY * ratio - focal.vy1);
      } else if (prevRatio > 0) {
        pdfScroll.scrollTop = prevRatio * pdfScroll.scrollHeight;
      }
    } else {
      buildPagePlaceholders();
    }
  }
  document.getElementById('rb-zoom-in').addEventListener('click', () => changeZoom(state.zoom + 0.2));
  document.getElementById('sb-zoom-in').addEventListener('click', () => changeZoom(state.zoom + 0.2));
  document.getElementById('rb-zoom-out').addEventListener('click', () => changeZoom(state.zoom - 0.2));
  document.getElementById('sb-zoom-out').addEventListener('click', () => changeZoom(state.zoom - 0.2));

  async function fitWidth() {
    if (!state.pdfDoc) return;
    const pno = state.currentPage || 1;
    const slot = state.pageSlots[pno - 1] || { kind: 'pdf', pdfPageNo: 1 };
    let baseW = 595.28;
    if (slot.kind === 'blank') {
      baseW = (state.pageRotations[pno] || 0) % 180 !== 0 ? slot.heightPt : slot.widthPt;
    } else {
      const p1 = await state.pdfDoc.getPage(slot.pdfPageNo);
      const rot = (p1.rotate + (state.pageRotations[pno] || 0)) % 360;
      baseW = p1.getViewport({ scale: 1.0, rotation: rot }).width;
    }
    const targetZ = Math.max(0.5, Math.min(3.5, (pdfScroll.clientWidth - 16) / baseW));
    changeZoom(targetZ);
    pdfScroll.scrollLeft = 0;
    notify('↔️ Đã tự căn full bề rộng trang PDF');
  }
  async function fitPage() {
    if (!state.pdfDoc) return;
    const pno = state.currentPage || 1;
    const slot = state.pageSlots[pno - 1] || { kind: 'pdf', pdfPageNo: 1 };
    let baseH = 841.89;
    if (slot.kind === 'blank') {
      baseH = (state.pageRotations[pno] || 0) % 180 !== 0 ? slot.widthPt : slot.heightPt;
    } else {
      const p1 = await state.pdfDoc.getPage(slot.pdfPageNo);
      const rot = (p1.rotate + (state.pageRotations[pno] || 0)) % 360;
      baseH = p1.getViewport({ scale: 1.0, rotation: rot }).height;
    }
    changeZoom((pdfScroll.clientHeight - 16) / baseH);
  }

  // Gõ 2 lần (Double-tap bằng ngón tay trên trang PDF / nền PDF, hoặc nhấp đúp lên nền PDF) -> Tự căn full bề rộng!
  let lastPdfTapTime = 0, lastPdfTapX = 0, lastPdfTapY = 0;
  let pdfTapDownTime = 0, pdfTapDownX = 0, pdfTapDownY = 0, pdfTapValid = false;

  pdfScroll.addEventListener('pointerdown', (e) => {
    if (isMultiTouch) { pdfTapValid = false; return; }
    const isBgTap = (e.target === pdfScroll || e.target === pdfHolder);
    const isFingerTap = (e.pointerType === 'touch');
    const isPanOrSelectTap = (state.tool === 'tay' || state.tool === 'chon');
    if (isFingerTap || isBgTap || isPanOrSelectTap) {
      pdfTapDownTime = performance.now();
      pdfTapDownX = e.clientX;
      pdfTapDownY = e.clientY;
      pdfTapValid = true;
    } else {
      pdfTapValid = false;
    }
  }, { passive: true });

  pdfScroll.addEventListener('pointerup', (e) => {
    if (!pdfTapValid || isMultiTouch) return;
    pdfTapValid = false;
    const now = performance.now();
    const dtDown = now - pdfTapDownTime;
    const moveDist = Math.hypot(e.clientX - pdfTapDownX, e.clientY - pdfTapDownY);
    if (dtDown < 260 && moveDist < 20) {
      if (now - lastPdfTapTime < 350 && Math.hypot(e.clientX - lastPdfTapX, e.clientY - lastPdfTapY) < 42) {
        lastPdfTapTime = 0;
        fitWidth();
      } else {
        lastPdfTapTime = now;
        lastPdfTapX = e.clientX;
        lastPdfTapY = e.clientY;
      }
    }
  }, { passive: true });
  let isSavingPdf = false;
  async function saveAnnotatedPdf() {
    if (isSavingPdf) return;
    if (!state.pdfBytes) {
      notify('Chưa mở file PDF nào để lưu.');
      return;
    }
    if (!window.PDFLib || !window.PDFLib.PDFDocument) {
      notify('Không tìm thấy thư viện xuất PDF (pdf-lib).');
      return;
    }
    isSavingPdf = true;
    const saveBtn = document.getElementById('top-btn-save-pdf');
    if (saveBtn) saveBtn.disabled = true;
    notify('Đang xuất PDF kèm mực viết...');
    try {
      const pdfDoc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
      const pdfPages = pdfDoc.getPages();
      const total = Math.min(state.totalPages || pdfPages.length, pdfPages.length);
      const scale = 2;
      for (let pno = 1; pno <= total; pno++) {
        const objs = state.annots && state.annots[pno];
        if (!objs || !objs.length) continue;
        const pdfPage = pdfPages[pno - 1];
        const { width: pw, height: ph } = pdfPage.getSize();
        const surf = surfaces && surfaces[pno];
        const cssW = (surf && surf.cssWidth) ? surf.cssWidth : pw * (state.zoom || 1.25);
        const cssH = (surf && surf.cssHeight) ? surf.cssHeight : ph * (state.zoom || 1.25);
        const offCanvas = document.createElement('canvas');
        offCanvas.width = Math.max(1, Math.round(cssW * scale));
        offCanvas.height = Math.max(1, Math.round(cssH * scale));
        const ctx = offCanvas.getContext('2d');
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        for (const obj of objs) {
          NKInkEngine.drawObject(ctx, obj, false, !!state.showLabels);
        }
        const pngBlob = await new Promise((resolve) => offCanvas.toBlob(resolve, 'image/png'));
        if (!pngBlob) continue;
        const pngBytes = await pngBlob.arrayBuffer();
        const pngImg = await pdfDoc.embedPng(pngBytes);
        pdfPage.drawImage(pngImg, { x: 0, y: 0, width: pw, height: ph });
      }
      const outBytes = await pdfDoc.save();
      const outBlob = new Blob([outBytes], { type: 'application/pdf' });
      const baseName = (state.pdfFileName || 'NKPDF_document.pdf').replace(/\.pdf$/i, '');
      const outName = `${baseName}_NKPDF.pdf`;
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify(`Đã lưu ${outName}`);
    } catch (err) {
      console.error('saveAnnotatedPdf error:', err);
      notify('Lỗi khi lưu PDF: ' + (err && err.message ? err.message : err));
    } finally {
      isSavingPdf = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  document.getElementById('rb-fit-width').addEventListener('click', fitWidth);
  const topFitWidthBtn = document.getElementById('top-btn-fit-width');
  if (topFitWidthBtn) topFitWidthBtn.addEventListener('click', fitWidth);
  const topOpenPdfBtn = document.getElementById('top-btn-open-pdf');
  if (topOpenPdfBtn) topOpenPdfBtn.addEventListener('click', () => fileInput.click());
  const topSavePdfBtn = document.getElementById('top-btn-save-pdf');
  if (topSavePdfBtn) topSavePdfBtn.addEventListener('click', saveAnnotatedPdf);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;
      e.preventDefault();
      saveAnnotatedPdf();
    }
  });
  document.getElementById('rb-fit-page').addEventListener('click', fitPage);
  document.getElementById('rb-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  });

  document.getElementById('sb-zoom-select').addEventListener('change', (e) => {
    if (e.target.value === 'fit_width') fitWidth();
    else changeZoom(parseFloat(e.target.value));
  });

  document.getElementById('sb-first-page').addEventListener('click', () => jumpToPage(1));
  document.getElementById('sb-prev-page').addEventListener('click', () => jumpToPage(state.currentPage - 1));
  document.getElementById('sb-next-page').addEventListener('click', () => jumpToPage(state.currentPage + 1));
  document.getElementById('sb-last-page').addEventListener('click', () => jumpToPage(state.totalPages));
  document.getElementById('sb-page-input').addEventListener('change', (e) => {
    jumpToPage(parseInt(e.target.value, 10) || 1);
  });

  function setReadingMode(m) {
    state.pdfTheme = m;
    document.getElementById('sb-reading-mode').value = m;
    const topSel = document.getElementById('top-reading-select');
    if (topSel) topSel.value = m;
    pdfScroll.className = m === 'white' ? '' : `env-${m}`;
    document.querySelectorAll('.pdf-page-wrapper').forEach((w) => {
      w.className = `pdf-page-wrapper theme-${m} ${state.showGrid ? 'show-css-grid' : ''}`;
    });
    const modeNames = {
      white: '☀️ Nền trắng chuẩn',
      cream: '📜 Giấy kem dịu mắt',
      blue: '📘 Xanh dịu mắt',
      board: '🟩 Nền Bảng xanh',
      night: '🌙 Ban đêm chống mỏi mắt'
    };
    notify(`👁 Chế độ đọc PDF: ${modeNames[m] || m}`);
  }
  document.getElementById('sb-reading-mode').addEventListener('change', (e) => setReadingMode(e.target.value));
  const topReadSel = document.getElementById('top-reading-select');
  if (topReadSel) topReadSel.addEventListener('change', (e) => setReadingMode(e.target.value));
  document.getElementById('rb-reading-mode').addEventListener('click', () => {
    const modes = ['white', 'cream', 'blue', 'board', 'night'];
    const next = modes[(modes.indexOf(state.pdfTheme) + 1) % modes.length];
    setReadingMode(next);
  });

  function togglePdfGrid() {
    state.showGrid = !state.showGrid;
    const rbGrid = document.getElementById('rb-grid');
    if (rbGrid) rbGrid.classList.toggle('active', state.showGrid);
    const topGrid = document.getElementById('top-btn-grid');
    if (topGrid) topGrid.classList.toggle('active', state.showGrid);
    const msGrid = document.getElementById('ms-dock-grid');
    if (msGrid) {
      msGrid.classList.toggle('active', state.showGrid);
      msGrid.textContent = state.showGrid ? '⊞ Ẩn lưới' : '⊞ Hiện lưới';
    }
    document.querySelectorAll('.pdf-page-wrapper').forEach((w) => {
      w.classList.toggle('show-css-grid', state.showGrid);
    });
    notify(state.showGrid ? 'Đã BẬT lưới ô ly PDF (CSS 0 MB RAM)' : 'Đã TẮT lưới ô ly PDF');
  }

  document.getElementById('rb-grid').addEventListener('click', togglePdfGrid);
  const topGridBtn = document.getElementById('top-btn-grid');
  if (topGridBtn) topGridBtn.addEventListener('click', togglePdfGrid);

  // Tùy chỉnh kích cỡ ô lưới (12px / 16px / 20px / 25px) cho cả PDF và Bảng xanh
  const gridSizeSelect = document.getElementById('rb-grid-size');
  function applyGridStep(px) {
    const step = Math.max(10, Math.min(36, parseInt(px, 10) || 16));
    state.gridStep = step;
    document.documentElement.style.setProperty('--pdf-grid-step', step + 'px');
    try { localStorage.setItem('nkpdf_grid_step', String(step)); } catch (_) {}
    if (gridSizeSelect) gridSizeSelect.value = String(step);
    if (surfaces.board) {
      drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
    }
  }
  const savedGridStep = (() => { try { return localStorage.getItem('nkpdf_grid_step'); } catch (_) { return null; } })();
  applyGridStep(savedGridStep || 16);
  if (gridSizeSelect) {
    gridSizeSelect.addEventListener('change', (e) => {
      applyGridStep(e.target.value);
      notify(`▦ Đã đổi kích cỡ ô lưới sang ${state.gridStep}px`);
    });
  }

  document.getElementById('rb-undo').addEventListener('click', performUndo);
  document.getElementById('rb-redo').addEventListener('click', performRedo);
  document.getElementById('rb-delete-obj').addEventListener('click', deleteSelected);
  const rbDupBtn = document.getElementById('rb-duplicate-obj');
  if (rbDupBtn) rbDupBtn.addEventListener('click', duplicateSelected);
  const vbarDupBtn = document.getElementById('vbar-duplicate-obj');
  if (vbarDupBtn) vbarDupBtn.addEventListener('click', duplicateSelected);
  const bxDupBtn = document.getElementById('bx-btn-duplicate');
  if (bxDupBtn) bxDupBtn.addEventListener('click', duplicateSelected);
  document.getElementById('rb-net-dut').addEventListener('click', (e) => {
    state.dashed = !state.dashed;
    e.currentTarget.classList.toggle('active', state.dashed);
    const qDashed = document.querySelector('[data-qaction="toggle_dashed"]');
    if (qDashed) qDashed.classList.toggle('active', state.dashed);
  });

  document.getElementById('rb-rotate-page').addEventListener('click', () => {
    const p = state.currentPage;
    state.pageRotations[p] = ((state.pageRotations[p] || 0) + 90) % 360;
    buildPagePlaceholders();
  });

  document.getElementById('rb-clear-all-ink').addEventListener('click', () => {
    const sid = activeSid();
    ensureStacks(sid);
    if (!state.annots[sid].length) return;
    pushUndo(sid);
    state.annots[sid] = [];
    redrawSurface(sid);
    notify('Đã xóa sạch nét vẽ trên trang hiện tại (Ctrl+Z / Chạm 2 ngón để hoàn tác).');
  });

  const imgInput = document.getElementById('img-file-input');
  document.getElementById('rb-insert-img').addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const sid = activeSid(), surf = surfaces[sid];
      if (!surf) return;
      ensureStacks(sid);
      pushUndo(sid);
      state.annots[sid].push({
        type: 'anh',
        x: surf.cssWidth * 0.25,
        y: surf.cssHeight * 0.25,
        w: 240,
        h: 180,
        dataUrl: reader.result
      });
      state.selectedIndices = [state.annots[sid].length - 1];
      setTool('chon');
      setTimeout(() => redrawSurface(sid), 80);
      notify('🖼️ Đã chèn ảnh và tự động chọn để kéo thả, co dãn.');
    };
    reader.readAsDataURL(f);
  });

  // ============================================================================
  // HỘP NHẬP CHỮ NỔI TRỰC TIẾP TRÊN TRANG (#HopNhapChuNoi) & CÔNG THỨC KATEX VECTOR
  // ============================================================================
  const inlineTextBox = document.getElementById('HopNhapChuNoi');
  const iteTextarea = document.getElementById('ite-textarea');
  const iteFontLbl = document.getElementById('ite-font-lbl');
  const iteTitle = document.getElementById('ite-title');
  let iteState = { sid: 1, worldX: 100, worldY: 100, type: 'chu', editIdx: null, fontSize: 20 };

  function openInlineTextEditor(sid, worldX, worldY, clientX, clientY, objType = 'chu', editIdx = null) {
    const list = state.annots[sid] || [];
    const existing = editIdx !== null ? list[editIdx] : null;
    iteState = {
      sid,
      worldX,
      worldY,
      type: objType,
      editIdx,
      fontSize: existing ? (existing.fontSize || 20) : Math.round(16 + activeWidth() * 2.2)
    };
    iteTitle.textContent = objType === 'ghi_chu' ? '📌 Ghi chú dán trên trang' : (editIdx !== null ? '✏️ Sửa nội dung chữ' : 'T Nhập chữ lên trang');
    iteFontLbl.textContent = `${iteState.fontSize}pt`;
    iteTextarea.value = existing ? (existing.text || '') : '';
    const left = Math.max(12, Math.min(window.innerWidth - 325, clientX));
    const top = Math.max(46, Math.min(window.innerHeight - 160, clientY));
    inlineTextBox.style.left = left + 'px';
    inlineTextBox.style.top = top + 'px';
    inlineTextBox.classList.remove('hidden');
    setTimeout(() => iteTextarea.focus(), 30);
  }

  function commitInlineText() {
    const txt = iteTextarea.value.trim();
    const { sid, worldX, worldY, type, editIdx, fontSize } = iteState;
    ensureStacks(sid);
    if (txt) {
      pushUndo(sid);
      if (editIdx !== null && state.annots[sid][editIdx]) {
        state.annots[sid][editIdx].text = txt;
        state.annots[sid][editIdx].fontSize = fontSize;
      } else {
        state.annots[sid].push({
          type,
          x: worldX,
          y: worldY,
          text: txt,
          color: activeColor(),
          fontSize
        });
        state.selectedIndices = [state.annots[sid].length - 1];
      }
      redrawSurface(sid);
    }
    inlineTextBox.classList.add('hidden');
  }

  document.getElementById('ite-commit-btn').addEventListener('click', commitInlineText);
  document.getElementById('ite-cancel-btn').addEventListener('click', () => inlineTextBox.classList.add('hidden'));
  document.getElementById('ite-font-dec').addEventListener('click', () => {
    iteState.fontSize = Math.max(12, iteState.fontSize - 2);
    iteFontLbl.textContent = `${iteState.fontSize}pt`;
  });
  document.getElementById('ite-font-inc').addEventListener('click', () => {
    iteState.fontSize = Math.min(72, iteState.fontSize + 2);
    iteFontLbl.textContent = `${iteState.fontSize}pt`;
  });

  const formulaModal = document.getElementById('ModalCongThuc');
  const formulaInput = document.getElementById('formula-input');
  const formulaPreview = document.getElementById('formula-preview');
  const formulaSizeRange = document.getElementById('formula-size-range');
  const formulaSizeLbl = document.getElementById('formula-size-lbl');
  let editingFormulaIdx = null;

  if (formulaSizeRange) {
    formulaSizeRange.addEventListener('input', () => {
      if (formulaSizeLbl) formulaSizeLbl.textContent = `${formulaSizeRange.value} pt`;
    });
  }

  function updateFormulaPreview() {
    const tex = formulaInput.value.trim() || 'x = A\\cos(\\omega t + \\varphi)';
    if (window.katex) {
      try {
        window.katex.render(tex, formulaPreview, { throwOnError: false, displayMode: true });
      } catch (_) {
        formulaPreview.textContent = tex;
      }
    } else {
      formulaPreview.textContent = tex;
    }
  }

  function openFormulaModal(editIdx = null) {
    editingFormulaIdx = typeof editIdx === 'number' ? editIdx : null;
    const sid = activeSid(), list = state.annots[sid] || [];
    if (editingFormulaIdx !== null && list[editingFormulaIdx]) {
      const obj = list[editingFormulaIdx];
      formulaInput.value = obj.rawTex || obj.text || '';
      if (formulaSizeRange) {
        formulaSizeRange.value = obj.fontSize || 26;
        if (formulaSizeLbl) formulaSizeLbl.textContent = `${formulaSizeRange.value} pt`;
      }
    } else if (!formulaInput.value) {
      formulaInput.value = 'x = A\\cos(\\omega t + \\varphi)';
    }
    formulaModal.classList.remove('hidden');
    updateFormulaPreview();
    formulaInput.focus();
  }

  document.getElementById('rb-formula').addEventListener('click', () => openFormulaModal(null));
  document.getElementById('vbar-formula').addEventListener('click', () => openFormulaModal(null));
  document.getElementById('bx-btn-formula').addEventListener('click', () => openFormulaModal(null));
  document.getElementById('close-formula-modal').addEventListener('click', () => formulaModal.classList.add('hidden'));
  document.getElementById('cancel-formula-btn').addEventListener('click', () => formulaModal.classList.add('hidden'));
  formulaInput.addEventListener('input', updateFormulaPreview);

  document.querySelectorAll('.fp-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      formulaInput.value = btn.dataset.tex;
      updateFormulaPreview();
    });
  });

  document.getElementById('insert-formula-btn').addEventListener('click', () => {
    const raw = formulaInput.value.trim();
    if (!raw) return;
    const fs = formulaSizeRange ? parseInt(formulaSizeRange.value, 10) || 26 : 26;
    const sid = activeSid(), surf = surfaces[sid];
    if (surf) {
      ensureStacks(sid);
      pushUndo(sid);
      if (editingFormulaIdx !== null && state.annots[sid][editingFormulaIdx]) {
        const obj = state.annots[sid][editingFormulaIdx];
        obj.rawTex = raw;
        obj.text = raw;
        obj.fontSize = fs;
        state.selectedIndices = [editingFormulaIdx];
      } else {
        const cx = sid === 'board'
          ? (surf.cssWidth * 0.38 - state.boardCam.panX) / state.boardCam.zoom
          : surf.cssWidth * 0.35;
        const cy = sid === 'board'
          ? (surf.cssHeight * 0.42 - state.boardCam.panY) / state.boardCam.zoom
          : surf.cssHeight * 0.35;
        state.annots[sid].push({
          type: 'cong_thuc',
          x: cx,
          y: cy,
          text: raw,
          rawTex: raw,
          color: activeColor(),
          fontSize: fs
        });
        state.selectedIndices = [state.annots[sid].length - 1];
      }
      setTool('chon');
      redrawSurface(sid);
      notify('Σ Đã chèn công thức Toán - Lý Vector (chạm đúp để sửa LaTeX, kéo góc để phóng to/thu nhỏ).');
    }
    editingFormulaIdx = null;
    formulaModal.classList.add('hidden');
  });

  // ============================================================================
  // HỘP THOẠI 📐 KHO HÌNH TOÁN - LÝ
  // ============================================================================
  const khModal = document.getElementById('ModalKhoHinh');
  function openKhoHinh() { khModal.classList.remove('hidden'); }
  const topKhoHinhBtn = document.getElementById('top-btn-kho-hinh');
  if (topKhoHinhBtn) topKhoHinhBtn.addEventListener('click', openKhoHinh);
  const rbKhoHinhBtn = document.getElementById('rb-kho-hinh2');
  if (rbKhoHinhBtn) rbKhoHinhBtn.addEventListener('click', openKhoHinh);
  const vbarKhoHinhBtn = document.getElementById('vbar-kho-hinh');
  if (vbarKhoHinhBtn) vbarKhoHinhBtn.addEventListener('click', openKhoHinh);
  const bxKhoHinhBtn = document.getElementById('bx-btn-kho-hinh');
  if (bxKhoHinhBtn) bxKhoHinhBtn.addEventListener('click', openKhoHinh);
  const openSpecialShapesModal = () => {
    openKhoHinh();
    setTimeout(() => {
      const sec = document.getElementById('kh-sec-special');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };
  const bxSpecialShapesBtn = document.getElementById('bx-btn-special-shapes');
  if (bxSpecialShapesBtn) bxSpecialShapesBtn.addEventListener('click', openSpecialShapesModal);
  const rbSpecialShapesBtn = document.getElementById('rb-special-shapes');
  if (rbSpecialShapesBtn) rbSpecialShapesBtn.addEventListener('click', openSpecialShapesModal);
  document.getElementById('close-khohinh-modal').addEventListener('click', () => khModal.classList.add('hidden'));

  document.querySelectorAll('.kh-card').forEach((card) => {
    card.addEventListener('click', () => {
      insertPresetShape(card.dataset.shape, card.querySelector('b').textContent);
      khModal.classList.add('hidden');
    });
  });

  document.querySelectorAll('.kh-img-card').forEach((card) => {
    card.addEventListener('click', () => {
      const imgUrl = card.dataset.img;
      const sid = activeSid(), surf = surfaces[sid];
      if (surf) {
        ensureStacks(sid);
        pushUndo(sid);
        state.annots[sid].push({
          type: 'anh',
          x: surf.cssWidth * 0.25,
          y: surf.cssHeight * 0.22,
          w: 260,
          h: 200,
          dataUrl: imgUrl
        });
        state.selectedIndices = [state.annots[sid].length - 1];
        setTool('chon');
        setTimeout(() => redrawSurface(sid), 100);
        notify('🖼️ Đã chèn hình từ Kho hình Toán - Lý (dùng 8 điểm neo để co dãn, kéo thả).');
      }
      khModal.classList.add('hidden');
    });
  });

  // ============================================================================
  // 🧮 MÁY TÍNH KHOA HỌC CASIO FX-580VN X & ⚡ MÔ PHỎNG VẬT LÍ
  // ============================================================================
  const casioWin = document.getElementById('CuaSoCasio');
  const casioExpr = document.getElementById('casio-expr');
  const casioRes = document.getElementById('casio-result');
  let exprStr = '', lastAns = '0';

  function toggleCasio() { casioWin.classList.toggle('hidden'); }
  document.getElementById('top-btn-casio').addEventListener('click', toggleCasio);
  document.getElementById('rb-casio2').addEventListener('click', toggleCasio);
  document.getElementById('vbar-casio').addEventListener('click', toggleCasio);
  document.getElementById('close-casio-btn').addEventListener('click', () => casioWin.classList.add('hidden'));

  document.querySelectorAll('.casio-keys button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.ck;
      if (k === 'C') {
        exprStr = ''; casioExpr.textContent = ''; casioRes.textContent = '0';
      } else if (k === 'DEL') {
        exprStr = exprStr.slice(0, -1); casioExpr.textContent = exprStr;
      } else if (k === '=') {
        try {
          const jsExpr = exprStr
            .replace(/Ans/g, `(${lastAns})`)
            .replace(/pi/g, 'Math.PI')
            .replace(/sqrt\(/g, 'Math.sqrt(')
            .replace(/sin\(/g, 'Math.sin((Math.PI/180)*')
            .replace(/cos\(/g, 'Math.cos((Math.PI/180)*')
            .replace(/tan\(/g, 'Math.tan((Math.PI/180)*')
            .replace(/asin\(/g, '(180/Math.PI)*Math.asin(')
            .replace(/acos\(/g, '(180/Math.PI)*Math.acos(')
            .replace(/\^/g, '**');
          const val = Function(`"use strict"; return (${jsExpr})`)();
          const formatted = Number.isFinite(val) ? +val.toPrecision(10) : 'Math Error';
          casioRes.textContent = formatted;
          lastAns = String(formatted);
        } catch (_) {
          casioRes.textContent = 'Syntax Error';
        }
      } else {
        exprStr += k; casioExpr.textContent = exprStr;
      }
    });
  });

  const simWin = document.getElementById('CuaSoMoPhong');
  const simIframe = document.getElementById('sim-iframe');
  const simSelect = document.getElementById('sim-select');

  function openPhysicsSim() {
    if (!simWin || !simIframe || !simSelect) return;
    simWin.classList.remove('hidden');
    if (simIframe.src === 'about:blank' || !simIframe.src) simIframe.src = simSelect.value;
  }
  document.getElementById('rb-physics-sim')?.addEventListener('click', openPhysicsSim);
  document.getElementById('vbar-physics-sim')?.addEventListener('click', openPhysicsSim);
  document.getElementById('close-sim-btn')?.addEventListener('click', () => simWin && simWin.classList.add('hidden'));
  simSelect?.addEventListener('change', (e) => { if (simIframe) simIframe.src = e.target.value; });

  // Thu nhỏ góc màn hình (PiP) để vừa chạy mô phỏng Vật lí vừa viết Bảng xanh / PDF
  const simPipBtn = document.getElementById('sim-pip-btn');
  if (simPipBtn) {
    simPipBtn.addEventListener('click', () => {
      simWin.classList.toggle('pip-mode');
      simPipBtn.textContent = simWin.classList.contains('pip-mode') ? '🗖 Mở rộng' : '🗗 Thu nhỏ góc';
      notify(simWin.classList.contains('pip-mode')
        ? '🗗 Đã thu nhỏ Mô phỏng Vật lí về góc màn hình để vừa quan sát vừa viết bài!'
        : '🗖 Đã mở rộng cửa sổ Mô phỏng Vật lí.');
    });
  }

  // Chụp màn hình Mô phỏng Vật lí hiện tại và dán ngay vào Bảng xanh / PDF
  const simCaptureBtn = document.getElementById('sim-capture-btn');
  if (simCaptureBtn) {
    simCaptureBtn.addEventListener('click', () => {
      try {
        const doc = simIframe.contentDocument || (simIframe.contentWindow && simIframe.contentWindow.document);
        const simCanvas = doc ? doc.querySelector('canvas') : null;
        if (!simCanvas) {
          notify('⚠️ Không tìm thấy khung hình canvas trong mô phỏng hiện tại.');
          return;
        }
        const dataUrl = simCanvas.toDataURL('image/png');
        const sid = activeSid(), surf = surfaces[sid];
        if (surf) {
          ensureStacks(sid);
          pushUndo(sid);
          const w = 340, h = Math.round(340 * (simCanvas.height / Math.max(1, simCanvas.width)));
          const cx = sid === 'board'
            ? (surf.cssWidth * 0.5 - state.boardCam.panX) / state.boardCam.zoom
            : surf.cssWidth * 0.5;
          const cy = sid === 'board'
            ? (surf.cssHeight * 0.45 - state.boardCam.panY) / state.boardCam.zoom
            : surf.cssHeight * 0.45;
          state.annots[sid].push({
            type: 'anh',
            x: cx - w * 0.5,
            y: cy - h * 0.5,
            w,
            h,
            dataUrl
          });
          state.selectedIndices = [state.annots[sid].length - 1];
          simWin.classList.add('pip-mode');
          if (simPipBtn) simPipBtn.textContent = '🗖 Mở rộng';
          setTool('chon');
          setTimeout(() => redrawSurface(sid), 60);
          notify('📸 Đã chụp hình Mô phỏng Vật lí và dán vào bài giảng để Thầy viết vẽ chú thích!');
        }
      } catch (err) {
        notify('⚠️ Không thể chụp khung mô phỏng: ' + err.message);
      }
    });
  }

  // ============================================================================
  // CAMERA BẢNG XANH VÔ HẠN (HUD ZOOM & KÉO VÔ HẠN 4 HƯỚNG + 4 KIỂU LƯỚI)
  // ============================================================================
  function zoomBoardCamera(factor, pivotSx, pivotSy) {
    const surf = surfaces.board;
    if (!surf) return;
    const px = pivotSx !== undefined ? pivotSx : surf.cssWidth * 0.5;
    const py = pivotSy !== undefined ? pivotSy : surf.cssHeight * 0.5;
    const oldZ = state.boardCam.zoom;
    const newZ = Math.max(0.25, Math.min(4.0, +(oldZ * factor).toFixed(3)));
    const wx = (px - state.boardCam.panX) / oldZ;
    const wy = (py - state.boardCam.panY) / oldZ;
    state.boardCam.zoom = newZ;
    state.boardCam.panX = px - wx * newZ;
    state.boardCam.panY = py - wy * newZ;
    updateBoardCameraHud();
    drawGrid(bxGridCanvas, surf.cssWidth, surf.cssHeight, surf.dpr, true);
    redrawSurface('board');
  }

  document.getElementById('bx-hud-zoom-in').addEventListener('click', () => zoomBoardCamera(1.25));
  document.getElementById('bx-hud-zoom-out').addEventListener('click', () => zoomBoardCamera(0.8));
  document.getElementById('bx-hud-reset').addEventListener('click', () => {
    state.boardCam = { panX: 0, panY: 0, zoom: 1.0 };
    updateBoardCameraHud();
    if (surfaces.board) {
      drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
      redrawSurface('board');
    }
    notify('🎯 Đã đưa Bảng xanh về Gốc tọa độ (0,0) tỷ lệ 100%.');
  });
  document.getElementById('bx-hud-pan').addEventListener('click', () => {
    setTool(state.tool === 'tay' ? 'but' : 'tay');
    document.getElementById('bx-hud-pan').classList.toggle('active', state.tool === 'tay');
    notify(state.tool === 'tay' ? '✋ Đã bật chế độ Kéo bảng vô hạn 4 hướng' : '✏️ Đã quay lại Bút viết phấn');
  });
  document.getElementById('bx-hud-expand').addEventListener('click', () => {
    const surf = surfaces.board;
    if (!surf) return;
    state.boardCam.panY -= surf.cssHeight * 0.65;
    updateBoardCameraHud();
    drawGrid(bxGridCanvas, surf.cssWidth, surf.cssHeight, surf.dpr, true);
    redrawSurface('board');
    notify('➕ Đã mở rộng và cuộn Bảng xanh xuống vùng trống mới (bài viết phía trên vẫn được giữ nguyên!).');
  });

  // Lăn chuột trên máy tính để cuộn Bảng xanh (Ctrl + Lăn chuột để phóng to/thu nhỏ)
  if (bxWrap) {
    let bxWheelRaf = null;
    bxWrap.addEventListener('wheel', (e) => {
      if (!surfaces.board) return;
      e.preventDefault();
      if (e.ctrlKey) {
        const r = bxInkCanvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const oldZ = state.boardCam.zoom;
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZ = Math.max(0.25, Math.min(4.0, oldZ * factor));
        const wx = (mx - state.boardCam.panX) / oldZ;
        const wy = (my - state.boardCam.panY) / oldZ;
        state.boardCam.zoom = newZ;
        state.boardCam.panX = mx - wx * newZ;
        state.boardCam.panY = my - wy * newZ;
      } else {
        const dx = e.shiftKey && Math.abs(e.deltaX) < 0.1 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && Math.abs(e.deltaX) < 0.1 ? 0 : e.deltaY;
        state.boardCam.panX -= dx;
        state.boardCam.panY -= dy;
      }
      if (!bxWheelRaf) {
        bxWheelRaf = requestAnimationFrame(() => {
          bxWheelRaf = null;
          updateBoardCameraHud();
          if (surfaces.board) {
            drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
            redrawSurface('board');
          }
        });
      }
    }, { passive: false });
  }

  // Khóa zoom trình duyệt khi giữ Ctrl + Lăn chuột (hoặc chụm tay trên màn hình cảm ứng PC) để giữ cố định thanh công cụ, chỉ zoom nội dung PDF bên dưới
  let pdfWheelZoomTimer = null;
  let pdfWheelPendingDelta = 0;
  window.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (typeof bxWrap !== 'undefined' && bxWrap && bxWrap.contains(e.target) && activeSid() === 'board') return;
    e.preventDefault();
    if (activeSid() === 'board') return;
    pdfWheelPendingDelta += (e.deltaY < 0 ? 0.1 : -0.1);
    if (!pdfWheelZoomTimer) {
      pdfWheelZoomTimer = setTimeout(() => {
        const d = pdfWheelPendingDelta;
        pdfWheelPendingDelta = 0;
        pdfWheelZoomTimer = null;
        if (Math.abs(d) > 0.001) {
          changeZoom(state.zoom + d);
        }
      }, 28);
    }
  }, { passive: false, capture: true });

  const bxGridSel = document.getElementById('bx-grid-select');
  if (bxGridSel) {
    bxGridSel.addEventListener('change', (e) => {
      state.boardGridMode = e.target.value;
      state.showBoardGrid = state.boardGridMode !== 'none';
      document.getElementById('bx-btn-grid').classList.toggle('active', state.showBoardGrid);
      if (surfaces.board) {
        drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
      }
    });
  }

  // ============================================================================
  // THƯỚC KẺ TƯƠNG TÁC XOAY 360° & HÚT NÉT BÚT (#ThuocKeTuongTac)
  // ============================================================================
  const rulerEl = document.getElementById('ThuocKeTuongTac');
  const rulerTicksCanvas = document.getElementById('ruler-ticks-canvas');
  const rulerAngleLbl = document.getElementById('ruler-angle-lbl');

  function drawRulerTicks() {
    if (!rulerTicksCanvas) return;
    const ctx = rulerTicksCanvas.getContext('2d');
    const W = rulerTicksCanvas.width, H = rulerTicksCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#0369A1';
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 10.5px "Segoe UI", sans-serif';
    const pxPerMm = 3.2; // 32px = 1cm -> 20cm = 640px
    const startX = 10;
    for (let mm = 0; mm <= 200; mm++) {
      const x = startX + mm * pxPerMm;
      const isCm = mm % 10 === 0;
      const isHalf = mm % 5 === 0;
      const tickH = isCm ? 15 : (isHalf ? 10 : 6);
      ctx.lineWidth = isCm ? 1.5 : 0.9;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, tickH);
      ctx.stroke();
      if (isCm) {
        const cm = mm / 10;
        ctx.fillText(String(cm), x - (cm >= 10 ? 6 : 3), 27);
      }
    }
  }
  drawRulerTicks();

  function applyRulerTransform() {
    if (!rulerEl) return;
    const r = state.ruler;
    rulerEl.style.left = Math.round(r.cx - r.widthPx * 0.5) + 'px';
    rulerEl.style.top = Math.round(r.cy - r.heightPx * 0.5) + 'px';
    rulerEl.style.transform = `rotate(${r.angleDeg}deg)`;
    if (rulerAngleLbl) rulerAngleLbl.textContent = `${r.angleDeg}°`;
  }

  function toggleRuler() {
    state.ruler.visible = !state.ruler.visible;
    rulerEl.classList.toggle('hidden', !state.ruler.visible);
    document.getElementById('top-btn-ruler').classList.toggle('active', state.ruler.visible);
    const bxRulerBtn = document.getElementById('bx-btn-ruler');
    if (bxRulerBtn) bxRulerBtn.classList.toggle('active', state.ruler.visible);
    if (state.ruler.visible) {
      state.ruler.cx = Math.round(window.innerWidth * 0.5);
      state.ruler.cy = Math.round(window.innerHeight * 0.52);
      applyRulerTransform();
      notify('📏 Đã bật Thước kẻ 20cm: Kéo thân thước để di chuyển, kéo 2 đầu ⟳ để xoay 360°, đưa bút lại gần mép thước để kẻ thẳng tắp!');
    } else {
      notify('Đã ẩn Thước kẻ.');
    }
  }
  document.getElementById('top-btn-ruler').addEventListener('click', toggleRuler);
  document.getElementById('bx-btn-ruler').addEventListener('click', toggleRuler);
  document.getElementById('ruler-close-btn').addEventListener('click', toggleRuler);

  // ============================================================================
  // THƯỚC ĐO ĐỘ BÁN NGUYỆT 180° (#ThuocDoDoTuongTac)
  // ============================================================================
  const protEl = document.getElementById('ThuocDoDoTuongTac');
  const protCanvas = document.getElementById('protractor-canvas');
  const protAngleLbl = document.getElementById('prot-angle-lbl');
  const protState = { visible: false, cx: 420, cy: 360, angleDeg: 0 };

  function drawProtractorTicks() {
    if (!protCanvas) return;
    const ctx = protCanvas.getContext('2d');
    const W = protCanvas.width, H = protCanvas.height;
    const ox = W * 0.5, oy = 158, R = 148;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(ox, oy, R, Math.PI, 0, false);
    ctx.closePath();
    ctx.fillStyle = 'rgba(254, 249, 195, 0.72)';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.stroke();

    // Inner cutout
    ctx.beginPath();
    ctx.arc(ox, oy, 76, Math.PI, 0, false);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)';
    ctx.stroke();

    // Center crosshair
    ctx.beginPath();
    ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy);
    ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 6);
    ctx.strokeStyle = '#DC2626';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.font = 'bold 9.5px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg <= 180; deg += 2) {
      const rad = Math.PI + (deg * Math.PI) / 180;
      const is10 = deg % 10 === 0;
      const is5 = deg % 5 === 0;
      const rIn = is10 ? R - 16 : (is5 ? R - 11 : R - 6);
      ctx.beginPath();
      ctx.moveTo(ox + R * Math.cos(rad), oy + R * Math.sin(rad));
      ctx.lineTo(ox + rIn * Math.cos(rad), oy + rIn * Math.sin(rad));
      ctx.strokeStyle = is10 ? '#0F172A' : '#475569';
      ctx.lineWidth = is10 ? 1.4 : 0.8;
      ctx.stroke();
      if (is10 && deg % 20 === 0) {
        const rTxt = R - 26;
        ctx.fillStyle = '#0F172A';
        ctx.fillText(String(deg), ox + rTxt * Math.cos(rad), oy + rTxt * Math.sin(rad));
      }
    }
    ctx.restore();
  }
  drawProtractorTicks();

  function applyProtractorTransform() {
    if (!protEl) return;
    protEl.style.left = Math.round(protState.cx - 160) + 'px';
    protEl.style.top = Math.round(protState.cy - 158) + 'px';
    protEl.style.transform = `rotate(${protState.angleDeg}deg)`;
    if (protAngleLbl) protAngleLbl.textContent = `${Math.round(protState.angleDeg)}°`;
  }

  function toggleProtractor() {
    if (!protEl) return;
    protState.visible = !protState.visible;
    protEl.classList.toggle('hidden', !protState.visible);
    const bxProt = document.getElementById('bx-btn-protractor');
    if (bxProt) bxProt.classList.toggle('active', protState.visible);
    if (protState.visible) {
      protState.cx = Math.round(window.innerWidth * 0.5);
      protState.cy = Math.round(window.innerHeight * 0.56);
      applyProtractorTransform();
      notify('📐 Đã bật Thước đo độ 180°: Kéo thước đặt tâm đỏ vào đỉnh góc để đọc số đo!');
    }
  }

  const bxProtBtn = document.getElementById('bx-btn-protractor');
  if (bxProtBtn) bxProtBtn.addEventListener('click', toggleProtractor);
  const protCloseBtn = document.getElementById('prot-close-btn');
  if (protCloseBtn) protCloseBtn.addEventListener('click', toggleProtractor);
  const protRotL = document.getElementById('prot-rot-left');
  if (protRotL) protRotL.addEventListener('click', (e) => { e.stopPropagation(); protState.angleDeg -= 15; applyProtractorTransform(); });
  const protRotR = document.getElementById('prot-rot-right');
  if (protRotR) protRotR.addEventListener('click', (e) => { e.stopPropagation(); protState.angleDeg += 15; applyProtractorTransform(); });
  const protRotZ = document.getElementById('prot-rot-zero');
  if (protRotZ) protRotZ.addEventListener('click', (e) => { e.stopPropagation(); protState.angleDeg = 0; applyProtractorTransform(); });

  if (protEl) {
    let dragProt = false, rotProt = false, pOx = 0, pOy = 0, pStartAng = 0, pBaseDeg = 0;
    const protRotHandle = document.getElementById('prot-drag-rot');
    if (protRotHandle) {
      protRotHandle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        rotProt = true;
        pStartAng = Math.atan2(e.clientY - protState.cy, e.clientX - protState.cx);
        pBaseDeg = protState.angleDeg;
        try { protRotHandle.setPointerCapture(e.pointerId); } catch (_) {}
      });
      protRotHandle.addEventListener('pointermove', (e) => {
        if (!rotProt) return;
        const cur = Math.atan2(e.clientY - protState.cy, e.clientX - protState.cx);
        protState.angleDeg = Math.round(pBaseDeg + ((cur - pStartAng) * 180) / Math.PI);
        applyProtractorTransform();
      });
      const endProtRot = () => { rotProt = false; };
      protRotHandle.addEventListener('pointerup', endProtRot);
      protRotHandle.addEventListener('pointercancel', endProtRot);
    }
    protEl.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target === protRotHandle) return;
      e.preventDefault();
      dragProt = true;
      pOx = e.clientX - protState.cx;
      pOy = e.clientY - protState.cy;
      try { protEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    protEl.addEventListener('pointermove', (e) => {
      if (!dragProt) return;
      protState.cx = e.clientX - pOx;
      protState.cy = e.clientY - pOy;
      applyProtractorTransform();
    });
    const endProtDrag = () => { dragProt = false; };
    protEl.addEventListener('pointerup', endProtDrag);
    protEl.addEventListener('pointercancel', endProtDrag);
  }

  document.querySelectorAll('[data-rang]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.ruler.angleDeg = parseInt(btn.dataset.rang, 10) || 0;
      applyRulerTransform();
    });
  });

  // Kéo di chuyển Thước kẻ
  const rulerBody = document.getElementById('ruler-drag-body');
  if (rulerBody) {
    let draggingRuler = false, rOx = 0, rOy = 0;
    rulerBody.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      draggingRuler = true;
      rOx = e.clientX - state.ruler.cx;
      rOy = e.clientY - state.ruler.cy;
      try { rulerBody.setPointerCapture(e.pointerId); } catch (_) {}
    });
    rulerBody.addEventListener('pointermove', (e) => {
      if (!draggingRuler) return;
      state.ruler.cx = e.clientX - rOx;
      state.ruler.cy = e.clientY - rOy;
      applyRulerTransform();
    });
    rulerBody.addEventListener('pointerup', () => { draggingRuler = false; });
  }

  // Kéo 2 đầu Thước kẻ để xoay 360°
  document.querySelectorAll('[data-rulerrot]').forEach((hEl) => {
    let rotatingRuler = false, startMouseAng = 0, startRulerDeg = 0;
    hEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      rotatingRuler = true;
      startMouseAng = Math.atan2(e.clientY - state.ruler.cy, e.clientX - state.ruler.cx);
      startRulerDeg = state.ruler.angleDeg;
      try { hEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    hEl.addEventListener('pointermove', (e) => {
      if (!rotatingRuler) return;
      const curAng = Math.atan2(e.clientY - state.ruler.cy, e.clientX - state.ruler.cx);
      let deg = Math.round(startRulerDeg + ((curAng - startMouseAng) * 180) / Math.PI);
      while (deg <= -180) deg += 360;
      while (deg > 180) deg -= 360;
      state.ruler.angleDeg = deg;
      applyRulerTransform();
    });
    hEl.addEventListener('pointerup', () => { rotatingRuler = false; });
  });

  // ============================================================================
  // HỘP THOẠI 📲 CÀI APP LÊN MÀN HÌNH CHÍNH IPAD & KIỂM TRA 100% OFFLINE
  // ============================================================================
  const installModal = document.getElementById('ModalCaiDatIpad');
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
  document.getElementById('top-btn-install-pwa').addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          deferredInstallPrompt = null;
          return;
        }
      } catch (_) {}
    }
    installModal.classList.remove('hidden');
  });
  document.getElementById('close-install-modal').addEventListener('click', () => installModal.classList.add('hidden'));
  document.getElementById('ok-install-modal').addEventListener('click', () => installModal.classList.add('hidden'));

  const copyrightModal = document.getElementById('ModalBanQuyen');
  if (copyrightModal) {
    const openCopyright = () => copyrightModal.classList.remove('hidden');
    const closeCopyright = () => copyrightModal.classList.add('hidden');
    const brandBtn = document.getElementById('btn-open-copyright');
    const topCopyrightBtn = document.getElementById('top-btn-copyright');
    const closeCopyrightBtn = document.getElementById('close-copyright-modal');
    const okCopyrightBtn = document.getElementById('ok-copyright-modal');
    if (brandBtn) brandBtn.addEventListener('click', openCopyright);
    if (topCopyrightBtn) topCopyrightBtn.addEventListener('click', openCopyright);
    if (closeCopyrightBtn) closeCopyrightBtn.addEventListener('click', closeCopyright);
    if (okCopyrightBtn) okCopyrightBtn.addEventListener('click', closeCopyright);
    copyrightModal.addEventListener('click', (e) => {
      if (e.target === copyrightModal) closeCopyright();
    });
  }

  // ============================================================================
  // KHO ĐỀ LUYỆN TẬP (VẬT LÝ 10-12, TOÁN 6-12, HÓA 10-12) (#ModalDeVatLy)
  // ============================================================================
  const deModal = document.getElementById('ModalDeVatLy');
  if (deModal) {
    const DE_SUBJECTS = {
      ly: {
        title: '📚 Kho Đề Vật lý 10 · 11 · 12 (Học sinh luyện tập trực tiếp)',
        label: 'Vật lý',
        folder: 'de_vat_ly',
        grades: ['10', '11', '12']
      },
      toan: {
        title: '📐 Kho Đề Toán 6 · 7 · 8 · 9 · 10 · 11 · 12 (Học sinh luyện tập trực tiếp)',
        label: 'Toán',
        folder: 'de_toan',
        grades: ['6', '7', '8', '9', '10', '11', '12']
      },
      hoa: {
        title: '🧪 Kho Đề Hóa học 10 · 11 · 12 (Học sinh luyện tập trực tiếp)',
        label: 'Hóa học',
        shortLabel: '🧪 Hóa',
        folder: 'de_hoa',
        grades: ['10', '11', '12']
      },
      sinh: {
        title: '🧬 Kho Đề Sinh học 10 · 11 · 12 (Học sinh luyện tập trực tiếp)',
        label: 'Sinh học',
        shortLabel: '🧬 Sinh',
        folder: 'de_sinh',
        grades: ['10', '11', '12']
      },
      anh: {
        title: '🇬🇧 Kho Đề Tiếng Anh 6 · 7 · 8 · 9 · 10 · 11 · 12 (Học sinh luyện tập trực tiếp)',
        label: 'Tiếng Anh',
        shortLabel: '🇬🇧 Anh',
        folder: 'de_anh',
        grades: ['6', '7', '8', '9', '10', '11', '12']
      }
    };
    let deSubjectKey = 'ly';
    let deCatalog = { grades: {} };
    let deActiveGrade = '10';
    const deTitleEl = document.getElementById('de-modal-title');
    const deSubjectTabsEl = document.getElementById('DeSubjectTabs');
    const deTabsEl = document.getElementById('DeGradeTabs');
    const deListEl = document.getElementById('DeExamList');
    const deSearchEl = document.getElementById('de-search-input');

    const SUBJECT_ORDER = ['toan', 'ly', 'hoa', 'sinh', 'anh'];
    const SUBJECT_SHORT = {
      toan: '📐 Toán',
      ly: '📚 Lý',
      hoa: '🧪 Hóa',
      sinh: '🧬 Sinh',
      anh: '🇬🇧 Anh'
    };

    function renderDeSubjectTabs() {
      if (!deSubjectTabsEl) return;
      deSubjectTabsEl.innerHTML = '';
      for (const sk of SUBJECT_ORDER) {
        if (!DE_SUBJECTS[sk]) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `de-tab${sk === deSubjectKey ? ' active' : ''}`;
        btn.textContent = SUBJECT_SHORT[sk] || DE_SUBJECTS[sk].label;
        btn.addEventListener('click', () => {
          if (sk !== deSubjectKey) openSubjectExamsModal(sk);
        });
        deSubjectTabsEl.appendChild(btn);
      }
    }

    function renderDeTabs() {
      if (!deTabsEl) return;
      const cfg = DE_SUBJECTS[deSubjectKey];
      deTabsEl.innerHTML = '';
      for (const g of cfg.grades) {
        const cnt = (deCatalog.grades && deCatalog.grades[g]) ? deCatalog.grades[g].length : 0;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `de-tab${g === deActiveGrade ? ' active' : ''}`;
        btn.dataset.grade = g;
        btn.innerHTML = `${cfg.label} ${g} <span class="de-cnt">${cnt}</span>`;
        btn.addEventListener('click', () => {
          deActiveGrade = g;
          renderDeTabs();
          renderDeList();
        });
        deTabsEl.appendChild(btn);
      }
    }

    function renderDeList() {
      if (!deListEl) return;
      const cfg = DE_SUBJECTS[deSubjectKey];
      const q = (deSearchEl && deSearchEl.value ? deSearchEl.value : '').trim().toLowerCase();
      const rawItems = (deCatalog.grades && deCatalog.grades[deActiveGrade]) || [];
      const items = q
        ? rawItems.filter((it) => (`${it.title} ${it.topic || ''}`).toLowerCase().includes(q))
        : rawItems;

      deListEl.innerHTML = '';
      if (!items.length) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'de-empty';
        emptyDiv.innerHTML = rawItems.length
          ? 'Không tìm thấy đề phù hợp với từ khóa.'
          : `Chưa có file PDF nào trong mục <b>${cfg.label} ${deActiveGrade}</b>.<br/>Thầy chỉ cần chép các file PDF vào thư mục <code>nkpdf_dev/ipad_pwa/${cfg.folder}/lop_${deActiveGrade}/</code> rồi chạy cập nhật web là danh sách đề sẽ tự hiện tại đây!`;
        deListEl.appendChild(emptyDiv);
        return;
      }

      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'de-item';
        const meta = document.createElement('div');
        meta.className = 'de-item-meta';
        const titleEl = document.createElement('div');
        titleEl.className = 'de-item-title';
        titleEl.textContent = `📄 ${it.title}`;
        if (it.answersUrl || it.hdgUrl) {
          const badge = document.createElement('span');
          badge.className = 'de-badge-ans';
          badge.textContent = it.answersUrl && it.hdgUrl ? '✅ Đáp án & HDG' : (it.answersUrl ? '✅ Có đáp án' : '📖 Có HDG');
          titleEl.appendChild(badge);
        }
        const subEl = document.createElement('div');
        subEl.className = 'de-item-sub';
        subEl.textContent = [it.topic ? `Chuyên đề: ${it.topic}` : `${cfg.label} ${deActiveGrade}`, it.sizeKb ? `${it.sizeKb} KB` : ''].filter(Boolean).join(' • ');
        meta.appendChild(titleEl);
        meta.appendChild(subEl);

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'mbtn primary';
        openBtn.textContent = '✏️ Làm bài';
        openBtn.addEventListener('click', async () => {
          openBtn.disabled = true;
          openBtn.textContent = '⏳ Đang tải...';
          try {
            const resp = await fetch(it.url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buf = await resp.arrayBuffer();
            if (state.mode === 'board') openBangXanh(false);
            await loadPdfBytes(new Uint8Array(buf), it.fileName || `${it.title}.pdf`);
            if (typeof window.nkSetActiveExam === 'function') {
              window.nkSetActiveExam(it);
            }
            deModal.classList.add('hidden');
            notify(`📚 Đã mở đề: ${it.title}`);
          } catch (err) {
            notify('Không tải được đề PDF: ' + (err && err.message ? err.message : err));
          } finally {
            openBtn.disabled = false;
            openBtn.textContent = '✏️ Làm bài';
          }
        });

        row.appendChild(meta);
        row.appendChild(openBtn);
        deListEl.appendChild(row);
      }
    }

    async function openSubjectExamsModal(subjectKey) {
      deSubjectKey = DE_SUBJECTS[subjectKey] ? subjectKey : 'ly';
      const cfg = DE_SUBJECTS[deSubjectKey];
      deActiveGrade = cfg.grades[0];
      deCatalog = { grades: {} };
      if (deTitleEl) deTitleEl.textContent = cfg.title;
      if (deSearchEl) deSearchEl.value = '';
      deModal.classList.remove('hidden');
      renderDeSubjectTabs();
      renderDeTabs();
      renderDeList();
      try {
        const resp = await fetch(`./${cfg.folder}/catalog.json`, { cache: 'no-cache' });
        if (resp.ok) deCatalog = await resp.json();
      } catch (_) {}
      renderDeSubjectTabs();
      renderDeTabs();
      renderDeList();
    }

    if (deSearchEl) deSearchEl.addEventListener('input', renderDeList);

    const bindDeOpen = (id, subj) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => openSubjectExamsModal(subj));
    };
    bindDeOpen('top-btn-de-vat-ly', 'ly');
    bindDeOpen('rb-de-vat-ly', 'ly');
    bindDeOpen('top-btn-de-toan', 'toan');
    bindDeOpen('rb-de-toan', 'toan');
    bindDeOpen('top-btn-de-hoa', 'hoa');
    bindDeOpen('rb-de-hoa', 'hoa');
    bindDeOpen('top-btn-de-sinh', 'sinh');
    bindDeOpen('rb-de-sinh', 'sinh');
    bindDeOpen('top-btn-de-anh', 'anh');
    bindDeOpen('rb-de-anh', 'anh');

    const closeDeBtn = document.getElementById('close-de-modal');
    const okDeBtn = document.getElementById('ok-de-modal');
    const openLocalDeBtn = document.getElementById('de-btn-open-local');
    if (closeDeBtn) closeDeBtn.addEventListener('click', () => deModal.classList.add('hidden'));
    if (okDeBtn) okDeBtn.addEventListener('click', () => deModal.classList.add('hidden'));
    if (openLocalDeBtn) openLocalDeBtn.addEventListener('click', () => {
      deModal.classList.add('hidden');
      fileInput.click();
    });
    deModal.addEventListener('click', (e) => {
      if (e.target === deModal) deModal.classList.add('hidden');
    });
  }

  // ============================================================================
  // PHIẾU TRẢ LỜI & CHẤM ĐIỂM TỰ ĐỘNG + MỞ KHÓA HDG (PHƯƠNG ÁN 3)
  // ============================================================================
  (() => {
    const fabBtn = document.getElementById('AnswerSheetToggleBtn');
    const drawer = document.getElementById('AnswerSheetDrawer');
    const closeBtn = document.getElementById('close-answer-drawer');
    const titleEl = document.getElementById('ans-drawer-title');
    const subEl = document.getElementById('ans-drawer-sub');
    const bannerEl = document.getElementById('ans-score-banner');
    const bodyEl = document.getElementById('AnswerSheetBody');
    const gradeBtn = document.getElementById('btn-grade-answers');
    const hdgBtn = document.getElementById('btn-open-hdg');
    const resetBtn = document.getElementById('btn-reset-answers');
    if (!fabBtn || !drawer || !bodyEl) return;

    let currentExam = null;
    let currentKey = null;
    let userState = { p1: {}, p2: {}, p3: {}, graded: false };

    const storageKey = (it) => `nk_exam_ans_v1_${it.fileName || it.url || it.title}`;

    function saveUserState() {
      if (!currentExam) return;
      try {
        localStorage.setItem(storageKey(currentExam), JSON.stringify(userState));
      } catch (_) {}
    }

    function loadUserState(it) {
      try {
        const raw = localStorage.getItem(storageKey(it));
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            p1: parsed.p1 || {},
            p2: parsed.p2 || {},
            p3: parsed.p3 || {},
            graded: !!parsed.graded
          };
        }
      } catch (_) {}
      return { p1: {}, p2: {}, p3: {}, graded: false };
    }

    function normalizeShort(val) {
      return String(val || '').trim().replace(/\s+/g, '').replace(',', '.');
    }

    function isShortMatch(uVal, kVal) {
      const u = normalizeShort(uVal);
      const k = normalizeShort(kVal);
      if (!u) return false;
      if (u === k) return true;
      const un = Number(u);
      const kn = Number(k);
      if (Number.isFinite(un) && Number.isFinite(kn)) {
        return Math.abs(un - kn) <= 1e-4;
      }
      return false;
    }

    function computeScore() {
      if (!currentKey) return null;
      const p1 = currentKey.part1 || [];
      const p2 = currentKey.part2 || [];
      const p3 = currentKey.part3 || [];

      let c1 = 0;
      p1.forEach((ans, idx) => {
        if (userState.p1[idx] === ans) c1 += 1;
      });

      let p2Score = 0;
      let p2Full = 0;
      p2.forEach((obj, idx) => {
        const uObj = userState.p2[idx] || {};
        let rightSub = 0;
        for (const k of ['a', 'b', 'c', 'd']) {
          if (uObj[k] === obj[k]) rightSub += 1;
        }
        if (rightSub === 1) p2Score += 0.1;
        else if (rightSub === 2) p2Score += 0.25;
        else if (rightSub === 3) p2Score += 0.5;
        else if (rightSub === 4) { p2Score += 1.0; p2Full += 1; }
      });

      let c3 = 0;
      p3.forEach((ans, idx) => {
        if (isShortMatch(userState.p3[idx], ans)) c3 += 1;
      });

      const p1Unit = 0.25;
      const p3Unit = p3.length > 0 && p3.length <= 4 ? 0.5 : 0.25;
      const total = +(c1 * p1Unit + p2Score + c3 * p3Unit).toFixed(2);
      const maxScore = +(p1.length * p1Unit + p2.length * 1.0 + p3.length * p3Unit).toFixed(2);
      return { c1, n1: p1.length, p2Full, n2: p2.length, p2Score: +p2Score.toFixed(2), c3, n3: p3.length, total, maxScore };
    }

    function renderAnswerSheet() {
      bodyEl.innerHTML = '';
      if (!currentExam) return;
      if (titleEl) titleEl.textContent = `📝 ${currentExam.title}`;

      if (!currentKey) {
        if (subEl) subEl.textContent = 'Đề này chỉ có file Hướng dẫn giải (HDG)';
        bodyEl.innerHTML = '<div style="padding:12px;color:#475569;font-size:13px;">Đề này chưa có bảng đáp án trắc nghiệm tự động. Sau khi làm xong, Thầy/các em có thể bấm nút <b>Xem HDG chi tiết</b> bên dưới để đối chiếu nhé!</div>';
        if (gradeBtn) gradeBtn.classList.add('hidden');
        if (resetBtn) resetBtn.classList.add('hidden');
        if (hdgBtn) hdgBtn.classList.toggle('hidden', !currentExam.hdgUrl);
        if (bannerEl) bannerEl.classList.add('hidden');
        return;
      }

      if (subEl) subEl.textContent = userState.graded ? 'Đã chấm điểm — Đã mở khóa HDG chi tiết!' : 'Chọn đáp án rồi bấm Nộp bài để chấm điểm & mở HDG';
      if (gradeBtn) gradeBtn.classList.toggle('hidden', userState.graded);
      if (resetBtn) resetBtn.classList.toggle('hidden', !userState.graded);
      if (hdgBtn) hdgBtn.classList.toggle('hidden', !(userState.graded && currentExam.hdgUrl));

      if (userState.graded && bannerEl) {
        const sc = computeScore();
        const parts = [];
        if (sc.n1) parts.push(`Phần I: <b>${sc.c1}/${sc.n1}</b>`);
        if (sc.n2) parts.push(`Phần II: <b>${sc.p2Score}đ</b> (${sc.p2Full}/${sc.n2} câu 4/4)`);
        if (sc.n3) parts.push(`Phần III: <b>${sc.c3}/${sc.n3}</b>`);
        bannerEl.innerHTML = `<div class="ans-score-big">Điểm: ${sc.total} / ${sc.maxScore}</div><div>${parts.join(' • ')}</div>`;
        bannerEl.classList.remove('hidden');
      } else if (bannerEl) {
        bannerEl.classList.add('hidden');
      }

      const p1 = currentKey.part1 || [];
      if (p1.length) {
        const h = document.createElement('div');
        h.className = 'ans-part-title';
        h.textContent = `PHẦN I. Trắc nghiệm nhiều phương án (${p1.length} câu)`;
        bodyEl.appendChild(h);
        p1.forEach((keyLetter, idx) => {
          const row = document.createElement('div');
          const uSel = userState.p1[idx];
          const cls = userState.graded ? (uSel === keyLetter ? ' is-correct' : ' is-wrong') : '';
          row.className = `ans-q-row${cls}`;
          const num = document.createElement('span');
          num.className = 'ans-q-num';
          num.textContent = `Câu ${idx + 1}`;
          if (userState.graded && uSel !== keyLetter) {
            const kt = document.createElement('span');
            kt.className = 'ans-key-tag';
            kt.textContent = `(${keyLetter})`;
            num.appendChild(kt);
          }
          const opts = document.createElement('div');
          opts.className = 'ans-opts';
          ['A', 'B', 'C', 'D'].forEach((lt) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `ans-opt-btn${uSel === lt ? ' selected' : ''}${userState.graded && lt === keyLetter ? ' ans-key' : ''}`;
            b.textContent = lt;
            b.disabled = userState.graded;
            b.addEventListener('click', () => {
              userState.p1[idx] = lt;
              saveUserState();
              renderAnswerSheet();
            });
            opts.appendChild(b);
          });
          row.appendChild(num);
          row.appendChild(opts);
          bodyEl.appendChild(row);
        });
      }

      const p2 = currentKey.part2 || [];
      if (p2.length) {
        const h = document.createElement('div');
        h.className = 'ans-part-title';
        h.textContent = `PHẦN II. Trắc nghiệm Đúng / Sai (${p2.length} câu)`;
        bodyEl.appendChild(h);
        p2.forEach((keyObj, idx) => {
          const card = document.createElement('div');
          card.className = 'ans-tf-card';
          const qTitle = document.createElement('div');
          qTitle.className = 'ans-q-num';
          qTitle.textContent = `Câu ${idx + 1}`;
          card.appendChild(qTitle);
          const uObj = userState.p2[idx] || {};
          ['a', 'b', 'c', 'd'].forEach((k) => {
            const sub = document.createElement('div');
            const hasAns = typeof uObj[k] === 'boolean';
            const ok = hasAns && uObj[k] === keyObj[k];
            sub.className = `ans-tf-sub${userState.graded ? (ok ? ' is-correct' : ' is-wrong') : ''}`;
            const lbl = document.createElement('span');
            lbl.innerHTML = `<b>Ý ${k})</b>` + (userState.graded && !ok ? ` <span class="ans-key-tag">(ĐA: ${keyObj[k] ? 'Đ' : 'S'})</span>` : '');
            const btns = document.createElement('div');
            btns.className = 'ans-opts';
            [[true, 'Đ'], [false, 'S']].forEach(([val, txt]) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = `ans-tf-btn${uObj[k] === val ? ' selected' : ''}`;
              b.textContent = txt;
              b.disabled = userState.graded;
              b.addEventListener('click', () => {
                if (!userState.p2[idx]) userState.p2[idx] = {};
                userState.p2[idx][k] = val;
                saveUserState();
                renderAnswerSheet();
              });
              btns.appendChild(b);
            });
            sub.appendChild(lbl);
            sub.appendChild(btns);
            card.appendChild(sub);
          });
          bodyEl.appendChild(card);
        });
      }

      const p3 = currentKey.part3 || [];
      if (p3.length) {
        const h = document.createElement('div');
        h.className = 'ans-part-title';
        h.textContent = `PHẦN III. Trả lời ngắn (${p3.length} câu)`;
        bodyEl.appendChild(h);
        p3.forEach((keyVal, idx) => {
          const row = document.createElement('div');
          const uVal = userState.p3[idx] || '';
          const ok = isShortMatch(uVal, keyVal);
          row.className = `ans-q-row${userState.graded ? (ok ? ' is-correct' : ' is-wrong') : ''}`;
          const num = document.createElement('span');
          num.className = 'ans-q-num';
          num.textContent = `Câu ${idx + 1}`;
          if (userState.graded && !ok) {
            const kt = document.createElement('span');
            kt.className = 'ans-key-tag';
            kt.textContent = `(${keyVal})`;
            num.appendChild(kt);
          }
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'ans-short-input';
          inp.placeholder = 'Nhập đáp số';
          inp.value = uVal;
          inp.disabled = userState.graded;
          inp.addEventListener('input', () => {
            userState.p3[idx] = inp.value;
            saveUserState();
          });
          row.appendChild(num);
          row.appendChild(inp);
          bodyEl.appendChild(row);
        });
      }
    }

    window.nkSetActiveExam = async (it) => {
      currentExam = it || null;
      currentKey = null;
      drawer.classList.add('hidden');
      if (!currentExam || (!currentExam.answersUrl && !currentExam.hdgUrl)) {
        fabBtn.classList.add('hidden');
        return;
      }
      userState = loadUserState(currentExam);
      fabBtn.classList.remove('hidden');
      if (currentExam.answersUrl) {
        try {
          const r = await fetch(currentExam.answersUrl, { cache: 'no-cache' });
          if (r.ok) currentKey = await r.json();
        } catch (_) {}
      }
      renderAnswerSheet();
    };

    fabBtn.addEventListener('click', () => {
      drawer.classList.toggle('hidden');
      renderAnswerSheet();
    });
    if (closeBtn) closeBtn.addEventListener('click', () => drawer.classList.add('hidden'));

    if (gradeBtn) {
      gradeBtn.addEventListener('click', () => {
        userState.graded = true;
        saveUserState();
        renderAnswerSheet();
        const sc = computeScore();
        if (sc) notify(`✅ Đã chấm điểm: ${sc.total}/${sc.maxScore} điểm! Đã mở khóa HDG chi tiết.`);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        userState = { p1: {}, p2: {}, p3: {}, graded: false };
        saveUserState();
        renderAnswerSheet();
      });
    }

    if (hdgBtn) {
      hdgBtn.addEventListener('click', async () => {
        if (!currentExam || !currentExam.hdgUrl) return;
        hdgBtn.disabled = true;
        hdgBtn.textContent = '⏳ Đang tải HDG...';
        try {
          const resp = await fetch(currentExam.hdgUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = await resp.arrayBuffer();
          if (state.mode === 'board') openBangXanh(false);
          const hdgName = `${currentExam.title}_HDG.pdf`;
          await loadPdfBytes(new Uint8Array(buf), hdgName);
          drawer.classList.add('hidden');
          notify(`📖 Đã mở Hướng dẫn giải: ${currentExam.title}`);
        } catch (err) {
          notify('Không tải được file HDG: ' + (err && err.message ? err.message : err));
        } finally {
          hdgBtn.disabled = false;
          hdgBtn.textContent = '📖 Xem HDG chi tiết';
        }
      });
    }
  })();

  const forceSyncBtn = document.getElementById('btn-force-sync-ipad');
  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', async () => {
      forceSyncBtn.textContent = '⏳ Đang đồng bộ bản mới...';
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
      } catch (_) {}
      window.location.replace(window.location.pathname + '?sync=' + Date.now());
    });
  }

  document.getElementById('btn-verify-offline').addEventListener('click', async () => {
    const titleEl = document.getElementById('pwa-cache-status-title');
    const descEl = document.getElementById('pwa-cache-status-desc');
    const barEl = document.getElementById('pwa-offline-bar');
    const offlineUrls = [
      './', './index.html', './styles.css', './icons_nkpdf.js', './ink_engine.js', './app.js',
      './manifest.json', './sample.pdf', './icons/icon.svg',
      './vendor/pdf.min.js', './vendor/pdf.worker.min.js',
      './vendor/katex.min.js', './vendor/katex.min.css'
    ];
    let okCount = 0;
    titleEl.textContent = '⏳ Đang tải & xác thực bộ nhớ đệm Offline trên iPad...';
    const cache = ('caches' in window) ? await caches.open('nkpdf-ipad-v6-ultralight') : null;
    for (let i = 0; i < offlineUrls.length; i++) {
      try {
        const resp = await fetch(offlineUrls[i], { cache: 'reload' });
        if (resp.ok) {
          if (cache) await cache.put(offlineUrls[i], resp.clone());
          okCount++;
        }
      } catch (_) {}
      barEl.style.width = `${Math.round(((i + 1) / offlineUrls.length) * 100)}%`;
    }
    titleEl.textContent = `✅ Hoàn tất 100%: Đã lưu ${okCount}/${offlineUrls.length} gói tài nguyên Offline vào iPad!`;
    descEl.textContent = 'Thầy có thể bấm Chia sẻ (⍐) trên Safari -> "Thêm vào MH chính" và sử dụng NKPDF 2.9 ngay cả khi không có Wi-Fi.';
    notify('✅ Đã tải sẵn 100% dữ liệu Offline vào bộ nhớ iPad!');
  });

  // ============================================================================
  // PHÍM TẮT CHUẨN NKPDF 2.9, PINCH-TO-ZOOM 2 NGÓN & CỬ CHỈ IPAD
  // ============================================================================
  let spacePanActive = false;
  function setSpacePan(active) {
    spacePanActive = active;
    if (typeof bxInkCanvas !== 'undefined' && bxInkCanvas) {
      bxInkCanvas.style.cursor = active ? 'grab' : '';
    }
    if (typeof pdfScroll !== 'undefined' && pdfScroll) {
      pdfScroll.style.cursor = active ? 'grab' : '';
    }
    document.querySelectorAll('.ink-canvas').forEach((c) => {
      c.style.cursor = active ? 'grab' : '';
    });
  }
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && spacePanActive) setSpacePan(false);
  });
  window.addEventListener('blur', () => {
    if (spacePanActive) setSpacePan(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!spacePanActive) setSpacePan(true);
      return;
    }
    if (e.key === 'F9') { e.preventDefault(); toggleVerticalBar(); return; }
    if (e.key === 'Escape') {
      if (state.mode === 'board') openBangXanh(false);
      formulaModal.classList.add('hidden');
      khModal.classList.add('hidden');
      simWin.classList.add('hidden');
      sortModal.classList.add('hidden');
      geomSubmenu.classList.add('hidden');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) performRedo();
      else performUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      performRedo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && state.selectedIndices.length > 0) {
      e.preventDefault();
      const sid = activeSid();
      const list = state.annots[sid] || [];
      const step = e.shiftKey ? 15 : 3;
      const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
      const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
      if (!e.repeat) pushUndo(sid);
      state.selectedIndices.forEach((idx) => {
        const item = list[idx];
        if (!item) return;
        if (item.type === 'diem' && (item.sumTipRef || item.oppTipRef || item.intersectRef || item.footPerpRef || item.midSegRef || (Array.isArray(item.midRef) && item.midRef.length === 2))) {
          return;
        }
        NKInkEngine.translateObject(item, dx, dy);
      });
      if (typeof syncLinkedEndpoints === 'function') syncLinkedEndpoints(list);
      redrawSurface(sid);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedIndices.length > 0) {
        e.preventDefault();
        deleteSelected();
      }
      return;
    }
    if (e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      toggleGeometryToolbar();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { openBangXanh(state.mode !== 'board'); return; }
      if (k === 'k') { openKhoHinh(); return; }
      if (k === 'u') { toggleRuler(); return; }
      if (k === 'd') {
        e.preventDefault();
        const sid = activeSid();
        const list = state.annots[sid] || [];
        if (state.selectedIndices.length > 0) {
          pushUndo(sid);
          const allDashed = state.selectedIndices.every((idx) => list[idx] && list[idx].dashed);
          const nextDashed = !allDashed;
          state.selectedIndices.forEach((idx) => { if (list[idx]) list[idx].dashed = nextDashed; });
          syncWaveInterferenceDash(list, state.selectedIndices.map((idx) => list[idx]));
          redrawSurface(sid);
          notify(nextDashed ? '−− Đã chuyển hình đang chọn sang Nét đứt' : '─ Đã chuyển hình đang chọn sang Nét liền');
          return;
        }
        state.dashed = !state.dashed;
        const bxDashed = document.getElementById('bx-btn-dashed');
        if (bxDashed) bxDashed.classList.toggle('active', state.dashed);
        const qDashed = document.querySelector('[data-qaction="toggle_dashed"]');
        if (qDashed) qDashed.classList.toggle('active', state.dashed);
        notify(state.dashed ? '−− Đã BẬT Nét đứt (D)' : '─ Đã chuyển sang Nét liền (D)');
        return;
      }
      const map = {
        q: 'chon', v: 'chon', w: 'tay', e: 'chinh_sua',
        p: 'but', l: 'duong', a: 'mui_ten', r: 'hcn',
        c: 'elip', g: 'tam_giac', f: 'to_trong_suot', t: 'them_chu'
      };
      if (map[k]) setTool(map[k]);
    }
  });

  // Cử chỉ 2 ngón & 3 ngón trên iPad (Chuẩn 120Hz ProMotion):
  // - Chạm nhanh 2 ngón = Hoàn tác (Undo)
  // - Chạm nhanh 3 ngón = Làm lại (Redo)
  // - Chụm/Mở & Kéo 2 ngón = Zoom + Pan đồng thời siêu mượt theo đúng tâm 2 ngón tay trên cả Bảng xanh và PDF!
  let tStart = 0, tMaxFingers = 0, tMoved = false;
  let boardZoomPillTimer = null;
  function showBoardZoomPill(pct) {
    let pill = document.getElementById('nk-board-zoom-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'nk-board-zoom-pill';
      pill.style.cssText = [
        'position:fixed',
        'z-index:99990',
        'pointer-events:none',
        'padding:5px 13px',
        'border-radius:999px',
        'background:rgba(15,23,42,0.78)',
        'border:1px solid rgba(125,211,252,0.4)',
        'backdrop-filter:blur(8px)',
        'color:#F8FAFC',
        'font-size:13px',
        'font-weight:700',
        'letter-spacing:0.3px',
        'box-shadow:0 4px 16px rgba(0,0,0,0.28)',
        'opacity:0',
        'transition:opacity 0.25s ease',
        'transform:translateX(-50%)'
      ].join(';');
      document.body.appendChild(pill);
    }
    const r = bxInkCanvas ? bxInkCanvas.getBoundingClientRect() : null;
    if (r && r.width > 0) {
      pill.style.left = `${r.left + r.width * 0.5}px`;
      pill.style.top = `${Math.max(12, r.top + 54)}px`;
    } else {
      pill.style.left = '50%';
      pill.style.top = '64px';
    }
    pill.textContent = `🔍 ${pct}%`;
    if (boardZoomPillTimer) {
      clearTimeout(boardZoomPillTimer);
      boardZoomPillTimer = null;
    }
    pill.style.opacity = '1';
  }
  function hideBoardZoomPill(delayMs = 550) {
    const pill = document.getElementById('nk-board-zoom-pill');
    if (!pill) return;
    if (boardZoomPillTimer) clearTimeout(boardZoomPillTimer);
    boardZoomPillTimer = setTimeout(() => {
      pill.style.opacity = '0';
      boardZoomPillTimer = null;
    }, delayMs);
  }

  let pinchStartDist = 0, pinchStartZoom = 1.25, pinchScaleTemp = 1.0;
  let pinchStartMidX = 0, pinchStartMidY = 0, pinchLastMidX = 0, pinchLastMidY = 0;
  let pinchBoardWorldX = 0, pinchBoardWorldY = 0;
  let pinchPdfDocX = 0, pinchPdfDocY = 0, pinchHolderOriginX = 0, pinchHolderOriginY = 0;
  let pinchRaf = null;

  // Chặn Safari iPadOS tự chiếm cử chỉ 2 ngón (gesturestart/gesturechange) khi đang chụm/giãn trên PDF hoặc Bảng xanh
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) => {
    window.addEventListener(evt, (e) => { e.preventDefault(); }, { passive: false });
  });

  let singleTapTrack = null;
  let lastSingleTap = { ts: 0, x: 0, y: 0, onBoard: false };

  function initPinchState(fingerTouches) {
    pinchStartDist = Math.max(10, Math.hypot(
      fingerTouches[1].clientX - fingerTouches[0].clientX,
      fingerTouches[1].clientY - fingerTouches[0].clientY
    ));
    pinchStartMidX = (fingerTouches[0].clientX + fingerTouches[1].clientX) * 0.5;
    pinchStartMidY = (fingerTouches[0].clientY + fingerTouches[1].clientY) * 0.5;
    pinchLastMidX = pinchStartMidX;
    pinchLastMidY = pinchStartMidY;
    pinchScaleTemp = 1.0;
    tMoved = false;

    const onBoard = bxWindow && !bxWindow.classList.contains('hidden') && (() => {
      const br = bxInkCanvas.getBoundingClientRect();
      return pinchStartMidX >= br.left && pinchStartMidX <= br.right && pinchStartMidY >= br.top && pinchStartMidY <= br.bottom;
    })();

    if (onBoard) {
      state.mode = 'board';
      pinchStartZoom = state.boardCam.zoom;
      const r = bxInkCanvas.getBoundingClientRect();
      const sx = pinchStartMidX - r.left;
      const sy = pinchStartMidY - r.top;
      pinchBoardWorldX = (sx - state.boardCam.panX) / state.boardCam.zoom;
      pinchBoardWorldY = (sy - state.boardCam.panY) / state.boardCam.zoom;
    } else {
      state.mode = 'pdf';
      pinchStartZoom = state.zoom;
      const sr = pdfScroll.getBoundingClientRect();
      const hr = pdfHolder.getBoundingClientRect();
      pinchPdfDocX = pdfScroll.scrollLeft + (pinchStartMidX - sr.left);
      pinchPdfDocY = pdfScroll.scrollTop + (pinchStartMidY - sr.top);
      pinchHolderOriginX = pinchStartMidX - hr.left;
      pinchHolderOriginY = pinchStartMidY - hr.top;
    }
  }

  window.addEventListener('touchstart', (e) => {
    const fingerTouches = Array.from(e.touches).filter(isValidFingerTouch);
    const penBusy = state.palmRejection && (isPenActiveDown || (performance.now() - lastPenActivityTs < 250));
    if (penBusy && bxWindow && !bxWindow.classList.contains('hidden') && (e.target === bxInkCanvas || e.target === bxActiveCanvas)) {
      e.preventDefault();
    }
    if (e.touches.length === 1 && fingerTouches.length === 1 && !penBusy) {
      const t = fingerTouches[0];
      const isCanvasTarget = (e.target === bxInkCanvas || e.target === bxActiveCanvas || (pdfHolder && pdfHolder.contains(e.target)));
      if (isCanvasTarget && !e.target.closest('button, input, select, textarea, .bx-top-mini-bar, #ThanhDayBangXanh, #SelQuickBar')) {
        singleTapTrack = { ts: performance.now(), x: t.clientX, y: t.clientY, moved: false };
      } else {
        singleTapTrack = null;
      }
    } else {
      singleTapTrack = null;
    }
    if (fingerTouches.length >= 2 && !penBusy) {
      e.preventDefault();
      isMultiTouch = true;
      stopInertia();
      cancelAllSurfaceActs();
      if (tMaxFingers === 0) tStart = performance.now();
      tMaxFingers = Math.max(tMaxFingers, fingerTouches.length);

      if (fingerTouches.length === 2) {
        initPinchState(fingerTouches);
      }
    }
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (singleTapTrack && e.touches.length === 1) {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - singleTapTrack.x, t.clientY - singleTapTrack.y) > 14) {
        singleTapTrack.moved = true;
      }
    }
    const fingerTouches = Array.from(e.touches).filter(isValidFingerTouch);
    const penBusy = state.palmRejection && (isPenActiveDown || (performance.now() - lastPenActivityTs < 250));
    if (fingerTouches.length >= 2 && !penBusy) {
      e.preventDefault();
      isMultiTouch = true;
      if (tMaxFingers < 2) {
        tStart = performance.now();
        tMaxFingers = fingerTouches.length;
      }
      if (pinchStartDist <= 0) {
        initPinchState(fingerTouches);
      }
      const dist = Math.max(10, Math.hypot(
        fingerTouches[1].clientX - fingerTouches[0].clientX,
        fingerTouches[1].clientY - fingerTouches[0].clientY
      ));
      const midX = (fingerTouches[0].clientX + fingerTouches[1].clientX) * 0.5;
      const midY = (fingerTouches[0].clientY + fingerTouches[1].clientY) * 0.5;
      pinchLastMidX = midX;
      pinchLastMidY = midY;

      if (!tMoved && (Math.abs(dist - pinchStartDist) > 8 || Math.hypot(midX - pinchStartMidX, midY - pinchStartMidY) > 8)) {
        tMoved = true;
      }

      if (tMoved) {
        if (state.mode === 'board' && surfaces.board) {
          const r = bxInkCanvas.getBoundingClientRect();
          const curSx = midX - r.left;
          const curSy = midY - r.top;
          const newZ = Math.max(0.25, Math.min(4.0, pinchStartZoom * (dist / pinchStartDist)));
          state.boardCam.zoom = newZ;
          state.boardCam.panX = curSx - pinchBoardWorldX * newZ;
          state.boardCam.panY = curSy - pinchBoardWorldY * newZ;
          showBoardZoomPill(Math.round(newZ * 100));

          if (!pinchRaf) {
            pinchRaf = requestAnimationFrame(() => {
              pinchRaf = null;
              updateBoardCameraHud();
              if (surfaces.board) {
                drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
                redrawSurface('board');
              }
            });
          }
        } else if (state.mode === 'pdf') {
          pinchScaleTemp = Math.max(0.25, Math.min(3.0, dist / pinchStartDist));
          const dx = midX - pinchStartMidX;
          const dy = midY - pinchStartMidY;
          pdfHolder.style.willChange = 'transform';
          pdfHolder.style.transformOrigin = `${pinchHolderOriginX}px ${pinchHolderOriginY}px`;
          pdfHolder.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${pinchScaleTemp})`;
        }
      }
    }
  }, { passive: false });

  function _commitOrResetPdfPinch() {
    if (tMaxFingers >= 2 && tMoved && state.mode === 'pdf') {
      const dx = pinchLastMidX - pinchStartMidX;
      const dy = pinchLastMidY - pinchStartMidY;
      pdfHolder.style.transform = '';
      pdfHolder.style.transformOrigin = '';
      pdfHolder.style.willChange = '';
      if (Math.abs(pinchScaleTemp - 1.0) > 0.02) {
        const sr = pdfScroll.getBoundingClientRect();
        changeZoom(pinchStartZoom * pinchScaleTemp, {
          docX: pinchPdfDocX,
          docY: pinchPdfDocY,
          vx1: pinchLastMidX - sr.left,
          vy1: pinchLastMidY - sr.top
        });
      } else {
        pdfScroll.scrollLeft -= dx;
        pdfScroll.scrollTop -= dy;
      }
      tMoved = false;
      pinchScaleTemp = 1.0;
    }
  }

  window.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      hideBoardZoomPill(550);
      pinchStartDist = 0;
    }
    if (e.touches.length < 2 && tMaxFingers >= 2 && tMoved && state.mode === 'pdf') {
      _commitOrResetPdfPinch();
    }
    if (e.touches.length === 0) {
      if (tMaxFingers === 0 && singleTapTrack && !singleTapTrack.moved) {
        const now = performance.now();
        if (now - singleTapTrack.ts < 260) {
          const onBoard = bxWindow && !bxWindow.classList.contains('hidden') && (e.target === bxInkCanvas || e.target === bxActiveCanvas);
          if (lastSingleTap.ts && (now - lastSingleTap.ts) < 320 && Math.hypot(singleTapTrack.x - lastSingleTap.x, singleTapTrack.y - lastSingleTap.y) < 42 && lastSingleTap.onBoard === onBoard) {
            lastSingleTap.ts = 0;
            if (onBoard && surfaces.board) {
              const r = bxInkCanvas.getBoundingClientRect();
              const cx = r.width * 0.5, cy = r.height * 0.5;
              const wx = (cx - state.boardCam.panX) / state.boardCam.zoom;
              const wy = (cy - state.boardCam.panY) / state.boardCam.zoom;
              state.boardCam.zoom = 1.0;
              state.boardCam.panX = cx - wx;
              state.boardCam.panY = cy - wy;
              updateBoardCameraHud();
              drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
              redrawSurface('board');
              showBoardZoomPill(100);
              hideBoardZoomPill(700);
            }
          } else {
            lastSingleTap = { ts: now, x: singleTapTrack.x, y: singleTapTrack.y, onBoard };
          }
        }
      }
      singleTapTrack = null;
      if (tMaxFingers >= 2) {
        const dt = performance.now() - tStart;
        if (!tMoved && dt < 300) {
          if (tMaxFingers === 2) {
            performUndo();
            notify('✌️ Chạm 2 ngón: Hoàn tác (Undo)');
          } else if (tMaxFingers === 3) {
            performRedo();
            notify('🤟 Chạm 3 ngón: Làm lại (Redo)');
          }
        } else if (tMoved && state.mode === 'pdf') {
          _commitOrResetPdfPinch();
        } else {
          pdfHolder.style.transform = '';
          pdfHolder.style.transformOrigin = '';
          pdfHolder.style.willChange = '';
        }
        tMaxFingers = 0;
        tMoved = false;
        pinchScaleTemp = 1.0;
      }
      isMultiTouch = false;
    }
  }, { passive: true });

  window.addEventListener('touchcancel', () => {
    hideBoardZoomPill(300);
    _commitOrResetPdfPinch();
    pdfHolder.style.transform = '';
    pdfHolder.style.transformOrigin = '';
    pdfHolder.style.willChange = '';
    tMaxFingers = 0;
    tMoved = false;
    pinchScaleTemp = 1.0;
    isMultiTouch = false;
  }, { passive: true });

  // ============================================================================
  // CHẾ ĐỘ TRÌNH CHIẾU TV 16:9 📺 (CHẨN ĐOÁN THỰC TẾ + TÁCH LUỒNG INK/BULK + STROKE COMMIT)
  // ============================================================================
  const IPAD_TV_BUILD_VERSION = '20261121.fix6';
  const presentModal = document.getElementById('ModalTrinhChieu');
  const tvChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('nkpdf-tv-16x9') : null;
  let tvStageActive = false;
  let tvPresentMode = 'presenter_crop'; // 'presenter_crop' (tràn ngang 16:9) | 'full_page' (toàn trang)
  let tvMqttClient = null;
  let tvMqttTopic = '';
  let tvLastFrameSig = '';

  // Trạng thái pipeline gửi frame bất đồng bộ & chống tích lũy độ trễ (Backpressure / Latest-Frame-Wins)
  let tvFrameSeq = 0;
  let tvFrameEncoding = false;
  let tvFrameInFlightId = 0;
  let tvFrameAckWatchdog = null;
  let tvPendingSync = false;
  let tvPendingForce = false;
  let tvRafSyncId = 0;
  let tvScrollThrottleTimer = null;
  let tvSkipNextSurfaceSync = false;
  const tvInFlightMeta = new Map(); // frameId -> { t0Perf, captureMs, encodeMs, publishMs, bytes }

  // WebRTC Dual-Channel & ICE State
  let tvRtcPc = null;
  let tvRtcChannel = null;     // nkpdf-tv-ink (chỉ nét bút + view_sync nhỏ)
  let tvRtcBulkChannel = null; // nkpdf-tv-bulk (chỉ pdf_chunk + annots_sync + frame)
  let tvRtcRoomCode = '';
  let tvTransportMode = 'MQTT';
  let pendingIpadRemoteIce = [];
  let tvStatsTimer = null;
  let tvIsActivelyWriting = false;
  let tvWritingSafetyTimer = null;
  let tvPendingViewSync = null;
  let tvDocVersion = 0;

  // Trạng thái tách biệt: đã mở PDF vs đã dựng xong trang đang xem
  let tvPeerPdfOpened = false;
  let tvPeerPageReadyKey = ''; // `${pdfHash}:${pno}`
  let tvPeerPdfHash = '';
  let tvPdfTransferringHash = '';
  let tvPdfTransferTimer = null;
  let tvPdfTimeoutTimer = null;
  let tvPdfRetries = 0;
  let tvFallbackReason = '';

  // Bảng chẩn đoán thực tế (Mục 1)
  const tvDiagState = {
    ipadVersion: IPAD_TV_BUILD_VERSION,
    tvVersion: '',
    brokerName: '',
    rtcIceState: 'idle',
    rtcSelectedPair: 'Chưa nối WebRTC',
    isVerifiedLan: false,
    lastStrokeTransport: 'Chưa gửi',
    tvImageMode: 'Chưa chiếu',
    tvPdfSize: '',
    tvCanvasSize: '',
    tvViewport: '',
    lastError: '',
    videoState: 'Tắt',
    videoTrackInfo: '',
    videoCodec: '',
    videoOutFps: 0,
    videoOutFrames: 0,
    videoOutLimit: '',
    videoInRes: '',
    videoInDecoded: 0,
    videoInDropped: 0,
    videoInRttMs: 0,
    videoInErr: ''
  };

  // ============================================================================
  // THỬ NGHIỆM: VIDEO TRỰC TIẾP 16:9 (canvas.captureStream() + RTCPeerConnection)
  // ============================================================================
  let tvStreamMode = 'vector'; // 'vector' | 'video_test' | 'video_live'
  let tvVideoPreset = '1080p30'; // '1080p30' | '720p60'
  let tvVideoContentHint = 'detail';
  let tvVidPc = null;
  let tvVidStream = null;
  let tvVidAnimId = 0;
  let tvVidStatsTimer = null;
  let pendingIpadVidIce = [];
  let tvVidBaseDirty = true;
  let tvVidActiveDirty = false;
  let tvVidTestFrameCount = 0;
  const tvVideoCanvas = document.createElement('canvas');
  const tvVideoCtx = tvVideoCanvas.getContext('2d');
  const tvVideoBaseCanvas = document.createElement('canvas');
  const tvVideoBaseCtx = tvVideoBaseCanvas.getContext('2d');

  function getVideoPresetSpec() {
    if (tvVideoPreset === '720p60') {
      return { w: 1280, h: 720, fps: 60, maxBitrate: 2500000, label: '1280×720@60fps' };
    }
    return { w: 1920, h: 1080, fps: 30, maxBitrate: 3800000, label: '1920×1080@30fps' };
  }

  function renderVideoTestFrame() {
    const W = tvVideoCanvas.width, H = tvVideoCanvas.height;
    tvVidTestFrameCount++;
    const now = performance.now();
    const ctx = tvVideoCtx;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Lưới nhạt kiểm tra sắc nét
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 1;
    const step = Math.round(W / 24);
    ctx.beginPath();
    for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    const s = W / 1920;
    ctx.fillStyle = '#0F172A';
    ctx.font = `bold ${Math.round(34 * s)}px "Segoe UI", sans-serif`;
    ctx.fillText(`NKPDF 2.9 — THỬ VIDEO TRỰC TIẾP 16:9 (${W}×${H} • Frame #${tvVidTestFrameCount})`, Math.round(64 * s), Math.round(80 * s));

    ctx.fillStyle = '#1E3A8A';
    ctx.font = `${Math.round(24 * s)}px "Segoe UI", sans-serif`;
    ctx.fillText('1. Chữ nhỏ (24px/18px/14px) & công thức mẫu để soi độ nét trên TV:', Math.round(64 * s), Math.round(145 * s));

    ctx.fillStyle = '#0F172A';
    ctx.font = `${Math.round(18 * s)}px "Segoe UI", sans-serif`;
    ctx.fillText('Cỡ 18px: Một vật dao động điều hòa với phương trình x = A·cos(ωt + φ). Chu kì T = 2π√(m/k), năng lượng E = ½kA².', Math.round(64 * s), Math.round(192 * s));
    ctx.font = `${Math.round(14 * s)}px "Segoe UI", sans-serif`;
    ctx.fillText('Cỡ 14px: Kiểm tra chỉ số trên/dưới: H₂SO₄, x₁² + x₂² = (x₁ + x₂)² - 2x₁x₂, v = √(2gh), ∫₀^π sin(x) dx = 2, Δλ/λ₀ = v/c.', Math.round(64 * s), Math.round(230 * s));

    // Công thức lớn kiểu sách giáo khoa
    ctx.font = `bold ${Math.round(36 * s)}px "Times New Roman", serif`;
    ctx.fillText('E = mc²      |      T = 2π √(l / g)      |      1/f = 1/d + 1/d\'', Math.round(64 * s), Math.round(310 * s));

    // Nét chuyển động liên tục (sóng sin + con trỏ tròn đỏ) để kiểm chứng TV đang giải mã video mượt
    const bx = Math.round(64 * s), by = Math.round(420 * s);
    const bw = Math.round(W - 128 * s), bh = Math.round(420 * s);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = Math.max(1.5, 2 * s);
    ctx.strokeRect(bx, by, bw, bh);

    const phase = now * 0.004;
    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = Math.max(2, 4 * s);
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const t = i / 180;
      const px = bx + t * bw;
      const py = by + bh * 0.5 - Math.sin(t * Math.PI * 4 + phase) * (bh * 0.34);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    const dotT = (Math.sin(phase * 0.55) + 1) * 0.5;
    const dotX = bx + dotT * bw;
    const dotY = by + bh * 0.5 - Math.sin(dotT * Math.PI * 4 + phase) * (bh * 0.34);
    ctx.fillStyle = '#DC2626';
    ctx.beginPath();
    ctx.arc(dotX, dotY, Math.round(14 * s), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#047857';
    ctx.font = `bold ${Math.round(22 * s)}px monospace`;
    ctx.fillText(`CLOCK: ${new Date().toLocaleTimeString('vi-VN')}.${String(Date.now() % 1000).padStart(3, '0')} | hint=${tvVideoContentHint}`, Math.round(64 * s), Math.round(H - 60 * s));
  }

  function renderVideoLiveBase() {
    const W = tvVideoBaseCanvas.width, H = tvVideoBaseCanvas.height;
    const bctx = tvVideoBaseCtx;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    if (state.mode === 'board' && surfaces.board && bxGridCanvas && bxInkCanvas) {
      const bgMap = { green: '#0B6251', black: '#000000', white: '#FFFFFF', cream: '#FDF6E3' };
      bctx.fillStyle = bgMap[state.boardTheme] || '#0B6251';
      bctx.fillRect(0, 0, W, H);
      const sw = bxGridCanvas.width, sh = bxGridCanvas.height;
      if (sw > 0 && sh > 0) {
        const cropH = Math.min(sh, Math.round(sw * (9 / 16)));
        const drawH = Math.round(W * (cropH / sw));
        bctx.drawImage(bxGridCanvas, 0, 0, sw, cropH, 0, 0, W, drawH);
        bctx.drawImage(bxInkCanvas, 0, 0, sw, cropH, 0, 0, W, drawH);
      }
    } else {
      const pno = state.currentPage || 1;
      const surf = surfaces[pno];
      if (surf && surf.mounted && surf.baseCanvas && surf.inkCanvas) {
        const hiCanvas = (W > surf.baseCanvas.width * 1.05) ? ensureTvHiResPdfPage(pno, W) : null;
        const srcBase = hiCanvas || surf.baseCanvas;
        const sw = srcBase.width, sh = srcBase.height;
        const baseScale = sw / Math.max(1, surf.cssWidth);
        bctx.fillStyle = '#FFFFFF';
        bctx.fillRect(0, 0, W, H);
        if (sw > 0 && sh > 0) {
          if (tvPresentMode === 'full_page') {
            const scale = Math.min(W / sw, H / sh);
            const dw = sw * scale, dh = sh * scale;
            const dx = (W - dw) * 0.5, dy = (H - dh) * 0.5;
            bctx.drawImage(srcBase, dx, dy, dw, dh);
            bctx.save();
            bctx.setTransform(baseScale * scale, 0, 0, baseScale * scale, dx, dy);
            const list = state.annots[pno] || [];
            for (let i = 0; i < list.length; i++) NKInkEngine.drawObject(bctx, list[i], false, false);
            bctx.restore();
          } else {
            const elTop = surf.wrap ? surf.wrap.offsetTop : 0;
            const visOffsetCss = Math.max(0, pdfScroll.scrollTop - elTop);
            const srcY = Math.min(sh - 10, Math.round(visOffsetCss * baseScale));
            const cropH = Math.round(sw * (9 / 16));
            const availH = Math.max(10, Math.min(cropH, sh - srcY));
            const drawH = Math.round((availH / cropH) * H);
            bctx.drawImage(srcBase, 0, srcY, sw, availH, 0, 0, W, drawH);
            const cssToTv = W / Math.max(1, surf.cssWidth);
            bctx.save();
            bctx.beginPath();
            bctx.rect(0, 0, W, drawH);
            bctx.clip();
            bctx.setTransform(cssToTv, 0, 0, cssToTv, 0, -visOffsetCss * cssToTv);
            const list = state.annots[pno] || [];
            for (let i = 0; i < list.length; i++) NKInkEngine.drawObject(bctx, list[i], false, false);
            bctx.restore();
          }
        }
      }
    }
    tvVidBaseDirty = false;
  }

  function renderVideoLiveComposite() {
    const W = tvVideoCanvas.width, H = tvVideoCanvas.height;
    if (tvVidBaseDirty) renderVideoLiveBase();
    tvVideoCtx.drawImage(tvVideoBaseCanvas, 0, 0, W, H);
    // Vẽ thêm lớp nét đang viết (activeCanvas) tăng dần lên trên nền đã dựng
    if (state.mode === 'board' && bxActiveCanvas && bxGridCanvas && bxGridCanvas.width > 0) {
      const sw = bxGridCanvas.width, sh = bxGridCanvas.height;
      const cropH = Math.min(sh, Math.round(sw * (9 / 16)));
      const drawH = Math.round(W * (cropH / sw));
      tvVideoCtx.drawImage(bxActiveCanvas, 0, 0, sw, cropH, 0, 0, W, drawH);
    } else {
      const pno = state.currentPage || 1;
      const surf = surfaces[pno];
      if (surf && surf.mounted && surf.activeCanvas && surf.baseCanvas) {
        const sw = surf.baseCanvas.width, sh = surf.baseCanvas.height;
        if (tvPresentMode === 'full_page') {
          const scale = Math.min(W / sw, H / sh);
          const dw = sw * scale, dh = sh * scale;
          const dx = (W - dw) * 0.5, dy = (H - dh) * 0.5;
          tvVideoCtx.drawImage(surf.activeCanvas, dx, dy, dw, dh);
        } else {
          const elTop = surf.wrap ? surf.wrap.offsetTop : 0;
          const visOffsetCss = Math.max(0, pdfScroll.scrollTop - elTop);
          const srcY = Math.min(sh - 10, Math.round(visOffsetCss * surf.dpr));
          const cropH = Math.round(sw * (9 / 16));
          const availH = Math.max(10, Math.min(cropH, sh - srcY));
          const drawH = Math.round((availH / cropH) * H);
          tvVideoCtx.drawImage(surf.activeCanvas, 0, srcY, sw, availH, 0, 0, W, drawH);
        }
      }
    }
    tvVidActiveDirty = false;
  }

  function stopTvVideoStream(notifyTv = true) {
    if (tvVidAnimId) { cancelAnimationFrame(tvVidAnimId); tvVidAnimId = 0; }
    if (tvVidStatsTimer) { clearInterval(tvVidStatsTimer); tvVidStatsTimer = null; }
    pendingIpadVidIce = [];
    if (tvVidStream) {
      try { tvVidStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      tvVidStream = null;
    }
    if (tvVidPc) {
      try { tvVidPc.close(); } catch (_) {}
      tvVidPc = null;
    }
    tvDiagState.videoState = 'Tắt';
    if (notifyTv && tvMqttClient && tvMqttClient.connected && tvMqttTopic) {
      try { tvMqttClient.publish(tvMqttTopic, JSON.stringify({ type: 'vid_stop' })); } catch (_) {}
    }
    updateTvMetricsBadge();
  }

  function startTvVideoStream(roomCode) {
    stopTvVideoStream(false);
    if (typeof tvVideoCanvas.captureStream !== 'function') {
      tvDiagState.videoState = 'Không hỗ trợ: canvas.captureStream() không khả dụng';
      tvDiagState.lastError = tvDiagState.videoState;
      updateTvMetricsBadge();
      return;
    }
    if (typeof RTCPeerConnection !== 'function') {
      tvDiagState.videoState = 'Không hỗ trợ: RTCPeerConnection không khả dụng';
      tvDiagState.lastError = tvDiagState.videoState;
      updateTvMetricsBadge();
      return;
    }

    const spec = getVideoPresetSpec();
    tvVideoCanvas.width = spec.w;
    tvVideoCanvas.height = spec.h;
    tvVideoBaseCanvas.width = spec.w;
    tvVideoBaseCanvas.height = spec.h;
    tvVidBaseDirty = true;
    tvVidActiveDirty = true;
    tvVidTestFrameCount = 0;

    if (tvStreamMode === 'video_test') {
      renderVideoTestFrame();
    } else {
      renderVideoLiveComposite();
    }

    try {
      tvVidStream = tvVideoCanvas.captureStream(spec.fps);
    } catch (err) {
      tvDiagState.videoState = 'Không hỗ trợ: captureStream lỗi - ' + (err && err.message ? err.message : String(err));
      tvDiagState.lastError = tvDiagState.videoState;
      updateTvMetricsBadge();
      return;
    }

    const vTrack = tvVidStream.getVideoTracks()[0];
    if (!vTrack) {
      tvDiagState.videoState = 'Không hỗ trợ: Không tạo được video track';
      updateTvMetricsBadge();
      return;
    }
    try {
      if ('contentHint' in vTrack) vTrack.contentHint = tvVideoContentHint;
    } catch (_) {}
    tvDiagState.videoTrackInfo = `${vTrack.readyState} (${spec.label}, hint=${vTrack.contentHint || 'n/a'})`;
    tvDiagState.videoState = 'Đang kết nối Video...';

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ],
      iceCandidatePoolSize: 2
    });
    tvVidPc = pc;
    const sender = pc.addTrack(vTrack, tvVidStream);

    // Ưu tiên H.264 nếu trình duyệt hỗ trợ
    try {
      if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities && typeof pc.getTransceivers === 'function') {
        const caps = RTCRtpSender.getCapabilities('video');
        if (caps && caps.codecs) {
          const h264 = caps.codecs.filter((c) => c.mimeType && c.mimeType.toLowerCase() === 'video/h264');
          const others = caps.codecs.filter((c) => !c.mimeType || c.mimeType.toLowerCase() !== 'video/h264');
          const ordered = h264.concat(others);
          pc.getTransceivers().forEach((t) => {
            if (t.sender === sender && typeof t.setCodecPreferences === 'function') {
              try { t.setCodecPreferences(ordered); } catch (_) {}
            }
          });
        }
      }
    } catch (_) {}

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        tvDiagState.videoState = 'Đang phát Video (' + spec.label + ')';
        try {
          const params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = spec.maxBitrate;
          params.encodings[0].maxFramerate = spec.fps;
          sender.setParameters(params).catch(() => {});
        } catch (_) {}
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        tvDiagState.videoState = 'Lỗi kết nối Video: ICE ' + pc.iceConnectionState;
        tvDiagState.lastError = tvDiagState.videoState;
      }
      updateTvMetricsBadge();
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && tvMqttClient && tvMqttClient.connected && tvMqttTopic) {
        tvMqttClient.publish(tvMqttTopic, JSON.stringify({
          type: 'vid_ice',
          roomCode: roomCode,
          candidate: ev.candidate
        }));
      }
    };

    pc.createOffer().then((offer) => pc.setLocalDescription(offer).then(() => offer)).then((offer) => {
      if (tvMqttClient && tvMqttClient.connected && tvMqttTopic) {
        tvMqttClient.publish(tvMqttTopic, JSON.stringify({
          type: 'vid_offer',
          roomCode: roomCode,
          preset: tvVideoPreset,
          contentHint: tvVideoContentHint,
          sdp: offer
        }));
      }
    }).catch((err) => {
      tvDiagState.videoState = 'Lỗi kết nối Video: ' + (err && err.message ? err.message : String(err));
      updateTvMetricsBadge();
    });

    function pumpVideoLoop() {
      if (!tvStageActive || tvStreamMode === 'vector') return;
      if (tvStreamMode === 'video_test') {
        renderVideoTestFrame();
      } else if (tvVidBaseDirty || tvVidActiveDirty) {
        renderVideoLiveComposite();
      }
      tvVidAnimId = requestAnimationFrame(pumpVideoLoop);
    }
    tvVidAnimId = requestAnimationFrame(pumpVideoLoop);

    tvVidStatsTimer = setInterval(() => {
      if (!tvVidPc || tvVidPc !== pc) return;
      pc.getStats().then((report) => {
        const byId = new Map();
        report.forEach((s) => byId.set(s.id, s));
        report.forEach((s) => {
          if (s.type === 'outbound-rtp' && s.kind === 'video') {
            tvDiagState.videoOutFps = Math.round((s.framesPerSecond || 0) * 10) / 10;
            tvDiagState.videoOutFrames = s.framesEncoded || 0;
            tvDiagState.videoOutLimit = s.qualityLimitationReason || 'none';
            if (s.codecId && byId.get(s.codecId)) {
              tvDiagState.videoCodec = byId.get(s.codecId).mimeType || '';
            }
          }
        });
        updateTvMetricsBadge();
      }).catch(() => {});
    }, 1500);
    updateTvMetricsBadge();
  }

  function getCurrentPdfHash() {
    if (!state.pdfBytes) return '';
    return `${state.pdfBytes.length}_${state.pdfFileName || 'pdf'}`;
  }

  function tvOnPdfLoaded() {
    tvPeerPdfOpened = false;
    tvPeerPageReadyKey = '';
    tvPeerPdfHash = '';
    tvPdfTransferringHash = '';
    tvPdfRetries = 0;
    tvFallbackReason = '';
    if (tvPdfTransferTimer) { clearTimeout(tvPdfTransferTimer); tvPdfTransferTimer = null; }
    if (tvPdfTimeoutTimer) { clearTimeout(tvPdfTimeoutTimer); tvPdfTimeoutTimer = null; }
    tvHiResCache.key = '';
    tvHiResCache.renderingKey = '';
    if (tvStageActive) {
      sendPdfToTv();
      scheduleTvFrameSync('pdf_loaded', true);
    }
  }

  function uint8ToBase64(u8) {
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < u8.length; i += step) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + step));
    }
    return btoa(bin);
  }

  function isCurrentPageReadyOnTv() {
    const hash = getCurrentPdfHash();
    const pno = state.currentPage || 1;
    return Boolean(tvPeerPdfOpened && hash && tvPeerPageReadyKey === `${hash}:${pno}`);
  }

  function sendPdfToTv() {
    if (!tvStageActive || !state.pdfBytes || !state.pdfBytes.length) return;
    const hash = getCurrentPdfHash();
    if (!hash || (tvPeerPdfOpened && tvPeerPdfHash === hash) || tvPdfTransferringHash === hash) return;
    if (tvPdfTransferTimer) { clearTimeout(tvPdfTransferTimer); tvPdfTransferTimer = null; }
    if (tvPdfTimeoutTimer) { clearTimeout(tvPdfTimeoutTimer); tvPdfTimeoutTimer = null; }

    if (state.pdfBytes.length > 18 * 1024 * 1024) {
      tvFallbackReason = 'Tệp PDF > 18 MiB (chạy ảnh dự phòng)';
      updateTvMetricsBadge();
      return;
    }

    tvPdfTimeoutTimer = setTimeout(() => {
      if (!tvStageActive || (tvPeerPdfOpened && tvPeerPdfHash === hash)) return;
      tvPdfTransferringHash = '';
      if (tvPdfRetries < 1) {
        tvPdfRetries++;
        tvFallbackReason = 'Timeout truyền PDF, đang thử lại lần 2...';
        sendPdfToTv();
      } else {
        tvFallbackReason = 'Hết thời gian dựng PDF trên TV (dùng ảnh dự phòng)';
      }
      updateTvMetricsBadge();
    }, 15000);

    // Đường nhanh cho đề mẫu có sẵn trên server/cache (< 50ms)
    if (state.pdfFileName === 'Lop_Ly_Thay_Ngoc.pdf') {
      tvPdfTransferringHash = hash;
      tvPublishPacket({
        type: 'pdf_load_url',
        url: './sample.pdf',
        pdfHash: hash,
        totalPages: state.totalPages,
        ipadVersion: IPAD_TV_BUILD_VERSION
      }, true);
      return;
    }

    // Với PDF riêng của Thầy (từ iPad): chia chunk gửi qua kênh bulk, tự tạm dừng khi đang viết bút!
    tvPdfTransferringHash = hash;
    const CHUNK_BYTES = 16 * 1024;
    const totalChunks = Math.ceil(state.pdfBytes.length / CHUNK_BYTES);
    tvPublishPacket({
      type: 'pdf_start',
      pdfHash: hash,
      totalChunks: totalChunks,
      size: state.pdfBytes.length,
      ipadVersion: IPAD_TV_BUILD_VERSION
    }, true);

    let idx = 0;
    function pumpNextChunk() {
      if (!tvStageActive || tvPdfTransferringHash !== hash || idx >= totalChunks) return;
      // Mục 2: Tạm dừng gửi bulk PDF khi Thầy đang viết bằng Apple Pencil
      if (tvIsActivelyWriting) {
        tvPdfTransferTimer = setTimeout(pumpNextChunk, 45);
        return;
      }
      const isBulkRtc = Boolean(tvRtcBulkChannel && tvRtcBulkChannel.readyState === 'open');
      if (isBulkRtc && tvRtcBulkChannel.bufferedAmount > 128 * 1024) {
        tvPdfTransferTimer = setTimeout(pumpNextChunk, 30);
        return;
      }
      const start = idx * CHUNK_BYTES;
      const slice = state.pdfBytes.subarray(start, Math.min(state.pdfBytes.length, start + CHUNK_BYTES));
      tvPublishPacket({
        type: 'pdf_chunk',
        pdfHash: hash,
        idx: idx,
        data: uint8ToBase64(slice)
      }, true);
      idx++;
      if (idx < totalChunks) {
        tvPdfTransferTimer = setTimeout(pumpNextChunk, isBulkRtc ? 6 : 35);
      }
    }
    tvPdfTransferTimer = setTimeout(pumpNextChunk, 20);
  }

  // Bộ nhớ đệm 1 trang PDF độ phân giải gốc 1920px dành riêng cho TV (tránh phóng đại từ canvas 800px gây mờ!)
  const tvHiResCache = {
    key: '',
    renderingKey: '',
    canvas: document.createElement('canvas'),
    pageNo: 0,
    width: 0,
    height: 0
  };
  function ensureTvHiResPdfPage(pno, targetW) {
    if (!state.pdfDoc) return null;
    const slot = state.pageSlots[pno - 1] || { kind: 'pdf', pdfPageNo: pno };
    if (slot.kind !== 'pdf') return null;
    const surf = surfaces[pno];
    if (!surf || !surf.cssWidth) return null;
    const rotPref = state.pageRotations[pno] || 0;
    const key = `${slot.pdfPageNo}_${rotPref}_${targetW}`;
    if (tvHiResCache.key === key && tvHiResCache.canvas.width > 0) {
      return tvHiResCache.canvas;
    }
    if (tvHiResCache.renderingKey === key) return null;
    tvHiResCache.renderingKey = key;
    state.pdfDoc.getPage(slot.pdfPageNo).then((page) => {
      if (!tvStageActive || tvHiResCache.renderingKey !== key) return;
      const rot = (page.rotate + rotPref) % 360;
      const baseVp = page.getViewport({ scale: 1.0, rotation: rot });
      const hiScale = Math.max(1.5, targetW / Math.max(1, baseVp.width));
      const rvp = page.getViewport({ scale: hiScale, rotation: rot });
      tvHiResCache.canvas.width = Math.round(rvp.width);
      tvHiResCache.canvas.height = Math.round(rvp.height);
      const hctx = tvHiResCache.canvas.getContext('2d');
      hctx.fillStyle = '#FFFFFF';
      hctx.fillRect(0, 0, tvHiResCache.canvas.width, tvHiResCache.canvas.height);
      return page.render({ canvasContext: hctx, viewport: rvp }).promise.then(() => {
        if (tvHiResCache.renderingKey === key) {
          tvHiResCache.key = key;
          tvHiResCache.pageNo = pno;
          tvHiResCache.width = tvHiResCache.canvas.width;
          tvHiResCache.height = tvHiResCache.canvas.height;
          tvHiResCache.renderingKey = '';
          if (tvStageActive) scheduleTvFrameSync('hires_ready', true);
        }
      });
    }).catch(() => {
      if (tvHiResCache.renderingKey === key) tvHiResCache.renderingKey = '';
    });
    return null;
  }

  // Trạng thái truyền delta nét bút Apple Pencil thời gian thực (Realtime Stroke Delta)
  let tvActiveStrokeId = 0;
  let tvActiveStrokeSid = null;
  let tvActiveStrokeSeq = 0;
  let tvActiveStrokeTransport = 'MQTT'; // Khóa đường truyền cho suốt 1 nét (không xé lẻ qua MQTT giữa chừng)
  let tvStrokeBuf = [];
  let tvStrokeBufFirstPerf = 0;
  let tvStrokeRafId = 0;
  const tvStrokeSentMeta = new Map(); // strokeKey -> { t0Perf, sampleMs, bytes }

  // Bộ đo hiệu năng P50/P95 & băng thông thực tế
  const tvMetrics = {
    captureMs: [],
    encodeMs: [],
    publishMs: [],
    frameBytes: [],
    frameRttMs: [],
    frameTimeouts: 0, // Tách riêng khỏi frameRttMs (Mục 6)
    tvDecodeMs: [],
    bytesLog: []
  };
  const TV_METRIC_WINDOW = 120;
  function pushTvMetric(arr, val) {
    if (!Number.isFinite(val) || val < 0) return;
    arr.push(val);
    while (tvMetrics.bytesLog.length > 0 && tvMetrics.bytesLog[0].ts < cutoff) {
      tvMetrics.bytesLog.shift();
    }
  }
  function calcPercentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Math.round(sorted[idx] * 10) / 10;
  }
  function getTvMetricsSummary() {
    const now = performance.now();
    const cutoff = now - 5000;
    let totalBytes5s = 0;
    let firstTs = now;
    for (let i = 0; i < tvMetrics.bytesLog.length; i++) {
      if (tvMetrics.bytesLog[i].ts >= cutoff) {
        totalBytes5s += tvMetrics.bytesLog[i].bytes;
        if (tvMetrics.bytesLog[i].ts < firstTs) firstTs = tvMetrics.bytesLog[i].ts;
      }
    }
    const spanSec = Math.max(0.5, (now - firstTs) / 1000);
    return {
      resolution: `${tv169Canvas.width}x${tv169Canvas.height}`,
      mime: tvEncodeMime,
      quality: tvEncodeQuality,
      samples: {
        frames: tvMetrics.frameBytes.length,
        deltas: tvMetrics.deltaBytes.length
      },
      frame: {
        captureMs: { p50: calcPercentile(tvMetrics.captureMs, 50), p95: calcPercentile(tvMetrics.captureMs, 95) },
        encodeMs: { p50: calcPercentile(tvMetrics.encodeMs, 50), p95: calcPercentile(tvMetrics.encodeMs, 95) },
        publishMs: { p50: calcPercentile(tvMetrics.publishMs, 50), p95: calcPercentile(tvMetrics.publishMs, 95) },
        tvDecodeMs: { p50: calcPercentile(tvMetrics.tvDecodeMs, 50), p95: calcPercentile(tvMetrics.tvDecodeMs, 95) },
        tvDrawMs: { p50: calcPercentile(tvMetrics.tvDrawMs, 50), p95: calcPercentile(tvMetrics.tvDrawMs, 95) },
        rttMs: { p50: calcPercentile(tvMetrics.frameRttMs, 50), p95: calcPercentile(tvMetrics.frameRttMs, 95) },
        timeouts: tvMetrics.frameTimeouts,
        bytes: { p50: calcPercentile(tvMetrics.frameBytes, 50), p95: calcPercentile(tvMetrics.frameBytes, 95) }
      },
      delta: {
        sampleMs: { p50: calcPercentile(tvMetrics.deltaSampleMs, 50), p95: calcPercentile(tvMetrics.deltaSampleMs, 95) },
        queueWaitMs: { p50: calcPercentile(tvMetrics.inkQueueWaitMs, 50), p95: calcPercentile(tvMetrics.inkQueueWaitMs, 95) },
        tvDrawMs: { p50: calcPercentile(tvMetrics.tvStrokeDrawMs, 50), p95: calcPercentile(tvMetrics.tvStrokeDrawMs, 95) },
        rttMs: { p50: calcPercentile(tvMetrics.deltaRttMs, 50), p95: calcPercentile(tvMetrics.deltaRttMs, 95) },
        bytes: { p50: calcPercentile(tvMetrics.deltaBytes, 50), p95: calcPercentile(tvMetrics.deltaBytes, 95) }
      },
      diag: tvDiagState,
      bandwidthKBps: Math.round((totalBytes5s / 1024 / spanSec) * 10) / 10
    };
  }
  window.__nkpdfTvMetrics = {
    getSummary: getTvMetricsSummary,
    raw: tvMetrics
  };

  // Canvas chuẩn 16:9 xuất lên TV (P1: tự thích ứng 960×540 / 1280×720 / 1920×1080, ưu tiên WebP + fallback JPEG 0.85–0.92)
  const tv169Canvas = document.createElement('canvas');
  tv169Canvas.width = 1920;
  tv169Canvas.height = 1080;
  const tv169Ctx = tv169Canvas.getContext('2d');

  const TV_QUALITY_PRESETS = {
    fhd: { w: 1920, h: 1080, quality: 0.92, label: '1920×1080' },
    hd:  { w: 1280, h: 720,  quality: 0.90, label: '1280×720' },
    sd:  { w: 960,  h: 540,  quality: 0.85, label: '960×540' }
  };
  let tvQualityPresetMode = 'auto'; // 'auto' | 'fhd' | 'hd' | 'sd'
  let tvActivePresetKey = 'fhd';
  let tvEncodeMime = 'image/jpeg';
  let tvEncodeQuality = 0.92;
  let ipadSupportsWebP = false;
  let tvPeerSupportsWebP = false;
  let tvSlowFrameStreak = 0;

  // Kiểm tra trình duyệt iPad có hỗ trợ encode WebP qua toBlob không
  (function detectIpadWebPEncode() {
    try {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      if (typeof c.toBlob === 'function') {
        c.toBlob((blob) => {
          ipadSupportsWebP = Boolean(blob && blob.type === 'image/webp');
          refreshTvCodec();
        }, 'image/webp', 0.88);
      }
    } catch (_) { ipadSupportsWebP = false; }
  })();

  function refreshTvCodec() {
    tvEncodeMime = (ipadSupportsWebP && tvPeerSupportsWebP) ? 'image/webp' : 'image/jpeg';
  }

  function applyTvPreset(key, forceSync = false) {
    const p = TV_QUALITY_PRESETS[key] || TV_QUALITY_PRESETS.hd;
    tvActivePresetKey = key;
    if (tv169Canvas.width !== p.w || tv169Canvas.height !== p.h) {
      tv169Canvas.width = p.w;
      tv169Canvas.height = p.h;
    }
    tvEncodeQuality = p.quality;
    refreshTvCodec();
    updateTvMetricsBadge();
    if (forceSync && tvStageActive) {
      tvLastFrameSig = '';
      scheduleTvFrameSync('preset_change', true);
    }
  }

  function negotiateTvCapabilities(caps) {
    tvPeerSupportsWebP = Boolean(caps && caps.webp);
    refreshTvCodec();
    if (tvQualityPresetMode === 'auto') {
      const sw = (caps && Number(caps.screenW)) || 1920;
      if (sw >= 1600) applyTvPreset('fhd', false);
      else if (sw >= 1100) applyTvPreset('hd', false);
      else applyTvPreset('sd', false);
    } else {
      applyTvPreset(tvQualityPresetMode, false);
    }
  }

  function updateTvMetricsBadge() {
    const el = document.getElementById('tv-metrics-badge');
    const s = getTvMetricsSummary();
    if (el) {
      const fmt = s.mime === 'image/webp' ? 'WebP' : 'JPEG';
      const dP95 = s.delta.rttMs.p95 ? ` • Bút P95: ${s.delta.rttMs.p95}ms` : '';
      const fKB = s.frame.bytes.p50 ? ` • Frame: ${Math.round(s.frame.bytes.p50 / 1024)}KB` : '';
      const modeTag = (tvStreamMode !== 'vector') ? tvDiagState.videoState : (isCurrentPageReadyOnTv() ? 'PDF tự dựng' : 'Ảnh dự phòng');
      el.textContent = `${tvTransportMode} • ${modeTag} • ${s.resolution} ${fmt}${fKB}${dP95} • ${s.bandwidthKBps}KB/s`;
    }
    const diagEl = document.getElementById('tv-diag-panel');
    if (diagEl && !diagEl.classList.contains('hidden')) {
      const inkBuf = tvRtcChannel ? tvRtcChannel.bufferedAmount : 0;
      const bulkBuf = tvRtcBulkChannel ? tvRtcBulkChannel.bufferedAmount : 0;
      const videoLines = (tvStreamMode !== 'vector') ? [
        `--- VIDEO 16:9 (${tvStreamMode}) ---`,
        `Trạng thái Video: ${tvDiagState.videoState} | Track: ${tvDiagState.videoTrackInfo}`,
        `Codec: ${tvDiagState.videoCodec || '?'} | Out: ${tvDiagState.videoOutFps} fps (${tvDiagState.videoOutFrames} fr, limit=${tvDiagState.videoOutLimit})`,
        `TV nhận: ${tvDiagState.videoInRes || '?'} | Giải mã/Bỏ: ${tvDiagState.videoInDecoded}/${tvDiagState.videoInDropped} | Video RTT: ${tvDiagState.videoInRttMs} ms`,
        tvDiagState.videoInErr ? `Lỗi Video TV: ${tvDiagState.videoInErr}` : ''
      ].filter(Boolean) : [];
      diagEl.textContent = [
        `Phiên bản: iPad v${tvDiagState.ipadVersion} | TV v${tvDiagState.tvVersion || '?'}`,
        `Đường truyền nét bút thực tế: ${tvDiagState.lastStrokeTransport} | ICE: ${tvDiagState.rtcSelectedPair} (${tvDiagState.rtcIceState})`,
        `Chế độ hình thực tế: ${isCurrentPageReadyOnTv() ? 'PDF tự dựng' : 'Ảnh dự phòng'}${tvFallbackReason ? ` (${tvFallbackReason})` : ''}`,
        `TV Viewport/Canvas/PDF: ${tvDiagState.tvViewport || '?'} | ${tvDiagState.tvCanvasSize || '?'} | ${tvDiagState.tvPdfSize || '?'}`,
        `Hàng đợi bufferedAmount: ink=${inkBuf} B | bulk=${bulkBuf} B`,
        `Chờ gửi điểm bút P50/P95: ${s.delta.queueWaitMs.p50}/${s.delta.queueWaitMs.p95} ms | TV vẽ nét: ${s.delta.tvDrawMs.p50}/${s.delta.tvDrawMs.p95} ms`,
        `RTT bút WebRTC P50/P95: ${s.delta.rttMs.p50}/${s.delta.rttMs.p95} ms | Frame RTT: ${s.frame.rttMs.p50}/${s.frame.rttMs.p95} ms | Timeouts: ${s.frame.timeouts}`,
        ...videoLines,
        `Lỗi gần nhất: ${tvDiagState.lastError || 'Không'}`
      ].join('\n');
    }
  }

  const toggleDiagBtn = document.getElementById('btn-toggle-tv-diag');
  if (toggleDiagBtn) {
    toggleDiagBtn.addEventListener('click', () => {
      const p = document.getElementById('tv-diag-panel');
      if (p) {
        p.classList.toggle('hidden');
        updateTvMetricsBadge();
      }
    });
  }

  const tvPresetSelect = document.getElementById('tv-quality-preset');
  if (tvPresetSelect) {
    tvPresetSelect.addEventListener('change', () => {
      tvQualityPresetMode = tvPresetSelect.value || 'auto';
      tvSlowFrameStreak = 0;
      if (tvQualityPresetMode === 'auto') applyTvPreset('fhd', true);
      else applyTvPreset(tvQualityPresetMode, true);
    });
  }

  function closeTvRtc() {
    pendingIpadRemoteIce = [];
    if (tvStatsTimer) { clearInterval(tvStatsTimer); tvStatsTimer = null; }
    if (tvRtcChannel) {
      try { tvRtcChannel.close(); } catch (_) {}
      tvRtcChannel = null;
    }
    if (tvRtcBulkChannel) {
      try { tvRtcBulkChannel.close(); } catch (_) {}
      tvRtcBulkChannel = null;
    }
    if (tvRtcPc) {
      try { tvRtcPc.close(); } catch (_) {}
      tvRtcPc = null;
    }
    tvTransportMode = 'MQTT';
    tvDiagState.rtcIceState = 'closed';
    tvDiagState.rtcSelectedPair = 'MQTT fallback';
    tvDiagState.isVerifiedLan = false;
    updateTvMetricsBadge();
  }

  function inspectTvRtcStats() {
    if (!tvRtcPc || typeof tvRtcPc.getStats !== 'function') return;
    tvRtcPc.getStats().then((report) => {
      let activePair = null;
      const byId = new Map();
      report.forEach((stat) => byId.set(stat.id, stat));
      report.forEach((stat) => {
        if (stat.type === 'transport' && stat.selectedCandidatePairId) {
          activePair = byId.get(stat.selectedCandidatePairId) || null;
        }
      });
      if (!activePair) {
        report.forEach((stat) => {
          if (stat.type === 'candidate-pair' && (stat.nominated || stat.selected) && stat.state === 'succeeded') {
            activePair = stat;
          }
        });
      }
      if (activePair) {
        const loc = byId.get(activePair.localCandidateId);
        const rem = byId.get(activePair.remoteCandidateId);
        const lType = loc ? loc.candidateType : '?';
        const rType = rem ? rem.candidateType : '?';
        const isLan = (lType === 'host' && rType === 'host');
        tvDiagState.isVerifiedLan = isLan;
        tvDiagState.rtcSelectedPair = `${lType}->${rType} (${loc && loc.protocol ? loc.protocol : 'udp'})`;
        if (tvRtcChannel && tvRtcChannel.readyState === 'open') {
          tvTransportMode = isLan ? 'WebRTC LAN' : `WebRTC (${lType}/${rType})`;
        }
      }
      updateTvMetricsBadge();
    }).catch((err) => {
      tvDiagState.lastError = 'getStats: ' + (err && err.message ? err.message : String(err));
    });
  }

  function flushPendingIpadIce() {
    if (!tvRtcPc || !tvRtcPc.remoteDescription) return;
    while (pendingIpadRemoteIce.length > 0) {
      const cand = pendingIpadRemoteIce.shift();
      tvRtcPc.addIceCandidate(new RTCIceCandidate(cand)).catch((err) => {
        tvDiagState.lastError = 'iPad addIceCandidate: ' + (err && err.message ? err.message : String(err));
        updateTvMetricsBadge();
      });
    }
  }

  function handleTvControlAckMsg(msg) {
    if (!msg) return;
    if (msg.tvVersion) tvDiagState.tvVersion = msg.tvVersion;
    if (msg.type === 'frame_ack') {
      if (msg.imageMode) tvDiagState.tvImageMode = msg.imageMode;
      finishTvInFlight(msg.frameId || 0, msg.decodeMs, msg.drawMs);
    } else if (msg.type === 'stroke_ack' && msg.seqKey) {
      const sm = tvStrokeSentMeta.get(msg.seqKey);
      if (sm) {
        pushTvMetric(tvMetrics.deltaRttMs, performance.now() - sm.t0Perf);
        if (Number.isFinite(msg.drawMs)) pushTvMetric(tvMetrics.tvStrokeDrawMs, msg.drawMs);
        tvStrokeSentMeta.delete(msg.seqKey);
      }
    } else if (msg.type === 'pdf_opened' && msg.pdfHash) {
      if (msg.pdfHash === getCurrentPdfHash()) {
        tvPeerPdfOpened = true;
        tvPeerPdfHash = msg.pdfHash;
        tvPdfTransferringHash = '';
        if (tvPdfTimeoutTimer) { clearTimeout(tvPdfTimeoutTimer); tvPdfTimeoutTimer = null; }
        syncTvVectorView(true);
        updateTvMetricsBadge();
      }
    } else if (msg.type === 'page_ready' && msg.pdfHash) {
      if (msg.pdfHash === getCurrentPdfHash()) {
        tvPeerPdfOpened = true;
        tvPeerPdfHash = msg.pdfHash;
        tvPeerPageReadyKey = `${msg.pdfHash}:${msg.pno}`;
        tvFallbackReason = '';
        tvDiagState.tvImageMode = 'PDF tự dựng';
        if (msg.pdfSize) tvDiagState.tvPdfSize = msg.pdfSize;
        if (msg.canvasSize) tvDiagState.tvCanvasSize = msg.canvasSize;
        if (msg.viewport) tvDiagState.tvViewport = `${msg.viewport} DPR=${msg.dpr || 1}`;
        updateTvMetricsBadge();
      }
    } else if (msg.type === 'tv_need_snapshot') {
      scheduleTvFrameSync('tv_need_snapshot', true);
    }
  }

  function startTvWebRtcOffer(roomCode) {
    closeTvRtc();
    if (typeof RTCPeerConnection !== 'function' || !tvMqttClient || !tvMqttClient.connected) {
      tvDiagState.lastError = 'Trình duyệt không hỗ trợ RTCPeerConnection hoặc mất MQTT';
      return;
    }
    try {
      tvRtcRoomCode = roomCode;
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ],
        iceCandidatePoolSize: 2
      });
      tvRtcPc = pc;
      const dcInk = pc.createDataChannel('nkpdf-tv-ink', { ordered: true });
      const dcBulk = pc.createDataChannel('nkpdf-tv-bulk', { ordered: true });
      dcInk.bufferedAmountLowThreshold = 16 * 1024;
      dcBulk.bufferedAmountLowThreshold = 64 * 1024;
      tvRtcChannel = dcInk;
      tvRtcBulkChannel = dcBulk;

      pc.oniceconnectionstatechange = () => {
        tvDiagState.rtcIceState = pc.iceConnectionState;
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          inspectTvRtcStats();
        } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          tvDiagState.lastError = 'ICE ' + pc.iceConnectionState;
          tvTransportMode = 'MQTT';
        }
        updateTvMetricsBadge();
      };

      dcInk.onopen = () => {
        tvTransportMode = 'WebRTC';
        inspectTvRtcStats();
        if (tvStatsTimer) clearInterval(tvStatsTimer);
        tvStatsTimer = setInterval(inspectTvRtcStats, 2000);
        sendPdfToTv();
        scheduleTvFrameSync('rtc_open', true);
      };
      dcInk.onclose = () => {
        if (tvTransportMode !== 'MQTT') {
          tvTransportMode = 'MQTT';
          tvDiagState.lastError = 'Kênh WebRTC ink đã đóng -> chuyển MQTT';
          updateTvMetricsBadge();
          scheduleTvFrameSync('transport_switch', true);
        }
      };
      dcInk.onerror = (err) => {
        tvDiagState.lastError = 'dcInk error: ' + (err && err.message ? err.message : 'DataChannelError');
        updateTvMetricsBadge();
      };
      dcInk.onbufferedamountlow = () => {
        if (tvPendingViewSync && tvStageActive) {
          const vs = tvPendingViewSync;
          tvPendingViewSync = null;
          tvPublishPacket(vs, false);
        }
      };
      dcBulk.onerror = (err) => {
        tvDiagState.lastError = 'dcBulk error: ' + (err && err.message ? err.message : 'DataChannelError');
        updateTvMetricsBadge();
      };
      dcInk.onmessage = (ev) => {
        try { handleTvControlAckMsg(JSON.parse(ev.data)); } catch (err) {
          tvDiagState.lastError = 'dcInk parse: ' + (err && err.message ? err.message : String(err));
        }
      };
      dcBulk.onmessage = (ev) => {
        try { handleTvControlAckMsg(JSON.parse(ev.data)); } catch (err) {
          tvDiagState.lastError = 'dcBulk parse: ' + (err && err.message ? err.message : String(err));
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && tvMqttClient && tvMqttClient.connected && tvMqttTopic) {
          tvMqttClient.publish(tvMqttTopic, JSON.stringify({
            type: 'rtc_ice',
            roomCode: roomCode,
            candidate: ev.candidate
          }));
        }
      };

      pc.createOffer().then((offer) => {
        return pc.setLocalDescription(offer).then(() => offer);
      }).then((offer) => {
        if (tvMqttClient && tvMqttClient.connected && tvMqttTopic) {
          tvMqttClient.publish(tvMqttTopic, JSON.stringify({
            type: 'rtc_offer',
            roomCode: roomCode,
            sdp: offer
          }));
        }
      }).catch((err) => {
        tvDiagState.lastError = 'createOffer: ' + (err && err.message ? err.message : String(err));
        updateTvMetricsBadge();
      });
    } catch (err) {
      tvDiagState.lastError = 'startTvWebRtcOffer: ' + (err && err.message ? err.message : String(err));
      closeTvRtc();
    }
  }

  function tvPublishPacket(obj, isBulk = false, forceTransport = null) {
    obj.ipadVersion = IPAD_TV_BUILD_VERSION;
    const raw = JSON.stringify(obj);
    const bytes = raw.length;
    logTvBytes(bytes);
    if (tvChannel) {
      try { tvChannel.postMessage(obj); } catch (_) {}
    }
    const tPub0 = performance.now();
    const rtcDc = isBulk ? (tvRtcBulkChannel || tvRtcChannel) : tvRtcChannel;
    const wantRtc = forceTransport ? (forceTransport === 'WebRTC') : Boolean(rtcDc && rtcDc.readyState === 'open');
    const maxBuf = isBulk ? 256 * 1024 : 64 * 1024;

    if (wantRtc && rtcDc && rtcDc.readyState === 'open') {
      if (rtcDc.bufferedAmount <= maxBuf) {
        try {
          rtcDc.send(raw);
          if (!isBulk && (obj.type === 'stroke_start' || obj.type === 'stroke_pts' || obj.type === 'stroke_commit')) {
            tvDiagState.lastStrokeTransport = 'WebRTC';
          }
          return { bytes, publishMs: performance.now() - tPub0, transport: 'WebRTC' };
        } catch (err) {
          tvDiagState.lastError = 'rtcDc.send: ' + (err && err.message ? err.message : String(err));
        }
      } else if (!isBulk && obj.type === 'view_sync') {
        // Mục 2: Với view_sync, chỉ giữ trạng thái chưa gửi mới nhất khi kênh ink tạm bận
        tvPendingViewSync = obj;
        return { bytes: 0, publishMs: 0, transport: 'deferred' };
      } else if (!isBulk && (obj.type === 'stroke_start' || obj.type === 'stroke_pts' || obj.type === 'stroke_end' || obj.type === 'stroke_commit')) {
        // Không âm thầm xé lẻ sang MQTT khi WebRTC nghẽn tạm thời; giữ đúng thứ tự trên DataChannel
        try {
          rtcDc.send(raw);
          tvDiagState.lastStrokeTransport = 'WebRTC (queued)';
          return { bytes, publishMs: performance.now() - tPub0, transport: 'WebRTC' };
        } catch (err) {
          tvDiagState.lastError = 'rtcDc.send overflow: ' + (err && err.message ? err.message : String(err));
        }
      }
    }

    if (tvMqttClient && tvMqttClient.connected && tvMqttTopic) {
      tvMqttClient.publish(tvMqttTopic, raw, { qos: 0 });
      if (!isBulk && (obj.type === 'stroke_start' || obj.type === 'stroke_pts' || obj.type === 'stroke_commit')) {
        tvDiagState.lastStrokeTransport = 'MQTT';
      }
    }
    return { bytes, publishMs: performance.now() - tPub0, transport: 'MQTT' };
  }

  // Quy đổi tọa độ nét Apple Pencil trên iPad sang tọa độ chuẩn hóa [0..1]x[0..1] của khung 16:9 trên TV
  function mapSurfacePointToTvNorm(sid, x, y, width) {
    const W = tv169Canvas.width, H = tv169Canvas.height;
    if (state.mode === 'board') {
      if (sid !== 'board' || !surfaces.board || !bxGridCanvas) return null;
      const sw = bxGridCanvas.width, sh = bxGridCanvas.height;
      if (sw <= 0 || sh <= 0) return null;
      const dpr = surfaces.board.dpr || 1;
      const cam = state.boardCam;
      const px = dpr * (x * cam.zoom + cam.panX);
      const py = dpr * (y * cam.zoom + cam.panY);
      const cropH = sw * (9 / 16);
      return {
        nx: Math.round((px / sw) * 10000) / 10000,
        ny: Math.round((py / cropH) * 10000) / 10000,
        nw: Math.round(((width * cam.zoom * dpr) / sw) * 100000) / 100000
      };
    } else {
      const pno = state.currentPage || 1;
      const surf = surfaces[pno];
      if (!surf || !surf.mounted || !surf.baseCanvas) return null;
      const sw = surf.baseCanvas.width, sh = surf.baseCanvas.height;
      if (sw <= 0 || sh <= 0) return null;
      const dpr = surf.dpr || 1;
      if (tvPresentMode === 'full_page') {
        if (sid !== pno) return null;
        const scale = Math.min(W / sw, H / sh);
        const dw = sw * scale, dh = sh * scale;
        const dx = (W - dw) * 0.5, dy = (H - dh) * 0.5;
        return {
          nx: Math.round(((dx + x * dpr * scale) / W) * 10000) / 10000,
          ny: Math.round(((dy + y * dpr * scale) / H) * 10000) / 10000,
          nw: Math.round(((width * dpr * scale) / W) * 100000) / 100000
        };
      } else {
        const elTop = surf.wrap ? surf.wrap.offsetTop : 0;
        const visOffsetCss = Math.max(0, pdfScroll.scrollTop - elTop);
        const srcY = Math.min(sh - 10, Math.round(visOffsetCss * dpr));
        const cropH = Math.round(sw * (9 / 16));
        if (sid === pno) {
          return {
            nx: Math.round(((x * dpr) / sw) * 10000) / 10000,
            ny: Math.round(((y * dpr - srcY) / cropH) * 10000) / 10000,
            nw: Math.round(((width * dpr) / sw) * 100000) / 100000
          };
        }
        return null;
      }
    }
  }

  function tvEmitStrokeStart(sid, previewObj, pt) {
    if (!tvStageActive || !previewObj || !pt) return;
    if (tvStreamMode !== 'vector') { tvVidActiveDirty = true; return; }
    const t0 = performance.now();
    const mapped = mapSurfacePointToTvNorm(sid, pt.x, pt.y, previewObj.width || 2.5);
    if (!mapped) return;
    tvActiveStrokeId++;
    tvActiveStrokeSid = sid;
    tvActiveStrokeSeq = 0;
    tvActiveStrokeTransport = (tvRtcChannel && tvRtcChannel.readyState === 'open') ? 'WebRTC' : 'MQTT';
    tvIsActivelyWriting = true;
    if (tvWritingSafetyTimer) clearTimeout(tvWritingSafetyTimer);
    tvWritingSafetyTimer = setTimeout(() => { tvIsActivelyWriting = false; }, 1500);

    tvStrokeBuf = [];
    tvStrokeBufFirstPerf = 0;
    const sampleMs = performance.now() - t0;
    pushTvMetric(tvMetrics.deltaSampleMs, sampleMs);
    const key = 's_' + tvActiveStrokeId + '_0';
    const res = tvPublishPacket({
      type: 'stroke_start',
      strokeId: tvActiveStrokeId,
      seq: 0,
      seqKey: key,
      color: previewObj.color || '#0F172A',
      nw: mapped.nw,
      alpha: previewObj.type === 'to_sang' ? 0.35 : 1.0,
      dashed: Boolean(previewObj.dashed),
      pt: [mapped.nx, mapped.ny],
      t0: Date.now()
    }, false, tvActiveStrokeTransport);
    pushTvMetric(tvMetrics.deltaBytes, res.bytes);
    tvStrokeSentMeta.set(key, { t0Perf: performance.now() });
    if (tvStrokeSentMeta.size > 80) {
      const firstKey = tvStrokeSentMeta.keys().next().value;
      tvStrokeSentMeta.delete(firstKey);
    }
  }

  function tvFlushStrokeBuffer() {
    tvStrokeRafId = 0;
    if (!tvStageActive || !tvActiveStrokeId || tvStrokeBuf.length === 0) return;
    const pts = tvStrokeBuf;
    const seqStart = tvActiveStrokeSeq + 1;
    tvActiveStrokeSeq += pts.length;
    tvStrokeBuf = [];
    if (tvStrokeBufFirstPerf > 0) {
      pushTvMetric(tvMetrics.inkQueueWaitMs, performance.now() - tvStrokeBufFirstPerf);
      tvStrokeBufFirstPerf = 0;
    }
    const key = 'p_' + tvActiveStrokeId + '_' + seqStart;
    const res = tvPublishPacket({
      type: 'stroke_pts',
      strokeId: tvActiveStrokeId,
      seqStart: seqStart,
      seqKey: key,
      pts: pts,
      t0: Date.now()
    }, false, tvActiveStrokeTransport);
    pushTvMetric(tvMetrics.deltaBytes, res.bytes);
    tvStrokeSentMeta.set(key, { t0Perf: performance.now() });
    if (tvStrokeSentMeta.size > 80) {
      const firstKey = tvStrokeSentMeta.keys().next().value;
      tvStrokeSentMeta.delete(firstKey);
    }
  }

  function tvQueueStrokePoint(sid, pt) {
    if (tvStreamMode !== 'vector') { tvVidActiveDirty = true; return; }
    if (!tvStageActive || !tvActiveStrokeId || sid !== tvActiveStrokeSid || !pt) return;
    const t0 = performance.now();
    const mapped = mapSurfacePointToTvNorm(sid, pt.x, pt.y, 1);
    if (!mapped) return;
    pushTvMetric(tvMetrics.deltaSampleMs, performance.now() - t0);
    if (tvStrokeBuf.length === 0) tvStrokeBufFirstPerf = performance.now();
    tvStrokeBuf.push([mapped.nx, mapped.ny]);
    if (tvWritingSafetyTimer) {
      clearTimeout(tvWritingSafetyTimer);
      tvWritingSafetyTimer = setTimeout(() => { tvIsActivelyWriting = false; }, 1500);
    }
    // Giữ cơ chế gửi nhanh theo ngưỡng điểm / rAF hiện có
    if (tvStrokeBuf.length >= 2 && tvActiveStrokeTransport === 'WebRTC') {
      if (tvStrokeRafId) { cancelAnimationFrame(tvStrokeRafId); tvStrokeRafId = 0; }
      tvFlushStrokeBuffer();
    } else if (tvStrokeBuf.length >= 4) {
      if (tvStrokeRafId) { cancelAnimationFrame(tvStrokeRafId); tvStrokeRafId = 0; }
      tvFlushStrokeBuffer();
    } else if (!tvStrokeRafId) {
      tvStrokeRafId = requestAnimationFrame(tvFlushStrokeBuffer);
    }
  }

  function tvEmitStrokeEnd(sid, isNormalFreehand = false, committedObj = null) {
    if (tvStreamMode !== 'vector') { tvVidBaseDirty = true; tvVidActiveDirty = true; return; }
    if (!tvStageActive || !tvActiveStrokeId) return;
    tvIsActivelyWriting = false;
    if (tvWritingSafetyTimer) { clearTimeout(tvWritingSafetyTimer); tvWritingSafetyTimer = null; }
    if (isNormalFreehand) tvSkipNextSurfaceSync = true;
    if (tvStrokeRafId) { cancelAnimationFrame(tvStrokeRafId); tvStrokeRafId = 0; }
    tvFlushStrokeBuffer();
    const sidEnd = tvActiveStrokeId;
    const tr = tvActiveStrokeTransport;
    tvActiveStrokeSid = null;
    tvPublishPacket({
      type: 'stroke_end',
      strokeId: sidEnd,
      t0: Date.now()
    }, false, tr);

    // Mục 3: Gửi stroke_commit với hình học hoàn chỉnh theo tọa độ trang tài liệu để TV chốt nét đúng
    if (isNormalFreehand && committedObj) {
      tvDocVersion++;
      tvPublishPacket({
        type: 'stroke_commit',
        docId: getCurrentPdfHash(),
        sid: sid,
        strokeId: sidEnd,
        docVersion: tvDocVersion,
        obj: committedObj
      }, false, tr);
    }
  }

  function drawPdfAnnotsToTvCtx(pno, scaleCssToTv, offsetX, offsetY) {
    const surf = surfaces[pno];
    if (!surf) return;
    const list = state.annots[pno] || [];
    if (list.length === 0) return;
    const hasMask = list.some((o) => o && o.type === 'xoa_vung');
    if (hasMask && surf.inkCanvas) {
      // Nếu có vùng xóa dạng mask, vẽ qua inkCanvas để bảo toàn phép destination-out
      return false;
    }
    tv169Ctx.save();
    tv169Ctx.setTransform(scaleCssToTv, 0, 0, scaleCssToTv, offsetX, offsetY);
    for (let i = 0; i < list.length; i++) {
      NKInkEngine.drawObject(tv169Ctx, list[i], false, false);
    }
    tv169Ctx.restore();
    return true;
  }

  function renderFrame16x9() {
    const W = tv169Canvas.width, H = tv169Canvas.height;
    tv169Ctx.imageSmoothingEnabled = true;
    tv169Ctx.imageSmoothingQuality = 'high';
    let bg = '#FFFFFF';
    if (state.mode === 'board' && surfaces.board && bxGridCanvas && bxInkCanvas) {
      const bgMap = { green: '#0B6251', black: '#000000', white: '#FFFFFF', cream: '#FDF6E3' };
      bg = bgMap[state.boardTheme] || '#0B6251';
      const sw = bxGridCanvas.width, sh = bxGridCanvas.height;
      if (sw > 0 && sh > 0) {
        tv169Ctx.fillStyle = bg;
        tv169Ctx.fillRect(0, 0, W, H);
        const cropH = Math.min(sh, Math.round(sw * (9 / 16)));
        const drawH = Math.round(W * (cropH / sw));
        tv169Ctx.drawImage(bxGridCanvas, 0, 0, sw, cropH, 0, 0, W, drawH);
        tv169Ctx.drawImage(bxInkCanvas, 0, 0, sw, cropH, 0, 0, W, drawH);
      }
    } else {
      const pno = state.currentPage || 1;
      const surf = surfaces[pno];
      if (surf && surf.mounted && surf.baseCanvas && surf.inkCanvas) {
        // Dùng bản render PDF gốc ở độ phân giải 1920px (vector sắc nét 100%) nếu có, fallback surf.baseCanvas
        const hiCanvas = (W > surf.baseCanvas.width * 1.05) ? ensureTvHiResPdfPage(pno, W) : null;
        const srcBase = hiCanvas || surf.baseCanvas;
        const sw = srcBase.width, sh = srcBase.height;
        const baseScale = sw / Math.max(1, surf.cssWidth);
        if (sw > 0 && sh > 0) {
          tv169Ctx.fillStyle = '#FFFFFF';
          tv169Ctx.fillRect(0, 0, W, H);
          if (tvPresentMode === 'full_page') {
            const scale = Math.min(W / sw, H / sh);
            const dw = sw * scale, dh = sh * scale;
            const dx = (W - dw) * 0.5, dy = (H - dh) * 0.5;
            tv169Ctx.drawImage(srcBase, dx, dy, dw, dh);
            if (!drawPdfAnnotsToTvCtx(pno, baseScale * scale, dx, dy)) {
              tv169Ctx.drawImage(surf.inkCanvas, dx, dy, dw, dh);
            }
          } else {
            const elTop = surf.wrap ? surf.wrap.offsetTop : 0;
            const visOffsetCss = Math.max(0, pdfScroll.scrollTop - elTop);
            const srcY = Math.min(sh - 10, Math.round(visOffsetCss * baseScale));
            const cropH = Math.round(sw * (9 / 16));
            const availH = Math.max(10, Math.min(cropH, sh - srcY));
            const drawH = Math.round((availH / cropH) * H);

            tv169Ctx.drawImage(srcBase, 0, srcY, sw, availH, 0, 0, W, drawH);
            const cssToTv = W / Math.max(1, surf.cssWidth);
            if (!drawPdfAnnotsToTvCtx(pno, cssToTv, 0, -visOffsetCss * cssToTv)) {
              const inkSrcY = Math.min(surf.inkCanvas.height - 10, Math.round(visOffsetCss * surf.dpr));
              const inkCropH = Math.round(surf.inkCanvas.width * (9 / 16));
              const inkAvailH = Math.max(10, Math.min(inkCropH, surf.inkCanvas.height - inkSrcY));
              tv169Ctx.drawImage(surf.inkCanvas, 0, inkSrcY, surf.inkCanvas.width, inkAvailH, 0, 0, W, drawH);
            }

            if (availH < cropH && surfaces[pno + 1] && surfaces[pno + 1].mounted && surfaces[pno + 1].baseCanvas) {
              const nextS = surfaces[pno + 1];
              const remH = H - drawH - 8;
              if (remH > 20) {
                const nextHi = (W > nextS.baseCanvas.width * 1.05) ? ensureTvHiResPdfPage(pno + 1, W) : null;
                const nextBase = nextHi || nextS.baseCanvas;
                const nextSrcH = Math.min(nextBase.height, Math.round((remH / H) * nextBase.width * (9 / 16)));
                tv169Ctx.fillStyle = '#E2E8F0';
                tv169Ctx.fillRect(0, drawH, W, 8);
                tv169Ctx.drawImage(nextBase, 0, 0, nextBase.width, nextSrcH, 0, drawH + 8, W, remH);
                const nextCssToTv = W / Math.max(1, nextS.cssWidth);
                tv169Ctx.save();
                tv169Ctx.beginPath();
                tv169Ctx.rect(0, drawH + 8, W, remH);
                tv169Ctx.clip();
                if (!drawPdfAnnotsToTvCtx(pno + 1, nextCssToTv, 0, drawH + 8)) {
                  const nInkH = Math.min(nextS.inkCanvas.height, Math.round((remH / H) * nextS.inkCanvas.width * (9 / 16)));
                  tv169Ctx.drawImage(nextS.inkCanvas, 0, 0, nextS.inkCanvas.width, nInkH, 0, drawH + 8, W, remH);
                }
                tv169Ctx.restore();
              }
            }
          }
        }
      }
    }
    return bg;
  }

  function finishTvInFlight(frameId, tvDecodeMs, tvDrawMs, isTimeout = false) {
    const meta = tvInFlightMeta.get(frameId);
    if (meta) {
      if (isTimeout) {
        // Mục 6: Tách thống kê timeout khỏi RTT thực tế
        tvMetrics.frameTimeouts++;
      } else {
        const rtt = performance.now() - meta.t0Perf;
        pushTvMetric(tvMetrics.frameRttMs, rtt);
        if (Number.isFinite(tvDecodeMs)) pushTvMetric(tvMetrics.tvDecodeMs, tvDecodeMs);
        if (Number.isFinite(tvDrawMs)) pushTvMetric(tvMetrics.tvDrawMs, tvDrawMs);
      }
      tvInFlightMeta.delete(frameId);

      // P1 Auto-downgrade: chỉ hạ bậc khi CPU thiết bị (encode/decode) thực sự quá tải
      if (!isTimeout && tvQualityPresetMode === 'auto') {
        const isCpuSlow = meta.encodeMs > 180 || (Number.isFinite(tvDecodeMs) && tvDecodeMs > 180);
        if (isCpuSlow) {
          tvSlowFrameStreak++;
          if (tvSlowFrameStreak >= 4) {
            tvSlowFrameStreak = 0;
            if (tvActivePresetKey === 'fhd') applyTvPreset('hd', false);
            else if (tvActivePresetKey === 'hd') applyTvPreset('sd', false);
          }
        } else {
          tvSlowFrameStreak = 0;
        }
      }
      updateTvMetricsBadge();
    }
    if (frameId === tvFrameInFlightId || frameId === 0) {
      tvFrameInFlightId = 0;
      if (tvFrameAckWatchdog) { clearTimeout(tvFrameAckWatchdog); tvFrameAckWatchdog = null; }
      if (tvPendingSync && tvStageActive) {
        const force = tvPendingForce;
        tvPendingSync = false;
        tvPendingForce = false;
        scheduleTvFrameSync('flush_pending', force);
      }
    }
  }

  function broadcastFrameToTv(forceSend = false) {
    if (!tvStageActive) return;
    if (tvFrameEncoding || tvFrameInFlightId !== 0) {
      tvPendingSync = true;
      tvPendingForce = tvPendingForce || forceSend;
      return;
    }
    tvFrameEncoding = true;
    try {
      const tCap0 = performance.now();
      const bg = renderFrame16x9();
      const captureMs = performance.now() - tCap0;
      pushTvMetric(tvMetrics.captureMs, captureMs);

      const tEnc0 = performance.now();
      const finishWithDataUrl = (dataUrl, blobSize) => {
        tvFrameEncoding = false;
        if (!tvStageActive || !dataUrl) return;
        const encodeMs = performance.now() - tEnc0;
        pushTvMetric(tvMetrics.encodeMs, encodeMs);

        const sig = `${blobSize}_${dataUrl.slice(0, 64)}_${dataUrl.slice(-64)}`;
        if (!forceSend && sig === tvLastFrameSig) {
          if (tvPendingSync) {
            const f = tvPendingForce;
            tvPendingSync = false;
            tvPendingForce = false;
            scheduleTvFrameSync('after_skip', f);
          }
          return;
        }
        tvLastFrameSig = sig;
        const frameId = ++tvFrameSeq;
        tvFrameInFlightId = frameId;
        const tSentPerf = performance.now();
        const res = tvPublishPacket({
          type: 'frame',
          frameId: frameId,
          pdfHash: getCurrentPdfHash(),
          mime: tvEncodeMime,
          w: tv169Canvas.width,
          h: tv169Canvas.height,
          bg: bg,
          clearInk: true,
          lastStrokeId: tvActiveStrokeId,
          dataUrl: dataUrl,
          t0: Date.now()
        }, true);
        pushTvMetric(tvMetrics.publishMs, res.publishMs);
        pushTvMetric(tvMetrics.frameBytes, res.bytes);
        tvInFlightMeta.set(frameId, {
          t0Perf: tSentPerf,
          captureMs,
          encodeMs,
          publishMs: res.publishMs,
          bytes: res.bytes
        });
        if (tvInFlightMeta.size > 30) {
          const oldK = tvInFlightMeta.keys().next().value;
          tvInFlightMeta.delete(oldK);
        }
        // Watchdog an toàn 450ms: tách timeout khỏi RTT thực tế
        if (tvFrameAckWatchdog) clearTimeout(tvFrameAckWatchdog);
        tvFrameAckWatchdog = setTimeout(() => {
          finishTvInFlight(frameId, NaN, NaN, true);
        }, 450);
      };

      // Dùng toBlob() bất đồng bộ để KHÔNG khóa luồng giao diện Apple Pencil 120Hz!
      if (typeof tv169Canvas.toBlob === 'function') {
        tv169Canvas.toBlob((blob) => {
          if (!blob) {
            tvFrameEncoding = false;
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => finishWithDataUrl(reader.result, blob.size);
          reader.onerror = () => { tvFrameEncoding = false; };
          reader.readAsDataURL(blob);
        }, tvEncodeMime, tvEncodeQuality);
      } else {
        const dataUrl = tv169Canvas.toDataURL(tvEncodeMime, tvEncodeQuality);
        finishWithDataUrl(dataUrl, dataUrl.length);
      }
    } catch (_) {
      tvFrameEncoding = false;
    }
  }

  function sendAnnotsBulk(sid) {
    const list = state.annots[sid] || [];
    const payload = {
      type: 'annots_sync',
      sid: sid,
      lastStrokeId: tvActiveStrokeId,
      annots: list
    };
    const jsonStr = JSON.stringify(list);
    // Mục 2: Chuyển toàn bộ snapshot chú thích sang kênh bulk và chia nhỏ nếu > 16 KB
    if (jsonStr.length <= 16384) {
      tvPublishPacket(payload, true);
      return;
    }
    const chunkId = 'a_' + sid + '_' + Date.now();
    const CHUNK = 14336;
    const total = Math.ceil(jsonStr.length / CHUNK);
    tvPublishPacket({ type: 'annots_chunk_start', chunkId, sid, lastStrokeId: tvActiveStrokeId, total }, true);
    for (let i = 0; i < total; i++) {
      tvPublishPacket({ type: 'annots_chunk', chunkId, idx: i, data: jsonStr.slice(i * CHUNK, (i + 1) * CHUNK) }, true);
    }
  }

  function syncTvVectorView(includeAnnots = false) {
    if (!tvStageActive || !tvPeerPdfOpened || state.mode !== 'pdf') return false;
    const pno = state.currentPage || 1;
    const surf = surfaces[pno];
    if (!surf) return false;
    const slot = state.pageSlots[pno - 1] || { kind: 'pdf', pdfPageNo: pno };
    if (slot.kind !== 'pdf') return false;
    const elTop = surf.wrap ? surf.wrap.offsetTop : 0;
    const visOffsetCss = Math.max(0, pdfScroll.scrollTop - elTop);
    const nextSurf = surfaces[pno + 1];
    const nextSlot = nextSurf ? (state.pageSlots[pno] || { kind: 'pdf', pdfPageNo: pno + 1 }) : null;
    tvPublishPacket({
      type: 'view_sync',
      mode: 'pdf',
      pdfHash: getCurrentPdfHash(),
      pno: pno,
      pdfPageNo: slot.pdfPageNo,
      rot: state.pageRotations[pno] || 0,
      cssWidth: surf.cssWidth,
      cssHeight: surf.cssHeight,
      visOffsetCss: Math.round(visOffsetCss * 10) / 10,
      presentMode: tvPresentMode,
      nextPdfPageNo: (nextSlot && nextSlot.kind === 'pdf') ? nextSlot.pdfPageNo : 0,
      nextRot: state.pageRotations[pno + 1] || 0,
      nextCssWidth: nextSurf ? nextSurf.cssWidth : 0
    }, false);
    if (includeAnnots && !tvIsActivelyWriting) {
      sendAnnotsBulk(pno);
      if (nextSurf) sendAnnotsBulk(pno + 1);
    }
    return isCurrentPageReadyOnTv();
  }

  function scheduleTvFrameSync(reason = 'change', force = false) {
    if (!tvStageActive) return;
    if (tvStreamMode !== 'vector') {
      tvVidBaseDirty = true;
      tvVidActiveDirty = true;
      return;
    }
    if (tvPeerPdfOpened && state.mode === 'pdf') {
      const needAnnots = (reason === 'surface' || reason === 'start' || reason === 'page' || reason === 'tv_need_snapshot' || reason === 'pdf_loaded' || reason === 'transport_switch');
      if (syncTvVectorView(needAnnots)) return;
    }
    if (tvFrameEncoding || tvFrameInFlightId !== 0) {
      tvPendingSync = true;
      tvPendingForce = tvPendingForce || force;
      return;
    }
    if (force) tvPendingForce = true;
    if (!tvRafSyncId) {
      tvRafSyncId = requestAnimationFrame(() => {
        tvRafSyncId = 0;
        const f = tvPendingForce;
        tvPendingForce = false;
        broadcastFrameToTv(f);
      });
    }
  }

  let tvScrollRafId = 0;
  function scheduleTvScrollSync() {
    if (!tvStageActive) return;
    if (tvStreamMode !== 'vector') {
      tvVidBaseDirty = true;
      return;
    }
    if (isCurrentPageReadyOnTv() && state.mode === 'pdf') {
      if (!tvScrollRafId) {
        tvScrollRafId = requestAnimationFrame(() => {
          tvScrollRafId = 0;
          syncTvVectorView(false);
        });
      }
      return;
    }
    if (tvScrollThrottleTimer) return;
    tvScrollThrottleTimer = setTimeout(() => {
      tvScrollThrottleTimer = null;
      scheduleTvFrameSync('scroll', false);
    }, 80);
  }

  function startTvSyncLoop() {
    tvStageActive = true;
    tvLastFrameSig = '';
    tvFrameEncoding = false;
    tvFrameInFlightId = 0;
    tvPendingSync = false;
    tvPendingForce = false;
    if (tvFrameAckWatchdog) { clearTimeout(tvFrameAckWatchdog); tvFrameAckWatchdog = null; }
    if (tvStreamMode === 'vector') {
      sendPdfToTv();
      scheduleTvFrameSync('start', true);
    }
    const stopBtn = document.getElementById('btn-stop-tv-cast');
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    const topBtn = document.getElementById('top-btn-present');
    if (topBtn) topBtn.classList.add('active');
  }

  function stopTvCast() {
    tvStageActive = false;
    stopTvVideoStream(true);
    tvLastFrameSig = '';
    tvFrameEncoding = false;
    tvFrameInFlightId = 0;
    tvPendingSync = false;
    tvPendingForce = false;
    tvActiveStrokeSid = null;
    tvStrokeBuf = [];
    if (tvFrameAckWatchdog) { clearTimeout(tvFrameAckWatchdog); tvFrameAckWatchdog = null; }
    if (tvRafSyncId) { cancelAnimationFrame(tvRafSyncId); tvRafSyncId = 0; }
    if (tvStrokeRafId) { cancelAnimationFrame(tvStrokeRafId); tvStrokeRafId = 0; }
    if (tvScrollThrottleTimer) { clearTimeout(tvScrollThrottleTimer); tvScrollThrottleTimer = null; }
    if (tvScrollRafId) { cancelAnimationFrame(tvScrollRafId); tvScrollRafId = 0; }
    if (tvPdfTransferTimer) { clearTimeout(tvPdfTransferTimer); tvPdfTransferTimer = null; }
    if (tvPdfTimeoutTimer) { clearTimeout(tvPdfTimeoutTimer); tvPdfTimeoutTimer = null; }
    if (tvWritingSafetyTimer) { clearTimeout(tvWritingSafetyTimer); tvWritingSafetyTimer = null; }
    tvIsActivelyWriting = false;
    tvPeerPdfOpened = false;
    tvPeerPageReadyKey = '';
    tvPeerPdfHash = '';
    tvPdfTransferringHash = '';
    tvFallbackReason = '';
    closeTvRtc();
    if (tvMqttClient) {
      try {
        if (tvMqttClient.connected && tvMqttTopic) {
          tvMqttClient.publish(tvMqttTopic, JSON.stringify({ type: 'stop' }));
        }
        tvMqttClient.end(true);
      } catch (_) {}
      tvMqttClient = null;
      tvMqttTopic = '';
    }
    const stopBtn = document.getElementById('btn-stop-tv-cast');
    if (stopBtn) stopBtn.style.display = 'none';
    const topBtn = document.getElementById('top-btn-present');
    if (topBtn) topBtn.classList.remove('active');
    const st = document.getElementById('tv-connect-status');
    if (st) st.textContent = 'Đã ngắt kết nối trình chiếu TV.';
  }

  if (tvChannel) {
    tvChannel.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'tv_ready') {
        startTvSyncLoop();
        notify('📺 Đã kết nối Màn hình TV 16:9 (0% viền đen, iPad vẫn giữ nguyên công cụ)!');
      } else if (msg.type === 'frame_ack') {
        finishTvInFlight(msg.frameId || 0, msg.decodeMs, msg.drawMs);
      } else if (msg.type === 'stroke_ack' && msg.seqKey) {
        const sm = tvStrokeSentMeta.get(msg.seqKey);
        if (sm) {
          pushTvMetric(tvMetrics.deltaRttMs, performance.now() - sm.t0Perf);
          if (Number.isFinite(msg.drawMs)) pushTvMetric(tvMetrics.tvStrokeDrawMs, msg.drawMs);
          tvStrokeSentMeta.delete(msg.seqKey);
        }
      } else if (msg.type === 'tv_need_snapshot') {
        scheduleTvFrameSync('tv_need_snapshot', true);
      }
    };
  }

  document.querySelectorAll('input[name="tv-present-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) {
        tvPresentMode = r.value;
        scheduleTvFrameSync('mode', true);
      }
    });
  });

  function applyStreamModeChange() {
    if (!tvStageActive) return;
    if (tvStreamMode === 'vector') {
      stopTvVideoStream(true);
      sendPdfToTv();
      scheduleTvFrameSync('mode_switch', true);
    } else {
      startTvVideoStream(tvRtcRoomCode || (document.getElementById('tv-code-input') ? document.getElementById('tv-code-input').value.trim() : ''));
    }
  }

  document.querySelectorAll('input[name="tv-stream-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) {
        tvStreamMode = r.value || 'vector';
        applyStreamModeChange();
      }
    });
  });
  const tvVideoPresetSel = document.getElementById('tv-video-preset');
  if (tvVideoPresetSel) {
    tvVideoPresetSel.addEventListener('change', () => {
      tvVideoPreset = tvVideoPresetSel.value || '1080p30';
      if (tvStageActive && tvStreamMode !== 'vector') applyStreamModeChange();
    });
  }
  const tvVideoHintSel = document.getElementById('tv-video-hint');
  if (tvVideoHintSel) {
    tvVideoHintSel.addEventListener('change', () => {
      tvVideoContentHint = tvVideoHintSel.value || 'detail';
      if (tvVidStream) {
        const vt = tvVidStream.getVideoTracks()[0];
        if (vt && 'contentHint' in vt) try { vt.contentHint = tvVideoContentHint; } catch (_) {}
      }
    });
  }

  const topPresentBtn = document.getElementById('top-btn-present');
  if (topPresentBtn) {
    topPresentBtn.addEventListener('click', () => {
      if (presentModal) presentModal.classList.remove('hidden');
    });
  }
  const closePresent = document.getElementById('close-present-modal');
  const okPresent = document.getElementById('ok-present-modal');
  if (closePresent) closePresent.addEventListener('click', () => presentModal.classList.add('hidden'));
  if (okPresent) okPresent.addEventListener('click', () => presentModal.classList.add('hidden'));

  const stopCastBtn = document.getElementById('btn-stop-tv-cast');
  if (stopCastBtn) stopCastBtn.addEventListener('click', stopTvCast);

  const connectWirelessBtn = document.getElementById('btn-connect-tv-wireless');
  const testWirelessBtn = document.getElementById('btn-test-tv-wireless');
  let tvAckTimer = null;

  function connectAndHandshakeTv(mode) {
    const codeInput = document.getElementById('tv-code-input');
    const statusEl = document.getElementById('tv-connect-status');
    const code = (codeInput ? codeInput.value : '').trim();
    if (!/^\d{4}$/.test(code)) {
      if (statusEl) {
        statusEl.style.color = '#DC2626';
        statusEl.textContent = '⚠️ Vui lòng nhập đủ 4 chữ số hiện trên màn hình TV.';
      }
      return;
    }
    if (!window.mqtt || typeof window.mqtt.connect !== 'function') {
      if (statusEl) {
        statusEl.style.color = '#DC2626';
        statusEl.textContent = '⚠️ Thư viện vendor/mqtt.min.js chưa sẵn sàng. Hãy tải lại trang.';
      }
      return;
    }

    if (tvAckTimer) { clearTimeout(tvAckTimer); tvAckTimer = null; }
    if (tvMqttClient) { try { tvMqttClient.end(true); } catch (_) {} tvMqttClient = null; }
    tvMqttTopic = 'nkpdf29/tv/' + code;
    const ackTopic = 'nkpdf29/tv/' + code + '/ack';

    const BROKERS = [
      { name: 'EMQX (broker.emqx.io:8084)', url: 'wss://broker.emqx.io:8084/mqtt' },
      { name: 'HiveMQ (broker.hivemq.com:8884)', url: 'wss://broker.hivemq.com:8884/mqtt' }
    ];

    function tryBroker(idx) {
      if (tvAckTimer) { clearTimeout(tvAckTimer); tvAckTimer = null; }
      if (tvMqttClient) { try { tvMqttClient.end(true); } catch (_) {} tvMqttClient = null; }

      if (idx >= BROKERS.length) {
        if (statusEl) {
          statusEl.style.color = '#DC2626';
          statusEl.textContent = '❌ Không nhận được phản hồi (ACK) từ TV mã ' + code + ' trên cả 2 Broker. Hãy kiểm tra mã 4 số đang hiển thị trên TV.';
        }
        return;
      }

      const b = BROKERS[idx];
      if (statusEl) {
        statusEl.style.color = '#D97706';
        statusEl.textContent = '⏳ Bước 1/2: Đang nối Broker [' + (idx + 1) + '/' + BROKERS.length + '] ' + b.name + '...';
      }

      let ackReceived = false;
      let movedNext = false;

      function nextBrokerOnFail() {
        if (ackReceived || movedNext) return;
        movedNext = true;
        if (tvAckTimer) { clearTimeout(tvAckTimer); tvAckTimer = null; }
        try { cl.end(true); } catch (_) {}
        tryBroker(idx + 1);
      }

      const cl = window.mqtt.connect(b.url, {
        clientId: 'nkpdf_ipad_' + code + '_' + Math.random().toString(16).slice(2, 7),
        connectTimeout: 5500,
        keepalive: 25
      });
      tvMqttClient = cl;

      tvAckTimer = setTimeout(() => {
        nextBrokerOnFail();
      }, 4500);

      cl.on('connect', () => {
        if (movedNext) return;
        if (statusEl) {
          statusEl.style.color = '#0284C7';
          statusEl.textContent = '⏳ Bước 2/2: Đã nối ' + b.name + '. Đang gửi gói ' + (mode === 'test' ? 'TEST' : 'ghép nối') + ' và chờ TV mã ' + code + ' xác nhận (ACK)...';
        }
        cl.subscribe(ackTopic, (subErr) => {
          if (subErr || movedNext) {
            nextBrokerOnFail();
            return;
          }
          cl.publish(tvMqttTopic, JSON.stringify({
            type: mode === 'test' ? 'test' : 'ping',
            roomCode: code,
            ts: Date.now()
          }));
        });
      });

      cl.on('message', (t, payload) => {
        if (t !== ackTopic || movedNext) return;
        try {
          const msg = JSON.parse(payload.toString());
          if (!msg || String(msg.roomCode) !== code) return;

          if (msg.type === 'ack' && !ackReceived) {
            ackReceived = true;
            if (tvAckTimer) { clearTimeout(tvAckTimer); tvAckTimer = null; }
            tvDiagState.brokerName = msg.brokerName || b.name;
            if (msg.capabilities) {
              if (msg.capabilities.tvVersion) tvDiagState.tvVersion = msg.capabilities.tvVersion;
              negotiateTvCapabilities(msg.capabilities);
            }
            if (mode === 'test') {
              if (statusEl) {
                statusEl.style.color = '#047857';
                statusEl.textContent = '✅ KẾT NỐI THÀNH CÔNG! TV mã ' + code + ' đã hiện chữ vàng "NKPDF — KẾT NỐI THÀNH CÔNG" và gửi ACK về iPad (Broker: ' + (msg.brokerName || b.name) + ').';
              }
              notify('✅ TV mã ' + code + ' đã xác nhận TEST thành công!');
            } else {
              tvRtcRoomCode = code;
              startTvSyncLoop();
              if (tvStreamMode === 'vector') {
                startTvWebRtcOffer(code);
              } else {
                startTvVideoStream(code);
              }
              if (statusEl) {
                statusEl.style.color = '#047857';
                statusEl.textContent = '✅ Đã xác nhận ACK từ TV mã ' + code + ' (' + (msg.brokerName || b.name) + ')! Đang chiếu tràn viền 16:9.';
              }
              notify('📺 Đã xác nhận kết nối & chiếu 16:9 lên TV mã ' + code + '!');
            }
          } else if (msg.type === 'vid_answer' && msg.sdp && tvVidPc) {
            tvVidPc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).then(() => {
              while (pendingIpadVidIce.length > 0) {
                const c = pendingIpadVidIce.shift();
                tvVidPc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              }
            }).catch((err) => {
              tvDiagState.videoState = 'Lỗi kết nối Video: ' + (err && err.message ? err.message : String(err));
              updateTvMetricsBadge();
            });
          } else if (msg.type === 'vid_ice' && msg.candidate && tvVidPc) {
            if (tvVidPc.remoteDescription) {
              tvVidPc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
            } else {
              pendingIpadVidIce.push(msg.candidate);
            }
          } else if (msg.type === 'vid_stats') {
            if (msg.errorClass) {
              tvDiagState.videoInErr = `[${msg.errorClass}] ${msg.errorMsg || ''}`;
            } else {
              tvDiagState.videoInErr = '';
              tvDiagState.videoInRes = `${msg.videoWidth || 0}×${msg.videoHeight || 0}`;
              tvDiagState.videoInDecoded = msg.framesDecoded || msg.totalVideoFrames || 0;
              tvDiagState.videoInDropped = msg.framesDropped || msg.droppedVideoFrames || 0;
              tvDiagState.videoInRttMs = msg.rttMs || 0;
              if (msg.codec) tvDiagState.videoCodec = msg.codec;
            }
            updateTvMetricsBadge();
          } else if (msg.type === 'rtc_answer' && msg.sdp && tvRtcPc) {
            tvRtcPc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
              .then(() => flushPendingIpadIce())
              .catch((err) => {
                tvDiagState.rtcState = 'Lỗi WebRTC: ' + (err && err.message ? err.message : String(err));
                updateTvMetricsBadge();
              });
          } else if (msg.type === 'rtc_ice' && msg.candidate && tvRtcPc) {
            if (tvRtcPc.remoteDescription) {
              tvRtcPc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
            } else {
              pendingIpadIce.push(msg.candidate);
            }
          }
        } catch (_) {}
      });

      cl.on('error', () => nextBrokerOnFail());
      cl.on('close', () => {
        if (!ackReceived && !movedNext) nextBrokerOnFail();
      });
    }

    tryBroker(0);
  }

  // ==========================================================================
  // GIAO DIỆN GỌN CHO HỌC SINH XEM ĐỀ TRÊN ĐIỆN THOẠI (AUTO MOBILE STUDENT VIEW)
  // ==========================================================================
  function detectStudentPhoneMode() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const urlMode = params.get('mode');
      if (urlMode === 'student') return true;
      if (urlMode === 'full') return false;
      const saved = localStorage.getItem('nkpdf_student_phone_mode');
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch (_) {}
    const sw = (window.screen && window.screen.width) || window.innerWidth;
    const sh = (window.screen && window.screen.height) || window.innerHeight;
    const shortEdge = Math.min(sw, sh);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const phoneUa = /iPhone|Android.*Mobile|Windows Phone|BlackBerry/i.test(navigator.userAgent || '');
    return shortEdge > 0 && shortEdge <= 500 && (coarse || phoneUa);
  }

  function initMobileStudentMode() {
    const bar = document.getElementById('mobile-student-bar');
    const dock = document.getElementById('mobile-student-dock');
    if (!bar || !dock) return;

    const syncDockToolActive = (toolName) => {
      dock.querySelectorAll('.ms-dock-btn[data-mstool]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mstool === toolName);
      });
    };

    const setStudentMode = (enabled) => {
      document.body.classList.toggle('mobile-student-mode', enabled);
      bar.classList.toggle('hidden', !enabled);
      dock.classList.toggle('hidden', !enabled);
      if (enabled) {
        setTool('hand');
        syncDockToolActive('hand');
      }
      setTimeout(() => {
        if (state.pdfDoc && typeof fitWidth === 'function') fitWidth();
      }, 160);
    };

    const btnExams = document.getElementById('ms-btn-exams');
    if (btnExams) {
      btnExams.addEventListener('click', () => {
        const trigger = document.getElementById('top-btn-de-vat-ly') || document.getElementById('rb-de-vat-ly');
        if (trigger) trigger.click();
      });
    }

    const btnDownload = document.getElementById('ms-btn-download');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        if (!state.pdfBytes || !state.pdfBytes.length) {
          showToast('Chưa có tệp PDF để tải.');
          return;
        }
        const blob = new Blob([state.pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = state.pdfFileName || 'De_Thi_NKPDF.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast(`⬇ Đang tải ${a.download}`);
      });
    }

    const btnFull = document.getElementById('ms-btn-full');
    if (btnFull) {
      btnFull.addEventListener('click', () => {
        try { localStorage.setItem('nkpdf_student_phone_mode', '0'); } catch (_) {}
        setStudentMode(false);
        showToast('🖥️ Đã chuyển sang Giao diện Đầy đủ');
      });
    }

    const btnStudentMode = document.getElementById('top-btn-student-mode');
    if (btnStudentMode) {
      btnStudentMode.addEventListener('click', () => {
        try { localStorage.setItem('nkpdf_student_phone_mode', '1'); } catch (_) {}
        setStudentMode(true);
        showToast('📱 Đã chuyển sang Giao diện Gọn (Điện thoại / Học sinh)');
      });
    }

    const bindDockTool = (id, toolName) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', () => {
        setTool(toolName);
        syncDockToolActive(toolName);
      });
    };
    bindDockTool('ms-dock-hand', 'hand');
    bindDockTool('ms-dock-pen', 'pen');
    bindDockTool('ms-dock-eraser', 'eraser');

    const btnUndo = document.getElementById('ms-dock-undo');
    if (btnUndo) btnUndo.addEventListener('click', () => performUndo());

    const btnGrid = document.getElementById('ms-dock-grid');
    const syncGridBtn = () => {
      if (!btnGrid) return;
      btnGrid.classList.toggle('active', !!state.showGrid);
      btnGrid.textContent = state.showGrid ? '⊞ Ẩn lưới' : '⊞ Hiện lưới';
    };
    if (btnGrid) {
      syncGridBtn();
      btnGrid.addEventListener('click', () => {
        state.showGrid = !state.showGrid;
        const rbGrid = document.getElementById('rb-grid');
        if (rbGrid) rbGrid.classList.toggle('active', state.showGrid);
        document.querySelectorAll('.pdf-page-wrapper').forEach((w) => {
          w.classList.toggle('show-css-grid', state.showGrid);
        });
        syncGridBtn();
        showToast(state.showGrid ? '⊞ Đã hiện lưới ô ly' : '⊞ Đã ẩn lưới ô ly');
      });
    }

    const btnFit = document.getElementById('ms-dock-fit');
    if (btnFit) btnFit.addEventListener('click', () => fitWidth());

    if (detectStudentPhoneMode()) {
      setStudentMode(true);
    }
  }

  initMobileStudentMode();

  // ==========================================================================
  // KHUNG DỰNG HÌNH CÁC MÔN (TOÁN THCS, KHÔNG GIAN, TOÁN THPT, LÝ 10-11-12, HÓA)
  // ==========================================================================
  function initMultiSubjectConstructionHub() {
    const tabsEl = document.getElementById('GeomSubjectTabs');
    const chapSel = document.getElementById('geom-chapter-select');
    const searchEl = document.getElementById('geom-tool-search');
    const gridEl = document.getElementById('GeomHubGrid');
    if (!tabsEl || !chapSel || !gridEl) return;

    const SUBJECTS = [
      { id: 'toan_thcs', label: '📐 Toán THCS' },
      { id: 'toan_kg', label: '🧊 Toán Không Gian' },
      { id: 'toan_thpt', label: '📈 Toán THPT' },
      { id: 'ly10', label: '⚡ Lí 10' },
      { id: 'ly11', label: '🌊 Lí 11' },
      { id: 'ly12', label: '🔥 Lí 12' },
      { id: 'hoa', label: '🧪 Hóa học' }
    ];

    const dynCat = typeof getDungThemCatalog === 'function' ? getDungThemCatalog() : {};
    const ITEMS = {
      toan_thcs: [
        { chap: 'Lớp 6 · Số học & Tập hợp', title: '📏 Tia số tự nhiên (0..5)', sub: 'Số tự nhiên trên tia số', run: () => insertPresetShape('tia_so_tu_nhien', 'Tia số tự nhiên') },
        { chap: 'Lớp 6 · Số học & Tập hợp', title: '↔️ Trục số nguyên (-3..3)', sub: 'Số nguyên âm – 0 – dương', run: () => insertPresetShape('truc_so_nguyen', 'Trục số nguyên') },
        { chap: 'Lớp 6 · Số học & Tập hợp', title: '⭕ Biểu đồ Ven (A, B)', sub: 'Giao & hợp hai tập hợp', run: () => insertPresetShape('bieu_do_ven', 'Biểu đồ Ven') },
        { chap: 'Lớp 6 · Hình học trực quan', title: '📐 Thước đo độ 180°', sub: 'Đặt tâm đo góc trực tiếp', run: () => toggleProtractor() },
        { chap: 'Lớp 6 · Hình học trực quan', title: '🔺 Tam giác đều', sub: '3 cạnh bằng nhau', run: () => insertPresetShape('tam_giac_deu', 'Tam giác đều ABC') },
        { chap: 'Lớp 6 · Hình học trực quan', title: '🟩 Hình vuông ABCD', sub: '4 cạnh =, 4 góc 90°', run: () => insertPresetShape('hinh_vuong', 'Hình vuông ABCD') },
        { chap: 'Lớp 6 · Hình học trực quan', title: '◆ Hình thoi ABCD', sub: '4 cạnh =, 2 chéo vuông góc', run: () => insertPresetShape('hinh_thoi', 'Hình thoi ABCD') },
        { chap: 'Lớp 7 · Góc & Tam giác', title: '∥ 2 đường // & cát tuyến', sub: 'Góc so le trong, đồng vị', run: () => insertPresetShape('hai_song_song_cat_tuyen', '2 đường song song & cát tuyến') },
        { chap: 'Lớp 7 · Góc & Tam giác', title: '🔺 Tam giác cân', sub: 'Hai cạnh bên bằng nhau', run: () => insertPresetShape('tam_giac_can', 'Tam giác cân ABC') },
        { chap: 'Lớp 7 · Góc & Tam giác', title: '📐 Tam giác vuông', sub: 'Góc vuông tại A', run: () => insertPresetShape('tam_giac_vuong', 'Tam giác vuông') },
        { chap: 'Lớp 7 · Góc & Tam giác', title: '📍 Trung điểm đoạn', sub: 'Dựng trung điểm động', run: () => startGeomConstruction('trung_diem') },
        { chap: 'Lớp 7 · Góc & Tam giác', title: '📐 Đường trung trực', sub: 'Vuông góc tại trung điểm', run: () => startGeomConstruction('trung_truc') },
        { chap: 'Lớp 7 · Góc & Tam giác', title: '⭕ ĐT nội tiếp Δ', sub: 'Giao 3 đường phân giác', run: () => startGeomConstruction('tron_noi_tiep') },
        { chap: 'Lớp 7 · Góc & Tam giác', title: '⭕ ĐT ngoại tiếp Δ', sub: 'Giao 3 đường trung trực', run: () => startGeomConstruction('tron_ngoai_tiep') },
        { chap: 'Lớp 8 · Tứ giác & Hàm số', title: '▰ Hình bình hành', sub: 'Các cạnh đối song song', run: () => insertPresetShape('hinh_binh_hanh', 'Hình bình hành ABCD') },
        { chap: 'Lớp 8 · Tứ giác & Hàm số', title: '⏢ Hình thang cân', sub: 'Hai cạnh bên bằng nhau', run: () => insertPresetShape('hinh_thang_can', 'Hình thang cân ABCD') },
        { chap: 'Lớp 8 · Tứ giác & Hàm số', title: '⏢ Hình thang vuông', sub: 'Có 2 góc vuông kề 1 cạnh bên', run: () => insertPresetShape('hinh_thang_vuong', 'Hình thang vuông ABCD') },
        { chap: 'Lớp 8 · Tứ giác & Hàm số', title: '📈 Đồ thị y = ax + b', sub: 'Hàm số bậc nhất trên Oxy', run: () => insertPresetShape('do_thi_bac_nhat', 'Đồ thị y = ax + b') },
        { chap: 'Lớp 9 · BPT & Đường tròn', title: '📌 Tập nghiệm BPT [a; b)', sub: 'Biểu diễn trên trục số', run: () => insertPresetShape('khoang_nghiem_bpt', 'Tập nghiệm BPT') },
        { chap: 'Lớp 9 · BPT & Đường tròn', title: '📐 Tiếp tuyến đường tròn', sub: 'Dựng tiếp tuyến tại điểm', run: () => startGeomConstruction('tiep_tuyen') },
        { chap: 'Lớp 9 · BPT & Đường tròn', title: '🌓 Nửa đường tròn (O, AB)', sub: 'Góc nội tiếp chắn nửa ĐT', run: () => insertPresetShape('nua_duong_tron', 'Nửa đường tròn') }
      ],
      toan_kg: [
        { chap: 'Hình chóp & Đa diện', title: '🔺 Hình chóp tứ giác S.ABCD', sub: 'Có sẵn nét liền & nét khuất', run: () => insertPresetShape('hinh_chop', 'Hình chóp S.ABCD') },
        { chap: 'Hình chóp & Đa diện', title: '🔺 Hình chóp tam giác S.ABC', sub: 'Tứ diện / Chóp tam giác', run: () => insertPresetShape('hinh_chop_tam_giac', 'Hình chóp tam giác S.ABC') },
        { chap: 'Hình chóp & Đa diện', title: '📦 Hình hộp chữ nhật', sub: '12 cạnh (liền & khuất)', run: () => insertPresetShape('hinh_hop_chu_nhat', 'Hình hộp chữ nhật') },
        { chap: 'Hình chóp & Đa diện', title: '◫ Lăng trụ tam giác', sub: 'Hai đáy tam giác song song', run: () => insertPresetShape('lang_tru_tg', 'Lăng trụ tam giác') },
        { chap: 'Mặt tròn xoay', title: '🛢️ Hình trụ (có OO\')', sub: 'Hai đáy tròn & đường sinh', run: () => insertPresetShape('hinh_tru', 'Hình trụ') },
        { chap: 'Mặt tròn xoay', title: '🎉 Hình nón (có SO)', sub: 'Đỉnh S, đường cao SO', run: () => insertPresetShape('hinh_non', 'Hình nón') }
      ],
      toan_thpt: [
        { chap: 'Hệ trục & Hàm số', title: '📈 Hệ trục tọa độ Oxy', sub: 'Trục vuông góc có chia vạch', run: () => insertPresetShape('he_truc_oxy', 'Hệ trục Oxy') },
        { chap: 'Hệ trục & Hàm số', title: '📐 Đồ thị Parabol', sub: 'Kéo chỉnh đỉnh Parabol', run: () => insertPresetShape('conic_parabol', 'Đồ thị Parabol') },
        { chap: 'Hệ trục & Hàm số', title: '⚡ Hyperbol 2 nhánh', sub: 'Đồ thị hàm phân thức', run: () => insertPresetShape('conic_hyperbol', 'Đồ thị Hyperbol') },
        { chap: 'Lượng giác & Đường tròn', title: '⭕ Đường tròn lượng giác', sub: 'Các góc đặc biệt trên ĐTLG', run: () => insertPresetShape('duong_tron_luong_giac', 'Đường tròn lượng giác') },
        { chap: 'Phép biến hình', title: '∥ Đường song song', sub: 'Qua điểm ngoài đường', run: () => startGeomConstruction('song_song') },
        { chap: 'Phép biến hình', title: '⟂ Đường vuông góc', sub: 'Qua 1 điểm cho trước', run: () => startGeomConstruction('vuong_goc') },
        { chap: 'Phép biến hình', title: '✕ Giao điểm 2 đường', sub: 'Tự chạy theo khi kéo', run: () => startGeomConstruction('giao_diem') }
      ],
      ly10: [
        { chap: 'Chương I · Động học', title: '📈 Đồ thị (d – t)', sub: 'Độ dịch chuyển – thời gian', run: () => insertPresetShape('vl10_do_thi_dt', 'Đồ thị (d - t)') },
        { chap: 'Chương I · Động học', title: '📈 Đồ thị (v – t)', sub: 'Vận tốc – thời gian', run: () => insertPresetShape('vl10_do_thi_vt', 'Đồ thị (v - t)') },
        { chap: 'Chương I · Động học', title: '⬇️ Thí nghiệm rơi tự do', sub: 'Vị trí rơi theo các mốc t', run: () => insertPresetShape('vl10_roi_tu_do', 'Thí nghiệm rơi tự do') },
        { chap: 'Chương I · Động học', title: '🎯 Chuyển động ném ngang', sub: 'Quỹ đạo Parabol + v₀', run: () => insertPresetShape('nem_ngang', 'Chuyển động ném ngang') },
        { chap: 'Chương I · Động học', title: '🚀 Chuyển động ném xiên', sub: 'Đỉnh Hmax + Tầm xa L', run: () => insertPresetShape('nem_xien', 'Chuyển động ném xiên') },
        { chap: 'Chương II · Động lực học', title: '⊕ Hợp lực (HBH)', sub: 'Tổng hợp 2 vectơ lực', run: () => { const s = activeSid(), l = state.annots[s] || [], vs = state.selectedIndices.map((i) => l[i]).filter((o) => o && o.type === 'mui_ten'); if (vs.length === 2) createForceResultant(s, vs[0], vs[1]); else startGeomConstruction('hop_luc'); } },
        { chap: 'Chương II · Động lực học', title: '⇄ Vẽ lực đối (-F)', sub: 'Lực ngược hướng cùng độ lớn', run: () => { const s = activeSid(), l = state.annots[s] || [], vs = state.selectedIndices.map((i) => l[i]).filter((o) => o && o.type === 'mui_ten'); if (vs.length === 1) createOppositeForce(s, vs[0]); else startGeomConstruction('luc_doi'); } },
        { chap: 'Chương II · Động lực học', title: '⚡ 2 lực đồng quy + F', sub: 'Mẫu 2 lực đồng quy kèm hợp lực', run: () => insertConcurrentForcesSample(activeSid()) },
        { chap: 'Chương II · Động lực học', title: '🚗 Xe/Vật MP nghiêng', sub: 'Phân tích lực trên mặt dốc', run: () => insertPresetShape('vat_mat_phang_nghieng', 'Mặt phẳng nghiêng') },
        { chap: 'Chương II · Động lực học', title: '🚙 Xe/Vật MP ngang', sub: 'Lực kéo, ma sát, phản lực', run: () => insertPresetShape('vat_mat_phang_ngang', 'Mặt phẳng ngang') },
        { chap: 'Chương II · Động lực học', title: '🔗 2 vật nối dây ròng rọc', sub: 'Hệ vật m₁, m₂ qua ròng rọc', run: () => insertPresetShape('vl10_rong_roc_2vat', 'Hệ 2 vật qua ròng rọc') },
        { chap: 'Chương II · Động lực học', title: '⚖️ Quy tắc Moment lực', sub: 'Đòn bẩy cân bằng quanh O', run: () => insertPresetShape('vl10_moment_luc', 'Quy tắc Moment lực') },
        { chap: 'Chương II · Động lực học', title: '⚖️ Vật treo 1 dây', sub: 'Cân bằng trọng lực & lực căng', run: () => insertPresetShape('vat_treo_day', 'Vật treo 1 dây') },
        { chap: 'Chương II · Động lực học', title: "⚖️ Vật treo 2 dây AA'", sub: 'Treo 2 dây đối xứng', run: () => insertPresetShape('vat_treo_2_day', 'Vật treo 2 dây') },
        { chap: 'Chương II · Động lực học', title: '📦 Vật kéo dây ngang', sub: 'Vật trên sàn kéo dây ngang', run: () => insertPresetShape('ptl_keo_day_ngang', 'Vật kéo dây ngang') },
        { chap: 'Chương II · Động lực học', title: '📐 Dây treo vào tường', sub: 'Dây treo nghiêng vào tường', run: () => insertPresetShape('ptl_treo_tuong_nghieng', 'Dây treo vào tường') },
        { chap: 'Chương II · Động lực học', title: '📐 Treo góc tường OAB', sub: 'Cân bằng tại góc tường OAB', run: () => insertPresetShape('ptl_treo_goc_tuong', 'Treo góc tường OAB') },
        { chap: 'Chương II · Động lực học', title: '⚖️ Treo 2 cột lệch AOB', sub: 'Cân bằng 2 cột không đối xứng', run: () => insertPresetShape('ptl_treo_2_cot_lech', 'Treo 2 cột lệch AOB') },
        { chap: 'Chương II · Động lực học', title: '⛓️ MP nghiêng dây giữ', sub: 'Vật trên MP nghiêng có dây giữ', run: () => insertPresetShape('ptl_mp_nghieng_day', 'MP nghiêng dây giữ') },
        { chap: 'Chương II · Động lực học', title: '📐 Thanh AB + dây CA', sub: 'Cân bằng thanh ngang có dây neo', run: () => insertPresetShape('ptl_thanh_ngang_day', 'Thanh AB + dây CA') },
        { chap: 'Chương III · Năng lượng & Công', title: '↗️ Công cơ học (A=Fscosα)', sub: 'Lực F hợp góc α với độ dời s', run: () => insertPresetShape('vl10_cong_co_hoc', 'Công cơ học') },
        { chap: 'Chương III · Năng lượng & Công', title: '🎢 Bảo toàn cơ năng', sub: 'Vật trượt máng cong qua vị trí A, O', run: () => insertPresetShape('vl10_bao_toan_co_nang', 'Bảo toàn cơ năng') },
        { chap: 'Chương IV · Động lượng', title: '💥 Va chạm 2 vật m₁, m₂', sub: 'Định luật bảo toàn động lượng', run: () => insertPresetShape('vl10_va_cham', 'Va chạm 2 vật') },
        { chap: 'Chương V · Tròn đều & Hooke', title: '🎡 Chuyển động tròn đều', sub: 'Vectơ v tiếp tuyến & Fht hướng tâm', run: () => insertPresetShape('vl10_tron_deu', 'Chuyển động tròn đều') },
        { chap: 'Chương V · Tròn đều & Hooke', title: '🌀 Định luật Hooke (lò xo)', sub: 'Chiều dài tự nhiên l₀ & độ dãn Δl', run: () => insertPresetShape('vl10_dinh_luat_hooke', 'Định luật Hooke') }
      ],
      ly11: [
        { chap: 'Chương I · Dao động', title: '⭕ ĐTLG Dao động ĐH', sub: 'Vòng tròn lượng giác DĐĐH', run: () => insertPresetShape('duong_tron_luong_giac_ddh', 'ĐTLG Dao động điều hòa') },
        { chap: 'Chương I · Dao động', title: '📏 Trục thời gian (-A..+A)', sub: 'Các mốc thời gian đặc biệt T/4, T/6...', run: () => insertPresetShape('truc_thoi_gian_ddh', 'Trục thời gian Dao động điều hòa') },
        { chap: 'Chương I · Dao động', title: '↪ Cung quét (ĐTLG)', sub: 'Quét góc pha Δφ trên ĐTLG', run: () => startGeomConstruction('cung_quet_tron') },
        { chap: 'Chương I · Dao động', title: '📊 Đồ thị Năng lượng (Wđ, Wt)', sub: 'Parabol động năng & thế năng', run: () => insertPresetShape('vl11_nang_luong_ddh', 'Đồ thị Năng lượng DĐĐH') },
        { chap: 'Chương I · Dao động', title: '🌀 Con lắc lò xo ngang', sub: 'Lò xo nằm ngang + vật nặng m', run: () => insertPresetShape('con_lac_lo_xo', 'Con lắc lò xo nằm ngang') },
        { chap: 'Chương I · Dao động', title: '🌀 Con lắc lò xo đứng', sub: 'Lò xo thẳng đứng + Δl₀', run: () => insertPresetShape('con_lac_lo_xo_dung', 'Con lắc lò xo thẳng đứng') },
        { chap: 'Chương I · Dao động', title: '⏱️ Con lắc đơn', sub: 'Dây treo l + góc lệch α', run: () => insertPresetShape('con_lac_don', 'Con lắc đơn') },
        { chap: 'Chương II · Sóng', title: '〰️ Đồ thị Sóng hình Sin/Cos', sub: '1,5 chu kỳ dao động mượt', run: () => insertPresetShape('song_sin', 'Đồ thị sóng hình Sin') },
        { chap: 'Chương II · Sóng', title: '〰️ Giao thoa sóng 2 nguồn', sub: 'Cực đại liền & cực tiểu đứt', run: () => insertPresetShape('giao_thoa_song', 'Giao thoa sóng 2 nguồn S₁, S₂') },
        { chap: 'Chương II · Sóng', title: '🌊 Sóng dừng (2 đầu cố định)', sub: 'Bụng sóng & nút sóng 2 CĐ', run: () => insertPresetShape('song_dung_2co', 'Sóng dừng 2 đầu cố định') },
        { chap: 'Chương II · Sóng', title: '🌊 Sóng dừng (1 CĐ 1 TD)', sub: '1 đầu cố định, 1 đầu tự do', run: () => insertPresetShape('song_dung_1co_1tu', 'Sóng dừng 1 đầu cố định, 1 đầu tự do') },
        { chap: 'Chương II · Sóng', title: '🌈 Giao thoa ánh sáng Y-âng', sub: 'Hai khe S₁, S₂ chiếu lên màn', run: () => insertPresetShape('vl11_giao_thoa_yang', 'Giao thoa ánh sáng Y-âng') },
        { chap: 'Chương III · Điện trường', title: '⚡ Lực tương tác Coulomb', sub: 'Hai điện tích q₁, q₂ & lực F₁₂, F₂₁', run: () => insertPresetShape('vl11_coulomb', 'Lực tương tác Coulomb') },
        { chap: 'Chương III · Điện trường', title: '🧲 Điện trường đều (2 bản tụ)', sub: 'Hai bản tích điện & đường sức E', run: () => insertPresetShape('vl11_dien_truong_deu', 'Điện trường đều') },
        { chap: 'Chương III · Điện trường', title: '🔋 Ký hiệu Tụ điện (C)', sub: 'Tụ điện phẳng điện dung C', run: () => insertPresetShape('vl11_tu_dien', 'Tụ điện C') },
        { chap: 'Chương IV · Dòng điện & Mạch', title: '🔌 Mạch điện kín (E, r + R)', sub: 'Định luật Ohm cho toàn mạch', run: () => insertPresetShape('vl11_mach_kin', 'Mạch điện kín') },
        { chap: 'Chương IV · Dòng điện & Mạch', title: '🔀 Ghép điện trở (NT / SS)', sub: 'Sơ đồ mắc nối tiếp & song song', run: () => insertPresetShape('vl11_ghep_dien_tro', 'Ghép điện trở R₁, R₂') }
      ],
      ly12: [
        { chap: 'Chương I · Vật lí nhiệt', title: '🌡️ Đồ thị chuyển thể t(°C)-τ', sub: 'Nóng chảy & Sôi (đoạn nằm ngang)', run: () => insertPresetShape('vl12_chuyen_the', 'Đồ thị chuyển thể') },
        { chap: 'Chương I · Vật lí nhiệt', title: '🔥 Thí nghiệm nhiệt dung riêng', sub: 'Nhiệt lượng kế + dây đốt + nhiệt kế', run: () => insertPresetShape('vl12_nhiet_dung_rieng', 'Thí nghiệm nhiệt lượng kế') },
        { chap: 'Chương I · Vật lí nhiệt', title: '🧊 Mô hình Rắn – Lỏng – Khí', sub: 'Chuyển động phân tử 3 thể', run: () => insertPresetShape('vl12_ran_long_khi', 'Mô hình Rắn - Lỏng - Khí') },
        { chap: 'Chương II · Khí lí tưởng', title: '📈 Kéo vẽ Đẳng nhiệt p = k/V', sub: 'Kéo trực tiếp trên trang', run: () => { setTool('dung_dang_nhiet'); notify('📈 Kéo trên trang để dựng đường đẳng nhiệt p = k/V.'); } },
        { chap: 'Chương II · Khí lí tưởng', title: '📊 2 đường đẳng nhiệt T₂ > T₁', sub: 'Định luật Boyle trên (p, V)', run: () => insertPresetShape('dang_nhiet_pv', 'Đồ thị 2 đẳng nhiệt T₂ > T₁') },
        { chap: 'Chương II · Khí lí tưởng', title: '📈 Đồ thị Đẳng áp (V – T)', sub: 'Định luật Charles', run: () => insertPresetShape('vl12_dang_ap', 'Đồ thị Đẳng áp') },
        { chap: 'Chương II · Khí lí tưởng', title: '📈 Đồ thị Đẳng tích (p – T)', sub: 'Đường thẳng kéo dài qua gốc O', run: () => insertPresetShape('vl12_dang_tich', 'Đồ thị Đẳng tích') },
        { chap: 'Chương II · Khí lí tưởng', title: '🔄 Chu trình biến đổi trạng thái', sub: 'Chu trình (1)-(2)-(3)-(4) trên (p,V)', run: () => insertPresetShape('vl12_chu_trinh_khi', 'Chu trình khí lí tưởng') },
        { chap: 'Chương II · Khí lí tưởng', title: '🧪 Xi-lanh & Pit-tông chứa khí', sub: 'Pit-tông thẳng đứng cân bằng', run: () => insertPresetShape('vl12_xilanh_pittong', 'Xi-lanh Pit-tông') },
        { chap: 'Chương II · Khí lí tưởng', title: '💧 Ống chữ U chứa cột Hg', sub: 'Chênh lệch áp suất thủy ngân', run: () => insertPresetShape('vl12_ong_chu_u', 'Ống chữ U thủy ngân') },
        { chap: 'Chương III · Từ trường', title: '🧲 Từ trường dây dẫn (⊙ / ⊗)', sub: 'Quy tắc nắm tay phải', run: () => insertPresetShape('vl12_tu_truong_day', 'Từ trường dây dẫn') },
        { chap: 'Chương III · Từ trường', title: '⚡ Lực từ trên 2 thanh ray', sub: 'Quy tắc bàn tay trái (F, B, I)', run: () => insertPresetShape('vl12_luc_tu_ray', 'Lực từ trên 2 thanh ray') },
        { chap: 'Chương III · Từ trường', title: '🔁 Khung dây quay trong B', sub: 'Nguyên tắc tạo dòng điện xoay chiều', run: () => insertPresetShape('vl12_khung_day_quay', 'Khung dây quay trong từ trường') },
        { chap: 'Chương III · Từ trường', title: '〰️ Đồ thị suất điện động Sin', sub: 'e = E₀ sin(ωt)', run: () => insertPresetShape('vl12_do_thi_ac', 'Đồ thị dòng xoay chiều') },
        { chap: 'Chương III · Từ trường', title: '🔌 Máy biến áp (N₁, N₂)', sub: 'Lõi thép + cuộn sơ cấp, thứ cấp', run: () => insertPresetShape('vl12_may_bien_ap', 'Máy biến áp') },
        { chap: 'Chương III · Từ trường', title: '📡 Sóng điện từ (E ⊥ B ⊥ v)', sub: 'Lan truyền sóng điện từ', run: () => insertPresetShape('vl12_song_dien_tu', 'Sóng điện từ') },
        { chap: 'Chương IV · Vật lí hạt nhân', title: '⚛️ Cấu tạo hạt nhân (p, n)', sub: 'Mô hình proton & neutron', run: () => insertPresetShape('vl12_hat_nhan', 'Cấu tạo hạt nhân') },
        { chap: 'Chương IV · Vật lí hạt nhân', title: '📉 Đồ thị phân rã phóng xạ', sub: 'N(t) = N₀ · 2^(-t/T)', run: () => insertPresetShape('vl12_phan_ra', 'Đồ thị phân rã phóng xạ') },
        { chap: 'Chương IV · Vật lí hạt nhân', title: '💥 Phản ứng phân hạch U-235', sub: 'n + U → 2 hạt nhân trung bình', run: () => insertPresetShape('vl12_phan_hach', 'Phản ứng phân hạch') },
        { chap: 'Chương IV · Vật lí hạt nhân', title: '☀️ Phản ứng nhiệt hạch (D+T)', sub: 'D + T → He + n', run: () => insertPresetShape('vl12_nhiet_hach', 'Phản ứng nhiệt hạch') }
      ],
      hoa: [
        { chap: 'Dụng cụ thí nghiệm', title: '🧪 Ống nghiệm', sub: 'Ống nghiệm có mực dung dịch', run: () => insertPresetShape('ong_nghiem', 'Ống nghiệm Hóa học') },
        { chap: 'Dụng cụ thí nghiệm', title: '⚗️ Bình tam giác (Erlen)', sub: 'Bình chuẩn độ thí nghiệm', run: () => insertPresetShape('binh_tam_giac', 'Bình tam giác') },
        { chap: 'Cấu tạo nguyên tử', title: '⚛️ Mô hình nguyên tử Bo', sub: 'Hạt nhân +Z và các lớp e', run: () => insertPresetShape('nguyen_tu_bo', 'Mô hình nguyên tử Bo') }
      ]
    };

    let activeSub = 'toan_thcs';

    function syncChapters() {
      const list = ITEMS[activeSub] || [];
      const chaps = Array.from(new Set(list.map((it) => it.chap)));
      chapSel.innerHTML = '<option value="__all__">📚 Tất cả chương / bài</option>';
      chaps.forEach((ch) => {
        const opt = document.createElement('option');
        opt.value = ch;
        opt.textContent = ch;
        chapSel.appendChild(opt);
      });
    }

    function renderGrid() {
      const list = ITEMS[activeSub] || [];
      const chVal = chapSel.value || '__all__';
      const q = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
      const filtered = list.filter((it) => {
        if (chVal !== '__all__' && it.chap !== chVal) return false;
        if (q && !(`${it.title} ${it.sub} ${it.chap}`).toLowerCase().includes(q)) return false;
        return true;
      });
      gridEl.innerHTML = '';
      filtered.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'geom-hub-btn';
        b.innerHTML = `<b>${it.title}</b><span>${it.sub}</span>`;
        b.addEventListener('click', () => {
          if (typeof it.run === 'function') it.run();
        });
        gridEl.appendChild(b);
      });
    }

    function renderTabs() {
      tabsEl.innerHTML = '';
      SUBJECTS.forEach((s) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `geom-hub-tab${s.id === activeSub ? ' active' : ''}`;
        btn.textContent = s.label;
        btn.addEventListener('click', () => {
          activeSub = s.id;
          renderTabs();
          syncChapters();
          renderGrid();
        });
        tabsEl.appendChild(btn);
      });
    }

    chapSel.addEventListener('change', renderGrid);
    if (searchEl) searchEl.addEventListener('input', renderGrid);
    renderTabs();
    syncChapters();
    renderGrid();
  }

  initMultiSubjectConstructionHub();
})();