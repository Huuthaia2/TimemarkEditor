'use strict';
// Port 1-1 từ timemark_editor.py. Giữ nguyên mọi hằng số đã đo từ 11 file PSD Done.

const TIME_COLOR = 'rgb(251,240,90)';
const DATE_COLOR = 'rgb(255,255,255)';
const OUTPUT_LANDSCAPE = [1280, 960];
const OUTPUT_PORTRAIT = [960, 1280];
const WEEKDAYS = ['Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7', 'CN'];

const TEMPLATE_NORMAL = { time: 110, date: 30, hour_dy: -3, dots_dy: [32, 60], date_dy: 51, date_gap: 18 };
const TEMPLATE_LARGE = { time: 115, date: 35, hour_dy: -1, dots_dy: [38, 66], date_dy: 48, date_gap: 14 };
const LARGE_OLD_H = 68;
const HOUR_DX_PANEL = 6;
const DOT_SIZE = [13, 8];
const DOT_GAP_HOUR = 5;
const DOT_GAP_MIN = 5;
const TRACKING = 35 / 1000;
const MASK_PAD_TOP = 6;
const MASK_PAD_BOT = 12;
const INPAINT_RADIUS = 6;

// Số đo font lấy thẳng từ PIL/FreeType (advance, mép phải, mép mực trên) + ascent.
// Dùng bảng cứng thay cho measureText: khớp đúng từng pixel với bản Python và
// không lệ thuộc trình duyệt — Safari/Chrome đo advance khác nhau vài phần trăm px.
const METRICS = {
  'ResolveMedium110': { asc: 94, g: { "0": [39, 39, 21], "1": [21, 21, 21], "2": [33, 34, 20], "3": [34, 34, 21], "4": [33, 33, 21], "5": [34, 34, 21], "6": [38, 38, 20], "7": [30, 30, 21], "8": [35, 35, 21], "9": [37, 37, 21] } },
  'ResolveMedium115': { asc: 98, g: { "0": [41, 41, 21], "1": [22, 22, 21], "2": [35, 35, 20], "3": [35, 35, 22], "4": [34, 34, 21], "5": [35, 35, 21], "6": [40, 40, 20], "7": [31, 31, 21], "8": [36, 36, 21], "9": [39, 39, 21] } },
  'FrancoC4SA30': { asc: 28, g: { "0": [14, 14, 7], "1": [14, 14, 6], "2": [14, 14, 7], "3": [14, 14, 7], "4": [14, 14, 7], "5": [14, 14, 7], "6": [14, 14, 7], "7": [14, 14, 7], "8": [14, 14, 7], "9": [14, 14, 7], " ": [6, 6, 28], ",": [6, 6, 25], "/": [10, 10, 7], "C": [16, 16, 7], "N": [17, 17, 7], "T": [15, 15, 7], "h": [15, 15, 5] } },
  'FrancoC4SA35': { asc: 33, g: { "0": [16, 16, 8], "1": [16, 16, 7], "2": [16, 16, 8], "3": [16, 16, 8], "4": [16, 16, 8], "5": [16, 16, 8], "6": [16, 16, 8], "7": [16, 16, 8], "8": [16, 16, 8], "9": [16, 16, 8], " ": [7, 7, 33], ",": [7, 7, 29], "/": [11, 11, 8], "C": [18, 18, 8], "N": [20, 20, 8], "T": [17, 17, 8], "h": [16, 16, 6] } },
};

// Python round() làm tròn số .5 về phía chẵn, Math.round thì không
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// ===== detect_layout =====

function longestRun(flags, maxGap) {
  let bestS = 0, bestE = flags.length - 1, bestL = -1;
  let start = null, last = null;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    if (start === null || i - last > maxGap) start = i;
    last = i;
    if (last - start > bestL) { bestS = start; bestE = last; bestL = last - start; }
  }
  return [bestS, bestE];
}

// Số liệu của lần dò gần nhất, để xem khi mở trang kèm ?debug
const detectInfo = {};

