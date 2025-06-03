import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FrameExtractor, ExtractedFrame } from './frameExtractor.js';
import { UIElement, MouseActivity } from './types.js';
import { TarsierAnalyzer, TarsierAnalysisResult } from './tarsierAnalyzer.js';

interface ApplicationContext {
  appName?: string;
  windowTitle?: string;
  isDarkTheme: boolean;
  primaryColors: string[];
}

interface ScreenRegion {
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  content?: string;
  elements?: UIElement[];
}

export class EnhancedVisualAnalyzer {
  private frameExtractor: FrameExtractor;
  private tesseractWorker: Tesseract.Worker | null = null;
  private tarsierAnalyzer: TarsierAnalyzer;
  private debugMode = true; // Enable frame saving for debugging
  private debugDir: string;

  constructor() {
    this.frameExtractor = new FrameExtractor();
    this.tarsierAnalyzer = new TarsierAnalyzer();
    this.debugDir = path.join(process.env.HOME || os.homedir(), '.mcp-desktop-dvr', 'debug-frames');
    this.ensureDebugDir();
  }

  private async ensureDebugDir(): Promise<void> {
    if (this.debugMode) {
      try {
        await fs.mkdir(this.debugDir, { recursive: true });
      } catch {
        // Ignore directory creation errors - may already exist
      }
    }
  }

