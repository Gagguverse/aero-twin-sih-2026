// Load environment variables from .env
require('dotenv').config();

const http = require('http');
const { handleRequest, getGroqConfig } = require('./lib/aero-twin-server');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

// Guard app.listen so it only starts when executed directly
if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    const { apiKey, model } = getGroqConfig();
    console.log(`Server running on port ${PORT}`);
    console.log(`Hardware Telemetry Ingestion API ready at http://localhost:${PORT}/api/telemetry`);
    console.log(`Groq Cloud AI Assistant API ready at http://localhost:${PORT}/api/grok`);
    if (apiKey) {
      console.log(`[Groq Cloud] Groq AI initialized successfully (model: ${model}).`);
    } else {
      console.log(`  ⚠  Groq Cloud not active — add GROQ_API_KEY to .env to enable (get one at https://console.groq.com/)`);
    }
  });

  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught Exception:', err.message);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] Unhandled Rejection:', reason);
  });
}

module.exports = server;
