import { recorder } from 'aperture';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CircularBuffer } from '../buffer/circularBuffer.js';
import { OptimizedCircularBuffer } from '../buffer/optimizedCircularBuffer.js';
import { WindowDetector, type WindowInfo, type CropArea } from './windowDetector.js';
import { log } from '../utils/logger.js';
import { execSync } from 'child_process';

export interface CaptureOptions {
  fps?: number;
  quality?: number;
  audioDeviceId?: string;
  useOptimizedBuffer?: boolean;
  bundleId?: string;
  cropArea?: CropArea;
  windowPadding?: number;
  captureAllWindows?: boolean; // New option to capture all windows for a bundle ID
}

export interface CaptureStatus {
  isRecording: boolean;
  startTime?: Date;
  duration?: number;
  fps?: number;
  quality?: number;
  outputPath?: string;
  bundleId?: string;
  cropArea?: CropArea;
  targetWindow?: WindowInfo;
}

export class DesktopCapture extends EventEmitter {
  private isRecording = false;
  private startTime?: Date;
  private captureOptions?: CaptureOptions;
  private outputPath?: string;
  private outputDir: string;
  private circularBuffer: CircularBuffer | OptimizedCircularBuffer;
  private segmentInterval?: ReturnType<typeof setInterval>;
  private currentSegmentPath?: string;
  private segmentCounter = 0;
  private currentSegmentStartTime?: Date;
  private useOptimizedBuffer: boolean = false;
  private windowDetector: WindowDetector;
  private targetWindow?: WindowInfo;
  // Remove recorder property - use imported recorder directly

  constructor(useOptimizedBuffer: boolean = true) {
    super();
    this.outputDir = join(homedir(), '.mcp-desktop-dvr', 'recordings');
    this.ensureOutputDirectory();
    this.useOptimizedBuffer = useOptimizedBuffer;
    this.windowDetector = new WindowDetector();
    
    const bufferPath = join(homedir(), '.mcp-desktop-dvr', 'buffer');
    this.circularBuffer = useOptimizedBuffer 
      ? new OptimizedCircularBuffer(bufferPath)
      : new CircularBuffer(bufferPath);
    
    // Clean up any dangling aperture processes on startup
    this.cleanupDanglingProcesses();
  }

