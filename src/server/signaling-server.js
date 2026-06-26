/**
 * Blackstar Support Tool - Signaling Server
 *
 * WebSocket relay that brokers session codes, connection approval,
 * and WebRTC signaling between requester and technician.
 *
 * Run standalone:  node src/server/signaling-server.js [port]
 * Or embed via:    require('./signaling-server').start(port)
 */

const { WebSocketServer, WebSocket } = require('ws');

// ── Session and client state ──────────────────────────────────────────────────

const sessions = new Map();   // code → { requester, technician, created }
const clients  = new Map();   // ws   → { id, sessionCode, role, name }

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function generateSessionCode() {
  // Exclude ambiguous characters: I, O, 0, 1
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3) code += '-';
  }
  if (sessions.has(code)) return generateSessionCode();
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    send(ws, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  const client = clients.get(ws);

  switch (msg.type) {

    // Requester creates a new session and receives a unique code
    case 'create-session': {
      const code = generateSessionCode();
      sessions.set(code, {
        requester: ws,
        technician: null,
        created: new Date(),
      });
      client.sessionCode = code;
      client.role = 'requester';
      client.name = msg.name || 'User';
      send(ws, { type: 'session-created', code });
      log(`Session ${code} created`);
      break;
    }

    // Technician joins an existing session by code
    case 'join-session': {
      const code = (msg.code || '').toUpperCase().trim();
      const session = sessions.get(code);
      if (!session) {
        send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
        return;
      }
      if (session.technician) {
        send(ws, { type: 'error', message: 'A technician is already connected to this session.' });
        return;
      }
      session.technician = ws;
      client.sessionCode = code;
      client.role = 'technician';
      client.name = msg.name || 'Technician';

      // Ask the requester to approve
      send(session.requester, {
        type: 'connection-request',
        technicianId: client.id,
        name: client.name,
      });
      send(ws, { type: 'waiting-approval' });
      log(`Technician "${client.name}" requesting to join session ${code}`);
      break;
    }

    // Requester approves the technician's connection
    case 'approve': {
      const session = sessions.get(client.sessionCode);
      if (session && session.technician) {
        send(session.technician, { type: 'connection-approved' });
        log(`Session ${client.sessionCode} approved`);
      }
      break;
    }

    // Requester denies the technician's connection
    case 'deny': {
      const session = sessions.get(client.sessionCode);
      if (session && session.technician) {
        send(session.technician, { type: 'connection-denied' });
        const techClient = clients.get(session.technician);
        if (techClient) {
          techClient.sessionCode = null;
          techClient.role = null;
        }
        session.technician = null;
        log(`Session ${client.sessionCode} denied`);
      }
      break;
    }

    // Relay WebRTC signaling data (SDP offers/answers, ICE candidates)
    case 'signal': {
      const session = sessions.get(client.sessionCode);
      if (session) {
        const target = client.role === 'requester'
          ? session.technician
          : session.requester;
        send(target, { type: 'signal', data: msg.data });
      }
      break;
    }

    // Either party ends the session
    case 'end-session': {
      endSession(ws, 'Session ended by user');
      break;
    }

    default:
      send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
  }
}

// ── Session teardown ──────────────────────────────────────────────────────────

function endSession(ws, reason) {
  const client = clients.get(ws);
  if (!client || !client.sessionCode) return;

  const session = sessions.get(client.sessionCode);
  if (!session) return;

  const other = client.role === 'requester'
    ? session.technician
    : session.requester;

  send(other, { type: 'session-ended', reason });

  // Clean up both clients' state
  const otherClient = other ? clients.get(other) : null;
  if (otherClient) {
    otherClient.sessionCode = null;
    otherClient.role = null;
  }

  log(`Session ${client.sessionCode} ended: ${reason}`);
  sessions.delete(client.sessionCode);
  client.sessionCode = null;
  client.role = null;
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

function start(port = 3456) {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    const id = generateId();
    clients.set(ws, { id, sessionCode: null, role: null, name: null });
    send(ws, { type: 'connected', id });

    ws.on('message', (data) => handleMessage(ws, data.toString()));

    ws.on('close', () => {
      endSession(ws, 'Peer disconnected');
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      log(`WebSocket error: ${err.message}`);
    });
  });

  log(`Blackstar signaling server listening on port ${port}`);

  // Expire stale sessions every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions) {
      if (now - session.created.getTime() > 30 * 60 * 1000) {
        send(session.requester,   { type: 'session-ended', reason: 'Session expired' });
        send(session.technician,  { type: 'session-ended', reason: 'Session expired' });
        sessions.delete(code);
        log(`Session ${code} expired`);
      }
    }
  }, 5 * 60 * 1000);

  return wss;
}

// Run standalone when executed directly
if (require.main === module) {
  const port = parseInt(process.argv[2], 10) || 3456;
  start(port);
}

module.exports = { start };
