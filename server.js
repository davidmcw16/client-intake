require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initDB } = require('./src/services/db');

const sessionRoutes = require('./src/routes/session');
const ttsRoutes = require('./src/routes/tts');
const downloadRoutes = require('./src/routes/download');
const adminRoutes = require('./src/routes/admin');
const convaiRoutes = require('./src/routes/convai');
const webhookRoutes = require('./src/routes/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware — capture raw body on webhook route for HMAC verification
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl === '/api/webhook' || req.originalUrl === '/api/webhook/') {
      req.rawBody = buf;
    }
  }
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/session', sessionRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/convai', convaiRoutes);
app.use('/api/webhook', webhookRoutes);

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Start with DB initialization
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Voice Intake running on http://localhost:${PORT}`);
      if (!process.env.ELEVENLABS_API_KEY) {
        console.warn('⚠  ELEVENLABS_API_KEY not set — TTS will use browser fallback');
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn('⚠  ANTHROPIC_API_KEY not set — LLM features disabled');
      }
      if (!process.env.ELEVENLABS_AGENT_ID) {
        console.warn('⚠  ELEVENLABS_AGENT_ID not set — ConvAI mode disabled');
      }
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
