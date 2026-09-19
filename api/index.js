// Vercel Serverless Function Entrypoint — AERO TWIN Digital Twin & Groq AI
require('dotenv').config();
const { handleRequest } = require('../lib/aero-twin-server');

module.exports = async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('[Vercel Invocation Error]:', err.stack || err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        error: 'internal_function_error',
        message: err.message
      }));
    }
  }
};

module.exports.default = module.exports;
