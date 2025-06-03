export interface LLMVideoAnalysis {
  description: string;
  detectedApplications: string[];
  errors: string[];
  warnings: string[];
  keyActions: string[];
  summary: string;
  confidence: number;
}

export interface LLMProvider {
  name: string;
  isAvailable(): boolean;
  analyzeVideo(videoPath: string, duration: number): Promise<LLMVideoAnalysis>;
  cleanup(): Promise<void>;
}

export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'azure';
  apiKey?: string;
  model?: string;
  endpoint?: string;
  maxVideoSize?: number;
  temperature?: number;
}

export interface VideoPreparationOptions {
  maxSize: number;
  targetFormat?: 'mp4' | 'webm';
  compressionLevel?: 'low' | 'medium' | 'high';
}