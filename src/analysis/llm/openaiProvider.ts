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

  private async convertToGif(videoPath: string, duration: number): Promise<string[]> {
    // Extract the directory and filename from the video path
    const videoDir = path.dirname(videoPath);
    const videoBasename = path.basename(videoPath, '.mp4');
    
    // Calculate number of 10-second segments needed
    const segmentDuration = 10;
    const numSegments = Math.ceil(duration / segmentDuration);
    const gifPaths: string[] = [];
    
    logger.info(`Splitting ${duration}s video into ${numSegments} GIF segments of ${segmentDuration}s each`);
    
    for (let i = 0; i < numSegments; i++) {
      const startTime = i * segmentDuration;
      const segmentNum = String(i + 1).padStart(2, '0');
      const gifPath = path.join(videoDir, `${videoBasename}_part${segmentNum}.gif`);
      
      const ffmpegCmd = [
        'ffmpeg',
        '-i', videoPath,
        '-ss', startTime.toString(),
        '-t', segmentDuration.toString(),
        '-vf', 'fps=5,scale=1024:-1:flags=lanczos',
        '-loop', '0',
        gifPath,
        '-y'
      ].join(' ');
      
      logger.info(`Creating GIF segment ${i + 1}/${numSegments}: ${ffmpegCmd}`);
      
      try {
        await execAsync(ffmpegCmd);
        gifPaths.push(gifPath);
        logger.info(`GIF segment ${i + 1} saved: ${gifPath}`);
      } catch (error) {
        logger.error(`Failed to create GIF segment ${i + 1}:`, error);
        throw new Error(`GIF segment ${i + 1} conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return gifPaths;
  }

  async analyzeVideo(videoPath: string, duration: number): Promise<LLMVideoAnalysis> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }

    let gifPaths: string[] = [];
    let fileId: string | null = null;

    try {
      // Convert video to multiple GIFs
      gifPaths = await this.convertToGif(videoPath, duration);
      
      // Use the first GIF for OpenAI analysis (could be enhanced to analyze all segments)
      const primaryGif = gifPaths[0];
      logger.info(`Uploading primary GIF to OpenAI Files API: ${primaryGif}`);
      logger.info(`Created ${gifPaths.length} GIF segments saved alongside MP4`);
      
      // Upload primary GIF via Files API
      const gifBuffer = await fs.readFile(primaryGif);
      const file = new File([gifBuffer], path.basename(primaryGif), { type: 'image/gif' });
      
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
      const parsedResponse = this.parseAnalysisResponse(responseText);
      
      // Add GIF file information to the response
      parsedResponse.gifFiles = {
        allSegments: gifPaths,
        uploadedFile: primaryGif,
        totalSegments: gifPaths.length,
        segmentDuration: 10
      };
      
      return parsedResponse;
    } catch (error) {
      logger.error('OpenAI video analysis failed:', error);
      throw new Error(`Video analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Only clean up uploaded file from OpenAI, keep local GIFs
      if (fileId && this.client) {
        try {
          await this.client.files.delete(fileId);
          logger.info(`Deleted uploaded file: ${fileId}`);
        } catch (err) {
          logger.warn(`Failed to delete uploaded file: ${err}`);
        }
      }
      // Note: GIF files are intentionally NOT deleted - they remain alongside the MP4
    }
  }
}