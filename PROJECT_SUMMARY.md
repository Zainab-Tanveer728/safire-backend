# SAFIRE Backend Project Summary

## 1) Project overview
This is a Node.js + Express backend for the SAFIRE platform. It manages:

- User authentication and authorization
- Google and GitHub OAuth flows
- Freelancer onboarding and AI-powered resume/profile analysis
- Client company onboarding and trust score tracking
- Admin dashboard / user management
- MongoDB data models for users, profiles, proposals, and AI reports

The main runtime entrypoint is `src/app.js`.

---

## 2) Full project structure (relevant app files; generated dependencies excluded)

```text
safire-backend/
├─ .env
├─ .git/
├─ .gitignore
├─ createAdmin.js
├─ GOOGLE_OAUTH_FIX.md
├─ package.json
├─ package-lock.json
├─ passport.js
├─ logs/                        # Empty folder
├─ uploads/
│  ├─ avatars/                  # Empty folder
│  ├─ logos/                    # Empty folder
│  └─ resumes/                  # Empty folder
├─ src/
│  ├─ app.js
│  ├─ config/
│  │  ├─ db.js
│  │  └─ multer.js
│  ├─ controllers/
│  │  ├─ adminController.js
│  │  ├─ aiController.js
│  │  ├─ authController.js
│  │  ├─ clientController.js
│  │  ├─ freelancerAssistanceController.js
│  │  ├─ freelancerController.js
│  │  ├─ profileController.js
│  │  ├─ resumeController.js
│  │  └─ userController.js        # Empty
│  ├─ middleware/
│  │  ├─ adminAuth.js
│  │  ├─ authMiddleware.js
│  │  ├─ errorMiddleware.js      # Empty
│  │  ├─ rateLimiter.js          # Empty
│  │  └─ validate.js             # Empty
│  ├─ models/
│  │  ├─ AdminAuditLog.js
│  │  ├─ ClientProfile.js
│  │  ├─ proposal.js
│  │  ├─ RefreshToken.js         # Empty
│  │  ├─ skillGapReport.js
│  │  └─ User.js
│  ├─ routes/
│  │  ├─ adminRoutes.js
│  │  ├─ aiRoutes.js
│  │  ├─ authRoutes.js
│  │  ├─ clientRoutes.js
│  │  ├─ freelancerRoutes.js
│  │  ├─ profileRoutes.js
│  │  └─ userRoutes.js           # Empty
│  ├─ services/
│  │  ├─ aiService.js
│  │  ├─ authService.js          # Empty
│  │  ├─ emailService.js         # Empty
│  │  ├─ githubService.js
│  │  └─ userService.js          # Empty
│  ├─ utils/
│  │  ├─ apiResponse.js          # Empty
│  │  ├─ AppError.js             # Empty
│  │  ├─ catchAsync.js           # Empty
│  │  ├─ jwtHelper.js            # Empty
│  │  └─ tokenHelper.js          # Empty
│  └─ validators/
│     ├─ authValidators.js       # Empty
│     ├─ clientValidator.js
│     └─ profileValidators.js    # Empty
└─ node_modules/                  # Generated dependencies (not app source)
```

---

## 3) Files with code in them and what they do

### Root-level files

- `package.json`  
  Project metadata and dependencies. Declares the Express app and scripts like `npm run dev` and `npm run start`.

- `createAdmin.js`  
  One-time admin seeding script. Connects to MongoDB and creates the default platform admin account using environment variables.

- `passport.js`  
  Configures Google OAuth with Passport. It registers the Google strategy and handles user creation/login through Google sign-in.

- `GOOGLE_OAUTH_FIX.md`  
  Intended documentation for Google OAuth troubleshooting, but it is currently empty.

- `.env`  
  Hidden environment config for secrets and app settings. Not read here because it may contain sensitive values.

### `src/app.js`
Main Express server bootstrap. It:
- loads environment variables
- connects to MongoDB
- sets up CORS, JSON parsing, sessions, and Passport
- applies rate limiting
- mounts all API routes
- starts the HTTP server on `PORT` (default `5000`)

### `src/config/db.js`
MongoDB connection helper using Mongoose.

### `src/config/multer.js`
Handles resume file upload storage and validation for PDF and Word documents.

### `src/controllers`

- `authController.js`  
  Handles GitHub OAuth callback logic and fetches connected GitHub profile data.

- `profileController.js`  
  Saves user skills, manages employer verification requests and responses, and stores client company profile data.

- `aiController.js`  
  Calls the AI backend to process resume/GitHub data and extract skills, then stores the result in the user profile.

- `freelancerController.js`  
  Calls the AI microservice for freelancer features such as proposal generation, skill gap analysis, resume enhancement, and gig optimization.

