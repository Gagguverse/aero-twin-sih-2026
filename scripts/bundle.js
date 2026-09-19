const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const distDir = path.join(rootDir, 'dist');
const distIndexPath = path.join(distDir, 'index.html');

console.log('Bundling AERO TWIN Production UI...');

let html = fs.readFileSync(indexPath, 'utf8');

// Replace CSS link tags with inline <style>
html = html.replace(/<link\s+rel="stylesheet"\s+href="css\/([^"?]+)(?:\?[^"]*)?">/g, (match, filename) => {
  const cssPath = path.join(rootDir, 'css', filename);
  if (fs.existsSync(cssPath)) {
    console.log(` Inlining css/${filename}`);
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    return `  <style>\n/* css/${filename} */\n${cssContent}\n  </style>`;
  }
  return match;
});

// Replace JS script tags with inline <script>
html = html.replace(/<script\s+src="js\/([^"?]+)(?:\?[^"]*)?"><\/script>/g, (match, filename) => {
  const jsPath = path.join(rootDir, 'js', filename);
  if (fs.existsSync(jsPath)) {
    console.log(` Inlining js/${filename}`);
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    return `  <script>\n// js/${filename}\n${jsContent}\n  </script>`;
  }
  return match;
});

// Write to dist/index.html
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
fs.writeFileSync(distIndexPath, html, 'utf8');
console.log(`Generated ${distIndexPath} (${(fs.statSync(distIndexPath).size / 1024).toFixed(1)} KB)`);
console.log('Bundling complete!');
