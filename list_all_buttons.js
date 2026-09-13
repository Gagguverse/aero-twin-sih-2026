const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
let match;
const buttons = [];

while ((match = buttonRegex.exec(html)) !== null) {
  const attrs = match[1];
  const inner = match[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
  const idMatch = attrs.match(/id=["']([^"']+)["']/i);
  const dataMatches = [...attrs.matchAll(/data-([a-z0-9-]+)=["']([^"']+)["']/gi)].map(m => `data-${m[1]}="${m[2]}"`);
  const classMatch = attrs.match(/class=["']([^"']+)["']/i);
  
  buttons.push({
    id: idMatch ? idMatch[1] : null,
    data: dataMatches,
    cls: classMatch ? classMatch[1] : '',
    text: inner
  });
}

console.log(`ALL ${buttons.length} BUTTONS:`);
buttons.forEach((b, i) => {
  console.log(`${(i + 1).toString().padStart(2, '0')}. ID: [${b.id || 'none'}] | DATA: [${b.data.join(', ')}] | CLASS: [${b.cls}] | TEXT: "${b.text}"`);
});