- `freelancerAssistanceController.js`  
  Secondary AI-focused controller that generates proposals, analyzes skills, enhances resumes, optimizes gig offers, and returns dashboard stats.

- `clientController.js`  
  Client onboarding logic for company setup and profile retrieval/update. It also references utility modules for API responses and validation.

- `adminController.js`  
  Admin dashboard functions for counting users, listing users, profile details, and admin actions like suspend/reactivate/delete.

- `resumeController.js`  
  Validates uploaded resumes, extracts text from PDF/DOCX, and stores the parsed resume text to the user record.

- `adminController.js` plus `routes/adminRoutes.js` together implement the admin panel functionality.

### `src/middleware`

- `authMiddleware.js`  
  JWT authentication middleware for protected routes. Also includes role-restriction support.

- `adminAuth.js`  
  Checks that incoming JWT tokens belong to an admin user.

- `errorMiddleware.js`  
  Empty placeholder; not implemented.

- `rateLimiter.js`  
  Empty placeholder; intended for custom rate-limiting logic.

- `validate.js`  
  Empty placeholder; likely intended for request validation middleware.

### `src/models`

- `User.js`  
  Main user schema. Stores personal info, auth data, role, skills, resume, GitHub data, portfolio, employer verification, onboarding state, and trust score.

- `ClientProfile.js`  
  Client company profile schema with company metadata and trust score details.

- `AdminAuditLog.js`  
  Audit trail for admin actions such as suspend/unsuspend/delete/create user.

- `proposal.js`  
  Proposal schema for freelancer job proposals and status tracking.

- `skillGapReport.js`  
  Stores skill gap analysis results for target roles.

- `RefreshToken.js`  
  Empty placeholder; intended for refresh token storage.

### `src/routes`

- `authRoutes.js`  
  Handles registration, login, email OTP verification, password reset, and Google/GitHub OAuth routes.

- `profileRoutes.js`  
  Handles profile updates, avatar upload, resume upload, skills save, employer verification, and client company/profile routes.

- `aiRoutes.js`  
  Exposes AI processing route under `/api/ai/process`.

- `adminRoutes.js`  
  Admin API endpoints for dashboard stats, user listing, user creation, suspend/reactivate/delete, and admin health checks.

- `freelancerRoutes.js`  
  Freelancer AI endpoints for proposal generation, proposal retrieval, skill gap analysis, resume enhancement, and gig optimization.

- `clientRoutes.js`  
  Client onboarding endpoints for company profile setup and status/profile retrieval.

- `userRoutes.js`  
  Empty placeholder.

### `src/services`

- `aiService.js`  
  Connects to the Python/AI backend to extract skills and calculate client trust scores.

- `githubService.js`  
  Fetches GitHub profile, repo data, and language usage for onboarding/AI analysis.

- `authService.js`  
  Empty placeholder.

- `emailService.js`  
  Empty placeholder.

- `userService.js`  
  Empty placeholder.

### `src/utils`

- `apiResponse.js`  
  Empty placeholder intended for standardized API response helpers.

- `AppError.js`  
  Empty placeholder intended for custom application error handling.

- `catchAsync.js`  
  Empty placeholder intended for async error wrappers.

- `jwtHelper.js`  
  Empty placeholder intended for JWT helper functions.

- `tokenHelper.js`  
  Empty placeholder intended for token-generation utilities.

### `src/validators`

- `clientValidator.js`  
  Express-validator checks for client registration and company profile setup.

- `authValidators.js`  
  Empty placeholder.

- `profileValidators.js`  
  Empty placeholder.

---

## 4) Empty / not implemented files
These files exist in the repo but currently contain no code:

- `GOOGLE_OAUTH_FIX.md`
- `src/controllers/userController.js`
- `src/middleware/errorMiddleware.js`
- `src/middleware/rateLimiter.js`
- `src/middleware/validate.js`
- `src/models/RefreshToken.js`
- `src/routes/userRoutes.js`
- `src/services/authService.js`
- `src/services/emailService.js`
- `src/services/userService.js`
- `src/utils/apiResponse.js`
- `src/utils/AppError.js`
- `src/utils/catchAsync.js`
- `src/utils/jwtHelper.js`
- `src/utils/tokenHelper.js`
- `src/validators/authValidators.js`
- `src/validators/profileValidators.js`

Also empty folders:

- `logs/`
- `uploads/avatars/`
- `uploads/logos/`
- `uploads/resumes/`

---

## 5) Overall assessment
This project is a partially implemented backend with a solid core architecture:

- authentication and onboarding are mostly in place
- user, profile, and AI models are present
- admin and freelancer flows are scaffolded and partially implemented
- a number of utility and validation files are still empty, so the project is not fully complete yet

In short: the main backend structure exists and is functional in many areas, but some service/helper layers and some placeholder files still need completion before the codebase is fully production-ready.
