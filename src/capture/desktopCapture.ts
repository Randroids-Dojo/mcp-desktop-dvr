import { recorder } from 'aperture';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CircularBuffer } from '../buffer/circularBuffer.js';

export interface CaptureOptions {
  fps?: number;
  quality?: number;
  audioDeviceId?: string;
}

export interface CaptureStatus {
  isRecording: boolean;
  startTime?: Date;
  duration?: number;
  fps?: number;
  quality?: number;
  outputPath?: string;
}

export class DesktopCapture extends EventEmitter {
  private isRecording = false;
  private startTime?: Date;
  private captureOptions?: CaptureOptions;
  private outputPath?: string;
  private outputDir: string;
  private circularBuffer: CircularBuffer;
  private segmentInterval?: ReturnType<typeof setInterval>;
  private currentSegmentPath?: string;
  private segmentCounter = 0;
  private currentSegmentStartTime?: Date;
  // Remove recorder property - use imported recorder directly

  constructor() {
    super();
    this.outputDir = join(homedir(), '.mcp-desktop-dvr', 'recordings');
    this.ensureOutputDirectory();
    this.circularBuffer = new CircularBuffer(join(homedir(), '.mcp-desktop-dvr', 'buffer'));
  }

  private ensureOutputDirectory(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async startCapture(options: CaptureOptions = {}): Promise<void> {
    if (this.isRecording) {
      throw new Error('Capture is already in progress');
    }

    const captureOptions: CaptureOptions = {
      fps: options.fps || 30,
      quality: options.quality || 70,
      audioDeviceId: options.audioDeviceId,
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
            this.rotateSegment().catch(error => {
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
        this.rotateSegment().catch(error => {
          
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

    const recordingOptions = {
      fps: options.fps,
      videoCodec: 'h264' as const,
      highlightClicks: true,
      showCursor: true,
      audioDeviceId: options.audioDeviceId,
    };

    try {
      await recorder.startRecording(recordingOptions);
    } catch (error: any) {
      // If it's the 5-second timeout but aperture is actually running, ignore it
      if (error?.code === 'RECORDER_TIMEOUT' && this.checkApertureRunning()) {
        // Recording started despite timeout, continue normally
      } else {
        throw error;
      }
    }
    
    this.outputPath = this.currentSegmentPath;
  }

  private async rotateSegment(): Promise<void> {
    if (!this.isRecording) return;

    try {
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
    } catch (error) {
      
      throw error;
    }
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
    if (!this.isRecording) {
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
      bufferStatus,
    } as CaptureStatus & { bufferStatus: ReturnType<CircularBuffer['getStatus']> };
  }

  private checkApertureRunning(): boolean {
    try {
      const { execSync } = require('child_process');
      const result = execSync('ps aux | grep aperture | grep record | grep -v grep', { encoding: 'utf8' });
      const isRunning = result.trim().length > 0;
      
      // If aperture is running but our state is wrong, sync it
      if (isRunning && !this.isRecording) {
        this.isRecording = true;
        this.startTime = new Date();
        
        // Start rotation interval if not running
        if (!this.segmentInterval) {
          this.segmentInterval = setInterval(() => {
            this.rotateSegment().catch(error => {
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
}