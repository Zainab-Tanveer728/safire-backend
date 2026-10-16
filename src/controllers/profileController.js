// const User       = require('../models/User');
// const nodemailer = require('nodemailer');
// const crypto     = require('crypto');

// // ════════════════════════════════════════════════════════════════
// //  SAVE CONFIRMED SKILLS
// //  POST /api/profile/skills
// // ════════════════════════════════════════════════════════════════
// exports.saveSkills = async (req, res) => {
//   try {
//     const { skills } = req.body;
//     if (!skills?.length)
//       return res.status(400).json({ message: 'No skills provided.' });

//     await User.findByIdAndUpdate(req.user._id, {
//       $set: {
//         skills: skills.map(s => ({
//           name:       s.name,
//           category:   s.category   || 'Other',
//           confidence: s.confidence || 1,
//           source:     s.source     || 'manual',
//           verified:   s.verified   || false,
//         })),
//         'onboarding.skillsReviewed': true,
//       }
//     });

//     res.json({ success: true, message: 'Skills saved.' });
//   } catch (err) {
//     console.error('Save skills error:', err.message);
//     res.status(500).json({ message: 'Failed to save skills: ' + err.message });
//   }
// };

// // ════════════════════════════════════════════════════════════════
// //  REQUEST EMPLOYER VERIFICATION
// //  POST /api/profile/employer-verification
// //
// //  Flow:
// //  1. Generate a unique token per employer
// //  2. Save verification record to DB with token + status=pending
// //  3. Send email with a link to the hosted form (GET /verify/:token)
// //  4. Employer fills form → POST /api/profile/employer-verification/respond
// //  5. System updates status + recalculates trust score
// // ════════════════════════════════════════════════════════════════
// exports.requestEmployerVerification = async (req, res) => {
//   try {
//     const { employers } = req.body;
//     if (!employers?.length)
//       return res.status(400).json({ message: 'No employers provided.' });

//     const user = await User.findById(req.user._id);
//     if (!user) return res.status(404).json({ message: 'User not found.' });

//     const transporter = nodemailer.createTransport({
//       service: 'gmail',
//       auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
//     });

//     const verifications = [];

//     for (const emp of employers) {
//       // Unique token for this verification request
//       const token = crypto.randomBytes(32).toString('hex');
//       const formUrl = `${process.env.FRONTEND_URL}/verify-employer/${token}`;

//       verifications.push({
//         companyName:   emp.companyName.trim(),
//         employerEmail: emp.employerEmail.trim(),
//         jobTitle:      emp.jobTitle?.trim() || '',
//         status:        'pending',
//         requestedAt:   new Date(),
//         verificationToken: token,
//       });

//       await transporter.sendMail({
//         from:    `"Safire" <${process.env.EMAIL_USER}>`,
//         to:      emp.employerEmail.trim(),
//         subject: `Employment Verification Request — ${user.name} on Safire`,
//         html: `
//           <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;
//                       background:#fff;border-radius:16px;">
//             <div style="margin-bottom:24px;">
//               <span style="font-size:24px;font-weight:800;color:#6C2BD9;">Safire</span>
//             </div>
//             <h2 style="color:#111;margin-bottom:8px;">Employment Verification Request</h2>
//             <p style="color:#6B7280;margin-bottom:24px;">
//               <strong style="color:#111;">${user.name}</strong> has listed
//               <strong style="color:#111;">${emp.companyName}</strong> as a previous employer
//               on Safire${emp.jobTitle ? ` (role: <strong style="color:#111;">${emp.jobTitle}</strong>)` : ''}.
//               They are asking you to verify this.
//             </p>
//             <p style="color:#6B7280;margin-bottom:32px;">
//               This takes less than 1 minute. Please click the button below to confirm or deny.
//             </p>
//             <a href="${formUrl}"
//                style="display:inline-block;padding:14px 32px;background:#6C2BD9;color:#fff;
//                       text-decoration:none;border-radius:12px;font-weight:700;font-size:16px;">
//               Open Verification Form →
//             </a>
//             <p style="color:#9CA3AF;font-size:11px;margin-top:32px;">
//               This request was sent via Safire. If you did not expect this email, you can ignore it.
//               The link expires in 7 days.
//             </p>
//           </div>
//         `,
//       });
//     }

