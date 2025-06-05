import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock VideoAnalyzer and related components
const mockAnalysisResult = {
  videoPath: '/test/extract_1234_30s.mp4',
  duration: 30,
  analysisType: 'full_analysis',
  timestamp: '2025-01-01T00:00:00.000Z',
  results: {
    summary: 'Test desktop analysis',
    errors: [],
    warnings: [],
    userActions: ['User clicked button'],
    keyFrames: [{ timestamp: 0, description: 'Initial frame' }],
    enhancedDetails: {
      context: {
        appName: 'TestApp',
        windowTitle: 'Test Window',
        isDarkTheme: false,
        primaryColors: []
      },
      regions: [],
      clickContexts: [],
      llmAnalysis: {
        provider: 'OpenAI',
        description: 'Test analysis description',
        confidence: 0.95,
        gifFiles: {
          allSegments: [
            '/test/extract_1234_30s_part01.gif',
            '/test/extract_1234_30s_part02.gif',
            '/test/extract_1234_30s_part03.gif'
          ],
          uploadedFile: '/test/extract_1234_30s_part01.gif',
          totalSegments: 3,
          segmentDuration: 10
        }
      }
    }
  }
};

jest.unstable_mockModule('../../src/analysis/index.js', () => ({
  VideoAnalyzer: jest.fn(() => ({
    analyze: jest.fn().mockResolvedValue(mockAnalysisResult)
  }))
}));

// Mock DesktopCapture
const mockDesktopCapture = {
  getStatus: jest.fn().mockReturnValue({
    isRecording: true,
    bufferStatus: {
      isActive: true,
      totalSegments: 3,
      hotSegments: 1,
      coldSegments: 2,
      inMemorySegments: 0,
      oldestSegmentTime: '2025-01-01T00:00:00.000Z',
      newestSegmentTime: '2025-01-01T00:01:00.000Z',
      totalSizeBytes: 1024 * 1024 * 50,
      hotTierSizeMB: 10,
      bufferDurationSeconds: 60,
      memoryStats: {
        heapUsed: 1024 * 1024 * 10,
        heapTotal: 1024 * 1024 * 20,
        external: 1024 * 100,
        rss: 1024 * 1024 * 25,
        totalMB: 20,
        heapUsedMB: 10,
        heapPercent: 50,
        percentUsed: 1.0
      }
    }
  }),
  extractLastNSeconds: jest.fn().mockResolvedValue('/test/extract_1234_30s.mp4')
};

jest.unstable_mockModule('../../src/capture/desktopCapture.js', () => ({
  DesktopCapture: jest.fn(() => mockDesktopCapture)
}));

// Mock fs.stat for video file
jest.unstable_mockModule('fs', () => ({
  promises: {
    stat: jest.fn().mockResolvedValue({
      size: 1024 * 1024 * 5, // 5MB
      birthtime: new Date('2025-01-01T00:00:00.000Z')
    })
  }
}));

// Import the server after mocks
const { MCPDesktopDVRServer } = await import('../../src/server.js');

