/** Options controlling how a picked image is downscaled and encoded to a JPEG data URL. */
export interface ImageCompressionOptions {
  /** Longest side, in pixels, the image is downscaled to before encoding. */
  maxDimension: number;
  /** JPEG quality steps tried, highest first, until the encoded image fits {@link maxDataUrlLength}. */
  qualitySteps: number[];
  /** Upper bound for the encoded data URL length. */
  maxDataUrlLength: number;
}

/**
 * Read an image file, downscale it so its longest side is at most {@link ImageCompressionOptions.maxDimension}px,
 * and encode it as a JPEG base64 data URL under {@link ImageCompressionOptions.maxDataUrlLength}. Rejects when
 * the file is not an image or cannot be squeezed under the cap.
 */
export async function compressImageToDataUrl(
  file: File,
  options: ImageCompressionOptions,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image.');
  }

  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height, options.maxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to process the image.');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (const quality of options.qualitySteps) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= options.maxDataUrlLength) {
        return dataUrl;
      }
    }
    throw new Error('Image is too large. Please choose a smaller picture.');
  } finally {
    bitmap.close();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('Unable to read the selected image.');
  }
}

function scaledDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
