const fs = require('fs');
const mod = fs.readFileSync('index_modular.html', 'utf8');
const full = fs.readFileSync('index.html', 'utf8');

const modApp = mod.substring(mod.indexOf('<div id="app-container">'), mod.indexOf('<!-- Application Scripts -->')).trim();
const fullApp = full.substring(full.indexOf('<div id="app-container">'), full.indexOf('<!-- Application Scripts -->')).trim();

const modLines = modApp.split('\n');
const fullLines = fullApp.split('\n');
console.log('Mod lines:', modLines.length, 'Full lines:', fullLines.length);

let diffCount = 0;
for (let i = 0; i < Math.min(modLines.length, fullLines.length); i++) {
  if (modLines[i].trim() !== fullLines[i].trim()) {
    console.log('Line ' + i + ':');
    console.log('  MOD : ' + modLines[i].trim());
    console.log('  FULL: ' + fullLines[i].trim());
    diffCount++;
    if (diffCount > 10) break;
  }
}
console.log('Total diff count:', diffCount);
