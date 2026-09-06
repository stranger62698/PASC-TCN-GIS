export type WatermarkCoordinateResult = {
  longitude: number | null;
  latitude: number | null;
  confidence: number | null;
  rawText: string;
};

type OcrWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;
type OcrProgress = { status: string; progress: number };

let workerPromise: Promise<OcrWorker> | null = null;
let activeProgress: ((progress: number, status: string) => void) | null = null;

export function parseWatermarkCoordinates(text: string): WatermarkCoordinateResult {
  const normalized = text
    .replace(/[Oo]/g, "0")
    .replace(/(\d)\s*\.\s*(?=\d)/g, "$1.")
    .replace(/(-?\d{1,3})[ \t]+(\d{5,8})(?!\d)/g, "$1.$2")
    .replace(/(?<=\d)[ \t]+(?=\d)/g, "");
  const tokens = [...normalized.matchAll(/(?<!\d)-?\d{1,3}\.\d{4,9}(?!\d)/g)].map(match => ({
    value: Number(match[0]),
    precision: match[0].split(".")[1]?.length ?? 0,
  })).filter(token => Number.isFinite(token.value) && Math.abs(token.value) <= 180);

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const first = tokens[index], second = tokens[index + 1];
    const precision = Math.min(first.precision, second.precision);
    if (Math.abs(first.value) <= 180 && Math.abs(second.value) <= 90) {
      return { longitude: first.value, latitude: second.value, confidence: Math.min(.95, .72 + precision * .025), rawText: text };
    }
    if (Math.abs(first.value) <= 90 && Math.abs(second.value) > 90 && Math.abs(second.value) <= 180) {
      return { longitude: second.value, latitude: first.value, confidence: Math.min(.95, .72 + precision * .025), rawText: text };
    }
  }
  return { longitude: null, latitude: null, confidence: null, rawText: text };
}

async function watermarkWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const root = window.location.origin;
      const worker = await createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: `${root}/ocr/worker.min.js`,
        corePath: `${root}/ocr/tesseract-core.wasm.js`,
        langPath: `${root}/ocr`,
        gzip: false,
        legacyCore: true,
        logger: (message: OcrProgress) => activeProgress?.(message.progress, message.status),
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "0123456789.-:",
        preserve_interword_spaces: "1",
        user_defined_dpi: "180",
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function readWatermarkCoordinates(file: File, onProgress?: (progress: number, status: string) => void): Promise<WatermarkCoordinateResult> {
  activeProgress = onProgress ?? null;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const regions = [
        { left: 0, top: .57, width: .9, height: .22, scale: 2 },
        { left: 0, top: .45, width: .9, height: .55, scale: 1.5 },
      ];
      const worker = await watermarkWorker();
      const rawTexts: string[] = [];
      for (const region of regions) {
        const source = {
          left: 0,
          top: Math.max(0, Math.floor(bitmap.height * region.top)),
          width: Math.max(1, Math.floor(bitmap.width * region.width)),
          height: Math.max(1, Math.min(bitmap.height - Math.floor(bitmap.height * region.top), Math.ceil(bitmap.height * region.height))),
        };
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(source.width * region.scale);
        canvas.height = Math.round(source.height * region.scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器无法创建照片识别画布。");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, source.left, source.top, source.width, source.height, 0, 0, canvas.width, canvas.height);
        const croppedPhoto = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("照片水印区域裁剪失败。")), "image/png"));
        const result = await worker.recognize(croppedPhoto);
        rawTexts.push(result.data.text);
        const parsed = parseWatermarkCoordinates(result.data.text);
        if (parsed.longitude !== null && parsed.latitude !== null) return parsed;
      }
      return parseWatermarkCoordinates(rawTexts.join("\n"));
    } finally {
      bitmap.close();
    }
  } finally {
    activeProgress = null;
  }
}
