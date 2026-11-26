import { describe, expect, it } from 'vitest';
import { parseStamp } from './stamp';

const NOW = Date.UTC(2026, 10, 26, 18);

describe('trail-cam info strip parsing', () => {
  it('reads a typical Browning strip', () => {
    const r = parseStamp('BROWNING  31°F -1°C  11/24/2026  06:52:13 AM', NOW)!;
    expect(r.local).toBe('2026-11-24T06:52');
    expect(r.tempF).toBe(31);
  });

  it('handles PM, two-digit years and noon/midnight', () => {
    expect(parseStamp('45F 11/20/26 4:37 PM', NOW)!.local).toBe('2026-11-20T16:37');
    expect(parseStamp('11/20/2026 12:05 AM', NOW)!.local).toBe('2026-11-20T00:05');
    expect(parseStamp('11/20/2026 12:05 PM', NOW)!.local).toBe('2026-11-20T12:05');
  });

  it('handles 24-hour and ISO formats and Celsius only', () => {
    const r = parseStamp('2026-11-19 17:44:02  -3°C', NOW)!;
    expect(r.local).toBe('2026-11-19T17:44');
    expect(r.tempF).toBe(27);
  });

  it('repairs common OCR digit mistakes', () => {
    const r = parseStamp('3lF  1l/2O/2O26  O6:5S:13 AM', NOW)!;
    expect(r.local).toBe('2026-11-20T06:55');
  });

  it('rejects junk and impossible dates', () => {
    expect(parseStamp('BROWNING STRIKE FORCE', NOW)).toBeNull();
    expect(parseStamp('13/45/2026 06:00', NOW)).toBeNull();
    expect(parseStamp('11/24/2031 06:52 AM', NOW)).toBeNull(); // future
    expect(parseStamp('11/24/2026', NOW)).toBeNull(); // no time
  });
});
