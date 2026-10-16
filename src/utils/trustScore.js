// src/utils/trustScore.js
// ONE trust-score formula for freelancers. Before this, aiController and profileController each had
// their own copy (with different employer points), so the score changed depending on which ran last.
// Replace it with the Module 4 scoring engine later; every caller only has to change here.
function calculateFreelancerTrust(user) {
  const confirmed = (user.employerVerifications || []).filter((v) => v.status === 'confirmed').length;
  let score = 0;
  if (user.isVerified)                   score += 20;
  if (user.onboarding?.basicProfileDone) score += 15;
  if (user.githubAccessToken)            score += 25;
  if (user.resumeText)                   score += 20;
  if ((user.skills?.length || 0) >= 5)   score += 10;
  score += Math.min(confirmed * 10, 20);   // +10 per confirmed employer, at most 2 count
  return Math.min(score, 100);
}

module.exports = { calculateFreelancerTrust };