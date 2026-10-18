// src/socket/meetingSignaling.js
// Live call "signalling" for Module 3 meetings.
//
// WebRTC sends the audio/video straight between the two browsers. The browsers
// only need a go-between to swap a few small messages first ("here is my offer",
// "here is my answer", "here is a network candidate"). This file is that go-between.
// No audio or video ever passes through this server.
//
// Safety rules (same spirit as projectAccess.js):
//   * you must be logged in (the normal login token is checked when connecting)
//   * you can only join the room of a meeting in a project YOU belong to
//     as its client or freelancer (admins cannot join a call)
//   * a room never holds more than one connection per person, so no third person
//     can ever listen in
//   * messages are only passed to the other person in the same room
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const MeetingSession = require('../models/MeetingSession');

const roomOf = (meetingId) => `meeting:${meetingId}`;
const idOf = (x) => String(x?._id || x);

function attachMeetingSignaling(httpServer, { corsOrigin } = {}) {
  const io = new Server(httpServer, {
    // Same address the rest of the backend uses (FRONTEND_URL). Before, this read CLIENT_URL, which
    // nobody set on the server, so the live site was refused and the call never connected.
    cors: {
      origin: String(corsOrigin || process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, ''),
      credentials: true,
    },
    maxHttpBufferSize: 1e5,           // signalling messages are tiny; refuse anything big
  });

  // ── 1. Who is connecting? ────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Not logged in.'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.purpose) return next(new Error('Not logged in.'));   // password-reset etc. tokens are not logins
      const user = await User.findById(decoded.userId);
      if (!user) return next(new Error('Not logged in.'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Not logged in.'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;

    // ── 2. Join one meeting room ───────────────────────────────────────────
    socket.on('meeting:join', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const meetingId = payload?.meetingId;
        if (!mongoose.isValidObjectId(meetingId)) return reply({ ok: false, message: 'Invalid meeting.' });
        const meeting = await MeetingSession.findById(meetingId);
        if (!meeting) return reply({ ok: false, message: 'Meeting not found.' });
        if (!['scheduled', 'active'].includes(meeting.status))
          return reply({ ok: false, message: 'This meeting has already finished.' });
        const project = await Project.findById(meeting.project);
        if (!project) return reply({ ok: false, message: 'Project not found.' });

        const mine = String(me._id);
        const party = idOf(project.client) === mine ? 'client'
                    : idOf(project.freelancer) === mine ? 'freelancer' : null;
        if (!party) return reply({ ok: false, message: 'You are not part of this project.' });

        // leave an older room this same connection was in
        if (socket.data.meetingId && socket.data.meetingId !== String(meetingId)) leave(socket);

        const room = roomOf(meetingId);
        // one connection per person: an older tab/browser of the same person is replaced
        const others = await io.in(room).fetchSockets();
        for (const s of others) {
          if (s.id !== socket.id && String(s.data.user._id) === mine) {
            s.emit('call:replaced');
            s.leave(room);
            s.data.meetingId = null;
          }
        }

        socket.join(room);
        socket.data.meetingId = String(meetingId);
        socket.data.party = party;

        const peers = (await io.in(room).fetchSockets()).filter((s) => s.id !== socket.id);
        socket.to(room).emit('peer:joined', { party, name: me.name });
        reply({
          ok: true,
          party,
          // "polite" side backs off if both start negotiating at once (WebRTC perfect negotiation)
          polite: party === 'freelancer',
          peerPresent: peers.length > 0,
          peerName: peers[0]?.data.user.name || null,
        });
      } catch (err) {
        console.error('[Signalling:join]', err.message);
        reply({ ok: false, message: 'Could not join the call.' });
      }
    });

    // ── 3. Pass messages to the other person only ──────────────────────────
    const relay = (event, pick) => socket.on(event, (payload) => {
      const meetingId = socket.data.meetingId;
      if (!meetingId) return;                          // not in a room: ignore
      const body = pick(payload || {});
      if (body) socket.to(roomOf(meetingId)).emit(event, body);
    });
    relay('signal', (p) => (p.description || p.candidate ? { description: p.description || null, candidate: p.candidate || null } : null));
    relay('media-state', (p) => ({ audio: !!p.audio, video: !!p.video }));

    socket.on('meeting:leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));
  });

  function leave(socket) {
    const meetingId = socket.data.meetingId;
    if (!meetingId) return;
    const room = roomOf(meetingId);
    socket.leave(room);
    socket.to(room).emit('peer:left', { party: socket.data.party });
    socket.data.meetingId = null;
  }

  return io;
}

// Tell everyone in a meeting's room something happened (used when someone ends the meeting).
function notifyMeeting(io, meetingId, event, payload) {
  try { io?.to(roomOf(meetingId)).emit(event, payload); } catch { /* best effort */ }
}

module.exports = { attachMeetingSignaling, notifyMeeting };