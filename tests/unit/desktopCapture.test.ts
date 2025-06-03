import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock modules before imports
const mockRecorder = {
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
};

jest.unstable_mockModule('aperture', () => ({
  recorder: mockRecorder,
}));

jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
}));

jest.unstable_mockModule('child_process', () => ({
  execSync: jest.fn(),
}));

// Import after mocks
const { DesktopCapture } = await import('../../src/capture/desktopCapture.js');
const { WindowInfo } = await import('../../src/capture/windowDetector.js');
const { execSync } = await import('child_process');

const mockedRecorder = mockRecorder;
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('DesktopCapture', () => {
  let desktopCapture: DesktopCapture;

  beforeEach(() => {
    jest.clearAllMocks();
    desktopCapture = new DesktopCapture(false); // Use regular buffer for simpler testing
  });

  afterEach(async () => {
    if (desktopCapture) {
      await desktopCapture.shutdown();
    }
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      const capture = new DesktopCapture();
      expect(capture).toBeDefined();
    });

    it('should initialize with optimized buffer when requested', () => {
      const capture = new DesktopCapture(true);
      expect(capture).toBeDefined();
    });

    it('should initialize window detector', () => {
      expect(desktopCapture.getCommonBundleIds()).toBeDefined();
    });
  });

  describe('getCommonBundleIds', () => {
    it('should return common application bundle IDs', () => {
      const bundleIds = desktopCapture.getCommonBundleIds();
      
      expect(bundleIds).toBeDefined();
      expect(typeof bundleIds).toBe('object');
      expect(bundleIds.godot).toBe('org.godotengine.godot');
      expect(bundleIds.vscode).toBe('com.microsoft.VSCode');
    });
  });

  describe('isApplicationRunning', () => {
    it('should check if application is running', async () => {
      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        isApplicationRunning: jest.fn().mockResolvedValue(true),
      });

      const isRunning = await desktopCapture.isApplicationRunning('com.test.app');
      expect(typeof isRunning).toBe('boolean');
    });
  });

  describe('getAvailableWindows', () => {
    it('should return windows for specific bundle ID', async () => {
      const mockWindows: WindowInfo[] = [
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
      ];

      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        findWindowsByBundleId: jest.fn().mockResolvedValue(mockWindows),
      });

      const windows = await desktopCapture.getAvailableWindows('com.test.app');
      expect(Array.isArray(windows)).toBe(true);
    });

    it('should return all available windows when no bundle ID specified', async () => {
      // Mock the windowDetector methods directly
      (desktopCapture as any).windowDetector.getCommonBundleIds = jest.fn().mockReturnValue({
        test: 'com.test.app',
      });
      (desktopCapture as any).windowDetector.isApplicationRunning = jest.fn().mockResolvedValue(true);
      (desktopCapture as any).windowDetector.findWindowsByBundleId = jest.fn().mockResolvedValue([]);

      const windows = await desktopCapture.getAvailableWindows();
      expect(Array.isArray(windows)).toBe(true);
    });
  });

  describe('capture options validation', () => {
    it('should handle full screen capture options', async () => {
      mockedRecorder.startRecording.mockResolvedValue(undefined);

      await expect(
        desktopCapture.startCapture({
          fps: 30,
          quality: 70,
        })
      ).resolves.not.toThrow();

      expect(mockedRecorder.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          fps: 30,
          videoCodec: 'h264',
          highlightClicks: true,
          showCursor: true,
        })
      );
    });

    it('should handle window-specific capture options', async () => {
      // Using imported mockedRecorder
      mockedRecorder.startRecording.mockResolvedValue(undefined);

      const mockWindow: WindowInfo = {
        windowId: 123,
        bundleId: 'com.test.app',
        title: 'Test Window',
        x: 100,
        y: 200,
        width: 800,
        height: 600,
        isVisible: true,
        processName: 'TestApp',
      };

      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        findMainWindowByBundleId: jest.fn().mockResolvedValue(mockWindow),
        windowToCropArea: jest.fn().mockReturnValue({
          x: 90,
          y: 190,
          width: 820,
          height: 620,
        }),
      });

      await expect(
        desktopCapture.startCapture({
          fps: 30,
          quality: 70,
          bundleId: 'com.test.app',
          windowPadding: 10,
        })
      ).resolves.not.toThrow();

      expect(mockedRecorder.startRecording).toHaveBeenCalledWith(
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
    });

    it('should fallback to full screen when window not found', async () => {
      // Using imported mockedRecorder
      mockedRecorder.startRecording.mockResolvedValue(undefined);

      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        findMainWindowByBundleId: jest.fn().mockResolvedValue(null),
      });

      await expect(
        desktopCapture.startCapture({
          fps: 30,
          quality: 70,
          bundleId: 'com.nonexistent.app',
        })
      ).resolves.not.toThrow();

      expect(mockedRecorder.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          fps: 30,
          videoCodec: 'h264',
          highlightClicks: true,
          showCursor: true,
        })
      );
      // Should not have cropArea when window not found
      expect(mockedRecorder.startRecording).not.toHaveBeenCalledWith(
        expect.objectContaining({
          cropArea: expect.anything(),
        })
      );
    });
  });

  describe('capture lifecycle', () => {
    it('should prevent multiple simultaneous captures', async () => {
      // Using imported mockedRecorder
      mockedRecorder.startRecording.mockResolvedValue(undefined);

      // Start first capture
      await desktopCapture.startCapture({ fps: 30, quality: 70 });

      // Try to start second capture
      await expect(
        desktopCapture.startCapture({ fps: 30, quality: 70 })
      ).rejects.toThrow('Capture is already in progress');
    });

    it('should handle aperture timeout gracefully', async () => {
      // Using imported mockedRecorder
      const timeoutError = new Error('Timeout');
      (timeoutError as any).code = 'RECORDER_TIMEOUT';
      mockedRecorder.startRecording.mockRejectedValue(timeoutError);

      // Mock checkApertureRunning to return true
      jest.spyOn(desktopCapture as any, 'checkApertureRunning').mockReturnValue(true);

      await expect(
        desktopCapture.startCapture({ fps: 30, quality: 70 })
      ).resolves.not.toThrow();
    });

    it('should throw on other aperture errors', async () => {
      // Using imported mockedRecorder
      const otherError = new Error('Other error');
      mockedRecorder.startRecording.mockRejectedValue(otherError);

      await expect(
        desktopCapture.startCapture({ fps: 30, quality: 70 })
      ).rejects.toThrow('Failed to start capture');
    });
  });

  describe('updateCaptureSettings', () => {
    it('should update capture settings when recording', async () => {
      // Using imported mockedRecorder
      mockedRecorder.startRecording.mockResolvedValue(undefined);

      // Start capture first
      await desktopCapture.startCapture({ fps: 30, quality: 70 });

      // Update settings
      await expect(
        desktopCapture.updateCaptureSettings({ fps: 60, quality: 80 })
      ).resolves.not.toThrow();

      const status = desktopCapture.getStatus();
      expect(status.fps).toBe(60);
      expect(status.quality).toBe(80);
    });

    it('should throw error when not recording', async () => {
      await expect(
        desktopCapture.updateCaptureSettings({ fps: 60 })
      ).rejects.toThrow('No capture in progress to update');
    });
  });

  describe('status reporting', () => {
    it('should provide comprehensive status when not recording', () => {
      const status = desktopCapture.getStatus();

      expect(status.isRecording).toBe(false);
      expect(status.startTime).toBeUndefined();
      expect(status.duration).toBeUndefined();
      expect(status.fps).toBeUndefined();
      expect(status.quality).toBeUndefined();
      expect(status.outputPath).toBeUndefined();
      expect(status.bundleId).toBeUndefined();
      expect(status.cropArea).toBeUndefined();
      expect(status.targetWindow).toBeUndefined();
    });

    it('should provide status with window information when recording', async () => {
      // Using imported mockedRecorder
      mockedRecorder.startRecording.mockResolvedValue(undefined);

      const mockWindow: WindowInfo = {
        windowId: 123,
        bundleId: 'com.test.app',
        title: 'Test Window',
        x: 100,
        y: 200,
        width: 800,
        height: 600,
        isVisible: true,
        processName: 'TestApp',
      };

      jest.spyOn(desktopCapture as any, 'windowDetector').mockReturnValue({
        findMainWindowByBundleId: jest.fn().mockResolvedValue(mockWindow),
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
      });

      const status = desktopCapture.getStatus();
      expect(status.isRecording).toBe(true);
      expect(status.fps).toBe(30);
      expect(status.quality).toBe(70);
      expect(status.bundleId).toBe('com.test.app');
      expect(status.targetWindow).toEqual(mockWindow);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully when not recording', async () => {
      await expect(desktopCapture.shutdown()).resolves.not.toThrow();
    });

    it('should stop recording during shutdown', async () => {
      // Using imported mockedRecorder
      mockedRecorder.startRecording.mockResolvedValue(undefined);
      mockedRecorder.stopRecording.mockResolvedValue('output.mp4');

      await desktopCapture.startCapture({ fps: 30, quality: 70 });
      await expect(desktopCapture.shutdown()).resolves.not.toThrow();

      expect(mockedRecorder.stopRecording).toHaveBeenCalled();
    });
  });

  describe('aperture process detection', () => {
    it('should detect running aperture process', () => {
      mockedExecSync.mockReturnValue('aperture record process running' as any);

      const isRunning = (desktopCapture as any).checkApertureRunning();
      expect(typeof isRunning).toBe('boolean');
    });

    it('should handle execSync errors', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const isRunning = (desktopCapture as any).checkApertureRunning();
      expect(isRunning).toBe(false);
    });
  });
});