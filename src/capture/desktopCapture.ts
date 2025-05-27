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
          console.error('Error rotating segment:', error);
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

    const recordingOptions = {
      fps: options.fps,
      videoCodec: 'h264' as const,
      highlightClicks: true,
      showCursor: true,
      audioDeviceId: options.audioDeviceId,
    };

    await recorder.startRecording(recordingOptions);
    
    if (recorder.isFileReady) {
      this.outputPath = await recorder.isFileReady;
    }
  }

  private async rotateSegment(): Promise<void> {
    if (!this.isRecording) return;

    try {
      // Stop current recording
      const segmentPath = await recorder.stopRecording();
      
      // Add completed segment to circular buffer
      await this.circularBuffer.addVideoChunk(segmentPath);

      // Start new segment recording
      await this.startSegmentRecording(this.captureOptions || {});
    } catch (error) {
      console.error('Error during segment rotation:', error);
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
      
      // Add final segment to buffer
      await this.circularBuffer.addVideoChunk(outputPath);
      
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
      await this.circularBuffer.addVideoChunk(currentSegmentPath);

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
    return {
      isRecording: this.isRecording,
      startTime: this.startTime,
      duration: this.getDuration(),
      fps: this.captureOptions?.fps,
      quality: this.captureOptions?.quality,
      outputPath: this.outputPath,
      bufferStatus,
    } as CaptureStatus & { bufferStatus: ReturnType<CircularBuffer['getStatus']> };
  }

  private getDuration(): number | undefined {
    if (!this.startTime || !this.isRecording) {
      return undefined;
    }
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }
}