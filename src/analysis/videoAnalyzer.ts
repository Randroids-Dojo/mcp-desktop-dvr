import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AnalysisOptions, AnalysisResult, UIElement, MouseActivity } from './types.js';
import { FrameExtractor, ExtractedFrame } from './frameExtractor.js';
import { VisualAnalyzer } from './visualAnalyzer.js';
import { EnhancedVisualAnalyzer } from './enhancedVisualAnalyzer.js';
import { FocusedAnalyzer } from './focusedAnalyzer.js';
import { LLMAnalyzerFactory } from './llm/index.js';
import { logger } from '../utils/logger.js';

export class VideoAnalyzer {
  private readonly tempDir = path.join(process.env.HOME || os.homedir(), '.mcp-desktop-dvr', 'analysis');
  private frameExtractor: FrameExtractor;
  private visualAnalyzer: VisualAnalyzer;
  private enhancedAnalyzer: EnhancedVisualAnalyzer;
  private focusedAnalyzer: FocusedAnalyzer;
  private llmFactory: LLMAnalyzerFactory;
  private useEnhancedAnalysis = true;
  private useFocusedAnalysis = true;
  private analyzerPreference: 'auto' | 'openai' | 'tarsier' | 'ocr';

  constructor() {
    this.ensureTempDir();
    this.frameExtractor = new FrameExtractor();
    this.visualAnalyzer = new VisualAnalyzer();
    this.enhancedAnalyzer = new EnhancedVisualAnalyzer();
    this.focusedAnalyzer = new FocusedAnalyzer();
    this.llmFactory = LLMAnalyzerFactory.getInstance();
    
    // Get analyzer preference from environment
    this.analyzerPreference = (process.env.ANALYZER_PREFERENCE as any) || 'auto';
    if (this.analyzerPreference !== 'auto' && 
        this.analyzerPreference !== 'openai' && 
        this.analyzerPreference !== 'tarsier' && 
        this.analyzerPreference !== 'ocr') {
      logger.warn(`Invalid ANALYZER_PREFERENCE: ${this.analyzerPreference}, using 'auto'`);
      this.analyzerPreference = 'auto';
    }
    logger.info(`Analyzer preference set to: ${this.analyzerPreference}`);
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch {
      // Ignore directory creation errors - may already exist
    }
  }

