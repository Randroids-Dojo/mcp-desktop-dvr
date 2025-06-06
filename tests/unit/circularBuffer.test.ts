import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock child_process to avoid FFmpeg dependency in tests
jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
}));

// Import after mocks
const { CircularBuffer } = await import('../../src/buffer/circularBuffer.js');
const { exec } = await import('child_process');

describe('CircularBuffer', () => {
  let buffer: CircularBuffer;
  let testBufferDir: string;
  
  // Mock console.error to reduce test noise
  const originalConsoleError = console.error;
  
  beforeAll(() => {
    console.error = jest.fn();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  beforeEach(async () => {
    // Create unique directory for each test
    testBufferDir = path.join(os.tmpdir(), `test-desktop-dvr-buffer-${Math.random().toString(36).substring(7)}`);
    
    // Mock exec to simulate successful FFmpeg operations
    (exec as any).mockImplementation((command: string, callback: Function) => {
      // Create a simple output file for FFmpeg operations
      const outputMatch = command.match(/"([^"]*\.mp4)"/g);
      if (outputMatch) {
        const outputFile = outputMatch[outputMatch.length - 1].replace(/"/g, '');
        fs.writeFile(outputFile, 'test video content').then(() => {
          callback(null, { stdout: '', stderr: '' });
        }).catch(callback);
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
    });

    buffer = new CircularBuffer(testBufferDir);
    await buffer.initialize();
  });

  afterEach(async () => {
    await buffer.cleanup();
    try {
      await fs.rm(testBufferDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create buffer directory on initialize', async () => {
      const newBufferDir = path.join(os.tmpdir(), 'test-new-buffer');
      const newBuffer = new CircularBuffer(newBufferDir);
      
      await newBuffer.initialize();
      
      const dirExists = await fs.access(newBufferDir)
        .then(() => true)
        .catch(() => false);
      
      expect(dirExists).toBe(true);
      
      await newBuffer.cleanup();
      await fs.rm(newBufferDir, { recursive: true, force: true });
    });

    it('should handle multiple initialize calls', async () => {
      // First initialize already done in beforeEach
      await expect(buffer.initialize()).resolves.not.toThrow();
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBeDefined();
    });
  });

  describe('addVideoChunk', () => {
    it('should throw error if not initialized', async () => {
      const uninitializedBuffer = new CircularBuffer(path.join(os.tmpdir(), 'uninit-buffer'));
      
      await expect(uninitializedBuffer.addVideoChunk('/test/video.mp4', 60))
        .rejects.toThrow('Buffer not initialized');
      
      await fs.rm(path.join(os.tmpdir(), 'uninit-buffer'), { recursive: true, force: true }).catch(() => {});
    });

    it('should create new segment when adding first chunk', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test video content');
      
      await buffer.addVideoChunk(testVideoPath, 60);
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBeGreaterThan(0);
      expect(status.bufferDurationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple chunks creating multiple segments', async () => {
      const testVideoPath1 = path.join(testBufferDir, 'test-video1.mp4');
      const testVideoPath2 = path.join(testBufferDir, 'test-video2.mp4');
      await fs.writeFile(testVideoPath1, 'test video content 1');
      await fs.writeFile(testVideoPath2, 'test video content 2');
      
      const initialSegments = buffer.getStatus().totalSegments;
      await buffer.addVideoChunk(testVideoPath1, 30);
      const afterFirst = buffer.getStatus().totalSegments;
      await buffer.addVideoChunk(testVideoPath2, 20);
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBeGreaterThan(afterFirst); // Should increase
      expect(status.totalSegments).toBeGreaterThan(initialSegments); // Should be more than initial
      expect(status.bufferDurationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should create new segment after timeout', async () => {
      // Increase timeout for this test
      
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test video content');
      
      // Add first chunk
      const initialSegments = buffer.getStatus().totalSegments;
      await buffer.addVideoChunk(testVideoPath, 30);
      const afterFirst = buffer.getStatus().totalSegments;
      
      // Wait for segment timeout
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      // Add second chunk - should create new segment
      await buffer.addVideoChunk(testVideoPath, 30);
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBeGreaterThan(afterFirst);
      expect(status.totalSegments).toBeGreaterThan(initialSegments);
    });
  });

  describe('extractLastNSeconds', () => {
    beforeEach(async () => {
      // Create some test video files
      for (let i = 0; i < 3; i++) {
        const videoPath = path.join(testBufferDir, `test-video-${i}.mp4`);
        await fs.writeFile(videoPath, `test video content ${i}`);
        await buffer.addVideoChunk(videoPath, 20);
      }
    });

    it('should extract video for specified duration', async () => {
      const extractPath = await buffer.extractLastNSeconds(30);
      
      expect(extractPath).toContain('.mp4');
      expect(extractPath).toContain('extract_');
      
      const fileExists = await fs.access(extractPath)
        .then(() => true)
        .catch(() => false);
      
      expect(fileExists).toBe(true);
      
      // Cleanup
      await fs.unlink(extractPath).catch(() => {});
    });

    it('should handle extraction with no segments', async () => {
      const emptyBuffer = new CircularBuffer(path.join(os.tmpdir(), 'empty-buffer'));
      await emptyBuffer.initialize();
      
      await expect(emptyBuffer.extractLastNSeconds(10))
        .rejects.toThrow('No video data available for the requested time range');
      
      await emptyBuffer.cleanup();
      await fs.rm(path.join(os.tmpdir(), 'empty-buffer'), { recursive: true, force: true });
    });

    it('should handle extraction duration longer than available', async () => {
      const extractPath = await buffer.extractLastNSeconds(300); // 5 minutes
      
      expect(extractPath).toContain('.mp4');
      
      // Cleanup
      await fs.unlink(extractPath).catch(() => {});
    });
  });

  describe('buffer status', () => {
    it('should provide accurate status', async () => {
      const status = buffer.getStatus();
      
      expect(status).toHaveProperty('totalSegments');
      expect(status).toHaveProperty('bufferDurationSeconds');
      expect(status).toHaveProperty('oldestSegmentTime');
      expect(status).toHaveProperty('newestSegmentTime');
      expect(status).toHaveProperty('totalSizeBytes');
      
      expect(status.totalSegments).toBeGreaterThanOrEqual(0);
      expect(status.totalSizeBytes).toBeGreaterThanOrEqual(0);
    });

    it('should update status after adding chunks', async () => {
      const initialStatus = buffer.getStatus();
      
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test video content');
      await buffer.addVideoChunk(testVideoPath, 60);
      
      const updatedStatus = buffer.getStatus();
      
      expect(updatedStatus.totalSegments).toBeGreaterThan(initialStatus.totalSegments);
      expect(updatedStatus.bufferDurationSeconds).toBeGreaterThanOrEqual(initialStatus.bufferDurationSeconds);
    });
  });

  describe('cleanup', () => {
    it('should handle cleanup operations', async () => {
      await buffer.cleanup();
      
      // Should handle multiple cleanup calls
      await expect(buffer.cleanup()).resolves.not.toThrow();
    });

    it('should remove buffer directory on cleanup', async () => {
      const tempBufferDir = path.join(os.tmpdir(), 'temp-buffer-cleanup');
      const tempBuffer = new CircularBuffer(tempBufferDir);
      
      await tempBuffer.initialize();
      await tempBuffer.cleanup();
      
      const dirExists = await fs.access(tempBufferDir)
        .then(() => true)
        .catch(() => false);
      
      expect(dirExists).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle invalid video paths gracefully', async () => {
      await expect(buffer.addVideoChunk('/nonexistent/video.mp4', 60))
        .rejects.toThrow();
    });

    it('should handle zero duration chunks', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test video content');
      
      await expect(buffer.addVideoChunk(testVideoPath, 0))
        .resolves.not.toThrow();
    });

    it('should handle very long duration chunks', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test video content');
      
      await buffer.addVideoChunk(testVideoPath, 3600); // 1 hour
      
      const status = buffer.getStatus();
      expect(status.bufferDurationSeconds).toBeGreaterThanOrEqual(3600);
    });
  });
});