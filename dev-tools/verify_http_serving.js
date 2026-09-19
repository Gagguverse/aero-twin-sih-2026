const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function verify() {
  console.log('=== HTTP SERVING CHECKS ===');
  const indexRes = await fetch('http://localhost:3000/');
  console.log('GET / -> Status:', indexRes.status, 'Length:', indexRes.body.length);

  const appJsRes = await fetch('http://localhost:3000/js/app.js');
  console.log('GET /js/app.js -> Status:', appJsRes.status, 'Length:', appJsRes.body.length);

  const engineJsRes = await fetch('http://localhost:3000/js/engine-3d.js');
  console.log('GET /js/engine-3d.js -> Status:', engineJsRes.status, 'Length:', engineJsRes.body.length);

  console.log('\n=== CHECKS IN SERVED HTML ===');
  console.log('1. Has 3D engine canvas:', indexRes.body.includes('id="engine-canvas"'));
  console.log('2. 3D viewport visible by default (no hidden class):', indexRes.body.includes('id="twin-viewport-3d"') && !indexRes.body.includes('id="twin-viewport-3d" class="relative w-full my-auto flex items-center justify-center py-space-sm min-h-[380px] hidden"'));
  console.log('3. 3D button active by default:', indexRes.body.includes('id="btn-view-3d" onclick="switchTwinView(\'3d\')">3D REALISTIC</button>'));
  console.log('4. Has ISO/TOP/SENSORS buttons:', indexRes.body.includes("window.digitalTwin.setView('iso')"));
  console.log('5. Scenario 1 label:', indexRes.body.includes('1. NORMAL MISSION'));
  console.log('6. Scenario 2 label:', indexRes.body.includes('2. SENSOR FAILURE'));
  console.log('7. Scenario 3 label:', indexRes.body.includes('3. THERMAL DEGRADATION'));
  console.log('8. User-friendly banner removed (BAD SENSOR != BAD ENGINE):', !indexRes.body.includes('BAD SENSOR ≠ BAD ENGINE') && !indexRes.body.includes('decision-callout-banner'));
  console.log('9. User-friendly chat removed (ASK ABOUT THIS ENGINE):', !indexRes.body.includes('ASK ABOUT THIS ENGINE') && !indexRes.body.includes('Why is health changing?'));
  console.log('10. Original Stitch Quick Action Chips present:', indexRes.body.includes("askAssistant('WHY')") && indexRes.body.includes("askAssistant('FAULT')") && indexRes.body.includes("askAssistant('RUL')") && indexRes.body.includes("askAssistant('RISK')"));

  console.log('\n=== CHECKS IN ENGINE-3D.JS ===');
  console.log('1. Has resize() method:', engineJsRes.body.includes('resize()'));
  console.log('2. Has setView() method:', engineJsRes.body.includes('setView(viewName)'));
  console.log('3. Has updateState() method:', engineJsRes.body.includes('updateState('));
  console.log('4. Has photorealistic studio lighting:', engineJsRes.body.includes('keyLight') && engineJsRes.body.includes('fillLight') && engineJsRes.body.includes('rimLight'));
}

verify();