function detectLayout(px, w, h) {
  return detectByArrowBar(px, w, h) || detectByTextBand(px, w, h);
}

/**
 * Cách dự phòng cho mẫu Timemark có hàng ">>>" màu xám trắng: không có thanh vàng
 * dày để bám, chỉ còn một đường kẻ vàng mảnh. Bám thẳng vào dải chữ giờ vàng,
 * đường kẻ mảnh phía trên cho bề ngang panel.
 */
function detectByTextBand(px, w, h) {
  const lim = (w * 0.6) | 0;
  const isTextYellow = (p) => px[p] > 180 && px[p + 1] > 160 && px[p + 2] < 120;

  const prof = new Int32Array(h);
  for (let y = h >> 1; y < h; y++) {
    let n = 0;
    for (let x = 0; x < lim; x++) if (isTextYellow((y * w + x) * 4)) n++;
    prof[y] = n;
  }

  // đường kẻ ngang cũng vượt ngưỡng nhưng chỉ cao 1-2px, nên phải lọc theo chiều cao
  let top = -1, bot = -1;
  for (let y = h >> 1; y < h;) {
    if (prof[y] <= 20) { y++; continue; }
    let last = y;
    for (let y2 = y + 1; y2 < h && y2 - last <= 6; y2++) if (prof[y2] > 3) last = y2;
    if (last - y + 1 >= 50 && last - y + 1 <= 90) { top = y; bot = last; break; }
    y = last + 1;
  }
  if (top < 0) { detectInfo.loi = 'khong thay dai chu gio cao 50-90px'; return null; }

  const cols = new Int32Array(lim);
  for (let y = top; y <= bot; y++)
    for (let x = 0; x < lim; x++) if (isTextYellow((y * w + x) * 4)) cols[x]++;
  let textLeft = -1;
  for (let x = 0; x < lim; x++) if (cols[x] >= 5) { textLeft = x; break; }
  if (textLeft < 0) { detectInfo.loi = 'chu gio qua mo'; return null; }

  // hàng kẻ vàng có dải liên tục rộng nhất trong 100px phía trên chữ giờ.
  // Hở tới 25px vì kẻ của mẫu này đứt quãng.
  let bestY = -1, bestS = 0, bestE = -1;
  for (let y = Math.max(0, top - 100); y < top - 1; y++) {
    let cnt = 0, s = -1, last = -1, bs = 0, be = -1;
    for (let x = 0; x < lim; x++) {
      const p = (y * w + x) * 4;
      if (!(px[p] > 150 && px[p + 1] > 130 && px[p + 2] < 140)) continue;
      cnt++;
      if (s < 0) s = x;
      else if (x - last > 25) { if (last - s > be - bs) { bs = s; be = last; } s = x; }
      last = x;
    }
    if (cnt < 60 || s < 0) continue;
    if (last - s > be - bs) { bs = s; be = last; }
    if (be - bs > bestE - bestS) { bestY = y; bestS = bs; bestE = be; }
  }
  // panel thật rộng 400-490px; hẹp hơn nhiều nghĩa là bắt nhầm (vd mẫu thẻ trắng)
  if (bestY < 0 || bestE - bestS < 200) {
    detectInfo.loi = bestY < 0 ? 'khong thay ke vang ngang tren chu gio'
      : 'panel chi rong ' + (bestE - bestS) + 'px, qua hep';
    return null;
  }

  detectInfo.loi = '';
  detectInfo.cach = 'dai-chu-gio';
  detectInfo.panel = bestS + '..' + bestE;
  detectInfo.chuCu = top + '..' + bot;
  detectInfo.caoChuCu = bot - top + 1;
  return {
    arrow: bestY, panel_x0: bestS, panel_x1: bestE,
    text_top: top, text_bot: bot, text_left: textLeft,
  };
}

