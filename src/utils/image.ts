// 来源: 新增 — 图片压缩工具

export interface CompressedImage {
  dataUrl: string;
  originalWidth: number;
  originalHeight: number;
}

const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.7;

/**
 * Compress an image (from data URL or base64) by resizing and converting to JPEG.
 * Returns the compressed data URL and original dimensions.
 */
export function compressImage(
  source: string,
  maxDimension = MAX_DIMENSION,
  quality = JPEG_QUALITY,
): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const origW = img.width;
      const origH = img.height;

      let w = origW;
      let h = origH;
      if (w > maxDimension || h > maxDimension) {
        if (w > h) {
          h = Math.round((h * maxDimension) / w);
          w = maxDimension;
        } else {
          w = Math.round((w * maxDimension) / h);
          h = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);

      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', quality),
        originalWidth: origW,
        originalHeight: origH,
      });
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));

    // Ensure data URL prefix exists so Image can load it
    if (source.startsWith('data:')) {
      img.src = source;
    } else {
      img.src = `data:image/png;base64,${source}`;
    }
  });
}
