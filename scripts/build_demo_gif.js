import fs from 'fs';
import { execSync } from 'child_process';

// Convert dark and light desktop screenshots to GIFs using sips
execSync('sips -s format gif docs/screenshots/dashboard-dark-desktop.png --out /tmp/frame_dark.gif');
execSync('sips -s format gif docs/screenshots/dashboard-light-desktop.png --out /tmp/frame_light.gif');

function parseGif(buf) {
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  const hasGct = (packed & 0x80) !== 0;
  const gctEntries = 1 << ((packed & 0x07) + 1);
  const gctSize = hasGct ? 3 * gctEntries : 0;
  const gct = buf.slice(13, 13 + gctSize);

  // Find image descriptor 0x2C
  let offset = 13 + gctSize;
  while (offset < buf.length && buf[offset] !== 0x2c) {
    offset++;
  }
  const imageBlock = buf.slice(offset, buf.length - 1); // exclude trailing 0x3B
  return { width, height, gct, imageBlock };
}

const f1 = parseGif(fs.readFileSync('/tmp/frame_dark.gif'));
const f2 = parseGif(fs.readFileSync('/tmp/frame_light.gif'));

const header = Buffer.from('GIF89a');
const lsd = Buffer.alloc(7);
lsd.writeUInt16LE(f1.width, 0);
lsd.writeUInt16LE(f1.height, 2);
lsd[4] = 0x70; // no GCT in logical screen descriptor, resolution 8
lsd[5] = 0;
lsd[6] = 0;

// Netscape 2.0 application extension for infinite looping
const loopExt = Buffer.from([
  0x21, 0xff, 0x0b,
  0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // NETSCAPE2.0
  0x03, 0x01, 0x00, 0x00, 0x00
]);

function buildFrame(frame, delayCs = 150) {
  // Graphic control extension
  const gce = Buffer.from([
    0x21, 0xf9, 0x04,
    0x00,
    delayCs & 0xff, (delayCs >> 8) & 0xff,
    0x00, 0x00
  ]);

  // Patch image descriptor to specify Local Color Table (LCT)
  const imgData = Buffer.from(frame.imageBlock);
  // Image descriptor starts at 0, packed field is byte 9
  const origPacked = imgData[9];
  imgData[9] = origPacked | 0x80 | 0x07; // set LCT flag + 256 colors

  return Buffer.concat([gce, imgData.slice(0, 10), frame.gct, imgData.slice(10)]);
}

const frame1Data = buildFrame(f1, 150); // 1.5s
const frame2Data = buildFrame(f2, 150); // 1.5s
const trailer = Buffer.from([0x3b]);

const gifData = Buffer.concat([header, lsd, loopExt, frame1Data, frame2Data, trailer]);
fs.writeFileSync('docs/screenshots/drift-demo.gif', gifData);
console.log('Successfully wrote docs/screenshots/drift-demo.gif:', gifData.length, 'bytes');
