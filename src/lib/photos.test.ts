import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { expandFiles, fingerprint } from './photos';

const bytes = (n: number) => new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * n) % 256));

describe('bulk photo import helpers', () => {
  it('unpacks photos from a ZIP and ignores junk', async () => {
    const zip = zipSync({
      'Ridge Cam/PICT0001.JPG': bytes(1),
      'Ridge Cam/PICT0002.jpg': bytes(2),
      '__MACOSX/Ridge Cam/._PICT0001.JPG': bytes(3),
      'Ridge Cam/notes.txt': bytes(4),
    });
    const files = [
      new File([zip as BlobPart], 'strikeforce-download.zip', { type: 'application/zip' }),
      new File([bytes(5) as BlobPart], 'IMG_1234.JPG', { type: 'image/jpeg' }),
      new File(['hello'], 'readme.pdf', { type: 'application/pdf' }),
    ];
    const { images, ignored } = await expandFiles(files);
    expect(images.map((f) => f.name).sort()).toEqual(['IMG_1234.JPG', 'PICT0001.JPG', 'PICT0002.jpg']);
    expect(ignored).toBe(1);
    expect(images.every((f) => f.type === 'image/jpeg')).toBe(true);
  });

  it('fingerprints identical photos identically', async () => {
    const a = await fingerprint(new File([bytes(7) as BlobPart], 'a.jpg'));
    const b = await fingerprint(new File([bytes(7) as BlobPart], 'copy of a.jpg'));
    const c = await fingerprint(new File([bytes(8) as BlobPart], 'c.jpg'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
