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

function detectLayout(px, w, h) {
  let arrowStart = null, arrowEnd = null;

  for (let y = (h / 2) | 0; y < h; y++) {
    let consec = 0, maxC = 0;
    for (let x = 0; x < (w / 2) | 0; x++) {
      const p = (y * w + x) * 4;
      if (px[p] > 200 && px[p + 1] > 180 && px[p + 2] < 120) {
        consec++;
        if (consec > maxC) maxC = consec;
      } else consec = 0;
    }
    if (maxC > 50) {
      if (arrowStart === null) arrowStart = y;
      arrowEnd = y;
    } else if (arrowStart !== null) break;
  }
  if (arrowEnd === null) return null;

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

  // panel xanh có chữ giờ cũ cao 50-90px; khác => mẫu thẻ trắng, chưa hỗ trợ
  if (textTop === null || strongMin < 0 || !(textBot - textTop + 1 >= 50 && textBot - textTop + 1 <= 90)) return null;

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

  const track = fontPx * TRACKING;
  let x = penLeft;
  const baseline = inkTop + ctx.measureText(text).actualBoundingBoxAscent;
  let right = x;
  for (const ch of text) {
    const mm = ctx.measureText(ch);
    // PIL dùng advance đã hint (số nguyên); canvas trả số thực, không làm tròn thì
    // sai số cộng dồn tới vài px qua chuỗi ngày 16 ký tự
    const adv = Math.round(mm.width);
    ctx.fillText(ch, x, baseline);
    right = x + Math.max(Math.ceil(mm.actualBoundingBoxRight), adv);
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

