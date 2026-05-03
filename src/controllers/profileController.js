const User       = require('../models/User');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

// ════════════════════════════════════════════════════════════════
//  SAVE CONFIRMED SKILLS
//  POST /api/profile/skills
// ════════════════════════════════════════════════════════════════
exports.saveSkills = async (req, res) => {
  try {
    const { skills } = req.body;
    if (!skills?.length)
      return res.status(400).json({ message: 'No skills provided.' });

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        skills: skills.map(s => ({
          name:       s.name,
          category:   s.category   || 'Other',
          confidence: s.confidence || 1,
          source:     s.source     || 'manual',
          verified:   s.verified   || false,
        })),
        'onboarding.skillsReviewed': true,
      }
    });

    res.json({ success: true, message: 'Skills saved.' });
  } catch (err) {
    console.error('Save skills error:', err.message);
    res.status(500).json({ message: 'Failed to save skills: ' + err.message });
  }
};

// ════════════════════════════════════════════════════════════════
//  REQUEST EMPLOYER VERIFICATION
//  POST /api/profile/employer-verification
//
//  Flow:
//  1. Generate a unique token per employer
//  2. Save verification record to DB with token + status=pending
//  3. Send email with a link to the hosted form (GET /verify/:token)
//  4. Employer fills form → POST /api/profile/employer-verification/respond
//  5. System updates status + recalculates trust score
// ════════════════════════════════════════════════════════════════
exports.requestEmployerVerification = async (req, res) => {
  try {
    const { employers } = req.body;
    if (!employers?.length)
      return res.status(400).json({ message: 'No employers provided.' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const verifications = [];

    for (const emp of employers) {
      // Unique token for this verification request
      const token = crypto.randomBytes(32).toString('hex');
      const formUrl = `${process.env.FRONTEND_URL}/verify-employer/${token}`;

      verifications.push({
        companyName:   emp.companyName.trim(),
        employerEmail: emp.employerEmail.trim(),
        jobTitle:      emp.jobTitle?.trim() || '',
        status:        'pending',
        requestedAt:   new Date(),
        verificationToken: token,
      });

      await transporter.sendMail({
        from:    `"Safire" <${process.env.EMAIL_USER}>`,
        to:      emp.employerEmail.trim(),
        subject: `Employment Verification Request — ${user.name} on Safire`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;
                      background:#fff;border-radius:16px;">
            <div style="margin-bottom:24px;">
              <span style="font-size:24px;font-weight:800;color:#6C2BD9;">Safire</span>
            </div>
            <h2 style="color:#111;margin-bottom:8px;">Employment Verification Request</h2>
            <p style="color:#6B7280;margin-bottom:24px;">
              <strong style="color:#111;">${user.name}</strong> has listed
              <strong style="color:#111;">${emp.companyName}</strong> as a previous employer
              on Safire${emp.jobTitle ? ` (role: <strong style="color:#111;">${emp.jobTitle}</strong>)` : ''}.
              They are asking you to verify this.
            </p>
            <p style="color:#6B7280;margin-bottom:32px;">
              This takes less than 1 minute. Please click the button below to confirm or deny.
            </p>
            <a href="${formUrl}"
               style="display:inline-block;padding:14px 32px;background:#6C2BD9;color:#fff;
                      text-decoration:none;border-radius:12px;font-weight:700;font-size:16px;">
              Open Verification Form →
            </a>
            <p style="color:#9CA3AF;font-size:11px;margin-top:32px;">
              This request was sent via Safire. If you did not expect this email, you can ignore it.
              The link expires in 7 days.
            </p>
          </div>
        `,
      });
    }

    // Save all verifications to DB
    await User.findByIdAndUpdate(req.user._id, {
      $push: { employerVerifications: { $each: verifications } },
    });

    res.json({ success: true, message: `Verification email${verifications.length > 1 ? 's' : ''} sent.` });

  } catch (err) {
    console.error('Employer verification error:', err.message);
    res.status(500).json({ message: 'Failed to send: ' + err.message });
  }
};

// ════════════════════════════════════════════════════════════════
//  GET VERIFICATION FORM DATA
//  GET /api/profile/employer-verification/:token
//  Called by the frontend form page to load context
// ════════════════════════════════════════════════════════════════
exports.getVerificationForm = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      'employerVerifications.verificationToken': token,
    });

    if (!user) {
      return res.status(404).json({ message: 'Verification link is invalid or expired.' });
    }

    const record = user.employerVerifications.find(
      v => v.verificationToken === token
    );

    if (record.status !== 'pending') {
      return res.status(410).json({
        message: 'This verification has already been submitted.',
        status: record.status,
      });
    }

    res.json({
      freelancerName: user.name,
      companyName:    record.companyName,
      jobTitle:       record.jobTitle,
      token,
    });

  } catch (err) {
    console.error('Get verification form error:', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  SUBMIT VERIFICATION RESPONSE
//  POST /api/profile/employer-verification/respond
//  Called by employer after filling the form
// ════════════════════════════════════════════════════════════════
exports.respondToVerification = async (req, res) => {
  try {
    const { token, decision, notes } = req.body;
    // decision: 'confirmed' | 'rejected'

    if (!token || !decision) {
      return res.status(400).json({ message: 'Token and decision are required.' });
    }
    if (!['confirmed', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be confirmed or rejected.' });
    }

    const user = await User.findOne({
      'employerVerifications.verificationToken': token,
    });

    if (!user) {
      return res.status(404).json({ message: 'Invalid or expired verification link.' });
    }

    // Find and update the specific verification record
    const verIndex = user.employerVerifications.findIndex(
      v => v.verificationToken === token
    );

    if (verIndex === -1) {
      return res.status(404).json({ message: 'Verification record not found.' });
    }

    if (user.employerVerifications[verIndex].status !== 'pending') {
      return res.status(410).json({ message: 'This verification has already been submitted.' });
    }

    // Update the record
    user.employerVerifications[verIndex].status      = decision;
    user.employerVerifications[verIndex].respondedAt = new Date();
    user.employerVerifications[verIndex].notes       = notes || '';

    // ── Recalculate trust score ───────────────────────────────
    const confirmedCount = user.employerVerifications.filter(
      v => v.status === 'confirmed'
    ).length;

    let trustScore = 0;
    if (user.isVerified)                   trustScore += 20;
    if (user.onboarding?.basicProfileDone) trustScore += 15;
    if (user.githubAccessToken)            trustScore += 25;
    if (user.resumeText)                   trustScore += 20;
    if (user.skills?.length >= 5)          trustScore += 10;
    // +10 per confirmed employer, max 2 employers = max 20 bonus
    trustScore += Math.min(confirmedCount * 10, 20);
    trustScore = Math.min(trustScore, 100);

    user.trustScore = {
      ...user.trustScore,
      overall:           trustScore,
      verificationScore: confirmedCount * 10,
      lastUpdated:       new Date(),
    };

    await user.save();

    res.json({
      success:  true,
      decision,
      message:  decision === 'confirmed'
        ? 'Thank you for confirming. The freelancer has been notified.'
        : 'Thank you for your response. The freelancer has been notified.',
    });

  } catch (err) {
    console.error('Respond to verification error:', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};