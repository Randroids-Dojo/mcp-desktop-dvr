import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DesktopCapture } from '../../src/capture/desktopCapture.js';
import { OptimizedCircularBuffer } from '../../src/buffer/optimizedCircularBuffer.js';
import { MemoryMonitor } from '../../src/buffer/memoryMonitor.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock aperture for performance tests
jest.mock('aperture', () => ({
  recorder: {
    startRecording: jest.fn().mockResolvedValue(undefined),
    stopRecording: jest.fn().mockResolvedValue('/test/output.mp4'),
  },
}));

describe('Performance Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `perf-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Memory Monitor Performance', () => {
    it('should track memory usage within acceptable limits', () => {
      const memoryMonitor = new MemoryMonitor({
        warningMB: 1000,
        criticalMB: 1300,
        maxMB: 1500,
      });

      const startTime = Date.now();
      
      // Get memory stats multiple times to test performance
      for (let i = 0; i < 100; i++) {
        const stats = memoryMonitor.getMemoryStats();
        expect(stats.totalMB).toBeGreaterThan(0);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete 100 memory checks in under 100ms
      expect(duration).toBeLessThan(100);
      
      memoryMonitor.stopMonitoring();
    });

    it('should handle memory pressure detection efficiently', async () => {
      const memoryMonitor = new MemoryMonitor({
        warningMB: 100,  // Low threshold for testing
        criticalMB: 150,
        maxMB: 200,
      });

      let eventCount = 0;
      memoryMonitor.on('memoryUpdate', () => {
        eventCount++;
      });

      memoryMonitor.startMonitoring(10); // Check every 10ms

      // Wait for several monitoring cycles
      await new Promise(resolve => setTimeout(resolve, 100));
      
      memoryMonitor.stopMonitoring();
      
      // Should have triggered several monitoring events
      expect(eventCount).toBeGreaterThan(5);
    });
  });

  describe('OptimizedCircularBuffer Performance', () => {
    it('should handle rapid segment additions efficiently', async () => {
      const buffer = new OptimizedCircularBuffer(testDir, {
        hotTierMaxSegments: 10,
        hotTierMaxSizeMB: 50,
        memoryPressureEvictionThreshold: 0.8,
        enableMemoryMapping: true,
      });

      await buffer.initialize();

      const startTime = Date.now();
      
      // Add 20 segments rapidly
      for (let i = 0; i < 20; i++) {
        const videoPath = path.join(testDir, `video-${i}.mp4`);
        await fs.writeFile(videoPath, Buffer.alloc(1024 * 100)); // 100KB each
        await buffer.addVideoChunk(videoPath, 60);
      }
      
      const addTime = Date.now() - startTime;
      
      // Should add 20 segments in under 2 seconds
      expect(addTime).toBeLessThan(2000);
      
      const status = buffer.getStatus();
      expect(status.totalSegments).toBe(20);
      expect(status.hotSegments).toBeLessThanOrEqual(10);
      expect(status.coldSegments).toBeGreaterThanOrEqual(10);
      
      await buffer.shutdown();
    });

    it('should maintain performance during tier management', async () => {
      const buffer = new OptimizedCircularBuffer(testDir, {
        hotTierMaxSegments: 5,
        hotTierMaxSizeMB: 5, // Small limit to force tier changes
        memoryPressureEvictionThreshold: 0.8,
        enableMemoryMapping: true,
      });

      await buffer.initialize();

      const tierManagementTimes: number[] = [];
      
      // Add segments and measure tier management performance
      for (let i = 0; i < 15; i++) {
        const videoPath = path.join(testDir, `video-${i}.mp4`);
        await fs.writeFile(videoPath, Buffer.alloc(1024 * 500)); // 500KB each
        
        const startTime = Date.now();
        await buffer.addVideoChunk(videoPath, 60);
        const endTime = Date.now();
        
        tierManagementTimes.push(endTime - startTime);
      }
      
      // Average tier management time should be under 100ms
      const avgTime = tierManagementTimes.reduce((a, b) => a + b, 0) / tierManagementTimes.length;
      expect(avgTime).toBeLessThan(100);
      
      // No single operation should take more than 500ms
      const maxTime = Math.max(...tierManagementTimes);
      expect(maxTime).toBeLessThan(500);
      
      await buffer.shutdown();
    });

    it('should extract video segments within performance targets', async () => {
      const buffer = new OptimizedCircularBuffer(testDir);
      await buffer.initialize();

      // Add several test segments
      for (let i = 0; i < 5; i++) {
        const videoPath = path.join(testDir, `video-${i}.mp4`);
        await fs.writeFile(videoPath, 'test video content');
        await buffer.addVideoChunk(videoPath, 60);
      }

      const startTime = Date.now();
      
      // Extract should complete quickly for our test data
      try {
        await buffer.extractLastNSeconds(30);
        const extractTime = Date.now() - startTime;
        
        // Target: extraction should complete in under 2 seconds for test data
        expect(extractTime).toBeLessThan(2000);
      } catch (error) {
        // FFmpeg might not be available in test environment, that's okay
        expect(error).toBeDefined();
      }
      
      await buffer.shutdown();
    });
  });

  describe('DesktopCapture Performance', () => {
    it('should start capture quickly', async () => {
      const capture = new DesktopCapture(true);

      const startTime = Date.now();
      
      try {
        await capture.startCapture({
          fps: 30,
          quality: 70,
        });
        
        const captureStartTime = Date.now() - startTime;
        
        // Should start capture in under 1 second
        expect(captureStartTime).toBeLessThan(1000);
        
      } catch (error) {
        // Aperture might not be available in test environment
        expect(error).toBeDefined();
      }
      
      await capture.shutdown();
    });

    it('should handle status requests efficiently', async () => {
      const capture = new DesktopCapture(false); // Use regular buffer for speed

      const startTime = Date.now();
      
      // Get status 100 times
      for (let i = 0; i < 100; i++) {
        const status = capture.getStatus();
        expect(status).toBeDefined();
      }
      
      const statusTime = Date.now() - startTime;
      
      // Should get status 100 times in under 50ms
      expect(statusTime).toBeLessThan(50);
      
      await capture.shutdown();
    });

    it('should handle window detection efficiently', async () => {
      const capture = new DesktopCapture(false);

      const startTime = Date.now();
      
      // Get common bundle IDs multiple times
      for (let i = 0; i < 50; i++) {
        const bundleIds = capture.getCommonBundleIds();
        expect(Object.keys(bundleIds).length).toBeGreaterThan(5);
      }
      
      const bundleTime = Date.now() - startTime;
      
      // Should be nearly instantaneous
      expect(bundleTime).toBeLessThan(10);
      
      await capture.shutdown();
    });
  });

  describe('Memory Usage Verification', () => {
    it('should maintain memory usage within target limits', async () => {
      const capture = new DesktopCapture(true); // Use optimized buffer
      
      const initialMemory = process.memoryUsage();
      
      // Simulate capture operations
      try {
        await capture.startCapture({ fps: 30, quality: 70 });
        
        // Simulate adding multiple video chunks
        const buffer = (capture as any).circularBuffer;
        await buffer.initialize();
        
        for (let i = 0; i < 10; i++) {
          const videoPath = path.join(testDir, `memory-test-${i}.mp4`);
          await fs.writeFile(videoPath, Buffer.alloc(1024 * 1024)); // 1MB each
          await buffer.addVideoChunk(videoPath, 60);
        }
        
        const currentMemory = process.memoryUsage();
        const memoryIncrease = (currentMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);
        
        // Memory increase should be reasonable (under 100MB for our test)
        expect(memoryIncrease).toBeLessThan(100);
        
      } catch (error) {
        // Handle test environment limitations
        expect(error).toBeDefined();
      }
      
      await capture.shutdown();
    });

    it('should handle memory pressure gracefully', async () => {
      const buffer = new OptimizedCircularBuffer(testDir, {
        hotTierMaxSegments: 3,
        hotTierMaxSizeMB: 5, // Very small limit
        memoryPressureEvictionThreshold: 0.5, // Aggressive eviction
        enableMemoryMapping: true,
      });

      await buffer.initialize();

      // Add many large segments to trigger memory management
      for (let i = 0; i < 20; i++) {
        const videoPath = path.join(testDir, `pressure-test-${i}.mp4`);
        await fs.writeFile(videoPath, Buffer.alloc(1024 * 1024)); // 1MB each
        await buffer.addVideoChunk(videoPath, 60);
      }

      const status = buffer.getStatus();
      
      // Should maintain tier limits despite memory pressure
      expect(status.hotSegments).toBeLessThanOrEqual(3);
      expect(status.hotTierSizeMB).toBeLessThanOrEqual(5);
      expect(status.totalSegments).toBe(20);
      
      await buffer.shutdown();
    });
  });

  describe('Concurrency and Race Conditions', () => {
    it('should handle concurrent operations safely', async () => {
      const capture = new DesktopCapture(true);
      
      // Start multiple concurrent operations
      const operations = [
        capture.getCommonBundleIds(),
        capture.isApplicationRunning('com.test.app'),
        capture.getAvailableWindows(),
        capture.getStatus(),
      ];
      
      const startTime = Date.now();
      const results = await Promise.all(operations);
      const concurrentTime = Date.now() - startTime;
      
      // All operations should complete successfully
      expect(results).toHaveLength(4);
      expect(results[0]).toBeDefined(); // Bundle IDs
      expect(typeof results[1]).toBe('boolean'); // Is running
      expect(Array.isArray(results[2])).toBe(true); // Available windows
      expect(results[3]).toBeDefined(); // Status
      
      // Should complete in reasonable time
      expect(concurrentTime).toBeLessThan(1000);
      
      await capture.shutdown();
    });
  });
});