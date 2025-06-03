import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ExtractedFrame } from './frameExtractor.js';
import { TarsierAnalyzer, TarsierAnalysisResult } from './tarsierAnalyzer.js';

interface ImportantText {
  category: 'error' | 'warning' | 'info' | 'code' | 'ui_state' | 'file_path' | 'action';
  text: string;
  confidence: number;
  location?: string;
  timestamp?: number;
}

interface FocusedAnalysisResult {
  application?: string;
  errors: string[];
  warnings: string[];
  importantText: ImportantText[];
  currentFile?: string;
  clickedElements: string[];
  userActions: string[];
  summary: string;
  tarsierAnalysis?: TarsierAnalysisResult;
  analysisMethod?: 'ocr' | 'tarsier' | 'hybrid';
}

export class FocusedAnalyzer {
  private tesseractWorker: Tesseract.Worker | null = null;
  private tarsierAnalyzer: TarsierAnalyzer;
  private debugDir: string;
  private saveDebugFrames = true;

  constructor() {
    this.tarsierAnalyzer = new TarsierAnalyzer();
    this.debugDir = path.join(process.env.HOME || os.homedir(), '.mcp-desktop-dvr', 'debug-frames');
    this.ensureDebugDir();
  }

  private async ensureDebugDir(): Promise<void> {
    if (this.saveDebugFrames) {
      try {
        await fs.mkdir(this.debugDir, { recursive: true });
      } catch {
        // Ignore directory creation errors - may already exist
      }
    }
  }

