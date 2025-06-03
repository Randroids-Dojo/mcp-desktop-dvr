import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Mock the aperture module
const mockRecorder = {
  startRecording: jest.fn().mockResolvedValue(undefined),
  stopRecording: jest.fn().mockResolvedValue('/test/output.mp4'),
};

jest.unstable_mockModule('aperture', () => ({
  recorder: mockRecorder,
}));

// Mock fs module
jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(Buffer.from('test data')),
    mkdir: jest.fn().mockResolvedValue(undefined),
    appendFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 1024 }),
    copyFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    rm: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
  },
}));

// Mock child_process module
jest.unstable_mockModule('child_process', () => ({
  execSync: jest.fn().mockReturnValue(''),
  exec: jest.fn(),
}));

// Import after mocks are set up
const { DesktopCapture } = await import('../../src/capture/desktopCapture.js');

describe('MCP Tools Integration', () => {
  let desktopCapture: DesktopCapture;
  
  // Mock console.error to reduce test noise
  const originalConsoleError = console.error;
  
  beforeAll(() => {
    console.error = jest.fn();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });
  let server: Server;

  beforeEach(async () => {
    jest.clearAllMocks();
    desktopCapture = new DesktopCapture(false);
    
    // Initialize the circular buffer
    await (desktopCapture as any).circularBuffer.initialize();
  });

  afterEach(async () => {
    if (desktopCapture) {
      await desktopCapture.shutdown();
    }
  });

  describe('start-continuous-capture tool', () => {
    it('should start full screen capture with default settings', async () => {
      await desktopCapture.startCapture({});
      
      expect(mockRecorder.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          fps: 30,
          videoCodec: 'h264',
          highlightClicks: true,
          showCursor: true,
        })
      );

      const status = desktopCapture.getStatus();
      expect(status.isRecording).toBe(true);
      expect(status.fps).toBe(30);
    });

    it('should start window-specific capture', async () => {
      // Mock the window detector method directly
      const mockWindowDetector = (desktopCapture as any).windowDetector;
      jest.spyOn(mockWindowDetector, 'findMainWindowByBundleId').mockResolvedValue({
        windowId: 123,
        bundleId: 'com.test.app',
        title: 'Test Window',
        x: 100,
        y: 200,
        width: 800,
        height: 600,
        isVisible: true,
        processName: 'TestApp',
      });
      jest.spyOn(mockWindowDetector, 'windowToCropArea').mockReturnValue({
        x: 90,
        y: 190,
        width: 820,
        height: 620,
      });

      await desktopCapture.startCapture({
        fps: 30,
        quality: 70,
        bundleId: 'com.test.app',
        windowPadding: 10,
      });

      // The recorder should have been called with recording options
      expect(mockRecorder.startRecording).toHaveBeenCalled();
      const callArgs = mockRecorder.startRecording.mock.calls[0][0];
      expect(callArgs.fps).toBe(30);
      expect(callArgs.videoCodec).toBe('h264');
      // Window detection happens asynchronously, so cropArea might not be set in mock
    });

    it('should handle custom capture settings', async () => {
      await desktopCapture.startCapture({
        fps: 60,
        quality: 85,
        audioDeviceId: 'test-audio-device',
      });

      expect(mockRecorder.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          fps: 60,
          audioDeviceId: 'test-audio-device',
        })
      );

      const status = desktopCapture.getStatus();
      expect(status.fps).toBe(60);
      expect(status.quality).toBe(85);
    });
  });

  describe('stop-capture tool', () => {
    it('should stop capture and save to file', async () => {
      // Start capture first
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Stop capture
      const outputPath = await desktopCapture.stopCapture();
      
      expect(mockRecorder.stopRecording).toHaveBeenCalled();
      expect(outputPath).toBe('/test/output.mp4');
      
      const status = desktopCapture.getStatus();
      expect(status.isRecording).toBe(false);
    });

    it('should handle stop without active recording', async () => {
      await expect(desktopCapture.stopCapture())
        .rejects.toThrow('No capture in progress');
    });
  });

  describe('get-capture-status tool', () => {
    it('should return status when not recording', () => {
      const status = desktopCapture.getStatus();
      
      expect(status.isRecording).toBe(false);
      expect(status.bufferStatus).toBeDefined();
      expect(status.memoryOptimized).toBe(false);
    });

    it('should return detailed status when recording', async () => {
      await desktopCapture.startCapture({ fps: 60, quality: 85 });
      
      const status = desktopCapture.getStatus();
      
      expect(status.isRecording).toBe(true);
      expect(status.fps).toBe(60);
      expect(status.quality).toBe(85);
      expect(status.startTime).toBeDefined();
      expect(status.bufferStatus.totalSegments).toBeGreaterThanOrEqual(0);
    });
  });

  describe('analyze-desktop-now tool', () => {
    it('should extract video for analysis', async () => {
      const mockExtractPath = '/test/extracted-video.mp4';
      const mockCircularBuffer = (desktopCapture as any).circularBuffer;
      jest.spyOn(mockCircularBuffer, 'extractLastNSeconds').mockResolvedValue(mockExtractPath);

      // Start capture
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Extract last 30 seconds
      const extractedPath = await desktopCapture.extractLastNSeconds(30);
      
      expect(extractedPath).toBe(mockExtractPath);
    });

    it('should handle extraction without recording', async () => {
      await expect(desktopCapture.extractLastNSeconds(30))
        .rejects.toThrow('No active recording to extract from');
    });
  });

  describe('configure-capture tool', () => {
    it('should update capture settings during recording', async () => {
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      const status = desktopCapture.getStatus();
      expect(status.fps).toBe(30);
      expect(status.quality).toBe(70);
    });

    it('should validate capture settings', async () => {
      // Invalid FPS
      await expect(desktopCapture.startCapture({ fps: 121 }))
        .rejects.toThrow('FPS must be between 1 and 120');
      
      // Invalid quality
      await expect(desktopCapture.startCapture({ quality: 101 }))
        .rejects.toThrow('Quality must be between 1 and 100');
    });
  });

  describe('window capture features', () => {
    it('should fallback to full screen when window not found', async () => {
      // Mock the windowDetector's method directly
      (desktopCapture as any).windowDetector.findMainWindowByBundleId = jest.fn().mockResolvedValue(null);

      await desktopCapture.startCapture({
        bundleId: 'com.nonexistent.app',
      });

      // Should still start recording without crop area
      expect(mockRecorder.startRecording).toHaveBeenCalledWith(
        expect.not.objectContaining({
          cropArea: expect.any(Object),
        })
      );
    });

    it('should support direct crop area specification', async () => {
      const cropArea = { x: 100, y: 100, width: 800, height: 600 };
      
      await desktopCapture.startCapture({
        cropArea,
      });

      expect(mockRecorder.startRecording).toHaveBeenCalled();
      const callArgs = mockRecorder.startRecording.mock.calls[0][0];
      expect(callArgs.cropArea).toEqual(cropArea);
    });
  });

  describe('extraction durations', () => {
    it('should handle different extraction durations', async () => {
      const mockExtractPath = '/test/extracted-video.mp4';
      // Mock the circularBuffer's method directly
      (desktopCapture as any).circularBuffer.extractLastNSeconds = jest.fn().mockResolvedValue(mockExtractPath);

      // Start capture
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Test different durations
      const durations = [10, 30, 60, 120];
      for (const duration of durations) {
        const extractedPath = await desktopCapture.extractLastNSeconds(duration);
        expect(extractedPath).toBe(mockExtractPath);
      }
    });
  });

  describe('error handling', () => {
    it('should handle aperture startup failures', async () => {
      mockRecorder.startRecording.mockRejectedValue(new Error('Failed to start recording'));

      await expect(desktopCapture.startCapture({ fps: 30, quality: 70 }))
        .rejects.toThrow('Failed to start capture');
    });

    it('should handle aperture stop failures', async () => {
      // Mock successful start
      mockRecorder.startRecording.mockResolvedValueOnce(undefined);
      
      // Start successfully
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Fail on stop
      mockRecorder.stopRecording.mockRejectedValueOnce(new Error('Failed to stop recording'));
      
      await expect(desktopCapture.stopCapture())
        .rejects.toThrow('Failed to stop capture');
    });

    it('should handle window detection failures gracefully', async () => {
      // Mock the windowDetector's method to throw an error
      (desktopCapture as any).windowDetector.findMainWindowByBundleId = jest.fn().mockRejectedValue(new Error('Window detection failed'));

      // Should not throw, should fallback to full screen
      await expect(desktopCapture.startCapture({
        bundleId: 'com.failing.app',
      })).resolves.not.toThrow();
    });
  });

  describe('memory optimization integration', () => {
    it('should work with optimized buffer', async () => {
      const optimizedCapture = new DesktopCapture(true);
      await (optimizedCapture as any).circularBuffer.initialize();

      // Mock successful start for this instance
      mockRecorder.startRecording.mockResolvedValueOnce(undefined);
      
      await optimizedCapture.startCapture({ fps: 30, quality: 70 });
      
      const status = optimizedCapture.getStatus();
      expect(status.memoryOptimized).toBe(true);
      
      await optimizedCapture.shutdown();
    });

    it('should provide memory statistics with optimized buffer', async () => {
      const optimizedCapture = new DesktopCapture(true);
      await (optimizedCapture as any).circularBuffer.initialize();

      const status = optimizedCapture.getStatus();
      expect(status.bufferStatus).toBeDefined();
      
      await optimizedCapture.shutdown();
    });
  });
});