//     // Save all verifications to DB
//     await User.findByIdAndUpdate(req.user._id, {
//       $push: { employerVerifications: { $each: verifications } },
//     });

//     res.json({ success: true, message: `Verification email${verifications.length > 1 ? 's' : ''} sent.` });

//   } catch (err) {
//     console.error('Employer verification error:', err.message);
//     res.status(500).json({ message: 'Failed to send: ' + err.message });
//   }
// };

// // ════════════════════════════════════════════════════════════════
// //  GET VERIFICATION FORM DATA
// //  GET /api/profile/employer-verification/:token
// //  Called by the frontend form page to load context
// // ════════════════════════════════════════════════════════════════
// exports.getVerificationForm = async (req, res) => {
//   try {
//     const { token } = req.params;

//     const user = await User.findOne({
//       'employerVerifications.verificationToken': token,
//     });

//     if (!user) {
//       return res.status(404).json({ message: 'Verification link is invalid or expired.' });
//     }

//     const record = user.employerVerifications.find(
//       v => v.verificationToken === token
//     );

//     if (record.status !== 'pending') {
//       return res.status(410).json({
//         message: 'This verification has already been submitted.',
//         status: record.status,
//       });
//     }

//     res.json({
//       freelancerName: user.name,
//       companyName:    record.companyName,
//       jobTitle:       record.jobTitle,
//       token,
//     });

//   } catch (err) {
//     console.error('Get verification form error:', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// };

// // ════════════════════════════════════════════════════════════════
// //  SUBMIT VERIFICATION RESPONSE
// //  POST /api/profile/employer-verification/respond
// //  Called by employer after filling the form
// // ════════════════════════════════════════════════════════════════
// exports.respondToVerification = async (req, res) => {
//   try {
//     const { token, decision, notes } = req.body;
//     // decision: 'confirmed' | 'rejected'

//     if (!token || !decision) {
//       return res.status(400).json({ message: 'Token and decision are required.' });
//     }
//     if (!['confirmed', 'rejected'].includes(decision)) {
//       return res.status(400).json({ message: 'Decision must be confirmed or rejected.' });
//     }

//     const user = await User.findOne({
//       'employerVerifications.verificationToken': token,
//     });

//     if (!user) {
//       return res.status(404).json({ message: 'Invalid or expired verification link.' });
//     }

//     // Find and update the specific verification record
//     const verIndex = user.employerVerifications.findIndex(
//       v => v.verificationToken === token
//     );

//     if (verIndex === -1) {
//       return res.status(404).json({ message: 'Verification record not found.' });
//     }

//     if (user.employerVerifications[verIndex].status !== 'pending') {
//       return res.status(410).json({ message: 'This verification has already been submitted.' });
//     }

//     // Update the record
//     user.employerVerifications[verIndex].status      = decision;
//     user.employerVerifications[verIndex].respondedAt = new Date();
//     user.employerVerifications[verIndex].notes       = notes || '';

//     // ── Recalculate trust score ───────────────────────────────
//     const confirmedCount = user.employerVerifications.filter(
//       v => v.status === 'confirmed'
//     ).length;

//     let trustScore = 0;
//     if (user.isVerified)                   trustScore += 20;
//     if (user.onboarding?.basicProfileDone) trustScore += 15;
//     if (user.githubAccessToken)            trustScore += 25;
//     if (user.resumeText)                   trustScore += 20;
//     if (user.skills?.length >= 5)          trustScore += 10;
//     // +10 per confirmed employer, max 2 employers = max 20 bonus
//     trustScore += Math.min(confirmedCount * 10, 20);
//     trustScore = Math.min(trustScore, 100);

//     user.trustScore = {
//       ...user.trustScore,
//       overall:           trustScore,
//       verificationScore: confirmedCount * 10,
//       lastUpdated:       new Date(),
//     };

//     await user.save();

