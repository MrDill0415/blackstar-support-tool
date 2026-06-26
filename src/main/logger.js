/**
 * Blackstar Support Tool - Connection Event Logger
 *
 * Writes timestamped entries to a log file in the user-data directory.
 * Each line is a JSON object for easy parsing.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    this.logPath = path.join(logDir, `session-${date}.log`);
  }

  log(entry) {
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.logPath, line, 'utf-8');
    console.log(`[LOG] ${record.event || 'info'}: ${record.detail || ''}`);
  }
}

module.exports = Logger;
