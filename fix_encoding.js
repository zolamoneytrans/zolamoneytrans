const fs = require('fs');

const win1252 = {
  '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84,
  '\u2026': 0x85, '\u2020': 0x86, '\u2021': 0x87, '\u02C6': 0x88,
  '\u2030': 0x89, '\u0160': 0x8A, '\u2039': 0x8B, '\u0152': 0x8C,
  '\u017D': 0x8E, '\u2018': 0x91, '\u2019': 0x92, '\u201C': 0x93,
  '\u201D': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
  '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9A, '\u203A': 0x9B,
  '\u0153': 0x9C, '\u017E': 0x9E, '\u0178': 0x9F
};

function fixFile(inputFile, outputFile) {
  const content = fs.readFileSync(inputFile, 'utf8');
  const buffer = Buffer.alloc(content.length);
  let j = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const code = char.charCodeAt(0);
    if (win1252[char] !== undefined) {
      buffer[j++] = win1252[char];
    } else if (code <= 0xFF) {
      buffer[j++] = code;
    } else {
      // If we encounter a character that isn't in win1252 and > 0xFF,
      // it means it wasn't corrupted or it's a completely different issue.
      // But let's assume it was corrupted as Windows-1252.
      // Actually, Get-Content might have seen a byte it didn't know and turned it into ? (0x3F)
      buffer[j++] = 0x3F; // fallback
    }
  }
  
  // Now buffer contains the ORIGINAL UTF-8 bytes!
  const finalBuffer = buffer.slice(0, j);
  fs.writeFileSync(outputFile, finalBuffer);
}

fixFile('nopage_corrupted.html', 'www/nopage.html');
console.log("Fixed nopage.html");
