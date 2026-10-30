/** Images wider or taller are scaled down: phones' GPUs take 4096 px textures, not always more. */
const MAX_TEXTURE = 4096;

/**
 * Loads an image by an element, as the CSP lets images, not fetches, come from elsewhere.
 * Other hosts must allow it with CORS, or WebGL may not draw it (ADR-067).
 */
export async function loadImage(url: string): Promise<HTMLImageElement | HTMLCanvasElement> {
  const image = new Image();
  if (new URL(url, window.location.href).origin !== window.location.origin) {
    image.crossOrigin = 'anonymous';
  }
  image.src = url;
  await image.decode();
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const scale = Math.min(1, MAX_TEXTURE / Math.max(width, height));
  if (scale === 1) return image;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
