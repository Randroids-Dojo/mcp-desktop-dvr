import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

interface BufferSegment {
  id: string;
  startTime: Date;
  endTime: Date;
  filePath: string;
  sizeBytes: number;
}

export class CircularBuffer {
  private segments: BufferSegment[] = [];
  private maxDurationMs: number = 30 * 60 * 1000; // 30 minutes
  private segmentDurationMs: number = 60 * 1000; // 1 minute segments
  private bufferDir: string;
  private currentSegment: BufferSegment | null = null;
  private isInitialized: boolean = false;

  constructor(bufferDir?: string) {
    this.bufferDir = bufferDir || path.join(os.tmpdir(), 'desktop-dvr-buffer');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    // Create buffer directory if it doesn't exist
    await fs.mkdir(this.bufferDir, { recursive: true });
    
    // Clean up any existing segments from previous runs
    await this.cleanupOldSegments();
    
    this.isInitialized = true;
  }

  async addVideoChunk(videoPath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Buffer not initialized. Call initialize() first.');
    }

    const now = new Date();
    
    // Check if we need to start a new segment
    if (!this.currentSegment || this.shouldStartNewSegment(now)) {
      await this.startNewSegment(now);
    }

    // Copy the video chunk to the current segment file
    // In a real implementation, we would append to the segment file
    // For now, we'll copy the file and track metadata
    if (this.currentSegment) {
      this.currentSegment.endTime = now;
      const stats = await fs.stat(videoPath);
      this.currentSegment.sizeBytes += stats.size;
      
      // Copy the video data to the segment file (simplified for now)
      const videoData = await fs.readFile(videoPath);
      await fs.appendFile(this.currentSegment.filePath, videoData);
    }

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
    );

    if (relevantSegments.length === 0) {
      throw new Error('No video data available for the requested time range');
    }

    // TODO: Implement actual video extraction and concatenation
    // For now, return the path to the most recent segment
    const mostRecentSegment = relevantSegments[relevantSegments.length - 1];
    return mostRecentSegment.filePath;
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

  private shouldStartNewSegment(now: Date): boolean {
    if (!this.currentSegment) return true;
    
    const segmentAge = now.getTime() - this.currentSegment.startTime.getTime();
    return segmentAge >= this.segmentDurationMs;
  }

  private async startNewSegment(now: Date): Promise<void> {
    // Finalize current segment if exists
    if (this.currentSegment) {
      this.segments.push(this.currentSegment);
    }

    // Create new segment
    const segmentId = `segment_${now.getTime()}`;
    const segmentPath = path.join(this.bufferDir, `${segmentId}.mp4`);
    
    this.currentSegment = {
      id: segmentId,
      startTime: now,
      endTime: now,
      filePath: segmentPath,
      sizeBytes: 0,
    };

    // Create empty file for the segment
    await fs.writeFile(segmentPath, '');
  }

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
  }
}