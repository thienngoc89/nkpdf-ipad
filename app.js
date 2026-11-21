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
      navigator.serviceWorker.register('./sw.js?v=20261121.170055').then((reg) => {
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
    palmRejection: true,
    snapPoint: true,
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
    // Trạng thái khung cửa sổ Bảng xanh (chừa sẵn 24px cho thanh trạng thái iPadOS để kéo cạnh trên nhạy 100%)
    bxRect: {
      left: 0,
      top: window.matchMedia('(pointer: coarse)').matches ? 24 : 0,
      width: window.innerWidth,
      height: window.innerHeight - (window.matchMedia('(pointer: coarse)').matches ? 24 : 0),
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
  function notify(msg, showPopup = true) {
    if (statusLabel) statusLabel.textContent = msg;
    if (geomGuide && !geomToolbar.classList.contains('hidden')) geomGuide.innerHTML = msg;
    if (showPopup && toastBanner) {
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
      ctx.strokeStyle = isErase ? '#E11D48' : '#0284C7';
      ctx.fillStyle = isErase ? 'rgba(225, 29, 72, 0.12)' : 'rgba(2, 132, 199, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
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
    ctx.restore();
    if (typeof tvVidActiveDirty !== 'undefined' && typeof tvStreamMode !== 'undefined' && tvStreamMode !== 'vector') {
      tvVidActiveDirty = true;
    }
    if (sid === 'board' && typeof scheduleAirPlayLiveStroke === 'function') {
      scheduleAirPlayLiveStroke(surf.previewObj || null);
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
      NKInkEngine.drawObject(ctx, obj, state.showPointDots, state.showLabels);
    }

    // 1. Vẽ Khung bao + 8 điểm neo vuông co dãn/đối xứng + Nút xoay tự do 360° ở lớp dưới
    if (activeSid() === sid && state.selectedIndices.length > 0) {
      const box = getSelectionBox(list, state.selectedIndices);
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

    // 2. Chỉ vẽ các Điểm điều khiển Đường cong & Đỉnh hình học khi đang ở chế độ Sửa hình động hoặc Sửa đúng 1 đối tượng (không hiện hàng loạt chấm tròn gây rối khi chọn nhiều nét để di chuyển!)
    const showCtrlVerts = state.showPointDots && (
      state.tool === 'chinh_hinh_dong' ||
      (state.tool === 'chinh_sua' && activeSid() === sid && state.selectedIndices.length === 1)
    );
    if (showCtrlVerts) {
      const indicesToShow = state.tool === 'chinh_hinh_dong'
        ? list.map((_, idx) => idx)
        : state.selectedIndices;

      if (indicesToShow.length > 0) {
        ctx.save();
        for (const idx of indicesToShow) {
          const obj = list[idx];
          if (!obj || obj.hidden) continue;
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
      const bgMap = { green: '#0B6251', black: '#14171A', white: '#FFFFFF', cream: '#FDF6E3' };
      ctx.fillStyle = bgMap[state.boardTheme] || '#0B6251';
      ctx.fillRect(0, 0, cssW, cssH);
    }

    const gMode = isBoard ? state.boardGridMode : 'grid';
    if (state.showGrid && gMode !== 'none') {
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
    if (isBoard && typeof scheduleAirPlayBoardSnapshot === 'function') {
      scheduleAirPlayBoardSnapshot();
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
    let lastTapTime = 0, lastTapIdx = -1;
    const inkProc = new NKInkEngine.AdaptiveInkProcessor();

    activeActCancels[sid] = () => {
      clearHold();
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
      if (isMultiTouch) return;
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
      if (isTouch && state.palmRejection && state.tool !== 'tay') {
        if (sid === 'board') {
          const t0 = performance.now();
          act = {
            mode: 'pan',
            isBoardPan: true,
            sx: e.clientX, sy: e.clientY,
            samples: [{ x: e.clientX, y: e.clientY, t: t0 }],
            sl: state.boardCam.panX,
            st: state.boardCam.panY
          };
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

      if (state.tool === 'tay') {
        // Trên PDF nếu đang dùng ngón tay thì để iPadOS cuộn gốc; nếu dùng chuột PC thì kéo JS
        if (isTouch && sid !== 'board') return;
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
        const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lbl = labels[state.pointCounter % labels.length];
        state.pointCounter++;
        pushUndo(sid);
        list.push({ type: 'diem', x: pos.x, y: pos.y, text: lbl, color: activeColor() });
        redrawSurface(sid);
        notify(`• Đã dựng điểm ${lbl}`);
        return;
      }

      if (state.tool === 'them_chu' || state.tool === 'ghi_chu') {
        openInlineTextEditor(sid, pos.x, pos.y, e.clientX, e.clientY, state.tool === 'ghi_chu' ? 'ghi_chu' : 'chu', null);
        return;
      }

      // Kiểm tra ở chế độ Chọn/Sửa và Hình động (Khi đang dùng Bút viết thì KHÔNG tự động bắt điểm điều khiển để Thầy viết tiếp mượt mà)
      if (state.tool === 'chon' || state.tool === 'chinh_sua' || state.tool === 'chinh_hinh_dong') {
        const hitScale = sid === 'board' ? 1 / Math.max(0.5, state.boardCam.zoom) : 1;

        // ƯU TIÊN SỐ 1: Chỉ bắt điểm điều khiển khi các chấm tròn thực sự đang hiển thị (Sửa hình động hoặc Sửa 1 đối tượng)
        const canHitCtrlVerts = state.showPointDots && (
          state.tool === 'chinh_hinh_dong' ||
          (state.tool === 'chinh_sua' && state.selectedIndices.length === 1)
        );
        if (canHitCtrlVerts) {
          const hitRadius = sid === 'board' ? 22 / Math.max(0.5, state.boardCam.zoom) : 22;
          const activeIndices = state.tool === 'chinh_hinh_dong'
            ? list.map((_, i) => i).reverse()
            : state.selectedIndices.slice().reverse();

          for (const objIdx of activeIndices) {
            const obj = list[objIdx];
            if (!obj || obj.hidden) continue;
            const verts = NKInkEngine.getObjectVertices(obj);
            for (const v of verts) {
              if (v.readOnly) continue;
              if (Math.hypot(pos.x - v.x, pos.y - v.y) <= hitRadius) {
                pushUndo(sid);
                state.selectedIndices = [objIdx];
                act = { mode: 'drag_vertex', objIdx, role: v.role };
                return;
              }
            }
          }
        }

        // Kiểm tra chạm vào Nút xoay 360° hoặc 8 tay cầm co dãn/đối xứng của khung bao
        if (state.selectedIndices.length > 0) {
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

        // Kiểm tra chạm trúng đối tượng (ưu tiên chạm trực tiếp vào nét đường cong trước khi kéo cả khung bao!)
        let bestIdx = -1, bestDist = 18 * hitScale;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].hidden) continue;
          const d = NKInkEngine.hitDistanceToObject(list[i], pos.x, pos.y);
          if (d <= bestDist) { bestDist = d; bestIdx = i; }
        }

        if (bestIdx !== -1) {
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
            if (alreadySelected) state.selectedIndices.splice(state.selectedIndices.indexOf(bestIdx), 1);
            else state.selectedIndices.push(bestIdx);
          } else if (!alreadySelected) {
            state.selectedIndices = [bestIdx];
          }
          // Chỉ khởi tạo điểm điều khiển đường cong khi đang ở công cụ Sửa hình động / Sửa chi tiết (không làm rối khi chỉ Chọn để di chuyển)
          if (selObj && selObj.type === 'but' && (state.tool === 'chinh_sua' || state.tool === 'chinh_hinh_dong') && state.selectedIndices.length === 1) {
            NKInkEngine.getObjectVertices(selObj);
          }
          redrawSurface(sid);
          pushUndo(sid);
          act = { mode: 'move_sel', rect: cachedRect, lx: pos.x, ly: pos.y };
          if (selObj && selObj.type === 'but' && state.tool !== 'chon' && state.selectedIndices.length === 1) {
            notify('💡 Đã chọn đường cong: Kéo các nút tròn xanh/cam trên đường cong để uốn độ cong!');
          } else if (selObj && (selObj.type === 'chu' || selObj.type === 'cong_thuc')) {
            notify('💡 Chạm đúp (2 lần) vào chữ hoặc công thức để chỉnh sửa lại nội dung.');
          }
          return;
        }

        // Nếu chạm bên trong khung bao đang chọn thì tịnh tiến đối tượng
        if (state.selectedIndices.length > 0) {
          const box = getSelectionBox(list, state.selectedIndices);
          if (box && pos.x >= box.x0 && pos.x <= box.x1 && pos.y >= box.y0 && pos.y <= box.y1) {
            pushUndo(sid);
            act = { mode: 'move_sel', lx: pos.x, ly: pos.y };
            return;
          }
        }

        if (!state.multiSelect) state.selectedIndices = [];
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
        const sp = NKInkEngine.findNearestSnapPoint(list, pos.x, pos.y);
        if (sp) pos = { x: sp.x, y: sp.y };
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
      if (!act || isMultiTouch) return;
      if (act.mode === 'pan') {
        const now = performance.now();
        act.samples.push({ x: e.clientX, y: e.clientY, t: now });
        // Chỉ giữ mẫu trong 90ms gần nhất để tính vận tốc vuốt thực tế chính xác
        while (act.samples.length > 2 && now - act.samples[0].t > 90) {
          act.samples.shift();
        }
        if (act.isBoardPan) {
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
      if (act.mode === 'drag_vertex') {
        const obj = list[act.objIdx];
        if (!obj) return;
        if (state.snapPoint) {
          const sp = NKInkEngine.findNearestSnapPoint(list.filter((_, k) => k !== act.objIdx), pos.x, pos.y);
          if (sp) { pos = { x: sp.x, y: sp.y }; surf.snapBadge = sp; }
          else surf.snapBadge = null;
        }
        NKInkEngine.updateObjectVertex(obj, act.role, pos.x, pos.y);
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
        for (const idx of state.selectedIndices) {
          if (list[idx]) NKInkEngine.translateObject(list[idx], dx, dy);
        }
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
        redrawSurface(sid);
        return;
      }

      if (act.mode === 'marquee' || act.mode === 'marquee_erase') {
        surf.marqueeBox = {
          x: Math.min(act.sx, pos.x),
          y: Math.min(act.sy, pos.y),
          w: Math.abs(pos.x - act.sx),
          h: Math.abs(pos.y - act.sy)
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
              if (sid === 'board' && typeof scheduleAirPlayLiveStroke === 'function') {
                surf.previewObj.points = fPts;
                scheduleAirPlayLiveStroke(surf.previewObj);
              }
            }
            if (typeof tvQueueStrokePoint === 'function') tvQueueStrokePoint(sid, p);
          }
        }

        // Bút tô sáng (có độ mờ) hoặc nét đứt hoặc đoạn ngắn đầu tiên cần vẽ lại toàn bộ nét hiện tại
        if (addedAny && (isHl || state.dashed || act.scribbleState || inkProc.filteredPoints.length < 4)) {
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

        // Cơ chế Giữ bút nắn thẳng / nắn hình chuẩn GoodNotes (tối ưu cho Apple Pencil 120Hz trên mặt kính iPad):
        // - Chỉ reset bộ đếm khi mũi bút thực sự rời khỏi vùng giữ yên (anchorMove > 6.5px), KHÔNG reset vì rung vi mô 2px!
        // - Sau khi dừng tay giữ yên 280ms: lập tức nắn thẳng / căn / tròn / chữ nhật / đường cong!
        if ((state.tool === 'but' || state.tool === 'to_sang') && !act.scribbleState) {
          const anchorMove = act.holdAnchor ? Math.hypot(pos.x - act.holdAnchor.x, pos.y - act.holdAnchor.y) : 999;
          act.lastHoldPos = { x: pos.x, y: pos.y };
          if (anchorMove > 6.5 || !holdTimer) {
            if (anchorMove > 6.5) act.holdAnchor = { x: pos.x, y: pos.y };
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
            }, 280);
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
            const sp = NKInkEngine.findNearestSnapPoint(list, ex, ey);
            if (sp) { ex = sp.x; ey = sp.y; surf.snapBadge = sp; }
          }
          if (!surf.snapBadge && (state.snapAngle || state.tool === 'gach_chan' || state.tool === 'gach_ngang')) {
            const sa = NKInkEngine.snapAnglePoint(sx, sy, ex, ey);
            ex = sa.x; ey = sa.y;
            if (sa.angleLabel) surf.snapBadge = { x: ex, y: ey, label: sa.angleLabel };
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
        } else if (state.tool === 'hcn' || state.tool === 'elip') {
          surf.previewObj = {
            type: state.tool,
            x: Math.min(sx, ex), y: Math.min(sy, ey),
            w: Math.abs(ex - sx), h: Math.abs(ey - sy),
            ...style
          };
        } else if (state.tool === 'xoa_vung') {
          const fillMap = { green: '#0B6251', black: '#14171A', white: '#FFFFFF', cream: '#FDF6E3' };
          surf.previewObj = {
            type: 'xoa_vung',
            x: Math.min(sx, ex), y: Math.min(sy, ey),
            w: Math.abs(ex - sx), h: Math.abs(ey - sy),
            isPreview: true,
            isBoardErase: state.mode === 'board',
            keepGrid: state.showGrid,
            gridStep: state.gridStep || 16,
            fillColor: state.mode === 'board' ? (fillMap[state.boardTheme] || '#0B6251') : '#FFFFFF'
          };
        } else if (state.tool === 'tam_giac' || state.tool === 'to_trong_suot') {
          surf.previewObj = {
            type: state.tool,
            points: [{ x: (sx + ex) * 0.5, y: sy }, { x: sx, y: ey }, { x: ex, y: ey }],
            hatch: state.tool === 'to_trong_suot' ? state.hatchMode : null,
            fillOpacity: state.hatchOpacity,
            ...style
          };
        }
        redrawActiveLayer(sid);
      }
    });

    function endPointer() {
      clearHold();
      if (sid !== 'board') {
        inkCanvas.style.touchAction = 'pan-x pan-y';
      }
      if (!act) return;
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
          return false;
        }
        return true;
      };

      if (act.mode === 'marquee') {
        const m = surf.marqueeBox;
        surf.marqueeBox = null;
        if (m && (m.w > 4 || m.h > 4)) {
          const rx0 = m.x, ry0 = m.y, rx1 = m.x + m.w, ry1 = m.y + m.h;
          const hits = [];
          list.forEach((obj, idx) => {
            if (objHitsMarquee(obj, rx0, ry0, rx1, ry1, false)) hits.push(idx);
          });
          state.selectedIndices = hits;
          if (hits.length) notify(`Đã chọn ${hits.length} đối tượng. Kéo bên trong khung để di chuyển hoặc dùng 8 điểm neo / nút xoay.`);
        }
        redrawSurface(sid);
      } else if (act.mode === 'marquee_erase') {
        const m = surf.marqueeBox;
        surf.marqueeBox = null;
        if (m && (m.w > 4 || m.h > 4)) {
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
              surf.previewObj.points = inkProc.buildSmoothPoints(true);
            }
            const committedObj = surf.previewObj;
            list.push(committedObj);
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
        if (e.touches && e.touches.length === 1) {
          const t = e.touches[0];
          if (t.touchType === 'stylus' || (!state.palmRejection && state.tool !== 'tay')) {
            e.preventDefault();
          }
        }
      };
      inkCanvas.addEventListener('touchstart', blockStylusScroll, { passive: false });
      inkCanvas.addEventListener('touchmove', blockStylusScroll, { passive: false });
    }
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
  function applyBangXanhRect() {
    const r = state.bxRect;
    bxWindow.style.left = r.left + 'px';
    bxWindow.style.top = r.top + 'px';
    bxWindow.style.width = r.width + 'px';
    bxWindow.style.height = r.height + 'px';
    initBoard();
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
    const safeTop = window.matchMedia('(pointer: coarse)').matches ? 24 : 0;
    if (!state.bxRect.isFullscreen) {
      state.bxRect = { left: 0, top: safeTop, width: window.innerWidth, height: window.innerHeight - safeTop, isFullscreen: true };
      notify('🗖 Đã mở rộng Bảng xanh toàn màn hình (Kéo cạnh trên xuống để chia đôi với PDF).');
    } else {
      const topH = Math.round(window.innerHeight * 0.46);
      state.bxRect = { left: 0, top: topH, width: window.innerWidth, height: window.innerHeight - topH, isFullscreen: false };
      notify('⬓ Đã thu Bảng xanh xuống nửa dưới màn hình.');
    }
    applyBangXanhRect();
  });

  function openBangXanh(open = true) {
    if (open) {
      state.mode = 'board';
      bxWindow.classList.remove('hidden');
      applyBangXanhRect();
      notify('🟢 Đã mở Bảng xanh (Kéo thanh mép trên xuống hoặc bấm "⬓ Nửa dưới" để vừa xem đề PDF vừa viết Bảng xanh!)');
    } else {
      state.mode = 'pdf';
      bxWindow.classList.add('hidden');
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
  });

  document.querySelectorAll('[data-bxtool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.bxtool);
      document.querySelectorAll('[data-bxtool]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  document.querySelectorAll('.bx-size').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.boardWidth = parseFloat(btn.dataset.bxwidth);
      document.querySelectorAll('.bx-size').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  document.querySelectorAll('.bx-color').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.boardColor = btn.dataset.bxcolor;
      document.querySelectorAll('.bx-color').forEach((b) => b.classList.toggle('active', b === btn));
      if (state.selectedIndices.length > 0 && state.annots.board) {
        pushUndo('board');
        state.selectedIndices.forEach((idx) => {
          if (state.annots.board[idx]) state.annots.board[idx].color = state.boardColor;
        });
        redrawSurface('board');
      }
    });
  });

  document.getElementById('bx-btn-dashed').addEventListener('click', (e) => {
    state.dashed = !state.dashed;
    e.currentTarget.classList.toggle('active', state.dashed);
  });

  document.getElementById('bx-btn-grid').addEventListener('click', (e) => {
    state.showGrid = !state.showGrid;
    e.currentTarget.classList.toggle('active', state.showGrid);
    document.getElementById('rb-grid').classList.toggle('active', state.showGrid);
    if (surfaces.board) {
      drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
    }
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

  document.querySelectorAll('[data-gtool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.gtool);
      document.querySelectorAll('[data-gtool]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  function insertPresetShape(shapeId, label) {
    const sid = activeSid(), surf = surfaces[sid];
    if (!surf) return;
    ensureStacks(sid);
    pushUndo(sid);
    const objs = NKInkEngine.createMathPhysicsPresets(
      shapeId,
      surf.cssWidth * 0.5,
      surf.cssHeight * 0.45,
      { color: activeColor(), width: activeWidth() }
    );
    const startIdx = state.annots[sid].length;
    state.annots[sid].push(...objs);
    state.selectedIndices = objs.map((_, k) => startIdx + k);
    setTool('chinh_hinh_dong');
    redrawSurface(sid);
    geomSubmenu.classList.add('hidden');
    notify(`📐 Đã dựng ${label} (Kéo các chấm tròn trên hình/đường cong để biến dạng trực tiếp).`);
  }

  function showGeomSubmenu(items) {
    geomSubmenu.innerHTML = '';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'gsub-btn';
      b.textContent = it.label;
      b.addEventListener('click', it.action);
      geomSubmenu.appendChild(b);
    });
    geomSubmenu.classList.remove('hidden');
  }

  document.getElementById('gbtn-to-mien').addEventListener('click', () => {
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

  document.getElementById('gbtn-hinh-chuan').addEventListener('click', () => {
    showGeomSubmenu([
      { label: '🔺 Tam giác đều', action: () => insertPresetShape('tam_giac_deu', 'Tam giác đều ABC') },
      { label: '🔺 Tam giác cân', action: () => insertPresetShape('tam_giac_can', 'Tam giác cân ABC') },
      { label: '📐 Tam giác vuông', action: () => insertPresetShape('tam_giac_vuong', 'Tam giác vuông tại A') },
      { label: '🟩 Hình vuông', action: () => insertPresetShape('hinh_vuong', 'Hình vuông ABCD') },
      { label: '▰ Hình bình hành', action: () => insertPresetShape('hinh_binh_hanh', 'Hình bình hành ABCD') },
      { label: '⏢ Hình thang cân', action: () => insertPresetShape('hinh_thang', 'Hình thang ABCD') },
      { label: '⏢ Hình thang vuông', action: () => insertPresetShape('hinh_thang_vuong', 'Hình thang vuông ABCD') }
    ]);
  });

  document.getElementById('gbtn-conic').addEventListener('click', () => {
    showGeomSubmenu([
      { label: '📐 Đồ thị Parabol chuẩn (Kéo được đỉnh)', action: () => insertPresetShape('conic_parabol', 'Đồ thị Parabol') },
      { label: '⚡ Hyperbol 2 nhánh chuẩn', action: () => insertPresetShape('conic_hyperbol', 'Đồ thị Hyperbol 2 nhánh') },
      { label: '📈 Đường đẳng nhiệt p = k/V (Kéo vẽ)', action: () => { setTool('dung_dang_nhiet'); geomSubmenu.classList.add('hidden'); notify('📈 Kéo trên trang để dựng đường cong đẳng nhiệt p = k/V.'); } },
      { label: '📊 Mẫu 2 đường đẳng nhiệt T₂ > T₁', action: () => insertPresetShape('dang_nhiet_pv', 'Đồ thị 2 đường đẳng nhiệt T₂ > T₁') }
    ]);
  });

  document.getElementById('gbtn-dung-them').addEventListener('click', () => {
    showGeomSubmenu([
      { label: '📈 Kéo dựng đường đẳng nhiệt p=k/V', action: () => { setTool('dung_dang_nhiet'); geomSubmenu.classList.add('hidden'); notify('📈 Kéo trên trang để dựng đường đẳng nhiệt p = k/V.'); } },
      { label: '📊 Mẫu 2 đường đẳng nhiệt T₂ > T₁', action: () => insertPresetShape('dang_nhiet_pv', 'Đồ thị 2 đường đẳng nhiệt T₂ > T₁') },
      { label: '🎯 Mẫu Chuyển động ném ngang', action: () => insertPresetShape('nem_ngang', 'Chuyển động ném ngang') },
      { label: '🚀 Mẫu Chuyển động ném xiên', action: () => insertPresetShape('nem_xien', 'Chuyển động ném xiên') },
      { label: '〰️ Mẫu Giao thoa sóng 2 nguồn S₁, S₂', action: () => insertPresetShape('giao_thoa_song', 'Giao thoa sóng 2 nguồn') },
      { label: '🌊 Mẫu Sóng dừng (Bụng - Nút)', action: () => insertPresetShape('song_dung', 'Sóng dừng trên dây') },
      { label: '〰️ Mẫu Sóng hình Sin/Cos', action: () => insertPresetShape('song_sin', 'Đồ thị sóng hình Sin') },
      { label: '🌀 Mẫu Con lắc lò xo', action: () => insertPresetShape('con_lac_lo_xo', 'Con lắc lò xo') },
      { label: '⏱️ Mẫu Con lắc đơn', action: () => insertPresetShape('con_lac_don', 'Con lắc đơn') },
      { label: '⚡ Mẫu Mạch điện RLC', action: () => insertPresetShape('mach_rlc', 'Đoạn mạch RLC') },
      { label: '🔺 Mẫu Hình chóp S.ABCD', action: () => insertPresetShape('hinh_chop', 'Hình chóp S.ABCD') }
    ]);
  });

  document.getElementById('gbtn-bien-hinh').addEventListener('click', () => {
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

  document.getElementById('gbtn-so-do').addEventListener('click', () => {
    showGeomSubmenu([
      {
        label: '📏 Đoạn thẳng độ dài L...',
        action: () => {
          const val = parseFloat(window.prompt('Nhập độ dài đoạn thẳng L (px):', '160'));
          if (!val || val <= 0) return;
          const sid = activeSid(), surf = surfaces[sid];
          if (!surf) return;
          pushUndo(sid);
          const cx = surf.cssWidth * 0.5, cy = surf.cssHeight * 0.45;
          state.annots[sid].push({ type: 'duong', x1: cx - val * 0.5, y1: cy, x2: cx + val * 0.5, y2: cy, color: activeColor(), width: activeWidth() });
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
          const cx = surf.cssWidth * 0.5, cy = surf.cssHeight * 0.45;
          state.annots[sid].push({ type: 'elip', x: cx - r, y: cy - r, w: r * 2, h: r * 2, color: activeColor(), width: activeWidth() });
          redrawSurface(sid);
          geomSubmenu.classList.add('hidden');
        }
      }
    ]);
  });

  document.getElementById('gbtn-tao-oxy').addEventListener('click', () => insertPresetShape('oxy_mini', 'Hệ trục tọa độ Oxy mini'));

  document.getElementById('gbtn-thao-tac').addEventListener('click', () => {
    showGeomSubmenu([
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
          redrawSurface(sid);
          geomSubmenu.classList.add('hidden');
        }
      },
      { label: '🗑️ Xóa đối tượng đang chọn', action: () => { deleteSelected(); geomSubmenu.classList.add('hidden'); } }
    ]);
  });

  document.getElementById('gbtn-chon-nhieu').addEventListener('click', (e) => {
    state.multiSelect = !state.multiSelect;
    e.currentTarget.classList.toggle('active', state.multiSelect);
    notify(state.multiSelect ? '☑ Đã BẬT chế độ Chọn nhiều đối tượng' : 'Đã TẮT chế độ Chọn nhiều');
  });

  document.getElementById('gbtn-bo-chon').addEventListener('click', () => {
    state.selectedIndices = [];
    redrawSurface(activeSid());
  });

  document.getElementById('gbtn-diem-dung').addEventListener('click', (e) => {
    state.showPointDots = !state.showPointDots;
    e.currentTarget.classList.toggle('active', state.showPointDots);
    redrawSurface(activeSid());
  });

  document.getElementById('gbtn-nhan').addEventListener('click', (e) => {
    state.showLabels = !state.showLabels;
    e.currentTarget.classList.toggle('active', state.showLabels);
    redrawSurface(activeSid());
  });

  document.getElementById('gbtn-hien-an').addEventListener('click', () => {
    const sid = activeSid(), list = state.annots[sid] || [];
    if (state.selectedIndices.length > 0) {
      state.selectedIndices.forEach((idx) => { if (list[idx]) list[idx].hidden = !list[idx].hidden; });
    } else {
      list.forEach((obj) => { obj.hidden = false; });
    }
    redrawSurface(sid);
  });

  document.getElementById('gbtn-sap-xep').addEventListener('click', () => {
    const grid = document.getElementById('GeomMatrixGrid');
    const badge = document.getElementById('geom-matrix-badge');
    showGeomSubmenu([
      { label: '12 cột × 2 hàng', action: () => { grid.className = 'geom-matrix-grid cols-12'; badge.textContent = '[12×2]'; geomSubmenu.classList.add('hidden'); } },
      { label: '8 cột × 3 hàng (Mặc định)', action: () => { grid.className = 'geom-matrix-grid cols-8'; badge.textContent = '[8×3]'; geomSubmenu.classList.add('hidden'); } },
      { label: '6 cột × 4 hàng', action: () => { grid.className = 'geom-matrix-grid cols-6'; badge.textContent = '[6×4]'; geomSubmenu.classList.add('hidden'); } },
      { label: '4 cột × 6 hàng', action: () => { grid.className = 'geom-matrix-grid cols-4'; badge.textContent = '[4×6]'; geomSubmenu.classList.add('hidden'); } }
    ]);
  });

  document.getElementById('gbtn-huy').addEventListener('click', () => {
    state.selectedIndices = [];
    geomSubmenu.classList.add('hidden');
    setTool('chinh_hinh_dong');
    redrawSurface(activeSid());
  });

  function makeDraggable(winEl, handleEl) {
    let dragging = false, ox = 0, oy = 0;
    handleEl.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
      dragging = true;
      const r = winEl.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    handleEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      winEl.style.left = Math.max(4, e.clientX - ox) + 'px';
      winEl.style.top = Math.max(4, e.clientY - oy) + 'px';
      winEl.style.right = 'auto';
    });
    handleEl.addEventListener('pointerup', () => { dragging = false; });
  }
  makeDraggable(geomToolbar, document.getElementById('geom-drag-handle'));
  makeDraggable(document.getElementById('CuaSoCasio'), document.getElementById('casio-drag-handle'));

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
    if (e.touches && e.touches.length === 1 && e.touches[0].touchType !== 'stylus' && !isMultiTouch) {
      pullStartY = e.touches[0].clientY;
      pullAtTop = pdfScroll.scrollTop <= 4;
      pullAtBottom = (pdfScroll.scrollTop + pdfScroll.clientHeight >= pdfScroll.scrollHeight - 8);
      pullReady = null;
    } else {
      pullAtTop = false;
      pullAtBottom = false;
      pullReady = null;
    }
  }, { passive: true });

  pdfScroll.addEventListener('touchmove', (e) => {
    if (!pullAddPill || !e.touches || e.touches.length !== 1 || e.touches[0].touchType === 'stylus' || isMultiTouch) {
      if (pullAddPill) pullAddPill.classList.add('hidden');
      pullReady = null;
      return;
    }
    const dy = e.touches[0].clientY - pullStartY;
    if (pullAtTop && pdfScroll.scrollTop <= 2 && dy > 32) {
      pullAddPill.classList.remove('hidden', 'pos-bottom');
      pullAddPill.classList.add('pos-top');
      if (dy >= 92) {
        pullReady = 'top';
        pullAddPill.classList.add('ready');
        pullAddPill.textContent = '✨ Thả tay để thêm trang trống mới ở ĐẦU!';
      } else {
        pullReady = null;
        pullAddPill.classList.remove('ready');
        pullAddPill.textContent = '⬇️ Kéo mạnh thêm để tạo trang trống ở ĐẦU...';
      }
    } else if (pullAtBottom && (pdfScroll.scrollTop + pdfScroll.clientHeight >= pdfScroll.scrollHeight - 8) && dy < -32) {
      pullAddPill.classList.remove('hidden', 'pos-top');
      pullAddPill.classList.add('pos-bottom');
      if (dy <= -92) {
        pullReady = 'bottom';
        pullAddPill.classList.add('ready');
        pullAddPill.textContent = '✨ Thả tay để thêm trang trống mới ở CUỐI!';
      } else {
        pullReady = null;
        pullAddPill.classList.remove('ready');
        pullAddPill.textContent = '⬆️ Kéo mạnh thêm để tạo trang trống ở CUỐI...';
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
  }

  // ============================================================================
  // ĐIỀU KHIỂN RIBBON TINH GỌN, THANH DỌC, CÔNG CỤ, MÀU BÚT, HỘP THOẠI
  // ============================================================================
  document.querySelectorAll('.ribbon-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ribbon-tab').forEach((t) => t.classList.toggle('active', t === tab));
      const target = tab.dataset.rtab;
      document.querySelectorAll('.ribbon-page').forEach((p) => {
        p.classList.toggle('active', p.id === `rpage-${target}`);
      });
      document.getElementById('Ribbon').classList.remove('hidden');
      document.getElementById('collapse-ribbon-icon').textContent = '▲';
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
      state.width = parseFloat(p.dataset.width);
      document.querySelectorAll('.w-pill[data-width]').forEach((w) => w.classList.toggle('active', w === p));
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
    } catch (_) {
      notify('⚠️ Không tải được trang mẫu, hãy bấm "Mở PDF" để chọn tệp.');
    }
  }
  document.getElementById('rb-sample').addEventListener('click', loadSampleExam);
  document.getElementById('btn-sample-tab').addEventListener('click', loadSampleExam);

  function changeZoom(newZ, focal = null) {
    const oldZ = state.zoom;
    state.zoom = Math.max(0.5, Math.min(3.5, +newZ.toFixed(3)));
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
  document.getElementById('rb-fit-width').addEventListener('click', fitWidth);
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

  document.getElementById('rb-grid').addEventListener('click', (e) => {
    state.showGrid = !state.showGrid;
    e.currentTarget.classList.toggle('active', state.showGrid);
    document.getElementById('bx-btn-grid').classList.toggle('active', state.showGrid);
    document.querySelectorAll('.pdf-page-wrapper').forEach((w) => {
      w.classList.toggle('show-css-grid', state.showGrid);
    });
    if (surfaces.board) {
      drawGrid(bxGridCanvas, surfaces.board.cssWidth, surfaces.board.cssHeight, surfaces.board.dpr, true);
    }
    notify(state.showGrid ? 'Đã BẬT lưới ô ly (CSS 0 MB RAM)' : 'Đã TẮT lưới ô ly');
  });

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
  document.getElementById('rb-net-dut').addEventListener('click', (e) => {
    state.dashed = !state.dashed;
    e.currentTarget.classList.toggle('active', state.dashed);
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
  document.getElementById('top-btn-kho-hinh').addEventListener('click', openKhoHinh);
  document.getElementById('rb-kho-hinh2').addEventListener('click', openKhoHinh);
  document.getElementById('vbar-kho-hinh').addEventListener('click', openKhoHinh);
  document.getElementById('bx-btn-kho-hinh').addEventListener('click', openKhoHinh);
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
    simWin.classList.remove('hidden');
    if (simIframe.src === 'about:blank' || !simIframe.src) simIframe.src = simSelect.value;
  }
  document.getElementById('rb-physics-sim').addEventListener('click', openPhysicsSim);
  document.getElementById('vbar-physics-sim').addEventListener('click', openPhysicsSim);
  document.getElementById('close-sim-btn').addEventListener('click', () => simWin.classList.add('hidden'));
  simSelect.addEventListener('change', (e) => { simIframe.src = e.target.value; });

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

  const bxGridSel = document.getElementById('bx-grid-select');
  if (bxGridSel) {
    bxGridSel.addEventListener('change', (e) => {
      state.boardGridMode = e.target.value;
      state.showGrid = state.boardGridMode !== 'none';
      document.getElementById('bx-btn-grid').classList.toggle('active', state.showGrid);
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
  document.getElementById('top-btn-install-pwa').addEventListener('click', () => {
    installModal.classList.remove('hidden');
  });
  document.getElementById('close-install-modal').addEventListener('click', () => installModal.classList.add('hidden'));
  document.getElementById('ok-install-modal').addEventListener('click', () => installModal.classList.add('hidden'));

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
      './vendor/katex.min.js', './vendor/katex.min.css',
      './sims/nem_xien_v2.html', './sims/custom/NKPdf_NemXien_16x9.html',
      './sims/custom/NKPdf_TongHop_PhanTichLuc_16x9.html',
      './sims/custom/NKPdf_HaiXe_16x9_XeChay_MocDungYen.html',
      './sims/sim01_chuyen_dong_thang/index.html',
      './sims/con_lac_lo_xo_11.html', './sims/giao_thoa_song_11.html', './sims/dang_nhiet_boyle_12.html'
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
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
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
      state.dashed = !state.dashed;
      notify(state.dashed ? '−− Đã BẬT Nét đứt' : 'Đã TẮT Nét đứt');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSelected();
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
  let pinchStartDist = 0, pinchStartZoom = 1.25, pinchScaleTemp = 1.0;
  let pinchStartMidX = 0, pinchStartMidY = 0, pinchLastMidX = 0, pinchLastMidY = 0;
  let pinchBoardWorldX = 0, pinchBoardWorldY = 0;
  let pinchPdfDocX = 0, pinchPdfDocY = 0, pinchHolderOriginX = 0, pinchHolderOriginY = 0;
  let pinchRaf = null;

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length >= 2) {
      isMultiTouch = true;
      stopInertia();
      cancelAllSurfaceActs();
      if (tMaxFingers === 0) tStart = performance.now();
      tMaxFingers = Math.max(tMaxFingers, e.touches.length);

      if (e.touches.length === 2) {
        pinchStartDist = Math.max(10, Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        ));
        pinchStartMidX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
        pinchStartMidY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
        pinchLastMidX = pinchStartMidX;
        pinchLastMidY = pinchStartMidY;
        pinchScaleTemp = 1.0;

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
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length >= 2) {
      e.preventDefault();
      isMultiTouch = true;
      const dist = Math.max(10, Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      ));
      const midX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
      pinchLastMidX = midX;
      pinchLastMidY = midY;

      if (!tMoved && (Math.abs(dist - pinchStartDist) > 6 || Math.hypot(midX - pinchStartMidX, midY - pinchStartMidY) > 6)) {
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
          pinchScaleTemp = Math.max(0.45, Math.min(2.8, dist / pinchStartDist));
          const dx = midX - pinchStartMidX;
          const dy = midY - pinchStartMidY;
          pdfHolder.style.willChange = 'transform';
          pdfHolder.style.transformOrigin = `${pinchHolderOriginX}px ${pinchHolderOriginY}px`;
          pdfHolder.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${pinchScaleTemp})`;
        }
      }
    }
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
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
      const bgMap = { green: '#0B6251', black: '#14171A', white: '#FFFFFF', cream: '#FDF6E3' };
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
    tvDrawMs: [],
    deltaSampleMs: [],
    inkQueueWaitMs: [], // Thời gian điểm bút chờ gửi
    deltaBytes: [],
    deltaRttMs: [],
    tvStrokeDrawMs: [],
    bytesLog: [] // { ts, bytes }
  };
  const TV_METRIC_WINDOW = 120;
  function pushTvMetric(arr, val) {
    if (!Number.isFinite(val) || val < 0) return;
    arr.push(val);
    if (arr.length > TV_METRIC_WINDOW) arr.shift();
  }
  function logTvBytes(bytes) {
    const now = performance.now();
    tvMetrics.bytesLog.push({ ts: now, bytes });
    const cutoff = now - 5000;
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
      const bgMap = { green: '#0B6251', black: '#14171A', white: '#FFFFFF', cream: '#FDF6E3' };
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
                tvDiagState.lastError = 'iPad setRemoteDescription: ' + (err && err.message ? err.message : String(err));
                updateTvMetricsBadge();
              });
          } else if (msg.type === 'rtc_ice' && msg.candidate && tvRtcPc) {
            if (tvRtcPc.remoteDescription) {
              tvRtcPc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch((err) => {
                tvDiagState.lastError = 'iPad addIceCandidate: ' + (err && err.message ? err.message : String(err));
                updateTvMetricsBadge();
              });
            } else {
              pendingIpadRemoteIce.push(msg.candidate);
            }
          } else {
            handleTvControlAckMsg(msg);
          }
        } catch (_) {}
      });

      cl.on('error', () => nextBrokerOnFail());
      cl.on('timeout', () => nextBrokerOnFail());
      cl.on('close', () => { if (!ackReceived) nextBrokerOnFail(); });
      cl.on('offline', () => { if (!ackReceived) nextBrokerOnFail(); });
    }

    tryBroker(0);
  }

  if (testWirelessBtn) {
    testWirelessBtn.addEventListener('click', () => connectAndHandshakeTv('test'));
  }
  if (connectWirelessBtn) {
    connectWirelessBtn.addEventListener('click', () => connectAndHandshakeTv('cast'));
  }

  // ============================================================================
  // NATIVE IPADOS AIRPLAY EXTERNAL-DISPLAY BRIDGE (WKScriptMessageHandler)
  // ============================================================================
  let airPlaySnapRaf = 0;
  let airPlayLiveRaf = 0;
  let airPlayPendingLive = null;

  function hasNativeAirPlay() {
    return Boolean(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nkpdfAirPlay);
  }

  function emitAirPlayBoardSnapshot() {
    if (!hasNativeAirPlay()) return;
    const surf = surfaces['board'];
    const payload = {
      type: 'board_snapshot',
      annots: state.annots['board'] || [],
      boardCam: state.boardCam || { panX: 0, panY: 0, zoom: 1.0 },
      boardTheme: state.boardTheme || 'black',
      boardGridMode: state.boardGridMode || 'grid',
      showGrid: state.showGrid !== false,
      gridStep: state.gridStep || 20,
      showPointDots: !!state.showPointDots,
      showLabels: state.showLabels !== false,
      ipadCssW: (surf && surf.cssWidth) ? surf.cssWidth : window.innerWidth,
      ipadCssH: (surf && surf.cssHeight) ? surf.cssHeight : window.innerHeight
    };
    try {
      window.webkit.messageHandlers.nkpdfAirPlay.postMessage(payload);
    } catch (_) {}
  }

  function scheduleAirPlayBoardSnapshot() {
    if (!hasNativeAirPlay()) return;
    if (airPlaySnapRaf) return;
    airPlaySnapRaf = requestAnimationFrame(() => {
      airPlaySnapRaf = 0;
      emitAirPlayBoardSnapshot();
    });
  }

  function scheduleAirPlayLiveStroke(previewObj) {
    if (!hasNativeAirPlay()) return;
    airPlayPendingLive = previewObj ? {
      type: previewObj.type || 'but',
      color: previewObj.color,
      width: previewObj.width,
      alpha: previewObj.alpha,
      dashed: !!previewObj.dashed,
      pts: previewObj.points || previewObj.pts || [],
      points: previewObj.points || previewObj.pts || [],
      x1: previewObj.x1, y1: previewObj.y1, x2: previewObj.x2, y2: previewObj.y2,
      cx: previewObj.cx, cy: previewObj.cy, rx: previewObj.rx, ry: previewObj.ry
    } : null;
    if (airPlayLiveRaf) return;
    airPlayLiveRaf = requestAnimationFrame(() => {
      airPlayLiveRaf = 0;
      try {
        window.webkit.messageHandlers.nkpdfAirPlay.postMessage({
          type: 'live_stroke',
          stroke: airPlayPendingLive
        });
      } catch (_) {}
    });
  }

  window.__nkpdfRequestAirPlaySnapshot = emitAirPlayBoardSnapshot;

  // Hook redrawSurface('board') so pan/zoom/undo/redo/erase/draw always syncs to AirPlay TV
  const _origRedrawSurfaceForAirPlay = redrawSurface;
  redrawSurface = function (sid) {
    _origRedrawSurfaceForAirPlay(sid);
    if (sid === 'board') scheduleAirPlayBoardSnapshot();
  };

  if (location.search.includes('nativeAirPlay=1')) {
    state.boardTheme = 'black';
    const themeSel = document.getElementById('bx-theme-select');
    if (themeSel) themeSel.value = 'black';
    state.bxRect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, isFullscreen: true };
    openBangXanh(true);
    setTimeout(emitAirPlayBoardSnapshot, 120);
  }

  loadSampleExam();
})();
