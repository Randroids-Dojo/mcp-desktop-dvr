import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DesktopCapture } from '../../src/capture/desktopCapture.js';
import { OptimizedCircularBuffer } from '../../src/buffer/optimizedCircularBuffer.js';
import { MemoryMonitor } from '../../src/buffer/memoryMonitor.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('Real Performance Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `real-perf-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Memory Monitor', () => {
    it('should accurately track memory usage', () => {
      const monitor = new MemoryMonitor({
        warningMB: 1000,
        criticalMB: 1300,
        maxMB: 1500,
      });

      const stats = monitor.getMemoryStats();
      
      expect(stats.totalMB).toBeGreaterThan(0);
      expect(stats.heapUsedMB).toBeGreaterThan(0);
      expect(stats.heapUsedMB).toBeLessThan(stats.totalMB);
      expect(stats.heapPercent).toBeGreaterThan(0);
      expect(stats.heapPercent).toBeLessThan(100);
    });

    it('should detect memory pressure states', () => {
      // Test with very low thresholds to trigger warnings
      const monitor = new MemoryMonitor({
        warningMB: 1,
        criticalMB: 2,
        maxMB: 3,
      });

      const status = monitor.checkMemoryPressure();
      
      // Should be in critical state with such low thresholds
      expect(status.state).toBe('critical');
      expect(status.heapUsedMB).toBeGreaterThan(1);
    });
  });

  describe('OptimizedCircularBuffer with Real Video', () => {
    it('should handle real video segments efficiently', async () => {
      const buffer = new OptimizedCircularBuffer(testDir, {
        hotTierMaxSegments: 5,
        hotTierMaxSizeMB: 100,
        memoryPressureEvictionThreshold: 0.8,
        enableMemoryMapping: true,
      });

      await buffer.initialize();

      // Create a real video file using ffmpeg
      const testVideoPath = path.join(testDir, 'test-video.mp4');
      
      // Generate a test pattern video with ffmpeg
      await new Promise<void>((resolve, reject) => {
        const { exec } = require('child_process');
        exec(
          `ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -pix_fmt yuv420p "${testVideoPath}" -y`,
          (error: any) => {
            if (error) reject(error);
            else resolve();
          }
        );
      });

      // Add the real video segment
      const startTime = Date.now();
      await buffer.addVideoChunk(testVideoPath, 1);
      const addTime = Date.now() - startTime;

      expect(addTime).toBeLessThan(100); // Should be fast

      const status = buffer.getStatus();
      expect(status.totalSegments).toBe(1);
      expect(status.hotSegments).toBe(1);

      await buffer.shutdown();
    });

    it('should efficiently manage tier transitions', async () => {
      const buffer = new OptimizedCircularBuffer(testDir, {
        hotTierMaxSegments: 3,
        hotTierMaxSizeMB: 10,
        memoryPressureEvictionThreshold: 0.8,
        enableMemoryMapping: false,
      });

      await buffer.initialize();

      // Generate multiple small test videos
      for (let i = 0; i < 5; i++) {
        const videoPath = path.join(testDir, `video-${i}.mp4`);
        await new Promise<void>((resolve, reject) => {
          const { exec } = require('child_process');
          exec(
            `ffmpeg -f lavfi -i testsrc=duration=0.5:size=160x120:rate=30 -pix_fmt yuv420p "${videoPath}" -y`,
            (error: any) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });

        await buffer.addVideoChunk(videoPath, 0.5);
      }

      const status = buffer.getStatus();
      
      // Should have promoted some segments to cold tier
      expect(status.totalSegments).toBe(5);
      expect(status.hotSegments).toBeLessThanOrEqual(3);
      expect(status.coldSegments).toBeGreaterThanOrEqual(2);

      await buffer.shutdown();
    });
  });

  describe('Real Capture Performance', () => {
    it('should maintain performance during continuous capture', async function() {
      this.timeout(20000); // 20 second timeout

      console.log('\n⏱️  Starting real performance test...');
      
      const capture = new DesktopCapture(true); // Use optimized buffer
      
      await capture.startCapture({ 
        fps: 30, 
        quality: 70,
        cropArea: { x: 0, y: 0, width: 640, height: 480 } // Smaller area for performance
      });

      const measurements = [];
      
      // Measure performance over 15 seconds
      for (let i = 0; i < 15; i++) {
        const start = Date.now();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusStart = Date.now();
        const status = capture.getStatus();
        const statusTime = Date.now() - statusStart;
        
        measurements.push({
          second: i + 1,
          statusTime,
          segments: status.bufferStatus.totalSegments,
          memoryMB: process.memoryUsage().heapUsed / 1024 / 1024
        });
      }

      await capture.stopCapture();
      await capture.shutdown();

      // Analyze performance
      const avgStatusTime = measurements.reduce((sum, m) => sum + m.statusTime, 0) / measurements.length;
      const maxStatusTime = Math.max(...measurements.map(m => m.statusTime));
      
      console.log(`\nAverage status check time: ${avgStatusTime.toFixed(2)}ms`);
      console.log(`Max status check time: ${maxStatusTime}ms`);
      
      // Status checks should be fast
      expect(avgStatusTime).toBeLessThan(5);
      expect(maxStatusTime).toBeLessThan(20);
      
      // Memory should be stable
      const firstMemory = measurements[0].memoryMB;
      const lastMemory = measurements[measurements.length - 1].memoryMB;
      const memoryGrowth = lastMemory - firstMemory;
      
      console.log(`Memory growth: ${memoryGrowth.toFixed(1)}MB`);
      expect(memoryGrowth).toBeLessThan(200); // Less than 200MB growth
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent buffer operations safely', async () => {
      const buffer = new OptimizedCircularBuffer(testDir);
      await buffer.initialize();

      // Create test videos concurrently
      const videoPromises = [];
      for (let i = 0; i < 10; i++) {
        videoPromises.push(
          new Promise<string>((resolve, reject) => {
            const videoPath = path.join(testDir, `concurrent-${i}.mp4`);
            const { exec } = require('child_process');
            exec(
              `ffmpeg -f lavfi -i color=c=blue:s=160x120:d=0.1 -pix_fmt yuv420p "${videoPath}" -y`,
              (error: any) => {
                if (error) reject(error);
                else resolve(videoPath);
              }
            );
          })
        );
      }

      const videoPaths = await Promise.all(videoPromises);

      // Add all videos concurrently
      const addPromises = videoPaths.map((path, i) => 
        buffer.addVideoChunk(path, 0.1)
      );

      await Promise.all(addPromises);

      const status = buffer.getStatus();
      expect(status.totalSegments).toBeGreaterThanOrEqual(1);
      
      // Should be able to extract without issues
      const extractPath = await buffer.extractLastNSeconds(1);
      expect(extractPath).toBeTruthy();

      await buffer.shutdown();
    });
  });
});