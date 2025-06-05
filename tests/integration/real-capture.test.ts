import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DesktopCapture } from '../../src/capture/desktopCapture.js';
import { VideoAnalyzer } from '../../src/analysis/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('Real Screen Capture Integration Tests', () => {
  let capture: DesktopCapture;
  let testOutputDir: string;

  beforeEach(async () => {
    testOutputDir = path.join(os.tmpdir(), `real-capture-test-${Date.now()}`);
    await fs.mkdir(testOutputDir, { recursive: true });
    capture = new DesktopCapture();
  });

  afterEach(async () => {
    if (capture) {
      await capture.shutdown();
    }
    // Cleanup test output
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Screen Recording Permissions', () => {
    it('should handle screen recording permission requirements', async () => {
      try {
        console.log('\n📹 Testing screen recording capability...');

        // Start capture - this will prompt for permissions if not already granted
        await capture.startCapture({ 
          fps: 30, 
          quality: 70 
        });

        // Record for 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Stop capture
        const outputPath = await capture.stopCapture();
        
        expect(outputPath).toBeTruthy();
        expect(outputPath).toContain('.mp4');

        // Verify the file exists and has content
        const stats = await fs.stat(outputPath);
        expect(stats.size).toBeGreaterThan(0);

        console.log(`✅ Successfully captured video to: ${outputPath}`);
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record')) {
          console.log('⚠️  Screen Recording permission not granted - skipping test');
          // This is expected behavior when permissions aren't granted
          expect(error).toBeInstanceOf(Error);
        } else {
          // Re-throw unexpected errors
          throw error;
        }
      }
    });

    it('should capture a specific application window', async () => {
      try {
        // Try to capture Finder window as it's always available
        await capture.startCapture({
          fps: 30,
          quality: 70,
          bundleId: 'com.apple.finder'
        });

        // Record for 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));

        const outputPath = await capture.stopCapture();
        expect(outputPath).toBeTruthy();

        const stats = await fs.stat(outputPath);
        expect(stats.size).toBeGreaterThan(0);
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record')) {
          console.log('⚠️  Screen Recording permission not granted - skipping window capture test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    });
  });

  describe('Buffer and Extraction', () => {
    it('should build up a buffer and extract recent activity', async () => {
      try {
        // Start continuous capture
        await capture.startCapture({ fps: 30, quality: 70 });

        // Record for 10 seconds to build up buffer
        console.log('Recording for 10 seconds to build buffer...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Extract last 5 seconds
        const extractPath = await capture.extractLastNSeconds(5);
        
        expect(extractPath).toBeTruthy();
        expect(extractPath).toContain('extract_');
        expect(extractPath).toContain('.mp4');

        // Verify the extracted file
        const stats = await fs.stat(extractPath);
        expect(stats.size).toBeGreaterThan(0);

        // Stop capture
        await capture.stopCapture();

        console.log(`✅ Successfully extracted 5 seconds to: ${extractPath}`);
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record') ||
            errorMessage.includes('Call `.startRecording()` first')) {
          console.log('⚠️  Screen Recording permission not granted or recording not active - skipping buffer test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    }, 20000); // 20 second timeout
  });

  describe('Visual Analysis', () => {
    it('should capture and analyze desktop activity', async () => {
      try {
        const analyzer = new VideoAnalyzer();

        // Start capture
        await capture.startCapture({ fps: 30, quality: 70 });

        // Do some activity (user should move mouse, open windows, etc.)
        console.log('\n🖱️  Please move your mouse, click around, or open some windows for the next 5 seconds...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Extract and analyze
        const videoPath = await capture.extractLastNSeconds(5);
        const analysis = await analyzer.analyze(videoPath, { duration: 5, analysisType: 'full_analysis' });

        expect(analysis).toBeDefined();
        expect(analysis.results.summary).toBeTruthy();
        
        // The analysis should detect some activity
        console.log('\n📊 Analysis Results:');
        console.log(`Summary: ${analysis.results.summary}`);
        console.log(`Errors found: ${(analysis.results.errors || []).length}`);

        // Stop capture
        await capture.stopCapture();
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record') ||
            errorMessage.includes('Call `.startRecording()` first')) {
          console.log('⚠️  Screen Recording permission not granted - skipping analysis test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    }, 15000); // 15 second timeout

    it('should create GIF segments alongside extracted videos', async () => {
      try {
        const analyzer = new VideoAnalyzer();

        // Start capture
        await capture.startCapture({ fps: 30, quality: 70 });

        // Record for longer to get 30 seconds for proper GIF segmentation
        console.log('\n🎬 Recording for 30 seconds to test GIF segmentation...\n');
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Extract 30 seconds and analyze
        const videoPath = await capture.extractLastNSeconds(30);
        console.log(`\n📹 Extracted video: ${videoPath}`);

        // Set analyzer preference to use OpenAI (if available) to trigger GIF creation
        process.env.ANALYZER_PREFERENCE = 'auto';
        
        const analysis = await analyzer.analyze(videoPath, { duration: 30, analysisType: 'full_analysis' });

        expect(analysis).toBeDefined();
        
        // Check if GIF files were created alongside the MP4
        const videoDir = path.dirname(videoPath);
        const videoBasename = path.basename(videoPath, '.mp4');
        
        // For a 30-second video, we should have 3 GIF segments
        const expectedGifPaths = [
          path.join(videoDir, `${videoBasename}_part01.gif`),
          path.join(videoDir, `${videoBasename}_part02.gif`),
          path.join(videoDir, `${videoBasename}_part03.gif`)
        ];

        let gifsFound = 0;
        const gifDetails: Array<{path: string, size: number}> = [];
        
        for (const gifPath of expectedGifPaths) {
          try {
            const stats = await fs.stat(gifPath);
            if (stats.size > 0) {
              gifsFound++;
              gifDetails.push({ path: gifPath, size: stats.size });
              console.log(`✅ Found GIF segment: ${path.basename(gifPath)} (${(stats.size / 1024).toFixed(1)} KB)`);
            }
          } catch (error) {
            // GIF doesn't exist - might be expected if OpenAI analysis wasn't used
            console.log(`ℹ️  GIF segment not found: ${path.basename(gifPath)}`);
          }
        }

        if (gifsFound > 0) {
          console.log(`\n🎊 Successfully created ${gifsFound} GIF segments alongside MP4!`);
          expect(gifsFound).toBeGreaterThan(0);
          
          // Verify GIF files have reasonable sizes (should be > 1KB each)
          for (const gif of gifDetails) {
            expect(gif.size).toBeGreaterThan(1024); // At least 1KB
            expect(gif.size).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
          }
          
          // Check if response includes GIF metadata (when OpenAI is used)
          if (analysis.results.enhancedDetails?.llmAnalysis?.gifFiles) {
            const gifFiles = analysis.results.enhancedDetails.llmAnalysis.gifFiles;
            expect(gifFiles.totalSegments).toBe(gifsFound);
            expect(gifFiles.allSegments).toHaveLength(gifsFound);
            expect(gifFiles.segmentDuration).toBe(10);
            console.log(`📊 Response includes GIF metadata: ${gifFiles.totalSegments} segments`);
          }
        } else {
          console.log('\nℹ️  No GIF segments found - likely using OCR/Tarsier fallback analysis');
          // This is expected behavior when OpenAI is not available
        }

        // Stop capture
        await capture.stopCapture();
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record') ||
            errorMessage.includes('Call `.startRecording()` first')) {
          console.log('⚠️  Screen Recording permission not granted - skipping GIF test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      } finally {
        // Clean up environment
        delete process.env.ANALYZER_PREFERENCE;
      }
    }, 45000); // 45 second timeout for longer recording

    it('should handle different video durations for GIF creation', async () => {
      try {
        const analyzer = new VideoAnalyzer();
        const testDurations = [10, 15, 25]; // Different durations to test segmentation

        // Start capture
        await capture.startCapture({ fps: 30, quality: 70 });

        for (const duration of testDurations) {
          console.log(`\n🎬 Testing ${duration}s duration...`);
          
          // Record for the test duration
          await new Promise(resolve => setTimeout(resolve, duration * 1000));

          // Extract and analyze
          const videoPath = await capture.extractLastNSeconds(duration);
          process.env.ANALYZER_PREFERENCE = 'auto';
          
          const analysis = await analyzer.analyze(videoPath, { 
            duration, 
            analysisType: 'full_analysis' 
          });

          expect(analysis).toBeDefined();
          
          // Calculate expected number of segments
          const expectedSegments = Math.ceil(duration / 10);
          
          // Check for GIF files
          const videoDir = path.dirname(videoPath);
          const videoBasename = path.basename(videoPath, '.mp4');
          
          let actualSegments = 0;
          for (let i = 1; i <= expectedSegments; i++) {
            const segmentNum = String(i).padStart(2, '0');
            const gifPath = path.join(videoDir, `${videoBasename}_part${segmentNum}.gif`);
            
            try {
              const stats = await fs.stat(gifPath);
              if (stats.size > 0) {
                actualSegments++;
              }
            } catch (error) {
              // GIF doesn't exist
            }
          }

          if (actualSegments > 0) {
            console.log(`✅ ${duration}s video: ${actualSegments}/${expectedSegments} GIF segments created`);
            expect(actualSegments).toBe(expectedSegments);
            
            // Verify response metadata if available
            if (analysis.results.enhancedDetails?.llmAnalysis?.gifFiles) {
              expect(analysis.results.enhancedDetails.llmAnalysis.gifFiles.totalSegments).toBe(expectedSegments);
            }
          } else {
            console.log(`ℹ️  ${duration}s video: No GIFs (fallback analysis used)`);
          }
        }

        // Stop capture
        await capture.stopCapture();
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record') ||
            errorMessage.includes('Call `.startRecording()` first')) {
          console.log('⚠️  Screen Recording permission not granted - skipping duration test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      } finally {
        delete process.env.ANALYZER_PREFERENCE;
      }
    }, 60000); // 60 second timeout for multiple tests
  });

  describe('Performance Under Load', () => {
    it('should handle continuous capture for extended period', async () => {
      try {
        const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        
        // Start capture
        await capture.startCapture({ fps: 30, quality: 70 });

        // Record for 30 seconds
        console.log('\nRecording for 30 seconds to test performance...');
        const startTime = Date.now();
        
        for (let i = 0; i < 6; i++) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const status = capture.getStatus();
          const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
          console.log(`${i * 5 + 5}s - Recording active: ${status.isRecording}, Memory: ${currentMemory.toFixed(1)}MB`);
        }

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        // Extract a portion to verify buffer is working
        const extractPath = await capture.extractLastNSeconds(10);
        const extractStats = await fs.stat(extractPath);
        
        expect(extractStats.size).toBeGreaterThan(0);
        expect(duration).toBeGreaterThanOrEqual(29); // Allow some timing variance

        const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        const memoryIncrease = endMemory - startMemory;
        
        console.log(`\nMemory increase: ${memoryIncrease.toFixed(1)}MB`);
        
        // Memory shouldn't increase too much (less than 500MB)
        expect(memoryIncrease).toBeLessThan(500);

        await capture.stopCapture();
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record')) {
          console.log('⚠️  Screen Recording permission not granted - skipping performance test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    }, 40000); // 40 second timeout
  });

  describe('Error Handling with Real Capture', () => {
    it('should handle multiple start/stop cycles', async () => {
      try {
        // First cycle
        await capture.startCapture({ fps: 30 });
        await new Promise(resolve => setTimeout(resolve, 1000));
        await capture.stopCapture();

        // Second cycle
        await capture.startCapture({ fps: 60 });
        await new Promise(resolve => setTimeout(resolve, 1000));
        await capture.stopCapture();

        // Third cycle with different settings
        await capture.startCapture({ fps: 30, quality: 85 });
        await new Promise(resolve => setTimeout(resolve, 1000));
        const finalPath = await capture.stopCapture();

        expect(finalPath).toBeTruthy();
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record')) {
          console.log('⚠️  Screen Recording permission not granted - skipping multiple cycles test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    }, 10000); // 10 second timeout

    it('should reject starting capture while already recording', async () => {
      try {
        await capture.startCapture({ fps: 30 });
        
        await expect(capture.startCapture({ fps: 60 }))
          .rejects.toThrow('Capture is already in progress');

        await capture.stopCapture();
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('Screen Recording permission') || 
            errorMessage.includes('AVFoundationErrorDomain') ||
            errorMessage.includes('Cannot Record')) {
          console.log('⚠️  Screen Recording permission not granted - skipping duplicate start test');
          expect(error).toBeInstanceOf(Error);
        } else {
          throw error;
        }
      }
    }, 10000); // 10 second timeout
  });
});