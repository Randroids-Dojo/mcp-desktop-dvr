import { logger } from '../../utils/logger.js';
import { LLMProvider, LLMProviderConfig } from './types.js';
import { OpenAIProvider } from './openaiProvider.js';

export class LLMAnalyzerFactory {
  private static instance: LLMAnalyzerFactory;
  private providers: Map<string, LLMProvider> = new Map();
  private activeProvider: LLMProvider | null = null;

  private constructor() {
    this.initializeProviders();
  }

  static getInstance(): LLMAnalyzerFactory {
    if (!LLMAnalyzerFactory.instance) {
      LLMAnalyzerFactory.instance = new LLMAnalyzerFactory();
    }
    return LLMAnalyzerFactory.instance;
  }

  private initializeProviders(): void {
    // Initialize available providers based on environment
    if (process.env.OPENAI_API_KEY) {
      const openaiProvider = new OpenAIProvider();
      this.providers.set('openai', openaiProvider);
      this.activeProvider = openaiProvider;
      logger.info('OpenAI provider registered and set as active');
    }

    // Future providers can be added here:
    // if (process.env.ANTHROPIC_API_KEY) {
    //   const anthropicProvider = new AnthropicProvider();
    //   this.providers.set('anthropic', anthropicProvider);
    //   if (!this.activeProvider) this.activeProvider = anthropicProvider;
    // }
    
    // if (process.env.GEMINI_API_KEY) {
    //   const geminiProvider = new GeminiProvider();
    //   this.providers.set('gemini', geminiProvider);
    //   if (!this.activeProvider) this.activeProvider = geminiProvider;
    // }

    // Override provider selection with environment variable
    const preferredProvider = process.env.LLM_PROVIDER;
    if (preferredProvider && this.providers.has(preferredProvider)) {
      this.activeProvider = this.providers.get(preferredProvider)!;
      logger.info(`Active LLM provider set to: ${preferredProvider}`);
    }
  }

  getActiveProvider(): LLMProvider | null {
    return this.activeProvider;
  }

  getProvider(name: string): LLMProvider | null {
    return this.providers.get(name) || null;
  }

  setActiveProvider(name: string): boolean {
    const provider = this.providers.get(name);
    if (provider && provider.isAvailable()) {
      this.activeProvider = provider;
      logger.info(`Active LLM provider changed to: ${name}`);
      return true;
    }
    return false;
  }

  listAvailableProviders(): string[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.isAvailable())
      .map(([name, _]) => name);
  }

  async cleanup(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.cleanup();
    }
  }
}