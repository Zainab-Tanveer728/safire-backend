// const express = require('express');
// const dotenv = require('dotenv');
// const cors = require('cors');
// const session = require('express-session'); // ADD THIS
// const passport = require('passport'); // ADD THIS
// const connectDB = require('./config/db');
// const authRoutes = require('./routes/authRoutes');
// const mongoose = require('mongoose')

// // 1. Load Environment Variables (Must be very first)
// dotenv.config();

// // 2. Initialize the App
// const app = express();

// // 3. Connect to Database
// connectDB();

// // 4. Import Passport Config
// // This runs the code inside passport.js to set up the Google Strategy
// require('../passport.js'); 

// // 5. Essential Middleware
// app.use(cors());
// app.use(express.json());

// // 6. Session & Passport Middleware (Must be before routes)
// app.use(session({
//   secret: process.env.JWT_SECRET,
//   resave: false,
//   saveUninitialized: false,
// }));

// app.use(passport.initialize());
// app.use(passport.session());

// // 7. Routes
// app.use('/api/auth', authRoutes);

// app.get('/', (req, res) => {
//   res.send('API is running successfully.');
// });

// // 8. Start Server
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`);
// });

// app.js — in safire-backend root (NOT inside src/)
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

const rateLimit = require('express-rate-limit');
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests. Please slow down.' }
}));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => res.send('API is running.'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));