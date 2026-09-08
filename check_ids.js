const fs = require('fs');
const files = ['storage.js', 'app-core.js', 'app-features.js', 'app-pages.js', 'app-wiring.js'];
const html = fs.readFileSync('index.html', 'utf8');

let js = '';
files.forEach((f) => (js += fs.readFileSync(f, 'utf8')));

const ids = new Set();
const re = /getElementById\(['"]([^'"]+)['"]\)/g;
let m;
while ((m = re.exec(js)) !== null) ids.add(m[1]);

const missing = [];
ids.forEach((id) => {
  if (!html.includes('id="' + id + '"')) missing.push(id);
});

console.log('TOTAL JS IDs referenced:', ids.size);
if (missing.length) {
  console.log('MISSING FROM HTML:');
  missing.forEach((x) => console.log('  -', x));
} else {
  console.log('All IDs present in HTML');
}