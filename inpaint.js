'use strict';
// Các phép xử lý ảnh port từ OpenCV (cvtColor / medianBlur / dilate / inpaint TELEA).
// Viết tay vì bản opencv.js dựng sẵn thiếu 3 hàm cuối, mà tải nguyên 10MB chỉ để dùng 4 hàm thì quá phí.

const KNOWN = 0, BAND = 1, INSIDE = 2;
const INF = 1e6;

// OpenCV COLOR_RGB2GRAY: fixed point 14 bit, giống hệt cv2 để khỏi lệch 1 đơn vị
function rgbToGray(rgb, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (rgb[p] * 4899 + rgb[p + 1] * 9617 + rgb[p + 2] * 1868 + 8192) >> 14;
  }
  return g;
}

// medianBlur ksize lẻ, biên BORDER_REPLICATE. Histogram trượt ngang cho nhanh.
function medianBlur(src, w, h, k) {
  const r = k >> 1, half = (k * k) >> 1, dst = new Uint8Array(w * h);
  const hist = new Int32Array(256);

  // bảng tra chỉ số đã kẹp biên: tra bằng (toạ độ + r), tránh clamp trong vòng lặp nóng
  const xc = new Int32Array(w + 2 * r);
  for (let i = 0; i < xc.length; i++) xc[i] = Math.min(w - 1, Math.max(0, i - r));
  const yo = new Int32Array(h + 2 * r);
  for (let i = 0; i < yo.length; i++) yo[i] = Math.min(h - 1, Math.max(0, i - r)) * w;

  for (let y = 0; y < h; y++) {
    hist.fill(0);
    for (let dy = 0; dy < k; dy++) {
      const ro = yo[y + dy];
      for (let dx = 0; dx < k; dx++) hist[src[ro + xc[dx]]]++;
    }
    let cnt = 0, v = 0;
    while (cnt <= half) cnt += hist[v++];
    dst[y * w] = v - 1;

    for (let x = 1; x < w; x++) {
      const rem = xc[x - 1], add = xc[x + 2 * r];
      for (let dy = 0; dy < k; dy++) {
        const ro = yo[y + dy];
        hist[src[ro + rem]]--;
        hist[src[ro + add]]++;
      }
      cnt = 0; v = 0;
      while (cnt <= half) cnt += hist[v++];
      dst[y * w + x] = v - 1;
    }
  }
  return dst;
}

// Nhân 7x7 hình ellipse của OpenCV getStructuringElement(MORPH_ELLIPSE, (7,7))
const ELLIPSE7 = [
  [3, 3], [1, 5], [0, 6], [0, 6], [0, 6], [1, 5], [3, 3],
];

function dilateEllipse7(src, w, h) {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let i = 0; i < 7; i++) {
        const yy = y + i - 3;
        if (yy < 0 || yy >= h) continue;
        const [j1, j2] = ELLIPSE7[i];
        for (let j = j1; j <= j2; j++) {
          const xx = x + j - 3;
          if (xx >= 0 && xx < w) dst[yy * w + xx] = 255;
        }
      }
    }
  }
  return dst;
}

// ---- Min-heap theo giá trị T ----
class Heap {
  constructor() { this.v = []; this.i = []; }
  get size() { return this.i.length; }
  push(t, idx) {
    const v = this.v, i = this.i;
    v.push(t); i.push(idx);
    let c = i.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (v[p] <= v[c]) break;
      [v[p], v[c]] = [v[c], v[p]];
      [i[p], i[c]] = [i[c], i[p]];
      c = p;
    }
  }
  pop() {
    const v = this.v, i = this.i, top = i[0], n = i.length - 1;
    v[0] = v[n]; i[0] = i[n]; v.pop(); i.pop();
    let p = 0;
    for (;;) {
      const l = p * 2 + 1, r = l + 1;
      let s = p;
      if (l < n && v[l] < v[s]) s = l;
      if (r < n && v[r] < v[s]) s = r;
      if (s === p) break;
      [v[p], v[s]] = [v[s], v[p]];
      [i[p], i[s]] = [i[s], i[p]];
      p = s;
    }
    return top;
  }
}