  private ensureOutputDirectory(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private async cleanupDanglingProcesses(): Promise<void> {
    try {
      log('[DesktopCapture] Checking for dangling aperture processes...');
      
      // Check for aperture processes
      const stdout = execSync('ps aux | grep -i aperture | grep -v grep || echo ""', 
        { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      
      if (stdout.trim()) {
        log('[DesktopCapture] Found dangling aperture processes, cleaning up...');
        
        // Kill aperture recording processes
        try {
          execSync('pkill -f "aperture.*record" 2>/dev/null || true');
          execSync('pkill -f "aperture.*events" 2>/dev/null || true');
          log('[DesktopCapture] Successfully cleaned up dangling aperture processes');
        } catch (error) {
          log(`[DesktopCapture] Error during cleanup: ${error}`);
        }
        
        // Wait a moment for processes to terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        log('[DesktopCapture] No dangling aperture processes found');
      }
    } catch (error) {
      log(`[DesktopCapture] Error checking for dangling processes: ${error}`);
    }
  }

  async startCapture(options: CaptureOptions = {}): Promise<void> {
    if (this.isRecording) {
      throw new Error('Capture is already in progress');
    }

    // Validate capture options
    if (options.fps !== undefined && (options.fps < 1 || options.fps > 120)) {
      throw new Error('FPS must be between 1 and 120');
    }
    if (options.quality !== undefined && (options.quality < 1 || options.quality > 100)) {
      throw new Error('Quality must be between 1 and 100');
    }

    const captureOptions: CaptureOptions = {
      fps: options.fps || 30,
      quality: options.quality || 70,
      audioDeviceId: options.audioDeviceId,
      bundleId: options.bundleId,
      windowPadding: options.windowPadding,
      captureAllWindows: options.captureAllWindows,
      cropArea: options.cropArea,
    };

    try {
      // Check if already recording
      if (this.checkApertureRunning()) {
        // If aperture is already running, sync our state instead of starting new
        this.isRecording = true;
        this.startTime = new Date();
        this.captureOptions = captureOptions;
        
        // Start rotation interval if not already started
        if (!this.segmentInterval) {
          this.segmentInterval = setInterval(() => {
            this.rotateSegment().catch(() => {
              // Rotation error logged elsewhere
            });
          }, 60000);
        }
        
        return; // Exit early, we're already recording
      }

      // Initialize circular buffer
      await this.circularBuffer.initialize();

      // Start recording segments
      await this.startSegmentRecording(captureOptions);

      this.isRecording = true;
      this.startTime = new Date();
      this.captureOptions = captureOptions;

      // Start segment rotation interval (every 60 seconds)
      this.segmentInterval = setInterval(() => {
        this.rotateSegment().catch(() => {
          // Rotation error logged elsewhere
        });
      }, 60000);

      this.emit('captureStarted', {
        outputPath: this.outputPath,
        options: captureOptions,
      });
    } catch (error) {
      throw new Error(`Failed to start capture: ${error}`);
    }
  }

  private async startSegmentRecording(options: CaptureOptions): Promise<void> {
    this.segmentCounter++;
    this.currentSegmentPath = join(this.outputDir, `segment_${Date.now()}_${this.segmentCounter}.mp4`);
    this.currentSegmentStartTime = new Date();

    // Handle window-specific capture
    let cropArea: CropArea | undefined = options.cropArea;
    
    if (options.bundleId && !cropArea) {
      try {
        if (options.captureAllWindows) {
          // Find all windows and create a bounding box that encompasses them all
          const allWindows = await this.windowDetector.findWindowsByBundleId(options.bundleId);
          const visibleWindows = allWindows.filter(w => w.isVisible && w.width > 100 && w.height > 100);
          
          if (visibleWindows.length > 0) {
            cropArea = this.windowDetector.createBoundingBoxForWindows(visibleWindows, options.windowPadding || 10);
            console.error(`[DesktopCapture] Capturing all ${visibleWindows.length} windows for ${options.bundleId} (${cropArea.width}x${cropArea.height})`);
          } else {
            console.error(`[DesktopCapture] Warning: Could not find windows for bundle ID ${options.bundleId}, falling back to full screen`);
          }
        } else {
          // Find the main/largest window (existing behavior)
          const targetWindow = await this.windowDetector.findMainWindowByBundleId(options.bundleId);
          if (targetWindow) {
            this.targetWindow = targetWindow;
            cropArea = this.windowDetector.windowToCropArea(targetWindow, options.windowPadding || 10);
            console.error(`[DesktopCapture] Found target window for ${options.bundleId}: ${targetWindow.title} (${cropArea.width}x${cropArea.height})`);
          } else {
            console.error(`[DesktopCapture] Warning: Could not find window for bundle ID ${options.bundleId}, falling back to full screen`);
          }
        }
      } catch (error) {
        // Window detection failed, log and continue with full screen
        console.error(`[DesktopCapture] Window detection error for ${options.bundleId}: ${error}. Falling back to full screen`);
      }
    }

    const recordingOptions: Record<string, unknown> = {
      fps: options.fps,
      videoCodec: 'h264' as const,
      highlightClicks: true,
      showCursor: true,
      audioDeviceId: options.audioDeviceId,
    };

    // Add crop area if specified
    if (cropArea) {
      recordingOptions.cropArea = cropArea;
    }

    try {
      await recorder.startRecording(recordingOptions);
    } catch (error: unknown) {
      const errorObj = error as { message?: string; code?: string };
      // Check for macOS permission error
      if (errorObj?.message?.includes('AVFoundationErrorDomain') && errorObj?.message?.includes('-11805')) {
        throw new Error('Screen Recording permission required. Please enable in System Preferences > Privacy & Security > Screen Recording');
      }
      
      // If it's the 5-second timeout but aperture is actually running, ignore it
      if (errorObj?.code === 'RECORDER_TIMEOUT' && this.checkApertureRunning()) {
        log('Recording timeout occurred but aperture is running, continuing normally');
        // Recording started despite timeout, continue normally
      } else {
        throw error;
      }
    }
    
    this.outputPath = this.currentSegmentPath;
  }

  private async rotateSegment(): Promise<void> {
    if (!this.isRecording) return;

    // Stop current recording
    const segmentPath = await recorder.stopRecording();
    
    // Calculate segment duration
    const duration = this.currentSegmentStartTime 
      ? Math.floor((Date.now() - this.currentSegmentStartTime.getTime()) / 1000)
      : 60;
    
    // Add completed segment to circular buffer
    await this.circularBuffer.addVideoChunk(segmentPath, duration);

    // Start new segment recording
    await this.startSegmentRecording(this.captureOptions || {});
  }

  async updateCaptureSettings(options: Partial<CaptureOptions>): Promise<void> {
    if (!this.isRecording) {
      throw new Error('No capture in progress to update');
    }

    // Update the capture options
    const previousOptions = { ...this.captureOptions };
    this.captureOptions = {
      ...this.captureOptions,
      ...options,
    };

    // Emit event for settings update
    this.emit('captureSettingsUpdated', {
      previousOptions,
      newOptions: this.captureOptions,
    });

    // Note: Aperture doesn't support changing settings mid-recording,
    // so these settings will apply to the next segment
  }

  async stopCapture(): Promise<string> {
    if (!this.isRecording) {
      throw new Error('No capture in progress');
    }

    try {
      // Clear segment rotation interval
      if (this.segmentInterval) {
        clearInterval(this.segmentInterval);
        this.segmentInterval = undefined;
      }

      // Stop current recording
      const outputPath = await recorder.stopRecording();
      
      // Calculate segment duration
      const duration = this.currentSegmentStartTime 
        ? Math.floor((Date.now() - this.currentSegmentStartTime.getTime()) / 1000)
        : 60;
      
      // Add final segment to buffer
      await this.circularBuffer.addVideoChunk(outputPath, duration);
      
      this.isRecording = false;

      this.emit('captureStopped', {
        outputPath,
        duration: this.getDuration(),
      });

      return outputPath;
    } catch (error) {
      throw new Error(`Failed to stop capture: ${error}`);
    }
  }

  async extractLastNSeconds(seconds: number): Promise<string> {
    // Check if aperture is actually running even if our state says it's not
    const actuallyRecording = this.isRecording || this.checkApertureRunning();
    
    if (!actuallyRecording) {
      throw new Error('No active recording to extract from');
    }

    try {
      // Stop current segment and add to buffer
      const currentSegmentPath = await recorder.stopRecording();
      const duration = this.currentSegmentStartTime 
        ? Math.floor((Date.now() - this.currentSegmentStartTime.getTime()) / 1000)
        : 60;
      await this.circularBuffer.addVideoChunk(currentSegmentPath, duration);

      // Extract requested duration from buffer
      const extractedPath = await this.circularBuffer.extractLastNSeconds(seconds);

      // Resume recording if still active
      if (this.isRecording) {
        await this.startSegmentRecording(this.captureOptions || {});
      }

      return extractedPath;
    } catch (error) {
      throw new Error(`Failed to extract video: ${error}`);
    }
  }

  getStatus(): CaptureStatus {
    const bufferStatus = this.circularBuffer.getStatus();
    
    // Check if aperture is actually running even if our state says it's not
    const actuallyRecording = this.isRecording || this.checkApertureRunning();
    
    return {
      isRecording: actuallyRecording,
      startTime: this.startTime,
      duration: this.getDuration(),
      fps: this.captureOptions?.fps,
      quality: this.captureOptions?.quality,
      outputPath: this.outputPath,
      bundleId: this.captureOptions?.bundleId,
      cropArea: this.captureOptions?.cropArea,
      targetWindow: this.targetWindow,
      bufferStatus,
      memoryOptimized: this.useOptimizedBuffer,
    } as CaptureStatus & { 
      bufferStatus: ReturnType<CircularBuffer['getStatus']> | ReturnType<OptimizedCircularBuffer['getStatus']>;
      memoryOptimized: boolean;
    };
  }

  private checkApertureRunning(): boolean {
    try {
      const result = execSync('ps aux | grep aperture | grep record | grep -v grep', { encoding: 'utf8' });
      const isRunning = result.trim().length > 0;
      
      // If aperture is running but our state is wrong, sync it
      if (isRunning && !this.isRecording) {
        this.isRecording = true;
        this.startTime = new Date();
        
        // Start rotation interval if not running
        if (!this.segmentInterval) {
          this.segmentInterval = setInterval(() => {
            this.rotateSegment().catch(() => {
              // Error handling
            });
          }, 60000);
        }
      }
      
      return isRunning;
    } catch {
      return false;
    }
  }

  private getDuration(): number | undefined {
    if (!this.startTime || !this.isRecording) {
      return undefined;
    }
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }
  
  async getAvailableWindows(bundleId?: string): Promise<WindowInfo[]> {
    if (bundleId) {
      return await this.windowDetector.findWindowsByBundleId(bundleId);
    }
    
    // Return common bundle IDs and their status
    const commonBundles = this.windowDetector.getCommonBundleIds();
    const availableWindows: WindowInfo[] = [];
    
    for (const bundle of Object.values(commonBundles)) {
      const isRunning = await this.windowDetector.isApplicationRunning(bundle);
      if (isRunning) {
        const windows = await this.windowDetector.findWindowsByBundleId(bundle);
        availableWindows.push(...windows);
      }
    }
    
    return availableWindows;
  }
  
  getCommonBundleIds(): Record<string, string> {
    return this.windowDetector.getCommonBundleIds();
  }
  
  async isApplicationRunning(bundleId: string): Promise<boolean> {
    return await this.windowDetector.isApplicationRunning(bundleId);
  }

  async shutdown(): Promise<void> {
    log('[DesktopCapture] Starting graceful shutdown...');
    
    try {
      // Clear segment rotation interval
      if (this.segmentInterval) {
        clearInterval(this.segmentInterval);
        this.segmentInterval = undefined;
      }
      
      // Stop recording if active
      if (this.isRecording) {
        log('[DesktopCapture] Stopping active recording...');
        await this.stopCapture();
      }
      
      // Shutdown circular buffer
      if (this.circularBuffer instanceof OptimizedCircularBuffer) {
        log('[DesktopCapture] Shutting down circular buffer...');
        await this.circularBuffer.shutdown();
      }
      
      // Final cleanup of any aperture processes
      log('[DesktopCapture] Final cleanup of aperture processes...');
      await this.cleanupDanglingProcesses();
      
      log('[DesktopCapture] Shutdown completed successfully');
    } catch (error) {
      log(`[DesktopCapture] Error during shutdown: ${error}`);
      
      // Force cleanup even if other steps failed
      try {
        execSync('pkill -f "aperture.*record" 2>/dev/null || true');
        execSync('pkill -f "aperture.*events" 2>/dev/null || true');
        log('[DesktopCapture] Force cleanup completed');
      } catch (forceError) {
        log(`[DesktopCapture] Force cleanup failed: ${forceError}`);
      }
    }
  }
}