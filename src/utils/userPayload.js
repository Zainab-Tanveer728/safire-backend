function buildUserPayload(user) {
  const o = user.onboarding || {};
  return {
    _id: user._id, name: user.name, email: user.email, role: user.role, status: user.status, avatarUrl: user.avatarUrl || null,
    onboarding: {
      emailVerified:    true,
      basicProfileDone: !!(o.basicProfileDone || user.headline || user.company?.companyName),
      socialLinked:     !!(o.socialLinked || user.githubUsername || user.resumeUrl),
      aiProcessingDone: !!(o.aiProcessingDone || user.skills?.length > 0),
      skillsReviewed:   !!o.skillsReviewed,
    },
  };
}
module.exports = { buildUserPayload };