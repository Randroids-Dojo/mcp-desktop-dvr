import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { WindowInfo } from '../../src/capture/windowDetector.js';

export class TestHelpers {
  /**
   * Create a temporary directory for test files
   */
  static async createTempDir(prefix: string = 'test'): Promise<string> {
    const tempDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Clean up a temporary directory
   */
  static async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  }

  /**
   * Create a mock video file for testing
   */
  static async createMockVideoFile(filePath: string, sizeBytes: number = 1024): Promise<void> {
    await fs.writeFile(filePath, Buffer.alloc(sizeBytes, 'test video data'));
  }

  /**
   * Create multiple mock video files
   */
  static async createMockVideoFiles(directory: string, count: number, sizeBytes: number = 1024): Promise<string[]> {
    const files: string[] = [];
    for (let i = 0; i < count; i++) {
      const filePath = path.join(directory, `test-video-${i}.mp4`);
      await this.createMockVideoFile(filePath, sizeBytes);
      files.push(filePath);
    }
    return files;
  }

  /**
   * Create a mock WindowInfo object
   */
  static createMockWindow(overrides: Partial<WindowInfo> = {}): WindowInfo {
    return {
      windowId: 123,
      bundleId: 'com.test.app',
      title: 'Test Window',
      x: 100,
      y: 200,
      width: 800,
      height: 600,
      isVisible: true,
      processName: 'TestApp',
      ...overrides,
    };
  }

  /**
   * Create multiple mock windows
   */
  static createMockWindows(count: number, bundleId: string = 'com.test.app'): WindowInfo[] {
    const windows: WindowInfo[] = [];
    for (let i = 0; i < count; i++) {
      windows.push(this.createMockWindow({
        windowId: 100 + i,
        bundleId,
        title: `Test Window ${i + 1}`,
        x: 100 + (i * 50),
        y: 200 + (i * 30),
        width: 800 + (i * 100),
        height: 600 + (i * 50),
      }));
    }
    return windows;
  }

  /**
   * Wait for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for a condition to be true
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await this.wait(interval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  /**
   * Mock process.memoryUsage for memory tests
   */
  static mockMemoryUsage(heapUsedMB: number, externalMB: number = 0): NodeJS.MemoryUsage {
    return {
      heapUsed: heapUsedMB * 1024 * 1024,
      heapTotal: (heapUsedMB + 50) * 1024 * 1024,
      external: externalMB * 1024 * 1024,
      rss: (heapUsedMB + externalMB + 100) * 1024 * 1024,
      arrayBuffers: 10 * 1024 * 1024,
    };
  }

  /**
   * Generate a unique test ID
   */
  static generateTestId(): string {
    return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if a file exists
   */
  static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file size in bytes
   */
  static async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Create a performance timer
   */
  static createTimer(): { start: () => void; stop: () => number } {
    let startTime: number;
    
    return {
      start: () => {
        startTime = Date.now();
      },
      stop: () => {
        return Date.now() - startTime;
      },
    };
  }

  /**
   * Measure the execution time of an async function
   */
  static async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const timer = this.createTimer();
    timer.start();
    const result = await fn();
    const duration = timer.stop();
    return { result, duration };
  }

  /**
   * Create a mock aperture recorder
   */
  static createMockRecorder() {
    return {
      startRecording: jest.fn().mockResolvedValue(undefined),
      stopRecording: jest.fn().mockResolvedValue('/mock/output.mp4'),
    };
  }

  /**
   * Create mock file system operations
   */
  static createMockFs() {
    return {
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.from('mock data')),
      copyFile: jest.fn().mockResolvedValue(undefined),
      unlink: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
      stat: jest.fn().mockResolvedValue({ size: 1024 }),
      access: jest.fn().mockResolvedValue(undefined),
      rm: jest.fn().mockResolvedValue(undefined),
      readdir: jest.fn().mockResolvedValue([]),
    };
  }

  /**
   * Create a mock exec function for child_process
   */
  static createMockExec(output: string = 'mock output', shouldFail: boolean = false) {
    return jest.fn().mockImplementation((command: string, callback: any) => {
      setTimeout(() => {
        if (shouldFail) {
          callback(new Error('Command failed'), null);
        } else {
          callback(null, { stdout: output, stderr: '' });
        }
      }, 0);
      
      return shouldFail 
        ? Promise.reject(new Error('Command failed'))
        : Promise.resolve({ stdout: output, stderr: '' });
    });
  }

  /**
   * Assert that a value is within a range
   */
  static assertInRange(value: number, min: number, max: number, message?: string): void {
    if (value < min || value > max) {
      throw new Error(message || `Expected ${value} to be between ${min} and ${max}`);
    }
  }

  /**
   * Assert that an operation completes within a time limit
   */
  static async assertWithinTime<T>(
    operation: () => Promise<T>,
    maxTimeMs: number,
    message?: string
  ): Promise<T> {
    const { result, duration } = await this.measureTime(operation);
    
    if (duration > maxTimeMs) {
      throw new Error(
        message || `Operation took ${duration}ms, expected under ${maxTimeMs}ms`
      );
    }
    
    return result;
  }

  /**
   * Create a mock event emitter for testing
   */
  static createMockEventEmitter() {
    const events: { [event: string]: Function[] } = {};
    
    return {
      on: jest.fn((event: string, listener: Function) => {
        if (!events[event]) events[event] = [];
        events[event].push(listener);
      }),
      emit: jest.fn((event: string, ...args: any[]) => {
        if (events[event]) {
          events[event].forEach(listener => listener(...args));
        }
      }),
      removeListener: jest.fn((event: string, listener: Function) => {
        if (events[event]) {
          const index = events[event].indexOf(listener);
          if (index > -1) events[event].splice(index, 1);
        }
      }),
    };
  }
}

/**
 * Test data constants
 */
export const TEST_CONSTANTS = {
  COMMON_BUNDLE_IDS: {
    godot: 'org.godotengine.godot',
    vscode: 'com.microsoft.VSCode',
    chrome: 'com.google.Chrome',
    safari: 'com.apple.Safari',
    terminal: 'com.apple.Terminal',
  },
  
  DEFAULT_WINDOW: {
    x: 100,
    y: 200,
    width: 800,
    height: 600,
  },
  
  PERFORMANCE_THRESHOLDS: {
    MEMORY_CHECK_MS: 10,
    STATUS_CHECK_MS: 5,
    CAPTURE_START_MS: 1000,
    EXTRACTION_MS: 2000,
    TIER_MANAGEMENT_MS: 100,
  },
  
  MEMORY_LIMITS: {
    WARNING_MB: 1000,
    CRITICAL_MB: 1300,
    MAX_MB: 1500,
  },
} as const;