// One place that knows the frontend page URLs, so notifications open the right page.
const pageLinks = {
  meetingRoom: (role, pid, mid) => `/${role}/meeting-room/${pid}/${mid}`,
  transcript:  (role, pid, mid) => `/${role}/meeting-transcription/${pid}/${mid}`,
  review:      (role, pid)      => `/${role}/requirements-review/${pid}`,
};
module.exports = pageLinks;