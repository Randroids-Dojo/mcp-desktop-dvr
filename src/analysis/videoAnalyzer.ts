import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AnalysisOptions, AnalysisResult, UIElement, MouseActivity } from './types.js';
import { FrameExtractor, ExtractedFrame } from './frameExtractor.js';
import { VisualAnalyzer } from './visualAnalyzer.js';
import { EnhancedVisualAnalyzer } from './enhancedVisualAnalyzer.js';
import { FocusedAnalyzer } from './focusedAnalyzer.js';

export class VideoAnalyzer {
  private readonly tempDir = path.join(process.env.HOME || '', '.mcp-desktop-dvr', 'analysis');
  private frameExtractor: FrameExtractor;
  private visualAnalyzer: VisualAnalyzer;
  private enhancedAnalyzer: EnhancedVisualAnalyzer;
  private focusedAnalyzer: FocusedAnalyzer;
  private useEnhancedAnalysis = true;
  private useFocusedAnalysis = true;

  constructor() {
    this.ensureTempDir();
    this.frameExtractor = new FrameExtractor();
    this.visualAnalyzer = new VisualAnalyzer();
    this.enhancedAnalyzer = new EnhancedVisualAnalyzer();
    this.focusedAnalyzer = new FocusedAnalyzer();
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
            // Use focused analysis for actionable information
            const focusedResult = await this.focusedAnalyzer.analyzeForActionableInfo(frames);
            
            // Simple mock click data for context analysis
            const mockClicks = [
              { x: 1512, y: 982, timestamp: frames[Math.floor(frames.length * 0.6)]?.timestamp || 0 },
              { x: 1512, y: 982, timestamp: frames[Math.floor(frames.length * 0.7)]?.timestamp || 0 }
            ];
            
            const clickContexts = await this.focusedAnalyzer.analyzeMouseClickContext(frames, mockClicks);
            
            result.results.summary = focusedResult.summary;
            result.results.keyFrames = focusedResult.importantText.map((item) => ({
              timestamp: item.timestamp || 0,
              description: `${item.category}: ${item.text}`
            }));
            
            // Add focused details with actionable information
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
              }))
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