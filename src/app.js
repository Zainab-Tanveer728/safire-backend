const express  = require('express');
const dotenv   = require('dotenv');
const cors     = require('cors');
const session  = require('express-session');
const passport = require('passport');
const connectDB = require('./config/db');  // FIX: was ./config/db
const path = require('path');

dotenv.config();

const app = express();

connectDB();

require('../passport');  // FIX: was ../passport.js — this is correct since app.js is in root

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(session({
  secret:            process.env.JWT_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   false,       // set to true in production with HTTPS
    httpOnly: true,
    maxAge:   10 * 60 * 1000, // 10 minutes — only needs to last for OAuth flow
    sameSite: 'lax',
  }
}));

const rateLimit = require('express-rate-limit');
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests. Please slow down.' }
}));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/ai', require('./routes/aiRoutes'));

app.get('/', (req, res) => res.send('API is running.'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));