function detectByArrowBar(px, w, h) {
  let arrowStart = null, arrowEnd = null;
  let bestRun = 0;

  for (let y = (h / 2) | 0; y < h; y++) {
    let consec = 0, maxC = 0;
    for (let x = 0; x < (w / 2) | 0; x++) {
      const p = (y * w + x) * 4;
      if (px[p] > 200 && px[p + 1] > 180 && px[p + 2] < 120) {
        consec++;
        if (consec > maxC) maxC = consec;
      } else consec = 0;
    }
    if (maxC > bestRun) bestRun = maxC;
    if (maxC > 50) {
      if (arrowStart === null) arrowStart = y;
      arrowEnd = y;
    } else if (arrowStart !== null) break;
  }
  detectInfo.wh = w + 'x' + h;
  detectInfo.vangDaiNhat = bestRun;
  detectInfo.arrow = arrowStart + '..' + arrowEnd;
  if (arrowEnd === null) { detectInfo.loi = 'khong thay thanh vang (can >50px)'; return null; }

  // dải cột vàng của panel: quét từ đỉnh thanh mũi tên xuống 30px
  const bandW = (w * 0.6) | 0;
  const bandY1 = Math.min(h, arrowEnd + 30);
  const colCount = new Int32Array(bandW);
  for (let y = arrowStart; y < bandY1; y++) {
    for (let x = 0; x < bandW; x++) {
      const p = (y * w + x) * 4;
      if (px[p] > 150 && px[p + 1] > 130 && px[p + 2] < 140) colCount[x]++;
    }
  }
  const [panelX0, panelX1] = longestRun(Array.from(colCount, (c) => c >= 2), 8);

  // bỏ qua hàng mũi tên >>> (trong ~25px dưới thanh vàng), chữ giờ cũ bắt đầu ~+45px
  let textTop = null, textBot = null;
  const colHits = new Int32Array(panelX1 - panelX0);
  for (let y = arrowEnd + 30; y < Math.min(h, arrowEnd + 160); y++) {
    let n = 0;
    const row = [];
    for (let x = panelX0; x < panelX1; x++) {
      const p = (y * w + x) * 4;
      const yel = px[p] > 180 && px[p + 1] > 160 && px[p + 2] < 120;
      row.push(yel);
      if (yel) n++;
    }
    if (textTop === null) {
      if (n > 20) {
        textTop = textBot = y;
        for (let i = 0; i < row.length; i++) if (row[i]) colHits[i]++;
      }
    } else if (n > 3) {
      textBot = y;
      for (let i = 0; i < row.length; i++) if (row[i]) colHits[i]++;
    } else if (y - textBot > 6) break;
  }

  let strongMin = -1;
  for (let i = 0; i < colHits.length; i++) if (colHits[i] >= 5) { strongMin = i; break; }

  detectInfo.panel = panelX0 + '..' + panelX1;
  detectInfo.chuCu = textTop === null ? 'khong thay' : textTop + '..' + textBot;
  detectInfo.caoChuCu = textTop === null ? 0 : textBot - textTop + 1;
  detectInfo.cotManh = strongMin;

  // panel xanh có chữ giờ cũ cao 50-90px; khác => mẫu thẻ trắng, chưa hỗ trợ
  const oldH = textTop === null ? 0 : textBot - textTop + 1;
  if (textTop === null || strongMin < 0 || oldH < 50 || oldH > 90) {
    detectInfo.loi = textTop === null ? 'khong thay chu gio vang'
      : strongMin < 0 ? 'chu gio qua mo'
      : 'chu gio cao ' + oldH + 'px, ngoai khoang 50-90';
    return null;
  }
  detectInfo.loi = '';

  return {
    arrow: arrowEnd, panel_x0: panelX0, panel_x1: panelX1,
    text_top: textTop, text_bot: textBot, text_left: panelX0 + strongMin,
  };
}

// ===== erase_old_text =====