//     res.json({
//       success:  true,
//       decision,
//       message:  decision === 'confirmed'
//         ? 'Thank you for confirming. The freelancer has been notified.'
//         : 'Thank you for your response. The freelancer has been notified.',
//     });

//   } catch (err) {
//     console.error('Respond to verification error:', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// };
// // ════════════════════════════════════════════════════════════════
// //  SAVE CLIENT COMPANY PROFILE
// //  PUT /api/profile/client/company
// // ════════════════════════════════════════════════════════════════
// exports.saveCompanyProfile = async (req, res) => {
//   try {
//     const {
//       companyName, jobTitle, website,
//       industry, companySize, country, description,
//     } = req.body;

//     if (!companyName?.trim())
//       return res.status(400).json({ message: 'Company name is required.' });
//     if (!industry)
//       return res.status(400).json({ message: 'Industry is required.' });
//     if (!country)
//       return res.status(400).json({ message: 'Country is required.' });
//     if (website && !/^https?:\/\/.+/.test(website))
//       return res.status(400).json({ message: 'Website must start with http:// or https://' });

//     const updateData = {
//       'company.companyName':  companyName.trim(),
//       'company.description':  description?.trim() || '',
//       'company.industry':     industry,
//       'company.companySize':  companySize || '',
//       'company.website':      website?.trim() || '',
//       'company.location':     country,
//       'onboarding.basicProfileDone': true,
//     };

//     // Job title goes on the user level
//     if (jobTitle?.trim()) updateData.headline = jobTitle.trim();

//     // Logo upload
//     if (req.file) {
//       updateData['company.companyLogoUrl'] = `/uploads/logos/${req.file.filename}`;
//     }

//     // Calculate trust score
//     let trustScore = 0;
//     const user = await User.findById(req.user._id);
//     if (user?.isVerified)       trustScore += 20;
//     if (companyName)            trustScore += 15;
//     if (industry)               trustScore += 15;
//     if (website)                trustScore += 10;
//     if (description)            trustScore += 15;
//     if (companySize)            trustScore += 10;
//     if (country)                trustScore += 10;
//     trustScore = Math.min(trustScore, 100);

//     updateData['trustScore.overall']     = trustScore;
//     updateData['trustScore.lastUpdated'] = new Date();

//     const updated = await User.findByIdAndUpdate(
//       req.user._id,
//       { $set: updateData },
//       { new: true, runValidators: true }
//     ).select('-password -githubAccessToken');

//     if (!updated) return res.status(404).json({ message: 'User not found.' });

//     res.json({
//       success: true,
//       message: 'Company profile saved.',
//       user: {
//         company:    updated.company,
//         headline:   updated.headline,
//         onboarding: updated.onboarding,
//         trustScore: updated.trustScore,
//       },
//     });

//   } catch (err) {
//     console.error('Save company profile error:', err.message);
//     res.status(500).json({ message: 'Server error: ' + err.message });
//   }
// };

// // ════════════════════════════════════════════════════════════════
// //  GET CLIENT PROFILE
// //  GET /api/profile/client/me
// // ════════════════════════════════════════════════════════════════
// exports.getClientProfile = async (req, res) => {
//   try {
//     const user = await User.findById(req.user._id).select(
//       'name email headline avatarUrl role company onboarding trustScore isVerified'
//     );
//     if (!user) return res.status(404).json({ message: 'User not found.' });
//     res.json({ user });
//   } catch (err) {
//     res.status(500).json({ message: 'Server error.' });
//   }
// };
// .........................................................

// src/controllers/profileController.js
const crypto = require('crypto');
const User   = require('../models/User');
const { calculateFreelancerTrust } = require('../utils/trustScore');
const { sendEmployerVerificationEmail } = require('../services/emailService');
const { notify } = require('../services/notificationService');

