import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { DesktopCapture } from '../../src/capture/desktopCapture.js';

// Mock the aperture module
jest.mock('aperture', () => ({
  recorder: {
    startRecording: jest.fn().mockResolvedValue(undefined),
    stopRecording: jest.fn().mockResolvedValue('/test/output.mp4'),
  },
}));

// Mock fs and other dependencies
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
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

jest.mock('child_process', () => ({
  execSync: jest.fn().mockReturnValue(''),
  exec: jest.fn(),
}));

describe('MCP Tools Integration', () => {
  let desktopCapture: DesktopCapture;
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
      const { recorder } = require('aperture');
      
      await desktopCapture.startCapture({});
      
      expect(recorder.startRecording).toHaveBeenCalledWith(
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
      const { recorder } = require('aperture');
      
      // Mock window detection
      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        findMainWindowByBundleId: jest.fn().mockResolvedValue({
          windowId: 123,
          bundleId: 'com.test.app',
          title: 'Test Window',
          x: 100,
          y: 200,
          width: 800,
          height: 600,
          isVisible: true,
          processName: 'TestApp',
        }),
        windowToCropArea: jest.fn().mockReturnValue({
          x: 90,
          y: 190,
          width: 820,
          height: 620,
        }),
      });

      await desktopCapture.startCapture({
        fps: 30,
        quality: 70,
        bundleId: 'com.test.app',
        windowPadding: 10,
      });

      expect(recorder.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          fps: 30,
          videoCodec: 'h264',
          highlightClicks: true,
          showCursor: true,
          cropArea: {
            x: 90,
            y: 190,
            width: 820,
            height: 620,
          },
        })
      );

      const status = desktopCapture.getStatus();
      expect(status.bundleId).toBe('com.test.app');
      expect(status.targetWindow).toBeDefined();
    });

    it('should handle custom FPS and quality settings', async () => {
      const { recorder } = require('aperture');
      
      await desktopCapture.startCapture({
        fps: 60,
        quality: 85,
      });

      expect(recorder.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          fps: 60,
          videoCodec: 'h264',
        })
      );

      const status = desktopCapture.getStatus();
      expect(status.fps).toBe(60);
      expect(status.quality).toBe(85);
    });
  });

  describe('stop-capture tool', () => {
    it('should stop active capture', async () => {
      const { recorder } = require('aperture');
      
      // Start capture first
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Stop capture
      const outputPath = await desktopCapture.stopCapture();
      
      expect(recorder.stopRecording).toHaveBeenCalled();
      expect(outputPath).toBe('/test/output.mp4');
      
      const status = desktopCapture.getStatus();
      expect(status.isRecording).toBe(false);
    });

    it('should throw error when no capture is active', async () => {
      await expect(desktopCapture.stopCapture())
        .rejects.toThrow('No capture in progress');
    });
  });

  describe('get-capture-status tool', () => {
    it('should return status when not recording', () => {
      const status = desktopCapture.getStatus();
      
      expect(status.isRecording).toBe(false);
      expect(status.startTime).toBeUndefined();
      expect(status.duration).toBeUndefined();
      expect(status.fps).toBeUndefined();
      expect(status.quality).toBeUndefined();
    });

    it('should return detailed status when recording', async () => {
      await desktopCapture.startCapture({
        fps: 30,
        quality: 70,
        bundleId: 'com.test.app',
      });

      const status = desktopCapture.getStatus();
      
      expect(status.isRecording).toBe(true);
      expect(status.startTime).toBeInstanceOf(Date);
      expect(status.fps).toBe(30);
      expect(status.quality).toBe(70);
      expect(status.bundleId).toBe('com.test.app');
      expect(status.bufferStatus).toBeDefined();
    });
  });

  describe('configure-capture tool', () => {
    it('should update capture settings during recording', async () => {
      // Start capture
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Update settings
      await desktopCapture.updateCaptureSettings({
        fps: 60,
        quality: 85,
      });
      
      const status = desktopCapture.getStatus();
      expect(status.fps).toBe(60);
      expect(status.quality).toBe(85);
    });

    it('should throw error when not recording', async () => {
      await expect(desktopCapture.updateCaptureSettings({ fps: 60 }))
        .rejects.toThrow('No capture in progress to update');
    });
  });

  describe('list-available-windows tool', () => {
    it('should list common applications', async () => {
      const bundleIds = desktopCapture.getCommonBundleIds();
      
      expect(bundleIds).toBeDefined();
      expect(typeof bundleIds).toBe('object');
      expect(bundleIds.godot).toBe('org.godotengine.godot');
      expect(bundleIds.vscode).toBe('com.microsoft.VSCode');
    });

    it('should check if specific application is running', async () => {
      // Mock the window detector
      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        isApplicationRunning: jest.fn().mockResolvedValue(true),
        findWindowsByBundleId: jest.fn().mockResolvedValue([
          {
            windowId: 123,
            bundleId: 'com.test.app',
            title: 'Test Window',
            x: 100,
            y: 200,
            width: 800,
            height: 600,
            isVisible: true,
            processName: 'TestApp',
          },
        ]),
      });

      const isRunning = await desktopCapture.isApplicationRunning('com.test.app');
      const windows = await desktopCapture.getAvailableWindows('com.test.app');
      
      expect(isRunning).toBe(true);
      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBe(1);
    });

    it('should return empty array for non-running application', async () => {
      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        isApplicationRunning: jest.fn().mockResolvedValue(false),
        findWindowsByBundleId: jest.fn().mockResolvedValue([]),
      });

      const isRunning = await desktopCapture.isApplicationRunning('com.nonexistent.app');
      const windows = await desktopCapture.getAvailableWindows('com.nonexistent.app');
      
      expect(isRunning).toBe(false);
      expect(windows).toEqual([]);
    });
  });

  describe('analyze-desktop-now tool', () => {
    it('should extract and analyze video when capture is active', async () => {
      // Mock the circular buffer methods
      const mockExtractPath = '/test/extracted-video.mp4';
      jest.spyOn(desktopCapture as any, 'circularBuffer').mockReturnValue({
        addVideoChunk: jest.fn().mockResolvedValue(undefined),
        extractLastNSeconds: jest.fn().mockResolvedValue(mockExtractPath),
        getStatus: jest.fn().mockReturnValue({
          isActive: true,
          totalSegments: 2,
          totalSizeBytes: 2048,
          bufferDurationSeconds: 120,
        }),
      });

      // Start capture
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Extract video
      const extractedPath = await desktopCapture.extractLastNSeconds(30);
      
      expect(extractedPath).toBe(mockExtractPath);
    });

    it('should throw error when no capture is active', async () => {
      await expect(desktopCapture.extractLastNSeconds(30))
        .rejects.toThrow('No active recording to extract from');
    });

    it('should handle different extraction durations', async () => {
      const mockExtractPath = '/test/extracted-video.mp4';
      jest.spyOn(desktopCapture as any, 'circularBuffer').mockReturnValue({
        extractLastNSeconds: jest.fn().mockResolvedValue(mockExtractPath),
      });

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
      const { recorder } = require('aperture');
      recorder.startRecording.mockRejectedValue(new Error('Failed to start recording'));

      await expect(desktopCapture.startCapture({ fps: 30, quality: 70 }))
        .rejects.toThrow('Failed to start capture');
    });

    it('should handle aperture stop failures', async () => {
      const { recorder } = require('aperture');
      
      // Start successfully
      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      
      // Fail on stop
      recorder.stopRecording.mockRejectedValue(new Error('Failed to stop recording'));
      
      await expect(desktopCapture.stopCapture())
        .rejects.toThrow('Failed to stop capture');
    });

    it('should handle window detection failures gracefully', async () => {
      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        findMainWindowByBundleId: jest.fn().mockRejectedValue(new Error('Window detection failed')),
      });

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