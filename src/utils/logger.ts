import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const logDir = join(homedir(), '.mcp-desktop-dvr');
const logPath = join(logDir, 'debug.log');

// Ensure log directory exists
try {
  mkdirSync(logDir, { recursive: true });
} catch {
  // Ignore if already exists
}

export function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}\n`;
  try {
    appendFileSync(logPath, logMessage);
  } catch {
    // Ignore errors
  }
}