const SKILL_CATEGORIES = ['Frontend', 'Backend', 'Full Stack', 'Mobile', 'DevOps', 'Data Science', 'Design', 'Other'];
const COMPANY_SIZES    = ['1-10', '11-50', '51-200', '201-500', '500+'];
const VERIFY_HOURS     = 72;                       // SDS: employer link is valid for 72 hours
const VERIFY_MS        = VERIFY_HOURS * 60 * 60 * 1000;
const EMAIL_RE         = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ════════════════════════════════════════════════════════════════
//  SAVE CONFIRMED SKILLS
//  POST /api/profile/skills
//  The server decides what is "verified", never the browser: a skill keeps its AI evidence
//  (source, confidence, verified) only if the AI step really found it. Everything else is manual.
// ════════════════════════════════════════════════════════════════
exports.saveSkills = async (req, res) => {
  try {
    const incoming = Array.isArray(req.body.skills) ? req.body.skills.slice(0, 60) : [];
    if (!incoming.length) return res.status(400).json({ message: 'No skills provided.' });

    const user = await User.findById(req.user._id).select('skills');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const known = new Map((user.skills || []).map((s) => [String(s.name).toLowerCase(), s]));
    const seen = new Set();
    const skills = [];

    for (const s of incoming) {
      const name = String(s?.name || '').trim().slice(0, 60);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);

      const prior = known.get(key);
      const category = SKILL_CATEGORIES.includes(s.category) ? s.category : prior?.category || 'Other';

      if (prior && prior.source && prior.source !== 'manual') {
        // found by the AI earlier: keep the server's evidence, ignore what the browser claims
        skills.push({ name, category, source: prior.source, confidence: prior.confidence, verified: !!prior.verified });
      } else {
        // typed in by the user: never verified, and no confidence score (SRS FR8.5)
        skills.push({ name, category, source: 'manual', verified: false });
      }
    }

    if (!skills.length) return res.status(400).json({ message: 'No valid skills provided.' });

    await User.findByIdAndUpdate(req.user._id, {
      $set: { skills, 'onboarding.skillsReviewed': true },
    });

    res.json({ success: true, message: 'Skills saved.', count: skills.length });
  } catch (err) {
    console.error('Save skills error:', err.message);
    res.status(500).json({ message: 'Failed to save skills.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  SKIP AI ANALYSIS
//  POST /api/profile/skip-ai
//  The "Skip" button used to set this flag only in the browser, so after a refresh the user was
//  sent back to the AI step. Now it is saved.
// ════════════════════════════════════════════════════════════════
exports.skipAiProcessing = async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { 'onboarding.aiProcessingDone': true } });
    res.json({ success: true });
  } catch (err) {
    console.error('Skip AI error:', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  REQUEST EMPLOYER VERIFICATION
//  POST /api/profile/employer-verification
//  1. validate  2. SAVE the pending records  3. send the emails
//  (it used to email first and save afterwards, so a failed email left links that did not exist)
// ════════════════════════════════════════════════════════════════
exports.requestEmployerVerification = async (req, res) => {
  try {
    const raw = Array.isArray(req.body.employers) ? req.body.employers : [];
    if (!raw.length) return res.status(400).json({ message: 'No employers provided.' });
    if (raw.length > 5) return res.status(400).json({ message: 'You can verify at most 5 employers at a time.' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const myEmail = String(user.email).toLowerCase();
    const pendingNow = new Set(
      (user.employerVerifications || [])
        .filter((v) => v.status === 'pending' && Date.now() - new Date(v.requestedAt).getTime() < VERIFY_MS)
        .map((v) => String(v.employerEmail).toLowerCase())
    );

    const records = [];
    const skipped = [];
    for (const emp of raw) {
      const companyName   = String(emp?.companyName || '').trim().slice(0, 100);
      const employerEmail = String(emp?.employerEmail || '').trim().toLowerCase();
      const jobTitle      = String(emp?.jobTitle || '').trim().slice(0, 100);

      if (!companyName) return res.status(400).json({ message: 'Each employer needs a company name.' });
      if (!EMAIL_RE.test(employerEmail)) return res.status(400).json({ message: `"${employerEmail || 'empty'}" is not a valid email address.` });
      if (employerEmail === myEmail)
        return res.status(400).json({ message: 'You cannot verify yourself. Enter your employer\'s email address.' });
      if (pendingNow.has(employerEmail)) { skipped.push(companyName); continue; }   // already waiting for an answer
      pendingNow.add(employerEmail);

      records.push({
        companyName, employerEmail, jobTitle,
        status: 'pending',
        requestedAt: new Date(),
        verificationToken: crypto.randomBytes(32).toString('hex'),
      });
    }

    if (!records.length) {
      return res.status(409).json({ message: 'A verification request to these employers is already waiting for an answer.' });
    }

    await User.updateOne({ _id: user._id }, { $push: { employerVerifications: { $each: records } } });

    const failed = [];
    for (const r of records) {
      const ok = await sendEmployerVerificationEmail({
        to: r.employerEmail, freelancerName: user.name, jobTitle: r.jobTitle,
        companyName: r.companyName, token: r.verificationToken, hours: VERIFY_HOURS,
      });
      if (!ok) failed.push(r);
    }
    if (failed.length) {   // remove records whose email never left, so the user can try again
      await User.updateOne(
        { _id: user._id },
        { $pull: { employerVerifications: { verificationToken: { $in: failed.map((f) => f.verificationToken) } } } }
      );
    }

    const sent = records.length - failed.length;
    if (!sent) return res.status(502).json({ message: 'The emails could not be sent right now. Please try again shortly.' });

    res.json({
      success: true,
      sent,
      failed:  failed.map((f) => f.companyName),
      skipped,
      message: `Verification email${sent > 1 ? 's' : ''} sent.${failed.length ? ` ${failed.length} could not be sent.` : ''}`,
    });
  } catch (err) {
    console.error('Employer verification error:', err.message);
    res.status(500).json({ message: 'Failed to send verification requests.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  GET VERIFICATION FORM DATA   (public)
//  GET /api/profile/employer-verification/:token
// ════════════════════════════════════════════════════════════════
exports.getVerificationForm = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({ 'employerVerifications.verificationToken': token }).select('name employerVerifications');
    if (!user) return res.status(404).json({ message: 'Verification link is invalid or expired.' });

    const record = user.employerVerifications.find((v) => v.verificationToken === token);
    if (record.status !== 'pending') {
      return res.status(410).json({ message: 'This verification has already been submitted.', status: record.status });
    }
    if (Date.now() - new Date(record.requestedAt).getTime() > VERIFY_MS) {
      return res.status(410).json({ message: `This verification link has expired (it is valid for ${VERIFY_HOURS} hours).` });
    }

    res.json({ freelancerName: user.name, companyName: record.companyName, jobTitle: record.jobTitle, token });
  } catch (err) {
    console.error('Get verification form error:', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  SUBMIT VERIFICATION RESPONSE   (public, employer)
//  POST /api/profile/employer-verification/respond
//  Uses targeted updates instead of user.save(): save() validates the WHOLE user document, so one
//  odd skill value elsewhere used to make the employer's answer fail.
// ════════════════════════════════════════════════════════════════
exports.respondToVerification = async (req, res) => {
  try {
    const { token, decision } = req.body;
    const notes = String(req.body.notes || '').slice(0, 500);

    if (!token || !decision) return res.status(400).json({ message: 'Token and decision are required.' });
    if (!['confirmed', 'rejected'].includes(decision))
      return res.status(400).json({ message: 'Decision must be confirmed or rejected.' });

    const user = await User.findOne({ 'employerVerifications.verificationToken': token });
    if (!user) return res.status(404).json({ message: 'Invalid or expired verification link.' });

    const idx = user.employerVerifications.findIndex((v) => v.verificationToken === token);
    if (idx === -1) return res.status(404).json({ message: 'Verification record not found.' });

    const record = user.employerVerifications[idx];
    if (record.status !== 'pending') return res.status(410).json({ message: 'This verification has already been submitted.' });
    if (Date.now() - new Date(record.requestedAt).getTime() > VERIFY_MS)
      return res.status(410).json({ message: `This verification link has expired (it is valid for ${VERIFY_HOURS} hours).` });

    // new trust score as it will be AFTER this answer
    const after = user.toObject();
    after.employerVerifications[idx].status = decision;
    const confirmedCount = after.employerVerifications.filter((v) => v.status === 'confirmed').length;

    // the filter on status:'pending' makes a double click / double submit impossible
    const r = await User.updateOne(
      {
        _id: user._id,
        [`employerVerifications.${idx}.verificationToken`]: token,
        [`employerVerifications.${idx}.status`]: 'pending',
      },
      {
        $set: {
          [`employerVerifications.${idx}.status`]:      decision,
          [`employerVerifications.${idx}.respondedAt`]: new Date(),
          [`employerVerifications.${idx}.notes`]:       notes,
          'trustScore.overall':           calculateFreelancerTrust(after),
          'trustScore.verificationScore': Math.min(confirmedCount * 10, 20),
          'trustScore.lastUpdated':       new Date(),
        },
      }
    );
    if (!r.matchedCount) return res.status(410).json({ message: 'This verification has already been submitted.' });

    // tell the freelancer (in the app and by email)
    notify(user._id, {
      type: decision === 'confirmed' ? 'employer_verification_confirmed' : 'employer_verification_rejected',
      data: { companyName: record.companyName },
      email: true,
    });

    res.json({
      success: true,
      decision,
      message: decision === 'confirmed'
        ? 'Thank you for confirming. The freelancer has been notified.'
        : 'Thank you for your response. The freelancer has been notified.',
    });
  } catch (err) {
    console.error('Respond to verification error:', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  SAVE CLIENT COMPANY PROFILE
//  PUT /api/profile/client/company
// ════════════════════════════════════════════════════════════════
exports.saveCompanyProfile = async (req, res) => {
  try {
    const { companyName, jobTitle, website, industry, companySize, country, description } = req.body;

    if (!companyName?.trim()) return res.status(400).json({ message: 'Company name is required.' });
    if (!industry)            return res.status(400).json({ message: 'Industry is required.' });
    if (!country)             return res.status(400).json({ message: 'Country is required.' });
    if (website && !/^https?:\/\/.+/.test(website))
      return res.status(400).json({ message: 'Website must start with http:// or https://' });
    if (companySize && !COMPANY_SIZES.includes(companySize))
      return res.status(400).json({ message: 'Company size is not valid.' });

    const updateData = {
      'company.companyName': companyName.trim(),
      'company.description': description?.trim() || '',
      'company.industry':    industry,
      'company.website':     website?.trim() || '',
      'company.location':    country,
      'onboarding.basicProfileDone': true,
    };
    // an empty string is not an allowed companySize value and made the whole save fail
    if (companySize) updateData['company.companySize'] = companySize;
    if (jobTitle?.trim()) updateData.headline = jobTitle.trim();
    if (req.file) updateData['company.companyLogoUrl'] = `/uploads/logos/${req.file.filename}`;

    const user = await User.findById(req.user._id);
    let trustScore = 0;
    if (user?.isVerified) trustScore += 20;
    if (companyName)      trustScore += 15;
    if (industry)         trustScore += 15;
    if (website)          trustScore += 10;
    if (description)      trustScore += 15;
    if (companySize)      trustScore += 10;
    if (country)          trustScore += 10;
    trustScore = Math.min(trustScore, 100);

    updateData['trustScore.overall']     = trustScore;
    updateData['trustScore.lastUpdated'] = new Date();

    const updated = await User.findByIdAndUpdate(
      req.user._id, { $set: updateData }, { new: true, runValidators: true }
    ).select('-password -githubAccessToken');
    if (!updated) return res.status(404).json({ message: 'User not found.' });

    res.json({
      success: true,
      message: 'Company profile saved.',
      user: { company: updated.company, headline: updated.headline, onboarding: updated.onboarding, trustScore: updated.trustScore },
    });
  } catch (err) {
    console.error('Save company profile error:', err.message);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  GET CLIENT PROFILE
//  GET /api/profile/client/me
// ════════════════════════════════════════════════════════════════
exports.getClientProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'name email headline avatarUrl role company onboarding trustScore isVerified'
    );
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};