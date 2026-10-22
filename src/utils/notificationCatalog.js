// src/utils/notificationCatalog.js
// ONE list of EVERY notification the whole Safire system can send (from the SRS/SDS).
//
// HOW TO USE (from any controller, now or after a module is built):
//     const { notify } = require('../services/notificationService');
//     await notify(userId, { type: 'transcript_ready', data: { projectId, transcriptId, projectTitle } });
// The catalog below turns "type + data" into the title, message, page link, colour
// and (if the SRS says so) the email. See NOTIFICATIONS_GUIDE.md for every type.
//
// ADDING A NEW KIND LATER: add one entry here. Nothing else needs to change.

const SEVERITIES = ['info', 'success', 'warning', 'action_required'];
const CATEGORIES = [
  'account', 'project', 'meeting', 'requirements', 'proposals',
  'jobs', 'trust', 'changes', 'disputes', 'admin', 'announcement',
];

// ── Where each notification sends the user when clicked ────────────────────
// Pages marked PLANNED do not exist yet. When you build one, fix its path HERE,
// in one place, and every notification that points to it is corrected.
const rolePath = (role) => (role === 'client' ? 'client' : role === 'admin' ? 'admin' : 'freelancer');
const home = (role) => `/${rolePath(role)}/dashboard`;

const LINKS = {
  home,
  project:       (role, id) => (id ? `/${rolePath(role)}/project/${id}` : home(role)),
  meetingRoom:   (role, pid, mid) =>
    pid && mid ? `/${rolePath(role)}/meeting-room/${pid}/${mid}` : (pid ? `/${rolePath(role)}/project/${pid}` : home(role)),
  transcript:    (role, pid, tid) =>
    pid && tid ? `/${rolePath(role)}/meeting-transcription/${pid}/${tid}` : LINKS.project(role, pid),
  extraction:    (role, id) => (id ? `/${rolePath(role)}/requirement-extraction/${id}` : home(role)),
  review:        (role, id) => (id ? `/${rolePath(role)}/requirements-review/${id}` : home(role)),
  profile:       (role) => `/${rolePath(role)}/profile`,
  myProposals:   () => '/freelancer/applications',
  employerVerification: () => '/onboarding/employer-verification',
  skillsReview:  () => '/onboarding/skills',
  // PLANNED pages (Modules 4, 5 and M34):
  job:           (role, id) => (id ? `/${rolePath(role)}/job/${id}` : home(role)),
  applicants:    (id) => (id ? `/client/job/${id}` : '/client/dashboard'),
  changeRequest: (role, pid, crid) =>
    pid ? `/${rolePath(role)}/project/${pid}/change-requests${crid ? `/${crid}` : ''}` : home(role),
  dispute:       (role, pid, did) =>
    pid ? `/${rolePath(role)}/project/${pid}/disputes${did ? `/${did}` : ''}` : home(role),
  feedback:      (role, pid) => (pid ? `/${rolePath(role)}/project/${pid}/feedback` : home(role)),
  notifications: (role) => `/${rolePath(role)}/notifications`,
  // Admin pages (these exist):
  admin: {
    dashboard:     '/admin/dashboard',
    users:         '/admin/users',
    disputes:      '/admin/disputes',
    reports:       '/admin/reports',
    moderation:    '/admin/moderation',
    announcements: '/admin/announcements',
  },
};

// ── Small helpers for the message templates ────────────────────────────────
const q = (s, fallback = 'your project') => (s ? `"${s}"` : fallback);
const T = (category, severity, label, rest) => ({
  category, severity, label, email: false, mandatory: false, ...rest,
});
// email: true      -> the SRS asks for an email as well (default for this type)
// mandatory: true  -> the user cannot switch this type off in notification settings
// build(data, ctx) -> { title, message, link, actionLabel?, severity? }
//                     ctx = { role, name } of the person receiving it

