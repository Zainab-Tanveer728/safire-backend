require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const session   = require('express-session');
const passport  = require('../passport');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');   // <-- MODULE 2 (wapas joda)
const http = require('http');
const { attachMeetingSignaling } = require('./socket/meetingSignaling'); 
const connectDB = require('./config/db');

// ── DB + Passport ──────────────────────────────────────────────────────────
connectDB();
require('../passport');

const app = express();

// <-- MODULE 2 (wapas joda): multer folder khud nahi banata, isliye yahan banate hain
['uploads', path.join('uploads', 'resumes')].forEach((dir) => {
  fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
});

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
  max:      process.env.NODE_ENV === 'production' ? 100 : 5000,
  message:  { message: 'Too many requests. Please slow down.' },
  skip:     (req) => req.originalUrl.startsWith('/api/meetings')
                  || req.originalUrl.startsWith('/api/notifications'),
}));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/authRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/ai',      require('./routes/aiRoutes'));
app.use('/api/admin',   require('./routes/adminRoutes'));
app.use('/api/freelancer', require('./routes/freelancerRoutes')); 
app.use('/api/proposals',  require('./routes/proposalRoutes'));   // <-- MODULE 2 (wapas joda)
app.use('/uploads',     express.static(path.join(__dirname, 'uploads')));
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/meetings',     require('./routes/meetingRoutes'));
app.use('/api/requirements', require('./routes/requirementRoutes')); 
app.use('/api/jobs',        require('./routes/jobRoutes'));
app.use('/api/freelancers', require('./routes/freelancerDirectoryRoutes'));
// with your other app.use(...) route lines:
app.use('/uploads/avatars', express.static(path.join(__dirname, '../uploads/avatars')));
app.use('/uploads/logos',   express.static(path.join(__dirname, '../uploads/logos')));
app.use('/api/change-requests', require('./routes/changeRequestRoutes'));
app.use('/api/disputes',        require('./routes/disputeRoutes'));

// after the database is connected / the server starts listening:
require('./services/changeRequestScheduler').start();

app.get('/', (req, res) => res.send('API is running.'));

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
app.set('io', attachMeetingSignaling(server));      // live call messages + "meeting ended" push
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
