import OpenAI from 'openai';
import { promises as fs } from 'fs';
import { logger } from '../../utils/logger.js';
import { BaseLLMProvider } from './baseLLMProvider.js';
import { LLMVideoAnalysis } from './types.js';

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

  async analyzeVideo(videoPath: string, duration: number): Promise<LLMVideoAnalysis> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }

    try {
      // Ensure temp directory exists
      await fs.mkdir(this.tempDir, { recursive: true });

      // Check video size and compress if needed
      const processedVideoPath = await this.prepareVideo(videoPath, duration);
      
      // Read video file
      const videoBuffer = await fs.readFile(processedVideoPath);
      const base64Video = videoBuffer.toString('base64');

      // Create analysis prompt
      const prompt = this.createAnalysisPrompt(duration);

      // Send to OpenAI
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:video/mp4;base64,${base64Video}`,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.3
      });

      // Clean up temporary file if created
      if (processedVideoPath !== videoPath) {
        await fs.unlink(processedVideoPath).catch(() => {});
      }

      // Parse response
      return this.parseAnalysisResponse(response.choices[0].message.content || '');
    } catch (error) {
      logger.error('OpenAI video analysis failed:', error);
      throw new Error(`Video analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}