import { jest } from '@jest/globals';
import { DesktopCapture } from '../../src/capture/desktopCapture.js';
import { VideoAnalyzer } from '../../src/analysis/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// Mock aperture to avoid actual screen recording
jest.mock('aperture', () => ({
  recorder: jest.fn().mockReturnValue({
    startRecording: jest.fn().mockResolvedValue('/tmp/mock-recording.mp4'),
    stopRecording: jest.fn().mockResolvedValue('/tmp/mock-recording.mp4'),
  })
}));

// Mock tesseract and sharp
jest.mock('tesseract.js', () => ({
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

jest.mock('sharp', () => {
  return jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 1920, height: 1080 }),
    greyscale: jest.fn().mockReturnThis(),
    negate: jest.fn().mockReturnThis(),
    threshold: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock image data'))
  }));
});

describe('Simple Integration Test', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `simple-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should complete a basic capture and analysis flow', async () => {
    const desktopCapture = new DesktopCapture();
    const analyzer = new VideoAnalyzer();
    
    // Initialize the buffer
    await desktopCapture['circularBuffer'].initialize();
    
    // Create a test video
    const testVideoPath = path.join(testDir, 'test-video.mp4');
    const command = [
      'ffmpeg',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=2:size=1920x1080:rate=30',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-y',
      testVideoPath
    ].join(' ');
    
    execSync(command, { encoding: 'utf8' });
    
    // Add video to buffer
    await desktopCapture['circularBuffer'].addVideoChunk(testVideoPath, 2);
    
    // Extract video
    const extractedPath = await desktopCapture['circularBuffer'].extractLastNSeconds(2);
    expect(extractedPath).toBeDefined();
    
    // Analyze
    const result = await analyzer.analyze(extractedPath, { duration: 2 });
    expect(result).toBeDefined();
    expect(result.duration).toBe(2);
    expect(result.results).toBeDefined();
    // The analysis completes successfully even if no errors are detected
    
    // Cleanup
    await fs.unlink(extractedPath);
  });
});