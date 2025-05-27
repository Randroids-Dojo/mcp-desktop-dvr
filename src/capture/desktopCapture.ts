import { recorder } from 'aperture';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

  constructor() {
    super();
    this.outputDir = join(homedir(), '.mcp-desktop-dvr', 'recordings');
    this.ensureOutputDirectory();
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
      const recordingOptions = {
        fps: captureOptions.fps,
        videoCodec: 'h264' as const,
        highlightClicks: true,
        showCursor: true,
        audioDeviceId: captureOptions.audioDeviceId,
      };

      await recorder.startRecording(recordingOptions);
      
      if (recorder.isFileReady) {
        this.outputPath = await recorder.isFileReady;
      }

      this.isRecording = true;
      this.startTime = new Date();
      this.captureOptions = captureOptions;

      this.emit('captureStarted', {
        outputPath: this.outputPath,
        options: captureOptions,
      });
    } catch (error) {
      throw new Error(`Failed to start capture: ${error}`);
    }
  }

  async stopCapture(): Promise<string> {
    if (!this.isRecording) {
      throw new Error('No capture in progress');
    }

    try {
      const outputPath = await recorder.stopRecording();
      
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

  getStatus(): CaptureStatus {
    return {
      isRecording: this.isRecording,
      startTime: this.startTime,
      duration: this.getDuration(),
      fps: this.captureOptions?.fps,
      quality: this.captureOptions?.quality,
      outputPath: this.outputPath,
    };
  }

  private getDuration(): number | undefined {
    if (!this.startTime || !this.isRecording) {
      return undefined;
    }
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }
}