const NOTIFICATION_CATALOG = {

  // ══════════ MODULE 1 — ACCOUNT, SECURITY, VERIFICATION ══════════
  account_verified: T('account', 'success', 'Account verified', {
    audience: 'the user', when: 'Email OTP verified', data: '(none)',
    // The verification EMAIL is already sent by sendVerifiedEmail, so email stays false here.
    build: (d, c) => ({
      title: 'Your account is verified',
      message: 'Your email is verified. Finish setting up your profile to get started.',
      link: c.role === 'client' ? '/onboarding/company' : '/onboarding/profile',
    }),
  }),

  skills_extracted: T('account', 'success', 'Skills extracted from your profile', {
    audience: 'freelancer', when: 'AI skill extraction finished (resume / GitHub)', data: 'count?, confidence?',
    build: (d) => ({
      title: 'Your skills are ready to review',
      message: `We found ${d.count ?? 'new'} skills from your profile data${d.confidence ? ` (confidence ${d.confidence}%)` : ''}. Please review them.`,
      link: LINKS.skillsReview(), actionLabel: 'Review skills',
    }),
  }),

  employer_verification_confirmed: T('account', 'success', 'Employer confirmed your employment', {
    audience: 'freelancer', when: 'Employer confirms via the emailed link', data: 'companyName',
    build: (d, c) => ({
      title: 'Employment confirmed',
      message: `${d.companyName || 'Your employer'} confirmed your employment. Your trust score has been updated.`,
      link: LINKS.profile(c.role),
    }),
  }),

  employer_verification_rejected: T('account', 'warning', 'Employer declined verification', {
    audience: 'freelancer', when: 'Employer rejects the request', data: 'companyName',
    build: (d, c) => ({
      title: 'Employment could not be verified',
      message: `${d.companyName || 'Your employer'} did not confirm your employment history.`,
      link: LINKS.profile(c.role),
    }),
  }),

  employer_verification_expired: T('account', 'warning', 'Employer verification expired', {
    audience: 'freelancer', when: '72-hour verification link expires', data: 'companyName',
    build: (d) => ({
      title: 'Verification request expired',
      message: `Your request to ${d.companyName || 'your employer'} expired after 72 hours. Send it again to continue.`,
      link: LINKS.employerVerification(), actionLabel: 'Resend request',
    }),
  }),

  new_device_login: T('account', 'warning', 'Sign-in from a new device', {
    email: true, mandatory: true,
    audience: 'the user', when: 'Login from an unrecognised device', data: 'device?, ip?',
    build: (d, c) => ({
      title: 'New sign-in to your account',
      message: `Your account was signed in to from a new device${d.device ? ` (${d.device})` : ''}${d.ip ? `, IP ${d.ip}` : ''}. If this was not you, reset your password.`,
      link: LINKS.profile(c.role),
    }),
  }),

  account_suspended: T('account', 'action_required', 'Account suspended', {
    email: true, mandatory: true,
    audience: 'the suspended user', when: 'Admin suspends, or trust score falls below the auto-suspend threshold', data: 'reason?',
    build: (d) => ({
      title: 'Your account has been suspended',
      message: `${d.reason ? `Reason: ${d.reason}. ` : ''}You can appeal this decision by contacting support.`,
      link: '/unauthorized',
    }),
  }),

  account_removed: T('account', 'action_required', 'Account removed', {
    email: true, mandatory: true,
    audience: 'the removed user', when: 'Admin permanently removes the account', data: 'reason?',
    build: (d) => ({
      title: 'Your account has been removed',
      message: `${d.reason ? `Reason: ${d.reason}. ` : ''}Contact support if you want a copy of your data or have questions.`,
      link: '/unauthorized',
    }),
  }),

  account_reinstated: T('account', 'success', 'Account reinstated', {
    email: true, mandatory: true,
    audience: 'the user', when: 'Admin lifts a suspension', data: '(none)',
    build: (d, c) => ({
      title: 'Your account is active again',
      message: 'Your suspension has been lifted. You can use Safire as usual.',
      link: home(c.role),
    }),
  }),

  // ══════════ MODULE 2 — PROPOSALS, APPLICATIONS, JOB MATCHES ══════════
  proposal_received: T('proposals', 'info', 'New proposal received', {
    email: true,
    audience: 'client', when: 'Freelancer submits a proposal to a job post', data: 'freelancerName, jobTitle, jobId, portfolioNote?',
    build: (d) => ({
      title: 'New proposal received',
      message: `${d.freelancerName || 'A freelancer'} applied for ${q(d.jobTitle, 'your job post')}.${d.portfolioNote ? ` ${d.portfolioNote}` : ''}`,
      link: LINKS.applicants(d.jobId), actionLabel: 'View applicants',
    }),
  }),

  proposal_accepted: T('proposals', 'success', 'Proposal accepted', {
    email: true,
    audience: 'freelancer', when: 'Client accepts / hires', data: 'clientName, jobTitle, projectId?',
    build: (d, c) => ({
      title: 'Your proposal was accepted',
      message: `${d.clientName || 'The client'} accepted your proposal for ${q(d.jobTitle, 'the job')}.`,
      link: d.projectId ? LINKS.project(c.role, d.projectId) : LINKS.myProposals(), actionLabel: 'Open',
    }),
  }),

  proposal_rejected: T('proposals', 'info', 'Proposal not selected', {
    audience: 'freelancer', when: 'Client rejects a proposal', data: 'jobTitle',
    build: (d) => ({
      title: 'Proposal not selected',
      message: `Your proposal for ${q(d.jobTitle, 'the job')} was not selected this time.`,
      link: LINKS.myProposals(),
    }),
  }),

  applicant_shortlisted: T('proposals', 'success', 'You were shortlisted', {
    email: true,
    audience: 'freelancer', when: 'Client clicks Shortlist on the applicant card', data: 'clientName, jobTitle',
    build: (d) => ({
      title: 'You were shortlisted',
      message: `${d.clientName || 'A client'} shortlisted you for ${q(d.jobTitle, 'a job')}.`,
      link: LINKS.myProposals(),
    }),
  }),

  job_match: T('proposals', 'info', 'New job matches your skills', {
    audience: 'freelancer', when: 'AI engine finds a job matching verified skills (M34)', data: 'companyName, jobTitle, jobId, trustedClient?',
    build: (d, c) => ({
      title: `New job match: ${d.jobTitle || 'a job'}`,
      message: `${d.companyName || 'A client'} is hiring.${d.trustedClient ? ' Trusted Client.' : ''}`,
      link: LINKS.job(c.role, d.jobId), actionLabel: 'View Job',
    }),
  }),

  low_trust_client_alert: T('proposals', 'action_required', 'Low trust client alert', {
    audience: 'freelancer', when: 'A flagged / low-trust client posts a relevant job (M34)', data: 'companyName, jobTitle, jobId',
    build: (d, c) => ({
      title: 'Low trust client alert',
      message: `${d.companyName || 'A client'} posted ${q(d.jobTitle, 'a job')} and has a low trust score. Review the scam analysis before applying.`,
      link: LINKS.job(c.role, d.jobId), actionLabel: 'Review Job',
    }),
  }),

  // ══════════ MODULE 4 — JOB POST SAFETY & SCAM DETECTION ══════════
  job_post_published: T('jobs', 'success', 'Job post published', {
    audience: 'client', when: 'Scam scan passes and the post goes live', data: 'jobTitle, jobId',
    build: (d, c) => ({
      title: 'Your job post is live',
      message: `${q(d.jobTitle, 'Your job post')} passed our safety check and is now visible to freelancers.`,
      link: LINKS.job(c.role, d.jobId),
    }),
  }),

  job_post_held: T('jobs', 'warning', 'Job post under review', {
    email: true,
    audience: 'client', when: 'Scan marks the post Suspicious / Scam and holds it for admin review', data: 'jobTitle, jobId',
    build: (d, c) => ({
      title: 'Your job post is under review',
      message: `${q(d.jobTitle, 'Your job post')} is on hold while our team reviews it. We will tell you the result.`,
      link: LINKS.job(c.role, d.jobId),
    }),
  }),

  job_post_flagged: T('jobs', 'warning', 'Job post flagged', {
    email: true, mandatory: true,
    audience: 'client (post owner)', when: 'Reviewer clicks Flag as Scam (M28)', data: 'jobTitle, jobId, reason?',
    build: (d, c) => ({
      title: 'Your job post was flagged',
      message: `${q(d.jobTitle, 'Your job post')} was flagged for review.${d.reason ? ` Reason: ${d.reason}.` : ''}`,
      link: LINKS.job(c.role, d.jobId),
    }),
  }),

  job_post_removed_scam: T('jobs', 'action_required', 'Job post removed as scam', {
    email: true, mandatory: true,
    audience: 'client (post owner)', when: 'Post confirmed as scam by the model (>= 90%) or an admin', data: 'jobTitle, jobId',
    build: (d) => ({
      title: 'Your job post was removed',
      message: `${q(d.jobTitle, 'Your job post')} was confirmed as fraudulent and removed. Your trust score has been affected and your account is under review.`,
      link: '/client/profile',
    }),
  }),

  applied_job_scam_confirmed: T('jobs', 'action_required', 'A job you applied to was a scam', {
    email: true, mandatory: true,
    audience: 'every applicant of the post', when: 'Post confirmed as scam', data: 'jobTitle',
    build: (d) => ({
      title: 'A job you applied to was confirmed as a scam',
      message: `${q(d.jobTitle, 'A job you applied to')} was confirmed as fraudulent and removed. Do not share personal or payment details with this poster.`,
      link: LINKS.myProposals(),
    }),
  }),

  scam_report_received: T('jobs', 'info', 'Scam report received', {
    audience: 'the reporter', when: 'User reports a job post as suspicious', data: 'jobTitle',
    build: (d) => ({
      title: 'We received your report',
      message: `Thank you. We are checking ${q(d.jobTitle, 'the job post')} and will act if it breaks our rules.`,
      link: null,
    }),
  }),

  content_warning_issued: T('jobs', 'warning', 'Warning issued', {
    email: true, mandatory: true,
    audience: 'content owner', when: 'Admin chooses Issue Warning on flagged content', data: 'contentType, reason?',
    build: (d, c) => ({
      title: 'You received a warning',
      message: `An admin reviewed your ${d.contentType || 'content'} and issued a warning.${d.reason ? ` Reason: ${d.reason}.` : ''}`,
      link: LINKS.profile(c.role),
    }),
  }),

  content_removed: T('jobs', 'warning', 'Content removed', {
    email: true, mandatory: true,
    audience: 'content owner', when: 'Admin chooses Remove Content', data: 'contentType, reason?',
    build: (d, c) => ({
      title: 'Your content was removed',
      message: `An admin removed your ${d.contentType || 'content'}.${d.reason ? ` Reason: ${d.reason}.` : ''}`,
      link: LINKS.profile(c.role),
    }),
  }),

  content_cleared: T('jobs', 'success', 'Content cleared after review', {
    audience: 'content owner', when: 'Admin chooses Dismiss Flag', data: 'contentType',
    build: (d) => ({
      title: 'Your content was reviewed and cleared',
      message: `Our team reviewed your ${d.contentType || 'content'} and found no problem. No action is needed.`,
      link: null,
    }),
  }),

  // ══════════ MODULE 4 — TRUST SCORE & FEEDBACK ══════════
  trust_score_change: T('trust', 'info', 'Trust score changed', {
    audience: 'the user', when: 'Trust score recomputed and the value changed', data: 'oldScore, newScore',
    build: (d, c) => {
      const up = Number(d.newScore) >= Number(d.oldScore);
      return {
        title: up ? 'Your trust score went up' : 'Your trust score went down',
        message: `Your trust score changed from ${d.oldScore ?? '?'} to ${d.newScore ?? '?'}.`,
        link: LINKS.profile(c.role),
        severity: up ? 'success' : 'warning',
      };
    },
  }),

  trust_score_warning: T('trust', 'action_required', 'Trust score warning', {
    email: true, mandatory: true,
    audience: 'the user', when: 'Score drops below the admin warning threshold (default 65) or below 40', data: 'score, threshold?',
    build: (d, c) => ({
      title: 'Trust score warning',
      message: `Your trust score is ${d.score ?? 'low'}${d.threshold ? `, below the platform threshold of ${d.threshold}` : ''}. Some features may be restricted. Complete your verification to improve it.`,
      link: LINKS.profile(c.role),
    }),
  }),

  feedback_requested: T('trust', 'info', 'Please rate your project partner', {
    email: true,
    audience: 'both parties', when: 'Project marked completed (feedback window opens)', data: 'projectTitle, projectId, partnerName?',
    build: (d, c) => ({
      title: 'How was your experience?',
      message: `${q(d.projectTitle)} is complete. Please rate ${d.partnerName || 'your project partner'}.`,
      link: LINKS.feedback(c.role, d.projectId), actionLabel: 'Leave feedback',
    }),
  }),

  feedback_received: T('trust', 'info', 'You received feedback', {
    audience: 'the reviewed user', when: 'Other party submits a rating', data: 'fromName?, rating?',
    build: (d, c) => ({
      title: 'You received new feedback',
      message: `${d.fromName || 'Your project partner'} rated you${d.rating ? ` ${d.rating}/5` : ''}.`,
      link: LINKS.profile(c.role),
    }),
  }),

  // ══════════ PROJECTS ══════════
  project_created: T('project', 'info', 'New project assigned to you', {
    email: true,
    audience: 'freelancer', when: 'Client creates a project with the freelancer', data: 'clientName, projectTitle, projectId',
    build: (d, c) => ({
      title: 'New project assigned to you',
      message: `${d.clientName || 'A client'} started the project ${q(d.projectTitle)} with you.`,
      link: LINKS.project(c.role, d.projectId), actionLabel: 'Open project',
    }),
  }),

  project_completed: T('project', 'success', 'Project completed', {
    email: true,
    audience: 'both parties', when: 'Project marked completed', data: 'projectTitle, projectId',
    build: (d, c) => ({
      title: 'Project completed',
      message: `${q(d.projectTitle)} was marked as completed.`,
      link: LINKS.project(c.role, d.projectId),
    }),
  }),

  // ══════════ MODULE 3 — MEETINGS & TRANSCRIPTS ══════════
  meeting_invite: T('meeting', 'action_required', 'Meeting invitation', {
    email: true,
    audience: 'the other participant', when: 'Someone starts a meeting session', data: 'inviterName, projectTitle, projectId',
    build: (d, c) => ({
      title: `${d.inviterName || 'Your project partner'} started a meeting`,
      message: `Join the requirements meeting for ${q(d.projectTitle)}. It is recorded and transcribed.`,
      link: LINKS.meetingRoom(c.role, d.projectId, d.meetingId), actionLabel: 'Join meeting',
    }),
  }),

  meeting_interrupted: T('meeting', 'warning', 'Meeting interrupted', {
    audience: 'both parties', when: 'A participant did not reconnect within 3 minutes', data: 'projectTitle, projectId',
    build: (d, c) => ({
      title: 'Meeting interrupted',
      message: `The meeting for ${q(d.projectTitle)} ended because a connection was lost. The part recorded so far is being processed.`,
      link: LINKS.project(c.role, d.projectId),
    }),
  }),

  meeting_processing: T('meeting', 'info', 'Meeting is being processed', {
    audience: 'both parties', when: 'Meeting ended; audio saved and transcription started', data: 'projectTitle, projectId',
    build: (d, c) => ({
      title: 'Your meeting is being processed',
      message: `We are transcribing the meeting for ${q(d.projectTitle)}. We will tell you when it is ready.`,
      link: LINKS.project(c.role, d.projectId),
    }),
  }),

  transcript_ready: T('meeting', 'success', 'Transcript ready', {
    email: true,
    audience: 'both parties', when: 'Transcription finished', data: 'projectTitle, projectId, transcriptId',
    build: (d, c) => ({
      title: 'Your meeting transcript is ready',
      message: `The transcript for ${q(d.projectTitle)} is ready to read.`,
      link: LINKS.transcript(c.role, d.projectId, d.transcriptId), actionLabel: 'View transcript',
    }),
  }),

  transcript_low_confidence: T('meeting', 'warning', 'Transcript may be inaccurate', {
    audience: 'both parties', when: 'ASR confidence stays below 70% after the retry', data: 'projectTitle, projectId, transcriptId',
    build: (d, c) => ({
      title: 'Please check the transcript',
      message: `The transcript for ${q(d.projectTitle)} may contain errors because the audio quality was low. Manual review is recommended.`,
      link: LINKS.transcript(c.role, d.projectId, d.transcriptId), actionLabel: 'Review transcript',
    }),
  }),

  processing_failed: T('meeting', 'warning', 'Processing failed', {
    audience: 'both parties', when: 'Transcription, extraction or summary job fails', data: 'stage (transcription | extraction | summary), projectTitle, projectId',
    build: (d, c) => ({
      title: 'Processing failed',
      message: `We could not finish the ${d.stage || 'processing'} step for ${q(d.projectTitle)}. You can retry from the project page.`,
      link: LINKS.project(c.role, d.projectId),
    }),
  }),

  // ══════════ MODULE 3 — REQUIREMENTS ══════════
  requirements_ready: T('requirements', 'action_required', 'Requirements ready for review', {
    email: true,
    audience: 'both parties', when: 'Extraction + summarization finished', data: 'projectTitle, projectId, count?',
    build: (d, c) => ({
      title: 'Requirements are ready for review',
      message: `${d.count ? `${d.count} requirements were` : 'Requirements were'} extracted for ${q(d.projectTitle)}. Please confirm, edit or reject them.`,
      link: LINKS.review(c.role, d.projectId), actionLabel: 'Review requirements',
    }),
  }),

  review_needed: T('requirements', 'warning', 'Requirements waiting for your review', {
    audience: 'party who has not finished reviewing', when: 'Reminder while items are still Pending Review', data: 'projectTitle, projectId, pending',
    build: (d, c) => ({
      title: 'Requirements need your review',
      message: `${d.pending ?? 'Some'} requirements for ${q(d.projectTitle)} are still waiting for your decision.`,
      link: LINKS.review(c.role, d.projectId), actionLabel: 'Review now',
    }),
  }),

  requirement_updated: T('requirements', 'info', 'A requirement was updated', {
    audience: 'the other party', when: 'Someone confirms, edits or rejects a requirement', data: 'action (confirmed | edited | rejected), requirementId, byName, projectId',
    build: (d, c) => ({
      title: 'A requirement was updated',
      message: `${d.byName || 'Your project partner'} ${d.action || 'updated'} ${d.requirementId || 'a requirement'}.`,
      link: LINKS.review(c.role, d.projectId),
    }),
  }),

  review_complete: T('requirements', 'success', 'Project baseline set', {
    email: true,
    audience: 'both parties', when: 'No requirement is left in Pending Review', data: 'projectTitle, projectId',
    build: (d, c) => ({
      title: 'Project requirements are locked in',
      message: `All requirements for ${q(d.projectTitle)} are reviewed. From now on, changes are made through change requests.`,
      link: LINKS.project(c.role, d.projectId),
    }),
  }),

  // ══════════ MARKETPLACE + MODULE 3 TYPES USED BY THE NEW CONTROLLERS ══════════
  // These controllers pass title / message / link themselves, so build() is only a fallback.
  new_application: T('jobs', 'info', 'New application on your job', {
    email: true,
    audience: 'client', when: 'A freelancer applies to a job', data: 'jobId, jobTitle, freelancerName',
    build: (d) => ({
      title: 'New application',
      message: `${d.freelancerName || 'A freelancer'} applied to ${q(d.jobTitle, 'your job')}.`,
      link: LINKS.applicants(d.jobId), actionLabel: 'View applicants',
    }),
  }),

  application_shortlisted: T('jobs', 'success', 'You were shortlisted', {
    audience: 'freelancer', when: 'Client shortlists the application', data: 'jobId, jobTitle',
    build: (d) => ({ title: 'You were shortlisted', message: `You are on the shortlist for ${q(d.jobTitle, 'a job')}.`, link: LINKS.myProposals() }),
  }),

  application_accepted: T('jobs', 'success', 'You were hired', {
    email: true,
    audience: 'freelancer', when: 'Client hires the freelancer (project is created)', data: 'jobTitle, projectId',
    build: (d, c) => ({
      title: 'You were hired',
      message: `You were hired for ${q(d.jobTitle, 'a job')}.`,
      link: LINKS.project(c.role, d.projectId), actionLabel: 'Open project',
    }),
  }),

  application_rejected: T('jobs', 'info', 'Application not selected', {
    audience: 'freelancer', when: 'Client rejects, hires someone else, or closes the job', data: 'jobTitle',
    build: (d) => ({ title: 'Application not selected', message: `Your application for ${q(d.jobTitle, 'the job')} was not selected.`, link: LINKS.myProposals() }),
  }),

  meeting_consent: T('meeting', 'action_required', 'Recording consent', {
    audience: 'the other participant', when: 'One person agrees to the recording', data: 'projectId, meetingId',
    build: (d, c) => ({
      title: 'Recording consent requested',
      message: 'Your project partner agreed to record the meeting. Please give your consent too.',
      link: LINKS.meetingRoom(c.role, d.projectId, d.meetingId), actionLabel: 'Open meeting',
    }),
  }),

  requirement_added: T('requirements', 'info', 'A requirement was added', {
    audience: 'the other party', when: 'Someone adds a requirement by hand', data: 'projectId',
    build: (d, c) => ({ title: 'A requirement was added', message: 'Your project partner added a requirement.', link: LINKS.review(c.role, d.projectId) }),
  }),

  requirement_reviewed: T('requirements', 'info', 'A requirement was reviewed', {
    audience: 'the other party', when: 'Someone confirms, edits, rejects or reverts a requirement', data: 'projectId',
    build: (d, c) => ({ title: 'A requirement was reviewed', message: 'Your project partner reviewed a requirement.', link: LINKS.review(c.role, d.projectId) }),
  }),

  // ══════════ MODULE 5 — CHANGE REQUESTS ══════════
  change_request_submitted: T('changes', 'action_required', 'Change request submitted', {
    email: true,
    audience: 'the other party', when: 'Someone submits a change request', data: 'byName, requirementId, projectId, changeRequestId',
    build: (d, c) => ({
      title: 'New change request',
      message: `${d.byName || 'Your project partner'} asked to change ${d.requirementId || 'a requirement'}. Please review it.`,
      link: LINKS.changeRequest(c.role, d.projectId, d.changeRequestId), actionLabel: 'Review request',
    }),
  }),

  change_request_comment: T('changes', 'info', 'New comment on a change request', {
    audience: 'the other party', when: 'Someone comments on a pending change request', data: 'byName, projectId, changeRequestId',
    build: (d, c) => ({
      title: 'New comment on a change request',
      message: `${d.byName || 'Your project partner'} commented on a change request.`,
      link: LINKS.changeRequest(c.role, d.projectId, d.changeRequestId),
    }),
  }),

  change_request_reminder: T('changes', 'warning', 'Change request needs attention', {
    email: true,
    audience: 'both parties', when: 'Pending change request has no activity for 7 days', data: 'requirementId, projectId, changeRequestId',
    build: (d, c) => ({
      title: 'A change request is waiting',
      message: `The change request for ${d.requirementId || 'a requirement'} has had no activity for 7 days.`,
      link: LINKS.changeRequest(c.role, d.projectId, d.changeRequestId), actionLabel: 'Respond',
    }),
  }),

  change_request_stalled: T('changes', 'warning', 'Change request escalated to admin', {
    email: true,
    audience: 'both parties', when: '3 more days pass after the reminder', data: 'requirementId, projectId, changeRequestId',
    build: (d, c) => ({
      title: 'Change request escalated',
      message: `The change request for ${d.requirementId || 'a requirement'} was escalated to an admin because there was no response.`,
      link: LINKS.changeRequest(c.role, d.projectId, d.changeRequestId),
    }),
  }),

  change_request_awaiting_approval: T('changes', 'action_required', 'Your approval is needed', {
    email: true,
    audience: 'the party who has not approved yet', when: 'One party approves; second approval is needed', data: 'byName, requirementId, projectId, changeRequestId',
    build: (d, c) => ({
      title: 'Your approval is needed',
      message: `${d.byName || 'Your project partner'} approved the change to ${d.requirementId || 'a requirement'}. It needs your approval too.`,
      link: LINKS.changeRequest(c.role, d.projectId, d.changeRequestId), actionLabel: 'Approve or reject',
    }),
  }),

  change_request_approved: T('changes', 'success', 'Change request approved', {
    email: true,
    audience: 'both parties', when: 'Both parties approved; change applied', data: 'requirementId, projectId, changeRequestId',
    build: (d, c) => ({
      title: 'Change approved and applied',
      message: `The change to ${d.requirementId || 'the requirement'} was approved by both parties and is now live.`,
      link: LINKS.changeRequest(c.role, d.projectId, d.changeRequestId),
    }),
  }),

  change_request_rejected: T('changes', 'warning', 'Change request rejected', {
    email: true,
    audience: 'both parties', when: 'Either party rejects', data: 'requirementId, projectId, changeRequestId, reason?',
    build: (d, c) => ({
      title: 'Change request rejected',
      message: `The change to ${d.requirementId || 'the requirement'} was rejected.${d.reason ? ` Reason: ${d.reason}.` : ''}`,
      link: LINKS.changeRequest(c.role, d.projectId, d.changeRequestId),
    }),
  }),

  // ══════════ MODULE 5/6 — DISPUTES ══════════
  dispute_opened: T('disputes', 'warning', 'Dispute opened', {
    email: true, mandatory: true,
    audience: 'both parties', when: 'Either party starts a dispute', data: 'requirementId?, projectId, disputeId?',
    build: (d, c) => ({
      title: 'A dispute was opened',
      message: `A dispute was opened${d.requirementId ? ` about ${d.requirementId}` : ''}. Changes to it are frozen until an admin decides.`,
      link: LINKS.dispute(c.role, d.projectId, d.disputeId),
    }),
  }),

  dispute_resolved: T('disputes', 'success', 'Dispute resolved', {
    email: true, mandatory: true,
    audience: 'both parties', when: 'Admin records a decision', data: 'resolution (e.g. in favour of the client), projectId, disputeId?',
    build: (d, c) => ({
      title: 'Dispute resolved',
      message: `An admin reviewed the evidence and decided ${d.resolution || 'the outcome'}.`,
      link: LINKS.dispute(c.role, d.projectId, d.disputeId),
    }),
  }),

  // ══════════ MARKETPLACE: HIRING, OFFERS, DELIVERY, REVIEWS, ENDING A PROJECT ══════════
  job_invitation: T('jobs', 'action_required', 'You were invited to a job', {
    email: true, audience: 'the invited freelancer', when: 'Client invites a freelancer from the directory', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'You were invited to a job',
      message: d.message || 'A client invited you to apply for a job.',
      link: d.link || '/freelancer/jobs',
    }),
  }),

  application_message: T('proposals', 'info', 'New message about a proposal', {
    audience: 'the other person in the proposal chat', when: 'Either person sends a chat message', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'New message',
      message: d.message || 'You have a new message about a proposal.',
      link: d.link || LINKS.myProposals(),
    }),
  }),

  offer_received: T('proposals', 'action_required', 'You received an offer', {
    email: true, audience: 'the freelancer', when: 'Client sends an offer', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'You received an offer',
      message: d.message || 'A client sent you an offer. Please answer before it expires.',
      link: d.link || LINKS.myProposals(),
    }),
  }),

  offer_accepted: T('proposals', 'success', 'Your offer was accepted', {
    email: true, audience: 'the client', when: 'Freelancer accepts the offer (project is created)', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Offer accepted',
      message: d.message || 'The freelancer accepted your offer. The project has started.',
      link: d.link || LINKS.home(c.role),
    }),
  }),

  offer_declined: T('proposals', 'info', 'Your offer was declined', {
    audience: 'the client', when: 'Freelancer declines the offer', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Offer declined',
      message: d.message || 'The freelancer declined your offer.',
      link: d.link || LINKS.home(c.role),
    }),
  }),

  invitation_declined: T('proposals', 'info', 'Your invitation was declined', {
    audience: 'the client', when: 'Freelancer declines an invitation', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Invitation declined',
      message: d.message || 'The freelancer declined your invitation.',
      link: d.link || LINKS.home(c.role),
    }),
  }),

  offer_withdrawn: T('proposals', 'warning', 'An offer was withdrawn', {
    audience: 'the freelancer', when: 'Client withdraws a live offer', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Offer withdrawn',
      message: d.message || 'The client withdrew the offer.',
      link: d.link || LINKS.myProposals(),
    }),
  }),

  offer_expired: T('proposals', 'warning', 'An offer expired', {
    audience: 'both people', when: 'Nobody answered an offer in time', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Offer expired',
      message: d.message || 'An offer expired before it was answered.',
      link: d.link || LINKS.home(c.role),
    }),
  }),

  delivery_submitted: T('project', 'action_required', 'Work was delivered', {
    email: true, audience: 'the client', when: 'Freelancer submits work', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Work delivered',
      message: d.message || 'The freelancer delivered work. Please review it.',
      link: d.link || LINKS.project(c.role, d.projectId),
    }),
  }),

  delivery_reminder: T('project', 'warning', 'A delivery will be accepted soon', {
    email: true, audience: 'the client', when: '2 days before the review time ends', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Please review the delivery',
      message: d.message || 'A delivery will be accepted automatically soon unless you answer.',
      link: d.link || LINKS.project(c.role, d.projectId),
    }),
  }),

  delivery_auto_accepted: T('project', 'info', 'A delivery was accepted automatically', {
    email: true, audience: 'the client', when: 'The review time ended with no answer', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Delivery accepted automatically',
      message: d.message || 'A delivery was accepted because it was not answered in time.',
      link: d.link || LINKS.project(c.role, d.projectId),
    }),
  }),

  revision_requested: T('project', 'warning', 'Changes were requested', {
    email: true, audience: 'the freelancer', when: 'Client asks for changes on a delivery', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Changes requested',
      message: d.message || 'The client asked for changes on your delivery.',
      link: d.link || LINKS.project(c.role, d.projectId),
    }),
  }),

  cancel_requested: T('project', 'action_required', 'A request to cancel a project', {
    email: true, audience: 'the other person', when: 'Someone asks to cancel, or it is sent to an admin', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Request to cancel the project',
      message: d.message || 'Someone asked to cancel the project. Please answer.',
      link: d.link || LINKS.project(c.role, d.projectId),
    }),
  }),

  cancel_answered: T('project', 'info', 'Your cancellation request was answered', {
    email: true, audience: 'the person who asked', when: 'The other person accepts or declines', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'Cancellation answered',
      message: d.message || 'Your request to cancel the project was answered.',
      link: d.link || LINKS.project(c.role, d.projectId),
    }),
  }),

  review_received: T('project', 'info', 'You received a review', {
    audience: 'the reviewed person', when: 'Someone reviews you', data: 'title?, message?, link?',
    // controllers pass the finished text and link; the defaults below are used when only a type is given
    build: (d, c) => ({
      title: d.title || 'You received a review',
      message: d.message || 'You received a new review.',
      link: d.link || LINKS.profile(c.role),
    }),
  }),

  // ══════════ MODULE 6 — ADMIN ══════════
  admin_security_alert: T('admin', 'action_required', 'Security alert', {
    email: true, mandatory: true,
    audience: 'all admins', when: 'High-severity security event (repeated failed logins, anomaly flag, confirmed scam)', data: 'title, details?',
    build: (d) => ({
      title: d.title || 'Security alert',
      message: d.details || 'A high-severity security event needs your attention.',
      link: LINKS.admin.dashboard, actionLabel: 'Open security panel',
    }),
  }),

  admin_review_needed: T('admin', 'warning', 'Item needs admin review', {
    audience: 'all admins', when: 'New item in a review queue (held post, stalled change, duplicate profile, high-risk profile, dispute)',
    data: 'kind (job_post | profile | duplicate_profile | change_request | dispute), summary?',
    build: (d) => ({
      title: 'New item needs review',
      message: d.summary || `A ${String(d.kind || 'item').replace(/_/g, ' ')} is waiting for admin review.`,
      link: d.kind === 'dispute' ? LINKS.admin.disputes : LINKS.admin.moderation,
      actionLabel: 'Open queue',
    }),
  }),

  admin_task_completed: T('admin', 'info', 'Admin task finished', {
    audience: 'the admin who started it', when: 'Batch trust-score recalculation or report generation finishes', data: 'task',
    build: (d) => ({
      title: 'Task finished',
      message: `${d.task || 'Your task'} has finished.`,
      link: LINKS.admin.reports,
    }),
  }),

  // ══════════ ANNOUNCEMENTS ══════════
  announcement: T('announcement', 'info', 'Platform announcements', {
    email: true, mandatory: true,
    audience: 'the targeted group', when: 'Admin sends an announcement', data: 'title, body, highPriority?, link?',
    build: (d) => ({
      title: d.title || 'Platform announcement',
      message: d.body || '',
      link: d.link || null,
      severity: d.highPriority ? 'warning' : 'info',
    }),
  }),
};

// Types a user may switch on/off in notification settings (FR34.3), grouped for the UI
function settingsList() {
  return Object.entries(NOTIFICATION_CATALOG)
    .filter(([, def]) => !def.mandatory)
    .map(([type, def]) => ({ type, label: def.label, category: def.category }));
}

module.exports = {
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES: Object.keys(NOTIFICATION_CATALOG),
  SEVERITIES,
  CATEGORIES,
  LINKS,
  settingsList,
};