function eraseOldText(px, w, h, lay) {
  const y0 = Math.max(0, lay.text_top - MASK_PAD_TOP);
  const y1 = Math.min(h, lay.text_bot + MASK_PAD_BOT);
  const x0 = Math.max(lay.panel_x0, lay.text_left - 12);
  const x1 = lay.panel_x1;
  const rw = x1 - x0, rh = y1 - y0;

  const reg = new Uint8ClampedArray(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    const src = ((y0 + y) * w + x0) * 4;
    reg.set(px.subarray(src, src + rw * 4), y * rw * 4);
  }

  const lum = rgbToGray(reg, rw, rh);
  const bg = medianBlur(lum, rw, rh, 31);

  const m = new Uint8Array(rw * rh);
  for (let i = 0, p = 0; i < m.length; i++, p += 4) {
    const r = reg[p], g = reg[p + 1], b = reg[p + 2];
    const yellow = r > 150 && g > 130 && b < 140 && r - b > 60;
    const white = (r > 170 && g > 170 && b > 170) || lum[i] - bg[i] > 45;
    if (yellow || white) m[i] = 255;
  }
  const md = dilateEllipse7(m, rw, rh);

  const mask = new Uint8Array(w * h);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++)
      if (md[y * rw + x]) mask[(y0 + y) * w + x0 + x] = 1;

  inpaintTelea(px, mask, w, h, INPAINT_RADIUS);
}

// ===== vẽ timestamp =====

// Vẽ từng ký tự có tracking như Photoshop. Trả về mép phải (pen sau ký tự cuối).
// penLeft là vị trí pen, KHÔNG phải mép mực: PIL getbbox()[0] luôn = 0 nên bản Python
// cũng đang canh theo pen. Dùng actualBoundingBoxLeft của canvas sẽ lệch đúng bằng bearing.
// Chiều dọc thì ngược lại: cả hai đều căn theo mép mực trên thật.
function drawTracked(ctx, penLeft, inkTop, text, fontPx, family, fill) {
  ctx.font = `${fontPx}px "${family}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fill;

  const m = METRICS[family + fontPx];
  const track = fontPx * TRACKING;

  // mép mực trên của cả chuỗi = ký tự cao nhất, đúng như PIL getbbox(text)[1]
  let top = Infinity;
  for (const ch of text) if (m.g[ch][2] < top) top = m.g[ch][2];
  const baseline = inkTop - top + m.asc;

  let x = penLeft, right = x;
  for (const ch of text) {
    const [adv, inkRight] = m.g[ch];
    ctx.fillText(ch, x, baseline);
    right = x + inkRight;
    x += adv + track;
  }
  return pyRound(right);
}

function drawTimestamp(ctx, lay, hour, minute, day, month, year) {
  const oldH = lay.text_bot - lay.text_top + 1;
  const t = oldH > LARGE_OLD_H ? TEMPLATE_LARGE : TEMPLATE_NORMAL;
  const k = t.time / TEMPLATE_NORMAL.time;

  const hourStr = String(hour).padStart(2, '0');
  const minStr = String(minute).padStart(2, '0');
  const top = lay.text_top;

  // panel_x0 đôi khi bị nhiễu (=0) => lùi về canh theo chữ cũ
  const hourLeft = lay.panel_x0 >= 8 && lay.panel_x0 <= 35 ? lay.panel_x0 + HOUR_DX_PANEL : lay.text_left - 6;
  const hourRight = drawTracked(ctx, hourLeft, top + t.hour_dy, hourStr, t.time, 'ResolveMedium', TIME_COLOR);

  const dotW = pyRound(DOT_SIZE[0] * k), dotH = pyRound(DOT_SIZE[1] * k);
  const cx = hourRight + pyRound(DOT_GAP_HOUR * k);
  ctx.fillStyle = TIME_COLOR;
  for (const dy of t.dots_dy) ctx.fillRect(cx, top + dy, dotW, dotH);

  const minLeft = cx + dotW + pyRound(DOT_GAP_MIN * k);
  const minRight = drawTracked(ctx, minLeft, top + t.hour_dy + 2, minStr, t.time, 'ResolveMedium', TIME_COLOR);

  const wd = (new Date(year, month - 1, day).getDay() + 6) % 7;
  const dateStr = `${WEEKDAYS[wd]}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  drawTracked(ctx, minRight + t.date_gap, top + t.date_dy, dateStr, t.date, 'FrancoC4SA', DATE_COLOR);
}

