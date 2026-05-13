require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const session   = require('express-session');
const passport  = require('passport');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const connectDB = require('./config/db');

// ── DB + Passport ──────────────────────────────────────────────────────────
connectDB();
require('../passport');

const app = express();

// ── CORS — must be first, before everything else ───────────────────────────
const corsOptions = {
  origin:         process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); 

app.use(express.json());

// ── Session (single registration) ─────────────────────────────────────────
app.use(session({
  secret:            process.env.JWT_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   false,          // set true in production with HTTPS
    httpOnly: true,
    maxAge:   10 * 60 * 1000, // 10 min — enough for OAuth flow
    sameSite: 'lax',
  },
}));

// ── Passport ───────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ── Rate limiting ──────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      100,
  message:  { message: 'Too many requests. Please slow down.' },
}));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/authRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/ai',      require('./routes/aiRoutes'));
app.use('/api/admin',   require('./routes/adminRoutes'));
app.use('/uploads',     express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => res.send('API is running.'));

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));