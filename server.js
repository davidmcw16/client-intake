require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route mounting
app.use('/api/session', require('./src/routes/session'));
app.use('/api/session', require('./src/routes/conversation'));
app.use('/api/tts', require('./src/routes/tts'));
app.use('/api/download', require('./src/routes/download'));
app.use('/api/admin', require('./src/routes/admin'));

// Deepgram token endpoint (inline)
app.get('/api/deepgram-token', (req, res) => {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return res.json({ configured: false });
  res.json({ key, configured: true });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize DB and start server
async function start() {
  try {
    const db = require('./src/services/db');
    await db.initialize();
    console.log('Database initialized');
  } catch (err) {
    console.warn('Database initialization skipped:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Voice Intake server running on port ${PORT}`);
  });
}

start();
