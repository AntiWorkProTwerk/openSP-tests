const B2_OFFSET = 0x288000;
const APP1_MAXIMUM = 0x37f000;
const SECTOR_BYTES = 4096;
const B2_MARKER = 0x52420201;

export type StockUsbRouteImage = Readonly<{
  format: 'stock-derived-b2-spuafw10-abi2';
  bytes: number;
  paddedBytes: number;
  sectors: number;
  b2Offset: number;
  retainedB2Marker: number;
}>;

const word = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
const fail = (message: string): never => { throw new TypeError(message); };

/** Verify the exact stock-derived ABI2 envelope consumed by the held R50 route. */
export function inspectStockUsbRouteImage(bytes: Uint8Array): StockUsbRouteImage {
  const n = bytes.byteLength;
  if (n < B2_OFFSET + 0x800 || n > APP1_MAXIMUM || (n & 3) !== 0) fail('OpenSynth is outside the APP1 USB extent.');
  if (word(bytes, 0) !== 0xbffef287) fail('OpenSynth does not start with the qualified B2 branch.');
  const tail = n - B2_OFFSET, h = B2_OFFSET + 0x200;
  if (new TextDecoder('ascii').decode(bytes.subarray(h, h + 8)) !== 'SPUAFW10') fail('OpenSynth has no B2 envelope.');
  const version = word(bytes, h + 8), tailBytes = word(bytes, h + 12), runtimeBase = word(bytes, h + 16);
  const runtimeBytes = word(bytes, h + 20), runtimeOffset = word(bytes, h + 24), stack = word(bytes, h + 28);
  if (version !== 2 || tailBytes !== tail || runtimeBase !== 0x80000000 || runtimeOffset !== 0x400 ||
      stack !== 0x20243000 || runtimeBytes < 0x400 || runtimeBytes > tail - 0x400 ||
      word(bytes, B2_OFFSET + 0x400) !== stack) fail('OpenSynth B2 ABI, size or runtime differs.');
  const magic = word(bytes, h + 32), bridgeBytes = word(bytes, h + 36), dataAddress = word(bytes, h + 40);
  const dataBytes = word(bytes, h + 44), payloadOffset = word(bytes, h + 48), payloadBytes = word(bytes, h + 52);
  if (magic !== 0x32425053 || word(bytes, h + 56) !== 0 || word(bytes, h + 60) !== 0 ||
      bridgeBytes < 0x800 || bridgeBytes > 0x10000 || (bridgeBytes & 3) !== 0 ||
      runtimeBytes > 0x10000 || (runtimeBytes & 31) !== 0 || runtimeBytes > bridgeBytes - 0x400 ||
      dataBytes !== bridgeBytes - 0x400 - runtimeBytes || (dataBytes & 3) !== 0 ||
      dataAddress < 0x2023f000 || dataAddress > 0x20242000 || (dataAddress & 3) !== 0 ||
      dataBytes > 0x20242000 - dataAddress || payloadOffset < ((bridgeBytes + 31) & ~31) ||
      (payloadOffset & 31) !== 0 || payloadOffset > tail || payloadBytes === 0 || (payloadBytes & 3) !== 0 ||
      payloadBytes !== tail - payloadOffset) fail('OpenSynth B2 bridge, data or payload interval differs.');
  let marker = false;
  for (let offset = B2_OFFSET; offset + 4 <= n; offset += 4) if (word(bytes, offset) === B2_MARKER) { marker = true; break; }
  if (!marker) fail('OpenSynth does not retain the B2 update marker.');
  const paddedBytes = Math.ceil(n / SECTOR_BYTES) * SECTOR_BYTES;
  if (paddedBytes > APP1_MAXIMUM) fail('OpenSynth sector extent exceeds the APP1 writer capacity.');
  return Object.freeze({format:'stock-derived-b2-spuafw10-abi2',bytes:n,paddedBytes,
    sectors:paddedBytes / SECTOR_BYTES,b2Offset:B2_OFFSET,retainedB2Marker:B2_MARKER});
}
