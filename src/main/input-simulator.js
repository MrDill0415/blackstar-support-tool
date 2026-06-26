/**
 * Blackstar Support Tool - Windows Input Simulator
 *
 * Uses koffi (FFI) to call user32.dll functions for mouse and keyboard
 * simulation.  Falls back gracefully when koffi is unavailable.
 *
 * Local-input detection: when the requester moves their mouse or presses a
 * key, remote control pauses for LOCAL_OVERRIDE_MS so the local user always
 * has priority.
 */

const { screen } = require('electron');

// How long (ms) local input overrides remote control
const LOCAL_OVERRIDE_MS = 500;

// ── Virtual-key code map (DOM KeyboardEvent.code → Win32 VK) ──────────────

const CODE_TO_VK = {
  KeyA: 0x41, KeyB: 0x42, KeyC: 0x43, KeyD: 0x44, KeyE: 0x45,
  KeyF: 0x46, KeyG: 0x47, KeyH: 0x48, KeyI: 0x49, KeyJ: 0x4A,
  KeyK: 0x4B, KeyL: 0x4C, KeyM: 0x4D, KeyN: 0x4E, KeyO: 0x4F,
  KeyP: 0x50, KeyQ: 0x51, KeyR: 0x52, KeyS: 0x53, KeyT: 0x54,
  KeyU: 0x55, KeyV: 0x56, KeyW: 0x57, KeyX: 0x58, KeyY: 0x59,
  KeyZ: 0x5A,
  Digit0: 0x30, Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34,
  Digit5: 0x35, Digit6: 0x36, Digit7: 0x37, Digit8: 0x38, Digit9: 0x39,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
  F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
  Backquote: 0xC0, Minus: 0xBD, Equal: 0xBB,
  BracketLeft: 0xDB, BracketRight: 0xDD, Backslash: 0xDC,
  Semicolon: 0xBA, Quote: 0xDE,
  Comma: 0xBC, Period: 0xBE, Slash: 0xBF,
  Space: 0x20, Enter: 0x0D, NumpadEnter: 0x0D, Tab: 0x09,
  Backspace: 0x08, Delete: 0x2E, Escape: 0x1B, Insert: 0x2D,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
  ShiftLeft: 0xA0, ShiftRight: 0xA1,
  ControlLeft: 0xA2, ControlRight: 0xA3,
  AltLeft: 0xA4, AltRight: 0xA5,
  MetaLeft: 0x5B, MetaRight: 0x5C,
  CapsLock: 0x14, NumLock: 0x90, ScrollLock: 0x91,
  PrintScreen: 0x2C, Pause: 0x13, ContextMenu: 0x5D,
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63,
  Numpad4: 0x64, Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67,
  Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6A, NumpadAdd: 0x6B, NumpadSubtract: 0x6D,
  NumpadDecimal: 0x6E, NumpadDivide: 0x6F,
};

// Keys that require the KEYEVENTF_EXTENDEDKEY flag
const EXTENDED_KEYS = new Set([
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'NumpadEnter', 'NumpadDivide',
  'ControlRight', 'AltRight', 'MetaLeft', 'MetaRight',
  'PrintScreen', 'ContextMenu',
]);

// mouse_event flags
const MOUSEEVENTF_LEFTDOWN   = 0x0002;
const MOUSEEVENTF_LEFTUP     = 0x0004;
const MOUSEEVENTF_RIGHTDOWN  = 0x0008;
const MOUSEEVENTF_RIGHTUP    = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP   = 0x0040;
const MOUSEEVENTF_WHEEL      = 0x0800;
const MOUSEEVENTF_HWHEEL     = 0x1000;

// keybd_event flags
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP       = 0x0002;

// ── InputSimulator class ──────────────────────────────────────────────────────

