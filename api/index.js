// Vercel Serverless Function Entrypoint — AERO TWIN Digital Twin & Groq AI
require('dotenv').config();
const { handleRequest } = require('../lib/aero-twin-server');

module.exports = async (req, res) => {
  return handleRequest(req, res);
};

module.exports.default = module.exports;
