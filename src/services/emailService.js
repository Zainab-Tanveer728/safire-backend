// src/services/emailService.js
// ONE place for ALL outgoing email (Gmail SMTP via nodemailer, as in the SDS).
//
// Rules this file follows:
//  1. Nothing here ever throws. If email is not configured or fails, it logs and
//     returns false, so a mail problem can never break a project or meeting action.
//     BUT callers that REQUIRE the email (OTP, password reset) must check the
//     returned true/false and tell the user when it is false.
//  2. Every piece of user-controlled text (names, titles, reasons, announcement
//     text) is HTML-escaped before it goes into an email, so nobody can inject
//     links or markup into emails sent to other users.
//
// Email types covered (SRS section CI + SDS sequence tables):
//  CI-1   sendOtpEmail                 registration / resend verification code
//  CI-2   sendVerifiedEmail            account verified
//  CI-2   sendPasswordResetEmail       password reset request
//  CI-2   sendNewDeviceLoginEmail      login from an unrecognised device
//  CI-2   sendAccountStatusEmail       suspension / removal / reinstatement
//  CI-4   sendEmployerVerificationEmail  employer confirmation link (72 h)
//  CI-9   sendAdminAlertEmail          high-severity security events -> admins
//  CI-11  sendAnnouncementEmail        admin broadcast to a user group
//  M23    sendMeetingInviteEmail       meeting invitation with join link
//  CI-10  sendNotificationEmail        generic one-button email: proposal received,
//         change request submitted/approved/rejected, transcript ready, review
//         needed, scam report receipt, content decision, dispute resolution...

const nodemailer = require('nodemailer');

const BRAND = '#6C2BD9';

// ── Transport ──────────────────────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return transporter;
}

// Call once from server.js at startup to see immediately if email is misconfigured.
async function verifyEmailSetup() {
  const t = getTransporter();
  if (!t) {
    console.error('❌ [Email] EMAIL_USER / EMAIL_PASS not set in .env');
    return false;
  }
  try {
    await t.verify();
    console.log('✅ [Email] Ready — sending from:', process.env.EMAIL_USER);
    return true;
  } catch (err) {
    console.error('❌ [Email] Transporter error:', err.message);
    console.error('   Fix: EMAIL_PASS must be a Gmail App Password (16 chars, no spaces).');
    return false;
  }
}

// ── Small helpers ──────────────────────────────────────────────────────────
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const frontendUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

// path must start with "/" e.g. "/freelancer/project/123"
const appLink = (path) => `${frontendUrl()}${path.startsWith('/') ? path : `/${path}`}`;

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

const paragraph = (text, color = '#6B7280') =>
  `<p style="color:${color};margin:0 0 16px;line-height:1.5;">${esc(text).replace(/\n/g, '<br>')}</p>`;

const button = (label, url) =>
  `<a href="${esc(url)}" style="display:inline-block;padding:14px 28px;background:${BRAND};color:#fff;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;">${esc(label)}</a>`;

const small = (text) =>
  `<p style="color:#9CA3AF;font-size:12px;margin-top:24px;">${esc(text)}</p>`;

