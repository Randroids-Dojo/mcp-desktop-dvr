import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../utils/logger.js';
import { LLMProvider, LLMVideoAnalysis, VideoPreparationOptions } from './types.js';

const execAsync = promisify(exec);

export abstract class BaseLLMProvider implements LLMProvider {
  protected tempDir: string;
  protected maxVideoSize: number;
  public readonly name: string;
  
  constructor(name: string, maxVideoSize: number = 20 * 1024 * 1024) {
    this.name = name;
    this.tempDir = path.join(process.env.HOME || os.homedir(), '.mcp-desktop-dvr', 'temp');
    this.maxVideoSize = maxVideoSize;
  }
  
  abstract isAvailable(): boolean;
  abstract analyzeVideo(videoPath: string, duration: number): Promise<LLMVideoAnalysis>;
  
  protected async prepareVideo(
    videoPath: string, 
    duration: number,
    options?: VideoPreparationOptions
  ): Promise<string> {
    const stats = await fs.stat(videoPath);
    const maxSize = options?.maxSize || this.maxVideoSize;
    
    // If video is small enough, use it directly
    if (stats.size <= maxSize) {
      return videoPath;
    }

    // Ensure temp directory exists
    await fs.mkdir(this.tempDir, { recursive: true });

    // Compress video to meet size requirements
    const outputPath = path.join(this.tempDir, `compressed_${Date.now()}.mp4`);
    
    // Calculate target bitrate to stay under size limit
    const targetBitrate = Math.floor((maxSize * 8) / duration / 1000); // kbps
    
    const compressionLevel = options?.compressionLevel || 'medium';
    const crf = compressionLevel === 'low' ? 23 : compressionLevel === 'high' ? 35 : 28;
    
    const ffmpegCmd = [
      'ffmpeg',
      '-i', videoPath,
      '-c:v libx264',
      '-preset fast',
      `-crf ${crf}`,
      `-b:v ${targetBitrate}k`,
      '-maxrate', `${targetBitrate * 1.5}k`,
      '-bufsize', `${targetBitrate * 2}k`,
      '-vf scale=1280:-2', // Scale down to 720p width if larger
      '-an', // Remove audio
      '-y',
      outputPath
    ].join(' ');

    logger.info(`Compressing video for LLM analysis: ${ffmpegCmd}`);
    await execAsync(ffmpegCmd);
    
    return outputPath;
  }
  
  protected createAnalysisPrompt(duration: number): string {
    return `Analyze this ${duration}-second desktop screen recording and provide a detailed analysis.

Focus on:
1. What applications or windows are visible and being used
2. Any error messages, warnings, or issues displayed
3. User actions and interactions (clicks, typing, navigation)
4. The overall workflow or task being performed
5. Any notable UI states or changes

Please structure your response as a JSON object with these fields:
{
  "description": "Overall description of what's happening",
  "detectedApplications": ["list", "of", "applications"],
  "errors": ["any error messages or issues"],
  "warnings": ["any warnings or potential problems"],
  "keyActions": ["important user actions"],
  "summary": "Brief 1-2 sentence summary",
  "confidence": 0.0-1.0 confidence score
}

Be specific about any technical details, error messages, or UI elements you observe.`;
  }
  
  protected parseAnalysisResponse(content: string): LLMVideoAnalysis {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          description: parsed.description || '',
          detectedApplications: Array.isArray(parsed.detectedApplications) ? parsed.detectedApplications : [],
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
          keyActions: Array.isArray(parsed.keyActions) ? parsed.keyActions : [],
          summary: parsed.summary || '',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8
        };
      }
    } catch (error) {
      logger.warn('Failed to parse JSON response, falling back to text parsing', error);
    }

    // Fallback: parse as plain text
    return this.parseTextResponse(content);
  }
  
  private parseTextResponse(content: string): LLMVideoAnalysis {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    
    const result: LLMVideoAnalysis = {
      description: '',
      detectedApplications: [],
      errors: [],
      warnings: [],
      keyActions: [],
      summary: '',
      confidence: 0.7
    };

    let currentSection = '';
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      if (lowerLine.includes('description:')) {
        currentSection = 'description';
        result.description = line.split(':').slice(1).join(':').trim();
      } else if (lowerLine.includes('application')) {
        currentSection = 'applications';
      } else if (lowerLine.includes('error')) {
        currentSection = 'errors';
      } else if (lowerLine.includes('warning')) {
        currentSection = 'warnings';
      } else if (lowerLine.includes('action')) {
        currentSection = 'actions';
      } else if (lowerLine.includes('summary:')) {
        currentSection = 'summary';
        result.summary = line.split(':').slice(1).join(':').trim();
      } else if (line.startsWith('-') || line.startsWith('•')) {
        const item = line.substring(1).trim();
        switch (currentSection) {
          case 'applications':
            result.detectedApplications.push(item);
            break;
          case 'errors':
            result.errors.push(item);
            break;
          case 'warnings':
            result.warnings.push(item);
            break;
          case 'actions':
            result.keyActions.push(item);
            break;
        }
      }
    }

    // Use full content as description if not found
    if (!result.description) {
      result.description = content.substring(0, 500);
    }

    // Generate summary if not found
    if (!result.summary) {
      const hasErrors = result.errors.length > 0;
      const appList = result.detectedApplications.join(', ');
      result.summary = hasErrors 
        ? `Detected ${result.errors.length} error(s) while using ${appList || 'desktop applications'}`
        : `User activity in ${appList || 'desktop applications'}`;
    }

    return result;
  }
  
  async cleanup(): Promise<void> {
    // Clean up temp directory
    try {
      const files = await fs.readdir(this.tempDir);
      for (const file of files) {
        await fs.unlink(path.join(this.tempDir, file)).catch(() => {});
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}