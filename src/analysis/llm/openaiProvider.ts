import OpenAI from 'openai';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import { BaseLLMProvider } from './baseLLMProvider.js';
import { LLMVideoAnalysis } from './types.js';

const execAsync = promisify(exec);

export class OpenAIProvider extends BaseLLMProvider {
  private client: OpenAI | null = null;
  private model: string;

  constructor() {
    super('OpenAI', 20 * 1024 * 1024); // 20MB limit for OpenAI
    this.model = process.env.OPENAI_MODEL || 'gpt-4o';
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = process.env.OPENAI_API_KEY;
    logger.info(`[OpenAI] Checking for API key: ${apiKey ? 'Found (length: ' + apiKey.length + ')' : 'Not found'}`);
    logger.info(`[OpenAI] All env vars: ${Object.keys(process.env).filter(k => k.includes('OPENAI')).join(', ') || 'None with OPENAI'}`);
    
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      logger.info('OpenAI client initialized successfully');
    } else {
      logger.info('OpenAI API key not found - video analysis will use fallback OCR method');
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  private async convertToGif(videoPath: string, duration: number): Promise<string> {
    const gifPath = path.join(this.tempDir, `video_${Date.now()}.gif`);
    
    // Limit duration to 10 seconds for GIF conversion
    const gifDuration = Math.min(duration, 10);
    
    const ffmpegCmd = [
      'ffmpeg',
      '-i', videoPath,
      '-vf', 'fps=5,scale=1024:-1:flags=lanczos',
      '-t', gifDuration.toString(),
      '-loop', '0',
      gifPath,
      '-y'
    ].join(' ');
    
    logger.info(`Converting video to GIF for OpenAI analysis: ${ffmpegCmd}`);
    
    try {
      await execAsync(ffmpegCmd);
      return gifPath;
    } catch (error) {
      logger.error('Failed to convert video to GIF:', error);
      throw new Error(`GIF conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async analyzeVideo(videoPath: string, duration: number): Promise<LLMVideoAnalysis> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }

    let gifPath: string | null = null;
    let fileId: string | null = null;

    try {
      // Ensure temp directory exists
      await fs.mkdir(this.tempDir, { recursive: true });

      // Convert video to GIF
      gifPath = await this.convertToGif(videoPath, duration);
      
      logger.info(`Uploading GIF to OpenAI Files API: ${gifPath}`);
      
      // Upload GIF via Files API
      const gifBuffer = await fs.readFile(gifPath);
      const file = new File([gifBuffer], path.basename(gifPath), { type: 'image/gif' });
      
      const fileResult = await this.client.files.create({
        file: file,
        purpose: 'vision'
      });
      
      fileId = fileResult.id;
      logger.info(`File uploaded successfully with ID: ${fileId}`);

      // Create analysis prompt
      const prompt = this.createAnalysisPrompt(duration);

      // Analyze using Responses API
      logger.info('Sending analysis request to OpenAI Responses API');
      
      const response = await this.client.responses.create({
        model: this.model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', file_id: fileId, detail: 'high' }
          ]
        }]
      });

      // Extract response text from the first output message
      const firstOutput = response.output[0];
      let responseText = '';
      
      if ('content' in firstOutput && Array.isArray(firstOutput.content)) {
        // It's a message output
        const textContent = firstOutput.content.find(item => 'text' in item);
        if (textContent && 'text' in textContent) {
          responseText = textContent.text;
        }
      }
      
      logger.info('Received response from OpenAI');

      // Parse response
      return this.parseAnalysisResponse(responseText);
    } catch (error) {
      logger.error('OpenAI video analysis failed:', error);
      throw new Error(`Video analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Clean up temporary files
      if (gifPath) {
        await fs.unlink(gifPath).catch((err) => {
          logger.warn(`Failed to delete temporary GIF: ${err}`);
        });
      }
      
      // Clean up uploaded file
      if (fileId && this.client) {
        try {
          await this.client.files.delete(fileId);
          logger.info(`Deleted uploaded file: ${fileId}`);
        } catch (err) {
          logger.warn(`Failed to delete uploaded file: ${err}`);
        }
      }
    }
  }
}