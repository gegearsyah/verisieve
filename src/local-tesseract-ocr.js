import path from 'node:path';
import { createRequire } from 'node:module';
import { createWorker, OEM } from 'tesseract.js';

const require = createRequire(import.meta.url);

function resolveLocalAssets() {
  const coreEntry = require.resolve('tesseract.js-core');
  const languageData = require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  return {
    corePath: path.dirname(coreEntry),
    langPath: path.dirname(languageData),
  };
}

function prepareImageForOcr(image) {
  const scale = image.width < 1000 && image.height < 1000
    ? Math.min(2, Math.max(1, Math.floor(1800 / Math.max(image.width, image.height))))
    : 1;
  const width = Math.min(3200, image.width * scale);
  const height = Math.min(3200, image.height * scale);
  const scaleX = width / image.width;
  const scaleY = height / image.height;
  const sampleStride = Math.max(3, Math.floor(image.rgb.length / 4096 / 3) * 3);
  let luminanceSum = 0;
  let samples = 0;
  for (let i = 0; i + 2 < image.rgb.length; i += sampleStride) {
    luminanceSum += 0.2126 * image.rgb[i] + 0.7152 * image.rgb[i + 1] + 0.0722 * image.rgb[i + 2];
    samples += 1;
  }
  const invert = samples > 0 && luminanceSum / samples < 105;
  const rgb = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scaleY));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scaleX));
      const sourceOffset = (sourceY * image.width + sourceX) * 3;
      const targetOffset = (y * width + x) * 3;
      rgb[targetOffset] = invert ? 255 - image.rgb[sourceOffset] : image.rgb[sourceOffset];
      rgb[targetOffset + 1] = invert ? 255 - image.rgb[sourceOffset + 1] : image.rgb[sourceOffset + 1];
      rgb[targetOffset + 2] = invert ? 255 - image.rgb[sourceOffset + 2] : image.rgb[sourceOffset + 2];
    }
  }

  return { image: { width, height, rgb }, scaleX, scaleY };
}

export function encodeRgbAsBmp({ width, height, rgb }) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('INVALID_RGB_IMAGE: Width and height must be positive integers');
  }
  if (!(rgb instanceof Uint8Array) || rgb.length !== width * height * 3) {
    throw new Error('INVALID_RGB_IMAGE: Expected width*height*3 RGB bytes');
  }

  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const output = Buffer.alloc(54 + pixelBytes);
  output.write('BM', 0, 'ascii');
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(0, 30);
  output.writeUInt32LE(pixelBytes, 34);

  for (let y = 0; y < height; y++) {
    const sourceRow = y * width * 3;
    const targetRow = 54 + (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x++) {
      const source = sourceRow + x * 3;
      const target = targetRow + x * 3;
      output[target] = rgb[source + 2];
      output[target + 1] = rgb[source + 1];
      output[target + 2] = rgb[source];
    }
  }

  return output;
}

export function createLocalTesseractOcrProvider(options = {}) {
  let workerPromise;
  let closed = false;
  const assets = resolveLocalAssets();

  const getWorker = async () => {
    if (closed) throw new Error('TESSERACT_WORKER_CLOSED');
    if (!workerPromise) {
      const workerOptions = {
        ...assets,
        gzip: true,
        cacheMethod: 'none',
      };
      if (typeof options.logger === 'function') workerOptions.logger = options.logger;
      workerPromise = createWorker('eng', OEM.LSTM_ONLY, {
        ...workerOptions,
      }).catch((error) => {
        workerPromise = undefined;
        throw error;
      });
    }
    return await workerPromise;
  };

  const extractLinesWithBbox = (data) => {
    if (Array.isArray(data?.lines) && data.lines.length > 0) return data.lines;
    const flat = [];
    for (const block of data?.blocks || []) {
      for (const para of block?.paragraphs || []) {
        for (const line of para?.lines || []) {
          if (line?.text && line?.bbox) flat.push(line);
        }
      }
    }
    return flat;
  };

  const normalizeResult = (result, scaleX = 1, scaleY = 1, includeConfidence = false) => {
    const lines = extractLinesWithBbox(result?.data);
    if (lines.length > 0) {
      return lines
        .map((line) => ({
          text: String(line.text || '').trim(),
          bbox: [
            line.bbox.x0 / scaleX,
            line.bbox.y0 / scaleY,
            line.bbox.x1 / scaleX,
            line.bbox.y1 / scaleY,
          ],
          confidence: Math.max(0, Math.min(1, (line.confidence || 0) / 100)),
        }))
        .filter((l) => l.text.length > 0);
    }
    const confidence = result?.data?.confidence;
    const text = result?.data?.text || '';
    if (!includeConfidence || typeof confidence !== 'number') return text;
    return { text, confidence: Math.max(0, Math.min(1, confidence / 100)) };
  };

  const provider = async (tile) => {
    const worker = await getWorker();
    const result = await worker.recognize(encodeRgbAsBmp(tile), {}, { blocks: true });
    return normalizeResult(result);
  };

  provider.recognizeImage = async (image) => {
    const prepared = prepareImageForOcr(image);
    const worker = await getWorker();
    const result = await worker.recognize(encodeRgbAsBmp(prepared.image), {}, { blocks: true });
    return normalizeResult(result, prepared.scaleX, prepared.scaleY, true);
  };

  provider.close = async () => {
    closed = true;
    if (workerPromise) {
      const worker = await workerPromise;
      await worker.terminate();
      workerPromise = undefined;
    }
  };

  return provider;
}
