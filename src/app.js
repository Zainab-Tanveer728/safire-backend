require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const session   = require('express-session');
const passport  = require('passport');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const connectDB = require('./config/db');

const app = express();

connectDB();

require('../passport');   // passport.js lives in the backend root folder (one level above src)

// multer does NOT create folders: make sure the upload folders exist
['uploads', path.join('uploads', 'resumes')].forEach((dir) => {
  fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
});

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

// ONE session setup (it was configured twice before; the first one ignored the cookie options)
app.use(session({
  secret:            process.env.JWT_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   false,          // set to true in production with HTTPS
    httpOnly: true,
    maxAge:   10 * 60 * 1000, // 10 minutes - only needs to last for the OAuth flow
    sameSite: 'lax',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,                    // was 100: too low while developing / testing
  message: { message: 'Too many requests. Please slow down.' },
}));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/freelancer', require('./routes/freelancerRoutes'));
app.use('/api/proposals', require('./routes/proposalRoutes'));
app.get('/', (req, res) => res.send('API is running.'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));