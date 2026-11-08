// Turns an upload into the two files we serve: a full-size WebP and a grid thumbnail.
//
// Every photo is decoded and re-encoded, which:
// - proves it's a real still image (videos, animations and anything else are rejected),
// - strips EXIF metadata, including the GPS location phones add,
// - applies the camera's rotation so photos show up the right way.
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { HttpError } from './http';

sharp.cache(false);

const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);
const MAX_PIXELS = 100_000_000;
const MIN_SIDE = 64;

export type ImageKind = 'full' | 'thumb';

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

export function newPostId(): string {
  return randomBytes(9).toString('base64url');
}

export const POST_ID = /^[A-Za-z0-9_-]{12}$/;

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const options = { limitInputPixels: MAX_PIXELS, failOn: 'error' as const };
  let meta: Metadata;
  try {
    meta = await sharp(input, options).metadata();
  } catch {
    throw new HttpError(415, "We couldn't read that file. Try a JPEG or PNG.");
  }
  if (!meta.format || !FORMATS.has(meta.format)) {
    throw new HttpError(415, "That file type isn't supported. Try a JPEG or PNG.");
  }
  if ((meta.pages ?? 1) > 1) {
    throw new HttpError(415, 'Animated images and videos aren’t allowed. Still photos only.');
  }
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE) {
    throw new HttpError(415, 'That image is too small.');
  }
  if (meta.width * meta.height > MAX_PIXELS) {
    throw new HttpError(413, 'That image has too many pixels. Try a smaller copy.');
  }

  try {
    const base = sharp(input, options).autoOrient();
    const full = await base
      .clone()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await base
      .clone()
      .resize({ width: 720, height: 720, fit: 'outside', withoutEnlargement: true })
      .webp({ quality: 74 })
      .toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch {
    // Usually an iPhone HEIC photo, which this build of sharp can't decode.
    throw new HttpError(
      415,
      "We couldn't read that photo. If it's an iPhone HEIC file, try sharing it as a JPEG.",
    );
  }
}

export function imageFile(dataDir: string, id: string, kind: ImageKind): string {
  return path.join(dataDir, 'images', kind === 'full' ? `${id}.webp` : `${id}.thumb.webp`);
}

export async function saveImage(dataDir: string, id: string, image: ProcessedImage): Promise<void> {
  await mkdir(path.join(dataDir, 'images'), { recursive: true });
  await writeFile(imageFile(dataDir, id, 'full'), image.full);
  await writeFile(imageFile(dataDir, id, 'thumb'), image.thumb);
}

export async function deleteImage(dataDir: string, id: string): Promise<void> {
  await rm(imageFile(dataDir, id, 'full'), { force: true });
  await rm(imageFile(dataDir, id, 'thumb'), { force: true });
}
