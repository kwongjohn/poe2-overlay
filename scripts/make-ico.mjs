// Wrap assets/icon-256.png into a PNG-compressed .ico (valid Vista+), which
// electron-builder requires at >=256px. Rerun after regenerating the PNG.
import fs from 'node:fs';
const png = fs.readFileSync(new URL('../assets/icon-256.png', import.meta.url));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256
entry[1] = 0; // height 256
entry.writeUInt16LE(1, 4);  // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // data offset
fs.writeFileSync(new URL('../assets/icon.ico', import.meta.url), Buffer.concat([header, entry, png]));
console.log('assets/icon.ico written:', 22 + png.length, 'bytes');
