const ClientProfile = require('../models/ClientProfile');

async function buildUserPayload(user) {
  const o = user.onboarding || {};
  const clientProfile = user.role === 'client'
    ? await ClientProfile.findOne({ userId: user._id })
      .select('companyProfileComplete companyName industry country')
      .lean()
    : null;
  const hasCompletedClientEssentials = (profile) =>
    !!(profile?.companyName?.trim() && profile?.industry?.trim() && profile?.country?.trim());
  const hasLegacyClientEssentials = (company) =>
    !!(company?.companyName?.trim() && company?.industry?.trim() && company?.location?.trim());

  return {
    _id: user._id, name: user.name, email: user.email, role: user.role, status: user.status, avatarUrl: user.avatarUrl || null,
    onboarding: {
      emailVerified:    !!user.isVerified,
      basicProfileDone: !!(o.basicProfileDone || user.headline || user.company?.companyName),
      socialLinked:     !!(o.socialLinked || user.githubUsername || user.resumeUrl),
      aiProcessingDone: !!(o.aiProcessingDone || user.skills?.length > 0),
      skillsReviewed:   !!o.skillsReviewed,
      ...(user.role === 'client' && {
        clientOnboardingComplete: !!(
          clientProfile?.companyProfileComplete ||
          hasCompletedClientEssentials(clientProfile) ||
          hasLegacyClientEssentials(user.company)
        ),
      }),
    },
  };
}
module.exports = { buildUserPayload };