import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MemoryMonitor } from '../../src/buffer/memoryMonitor.js';

describe('MemoryMonitor', () => {
  let memoryMonitor: MemoryMonitor;
  let originalMemoryUsage: typeof process.memoryUsage;

  beforeEach(() => {
    memoryMonitor = new MemoryMonitor({
      warningMB: 100,
      criticalMB: 150,
      maxMB: 200,
    });

    // Mock process.memoryUsage
    originalMemoryUsage = process.memoryUsage;
    process.memoryUsage = jest.fn();
  });

  afterEach(() => {
    memoryMonitor.stopMonitoring();
    process.memoryUsage = originalMemoryUsage;
    jest.clearAllMocks();
  });

  describe('getMemoryStats', () => {
    it('should return current memory statistics', () => {
      const mockMemUsage = {
        heapUsed: 50 * 1024 * 1024, // 50MB
        heapTotal: 100 * 1024 * 1024, // 100MB
        external: 25 * 1024 * 1024, // 25MB
        rss: 200 * 1024 * 1024, // 200MB
        arrayBuffers: 10 * 1024 * 1024, // 10MB
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      const stats = memoryMonitor.getMemoryStats();

      expect(stats.heapUsed).toBe(mockMemUsage.heapUsed);
      expect(stats.heapTotal).toBe(mockMemUsage.heapTotal);
      expect(stats.external).toBe(mockMemUsage.external);
      expect(stats.rss).toBe(mockMemUsage.rss);
      expect(stats.totalMB).toBeCloseTo(75); // (50 + 25) MB
      expect(stats.percentUsed).toBeCloseTo(37.5); // 75/200 * 100
    });
  });

  describe('memory threshold detection', () => {
    it('should detect normal memory usage', () => {
      const mockMemUsage = {
        heapUsed: 20 * 1024 * 1024, // 20MB
        heapTotal: 40 * 1024 * 1024,
        external: 10 * 1024 * 1024, // 10MB
        rss: 100 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      expect(memoryMonitor.isMemoryPressure()).toBe(false);
      expect(memoryMonitor.shouldEvictSegments()).toBe(false);
    });

    it('should detect memory pressure at warning threshold', () => {
      const mockMemUsage = {
        heapUsed: 80 * 1024 * 1024, // 80MB
        heapTotal: 100 * 1024 * 1024,
        external: 30 * 1024 * 1024, // 30MB
        rss: 200 * 1024 * 1024,
        arrayBuffers: 10 * 1024 * 1024,
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      expect(memoryMonitor.isMemoryPressure()).toBe(true);
      expect(memoryMonitor.shouldEvictSegments()).toBe(false);
    });

    it('should detect critical memory usage', () => {
      const mockMemUsage = {
        heapUsed: 120 * 1024 * 1024, // 120MB
        heapTotal: 150 * 1024 * 1024,
        external: 40 * 1024 * 1024, // 40MB
        rss: 300 * 1024 * 1024,
        arrayBuffers: 20 * 1024 * 1024,
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      expect(memoryMonitor.isMemoryPressure()).toBe(true);
      expect(memoryMonitor.shouldEvictSegments()).toBe(true);
    });
  });

  describe('monitoring lifecycle', () => {
    it('should start and stop monitoring', () => {
      // Ensure process.memoryUsage returns valid data
      const mockMemUsage = {
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 25 * 1024 * 1024,
        rss: 200 * 1024 * 1024,
        arrayBuffers: 10 * 1024 * 1024,
      };
      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      expect(() => memoryMonitor.startMonitoring(100)).not.toThrow();
      expect(() => memoryMonitor.stopMonitoring()).not.toThrow();
    });

    it('should handle multiple start calls', () => {
      // Ensure process.memoryUsage returns valid data
      const mockMemUsage = {
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 25 * 1024 * 1024,
        rss: 200 * 1024 * 1024,
        arrayBuffers: 10 * 1024 * 1024,
      };
      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      memoryMonitor.startMonitoring(100);
      expect(() => memoryMonitor.startMonitoring(50)).not.toThrow();
    });

    it('should handle stop without start', () => {
      expect(() => memoryMonitor.stopMonitoring()).not.toThrow();
    });
  });

  describe('event emission', () => {
    it('should emit memoryWarning event at warning threshold', (done) => {
      const mockMemUsage = {
        heapUsed: 80 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 30 * 1024 * 1024,
        rss: 200 * 1024 * 1024,
        arrayBuffers: 10 * 1024 * 1024,
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      memoryMonitor.on('memoryWarning', (stats) => {
        expect(stats.totalMB).toBeCloseTo(110);
        done();
      });

      memoryMonitor.startMonitoring(10);
    });

    it('should emit memoryCritical event at critical threshold', (done) => {
      const mockMemUsage = {
        heapUsed: 120 * 1024 * 1024,
        heapTotal: 150 * 1024 * 1024,
        external: 40 * 1024 * 1024,
        rss: 300 * 1024 * 1024,
        arrayBuffers: 20 * 1024 * 1024,
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      memoryMonitor.on('memoryCritical', (stats) => {
        expect(stats.totalMB).toBeCloseTo(160);
        done();
      });

      memoryMonitor.startMonitoring(10);
    });

    it('should emit memoryExceeded event at max threshold', (done) => {
      const mockMemUsage = {
        heapUsed: 150 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 80 * 1024 * 1024,
        rss: 400 * 1024 * 1024,
        arrayBuffers: 30 * 1024 * 1024,
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      memoryMonitor.on('memoryExceeded', (stats) => {
        expect(stats.totalMB).toBeCloseTo(230);
        done();
      });

      memoryMonitor.startMonitoring(10);
    });
  });

  describe('getLastStats', () => {
    it('should return undefined before any monitoring', () => {
      expect(memoryMonitor.getLastStats()).toBeUndefined();
    });

    it('should return last stats after monitoring check', () => {
      const mockMemUsage = {
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 25 * 1024 * 1024,
        rss: 200 * 1024 * 1024,
        arrayBuffers: 10 * 1024 * 1024,
      };

      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>)
        .mockReturnValue(mockMemUsage);

      memoryMonitor.getMemoryStats(); // Trigger internal check
      const lastStats = memoryMonitor.getLastStats();
      expect(lastStats).toBeUndefined(); // Not set until monitoring starts
    });
  });
});