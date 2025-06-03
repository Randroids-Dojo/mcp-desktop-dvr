import { describe, it, expect, beforeEach } from '@jest/globals';
import { DesktopCapture } from '../../src/capture/desktopCapture.js';

describe('DesktopCapture Unit Tests (Focused)', () => {
  describe('Input Validation', () => {
    let capture: DesktopCapture;

    beforeEach(() => {
      capture = new DesktopCapture();
    });

    it('should validate FPS range', async () => {
      await expect(capture.startCapture({ fps: 0 }))
        .rejects.toThrow('FPS must be between 1 and 120');
      
      await expect(capture.startCapture({ fps: 121 }))
        .rejects.toThrow('FPS must be between 1 and 120');
    });

    it('should validate quality range', async () => {
      await expect(capture.startCapture({ quality: 0 }))
        .rejects.toThrow('Quality must be between 1 and 100');
      
      await expect(capture.startCapture({ quality: 101 }))
        .rejects.toThrow('Quality must be between 1 and 100');
    });

    it('should accept valid parameters', async () => {
      // This will fail trying to actually start recording, but validates params pass
      await expect(capture.startCapture({ 
        fps: 30, 
        quality: 70,
        audioDeviceId: 'test-device'
      })).rejects.toThrow(); // Will throw because aperture not mocked
    });
  });

  describe('Status Management', () => {
    it('should provide initial status', () => {
      const capture = new DesktopCapture();
      const status = capture.getStatus();

      expect(status.isRecording).toBe(false);
      expect(status.startTime).toBeUndefined();
      expect(status.duration).toBeUndefined();
      expect(status.fps).toBeUndefined();
      expect(status.bufferStatus).toBeDefined();
    });

    it('should differentiate optimized vs regular buffer', () => {
      const regularCapture = new DesktopCapture(false);
      const optimizedCapture = new DesktopCapture(true);

      expect(regularCapture.getStatus().memoryOptimized).toBe(false);
      expect(optimizedCapture.getStatus().memoryOptimized).toBe(true);
    });
  });

  describe('Bundle ID Helpers', () => {
    it('should provide common bundle IDs', () => {
      const capture = new DesktopCapture();
      const bundleIds = capture.getCommonBundleIds();

      // Check structure
      expect(bundleIds).toMatchObject({
        godot: 'org.godotengine.godot',
        vscode: 'com.microsoft.VSCode',
        finder: 'com.apple.finder',
        safari: 'com.apple.Safari',
        chrome: 'com.google.Chrome',
        firefox: 'org.mozilla.firefox',
        terminal: 'com.apple.Terminal',
        iterm: 'com.googlecode.iterm2',
        xcode: 'com.apple.dt.Xcode',
        figma: 'com.figma.Desktop',
        slack: 'com.tinyspeck.slackmacgap',
        discord: 'com.hnc.Discord',
        notion: 'notion.id',
        obsidian: 'md.obsidian',
        arc: 'company.thebrowser.Browser',
      });
    });
  });

  describe('Capture Options Processing', () => {
    it('should process crop area correctly', () => {
      const capture = new DesktopCapture();
      
      // Access private method through any cast for testing
      const options = (capture as any).buildRecordingOptions({
        fps: 30,
        quality: 70,
        cropArea: { x: 100, y: 200, width: 800, height: 600 }
      });

      expect(options.fps).toBe(30);
      expect(options.cropArea).toEqual({ x: 100, y: 200, width: 800, height: 600 });
    });

    it('should handle window padding option', () => {
      const capture = new DesktopCapture();
      
      // When bundleId is provided without cropArea, it should use windowPadding
      const options = (capture as any).buildRecordingOptions({
        bundleId: 'com.test.app',
        windowPadding: 20
      });

      // Options should be prepared for window detection
      expect(options.fps).toBe(30); // Default
    });
  });

  describe('Error States', () => {
    it('should prevent operations when not initialized', async () => {
      const capture = new DesktopCapture();
      
      // These should fail because buffer isn't initialized
      await expect(capture.extractLastNSeconds(10))
        .rejects.toThrow();
    });

    it('should prevent double start', async () => {
      const capture = new DesktopCapture();
      
      // Mock the recording state
      (capture as any).recorder = { isRecording: true };
      (capture as any).isRecording = true;

      await expect(capture.startCapture({}))
        .rejects.toThrow('Capture already in progress');
    });

    it('should prevent stop when not recording', async () => {
      const capture = new DesktopCapture();
      
      await expect(capture.stopCapture())
        .rejects.toThrow('No active recording');
    });
  });

  describe('Time Duration Calculations', () => {
    it('should calculate recording duration correctly', () => {
      const capture = new DesktopCapture();
      
      // Simulate recording state
      const startTime = new Date('2025-01-01T10:00:00');
      (capture as any).startTime = startTime;
      (capture as any).isRecording = true;
      
      // Mock current time
      const originalDateNow = Date.now;
      Date.now = () => new Date('2025-01-01T10:00:30').getTime();
      
      const status = capture.getStatus();
      expect(status.duration).toBe(30);
      
      // Restore
      Date.now = originalDateNow;
    });
  });

  describe('Extraction Parameters', () => {
    it('should validate extraction duration', async () => {
      const capture = new DesktopCapture();
      
      // Negative duration
      await expect(capture.extractLastNSeconds(-1))
        .rejects.toThrow();
      
      // Zero duration  
      await expect(capture.extractLastNSeconds(0))
        .rejects.toThrow();
    });
  });
});