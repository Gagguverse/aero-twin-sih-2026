const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const jsFiles = ['js/app.js', 'js/engine-3d.js', 'js/component-3d.js', 'js/mission-planner.js', 'js/fault-simulator.js', 'js/report-generator.js', 'js/hardware-link.js'];

let allJsCode = '';
jsFiles.forEach(f => {
  if (fs.existsSync(f)) {
    allJsCode += '\n// ' + f + '\n' + fs.readFileSync(f, 'utf8');
  }
});

// 1. Find all buttons
const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
let match;
const buttons = [];

while ((match = buttonRegex.exec(html)) !== null) {
  const attrs = match[1];
  const inner = match[2].replace(/<[^>]+>/g, '').trim().substring(0, 30);
  
  const idMatch = attrs.match(/id=["']([^"']+)["']/i);
  const dataMatches = [...attrs.matchAll(/data-([a-z0-9-]+)=["']([^"']+)["']/gi)].map(m => m[1] + '="' + m[2] + '"');
  const classMatch = attrs.match(/class=["']([^"']+)["']/i);
  
  buttons.push({
    id: idMatch ? idMatch[1] : null,
    data: dataMatches,
    cls: classMatch ? classMatch[1] : '',
    text: inner,
    fullAttrs: attrs
  });
}

console.log(`Found ${buttons.length} buttons in index.html.\n`);

// 2. Find all inputs and selects
const inputRegex = /<(input|select)\b([^>]*)>/gi;
const inputs = [];
while ((match = inputRegex.exec(html)) !== null) {
  const tag = match[1];
  const attrs = match[2];
  const idMatch = attrs.match(/id=["']([^"']+)["']/i);
  const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
  inputs.push({
    tag,
    id: idMatch ? idMatch[1] : null,
    type: typeMatch ? typeMatch[1] : 'text',
    fullAttrs: attrs
  });
}

console.log(`Found ${inputs.length} inputs/selects in index.html.\n`);

// Check which buttons have listeners
const unhandledButtons = [];
const handledButtons = [];

buttons.forEach(b => {
  let isHandled = false;
  if (b.id && allJsCode.includes(b.id)) {
    isHandled = true;
  }
  if (!isHandled && b.data.length > 0) {
    b.data.forEach(d => {
      const key = d.split('=')[0];
      if (allJsCode.includes('data-' + key) || allJsCode.includes(d)) {
        isHandled = true;
      }
    });
  }
  if (!isHandled && b.cls) {
    b.cls.split(/\s+/).forEach(c => {
      if (c && allJsCode.includes('.' + c)) {
        isHandled = true;
      }
    });
  }

  if (isHandled) {
    handledButtons.push(b);
  } else {
    unhandledButtons.push(b);
  }
});

console.log(`HANDLED BUTTONS: ${handledButtons.length}`);
console.log(`UNHANDLED / POTENTIALLY UNWORKABLE BUTTONS: ${unhandledButtons.length}`);
unhandledButtons.forEach((b, i) => {
  console.log(`${i + 1}. [${b.id || 'NO-ID'}] text: "${b.text}" class: "${b.cls}" data: ${b.data.join(', ')}`);
});

// Check inputs
console.log('\n--- CHECKING INPUTS ---');
const unhandledInputs = [];
inputs.forEach(inp => {
  if (inp.id && !allJsCode.includes(inp.id)) {
    unhandledInputs.push(inp);
  }
});
console.log(`UNHANDLED INPUTS: ${unhandledInputs.length}`);
unhandledInputs.forEach((inp, i) => {
  console.log(`${i + 1}. [${inp.id || 'NO-ID'}] tag: ${inp.tag} type: ${inp.type}`);
});