  async analyze(videoPath: string, options: AnalysisOptions): Promise<AnalysisResult> {
    try {
      // Starting visual analysis - logged to debug file
      
      let llmError: any = undefined;
      
      // Check analyzer preference - explicit preferences override auto mode
      const shouldUseOpenAI = this.analyzerPreference === 'openai' || 
                             (this.analyzerPreference === 'auto' && this.llmFactory.getActiveProvider()?.isAvailable());
      const shouldUseTarsier = this.analyzerPreference === 'tarsier' ||
                              (this.analyzerPreference === 'auto' && !this.llmFactory.getActiveProvider()?.isAvailable());
      
      // When tarsier is explicitly preferred, don't use OpenAI
      const actuallyUseOpenAI = shouldUseOpenAI && this.analyzerPreference !== 'tarsier' && this.analyzerPreference !== 'ocr';
      
      logger.info(`Analyzer preference: ${this.analyzerPreference}, OpenAI available: ${this.llmFactory.getActiveProvider()?.isAvailable()}, will use OpenAI: ${actuallyUseOpenAI}`);
      
      // Try LLM analysis first if available and preferred
      const llmProvider = this.llmFactory.getActiveProvider();
      if (llmProvider && llmProvider.isAvailable() && actuallyUseOpenAI && options.analysisType === 'full_analysis') {
        try {
          logger.info(`Using ${llmProvider.name} for video analysis (preference: ${this.analyzerPreference})`);
          const llmResult = await llmProvider.analyzeVideo(videoPath, options.duration);
          
          // Convert OpenAI result to our format
          return {
            videoPath,
            duration: options.duration,
            analysisType: options.analysisType,
            timestamp: new Date().toISOString(),
            results: {
              summary: llmResult.summary,
              errors: llmResult.errors,
              warnings: llmResult.warnings,
              userActions: llmResult.keyActions,
              currentFile: llmResult.detectedApplications.find(app => app.includes('.')) || undefined,
              keyFrames: llmResult.keyActions.map((action, idx) => ({
                timestamp: (idx / llmResult.keyActions.length) * options.duration * 1000,
                description: action
              })),
              enhancedDetails: {
                context: {
                  appName: llmResult.detectedApplications.join(', '),
                  windowTitle: llmResult.detectedApplications[0],
                  isDarkTheme: false,
                  primaryColors: []
                },
                regions: [],
                clickContexts: [],
                llmAnalysis: {
                  provider: llmProvider.name,
                  description: llmResult.description,
                  confidence: llmResult.confidence
                }
              }
            }
          };
        } catch (error) {
          logger.warn(`${llmProvider.name} analysis failed, falling back to OCR analysis:`, error);
          
          // Store the LLM error for transparency in the response
          llmError = {
            provider: llmProvider.name,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          };
          
          // Continue with fallback analysis
        }
      }
      
      // Initialize analyzers
      if (this.useFocusedAnalysis) {
        await this.focusedAnalyzer.initialize();
      } else if (this.useEnhancedAnalysis) {
        await this.enhancedAnalyzer.initialize();
      } else {
        await this.visualAnalyzer.initialize();
      }
      
      // Extract frames from video
      const frames = await this.frameExtractor.extractFrames(videoPath, {
        interval: options.duration <= 10 ? 0.5 : 1, // More frames for shorter videos
        maxFrames: Math.min(options.duration * 2, 60) // Cap at 60 frames
      });
      
      // Extracted frames - logged to debug file

      const result: AnalysisResult = {
        videoPath,
        duration: options.duration,
        analysisType: options.analysisType,
        timestamp: new Date().toISOString(),
        results: {}
      };

      switch (options.analysisType) {
        case 'ui_elements':
          result.results.uiElements = await this.visualAnalyzer.analyzeUIElements(frames);
          result.results.summary = `Detected ${result.results.uiElements.length} UI elements across ${frames.length} frames`;
          break;
        
        case 'mouse_activity':
          result.results.mouseActivity = await this.visualAnalyzer.analyzeMouseActivity(frames);
          result.results.summary = `Tracked mouse movement across ${frames.length} frames with ${result.results.mouseActivity.clicks.length} clicks detected`;
          break;
        
        case 'full_analysis': {
          if (this.useFocusedAnalysis) {
            // Use analyzer based on preference
            let focusedResult;
            
            if (this.analyzerPreference === 'ocr') {
              // Force OCR only
              const frames = await this.frameExtractor.extractFrames(videoPath, {
                interval: options.duration <= 10 ? 0.5 : 1,
                maxFrames: Math.min(options.duration * 2, 60)
              });
              focusedResult = await this.focusedAnalyzer.analyzeForActionableInfo(frames);
            } else {
              // Use Tarsier (with OCR fallback unless explicitly disabled)
              focusedResult = await this.focusedAnalyzer.analyzeVideoWithTarsier(videoPath, {
                frameCount: Math.min(options.duration * 2, 16),
                fallbackToOCR: this.analyzerPreference !== 'tarsier'
              });
            }
            
            // Simple mock click data for context analysis (only if OCR was used)
            let clickContexts: string[] = [];
            if (focusedResult.analysisMethod === 'ocr') {
              const mockClicks = [
                { x: 1512, y: 982, timestamp: frames[Math.floor(frames.length * 0.6)]?.timestamp || 0 },
                { x: 1512, y: 982, timestamp: frames[Math.floor(frames.length * 0.7)]?.timestamp || 0 }
              ];
              clickContexts = await this.focusedAnalyzer.analyzeMouseClickContext(frames, mockClicks);
            }
            
            result.results.summary = focusedResult.summary;
            result.results.keyFrames = focusedResult.importantText.map((item) => ({
              timestamp: item.timestamp || 0,
              description: `${item.category}: ${item.text}`
            }));
            
            // Add focused details with enhanced information
            result.results.enhancedDetails = {
              context: {
                appName: focusedResult.application,
                windowTitle: focusedResult.currentFile,
                isDarkTheme: true,
                primaryColors: []
              },
              regions: [],
              clickContexts: clickContexts.map(ctx => ({
                position: { x: 1512, y: 982 },
                nearbyText: ctx,
                timestamp: 0
              })),
              tarsierAnalysis: focusedResult.tarsierAnalysis ? {
                provider: 'Tarsier2-Recap-7B',
                description: focusedResult.tarsierAnalysis.analysis || '',
                confidence: 0.9,
                processingTime: focusedResult.tarsierAnalysis.processing_time_seconds,
                device: focusedResult.tarsierAnalysis.device,
                analysisMethod: focusedResult.analysisMethod || 'tarsier'
              } : undefined
            };
            
            // Override with focused results
            result.results.errors = focusedResult.errors;
            result.results.warnings = focusedResult.warnings;
            result.results.currentFile = focusedResult.currentFile;
            result.results.userActions = focusedResult.userActions;
            
          } else if (this.useEnhancedAnalysis) {
            // Fallback to enhanced analysis
            const enhancedResult = await this.enhancedAnalyzer.analyzeFrames(frames);
            const { activity, clickContexts } = await this.enhancedAnalyzer.analyzeMouseActivityWithContext(frames);
            
            result.results.summary = enhancedResult.summary;
            result.results.mouseActivity = activity;
            result.results.keyFrames = enhancedResult.timeline.map(event => ({
              timestamp: event.timestamp,
              description: `${event.event}: ${JSON.stringify(event.details || {}).substring(0, 100)}`
            }));
            
            result.results.enhancedDetails = {
              context: enhancedResult.context,
              regions: enhancedResult.regions,
              clickContexts
            };
          } else {
            // Fallback to standard analysis
            const [uiElements, mouseActivity, sceneDescription] = await Promise.all([
              this.visualAnalyzer.analyzeUIElements(frames),
              this.visualAnalyzer.analyzeMouseActivity(frames),
              this.visualAnalyzer.generateSceneDescription(frames)
            ]);
            
            result.results.uiElements = uiElements;
            result.results.mouseActivity = mouseActivity;
            result.results.keyFrames = await this.extractKeyFrames(frames, sceneDescription);
            result.results.summary = await this.generateComprehensiveSummary(
              uiElements, 
              mouseActivity, 
              sceneDescription,
              frames.length
            );
          }
          break;
        }
      }

      // Cleanup
      if (this.useFocusedAnalysis) {
        await this.focusedAnalyzer.cleanup();
      } else if (this.useEnhancedAnalysis) {
        await this.enhancedAnalyzer.cleanup();
      } else {
        await this.visualAnalyzer.cleanup();
      }
      
      // Add LLM error information if fallback was used
      if (llmError) {
        result.results.llmError = llmError;
      }
      
      // Analysis completed - logged to debug file
      return result;
    } catch (error) {
      // Video analysis failed - log error for debugging
      console.error('Video analysis failed:', error);
      
      // Cleanup on error
      try {
        if (this.useFocusedAnalysis) {
          await this.focusedAnalyzer.cleanup();
        } else if (this.useEnhancedAnalysis) {
          await this.enhancedAnalyzer.cleanup();
        } else {
          await this.visualAnalyzer.cleanup();
        }
      } catch {
        // Ignore cleanup errors
      }
      
      throw error;
    }
  }

