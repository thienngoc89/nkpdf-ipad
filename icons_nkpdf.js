/**
 * Bộ biểu tượng SVG chính thức của NKPDF 2.9 (trích xuất nguyên bản 100% từ nkpdf/icons.py)
 * Hai tông màu đặc trưng: Xanh (#2A5DAA) + Vàng cam (#E8A93A) + Đỏ (#D9534F)
 */
window.NKIcons = (function () {
  const C = '#2A5DAA';
  const A = '#E8A93A';
  const R = '#D9534F';

  const PATHS = {
    mo: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 11H7.4a2 2 0 0 0-1.9 1.4L3 19" stroke="{a}"/>',
    luu: '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><path d="M8 3v5h7V3" stroke="{a}"/><rect x="7" y="13" width="10" height="6" rx="1"/>',
    luu_thanh: '<path d="M5 3h11l4 4v5"/><path d="M5 3a2 2 0 0 0-1 2v14a2 2 0 0 0 2 2h6"/><path d="M8 3v5h7V3"/><path d="M15 18h6m-3-3 3 3-3 3" stroke="{a}"/>',
    in: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><rect x="7" y="14" width="10" height="7" rx="1" stroke="{a}"/>',
    chon: '<path d="M5 3l14 7-6 2-2 6z" stroke="{c}"/><path d="M13 13l5 5" stroke="{a}"/>',
    tay: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" stroke="{c}"/>',
    phong_to: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6M8 11h6" stroke="{a}"/>',
    thu_nho: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M8 11h6" stroke="{a}"/>',
    vua_rong: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12h10M7 12l2-2M7 12l2 2M17 12l-2-2M17 12l-2 2" stroke="{a}"/>',
    vua_trang: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4" stroke="{a}"/>',
    xoay_trai: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5" stroke="{a}"/>',
    xoay_phai: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5" stroke="{a}"/>',
    tim: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke="{a}"/>',
    sua_chu: '<path d="M4 7V5h12v2M10 5v14M8 19h4"/><path d="M18.5 9.5l2 2L14 18l-3 1 1-3z" stroke="{a}"/>',
    them_chu: '<path d="M4 7V4h12v3M10 4v16M7 20h6"/><path d="M19 13v6M16 16h6" stroke="{a}"/>',
    tam_giac: '<path d="M12 4L3 20h18z"/>',
    hinh_dong: '<path d="M12 3L3 21h18z" stroke="{a}" stroke-width="2" fill="none"/><circle cx="12" cy="3" r="2.5" fill="{c}"/><circle cx="3" cy="21" r="2.5" fill="{c}"/><circle cx="21" cy="21" r="2.5" fill="{c}"/>',
    kho_hinh: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/><circle cx="6" cy="6" r="1.5" fill="{a}" stroke="none"/>',
    hcn: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>',
    elip: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
    duong: '<path d="M4 20L20 4"/>',
    mui_ten: '<path d="M4 20L20 4"/><path d="M11 4h9v9" stroke="{a}"/>',
    but: '<path d="M17 3l4 4L8 20H4v-4z"/><path d="M14 6l4 4" stroke="{a}"/>',
    to_sang: '<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" stroke="{a}"/>',
    gach_chan: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 21h16" stroke="{a}"/>',
    gach_ngang: '<path d="M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6"/><path d="M4 12h16" stroke="{r}"/>',
    ghi_chu: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6" stroke="{a}"/><path d="M7 13h8M7 17h5"/>',
    anh: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2" stroke="{a}"/><path d="M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    xoa_vung: '<path d="M7 21l-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7M5 11l9 9" stroke="{r}"/>',
    ghep: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="10" rx="1.5"/><path d="M7 13v3a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3M12 18v3" stroke="{a}"/>',
    tach: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" stroke="{a}"/>',
    trich: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M14 3v5h5v3"/><path d="M14 18h7m-3-3 3 3-3 3" stroke="{a}"/>',
    di_chuyen: '<rect x="4" y="3" width="10" height="13" rx="1.5"/><path d="M19 8v12M16 17l3 3 3-3M16 11l3-3 3 3" stroke="{a}"/>',
    xoa_trang: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6" stroke="{r}"/>',
    so_trang: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10 17h4M12 14v6" stroke="{a}"/><path d="M8 7h8M8 10h8"/>',
    trang_trong: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6" stroke="{a}"/>',
    chen_tep: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 15h8m-3-3 3 3-3 3" stroke="{a}"/>',
    pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 17v-5h2a1.5 1.5 0 0 1 0 3H8" stroke="{r}"/><path d="M14 12v5M14 12h3M14 14.5h2" stroke="{r}"/>',
    sang_word: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5" stroke="{a}"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 10l1.2 5 1.8-3.5 1.8 3.5L14 10" stroke="#2B579A"/>',
    sang_pdf: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5" stroke="{a}"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M9 15V9h2a1.7 1.7 0 0 1 0 3.4H9" stroke="{r}"/>',
    nhieu_tep: '<path d="M8 3h8l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M4 7v12a2 2 0 0 0 2 2h10" stroke="{a}"/>',
    anh_trang: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6" stroke="{a}"/>',
    thong_tin: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01" stroke="{a}"/>',
    hoan_tac: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3" stroke="{a}"/>',
    lam_lai: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3" stroke="{a}"/>',
    luoi: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/>',
    dong: '<path d="M18 6L6 18M6 6l12 12"/>',
    cai_dat: '<circle cx="12" cy="12" r="3" stroke="{a}"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    cong_thuc: '<path d="M5 18h3l3-12h6"/><path d="M9 11h5"/><path d="M15 14l5 5M20 14l-5 5" stroke="{a}"/>',
    toan_man_hinh: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    hai_trang: '<rect x="2.5" y="4" width="8.5" height="16" rx="1.5"/><rect x="13" y="4" width="8.5" height="16" rx="1.5"/>',
    che_do_doc: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" stroke="{a}"/>',
    tay_net: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9" stroke="{a}"/>',
    xoa_vung_but: '<rect x="3" y="3" width="12" height="12" rx="1.5" stroke-dasharray="2 2"/><path d="m14 14 6 6m0-6-6 6" stroke="{r}"/>',
    chong_cham_tay: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" stroke="{c}"/><path d="m14 14 6 6m0-6-6 6" stroke="{r}"/>',
    may_tinh: '<rect x="4" y="2" width="16" height="20" rx="2"/><rect x="7" y="5" width="10" height="4" rx="1" fill="{a}" stroke="none"/><path d="M7 12h2M11 12h2M15 12h2M7 15h2M11 15h2M15 15h2M7 18h2M11 18h2M15 18h2"/>'
  };

  function svg(name, size = 22, darkBg = false) {
    const c = darkBg ? '#E2E8F0' : C;
    const a = darkBg ? '#FBBF24' : A;
    const raw = PATHS[name] || PATHS.thong_tin;
    const body = raw.replace(/\{c\}/g, c).replace(/\{a\}/g, a).replace(/\{r\}/g, R);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  return { svg };
})();
