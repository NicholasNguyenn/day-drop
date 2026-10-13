import { ApiError } from './quota.mjs';

// Inspect container dimensions without decoding potentially enormous images.
// The provider still validates image content; no URLs or remote images are fetched.
export function inspectImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  if (!match || match[2].length % 4) throw new ApiError('INVALID_IMAGE', 'Use a valid PNG, JPEG or WebP screenshot.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 8_000_000 || bytes.toString('base64') !== match[2]) throw new ApiError('INVALID_IMAGE', 'Use a valid screenshot smaller than 8 MB.');
  const mime = match[1]; let width; let height;
  if (mime === 'image/png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (mime === 'image/jpeg' && bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if ([0xd9, 0xda].includes(marker)) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  } else if (mime === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii',0,4) === 'RIFF'
    && bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString('ascii',8,12) === 'WEBP') {
    const type = bytes.toString('ascii',12,16);
    if (type === 'VP8X' && bytes.readUInt32LE(16) >= 10) {
      if (bytes[20] & 2) throw new ApiError('INVALID_IMAGE', 'Use a still screenshot, not an animated image.');
      width = bytes.readUIntLE(24,3) + 1; height = bytes.readUIntLE(27,3) + 1;
    } else if (type === 'VP8L' && bytes[20] === 0x2f && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23,26).equals(Buffer.from([0x9d,0x01,0x2a]))) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
    }
  }
  if (!width || !height) throw new ApiError('INVALID_IMAGE', 'Screenshot bytes do not match the supported image format.');
  if (width > 4096 || height > 4096 || width * height > 8_000_000) throw new ApiError('IMAGE_DIMENSIONS', 'Crop the screenshot to at most 4096 pixels per side and 8 million pixels.');
  return { width, height, bytes: bytes.length, mime };
}
