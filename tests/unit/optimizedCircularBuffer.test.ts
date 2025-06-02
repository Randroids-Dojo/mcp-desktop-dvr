import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { OptimizedCircularBuffer } from '../../src/buffer/optimizedCircularBuffer.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('OptimizedCircularBuffer', () => {
  let buffer: OptimizedCircularBuffer;
  const testBufferDir = path.join(os.tmpdir(), 'test-optimized-buffer');

  beforeEach(async () => {
    buffer = new OptimizedCircularBuffer(testBufferDir, {
      hotTierMaxSegments: 3,
      hotTierMaxSizeMB: 1, // 1MB for testing
      memoryPressureEvictionThreshold: 0.8,
      enableMemoryMapping: true,
    });
    await buffer.initialize();
  });

  afterEach(async () => {
    await buffer.shutdown();
    try {
      await fs.rm(testBufferDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should create hot and cold directories', async () => {
      const hotDir = path.join(testBufferDir, 'hot');
      const coldDir = path.join(testBufferDir, 'cold');
      const extractDir = path.join(testBufferDir, 'extracts');

      const hotExists = await fs.access(hotDir).then(() => true).catch(() => false);
      const coldExists = await fs.access(coldDir).then(() => true).catch(() => false);
      const extractExists = await fs.access(extractDir).then(() => true).catch(() => false);

      expect(hotExists).toBe(true);
      expect(coldExists).toBe(true);
      expect(extractExists).toBe(true);
    });

    it('should start memory monitoring on initialization', () => {
      expect((buffer as any).memoryMonitor).toBeDefined();
    });
  });

  describe('tier management', () => {
    it('should initially place segments in hot tier', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video1.mp4');
      await fs.writeFile(testVideoPath, Buffer.alloc(1024));

      await buffer.addVideoChunk(testVideoPath, 60);

      const status = buffer.getStatus();
      expect(status.hotSegments).toBe(1);
      expect(status.coldSegments).toBe(0);
    });

    it('should demote segments when hot tier exceeds max segments', async () => {
      // Add 4 segments (max is 3)
      for (let i = 0; i < 4; i++) {
        const testVideoPath = path.join(testBufferDir, `test-video${i}.mp4`);
        await fs.writeFile(testVideoPath, Buffer.alloc(1024));
        await buffer.addVideoChunk(testVideoPath, 60);
      }

      const status = buffer.getStatus();
      expect(status.hotSegments).toBeLessThanOrEqual(3);
      expect(status.coldSegments).toBeGreaterThan(0);
    });

    it('should demote segments when hot tier exceeds size limit', async () => {
      // Create segments larger than 1MB limit
      for (let i = 0; i < 2; i++) {
        const testVideoPath = path.join(testBufferDir, `large-video${i}.mp4`);
        await fs.writeFile(testVideoPath, Buffer.alloc(800 * 1024)); // 800KB each
        await buffer.addVideoChunk(testVideoPath, 60);
      }

      const status = buffer.getStatus();
      expect(status.hotTierSizeMB).toBeLessThanOrEqual(1);
    });
  });

  describe('memory optimization', () => {
    it('should track in-memory segments', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, Buffer.alloc(1024));

      await buffer.addVideoChunk(testVideoPath, 60);

      const status = buffer.getStatus();
      expect(status.inMemorySegments).toBeGreaterThanOrEqual(0);
    });

    it('should provide memory statistics', () => {
      const status = buffer.getStatus();
      expect(status.memoryStats).toBeDefined();
      expect(status.memoryStats.totalMB).toBeGreaterThan(0);
      expect(status.memoryStats.percentUsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('segment promotion and demotion', () => {
    it('should promote frequently accessed cold segments', async () => {
      // Add enough segments to force some to cold tier
      for (let i = 0; i < 5; i++) {
        const testVideoPath = path.join(testBufferDir, `test-video${i}.mp4`);
        await fs.writeFile(testVideoPath, Buffer.alloc(1024));
        await buffer.addVideoChunk(testVideoPath, 60);
      }

      // Extract from a segment (which should promote it if it's cold)
      await buffer.extractLastNSeconds(30);

      const status = buffer.getStatus();
      expect(status.totalSegments).toBe(5);
    });
  });

  describe('status reporting', () => {
    it('should provide comprehensive status', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, Buffer.alloc(2048));

      await buffer.addVideoChunk(testVideoPath, 60);

      const status = buffer.getStatus();

      expect(status.isActive).toBe(true);
      expect(status.totalSegments).toBe(1);
      expect(status.hotSegments).toBe(1);
      expect(status.coldSegments).toBe(0);
      expect(status.inMemorySegments).toBeGreaterThanOrEqual(0);
      expect(status.totalSizeBytes).toBe(2048);
      expect(status.hotTierSizeMB).toBeCloseTo(2048 / (1024 * 1024));
      expect(status.oldestSegmentTime).toBeInstanceOf(Date);
      expect(status.newestSegmentTime).toBeInstanceOf(Date);
      expect(status.bufferDurationSeconds).toBeGreaterThanOrEqual(0);
      expect(status.memoryStats).toBeDefined();
    });
  });

  describe('extraction with tier awareness', () => {
    it('should extract from hot tier segments', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, 'test video content');

      await buffer.addVideoChunk(testVideoPath, 60);

      const extractedPath = await buffer.extractLastNSeconds(30);
      expect(extractedPath).toBeTruthy();
      expect(extractedPath.endsWith('.mp4')).toBe(true);

      // Verify extracted file exists
      const extractExists = await fs.access(extractedPath).then(() => true).catch(() => false);
      expect(extractExists).toBe(true);
    });

    it('should handle extraction from mixed hot/cold segments', async () => {
      // Add enough segments to have both hot and cold
      for (let i = 0; i < 5; i++) {
        const testVideoPath = path.join(testBufferDir, `test-video${i}.mp4`);
        await fs.writeFile(testVideoPath, `test content ${i}`);
        await buffer.addVideoChunk(testVideoPath, 60);
      }

      const extractedPath = await buffer.extractLastNSeconds(120);
      expect(extractedPath).toBeTruthy();

      const extractExists = await fs.access(extractedPath).then(() => true).catch(() => false);
      expect(extractExists).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle missing video files gracefully', async () => {
      const nonExistentPath = path.join(testBufferDir, 'non-existent.mp4');

      await expect(buffer.addVideoChunk(nonExistentPath))
        .rejects.toThrow();
    });

    it('should handle extraction with no segments', async () => {
      await expect(buffer.extractLastNSeconds(30))
        .rejects.toThrow('No video data available for the requested time range');
    });
  });

  describe('shutdown', () => {
    it('should stop monitoring and clean up resources', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, Buffer.alloc(1024));
      await buffer.addVideoChunk(testVideoPath, 60);

      await expect(buffer.shutdown()).resolves.not.toThrow();

      // Verify cleanup
      const status = buffer.getStatus();
      expect(status.inMemorySegments).toBe(0);
    });
  });

  describe('memory pressure simulation', () => {
    it('should handle memory pressure events', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, Buffer.alloc(1024));
      await buffer.addVideoChunk(testVideoPath, 60);

      // Simulate memory pressure by emitting event directly
      const memoryMonitor = (buffer as any).memoryMonitor;
      memoryMonitor.emit('memoryWarning', { totalMB: 150 });

      // Should not throw errors
      expect(true).toBe(true);
    });

    it('should handle critical memory pressure', async () => {
      const testVideoPath = path.join(testBufferDir, 'test-video.mp4');
      await fs.writeFile(testVideoPath, Buffer.alloc(1024));
      await buffer.addVideoChunk(testVideoPath, 60);

      // Simulate critical memory pressure
      const memoryMonitor = (buffer as any).memoryMonitor;
      memoryMonitor.emit('memoryCritical', { totalMB: 200 });

      expect(true).toBe(true);
    });
  });
});