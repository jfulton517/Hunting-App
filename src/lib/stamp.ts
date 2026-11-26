// Free, on-device reading of the date/time/temperature info strip that Browning (and most
// trail cameras) print along the bottom of each photo. Uses Tesseract OCR in the browser;
// nothing is uploaded anywhere.

export interface StampReading {
  /** Local wall-clock time printed on the photo, "YYYY-MM-DDTHH:MM" */
  local: string;
  tempF: number | null;
  text: string;
}

// Characters OCR commonly confuses with digits.
const DIGITISH: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', g: '9' };

function digitsFix(s: string): string {
  // Only touch characters sitting next to digits or separators, so words stay intact.
  return s.replace(/[OoDQIl|iZzSsBg](?=[\d:/.\-])|(?<=[\d:/.\-])[OoDQIl|iZzSsBg]/g, (c) => DIGITISH[c] ?? c);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Parse the info-strip text. Accepts US dates (M/D/YYYY, M-D-YY), ISO dates (YYYY-MM-DD),
 * 12- or 24-hour times, and °F/°C temperatures. Returns null if no plausible date+time.
 */
export function parseStamp(raw: string, now = Date.now()): StampReading | null {
  const text = digitsFix(raw.replace(/\s+/g, ' ').trim());

  let y: number | undefined, mo: number | undefined, d: number | undefined;
  const iso = /(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})/.exec(text);
  const us = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/.exec(text);
  if (iso) [y, mo, d] = [+iso[1], +iso[2], +iso[3]];
  else if (us) {
    [mo, d, y] = [+us[1], +us[2], +us[3]];
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // day-first stamp
  }
  if (y == null || mo == null || d == null || mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // Time: the first H:MM(:SS) with optional AM/PM that isn't part of the date.
  const timeRe = /(?<![\d/.\-])(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp])?\.?\s*[Mm]?\b/g;
  let h: number | undefined, mi: number | undefined;
  for (let m; (m = timeRe.exec(text)); ) {
    let hh = +m[1];
    const mm = +m[2];
    if (mm > 59) continue;
    const ap = m[4]?.toUpperCase();
    if (ap) {
      if (hh < 1 || hh > 12) continue;
      if (ap === 'P' && hh !== 12) hh += 12;
      if (ap === 'A' && hh === 12) hh = 0;
    } else if (hh > 23) continue;
    h = hh;
    mi = mm;
    break;
  }
  if (h == null || mi == null) return null;

  // Sanity: not in the future, not before cellular trail cams existed.
  const t = Date.UTC(y, mo - 1, d, h, mi);
  if (y < 2015 || t > now + 2 * 86400000) return null;

  let tempF: number | null = null;
  const f = /(-?\d{1,3})\s*[°º*o]?\s*F\b/.exec(text);
  const c = /(-?\d{1,3})\s*[°º*o]?\s*C\b/.exec(text);
  if (f && Math.abs(+f[1]) <= 130) tempF = +f[1];
  else if (c && Math.abs(+c[1]) <= 55) tempF = Math.round((+c[1] * 9) / 5 + 32);

  return { local: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`, tempF, text };
}

// ------------------------------------------------------------------ OCR (browser only)

type TesseractWorker = { recognize(img: HTMLCanvasElement): Promise<{ data: { text: string } }>; terminate(): Promise<unknown> };
let workerPromise: Promise<TesseractWorker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const w = await createWorker('eng');
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: '0123456789/:.-°ºCFAMPamp ',
      });
      return w as unknown as TesseractWorker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Crop a horizontal band, enlarge it, and make the text dark-on-light for OCR. */
function stripCanvas(bmp: ImageBitmap, fromTop: boolean, fraction: number): HTMLCanvasElement {
  const bandH = Math.max(12, Math.round(bmp.height * fraction));
  const scale = Math.min(3, Math.max(1, 1800 / bmp.width));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bandH * scale);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, fromTop ? 0 : bmp.height - bandH, bmp.width, bandH, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const mean = sum / (px.length / 4);
  const invert = mean < 128; // light text on a dark bar → flip
  for (let i = 0; i < px.length; i += 4) {
    let v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (invert) v = 255 - v;
    v = v > 150 ? 255 : v < 90 ? 0 : (v - 90) * (255 / 60);
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Read the date/time stamp from a trail-cam photo. Tries the bottom strip, then the top. */
export async function readStamp(photo: Blob, now = Date.now()): Promise<StampReading | null> {
  const run = async () => {
    const bmp = await createImageBitmap(photo);
    try {
      const worker = await getWorker();
      for (const [top, frac] of [
        [false, 0.07],
        [false, 0.12],
        [true, 0.08],
      ] as const) {
        const { data } = await worker.recognize(stripCanvas(bmp, top, frac));
        const r = parseStamp(data.text, now);
        if (r) return r;
      }
      return null;
    } finally {
      bmp.close();
    }
  };
  // One OCR at a time keeps phones responsive.
  const p = queue.then(run, run);
  queue = p.catch(() => null);
  return p;
}