describe('MCP Server Response Format', () => {
  let server: any;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `response-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    server = new MCPDesktopDVRServer();
    
    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('analyze-desktop-now Response Format', () => {
    it('should return properly structured response with GIF metadata when OpenAI is used', async () => {
      const response = await server.handleToolCall('analyze-desktop-now', {
        duration_seconds: 30,
        analysis_type: 'full_analysis'
      });

      expect(response).toHaveProperty('content');
      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toHaveProperty('type', 'text');
      expect(response.content[0]).toHaveProperty('text');

      const responseData = JSON.parse(response.content[0].text);

      // Verify top-level structure
      expect(responseData).toHaveProperty('status', 'success');
      expect(responseData).toHaveProperty('message');
      expect(responseData).toHaveProperty('videoPath');
      expect(responseData).toHaveProperty('duration', 30);
      expect(responseData).toHaveProperty('analysisType', 'full_analysis');
      expect(responseData).toHaveProperty('timestamp');
      expect(responseData).toHaveProperty('videoInfo');
      expect(responseData).toHaveProperty('analysisDetails');
      expect(responseData).toHaveProperty('apiCall');
      expect(responseData).toHaveProperty('results');
      expect(responseData).toHaveProperty('bufferStatus');
    });

    it('should include GIF files information in apiCall section', async () => {
      const response = await server.handleToolCall('analyze-desktop-now', {
        duration_seconds: 30,
        analysis_type: 'full_analysis'
      });

      const responseData = JSON.parse(response.content[0].text);

      // Verify apiCall section
      expect(responseData.apiCall).toHaveProperty('provider', 'OpenAI');
      expect(responseData.apiCall).toHaveProperty('model', 'gpt-4o');
      expect(responseData.apiCall).toHaveProperty('inputFormat', 'GIF segments (first segment uploaded)');
      expect(responseData.apiCall).toHaveProperty('gifFiles');

      // Verify GIF files structure
      const gifFiles = responseData.apiCall.gifFiles;
      expect(gifFiles).toHaveProperty('allSegments');
      expect(gifFiles).toHaveProperty('uploadedFile');
      expect(gifFiles).toHaveProperty('totalSegments', 3);
      expect(gifFiles).toHaveProperty('segmentDuration', 10);

      // Verify arrays
      expect(Array.isArray(gifFiles.allSegments)).toBe(true);
      expect(gifFiles.allSegments).toHaveLength(3);
      expect(typeof gifFiles.uploadedFile).toBe('string');
    });

    it('should include correct GIF file paths and naming convention', async () => {
      const response = await server.handleToolCall('analyze-desktop-now', {
        duration_seconds: 30,
        analysis_type: 'full_analysis'
      });

      const responseData = JSON.parse(response.content[0].text);
      const gifFiles = responseData.apiCall.gifFiles;

      // Verify naming convention
      expect(gifFiles.allSegments[0]).toMatch(/extract_\d+_30s_part01\.gif$/);
      expect(gifFiles.allSegments[1]).toMatch(/extract_\d+_30s_part02\.gif$/);
      expect(gifFiles.allSegments[2]).toMatch(/extract_\d+_30s_part03\.gif$/);

      // Verify uploaded file is the first segment
      expect(gifFiles.uploadedFile).toBe(gifFiles.allSegments[0]);
      expect(gifFiles.uploadedFile).toMatch(/part01\.gif$/);
    });

    it('should handle different video durations correctly', async () => {
      const testCases = [
        { duration: 10, expectedSegments: 1 },
        { duration: 15, expectedSegments: 2 },
        { duration: 25, expectedSegments: 3 },
        { duration: 35, expectedSegments: 4 }
      ];

      for (const testCase of testCases) {
        // Update mock to return appropriate number of segments
        const updatedMockResult = {
          ...mockAnalysisResult,
          duration: testCase.duration,
          results: {
            ...mockAnalysisResult.results,
            enhancedDetails: {
              ...mockAnalysisResult.results.enhancedDetails,
              llmAnalysis: {
                ...mockAnalysisResult.results.enhancedDetails?.llmAnalysis,
                gifFiles: {
                  allSegments: Array.from({ length: testCase.expectedSegments }, (_, i) => 
                    `/test/extract_1234_${testCase.duration}s_part${String(i + 1).padStart(2, '0')}.gif`
                  ),
                  uploadedFile: `/test/extract_1234_${testCase.duration}s_part01.gif`,
                  totalSegments: testCase.expectedSegments,
                  segmentDuration: 10
                }
              }
            }
          }
        };

        const mockAnalyzer = await import('../../src/analysis/index.js');
        (mockAnalyzer.VideoAnalyzer as any).mockImplementation(() => ({
          analyze: jest.fn().mockResolvedValue(updatedMockResult)
        }));

        const response = await server.handleToolCall('analyze-desktop-now', {
          duration_seconds: testCase.duration,
          analysis_type: 'full_analysis'
        });

        const responseData = JSON.parse(response.content[0].text);
        const gifFiles = responseData.apiCall.gifFiles;

        expect(gifFiles.totalSegments).toBe(testCase.expectedSegments);
        expect(gifFiles.allSegments).toHaveLength(testCase.expectedSegments);
        expect(gifFiles.segmentDuration).toBe(10);
      }
    });

    it('should not include gifFiles when OpenAI is not used (fallback analysis)', async () => {
      // Mock fallback analysis (no LLM analysis)
      const fallbackMockResult = {
        ...mockAnalysisResult,
        results: {
          ...mockAnalysisResult.results,
          enhancedDetails: undefined // No LLM analysis
        }
      };

      const mockAnalyzer = await import('../../src/analysis/index.js');
      (mockAnalyzer.VideoAnalyzer as any).mockImplementation(() => ({
        analyze: jest.fn().mockResolvedValue(fallbackMockResult)
      }));

      const response = await server.handleToolCall('analyze-desktop-now', {
        duration_seconds: 30,
        analysis_type: 'full_analysis'
      });

      const responseData = JSON.parse(response.content[0].text);

      // Should not have apiCall section when no LLM analysis
      expect(responseData.apiCall).toBeNull();
      expect(responseData.analysisDetails.method).toBe('OCR Fallback');
    });

    it('should maintain backward compatibility with existing response structure', async () => {
      const response = await server.handleToolCall('analyze-desktop-now', {
        duration_seconds: 30,
        analysis_type: 'full_analysis'
      });

      const responseData = JSON.parse(response.content[0].text);

      // Verify all existing fields are still present
      expect(responseData).toHaveProperty('status');
      expect(responseData).toHaveProperty('message');
      expect(responseData).toHaveProperty('videoPath');
      expect(responseData).toHaveProperty('duration');
      expect(responseData).toHaveProperty('analysisType');
      expect(responseData).toHaveProperty('timestamp');
      
      expect(responseData.videoInfo).toHaveProperty('filePath');
      expect(responseData.videoInfo).toHaveProperty('sizeBytes');
      expect(responseData.videoInfo).toHaveProperty('sizeMB');
      expect(responseData.videoInfo).toHaveProperty('format');
      expect(responseData.videoInfo).toHaveProperty('createdAt');

      expect(responseData.results).toHaveProperty('summary');
      expect(responseData.results).toHaveProperty('errors');
      expect(responseData.results).toHaveProperty('warnings');
      expect(responseData.results).toHaveProperty('userActions');
      expect(responseData.results).toHaveProperty('keyFrames');

      expect(responseData.bufferStatus).toHaveProperty('isActive');
      expect(responseData.bufferStatus).toHaveProperty('totalSegments');
      expect(responseData.bufferStatus).toHaveProperty('memoryStats');
    });
  });

  describe('Response Validation', () => {
    it('should return valid JSON that can be parsed', async () => {
      const response = await server.handleToolCall('analyze-desktop-now', {
        duration_seconds: 30,
        analysis_type: 'full_analysis'
      });

      expect(() => {
        JSON.parse(response.content[0].text);
      }).not.toThrow();
    });

    it('should include proper error handling information when available', async () => {
      // Mock analysis with error
      const errorMockResult = {
        ...mockAnalysisResult,
        results: {
          ...mockAnalysisResult.results,
          llmError: {
            provider: 'OpenAI',
            error: 'API quota exceeded',
            timestamp: '2025-01-01T00:00:00.000Z'
          },
          enhancedDetails: undefined
        }
      };

      const mockAnalyzer = await import('../../src/analysis/index.js');
      (mockAnalyzer.VideoAnalyzer as any).mockImplementation(() => ({
        analyze: jest.fn().mockResolvedValue(errorMockResult)
      }));

      const response = await server.handleToolCall('analyze-desktop-now', {
        duration_seconds: 30,
        analysis_type: 'full_analysis'
      });

      const responseData = JSON.parse(response.content[0].text);

      expect(responseData.analysisDetails).toHaveProperty('fallbackReason');
      expect(responseData.analysisDetails.fallbackReason).toHaveProperty('error', 'API quota exceeded');
      expect(responseData.analysisDetails.fallbackReason).toHaveProperty('provider', 'OpenAI');
    });
  });
});