// Giải phương trình Eikonal cho 1 điểm, công thức y hệt FastMarching_solve của OpenCV
function solve(i1, j1, i2, j2, f, t, w) {
  const k1 = i1 * w + j1, k2 = i2 * w + j2;
  const a11 = t[k1], a22 = t[k2], m12 = Math.min(a11, a22);
  if (f[k1] !== INSIDE) {
    if (f[k2] !== INSIDE) {
      const d = a11 - a22;
      return Math.abs(d) >= 1 ? 1 + m12 : (a11 + a22 + Math.sqrt(2 - d * d)) * 0.5;
    }
    return 1 + a11;
  }
  if (f[k2] !== INSIDE) return 1 + a22;
  return 1 + m12;
}

// FMM chỉ tính khoảng cách T (dùng cho vùng NGOÀI mask)
function calcFMM(f, t, heap, w, h) {
  const nb = [-w, -1, w, 1];
  while (heap.size > 0) {
    const k = heap.pop();
    f[k] = KNOWN;
    const i = (k / w) | 0, j = k % w;
    for (let q = 0; q < 4; q++) {
      const kk = k + nb[q];
      const ii = i + (q === 0 ? -1 : q === 2 ? 1 : 0);
      const jj = j + (q === 1 ? -1 : q === 3 ? 1 : 0);
      if (ii <= 0 || jj <= 0 || ii >= h - 1 || jj >= w - 1) continue;
      if (f[kk] !== INSIDE) continue;
      const d = Math.min(
        solve(ii - 1, jj, ii, jj - 1, f, t, w), solve(ii + 1, jj, ii, jj - 1, f, t, w),
        solve(ii - 1, jj, ii, jj + 1, f, t, w), solve(ii + 1, jj, ii, jj + 1, f, t, w));
      t[kk] = d;
      f[kk] = BAND;
      heap.push(d, kk);
    }
  }
}

/**
 * Inpaint TELEA (Telea 2004) — port từ icvTeleaInpaintFMM của OpenCV.
 * rgba: Uint8ClampedArray ảnh RGBA; mask: Uint8Array khác 0 = vùng cần vá.
 */
