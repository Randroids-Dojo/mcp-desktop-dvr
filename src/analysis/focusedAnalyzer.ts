import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ExtractedFrame } from './frameExtractor.js';

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
}

export class FocusedAnalyzer {
  private tesseractWorker: Tesseract.Worker | null = null;
  private debugDir: string;
  private saveDebugFrames = true;

  constructor() {
    this.debugDir = path.join(process.env.HOME || '', '.mcp-desktop-dvr', 'debug-frames');
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
      summary: ''
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
    for (const lines of allText.values()) {
      const combinedText = lines.join(' ');
      for (const { pattern, name } of appIndicators) {
        if (pattern.test(combinedText)) {
          return name;
        }
      }
    }
    
    return undefined;
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
    
    // Current file
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