class InputSimulator {
  constructor() {
    this.available = false;

    // Local-override state
    this.lastRemoteX = -1;
    this.lastRemoteY = -1;
    this.localOverrideUntil = 0;
    this._pollTimer = null;

    try {
      const koffi = require('koffi');
      const user32 = koffi.load('user32.dll');

      this._SetCursorPos   = user32.func('bool SetCursorPos(int X, int Y)');
      this._mouse_event    = user32.func('void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr_t dwExtraInfo)');
      this._keybd_event    = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)');
      this._MapVirtualKeyA = user32.func('uint32 MapVirtualKeyA(uint32 uCode, uint32 uMapType)');

      this.available = true;
      console.log('Input simulator: koffi loaded successfully');
    } catch (err) {
      console.warn('Input simulator unavailable (koffi not loaded):', err.message);
    }
  }

  /** Start polling for local mouse movement so we can override remote. */
  startLocalDetection() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._detectLocalInput(), 50);
  }

  stopLocalDetection() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** Returns true when the local user is actively using their input. */
  get isLocalOverride() {
    return Date.now() < this.localOverrideUntil;
  }

  // ── Core event dispatcher ────────────────────────────────────────────────

  /**
   * Process a single remote-input event.
   * Returns { executed: bool, localOverride: bool }.
   */
  processEvent(evt) {
    if (!this.available) return { executed: false, reason: 'unavailable' };
    if (this.isLocalOverride && evt.type === 'mouse-move') {
      return { executed: false, localOverride: true };
    }

    switch (evt.type) {
      case 'mouse-move':  return this._mouseMove(evt.x, evt.y);
      case 'mouse-down':  return this._mouseButton(evt.button, true);
      case 'mouse-up':    return this._mouseButton(evt.button, false);
      case 'mouse-scroll': return this._mouseScroll(evt.deltaY, evt.deltaX);
      case 'key-down':    return this._keyAction(evt.code, false);
      case 'key-up':      return this._keyAction(evt.code, true);
      default: return { executed: false, reason: 'unknown event' };
    }
  }

  // ── Mouse helpers ─────────────────────────────────────────────────────────

  _mouseMove(normX, normY) {
    const { width, height } = screen.getPrimaryDisplay().size;
    const x = Math.round(normX * width);
    const y = Math.round(normY * height);

    this._SetCursorPos(x, y);
    this.lastRemoteX = x;
    this.lastRemoteY = y;
    return { executed: true };
  }

  _mouseButton(button, down) {
    const flags = {
      0: down ? MOUSEEVENTF_LEFTDOWN   : MOUSEEVENTF_LEFTUP,
      1: down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
      2: down ? MOUSEEVENTF_RIGHTDOWN  : MOUSEEVENTF_RIGHTUP,
    }[button];
    if (flags === undefined) return { executed: false, reason: 'bad button' };

    this._mouse_event(flags, 0, 0, 0, 0);
    return { executed: true };
  }

  _mouseScroll(deltaY = 0, deltaX = 0) {
    if (deltaY) this._mouse_event(MOUSEEVENTF_WHEEL,  0, 0, -deltaY, 0);
    if (deltaX) this._mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, deltaX,  0);
    return { executed: true };
  }

  // ── Keyboard helpers ──────────────────────────────────────────────────────

  _keyAction(code, isUp) {
    const vk = CODE_TO_VK[code];
    if (vk === undefined) return { executed: false, reason: `unmapped key: ${code}` };

    const scan = this._MapVirtualKeyA(vk, 0); // MAPVK_VK_TO_VSC
    let flags = 0;
    if (isUp) flags |= KEYEVENTF_KEYUP;
    if (EXTENDED_KEYS.has(code)) flags |= KEYEVENTF_EXTENDEDKEY;

    this._keybd_event(vk, scan, flags, 0);
    return { executed: true };
  }

  // ── Local-input detection ─────────────────────────────────────────────────

  /**
   * Compare the real cursor position to where we last placed it.  If it
   * moved and we didn't move it, the local user is active.
   */
  _detectLocalInput() {
    if (this.lastRemoteX < 0) return;
    const pos = screen.getCursorScreenPoint();
    const dx = Math.abs(pos.x - this.lastRemoteX);
    const dy = Math.abs(pos.y - this.lastRemoteY);

    // Threshold of 3 px to filter jitter from high-DPI rounding
    if (dx > 3 || dy > 3) {
      this.localOverrideUntil = Date.now() + LOCAL_OVERRIDE_MS;
    }
  }
}

module.exports = InputSimulator;
