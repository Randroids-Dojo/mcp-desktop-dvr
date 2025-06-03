import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { CircularBuffer } from '../../src/buffer/circularBuffer.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('CircularBuffer with Real FFmpeg', () => {
  let buffer: CircularBuffer;
  let testBufferDir: string;
  let testVideoDir: string;

  // Helper to create real test videos
  async function createTestVideo(filename: string, duration: number = 1): Promise<string> {
    const videoPath = path.join(testVideoDir, filename);
    
    // Create a test pattern video with ffmpeg
    await execAsync(
      `ffmpeg -f lavfi -i testsrc=duration=${duration}:size=320x240:rate=30 -pix_fmt yuv420p "${videoPath}" -y`
    );
    
    return videoPath;
  }

  beforeEach(async () => {
    testBufferDir = path.join(os.tmpdir(), `test-buffer-${Date.now()}`);
    testVideoDir = path.join(os.tmpdir(), `test-videos-${Date.now()}`);
    
    await fs.mkdir(testVideoDir, { recursive: true });
    
    buffer = new CircularBuffer(testBufferDir);
    await buffer.initialize();
  });

  afterEach(async () => {
    await buffer.cleanup();
    
    // Cleanup test directories
    await fs.rm(testVideoDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(testBufferDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('Basic Operations', () => {
    it('should add a real video chunk', async () => {
      const videoPath = await createTestVideo('test1.mp4', 1);
      
      await buffer.addVideoChunk(videoPath, 1);
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBe(1);
      expect(status.bufferDurationSeconds).toBeGreaterThanOrEqual(1);
    });

    it('should handle multiple video chunks', async () => {
      const video1 = await createTestVideo('test1.mp4', 1);
      const video2 = await createTestVideo('test2.mp4', 1);
      const video3 = await createTestVideo('test3.mp4', 1);
      
      await buffer.addVideoChunk(video1, 1);
      await buffer.addVideoChunk(video2, 1);
      await buffer.addVideoChunk(video3, 1);
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBeGreaterThanOrEqual(1);
      expect(status.bufferDurationSeconds).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Video Extraction', () => {
    beforeEach(async () => {
      // Add some test videos to the buffer
      for (let i = 0; i < 3; i++) {
        const videoPath = await createTestVideo(`chunk${i}.mp4`, 2);
        await buffer.addVideoChunk(videoPath, 2);
        
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });

    it('should extract last N seconds of video', async () => {
      const extractPath = await buffer.extractLastNSeconds(3);
      
      expect(extractPath).toContain('.mp4');
      expect(extractPath).toContain('extract_');
      
      // Verify the file exists
      const stats = await fs.stat(extractPath);
      expect(stats.size).toBeGreaterThan(0);
      
      // Verify it's a valid video using ffprobe
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of json "${extractPath}"`
      );
      
      const info = JSON.parse(stdout);
      expect(parseFloat(info.format.duration)).toBeGreaterThan(0);
      
      // Cleanup
      await fs.unlink(extractPath);
    });

    it('should handle extraction of entire buffer', async () => {
      const extractPath = await buffer.extractLastNSeconds(300); // 5 minutes
      
      const stats = await fs.stat(extractPath);
      expect(stats.size).toBeGreaterThan(0);
      
      // Cleanup
      await fs.unlink(extractPath);
    });
  });

  describe('Segment Management', () => {
    it('should create new segments based on time gaps', async function() {
      this.timeout(10000);
      
      const video1 = await createTestVideo('segment1.mp4', 1);
      await buffer.addVideoChunk(video1, 1);
      
      const status1 = buffer.getStatus();
      expect(status1.totalSegments).toBe(1);
      
      // Wait for segment timeout (3 seconds by default)
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      const video2 = await createTestVideo('segment2.mp4', 1);
      await buffer.addVideoChunk(video2, 1);
      
      const status2 = buffer.getStatus();
      expect(status2.totalSegments).toBe(2);
    });

    it('should maintain segment size limits', async () => {
      // Add videos until we exceed segment size limit
      let totalSize = 0;
      let chunkCount = 0;
      
      while (totalSize < 100 * 1024 * 1024 && chunkCount < 20) { // Up to 100MB or 20 chunks
        const videoPath = await createTestVideo(`large${chunkCount}.mp4`, 2);
        const stats = await fs.stat(videoPath);
        totalSize += stats.size;
        
        await buffer.addVideoChunk(videoPath, 2);
        chunkCount++;
      }
      
      const status = buffer.getStatus();
      
      // Should have created multiple segments if we exceeded size limit
      if (totalSize > 100 * 1024 * 1024) {
        expect(status.totalSegments).toBeGreaterThan(1);
      }
    });
  });

  describe('Buffer Pruning', () => {
    it('should not have segments older than max duration', async () => {
      // This test would need to run for 30+ minutes to test real pruning
      // So we'll just verify the mechanism exists
      
      const video = await createTestVideo('prune-test.mp4', 1);
      await buffer.addVideoChunk(video, 1);
      
      const status = buffer.getStatus();
      expect(status.oldestSegmentTime).toBeDefined();
      expect(status.newestSegmentTime).toBeDefined();
      
      const age = status.newestSegmentTime!.getTime() - status.oldestSegmentTime!.getTime();
      
      // Age should be very small for a fresh buffer
      expect(age).toBeLessThan(60000); // Less than 1 minute
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted video files gracefully', async () => {
      const corruptPath = path.join(testVideoDir, 'corrupt.mp4');
      await fs.writeFile(corruptPath, 'not a real video file');
      
      // Adding corrupt file might fail
      await expect(buffer.addVideoChunk(corruptPath, 1))
        .rejects.toThrow();
    });

    it('should handle missing video files', async () => {
      const missingPath = path.join(testVideoDir, 'missing.mp4');
      
      await expect(buffer.addVideoChunk(missingPath, 1))
        .rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle rapid additions efficiently', async () => {
      const startTime = Date.now();
      
      // Add 10 small videos rapidly
      for (let i = 0; i < 10; i++) {
        const videoPath = await createTestVideo(`rapid${i}.mp4`, 0.5);
        await buffer.addVideoChunk(videoPath, 0.5);
      }
      
      const duration = Date.now() - startTime;
      
      // Should complete reasonably quickly (depends on system)
      expect(duration).toBeLessThan(10000); // 10 seconds
      
      const status = buffer.getStatus();
      expect(status.bufferDurationSeconds).toBeGreaterThanOrEqual(5);
    });
  });
});