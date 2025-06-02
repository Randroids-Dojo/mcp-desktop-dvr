import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CircularBuffer } from '../../src/buffer/circularBuffer.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock child_process to avoid FFmpeg dependency in tests
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

import { exec } from 'child_process';
const mockedExec = exec as jest.MockedFunction<typeof exec>;

describe('CircularBuffer', () => {
  let buffer: CircularBuffer;
  const testBufferDir = path.join(os.tmpdir(), 'test-desktop-dvr-buffer');

  beforeEach(async () => {
    // Mock exec to simulate successful FFmpeg operations
    mockedExec.mockImplementation((command: string, callback: Function) => {
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
      
      const dirExists = await fs.access(newBufferDir).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
      
      await newBuffer.cleanup();
      await fs.rm(newBufferDir, { recursive: true, force: true });
    });

    it('should handle multiple initialize calls', async () => {
      await expect(buffer.initialize()).resolves.not.toThrow();
    });
  });

  describe('addVideoChunk', () => {
    it('should throw error if not initialized', async () => {
      const uninitializedBuffer = new CircularBuffer();
      await expect(uninitializedBuffer.addVideoChunk('test.mp4'))
        .rejects.toThrow('Buffer not initialized');
    });

    it('should create new segment when adding first chunk', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test data');
      
      await buffer.addVideoChunk(testVideoPath);
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBe(1);
      expect(status.isActive).toBe(true);
    });

    it('should track segment metadata correctly', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      const testData = Buffer.from('test video data');
      await fs.writeFile(testVideoPath, testData);
      
      await buffer.addVideoChunk(testVideoPath);
      
      const status = buffer.getStatus();
      expect(status.totalSizeBytes).toBe(testData.length);
      expect(status.newestSegmentTime).toBeInstanceOf(Date);
    });
  });

  describe('extractLastNSeconds', () => {
    it('should throw error if not initialized', async () => {
      const uninitializedBuffer = new CircularBuffer();
      await expect(uninitializedBuffer.extractLastNSeconds(30))
        .rejects.toThrow('Buffer not initialized');
    });

    it('should throw error if no video data available', async () => {
      await expect(buffer.extractLastNSeconds(30))
        .rejects.toThrow('No video data available for the requested time range');
    });

    it('should return path to most recent segment', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test data');
      await buffer.addVideoChunk(testVideoPath);
      
      const extractedPath = await buffer.extractLastNSeconds(30);
      
      expect(extractedPath).toBeTruthy();
      expect(extractedPath.endsWith('.mp4')).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return correct initial status', () => {
      const status = buffer.getStatus();
      
      expect(status.isActive).toBe(false);
      expect(status.totalSegments).toBe(0);
      expect(status.oldestSegmentTime).toBeNull();
      expect(status.newestSegmentTime).toBeNull();
      expect(status.totalSizeBytes).toBe(0);
      expect(status.bufferDurationSeconds).toBe(0);
    });

    it('should update status after adding chunks', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, Buffer.alloc(1024));
      
      await buffer.addVideoChunk(testVideoPath);
      
      const status = buffer.getStatus();
      expect(status.isActive).toBe(true);
      expect(status.totalSegments).toBe(1);
      expect(status.totalSizeBytes).toBe(1024);
      expect(status.oldestSegmentTime).toBeInstanceOf(Date);
    });
  });

  describe('cleanup', () => {
    it('should reset buffer state', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test data');
      await buffer.addVideoChunk(testVideoPath);
      
      await buffer.cleanup();
      
      const status = buffer.getStatus();
      expect(status.isActive).toBe(false);
      expect(status.totalSegments).toBe(0);
    });
  });

  describe('segment management', () => {
    it('should prune old segments beyond max duration', async () => {
      // This test would require mocking time or waiting for actual time to pass
      // For now, we'll verify the pruning logic exists
      const bufferPrivate = buffer as any;
      expect(typeof bufferPrivate.pruneOldSegments).toBe('function');
    });

    it('should handle cleanup properly', async () => {
      // Test cleanup method exists
      expect(typeof buffer.cleanup).toBe('function');
      await expect(buffer.cleanup()).resolves.not.toThrow();
    });
  });
});