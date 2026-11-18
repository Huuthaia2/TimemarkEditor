'use strict';
// Giao diện. Phần xử lý ảnh nằm ở inpaint.js + timemark.js.

const $ = (id) => document.getElementById(id);
const canvas = $('cv');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let baseImage = null;   // ImageData đã xóa chữ cũ (tính 1 lần mỗi ảnh)
let layout = null;
let loadSeq = 0;        // chọn ảnh mới giữa chừng thì bỏ kết quả của ảnh cũ

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = kind || '';
}

async function loadImage(file) {
  const seq = ++loadSeq;
  setStatus('Đang xử lý ảnh…', 'busy');
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const [w, h] = bmp.height > bmp.width ? OUTPUT_PORTRAIT : OUTPUT_LANDSCAPE;
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const img = ctx.getImageData(0, 0, w, h);
    layout = detectLayout(img.data, w, h);
    if (!layout) {
      baseImage = null;
      setStatus('Không nhận ra mẫu Timemark panel xanh (thanh >>> + giờ vàng). Mẫu thẻ trắng chưa hỗ trợ.', 'err');
      return;
    }

    // nhường 1 frame để trình duyệt kịp vẽ dòng trạng thái trước khi chạy inpaint
    await new Promise((r) => setTimeout(r, 0));
    if (seq !== loadSeq) return;
    eraseOldText(img.data, w, h, layout);
    baseImage = img;
    setStatus('');
    render();
  } catch (e) {
    if (seq !== loadSeq) return;
    baseImage = null;
    setStatus('Lỗi đọc ảnh: ' + e.message, 'err');
  }
}

function render() {
  const [hh, mm] = $('time').value.split(':').map(Number);
  const [yy, mo, dd] = $('date').value.split('-').map(Number);
  if ([hh, mm, yy, mo, dd].some((v) => !Number.isFinite(v))) return;
  $('weekday').textContent = WEEKDAYS[(new Date(yy, mo - 1, dd).getDay() + 6) % 7];

  if (!baseImage || !layout) return;
  ctx.putImageData(baseImage, 0, 0);
  drawTimestamp(ctx, layout, hh, mm, dd, mo, yy);
}

function save() {
  if (!baseImage) { setStatus('Chưa có ảnh để lưu.', 'err'); return; }
  const [hh, mm] = $('time').value.split(':');
  const [yy, mo, dd] = $('date').value.split('-');
  const name = `${dd}-${mo}-${yy}_${hh}-${mm}.png`;

  // Phải làm đồng bộ: iOS Safari huỷ navigator.share nếu đi qua await
  const url = canvas.toDataURL('image/png');
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const file = new File([buf], name, { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

function initDate() {
  const n = new Date();
  $('date').value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  $('time').value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

async function main() {
  initDate();
  const fonts = [
    new FontFace('ResolveMedium', 'url(fonts/resolve-sans-w05-medium-cn.otf)'),
    new FontFace('FrancoC4SA', 'url(fonts/Franco-C4SA.ttf)'),
  ];
  await Promise.all(fonts.map((f) => f.load().then((ff) => document.fonts.add(ff))));

  $('file').addEventListener('change', (e) => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });
  $('time').addEventListener('input', render);
  $('date').addEventListener('input', render);
  $('save').addEventListener('click', save);
  canvas.addEventListener('click', () => canvas.classList.toggle('zoom'));
  render();
}

main();