  async initialize(): Promise<void> {
    this.tesseractWorker = await Tesseract.createWorker('eng');
    await this.tesseractWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1',
    });
  }

  async cleanup(): Promise<void> {
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
  }

  async analyzeForActionableInfo(frames: ExtractedFrame[]): Promise<FocusedAnalysisResult> {
    // Analyzing frames for actionable information
    
    const result: FocusedAnalysisResult = {
      errors: [],
      warnings: [],
      importantText: [],
      clickedElements: [],
      userActions: [],
      summary: '',
      analysisMethod: 'ocr'
    };

    // Sample frames strategically - first, middle, last, and around changes
    const keyFrames = this.selectKeyFrames(frames);
    
    // Extract text from all key frames
    const allText: Map<number, string[]> = new Map();
    
    for (const frame of keyFrames) {
      const text = await this.extractAllText(frame);
      allText.set(frame.frameNumber, text);
      
      // Look for important patterns
      this.findImportantPatterns(text, result, frame.timestamp);
    }

    // Detect application
    result.application = this.detectApplication(allText);
    
    // Find current file being edited
    result.currentFile = this.findCurrentFile(allText);
    
    // Detect user actions by comparing frames
    result.userActions = await this.detectUserActions(frames, allText);
    
    // Generate focused summary
    result.summary = this.generateFocusedSummary(result);
    
    return result;
  }

  async analyzeVideoWithTarsier(videoPath: string, options: {
    frameCount?: number;
    fallbackToOCR?: boolean;
  } = {}): Promise<FocusedAnalysisResult> {
    const { frameCount = 16, fallbackToOCR = true } = options;
    
    const result: FocusedAnalysisResult = {
      errors: [],
      warnings: [],
      importantText: [],
      clickedElements: [],
      userActions: [],
      summary: '',
      analysisMethod: 'tarsier'
    };

    // Try Tarsier analysis first
    try {
      const isAvailable = await this.tarsierAnalyzer.isAvailable();
      if (isAvailable) {
        const tarsierResult = await this.tarsierAnalyzer.analyzeVideo(videoPath, {
          frameCount,
          prompt: "Analyze this desktop recording focusing on: 1) Application being used, 2) Errors or warnings visible, 3) File being edited, 4) User actions and interactions, 5) UI state changes. Identify specific issues that need attention."
        });
        
        result.tarsierAnalysis = tarsierResult;
        
        // Extract structured data from Tarsier analysis
        if (tarsierResult.analysis) {
          this.extractStructuredInfoFromTarsier(tarsierResult.analysis, result);
        }
        
        result.summary = this.generateTarsierFocusedSummary(result);
        return result;
      }
    } catch (error) {
      console.warn('Tarsier analysis failed:', error);
    }

    // Fallback to OCR analysis
    if (fallbackToOCR) {
      try {
        result.analysisMethod = 'ocr';
        const { FrameExtractor } = await import('./frameExtractor.js');
        const frameExtractor = new FrameExtractor();
        
        const frames = await frameExtractor.extractFrames(videoPath, {
          interval: 1,
          maxFrames: frameCount
        });
        
        return await this.analyzeForActionableInfo(frames);
      } catch (error) {
        console.warn('OCR analysis also failed:', error);
      }
    }

    result.summary = "Analysis failed: Unable to analyze video content with either Tarsier or OCR methods.";
    return result;
  }

  private extractStructuredInfoFromTarsier(analysis: string, result: FocusedAnalysisResult): void {
    const lines = analysis.split('\n');
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      // Extract application name
      if (lowerLine.includes('application') || lowerLine.includes('software') || lowerLine.includes('program')) {
        // Try to extract specific app names
        const apps = ['godot', 'visual studio code', 'vscode', 'chrome', 'firefox', 'safari', 'terminal', 'xcode', 'unity'];
        for (const app of apps) {
          if (lowerLine.includes(app)) {
            result.application = app;
            break;
          }
        }
      }
      
      // Extract errors and warnings
      if (lowerLine.includes('error') || lowerLine.includes('fail') || lowerLine.includes('exception')) {
        result.errors.push(line.trim());
        result.importantText.push({
          category: 'error',
          text: line.trim(),
          confidence: 0.8
        });
      }
      
      if (lowerLine.includes('warning') || lowerLine.includes('warn') || lowerLine.includes('deprecated')) {
        result.warnings.push(line.trim());
        result.importantText.push({
          category: 'warning',
          text: line.trim(),
          confidence: 0.7
        });
      }
      
      // Extract file information
      if (line.match(/\.(gd|tscn|tres|cs|js|py|cpp|h|txt|json|xml|yaml|yml)[\s\]]/i)) {
        const match = line.match(/([a-zA-Z0-9_.-]+\.(gd|tscn|tres|cs|js|py|cpp|h|txt|json|xml|yaml|yml))/i);
        if (match) {
          result.currentFile = match[1];
          result.importantText.push({
            category: 'file_path',
            text: match[1],
            confidence: 0.8
          });
        }
      }
      
      // Extract user actions
      if (lowerLine.includes('click') || lowerLine.includes('select') || lowerLine.includes('press') || 
          lowerLine.includes('type') || lowerLine.includes('edit') || lowerLine.includes('open')) {
        result.userActions.push(line.trim());
        result.importantText.push({
          category: 'action',
          text: line.trim(),
          confidence: 0.6
        });
      }
    }
  }

  private generateTarsierFocusedSummary(result: FocusedAnalysisResult): string {
    const parts: string[] = [];
    
    // Start with AI analysis
    if (result.tarsierAnalysis?.analysis) {
      parts.push("🤖 **AI Visual Analysis:**");
      parts.push(result.tarsierAnalysis.analysis);
      parts.push("");
    }
    
    // Add structured findings
    if (result.application) {
      parts.push(`📱 **Application:** ${result.application}`);
    }
    
    if (result.currentFile) {
      parts.push(`📄 **File:** ${result.currentFile}`);
    }
    
    // Errors - MOST IMPORTANT
    if (result.errors.length > 0) {
      parts.push("❌ **ERRORS DETECTED:**");
      result.errors.forEach(error => {
        parts.push(`- ${error}`);
      });
      parts.push("");
    }
    
    // Warnings
    if (result.warnings.length > 0) {
      parts.push("⚠️ **Warnings:**");
      result.warnings.forEach(warning => {
        parts.push(`- ${warning}`);
      });
      parts.push("");
    }
    
    // Key actions
    if (result.userActions.length > 0) {
      parts.push("🎯 **Actions:**");
      result.userActions.slice(0, 3).forEach(action => {
        parts.push(`- ${action}`);
      });
    }
    
    // Analysis quality note
    if (result.tarsierAnalysis) {
      parts.push(`\n📊 **Analysis Quality:** Advanced AI vision analysis (${result.tarsierAnalysis.processing_time_seconds}s processing time)`);
      parts.push(`🖥️ **Device:** ${result.tarsierAnalysis.device}`);
    }
    
    return parts.join('\n');
  }

  private selectKeyFrames(frames: ExtractedFrame[]): ExtractedFrame[] {
    if (frames.length <= 5) return frames;
    
    const keyFrames: ExtractedFrame[] = [];
    
    // Always include first and last
    keyFrames.push(frames[0]);
    
    // Include frames at regular intervals
    const interval = Math.floor(frames.length / 4);
    for (let i = interval; i < frames.length - 1; i += interval) {
      keyFrames.push(frames[i]);
    }
    
    keyFrames.push(frames[frames.length - 1]);
    
    return keyFrames;
  }

  private async extractAllText(frame: ExtractedFrame): Promise<string[]> {
    try {
      // First, try with standard preprocessing
      let allText: string[] = [];
      
      // Extract from full frame
      const fullText = await this.extractTextFromImage(frame.framePath, false);
      allText.push(...fullText);
      
      // If we got very little text, try aggressive preprocessing
      if (allText.join(' ').length < 100) {
        const aggressiveText = await this.extractTextFromImage(frame.framePath, true);
        allText.push(...aggressiveText);
      }
      
      // Also extract from specific regions known to contain errors/important info
      const importantRegions = await this.extractFromImportantRegions(frame.framePath);
      allText.push(...importantRegions);
      
      // Remove duplicates and empty strings
      return [...new Set(allText.filter(t => t.trim().length > 0))];
    } catch {
      // Text extraction failed - return empty array
      return [];
    }
  }

  private async extractTextFromImage(imagePath: string, aggressive: boolean): Promise<string[]> {
    if (!this.tesseractWorker) {
      await this.initialize();
    }

    try {
      let processedPath = imagePath;
      
      if (aggressive) {
        // Aggressive preprocessing for dark themes
        const processed = await sharp(imagePath)
          .negate()
          .normalize()
          .sharpen()
          .threshold(128)
          .toBuffer();
        
        processedPath = path.join(this.debugDir, `processed_${Date.now()}.png`);
        await fs.writeFile(processedPath, processed);
      }
      
      const result = await this.tesseractWorker!.recognize(processedPath);
      
      // Clean up temporary file
      if (aggressive && processedPath !== imagePath) {
        try {
          await fs.unlink(processedPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      
      return result.data.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    } catch {
      // OCR text extraction failed - return empty array
      return [];
    }
  }

  private async extractFromImportantRegions(imagePath: string): Promise<string[]> {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) return [];
    
    const regions = [
      // Error/console region (usually bottom)
      { name: 'console', x: 0, y: metadata.height - 300, width: metadata.width, height: 300 },
      // Status bar
      { name: 'status', x: 0, y: metadata.height - 40, width: metadata.width, height: 40 },
      // Center dialog/popup area
      { name: 'dialog', x: metadata.width / 4, y: metadata.height / 4, width: metadata.width / 2, height: metadata.height / 2 }
    ];
    
    const allText: string[] = [];
    
    for (const region of regions) {
      try {
        const regionBuffer = await image
          .extract({
            left: Math.max(0, region.x),
            top: Math.max(0, region.y),
            width: Math.min(region.width, metadata.width - region.x),
            height: Math.min(region.height, metadata.height - region.y)
          })
          .toBuffer();
        
        // Save debug frame if enabled
        if (this.saveDebugFrames) {
          const debugPath = path.join(this.debugDir, `${region.name}_${Date.now()}.png`);
          await fs.writeFile(debugPath, regionBuffer);
        }
        
        // Extract text with aggressive preprocessing for these important regions
        const tempPath = path.join(this.debugDir, `temp_region_${Date.now()}.png`);
        await fs.writeFile(tempPath, regionBuffer);
        
        const text = await this.extractTextFromImage(tempPath, true);
        allText.push(...text);
        
        // Cleanup
        try {
          await fs.unlink(tempPath);
        } catch {
          // Ignore
        }
      } catch {
        // Region analysis failed - continue with next region
      }
    }
    
    return allText;
  }

  private findImportantPatterns(textLines: string[], result: FocusedAnalysisResult, timestamp: number): void {
    for (const line of textLines) {
      const lowerLine = line.toLowerCase();
      
      // Error patterns
      if (lowerLine.includes('error') || lowerLine.includes('exception') || lowerLine.includes('failed')) {
        if (!result.errors.includes(line)) {
          result.errors.push(line);
          result.importantText.push({
            category: 'error',
            text: line,
            confidence: 0.9,
            timestamp
          });
        }
      }
      
      // Warning patterns
      else if (lowerLine.includes('warning') || lowerLine.includes('warn') || lowerLine.includes('deprecated')) {
        if (!result.warnings.includes(line)) {
          result.warnings.push(line);
          result.importantText.push({
            category: 'warning',
            text: line,
            confidence: 0.8,
            timestamp
          });
        }
      }
      
      // File paths
      else if (line.match(/\.(gd|tscn|tres|cs|js|py|cpp|h|txt|json|xml|yaml|yml)$/i)) {
        result.importantText.push({
          category: 'file_path',
          text: line,
          confidence: 0.7,
          timestamp
        });
      }
      
      // Code snippets (function definitions, class names)
      else if (line.match(/^(func|def|class|function|method|var|const|let)\s+\w+/)) {
        result.importantText.push({
          category: 'code',
          text: line,
          confidence: 0.6,
          timestamp
        });
      }
      
      // UI state changes
      else if (lowerLine.includes('clicked') || lowerLine.includes('pressed') || 
               lowerLine.includes('selected') || lowerLine.includes('opened')) {
        result.importantText.push({
          category: 'ui_state',
          text: line,
          confidence: 0.5,
          timestamp
        });
      }
    }
  }

  private detectApplication(allText: Map<number, string[]>): string | undefined {
    const appIndicators = [
      { pattern: /godot/i, name: 'Godot Engine' },
      { pattern: /unity/i, name: 'Unity' },
      { pattern: /visual studio code|vscode/i, name: 'VS Code' },
      { pattern: /xcode/i, name: 'Xcode' },
      { pattern: /android studio/i, name: 'Android Studio' },
      { pattern: /intellij/i, name: 'IntelliJ IDEA' },
      { pattern: /chrome/i, name: 'Chrome' },
      { pattern: /firefox/i, name: 'Firefox' },
      { pattern: /terminal|iterm/i, name: 'Terminal' }
    ];
    
    // Check all text for app indicators
    const detectedApps: string[] = [];
    for (const lines of allText.values()) {
      const combinedText = lines.join(' ');
      for (const { pattern, name } of appIndicators) {
        if (pattern.test(combinedText)) {
          if (!detectedApps.includes(name)) {
            detectedApps.push(name);
          }
        }
      }
    }
    
    // Look for specific Godot contexts
    if (detectedApps.includes('Godot Engine')) {
      const hasGameContent = this.detectGameContent(allText);
      const hasEditorContent = this.detectEditorContent(allText);
      
      if (hasGameContent && hasEditorContent) {
        return 'Godot Engine (Editor + Game)';
      } else if (hasGameContent) {
        return 'Godot Game';
      } else if (hasEditorContent) {
        return 'Godot Engine';
      }
    }
    
    return detectedApps.length > 0 ? detectedApps.join(', ') : undefined;
  }

  private detectGameContent(allText: Map<number, string[]>): boolean {
    const gameIndicators = [
      /fps.*\d+/i,
      /score.*\d+/i,
      /level.*\d+/i,
      /health.*\d+/i,
      /player/i,
      /game.*over/i,
      /pause/i,
      /resume/i,
      /start.*game/i,
      /new.*game/i
    ];
    
    for (const lines of allText.values()) {
      const combinedText = lines.join(' ');
      for (const pattern of gameIndicators) {
        if (pattern.test(combinedText)) {
          return true;
        }
      }
    }
    return false;
  }

  private detectEditorContent(allText: Map<number, string[]>): boolean {
    const editorIndicators = [
      /inspector/i,
      /scene/i,
      /filesystem/i,
      /script/i,
      /node/i,
      /project/i,
      /import/i,
      /export/i,
      /debug/i,
      /console/i,
      /\.gd\b/i,
      /\.tscn\b/i,
      /func\s+\w+/i
    ];
    
    for (const lines of allText.values()) {
      const combinedText = lines.join(' ');
      for (const pattern of editorIndicators) {
        if (pattern.test(combinedText)) {
          return true;
        }
      }
    }
    return false;
  }

  private findCurrentFile(allText: Map<number, string[]>): string | undefined {
    // Look for file paths in editor tabs or title bars
    const filePatterns = [
      /([a-zA-Z0-9_-]+\.(gd|tscn|tres|cs|js|py|cpp|h|txt|json))/g,
      /editing:\s*([^\s]+\.[a-z]+)/i,
      /\[([^\]]+\.[a-z]+)\]/
    ];
    
    for (const lines of allText.values()) {
      for (const line of lines) {
        for (const pattern of filePatterns) {
          const match = line.match(pattern);
          if (match) {
            return match[1] || match[0];
          }
        }
      }
    }
    
    return undefined;
  }

  private async detectUserActions(frames: ExtractedFrame[], allText: Map<number, string[]>): Promise<string[]> {
    const actions: string[] = [];
    
    // Simple action detection based on text changes
    let previousText: Set<string> = new Set();
    
    for (const lines of allText.values()) {
      const currentText = new Set(lines);
      
      // Find new text that appeared
      const newText = [...currentText].filter(t => !previousText.has(t));
      
      // Analyze new text for actions
      for (const text of newText) {
        if (text.includes('clicked') || text.includes('pressed')) {
          actions.push(`Clicked: ${text}`);
        } else if (text.includes('opened') || text.includes('loaded')) {
          actions.push(`Opened: ${text}`);
        } else if (text.includes('saved') || text.includes('exported')) {
          actions.push(`Saved: ${text}`);
        }
      }
      
      previousText = currentText;
    }
    
    return actions;
  }

  private generateFocusedSummary(result: FocusedAnalysisResult): string {
    const parts: string[] = [];
    
    // Start with application if detected
    if (result.application) {
      parts.push(`Working in ${result.application}.`);
    }
    
    // Handle game-specific analysis differently
    const isGameContent = result.application?.includes('Game') || result.application?.includes('Editor + Game');
    
    if (isGameContent) {
      return this.generateGameFocusedSummary(result);
    }
    
    // Current file (for editor content)
    if (result.currentFile) {
      parts.push(`Editing: ${result.currentFile}`);
    }
    
    // Errors - MOST IMPORTANT
    if (result.errors.length > 0) {
      parts.push(`\n**ERRORS DETECTED:**`);
      result.errors.forEach(error => {
        parts.push(`- ${error}`);
      });
    }
    
    // Warnings
    if (result.warnings.length > 0) {
      parts.push(`\n**Warnings:**`);
      result.warnings.forEach(warning => {
        parts.push(`- ${warning}`);
      });
    }
    
    // Key actions
    if (result.userActions.length > 0) {
      parts.push(`\n**Actions:**`);
      result.userActions.slice(0, 3).forEach(action => {
        parts.push(`- ${action}`);
      });
    }
    
    // If nothing important found, say so
    if (result.errors.length === 0 && result.warnings.length === 0 && result.userActions.length === 0) {
      parts.push('No errors, warnings, or significant actions detected.');
    }
    
    return parts.join('\n');
  }

  private generateGameFocusedSummary(result: FocusedAnalysisResult): string {
    const parts: string[] = [];
    
    parts.push(`Working in ${result.application}.`);
    
    // For game content, focus on visual interactions rather than text
    if (result.clickedElements.length > 0) {
      parts.push(`\n**Game Interactions:**`);
      result.clickedElements.forEach(element => {
        parts.push(`- ${element}`);
      });
    }
    
    // Still report errors/warnings if found
    if (result.errors.length > 0) {
      parts.push(`\n**Issues:**`);
      result.errors.forEach(error => {
        parts.push(`- ${error}`);
      });
    }
    
    if (result.warnings.length > 0) {
      result.warnings.forEach(warning => {
        parts.push(`- ${warning}`);
      });
    }
    
    // Game-specific note about OCR limitations
    if (result.clickedElements.length === 0 && result.errors.length === 0 && result.warnings.length === 0) {
      parts.push('\n**Note:** Game content detected but specific interactions are difficult to analyze through text extraction.');
      parts.push('Visual analysis shows game activity but may not capture detailed gameplay mechanics.');
      parts.push('Consider using shorter analysis windows (10-15 seconds) focused on specific interactions for better results.');
    }
    
    return parts.join('\n');
  }

  async analyzeMouseClickContext(frames: ExtractedFrame[], clickPositions: Array<{x: number, y: number, timestamp: number}>): Promise<string[]> {
    const clickContexts: string[] = [];
    
    for (const click of clickPositions) {
      // Find the frame closest to this click
      const frameIndex = this.findClosestFrame(frames, click.timestamp);
      if (frameIndex >= 0) {
        const frame = frames[frameIndex];
        
        // Extract text around click position
        const context = await this.extractTextAroundPosition(frame.framePath, click);
        if (context) {
          clickContexts.push(`Click at (${click.x}, ${click.y}): ${context}`);
        }
      }
    }
    
    return clickContexts;
  }

  private findClosestFrame(frames: ExtractedFrame[], timestamp: number): number {
    let closestIndex = -1;
    let minDiff = Infinity;
    
    for (let i = 0; i < frames.length; i++) {
      const diff = Math.abs(frames[i].timestamp - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }
    
    return closestIndex;
  }

  private async extractTextAroundPosition(framePath: string, position: {x: number, y: number}): Promise<string | null> {
    try {
      const image = sharp(framePath);
      const metadata = await image.metadata();
      
      if (!metadata.width || !metadata.height) return null;
      
      // Extract a 300x200 region around the click
      const regionSize = { width: 300, height: 200 };
      const bounds = {
        left: Math.max(0, position.x - regionSize.width / 2),
        top: Math.max(0, position.y - regionSize.height / 2),
        width: Math.min(regionSize.width, metadata.width - position.x + regionSize.width / 2),
        height: Math.min(regionSize.height, metadata.height - position.y + regionSize.height / 2)
      };
      
      const regionBuffer = await image.extract(bounds).toBuffer();
      
      // Extract text with aggressive preprocessing
      const tempPath = path.join(this.debugDir, `click_region_${Date.now()}.png`);
      await fs.writeFile(tempPath, regionBuffer);
      
      const text = await this.extractTextFromImage(tempPath, true);
      
      // Cleanup
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore
      }
      
      return text.join(' ').substring(0, 100);
    } catch {
      // Click position text extraction failed
      return null;
    }
  }
}