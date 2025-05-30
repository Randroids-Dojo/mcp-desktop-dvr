import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}\n`;
  const logDir = path.join(os.homedir(), '.mcp-desktop-dvr');
  const logPath = path.join(logDir, 'debug.log');
  
  // Ensure log directory exists
  fs.mkdir(logDir, { recursive: true })
    .then(() => fs.appendFile(logPath, logMessage))
    .catch(() => {});
    
  console.error(message);
}

interface BufferSegment {
  id: string;
  startTime: Date;
  endTime: Date;
  filePath: string;
  sizeBytes: number;
  durationSeconds: number;
}

const execAsync = promisify(exec);

export class CircularBuffer {
  private segments: BufferSegment[] = [];
  private maxDurationMs: number = 30 * 60 * 1000; // 30 minutes
  private segmentDurationMs: number = 60 * 1000; // 1 minute segments
  private bufferDir: string;
  private currentSegment: BufferSegment | null = null;
  private isInitialized: boolean = false;
  private extractDir: string;

  constructor(bufferDir?: string) {
    this.bufferDir = bufferDir || path.join(os.tmpdir(), 'desktop-dvr-buffer');
    this.extractDir = path.join(this.bufferDir, 'extracts');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    log('[CircularBuffer] Initializing buffer system');
    
    // Create buffer directory if it doesn't exist
    await fs.mkdir(this.bufferDir, { recursive: true });
    await fs.mkdir(this.extractDir, { recursive: true });
    
    // Clean up any existing segments from previous runs
    await this.cleanupOldSegments();
    
    this.isInitialized = true;
    log('[CircularBuffer] Initialization complete');
  }

  async addVideoChunk(videoPath: string, durationSeconds: number = 60): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Buffer not initialized. Call initialize() first.');
    }

    const now = new Date();
    const stats = await fs.stat(videoPath);
    
    // Create a new segment for each video file
    const segmentId = `segment_${now.getTime()}`;
    const segmentPath = path.join(this.bufferDir, `${segmentId}.mp4`);
    
    // Copy the video file to buffer
    await fs.copyFile(videoPath, segmentPath);
    
    // Calculate start time based on duration
    const startTime = new Date(now.getTime() - (durationSeconds * 1000));
    
    // Create segment metadata
    const segment: BufferSegment = {
      id: segmentId,
      startTime: startTime,
      endTime: now,
      filePath: segmentPath,
      sizeBytes: stats.size,
      durationSeconds: durationSeconds,
    };
    
    // Add to segments array
    this.segments.push(segment);
    this.currentSegment = segment;
    
    log(`[CircularBuffer] Added segment: ${segment.startTime.toISOString()} to ${segment.endTime.toISOString()} (${segment.durationSeconds}s)`);

    // Remove old segments that exceed the buffer duration
    await this.pruneOldSegments(now);
  }

  async extractLastNSeconds(seconds: number): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Buffer not initialized. Call initialize() first.');
    }

    const now = new Date();
    const startTime = new Date(now.getTime() - seconds * 1000);
    
    // Get all segments including current
    const allSegments = [...this.segments];
    if (this.currentSegment) {
      allSegments.push(this.currentSegment);
    }
    
    // Find relevant segments
    const relevantSegments = allSegments.filter(segment => 
      segment.endTime >= startTime && segment.startTime <= now
    ).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    log(`[CircularBuffer] Extracting ${seconds}s from ${relevantSegments.length} segments`);

    if (relevantSegments.length === 0) {
      throw new Error('No video data available for the requested time range');
    }

    // Generate output filename
    const outputFilename = `extract_${now.getTime()}_${seconds}s.mp4`;
    const outputPath = path.join(this.extractDir, outputFilename);

    if (relevantSegments.length === 1) {
      // Single segment - trim to requested duration
      const segment = relevantSegments[0];
      const trimStart = Math.max(0, (startTime.getTime() - segment.startTime.getTime()) / 1000);
      const trimDuration = seconds;
      
      // Use re-encoding for precise cuts (avoids keyframe issues)
      const ffmpegCmd = `ffmpeg -ss ${trimStart} -i "${segment.filePath}" -t ${trimDuration} -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -y`;
      await execAsync(ffmpegCmd);
      return outputPath;
    }

    // Multiple segments - concatenate using ffmpeg
    // Create concat file
    const concatFilePath = path.join(this.extractDir, `concat_${now.getTime()}.txt`);
    const concatContent = relevantSegments
      .map(seg => `file '${seg.filePath}'`)
      .join('\n');
    await fs.writeFile(concatFilePath, concatContent);

    try {
      // First concatenate, then trim to exact duration
      const tempPath = path.join(this.extractDir, `temp_${now.getTime()}.mp4`);
      const concatCmd = `ffmpeg -f concat -safe 0 -i "${concatFilePath}" -c copy "${tempPath}" -y`;
      await execAsync(concatCmd);

      // Calculate trim start time for first segment
      const firstSegment = relevantSegments[0];
      const trimStart = Math.max(0, (startTime.getTime() - firstSegment.startTime.getTime()) / 1000);
      
      // Trim to exact duration with re-encoding for precision
      const trimCmd = `ffmpeg -ss ${trimStart} -i "${tempPath}" -t ${seconds} -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -y`;
      await execAsync(trimCmd);

      // Clean up temp files
      await fs.unlink(concatFilePath);
      await fs.unlink(tempPath);

      return outputPath;
    } catch (error) {
      // Clean up on error
      try {
        await fs.unlink(concatFilePath);
      } catch {}
      throw new Error(`Failed to extract video: ${error}`);
    }
  }

  getStatus(): {
    isActive: boolean;
    totalSegments: number;
    oldestSegmentTime: Date | null;
    newestSegmentTime: Date | null;
    totalSizeBytes: number;
    bufferDurationSeconds: number;
  } {
    let totalSizeBytes = this.segments.reduce((sum, seg) => sum + seg.sizeBytes, 0);
    let totalSegments = this.segments.length;
    
    // Include current segment in counts
    if (this.currentSegment) {
      totalSizeBytes += this.currentSegment.sizeBytes;
      totalSegments += 1;
    }
    
    const oldestSegment = this.segments[0] || this.currentSegment;
    const newestSegment = this.currentSegment || this.segments[this.segments.length - 1];
    
    let bufferDurationSeconds = 0;
    if (oldestSegment && newestSegment) {
      bufferDurationSeconds = (newestSegment.endTime.getTime() - oldestSegment.startTime.getTime()) / 1000;
    }

    return {
      isActive: this.currentSegment !== null,
      totalSegments,
      oldestSegmentTime: oldestSegment?.startTime || null,
      newestSegmentTime: newestSegment?.endTime || null,
      totalSizeBytes,
      bufferDurationSeconds,
    };
  }

  async cleanup(): Promise<void> {
    // Stop any ongoing operations and clean up temporary files
    this.currentSegment = null;
    await this.cleanupOldSegments();
    this.segments = [];
  }

  // Removed unused segment management methods - segments are now created per video file

  private async pruneOldSegments(now: Date): Promise<void> {
    const cutoffTime = new Date(now.getTime() - this.maxDurationMs);
    
    // Find segments to remove
    const segmentsToRemove = this.segments.filter(segment => 
      segment.endTime < cutoffTime
    );

    // Remove old segments from disk
    for (const segment of segmentsToRemove) {
      try {
        await fs.unlink(segment.filePath);
      } catch (error) {
        console.error(`Failed to delete segment ${segment.id}:`, error);
      }
    }

    // Update segments array
    this.segments = this.segments.filter(segment => 
      segment.endTime >= cutoffTime
    );
  }

  private async cleanupOldSegments(): Promise<void> {
    try {
      const files = await fs.readdir(this.bufferDir);
      for (const file of files) {
        if (file.startsWith('segment_') && file.endsWith('.mp4')) {
          await fs.unlink(path.join(this.bufferDir, file));
        }
      }
    } catch (error) {
      console.error('Error cleaning up old segments:', error);
    }

    // Also clean up old extracts
    try {
      const extractFiles = await fs.readdir(this.extractDir);
      for (const file of extractFiles) {
        if (file.startsWith('extract_') || file.startsWith('concat_')) {
          await fs.unlink(path.join(this.extractDir, file));
        }
      }
    } catch (error) {
      console.error('Error cleaning up old extracts:', error);
    }
  }
}