function inpaintTelea(rgba, mask, w, h, range) {
  const n = w * h;
  const f = new Uint8Array(n), t = new Float32Array(n);
  const heap = new Heap();

  for (let k = 0; k < n; k++) {
    if (mask[k]) { f[k] = INSIDE; t[k] = INF; }
  }
  // Viền ngoài sát mask = BAND (T = 0), là nơi FMM bắt đầu lan vào
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (f[k] !== KNOWN) continue;
      if (f[k - 1] === INSIDE || f[k + 1] === INSIDE || f[k - w] === INSIDE || f[k + w] === INSIDE) {
        f[k] = BAND;
        heap.push(0, k);
      }
    }
  }

  // Trường T âm phía ngoài mask: để lev(p,q) phân biệt được pixel gần/xa biên.
  // Không có nó thì mọi pixel ngoài đều T=0, lev thành hằng số và mất tác dụng.
  {
    let y0 = h, y1 = -1, x0 = w, x1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (y1 < 0) return;
    y0 = Math.max(1, y0 - range); y1 = Math.min(h - 2, y1 + range);
    x0 = Math.max(1, x0 - range); x1 = Math.min(w - 2, x1 + range);

    // giãn mask bằng hình vuông bán kính range, tách 2 chiều cho nhanh
    const hor = new Uint8Array(n), box = new Uint8Array(n);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        for (let d = -range; d <= range; d++) {
          const xx = x + d;
          if (xx >= 0 && xx < w && mask[y * w + xx]) { hor[y * w + x] = 1; break; }
        }
      }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        for (let d = -range; d <= range; d++) {
          const yy = y + d;
          if (yy >= 0 && yy < h && hor[yy * w + x]) { box[y * w + x] = 1; break; }
        }
      }

    const fo = new Uint8Array(n), to = new Float32Array(n), ho = new Heap();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = y * w + x;
        if (!mask[k] && box[k]) { fo[k] = INSIDE; to[k] = INF; }
      }
    for (let k = 0; k < n; k++) if (mask[k]) { fo[k] = BAND; ho.push(0, k); }
    calcFMM(fo, to, ho, w, h);
    for (let k = 0; k < n; k++) if (!mask[k] && to[k] > 0 && to[k] < INF) t[k] = -to[k];
  }

  const nb = [-w, -1, w, 1];
  const r2 = range * range;
  const w4 = w * 4;
  // dst = 1/(len^3) tra sẵn theo len^2; dxMax = nửa bề rộng hình tròn theo từng dy
  const DST = new Float64Array(r2 + 1);
  for (let d = 1; d <= r2; d++) DST[d] = 1 / (d * Math.sqrt(d));
  const dxMax = new Int32Array(range + 1);
  for (let d = 0; d <= range; d++) dxMax[d] = Math.floor(Math.sqrt(r2 - d * d));
  const Ia = new Float64Array(3), Jx = new Float64Array(3), Jy = new Float64Array(3);

  while (heap.size > 0) {
    const k0 = heap.pop();
    f[k0] = KNOWN;
    const i = (k0 / w) | 0, j = k0 % w;

    for (let q = 0; q < 4; q++) {
      const kk = k0 + nb[q];
      const ii = i + (q === 0 ? -1 : q === 2 ? 1 : 0);
      const jj = j + (q === 1 ? -1 : q === 3 ? 1 : 0);
      if (ii <= 1 || jj <= 1 || ii >= h - 1 || jj >= w - 1) continue;
      if (f[kk] !== INSIDE) continue;

      const dist = Math.min(
        solve(ii - 1, jj, ii, jj - 1, f, t, w), solve(ii + 1, jj, ii, jj - 1, f, t, w),
        solve(ii - 1, jj, ii, jj + 1, f, t, w), solve(ii + 1, jj, ii, jj + 1, f, t, w));
      t[kk] = dist;

      // gradient của T tại điểm đang vá (pháp tuyến của level-set)
      let gTx, gTy;
      if (f[kk + 1] !== INSIDE) gTx = f[kk - 1] !== INSIDE ? (t[kk + 1] - t[kk - 1]) * 0.5 : t[kk + 1] - t[kk];
      else gTx = f[kk - 1] !== INSIDE ? t[kk] - t[kk - 1] : 0;
      if (f[kk + w] !== INSIDE) gTy = f[kk - w] !== INSIDE ? (t[kk + w] - t[kk - w]) * 0.5 : t[kk + w] - t[kk];
      else gTy = f[kk - w] !== INSIDE ? t[kk] - t[kk - w] : 0;

      // 3 màu dùng chung trọng số và cờ lân cận => chỉ duyệt vùng tròn một lần
      Ia[0] = Ia[1] = Ia[2] = Jx[0] = Jx[1] = Jx[2] = Jy[0] = Jy[1] = Jy[2] = 0;
      let s = 1e-20;
      const tkk = t[kk];
      const kr0 = Math.max(1, ii - range), kr1 = Math.min(h - 2, ii + range);

      for (let kr = kr0; kr <= kr1; kr++) {
        const ry = ii - kr;
        const dm = dxMax[ry < 0 ? -ry : ry];
        const lr0 = Math.max(1, jj - dm), lr1 = Math.min(w - 2, jj + dm);
        const rowOff = kr * w;
        for (let lr = lr0; lr <= lr1; lr++) {
          const kq = rowOff + lr;
          if (f[kq] === INSIDE) continue;
          const rx = jj - lr;
          const len2 = rx * rx + ry * ry;
          if (len2 === 0) continue;

          let dir = rx * gTx + ry * gTy;
          if (dir <= 0.01 && dir >= -0.01) dir = 1e-6;
          let wgt = DST[len2] / (1 + Math.abs(t[kq] - tkk)) * dir;
          if (wgt < 0) wgt = -wgt;
          s += wgt;

          const xp = f[kq + 1] !== INSIDE, xm = f[kq - 1] !== INSIDE;
          const yp = f[kq + w] !== INSIDE, ym = f[kq - w] !== INSIDE;
          const p0 = kq * 4;
          for (let c = 0; c < 3; c++) {
            const p = p0 + c;
            const v = rgba[p];
            let gIx, gIy;
            if (xp) gIx = xm ? (rgba[p + 4] - rgba[p - 4]) * 2 : rgba[p + 4] - v;
            else gIx = xm ? v - rgba[p - 4] : 0;
            if (yp) gIy = ym ? (rgba[p + w4] - rgba[p - w4]) * 2 : rgba[p + w4] - v;
            else gIy = ym ? v - rgba[p - w4] : 0;
            Ia[c] += wgt * v;
            Jx[c] -= wgt * gIx * rx;
            Jy[c] -= wgt * gIy * ry;
          }
        }
      }
      for (let c = 0; c < 3; c++) {
        rgba[kk * 4 + c] = Ia[c] / s + (Jx[c] + Jy[c]) / (Math.sqrt(Jx[c] * Jx[c] + Jy[c] * Jy[c]) + 1e-20) + 0.5;
      }

      f[kk] = BAND;
      heap.push(dist, kk);
    }
  }
}
