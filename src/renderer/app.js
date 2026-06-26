/**
 * Blackstar Support Tool - Renderer Application
 *
 * Manages the full lifecycle: UI state, WebSocket signaling,
 * WebRTC peer connections, screen capture, data-channel input
 * forwarding, and local-input priority detection.
 */

// ── ICE servers for NAT traversal ─────────────────────────────────────────────

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ── Application ───────────────────────────────────────────────────────────────

class BlackstarApp {
  constructor() {
    this.ws            = null;
    this.pc            = null;   // RTCPeerConnection
    this.dataChannel   = null;
    this.localStream   = null;   // screen-capture stream (requester)
    this.role          = null;   // 'requester' | 'technician'
    this.sessionCode   = null;
    this.technicianId  = null;
    this.technicianName = null;
    this.sessionActive = false;
    this.timerInterval = null;
    this.sessionStart  = null;
    this.serverUrl     = localStorage.getItem('serverUrl') || 'ws://localhost:3456';

    this._bindUI();
  }

  // ── UI binding ────────────────────────────────────────────────────────────

  _bindUI() {
    // Home
    $('btn-request').onclick   = () => this._startRequestFlow();
    $('btn-provide').onclick   = () => this._showScreen('screen-provide');
    $('btn-settings').onclick  = () => this._openSettings();

    // Request Support
    $('btn-copy-code').onclick     = () => this._copyCode();
    $('btn-cancel-request').onclick = () => this._cancelSession();

    // Provide Support
    $('btn-connect').onclick = () => this._startProvideFlow();

    // Approval modal
    $('btn-approve').onclick = () => this._approveConnection();
    $('btn-deny').onclick    = () => this._denyConnection();

    // Active sessions
    $('btn-end-requester').onclick   = () => this._endSession();
    $('btn-end-technician').onclick  = () => this._endSession();
    $('btn-fullscreen').onclick      = () => this._toggleFullscreen();

    // Settings
    $('btn-save-settings').onclick  = () => this._saveSettings();
    $('btn-close-settings').onclick = () => $('modal-settings').classList.add('hidden');
    $('btn-toggle-server').onclick  = () => this._toggleEmbeddedServer();

    // Close settings on backdrop click
    document.querySelectorAll('[data-close-settings]').forEach((el) => {
      el.onclick = () => $('modal-settings').classList.add('hidden');
    });

    // Back buttons return to home
    document.querySelectorAll('[data-back]').forEach((btn) => {
      btn.onclick = () => this._cancelSession();
    });

    // Auto-format session code input with dash
    $('tech-code').addEventListener('input', (e) => {
      let v = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4, 8);
      e.target.value = v;
    });
  }

  // ── Screen management ─────────────────────────────────────────────────────

  _showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  // ── Toast notifications ───────────────────────────────────────────────────

  _toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    $('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  _openSettings() {
    $('server-url').value = this.serverUrl;
    $('modal-settings').classList.remove('hidden');
  }

  _saveSettings() {
    const url = $('server-url').value.trim();
    if (url) {
      this.serverUrl = url;
      localStorage.setItem('serverUrl', url);
      this._toast('Settings saved', 'success');
    }
    $('modal-settings').classList.add('hidden');
  }

  async _toggleEmbeddedServer() {
    const btn = $('btn-toggle-server');
    const dot = $('server-status');

    if (dot.classList.contains('online')) {
      await window.blackstar.stopEmbeddedServer();
      btn.textContent = 'Start Server';
      dot.classList.remove('online');
      dot.classList.add('offline');
      this._toast('Embedded server stopped');
    } else {
      btn.textContent = 'Starting…';
      btn.disabled = true;
      try {
        const resp = await window.blackstar.startEmbeddedServer(3456);
        if (resp && resp.running) {
          btn.textContent = 'Stop Server';
          dot.classList.remove('offline');
          dot.classList.add('online');
          this._toast('Embedded server running on port 3456', 'success');
        } else {
          throw new Error(resp?.error || 'Unknown error');
        }
      } catch (err) {
        this._toast('Failed to start server: ' + err.message, 'error');
        btn.textContent = 'Start Server';
      }
      btn.disabled = false;
    }
  }

  // ── Request Support flow ──────────────────────────────────────────────────

  _startRequestFlow() {
    this.role = 'requester';
    this._showScreen('screen-request');
    this._setRequestStatus('spinner', 'Connecting to server…');
    this._connectWebSocket(() => {
      this._send({ type: 'create-session' });
    });
  }

  // ── Provide Support flow ──────────────────────────────────────────────────

  _startProvideFlow() {
    const name = $('tech-name').value.trim();
    const code = $('tech-code').value.trim().toUpperCase();
    if (!name) { this._toast('Please enter your name', 'error'); return; }
    if (!code || code.length < 9) { this._toast('Enter a valid session code (XXXX-XXXX)', 'error'); return; }

    this.role = 'technician';
    this.technicianName = name;
    this._setProvideStatus('spinner', 'Connecting…');
    $('btn-connect').disabled = true;

    this._connectWebSocket(() => {
      this._send({ type: 'join-session', code, name });
    });
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  _connectWebSocket(onOpen) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      onOpen();
      return;
    }

    try {
      this.ws = new WebSocket(this.serverUrl);
    } catch (err) {
      this._toast('Invalid server URL', 'error');
      return;
    }

    this.ws.onopen = () => {
      this._log('websocket-open', `Connected to ${this.serverUrl}`);
      onOpen();
    };

    this.ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      this._handleSignalingMessage(msg);
    };

    this.ws.onclose = () => {
      this._log('websocket-close', 'Disconnected from server');
      if (this.sessionActive) {
        this._endSession('Server connection lost');
      }
    };

    this.ws.onerror = () => {
      this._toast('Cannot reach signaling server', 'error');
      if (this.role === 'requester') {
        this._setRequestStatus('error', 'Connection failed. Check server settings.');
      } else {
        this._setProvideStatus('error', 'Connection failed.');
        $('btn-connect').disabled = false;
      }
    };
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // ── Signaling message handler ─────────────────────────────────────────────

  _handleSignalingMessage(msg) {
    switch (msg.type) {

      case 'connected':
        break;

      // Requester receives their session code
      case 'session-created':
        this.sessionCode = msg.code;
        $('session-code').textContent = msg.code;
        this._setRequestStatus('spinner', 'Waiting for technician…');
        this._log('session-created', msg.code);
        break;

      // Requester receives a technician's connection request
      case 'connection-request':
        this.technicianId   = msg.technicianId;
        this.technicianName = msg.name;
        $('approval-name').textContent = msg.name;
        $('modal-approval').classList.remove('hidden');
        this._log('connection-request', `From: ${msg.name}`);
        break;

      // Technician is told to wait for approval
      case 'waiting-approval':
        this._setProvideStatus('spinner', 'Waiting for user approval…');
        break;

      // Technician's request was approved – start WebRTC
      case 'connection-approved':
        this._setProvideStatus('success', 'Approved! Starting session…');
        this._log('connection-approved', '');
        // Technician creates peer connection and waits for the offer
        this._setupPeerConnection();
        break;

      // Technician's request was denied
      case 'connection-denied':
        this._setProvideStatus('error', 'Connection was denied by the user.');
        $('btn-connect').disabled = false;
        this._toast('Connection denied', 'error');
        this._log('connection-denied', '');
        break;

      // WebRTC signaling relay
      case 'signal':
        this._handleRTCSignal(msg.data);
        break;

      // Session ended by the other party or server
      case 'session-ended':
        this._endSession(msg.reason);
        break;

      case 'error':
        this._toast(msg.message, 'error');
        if (this.role === 'requester') {
          this._setRequestStatus('error', msg.message);
        } else {
          this._setProvideStatus('error', msg.message);
          $('btn-connect').disabled = false;
        }
        break;
    }
  }

  // ── Approval ──────────────────────────────────────────────────────────────

  async _approveConnection() {
    $('modal-approval').classList.add('hidden');
    this._send({ type: 'approve' });
    this._log('connection-approved-by-user', this.technicianName);

    // Set up WebRTC on the requester side and start screen capture
    this._setupPeerConnection();

    try {
      this.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', frameRate: { ideal: 30, max: 60 } },
        audio: false,
      });

      // Add screen tracks to peer connection
      this.localStream.getTracks().forEach((track) => {
        this.pc.addTrack(track, this.localStream);
      });

      // Create data channel for remote input (requester creates, technician receives)
      this.dataChannel = this.pc.createDataChannel('input', { ordered: true });
      this._setupDataChannelHandlers(this.dataChannel);

      // Create and send offer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this._send({ type: 'signal', data: { sdp: this.pc.localDescription } });

      this._log('webrtc-offer-sent', '');
    } catch (err) {
      this._toast('Screen capture failed: ' + err.message, 'error');
      this._log('screen-capture-error', err.message);
      this._endSession('Screen capture failed');
    }
  }

  _denyConnection() {
    $('modal-approval').classList.add('hidden');
    this._send({ type: 'deny' });
    this._log('connection-denied-by-user', this.technicianName);
    this._toast('Connection denied', 'info');
  }

  // ── WebRTC ────────────────────────────────────────────────────────────────

  _setupPeerConnection() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this._send({ type: 'signal', data: { ice: evt.candidate } });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      this._log('ice-state', state);
      if (state === 'connected' || state === 'completed') {
        this._onSessionStarted();
      } else if (state === 'disconnected' || state === 'failed') {
        this._endSession('Connection lost');
      }
    };

    // Technician receives the video track here
    if (this.role === 'technician') {
      this.pc.ontrack = (evt) => {
        const video = $('remote-video');
        video.srcObject = evt.streams[0];
        $('viewer-overlay').classList.add('hidden');
        this._log('video-track-received', '');
      };

      // Technician receives the data channel
      this.pc.ondatachannel = (evt) => {
        this.dataChannel = evt.channel;
        this._setupDataChannelHandlers(this.dataChannel);
      };
    }
  }

  async _handleRTCSignal(data) {
    if (!this.pc) return;

    try {
      if (data.sdp) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

        // If we received an offer, create and send an answer
        if (data.sdp.type === 'offer') {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this._send({ type: 'signal', data: { sdp: this.pc.localDescription } });
          this._log('webrtc-answer-sent', '');
        }
      }

      if (data.ice) {
        await this.pc.addIceCandidate(new RTCIceCandidate(data.ice));
      }
    } catch (err) {
      console.error('RTC signal error:', err);
    }
  }

  // ── Data channel ──────────────────────────────────────────────────────────

  _setupDataChannelHandlers(channel) {
    channel.onopen = () => {
      this._log('data-channel-open', '');
      if (this.role === 'technician') {
        this._startInputCapture();
      }
      if (this.role === 'requester') {
        window.blackstar.startLocalDetection();
      }
    };

    channel.onclose = () => {
      this._log('data-channel-close', '');
      if (this.role === 'technician') {
        this._stopInputCapture();
      }
    };

    channel.onmessage = (evt) => {
      if (this.role === 'requester') {
        const inputEvt = JSON.parse(evt.data);
        window.blackstar.simulateInput(inputEvt);
      }
    };
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  _onSessionStarted() {
    if (this.sessionActive) return;
    this.sessionActive = true;
    this.sessionStart  = Date.now();
    document.body.classList.add('session-active');

    // Show the session badge in the header
    $('session-badge').classList.remove('hidden');

    if (this.role === 'requester') {
      $('req-tech-name').textContent = this.technicianName || 'Technician';
      this._showScreen('screen-session-requester');
      this._startTimer('req-timer');
    } else {
      $('tech-remote-name').textContent = `Connected to session`;
      $('viewer-overlay').classList.remove('hidden');
      this._showScreen('screen-session-technician');
      this._startTimer('tech-timer');
    }

    this._log('session-started', `Role: ${this.role}`);
    this._toast('Session started', 'success');
  }

  _endSession(reason) {
    if (!this.sessionActive && !this.ws) {
      this._showScreen('screen-home');
      return;
    }

    // Tell the server
    this._send({ type: 'end-session' });

    // Tear down WebRTC
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    // Stop input capture / detection
    if (this.role === 'technician') this._stopInputCapture();
    if (this.role === 'requester')  window.blackstar.stopLocalDetection();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Reset UI
    this.sessionActive = false;
    document.body.classList.remove('session-active');
    $('session-badge').classList.add('hidden');
    this._stopTimer();
    $('btn-connect').disabled = false;
    $('remote-video').srcObject = null;

    this._log('session-ended', reason || 'User ended session');
    if (reason) this._toast(reason, 'info');

    this.role = null;
    this._showScreen('screen-home');
  }

  _cancelSession() {
    this._endSession();
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  _startTimer(elementId) {
    this._stopTimer();
    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.sessionStart;
      const h = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
      $(elementId).textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  _stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // ── Input capture (technician side) ───────────────────────────────────────
  // Captures mouse and keyboard events on the remote-video element and sends
  // them over the data channel to the requester for simulation.

  _startInputCapture() {
    const video = $('remote-video');
    this._inputHandlers = {};

    // Mouse move – normalized to 0..1
    this._inputHandlers.mousemove = (e) => {
      const rect = video.getBoundingClientRect();
      // Only send if the mouse is over the video content
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        this._sendInput({ type: 'mouse-move', x, y });
      }
    };

    // Mouse buttons
    this._inputHandlers.mousedown = (e) => {
      e.preventDefault();
      this._sendInput({ type: 'mouse-down', button: e.button });
    };
    this._inputHandlers.mouseup = (e) => {
      e.preventDefault();
      this._sendInput({ type: 'mouse-up', button: e.button });
    };

    // Context menu suppression
    this._inputHandlers.contextmenu = (e) => e.preventDefault();

    // Scroll
    this._inputHandlers.wheel = (e) => {
      e.preventDefault();
      this._sendInput({ type: 'mouse-scroll', deltaY: e.deltaY, deltaX: e.deltaX });
    };

    // Keyboard – captured on document while session is active
    this._inputHandlers.keydown = (e) => {
      if (!this.sessionActive) return;
      e.preventDefault();
      this._sendInput({ type: 'key-down', code: e.code, key: e.key });
    };
    this._inputHandlers.keyup = (e) => {
      if (!this.sessionActive) return;
      e.preventDefault();
      this._sendInput({ type: 'key-up', code: e.code, key: e.key });
    };

    // Attach listeners
    video.addEventListener('mousemove',   this._inputHandlers.mousemove);
    video.addEventListener('mousedown',   this._inputHandlers.mousedown);
    video.addEventListener('mouseup',     this._inputHandlers.mouseup);
    video.addEventListener('contextmenu', this._inputHandlers.contextmenu);
    video.addEventListener('wheel',       this._inputHandlers.wheel, { passive: false });
    document.addEventListener('keydown',  this._inputHandlers.keydown);
    document.addEventListener('keyup',    this._inputHandlers.keyup);
  }

  _stopInputCapture() {
    if (!this._inputHandlers) return;
    const video = $('remote-video');
    video.removeEventListener('mousemove',   this._inputHandlers.mousemove);
    video.removeEventListener('mousedown',   this._inputHandlers.mousedown);
    video.removeEventListener('mouseup',     this._inputHandlers.mouseup);
    video.removeEventListener('contextmenu', this._inputHandlers.contextmenu);
    video.removeEventListener('wheel',       this._inputHandlers.wheel);
    document.removeEventListener('keydown',  this._inputHandlers.keydown);
    document.removeEventListener('keyup',    this._inputHandlers.keyup);
    this._inputHandlers = null;
  }

  _sendInput(evt) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(evt));
    }
  }

  // ── Fullscreen toggle ────────────────────────────────────────────────────

  _toggleFullscreen() {
    if (!document.fullscreenElement) {
      $('screen-session-technician').requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  // ── Status helpers ────────────────────────────────────────────────────────

  _setRequestStatus(type, text) {
    const el = $('request-status');
    el.className = 'status-line' + (type === 'error' ? ' error' : '');
    el.innerHTML = (type === 'spinner' ? '<span class="spinner"></span>' : '') +
                   `<span>${text}</span>`;
  }

  _setProvideStatus(type, text) {
    const el = $('provide-status');
    el.classList.remove('hidden', 'error', 'success');
    el.className = 'status-line' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    el.innerHTML = (type === 'spinner' ? '<span class="spinner"></span>' : '') +
                   `<span>${text}</span>`;
  }

  _copyCode() {
    const code = $('session-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      this._toast('Code copied to clipboard', 'success');
    });
  }

  // ── Logging bridge ────────────────────────────────────────────────────────

  _log(event, detail) {
    console.log(`[${event}] ${detail}`);
    window.blackstar.logEvent({ event, detail, role: this.role });
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  window.app = new BlackstarApp();
});
