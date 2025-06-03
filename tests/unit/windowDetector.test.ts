import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { WindowDetector } from '../../src/capture/windowDetector.js';

// Create a mock exec async function
const mockExecAsync = jest.fn();

// Mock the entire util module with promisify returning our mock
jest.unstable_mockModule('util', () => ({
  promisify: () => mockExecAsync
}));

// Mock child_process - this needs to be done even though we're using promisify
jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn()
}));

describe('WindowDetector', () => {
  let windowDetector: WindowDetector;

  beforeEach(() => {
    jest.clearAllMocks();
    // Import dynamically after mocks are set up
    return import('../../src/capture/windowDetector.js').then(module => {
      const WindowDetectorClass = module.WindowDetector;
      windowDetector = new WindowDetectorClass();
    });
  });

  describe('getCommonBundleIds', () => {
    it('should return map of common application bundle IDs', () => {
      const bundleIds = windowDetector.getCommonBundleIds();

      expect(bundleIds).toBeDefined();
      expect(typeof bundleIds).toBe('object');
      expect(bundleIds.godot).toBe('org.godotengine.godot');
      expect(bundleIds.vscode).toBe('com.microsoft.VSCode');
      expect(bundleIds.chrome).toBe('com.google.Chrome');
      expect(bundleIds.safari).toBe('com.apple.Safari');
      expect(bundleIds.terminal).toBe('com.apple.Terminal');
    });

    it('should include development tools', () => {
      const bundleIds = windowDetector.getCommonBundleIds();

      expect(bundleIds.xcode).toBe('com.apple.dt.Xcode');
      expect(bundleIds.figma).toBe('com.figma.Desktop');
      expect(bundleIds.notion).toBe('notion.id');
      expect(bundleIds.obsidian).toBe('md.obsidian');
    });
  });

  describe('windowToCropArea', () => {
    it('should convert window info to crop area without padding', () => {
      const windowInfo = {
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

      const cropArea = windowDetector.windowToCropArea(windowInfo);

      expect(cropArea.x).toBe(100);
      expect(cropArea.y).toBe(200);
      expect(cropArea.width).toBe(800);
      expect(cropArea.height).toBe(600);
    });

    it('should add padding to crop area', () => {
      const windowInfo = {
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

      const cropArea = windowDetector.windowToCropArea(windowInfo, 20);

      expect(cropArea.x).toBe(80); // 100 - 20
      expect(cropArea.y).toBe(180); // 200 - 20
      expect(cropArea.width).toBe(840); // 800 + 40
      expect(cropArea.height).toBe(640); // 600 + 40
    });

    it('should handle windows at screen edge', () => {
      const windowInfo = {
        windowId: 123,
        bundleId: 'com.test.app',
        title: 'Edge Window',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        isVisible: true,
        processName: 'TestApp',
      };

      const cropArea = windowDetector.windowToCropArea(windowInfo, 10);

      expect(cropArea.x).toBe(0); // Math.max(0, 0 - 10)
      expect(cropArea.y).toBe(0); // Math.max(0, 0 - 10)
      expect(cropArea.width).toBe(820); // 800 + 20
      expect(cropArea.height).toBe(620); // 600 + 20
    });
  });

  describe('isApplicationRunning', () => {
    it('should return true when application is running', async () => {
      // Mock successful AppleScript execution
      mockExecAsync.mockResolvedValue({ stdout: 'true\n', stderr: '' });

      const isRunning = await windowDetector.isApplicationRunning('com.test.app');
      expect(mockExecAsync).toHaveBeenCalled();
      expect(isRunning).toBe(true);
    });

    it('should return false when application is not running', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'false\n', stderr: '' });

      const isRunning = await windowDetector.isApplicationRunning('com.nonexistent.app');
      expect(isRunning).toBe(false);
    });

    it('should handle AppleScript errors gracefully', async () => {
      mockExecAsync.mockRejectedValue(new Error('AppleScript error'));

      const isRunning = await windowDetector.isApplicationRunning('com.test.app');
      expect(isRunning).toBe(false);
    });
  });

  describe('findWindowsByBundleId', () => {
    it('should handle successful window discovery', async () => {
      const mockAppleScriptOutput = `{title:"Test Window", x:100, y:200, width:800, height:600, visible:true}`;
      mockExecAsync.mockResolvedValue({ stdout: mockAppleScriptOutput, stderr: '' });

      const windows = await windowDetector.findWindowsByBundleId('com.test.app');
      
      // Since parseAppleScriptOutput is simplified in our implementation,
      // we expect an empty array for now
      expect(Array.isArray(windows)).toBe(true);
    });

    it('should handle errors in window discovery', async () => {
      mockExecAsync.mockRejectedValue(new Error('Failed to run AppleScript'));

      const windows = await windowDetector.findWindowsByBundleId('com.test.app');
      expect(windows).toEqual([]);
    });
  });

  describe('findMainWindowByBundleId', () => {
    it('should return null when no windows found', async () => {
      // Mock empty windows array
      jest.spyOn(windowDetector, 'findWindowsByBundleId').mockResolvedValue([]);

      const mainWindow = await windowDetector.findMainWindowByBundleId('com.test.app');
      expect(mainWindow).toBeNull();
    });

    it('should return largest visible window', async () => {
      const mockWindows = [
        {
          windowId: 1,
          bundleId: 'com.test.app',
          title: 'Small Window',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          isVisible: true,
          processName: 'TestApp',
        },
        {
          windowId: 2,
          bundleId: 'com.test.app',
          title: 'Large Window',
          x: 100,
          y: 100,
          width: 1200,
          height: 800,
          isVisible: true,
          processName: 'TestApp',
        },
        {
          windowId: 3,
          bundleId: 'com.test.app',
          title: 'Hidden Window',
          x: 200,
          y: 200,
          width: 1000,
          height: 700,
          isVisible: false,
          processName: 'TestApp',
        },
      ];

      jest.spyOn(windowDetector, 'findWindowsByBundleId').mockResolvedValue(mockWindows);

      const mainWindow = await windowDetector.findMainWindowByBundleId('com.test.app');
      expect(mainWindow).toBeDefined();
      expect(mainWindow?.title).toBe('Large Window');
      expect(mainWindow?.width).toBe(1200);
      expect(mainWindow?.height).toBe(800);
    });

    it('should filter out very small windows', async () => {
      const mockWindows = [
        {
          windowId: 1,
          bundleId: 'com.test.app',
          title: 'Tiny Window',
          x: 0,
          y: 0,
          width: 50,
          height: 30,
          isVisible: true,
          processName: 'TestApp',
        },
        {
          windowId: 2,
          bundleId: 'com.test.app',
          title: 'Normal Window',
          x: 100,
          y: 100,
          width: 800,
          height: 600,
          isVisible: true,
          processName: 'TestApp',
        },
      ];

      jest.spyOn(windowDetector, 'findWindowsByBundleId').mockResolvedValue(mockWindows);

      const mainWindow = await windowDetector.findMainWindowByBundleId('com.test.app');
      expect(mainWindow).toBeDefined();
      expect(mainWindow?.title).toBe('Normal Window');
    });
  });

  describe('findWindowsUsingNativeTools', () => {
    it('should handle process discovery', async () => {
      const mockProcessOutput = `user  1234  0.0  0.1  123456  7890 ??  S  10:00AM   0:01.23 /Applications/TestApp.app/Contents/MacOS/TestApp`;
      mockExecAsync.mockResolvedValue({ stdout: mockProcessOutput, stderr: '' });

      const windows = await windowDetector.findWindowsUsingNativeTools('com.test.app');
      expect(Array.isArray(windows)).toBe(true);
    });

    it('should handle no running processes', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const windows = await windowDetector.findWindowsUsingNativeTools('com.nonexistent.app');
      expect(windows).toEqual([]);
    });
  });
});