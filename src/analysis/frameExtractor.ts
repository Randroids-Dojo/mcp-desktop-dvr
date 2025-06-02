import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp from 'sharp';

export interface ExtractedFrame {
  framePath: string;
  timestamp: number;
  frameNumber: number;
}

export class FrameExtractor {
  private readonly tempDir: string;

  constructor() {
    this.tempDir = path.join(process.env.HOME || '', '.mcp-desktop-dvr', 'frames');
    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch {
      // Ignore directory creation errors - may already exist
    }
  }

  async extractFrames(videoPath: string, options: {
    interval?: number;  // Extract every N seconds
    maxFrames?: number; // Maximum number of frames to extract
  } = {}): Promise<ExtractedFrame[]> {
    const { interval = 1, maxFrames = 30 } = options;
    const outputPattern = path.join(this.tempDir, `frame_%d.png`);
    
    // Clean up old frames
    await this.cleanupFrames();
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-vf', `fps=1/${interval}`,
        '-frames:v', maxFrames.toString(),
        '-f', 'image2',
        outputPattern
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg failed: ${stderr}`));
          return;
        }

        // Read extracted frames
        const files = await fs.readdir(this.tempDir);
        const frameFiles = files.filter(f => f.startsWith('frame_') && f.endsWith('.png'));
        
        const frames: ExtractedFrame[] = frameFiles.map(file => {
          const match = file.match(/frame_(\d+)\.png/);
          const frameNumber = match ? parseInt(match[1], 10) : 0;
          return {
            framePath: path.join(this.tempDir, file),
            timestamp: (frameNumber - 1) * interval * 1000, // Convert to milliseconds
            frameNumber
          };
        }).sort((a, b) => a.frameNumber - b.frameNumber);

        resolve(frames);
      });
    });
  }

  async extractSingleFrame(videoPath: string, timestamp: number): Promise<string> {
    const outputPath = path.join(this.tempDir, `frame_single_${Date.now()}.png`);
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-ss', (timestamp / 1000).toString(),
        '-frames:v', '1',
        '-f', 'image2',
        outputPath
      ]);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`Failed to extract frame at ${timestamp}ms`));
        }
      });
    });
  }

  async preprocessFrame(framePath: string): Promise<Buffer> {
    // Preprocess frame for better OCR/analysis
    return sharp(framePath)
      .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .normalize()
      .toBuffer();
  }

  async cleanupFrames(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);
      for (const file of files) {
        if (file.startsWith('frame_') && file.endsWith('.png')) {
          await fs.unlink(path.join(this.tempDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}