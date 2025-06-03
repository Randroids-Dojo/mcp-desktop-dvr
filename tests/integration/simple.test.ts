import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import os from 'os';

// Mock aperture to avoid actual screen recording
jest.unstable_mockModule('aperture', () => ({
  recorder: {
    startRecording: jest.fn().mockResolvedValue('/tmp/mock-recording.mp4'),
    stopRecording: jest.fn().mockResolvedValue('/tmp/mock-recording.mp4'),
  }
}));

// Mock tesseract
jest.unstable_mockModule('tesseract.js', () => ({
  createWorker: jest.fn(() => ({
    loadLanguage: jest.fn().mockResolvedValue(undefined),
    initialize: jest.fn().mockResolvedValue(undefined),
    recognize: jest.fn().mockResolvedValue({
      data: {
        text: 'Mock text\nError: Test error',
        words: []
      }
    }),
    terminate: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Mock sharp
jest.unstable_mockModule('sharp', () => ({
  default: jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 1920, height: 1080 }),
    greyscale: jest.fn().mockReturnThis(),
    negate: jest.fn().mockReturnThis(),
    threshold: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock image data'))
  }))
}));

// Mock child_process
jest.unstable_mockModule('child_process', () => ({
  execSync: jest.fn().mockReturnValue('ffmpeg version 4.4.0'),
  exec: jest.fn(),
  spawn: jest.fn().mockReturnValue({
    on: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    kill: jest.fn()
  })
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

// Import after mocks
const { DesktopCapture } = await import('../../src/capture/desktopCapture.js');
const { VideoAnalyzer } = await import('../../src/analysis/index.js');
const { promises: fs } = await import('fs');

describe('Simple Integration Test', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `simple-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should perform basic capture operations', async () => {
    const capture = new DesktopCapture();
    
    // Start capture
    await capture.startCapture({ fps: 30, quality: 70 });
    
    const status = capture.getStatus();
    expect(status.isRecording).toBe(true);
    expect(status.fps).toBe(30);
    expect(status.quality).toBe(70);
    
    // Stop capture
    const outputPath = await capture.stopCapture();
    expect(outputPath).toBeTruthy();
    
    // Cleanup
    await capture.shutdown();
  });

  it('should extract and analyze video', async () => {
    const capture = new DesktopCapture();
    const analyzer = new VideoAnalyzer();
    
    // Mock the extraction process
    jest.spyOn(capture as any, 'extractLastNSeconds').mockResolvedValue('/tmp/mock-extract.mp4');
    
    // Mock the file system operations
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock video data'));
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);
    
    // Start capture
    await capture.startCapture({ fps: 30, quality: 70 });
    
    // Simulate some recording time
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Extract and analyze
    const videoPath = await capture.extractLastNSeconds(10);
    expect(videoPath).toBeTruthy();
    
    // Mock analysis
    const mockAnalysis = {
      errors: ['Error: Test error'],
      warnings: [],
      appContext: 'Test Application',
      currentFile: 'test.js',
      codeSnippets: [],
      clickAnalysis: [],
      summary: 'Mock analysis'
    };
    
    jest.spyOn(analyzer, 'analyzeFocusedElements').mockResolvedValue(mockAnalysis);
    
    const analysis = await analyzer.analyzeFocusedElements(videoPath);
    expect(analysis.errors).toContain('Error: Test error');
    expect(analysis.appContext).toBe('Test Application');
    
    // Cleanup
    await capture.shutdown();
  });

  it('should handle capture lifecycle correctly', async () => {
    const capture = new DesktopCapture();
    
    // Initial status
    let status = capture.getStatus();
    expect(status.isRecording).toBe(false);
    
    // Start capture
    await capture.startCapture({});
    status = capture.getStatus();
    expect(status.isRecording).toBe(true);
    
    // Cannot start another capture while recording
    await expect(capture.startCapture({})).rejects.toThrow('Capture already in progress');
    
    // Stop capture
    await capture.stopCapture();
    status = capture.getStatus();
    expect(status.isRecording).toBe(false);
    
    // Cannot stop when not recording
    await expect(capture.stopCapture()).rejects.toThrow('No active recording');
    
    // Cleanup
    await capture.shutdown();
  });
});