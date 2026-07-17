/** Longest side, in pixels, an avatar is downscaled to before encoding. */
const MAX_DIMENSION = 256;

/** Upper bound for the encoded data URL. Mirrors the server-side cap with headroom to spare. */
const MAX_DATA_URL_LENGTH = 200 * 1024;

/** JPEG quality steps tried, highest first, until the encoded avatar fits the size cap. */
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

/**
 * Read an image file, downscale it so its longest side is at most {@link MAX_DIMENSION}px, and
 * encode it as a JPEG base64 data URL under {@link MAX_DATA_URL_LENGTH}. Rejects when the file is
 * not an image or cannot be squeezed under the cap.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image.');
  }

  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to process the image.');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (const quality of QUALITY_STEPS) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) {
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

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_DIMENSION) {
    return { width, height };
  }
  const scale = MAX_DIMENSION / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