  private async generateComprehensiveSummary(
    uiElements: UIElement[],
    mouseActivity: MouseActivity,
    sceneDescription: string,
    frameCount: number
  ): Promise<string> {
    const parts: string[] = [];
    
    // UI Elements summary
    const elementTypes = uiElements.reduce((acc, el) => {
      acc[el.type] = (acc[el.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const elementSummary = Object.entries(elementTypes)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');
    
    if (elementSummary) {
      parts.push(`Detected ${elementSummary}.`);
    }
    
    // Mouse activity summary
    if (mouseActivity.positions.length > 0) {
      parts.push(
        `Mouse moved ${Math.round(mouseActivity.totalDistance)} pixels ` +
        `at ${mouseActivity.averageSpeed.toFixed(1)} pixels/second ` +
        `with ${mouseActivity.clicks.length} click${mouseActivity.clicks.length !== 1 ? 's' : ''}.`
      );
    }
    
    // Scene description
    if (sceneDescription) {
      parts.push(sceneDescription);
    }
    
    // Frame analysis summary
    parts.push(`Analyzed ${frameCount} frames from the desktop recording.`);
    
    return parts.join(' ');
  }

  private async extractKeyFrames(
    frames: ExtractedFrame[], 
    sceneDescription: string
  ): Promise<Array<{ timestamp: number; description: string }>> {
    const keyFrames = [];
    
    // Extract key moments from scene description
    const timeMatches = sceneDescription.matchAll(/At (\d+\.?\d*)s: ([^.]+)/g);
    
    for (const match of timeMatches) {
      keyFrames.push({
        timestamp: parseFloat(match[1]) * 1000,
        description: match[2].trim()
      });
    }
    
    // Add start and end if not already included
    if (keyFrames.length === 0 && frames.length > 0) {
      keyFrames.push({
        timestamp: 0,
        description: 'Recording started'
      });
      
      if (frames.length > 1) {
        keyFrames.push({
          timestamp: frames[frames.length - 1].timestamp,
          description: 'Recording ended'
        });
      }
    }
    
    return keyFrames.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async getVideoDuration(videoPath: string): Promise<number> {
    const data = await this.extractFrameData(videoPath);
    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    return parseFloat(videoStream?.duration || '0');
  }

  private async extractFrameData(videoPath: string): Promise<{
    streams?: Array<{
      codec_type: string;
      nb_frames?: string;
      duration?: string;
    }>;
  }> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        videoPath
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output));
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`ffprobe exited with code ${code}`));
        }
      });
    });
  }
}