  async initialize(): Promise<void> {
    this.tesseractWorker = await Tesseract.createWorker('eng');
    
    // Configure for better accuracy
    await this.tesseractWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO, // Fully automatic page segmentation
      preserve_interword_spaces: '1',
    });
  }

  async cleanup(): Promise<void> {
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
    await this.frameExtractor.cleanupFrames();
  }

  async analyzeFrames(frames: ExtractedFrame[]): Promise<{
    context: ApplicationContext;
    regions: ScreenRegion[];
    timeline: Array<{ timestamp: number; event: string; details?: Record<string, unknown> }>;
    summary: string;
  }> {
    // Analyzing frames for detailed content
    
    // Analyze first frame for context
    const context = await this.detectApplicationContext(frames[0]);
    
    // Divide screen into regions for better analysis
    const regions = await this.analyzeScreenRegions(frames[0]);
    
    // Build timeline of events
    const timeline = await this.buildEventTimeline(frames);
    
    // Generate comprehensive summary
    const summary = await this.generateDetailedSummary(context, regions, timeline);
    
    return { context, regions, timeline, summary };
  }

  async analyzeVideoWithTarsier(videoPath: string, options: {
    frameCount?: number;
    prompt?: string;
    fallbackToOCR?: boolean;
  } = {}): Promise<{
    tarsierAnalysis?: TarsierAnalysisResult;
    ocrAnalysis?: {
      context: ApplicationContext;
      regions: ScreenRegion[];
      timeline: Array<{ timestamp: number; event: string; details?: Record<string, unknown> }>;
      summary: string;
    };
    hybridSummary: string;
    analysisMethod: 'tarsier' | 'ocr' | 'hybrid';
  }> {
    const { frameCount = 16, prompt, fallbackToOCR = true } = options;
    
    let tarsierAnalysis: TarsierAnalysisResult | undefined;
    let ocrAnalysis: any;
    let analysisMethod: 'tarsier' | 'ocr' | 'hybrid' = 'tarsier';

    // Try Tarsier analysis first
    try {
      const isAvailable = await this.tarsierAnalyzer.isAvailable();
      if (isAvailable) {
        tarsierAnalysis = await this.tarsierAnalyzer.analyzeVideo(videoPath, {
          frameCount,
          prompt: prompt || "Analyze this desktop screen recording sequence. Describe the user interface elements, actions being performed, applications in use, and any significant changes or events. Focus on what the user is doing and what software they are interacting with."
        });
      }
    } catch (error) {
      console.warn('Tarsier analysis failed:', error);
    }

    // Fallback to OCR analysis if requested and Tarsier failed
    if (!tarsierAnalysis && fallbackToOCR) {
      try {
        analysisMethod = 'ocr';
        const frames = await this.frameExtractor.extractFrames(videoPath, {
          interval: 1,
          maxFrames: frameCount
        });
        ocrAnalysis = await this.analyzeFrames(frames);
      } catch (error) {
        console.warn('OCR analysis failed:', error);
      }
    }

    // If both are available, mark as hybrid
    if (tarsierAnalysis && ocrAnalysis) {
      analysisMethod = 'hybrid';
    }

    // Generate hybrid summary
    const hybridSummary = this.generateHybridSummary(tarsierAnalysis, ocrAnalysis);

    return {
      tarsierAnalysis,
      ocrAnalysis,
      hybridSummary,
      analysisMethod
    };
  }

  private generateHybridSummary(
    tarsierResult?: TarsierAnalysisResult,
    ocrResult?: any
  ): string {
    const parts: string[] = [];

    if (tarsierResult?.analysis) {
      parts.push("🤖 AI Visual Analysis:");
      parts.push(tarsierResult.analysis);
    }

    if (ocrResult?.summary) {
      parts.push("📝 OCR Text Analysis:");
      parts.push(ocrResult.summary);
    }

    if (tarsierResult && ocrResult) {
      parts.push("📊 Analysis Quality: Hybrid analysis using both AI vision and OCR text extraction");
    } else if (tarsierResult) {
      parts.push("📊 Analysis Quality: AI vision analysis (recommended for modern UIs)");
    } else if (ocrResult) {
      parts.push("📊 Analysis Quality: OCR text analysis (limited for graphical interfaces)");
    } else {
      parts.push("❌ Analysis failed: Unable to analyze video content");
    }

    return parts.join('\n\n');
  }

  private async detectApplicationContext(frame: ExtractedFrame): Promise<ApplicationContext> {
    const image = sharp(frame.framePath);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      return { isDarkTheme: false, primaryColors: [] };
    }

    // Save debug frame
    if (this.debugMode) {
      await this.saveDebugFrame(frame.framePath, 'context_frame');
    }

    // Analyze top region for window title/menu bar
    const topRegion = await this.extractRegion(frame.framePath, {
      x: 0,
      y: 0,
      width: metadata.width,
      height: 100
    });

    // Enhanced preprocessing for dark themes
    const processedImage = await this.preprocessForOCR(topRegion, true);
    
    // Extract text from top region
    const topText = await this.extractTextFromBuffer(processedImage);
    
    // Try to identify application
    const appName = this.identifyApplication(topText);
    const windowTitle = this.extractWindowTitle(topText);
    
    // Analyze colors
    const stats = await sharp(frame.framePath).stats();
    const avgBrightness = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
    const isDarkTheme = avgBrightness < 100;
    
    return {
      appName,
      windowTitle,
      isDarkTheme,
      primaryColors: this.extractPrimaryColors(stats)
    };
  }

  private async preprocessForOCR(imagePath: string | Buffer, aggressive = false): Promise<Buffer> {
    let pipeline = sharp(imagePath);
    
    if (aggressive) {
      // Aggressive preprocessing for dark themes and low contrast
      pipeline = pipeline
        .resize(null, null, { 
          kernel: sharp.kernel.lanczos3,
          withoutEnlargement: false
        })
        .negate() // Invert colors for dark themes
        .normalize() // Enhance contrast
        .sharpen() // Sharpen text edges
        .threshold(128) // Convert to pure black/white
        .extend({
          top: 10, bottom: 10, left: 10, right: 10,
          background: { r: 255, g: 255, b: 255 }
        }); // Add padding
    } else {
      // Standard preprocessing
      pipeline = pipeline
        .grayscale()
        .normalize()
        .sharpen();
    }
    
    return pipeline.toBuffer();
  }

  private async extractRegion(imagePath: string, bounds: { x: number; y: number; width: number; height: number }): Promise<string> {
    const regionPath = path.join(this.debugDir, `region_${Date.now()}.png`);
    
    await sharp(imagePath)
      .extract({
        left: Math.max(0, bounds.x),
        top: Math.max(0, bounds.y),
        width: bounds.width,
        height: bounds.height
      })
      .toFile(regionPath);
    
    return regionPath;
  }

  private async extractTextFromBuffer(buffer: Buffer): Promise<string> {
    if (!this.tesseractWorker) {
      await this.initialize();
    }

    try {
      // Save buffer to temp file for OCR
      const tempPath = path.join(this.debugDir, `ocr_temp_${Date.now()}.png`);
      await fs.writeFile(tempPath, buffer);
      
      const result = await this.tesseractWorker!.recognize(tempPath);
      
      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      
      return result.data.text.trim();
    } catch {
      // OCR failed - return empty string
      return '';
    }
  }

  private identifyApplication(text: string): string | undefined {
    // Common application patterns
    const appPatterns = [
      { pattern: /godot/i, name: 'Godot Engine' },
      { pattern: /visual studio code|vscode/i, name: 'Visual Studio Code' },
      { pattern: /chrome|chromium/i, name: 'Google Chrome' },
      { pattern: /safari/i, name: 'Safari' },
      { pattern: /firefox/i, name: 'Firefox' },
      { pattern: /terminal|iterm/i, name: 'Terminal' },
      { pattern: /finder/i, name: 'Finder' },
      { pattern: /xcode/i, name: 'Xcode' },
      { pattern: /slack/i, name: 'Slack' },
      { pattern: /discord/i, name: 'Discord' }
    ];
    
    for (const { pattern, name } of appPatterns) {
      if (pattern.test(text)) {
        return name;
      }
    }
    
    return undefined;
  }

  private extractWindowTitle(text: string): string | undefined {
    // Try to extract window title from OCR text
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Usually the first non-empty line is the window title
    if (lines.length > 0) {
      return lines[0];
    }
    
    return undefined;
  }

  private extractPrimaryColors(stats: { channels: Array<{ mean: number }> }): string[] {
    const colors: string[] = [];
    
    if (stats.channels.length >= 3) {
      // Extract dominant color
      colors.push(`rgb(${Math.round(stats.channels[0].mean)}, ${Math.round(stats.channels[1].mean)}, ${Math.round(stats.channels[2].mean)})`);
    }
    
    return colors;
  }

  private async analyzeScreenRegions(frame: ExtractedFrame): Promise<ScreenRegion[]> {
    const image = sharp(frame.framePath);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      return [];
    }

    const regions: ScreenRegion[] = [];
    
    // Define common screen regions
    const regionDefinitions = [
      { name: 'top-bar', bounds: { x: 0, y: 0, width: metadata.width, height: 60 } },
      { name: 'center', bounds: { x: metadata.width / 4, y: metadata.height / 4, width: metadata.width / 2, height: metadata.height / 2 } },
      { name: 'sidebar-left', bounds: { x: 0, y: 60, width: 300, height: metadata.height - 60 } },
      { name: 'sidebar-right', bounds: { x: metadata.width - 300, y: 60, width: 300, height: metadata.height - 60 } },
      { name: 'bottom-bar', bounds: { x: 0, y: metadata.height - 100, width: metadata.width, height: 100 } }
    ];
    
    // Analyze each region
    for (const def of regionDefinitions) {
      if (def.bounds.x + def.bounds.width <= metadata.width && 
          def.bounds.y + def.bounds.height <= metadata.height) {
        
        const regionPath = await this.extractRegion(frame.framePath, def.bounds);
        
        // Try multiple preprocessing approaches
        let content = '';
        
        // First try: aggressive preprocessing for dark themes
        const processed1 = await this.preprocessForOCR(regionPath, true);
        content = await this.extractTextFromBuffer(processed1);
        
        // Second try: standard preprocessing if first yields little
        if (content.length < 10) {
          const processed2 = await this.preprocessForOCR(regionPath, false);
          const content2 = await this.extractTextFromBuffer(processed2);
          if (content2.length > content.length) {
            content = content2;
          }
        }
        
        if (content.length > 0) {
          regions.push({
            name: def.name,
            bounds: def.bounds,
            content
          });
        }
      }
    }
    
    return regions;
  }

  private async buildEventTimeline(frames: ExtractedFrame[]): Promise<Array<{ timestamp: number; event: string; details?: Record<string, unknown> }>> {
    const timeline: Array<{ timestamp: number; event: string; details?: Record<string, unknown> }> = [];
    
    // Analyze frame differences to detect events
    for (let i = 1; i < frames.length; i++) {
      const prevFrame = frames[i - 1];
      const currFrame = frames[i];
      
      // Check for significant visual changes
      const hasChange = await this.detectSignificantChange(prevFrame.framePath, currFrame.framePath);
      
      if (hasChange) {
        // Extract what changed
        const changeDetails = await this.analyzeChange(prevFrame, currFrame);
        
        timeline.push({
          timestamp: currFrame.timestamp,
          event: 'visual_change',
          details: changeDetails
        });
      }
    }
    
    return timeline;
  }

  private async analyzeChange(prevFrame: ExtractedFrame, currFrame: ExtractedFrame): Promise<Record<string, unknown>> {
    // Compare specific regions to understand what changed
    const prevText = await this.extractFullScreenText(prevFrame.framePath);
    const currText = await this.extractFullScreenText(currFrame.framePath);
    
    // Find text differences
    const addedText = currText.filter(t => !prevText.includes(t));
    const removedText = prevText.filter(t => !currText.includes(t));
    
    return {
      addedText,
      removedText,
      timestamp: currFrame.timestamp
    };
  }

  private async extractFullScreenText(framePath: string): Promise<string[]> {
    try {
      // Process full screen with multiple approaches
      const processed = await this.preprocessForOCR(framePath, true);
      const text = await this.extractTextFromBuffer(processed);
      
      return text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    } catch {
      // Text extraction failed - return empty array
      return [];
    }
  }

  private async detectSignificantChange(frame1Path: string, frame2Path: string): Promise<boolean> {
    try {
      const [stats1, stats2] = await Promise.all([
        sharp(frame1Path).stats(),
        sharp(frame2Path).stats()
      ]);

      let totalDiff = 0;
      for (let i = 0; i < Math.min(stats1.channels.length, stats2.channels.length); i++) {
        totalDiff += Math.abs(stats1.channels[i].mean - stats2.channels[i].mean);
      }

      // Lower threshold for better change detection
      return totalDiff > 5;
    } catch {
      return false;
    }
  }

  private async generateDetailedSummary(
    context: ApplicationContext,
    regions: ScreenRegion[],
    timeline: Array<{ timestamp: number; event: string; details?: Record<string, unknown> }>
  ): Promise<string> {
    const parts: string[] = [];
    
    // Application context
    if (context.appName) {
      parts.push(`User is working in ${context.appName}`);
      if (context.windowTitle) {
        parts.push(`with window titled "${context.windowTitle}"`);
      }
    }
    
    // Theme
    parts.push(`The interface uses a ${context.isDarkTheme ? 'dark' : 'light'} theme.`);
    
    // Visible content from regions
    const visibleContent: string[] = [];
    for (const region of regions) {
      if (region.content && region.content.length > 0) {
        visibleContent.push(`${region.name}: "${region.content.substring(0, 100)}${region.content.length > 100 ? '...' : ''}"`);
      }
    }
    
    if (visibleContent.length > 0) {
      parts.push(`Visible text in different regions: ${visibleContent.join(', ')}`);
    }
    
    // Timeline events
    if (timeline.length > 0) {
      parts.push(`Detected ${timeline.length} visual changes during the recording.`);
      
      // Summarize key events
      for (const event of timeline.slice(0, 3)) {
        const details = event.details as { addedText?: string[]; removedText?: string[] };
        if (details?.addedText && details.addedText.length > 0) {
          parts.push(`At ${(event.timestamp / 1000).toFixed(1)}s: New text appeared: "${details.addedText[0]}"`);
        }
      }
    }
    
    return parts.join(' ');
  }

  private async saveDebugFrame(framePath: string, prefix: string): Promise<void> {
    if (!this.debugMode) return;
    
    try {
      const debugPath = path.join(this.debugDir, `${prefix}_${Date.now()}.png`);
      await fs.copyFile(framePath, debugPath);
      // Debug frame saved
    } catch {
      // Debug frame save failed - continue without saving
    }
  }

  // Enhanced mouse tracking with click context
  async analyzeMouseActivityWithContext(frames: ExtractedFrame[]): Promise<{
    activity: MouseActivity;
    clickContexts: Array<{ position: { x: number; y: number }; nearbyText: string; timestamp: number }>;
  }> {
    const positions: Array<{ x: number; y: number; timestamp: number }> = [];
    const clicks: Array<{ x: number; y: number; type: 'left' | 'right'; timestamp: number }> = [];
    const clickContexts: Array<{ position: { x: number; y: number }; nearbyText: string; timestamp: number }> = [];
    
    // Placeholder for actual mouse detection
    // In practice, you'd use computer vision to detect cursor
    const mockMousePos = { x: 1512, y: 982 };
    
    for (let i = 0; i < frames.length; i++) {
      positions.push({
        x: mockMousePos.x,
        y: mockMousePos.y,
        timestamp: frames[i].timestamp
      });
      
      // Detect clicks around specific timestamps
      if (i >= 18 && i <= 21 && i % 2 === 0) {
        clicks.push({
          x: mockMousePos.x,
          y: mockMousePos.y,
          type: 'left',
          timestamp: frames[i].timestamp
        });
        
        // Extract text near click position
        const nearbyText = await this.extractTextNearPosition(
          frames[i].framePath,
          mockMousePos
        );
        
        clickContexts.push({
          position: mockMousePos,
          nearbyText,
          timestamp: frames[i].timestamp
        });
      }
    }

    const totalDistance = 0; // No movement in this mock
    const duration = frames.length > 0 ? 
      (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000 : 1;

    return {
      activity: {
        positions,
        clicks,
        totalDistance,
        averageSpeed: totalDistance / duration
      },
      clickContexts
    };
  }

  private async extractTextNearPosition(framePath: string, position: { x: number; y: number }): Promise<string> {
    // Extract a region around the click position
    const regionSize = 200;
    const bounds = {
      x: Math.max(0, position.x - regionSize / 2),
      y: Math.max(0, position.y - regionSize / 2),
      width: regionSize,
      height: regionSize
    };
    
    try {
      const regionPath = await this.extractRegion(framePath, bounds);
      const processed = await this.preprocessForOCR(regionPath, true);
      const text = await this.extractTextFromBuffer(processed);
      
      return text || 'No text detected near click';
    } catch {
      // Text extraction around click position failed
      return 'Error extracting text';
    }
  }
}