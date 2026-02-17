require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// JSON body parser for all routes EXCEPT webhook
app.use((req, res, next) => {
  if (req.path === '/api/webhook') {
    // Webhook needs raw body for HMAC signature verification
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Clean URL for admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Route mounting — only 3 route groups
app.use('/api/webhook', require('./src/routes/webhook'));
app.use('/api/download', require('./src/routes/download'));
app.use('/api/admin', require('./src/routes/admin'));

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
