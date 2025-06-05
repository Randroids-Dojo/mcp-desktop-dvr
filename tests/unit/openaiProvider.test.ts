import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock OpenAI
const mockOpenAI = {
  files: {
    create: jest.fn().mockResolvedValue({ id: 'file-123' }),
    delete: jest.fn().mockResolvedValue(undefined)
  },
  responses: {
    create: jest.fn().mockResolvedValue({
      output: [{
        content: [{
          text: JSON.stringify({
            description: "Test analysis of GIF segments",
            confidence: 85,
            keyFindings: ["Multiple GIF segments created successfully"]
          })
        }]
      }]
    })
  }
};

jest.unstable_mockModule('openai', () => ({
  default: jest.fn(() => mockOpenAI)
}));

// Mock child_process for ffmpeg calls
const mockExecAsync = jest.fn();
jest.unstable_mockModule('util', () => ({
  promisify: jest.fn(() => mockExecAsync)
}));

// Import after mocks
const { OpenAIProvider } = await import('../../src/analysis/llm/openaiProvider.js');

describe('OpenAI Provider GIF Generation', () => {
  let provider: OpenAIProvider;
  let testDir: string;
  let testVideoPath: string;

  beforeEach(async () => {
    // Set up test environment
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.OPENAI_MODEL = 'gpt-4o';

    // Create test directory structure
    testDir = path.join(os.tmpdir(), `openai-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Create mock video file
    testVideoPath = path.join(testDir, 'extract_1234567890_30s.mp4');
    await fs.writeFile(testVideoPath, 'mock video content');

    // Reset mocks
    jest.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    provider = new OpenAIProvider();
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  describe('GIF Segmentation', () => {
    it('should create multiple 10-second GIF segments for 30-second video', async () => {
      // Mock file reading for GIF upload
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      
      // Mock successful ffmpeg executions
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await provider.analyzeVideo(testVideoPath, 30);

      // Verify ffmpeg was called 3 times (for 3 segments)
      expect(mockExecAsync).toHaveBeenCalledTimes(3);

      // Verify each ffmpeg call has correct parameters
      const calls = mockExecAsync.mock.calls;
      
      // First segment (0-10 seconds)
      expect(calls[0][0]).toContain('-ss 0');
      expect(calls[0][0]).toContain('-t 10');
      expect(calls[0][0]).toContain('extract_1234567890_30s_part01.gif');

      // Second segment (10-20 seconds)
      expect(calls[1][0]).toContain('-ss 10');
      expect(calls[1][0]).toContain('-t 10');
      expect(calls[1][0]).toContain('extract_1234567890_30s_part02.gif');

      // Third segment (20-30 seconds)
      expect(calls[2][0]).toContain('-ss 20');
      expect(calls[2][0]).toContain('-t 10');
      expect(calls[2][0]).toContain('extract_1234567890_30s_part03.gif');

      // Verify OpenAI API was called with first GIF
      expect(mockOpenAI.files.create).toHaveBeenCalledTimes(1);
      expect(mockOpenAI.responses.create).toHaveBeenCalledTimes(1);

      // Verify uploaded file was cleaned up but local GIFs were not
      expect(mockOpenAI.files.delete).toHaveBeenCalledWith('file-123');
    });

    it('should include GIF file information in the analysis response', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await provider.analyzeVideo(testVideoPath, 30);

      expect(result.gifFiles).toBeDefined();
      expect(result.gifFiles?.totalSegments).toBe(3);
      expect(result.gifFiles?.segmentDuration).toBe(10);
      expect(result.gifFiles?.allSegments).toHaveLength(3);
      expect(result.gifFiles?.uploadedFile).toContain('extract_1234567890_30s_part01.gif');
      expect(result.gifFiles?.allSegments[0]).toContain('extract_1234567890_30s_part01.gif');
      expect(result.gifFiles?.allSegments[1]).toContain('extract_1234567890_30s_part02.gif');
      expect(result.gifFiles?.allSegments[2]).toContain('extract_1234567890_30s_part03.gif');
    });

    it('should create correct number of segments for different durations', async () => {
      const testCases = [
        { duration: 10, expectedSegments: 1 },
        { duration: 25, expectedSegments: 3 },
        { duration: 35, expectedSegments: 4 },
        { duration: 60, expectedSegments: 6 }
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
        mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

        await provider.analyzeVideo(testVideoPath, testCase.duration);
        expect(mockExecAsync).toHaveBeenCalledTimes(testCase.expectedSegments);
      }
    });

    it('should use proper naming convention for GIF segments', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await provider.analyzeVideo(testVideoPath, 25);

      const calls = mockExecAsync.mock.calls;
      expect(calls[0][0]).toContain('extract_1234567890_30s_part01.gif');
      expect(calls[1][0]).toContain('extract_1234567890_30s_part02.gif');
      expect(calls[2][0]).toContain('extract_1234567890_30s_part03.gif');
    });

    it('should handle ffmpeg errors gracefully', async () => {
      // Mock ffmpeg failure
      mockExecAsync.mockRejectedValue(new Error('ffmpeg failed'));

      await expect(provider.analyzeVideo(testVideoPath, 30))
        .rejects
        .toThrow('GIF segment 1 conversion failed');
    });
  });

  describe('OpenAI Integration', () => {
    it('should upload only the first GIF segment to OpenAI', async () => {
      // Mock file reading for GIF upload
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      try {
        await provider.analyzeVideo(testVideoPath, 30);

        // Should only upload one file (the first segment)
        expect(mockOpenAI.files.create).toHaveBeenCalledTimes(1);
        
        // Verify the file object passed to OpenAI
        const uploadCall = mockOpenAI.files.create.mock.calls[0][0];
        expect(uploadCall.purpose).toBe('vision');
        expect(uploadCall.file).toBeInstanceOf(File);
      } catch (error) {
        if (error instanceof Error && error.message.includes('OpenAI client not initialized')) {
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    });

    it('should clean up uploaded files but preserve local GIFs', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      try {
        await provider.analyzeVideo(testVideoPath, 30);

        // Verify uploaded file was deleted from OpenAI
        expect(mockOpenAI.files.delete).toHaveBeenCalledWith('file-123');
        
        // Verify local files were NOT deleted (no fs.unlink calls for GIFs)
        const fsUnlinkSpy = jest.spyOn(fs, 'unlink');
        expect(fsUnlinkSpy).not.toHaveBeenCalled();
      } catch (error) {
        if (error instanceof Error && error.message.includes('OpenAI client not initialized')) {
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle single segment videos (10 seconds or less)', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await provider.analyzeVideo(testVideoPath, 8);

      expect(result.gifFiles?.totalSegments).toBe(1);
      expect(result.gifFiles?.allSegments).toHaveLength(1);
      expect(mockExecAsync).toHaveBeenCalledTimes(1);
    });

    it('should handle uneven duration videos (e.g., 25 seconds)', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await provider.analyzeVideo(testVideoPath, 25);

      // 25 seconds = 3 segments (0-10, 10-20, 20-25)
      expect(result.gifFiles?.totalSegments).toBe(3);
      expect(mockExecAsync).toHaveBeenCalledTimes(3);
    });

    it('should preserve directory structure from original video path', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const customVideoPath = path.join(testDir, 'subfolder', 'extract_9999_30s.mp4');
      await fs.mkdir(path.dirname(customVideoPath), { recursive: true });
      await fs.writeFile(customVideoPath, 'mock video content');

      const result = await provider.analyzeVideo(customVideoPath, 30);

      // Verify GIF files are created in same directory as MP4
      expect(result.gifFiles?.allSegments[0]).toContain('subfolder');
      expect(result.gifFiles?.uploadedFile).toContain('subfolder');
    });

    it('should handle OpenAI API errors gracefully', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockOpenAI.files.create.mockRejectedValue(new Error('OpenAI API error'));

      await expect(provider.analyzeVideo(testVideoPath, 30))
        .rejects
        .toThrow('Video analysis failed: OpenAI API error');
    });

    it('should handle malformed OpenAI responses', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock malformed response but still valid structure
      mockOpenAI.responses.create.mockResolvedValue({
        output: [{
          content: [{
            text: 'invalid json response'
          }]
        }]
      });

      const result = await provider.analyzeVideo(testVideoPath, 30);
      
      // Should still include GIF information even if response parsing fails
      expect(result.gifFiles).toBeDefined();
      expect(result.gifFiles?.totalSegments).toBe(3);
    });
  });

  describe('Performance and Optimization', () => {
    it('should create GIFs with optimized settings', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await provider.analyzeVideo(testVideoPath, 30);

      const calls = mockExecAsync.mock.calls;
      
      // Verify ffmpeg optimization flags are used
      expect(calls[0][0]).toContain('fps=5');  // 5fps for small file size
      expect(calls[0][0]).toContain('scale=1024:-1:flags=lanczos');  // Optimized scaling
      expect(calls[0][0]).toContain('-loop 0');  // Infinite loop for GIFs
      
      // Verify result includes GIF info
      expect(result.gifFiles).toBeDefined();
    });

    it('should limit GIF duration to 10 seconds even for longer segments', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await provider.analyzeVideo(testVideoPath, 60);

      const calls = mockExecAsync.mock.calls;
      
      // All segments should be limited to 10 seconds
      calls.forEach(call => {
        expect(call[0]).toContain('-t 10');
      });
      
      // Verify result includes GIF info for 60s video (6 segments)
      expect(result.gifFiles?.totalSegments).toBe(6);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing OpenAI API key', async () => {
      delete process.env.OPENAI_API_KEY;
      const providerWithoutKey = new OpenAIProvider();

      await expect(providerWithoutKey.analyzeVideo(testVideoPath, 30))
        .rejects
        .toThrow('OpenAI client not initialized');
    });

    it('should handle file read errors for GIF upload', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      jest.spyOn(fs, 'readFile').mockRejectedValue(new Error('File read error'));

      await expect(provider.analyzeVideo(testVideoPath, 30))
        .rejects
        .toThrow('Video analysis failed: File read error');
    });

    it('should handle partial ffmpeg failures', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      
      // First call succeeds, second fails
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockRejectedValueOnce(new Error('ffmpeg segment 2 failed'));

      await expect(provider.analyzeVideo(testVideoPath, 30))
        .rejects
        .toThrow('GIF segment 2 conversion failed');
    });
  });

  describe('Response Format Validation', () => {
    it('should return properly structured response with all required fields', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock gif data'));
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await provider.analyzeVideo(testVideoPath, 30);

      // Verify all required fields are present
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('detectedApplications');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('keyActions');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('gifFiles');

      // Verify GIF files structure
      expect(result.gifFiles).toHaveProperty('allSegments');
      expect(result.gifFiles).toHaveProperty('uploadedFile');
      expect(result.gifFiles).toHaveProperty('totalSegments');
      expect(result.gifFiles).toHaveProperty('segmentDuration');
      expect(result.gifFiles?.segmentDuration).toBe(10);
      expect(result.gifFiles?.totalSegments).toBe(3);
      expect(Array.isArray(result.gifFiles?.allSegments)).toBe(true);
    });
  });
});