function layout({ heading, body, headingColor = BRAND }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
      <h2 style="color:${headingColor};margin:0 0 8px;">${esc(heading)}</h2>
      ${body}
    </div>`;
}

// ── Core sender ────────────────────────────────────────────────────────────
// Returns true if the mail was handed to the SMTP server, false otherwise.
async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[Email] EMAIL_USER / EMAIL_PASS not set. Skipped email to', to);
    return false;
  }
  if (!to) {
    console.warn('[Email] No recipient. Skipped:', subject);
    return false;
  }
  try {
    await t.sendMail({
      from: `"Safire" <${process.env.EMAIL_USER}>`,
      to,
      subject: oneLine(subject),
      html,
      ...(text ? { text } : {}),
    });
    return true;
  } catch (err) {
    console.error('[Email] Failed to', to, '-', err.message);
    return false;
  }
}

// ── CI-1: verification code (registration + "Resend code") ─────────────────
// minutes must match the real expiry you store in the database.
function sendOtpEmail(email, otp, minutes = 10) {
  return sendEmail({
    to: email,
    subject: 'Your Safire verification code',
    html: layout({
      heading: 'Verify your email',
      body: `
        ${paragraph('Use the code below to verify your account.')}
        <div style="background:#F5F0FF;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:${BRAND};">${esc(otp)}</span>
        </div>
        ${small(`This code expires in ${minutes} minutes. If you did not create a Safire account, ignore this email.`)}`,
    }),
  });
}

// ── CI-2: account verified ─────────────────────────────────────────────────
function sendVerifiedEmail({ to, name }) {
  return sendEmail({
    to,
    subject: 'Your Safire account is verified',
    html: layout({
      heading: 'Email verified',
      body: `
        ${paragraph(`Hi ${name || 'there'},`)}
        ${paragraph('Your email address has been verified and your Safire account is active.')}
        ${button('Open Safire', appLink('/login'))}`,
    }),
  });
}

// ── CI-2: password reset request ───────────────────────────────────────────
// token = the signed reset JWT. minutes must match the token's real expiry.
function sendPasswordResetEmail({ to, name, token, minutes = 15 }) {
  const url = appLink(`/reset-password?token=${encodeURIComponent(token)}`);
  return sendEmail({
    to,
    subject: 'Reset your Safire password',
    html: layout({
      heading: 'Reset your password',
      body: `
        ${paragraph(`Hi ${name || 'there'},`)}
        ${paragraph(`Click the button below to set a new password. This link expires in ${minutes} minutes.`)}
        ${button('Reset Password', url)}
        ${small("If you didn't request this, you can safely ignore this email. Your password will not change.")}`,
    }),
  });
}

// ── CI-2: login from an unrecognised device ────────────────────────────────
// NOTE: this only sends the email. Detecting a "new device" needs device
// tracking at login (store a hash of user-agent/IP per user) which is not built yet.
function sendNewDeviceLoginEmail({ to, name, device, ip, time = new Date() }) {
  return sendEmail({
    to,
    subject: 'New sign-in to your Safire account',
    html: layout({
      heading: 'New sign-in detected',
      headingColor: '#B45309',
      body: `
        ${paragraph(`Hi ${name || 'there'},`)}
        ${paragraph('Your account was just signed in to from a device we do not recognise.')}
        ${paragraph(`Device: ${device || 'Unknown'}\nIP address: ${ip || 'Unknown'}\nTime: ${new Date(time).toUTCString()}`, '#374151')}
        ${paragraph('If this was you, no action is needed. If not, reset your password right away.')}
        ${button('Reset password', appLink('/forgot-password'))}`,
    }),
  });
}

// ── CI-2 + SDS admin flows: suspension / removal / reinstatement ───────────
// status: 'suspended' | 'removed' | 'reinstated'
function sendAccountStatusEmail({ to, name, status, reason, appealEmail }) {
  const appeal = appealEmail || process.env.SUPPORT_EMAIL || process.env.EMAIL_USER;
  const copy = {
    suspended: {
      subject: 'Your Safire account has been suspended',
      heading: 'Account suspended',
      color: '#B91C1C',
      lines: [
        'Your Safire account has been suspended by an administrator.',
        reason ? `Reason: ${reason}` : '',
        `To appeal this decision, reply to ${appeal} with your account email and any supporting details.`,
      ],
    },
    removed: {
      subject: 'Your Safire account has been removed',
      heading: 'Account removed',
      color: '#B91C1C',
      lines: [
        'Your Safire account has been permanently removed.',
        reason ? `Reason: ${reason}` : '',
        `If you would like a copy of your data or want to ask about this decision, contact ${appeal}.`,
      ],
    },
    reinstated: {
      subject: 'Your Safire account has been reinstated',
      heading: 'Account reinstated',
      color: BRAND,
      lines: ['Your Safire account is active again. You can sign in as usual.'],
    },
  }[status];

  if (!copy) {
    console.warn('[Email] sendAccountStatusEmail: unknown status', status);
    return Promise.resolve(false);
  }

  return sendEmail({
    to,
    subject: copy.subject,
    html: layout({
      heading: copy.heading,
      headingColor: copy.color,
      body: `
        ${paragraph(`Hi ${name || 'there'},`)}
        ${copy.lines.filter(Boolean).map((l) => paragraph(l)).join('')}`,
    }),
  });
}

// ── CI-4: employer verification request (goes to the EMPLOYER, not a user) ─
// token = the 72-hour verification token stored on the employerVerification record.
function sendEmployerVerificationEmail({
  to, employerName, freelancerName, jobTitle, companyName, token, hours = 72,
}) {
  const url = appLink(`/verify-employer/${encodeURIComponent(token)}`);
  return sendEmail({
    to,
    subject: `Employment verification request for ${oneLine(freelancerName) || 'a Safire member'}`,
    html: layout({
      heading: 'Employment verification request',
      body: `
        ${paragraph(`Hello ${employerName || ''},`.trim())}
        ${paragraph(`${freelancerName || 'A Safire member'} has listed ${companyName ? `${companyName}` : 'your company'} as a previous employer${jobTitle ? ` (role: ${jobTitle})` : ''} and asked us to confirm their employment history.`)}
        ${paragraph('Please confirm or decline using the secure link below. No account is needed.')}
        ${button('Review request', url)}
        ${small(`This link expires in ${hours} hours. If you do not know this person, you can ignore this email.`)}`,
    }),
  });
}

// ── M23: meeting invitation ────────────────────────────────────────────────
// joinPath e.g. "/freelancer/meeting-room/<projectId>" or the client equivalent.
function sendMeetingInviteEmail({ to, name, inviterName, projectTitle, joinPath }) {
  return sendEmail({
    to,
    subject: `Meeting invitation: ${oneLine(projectTitle) || 'your Safire project'}`,
    html: layout({
      heading: 'You are invited to a meeting',
      body: `
        ${paragraph(`Hi ${name || 'there'},`)}
        ${paragraph(`${inviterName || 'Your project partner'} started a requirements meeting${projectTitle ? ` for "${projectTitle}"` : ''}. The meeting is recorded and transcribed so the requirements can be extracted automatically.`)}
        ${button('Join meeting', appLink(joinPath))}`,
    }),
  });
}

// ── CI-9: security alert to administrators ─────────────────────────────────
// Recipients: ADMIN_ALERT_EMAIL in .env (comma-separated), else EMAIL_USER.
// details: optional object, e.g. { userId, ip, attempts }
function sendAdminAlertEmail({ title, message, details = {} }) {
  const to = process.env.ADMIN_ALERT_EMAIL || process.env.EMAIL_USER;
  const rows = Object.entries(details)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');
  return sendEmail({
    to,
    subject: `[Safire security] ${oneLine(title)}`,
    html: layout({
      heading: title,
      headingColor: '#B91C1C',
      body: `
        ${paragraph(message)}
        ${rows ? paragraph(rows, '#374151') : ''}
        ${button('Open admin panel', appLink('/admin/dashboard'))}`,
    }),
  });
}

// ── CI-11: announcement broadcast ──────────────────────────────────────────
// recipients: [{ email, name }]. Sent one by one in small batches so a free
// Gmail account is not hit with a burst (it also has a daily sending limit, so
// for large audiences use a real mail provider later).
async function sendAnnouncementEmail({ recipients = [], title, message, link, highPriority = false }) {
  let sent = 0;
  let failed = 0;
  const BATCH = 10;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((r) =>
        sendNotificationEmail({
          to: r.email,
          name: r.name,
          title: highPriority ? `[Important] ${title}` : title,
          message,
          link,
        })
      )
    );
    results.forEach((ok) => (ok ? sent++ : failed++));
    if (i + BATCH < recipients.length) await new Promise((r) => setTimeout(r, 1000));
  }
  return { sent, failed };
}

// ── CI-10 and everything else: generic notification email ──────────────────
// Use for: proposal received, change request submitted/approved/rejected,
// transcript ready, requirements ready for review, project baseline set,
// scam report receipt, content moderation decision, dispute resolution, etc.
// link is an app path like "/freelancer/project/123" (optional).
function sendNotificationEmail({ to, name, title, message, link }) {
  return sendEmail({
    to,
    subject: title,
    html: layout({
      heading: title,
      body: `
        ${paragraph(`Hi ${name || 'there'},`)}
        ${paragraph(message)}
        ${link ? button('Open in Safire', appLink(link)) : ''}`,
    }),
  });
}

module.exports = {
  verifyEmailSetup,
  sendEmail,
  sendOtpEmail,
  sendVerifiedEmail,
  sendPasswordResetEmail,
  sendNewDeviceLoginEmail,
  sendAccountStatusEmail,
  sendEmployerVerificationEmail,
  sendMeetingInviteEmail,
  sendAdminAlertEmail,
  sendAnnouncementEmail,
  sendNotificationEmail,
};