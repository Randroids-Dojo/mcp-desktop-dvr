import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { FrameExtractor, ExtractedFrame } from './frameExtractor.js';
import { UIElement, MouseActivity } from './types.js';

interface TextRegion {
  text: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

interface TesseractWord {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  confidence: number;
}

interface ColorAnalysis {
  dominantColors: Array<{ color: string; percentage: number }>;
  isDarkMode: boolean;
  averageBrightness: number;
}

export class VisualAnalyzer {
  private frameExtractor: FrameExtractor;
  private tesseractWorker: Tesseract.Worker | null = null;

  constructor() {
    this.frameExtractor = new FrameExtractor();
  }

  async initialize(): Promise<void> {
    // Initialize Tesseract worker for OCR
    this.tesseractWorker = await Tesseract.createWorker('eng');
  }

  async cleanup(): Promise<void> {
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
    await this.frameExtractor.cleanupFrames();
  }

  async analyzeUIElements(frames: ExtractedFrame[]): Promise<UIElement[]> {
    const uiElements: UIElement[] = [];
    
    // Analyze a subset of frames for UI elements
    const framesToAnalyze = frames.filter((_, i) => i % 3 === 0).slice(0, 5);
    
    for (const frame of framesToAnalyze) {
      const elements = await this.detectUIElementsInFrame(frame.framePath, frame.timestamp);
      uiElements.push(...elements);
    }

    // Deduplicate similar elements
    return this.deduplicateUIElements(uiElements);
  }

  private async detectUIElementsInFrame(framePath: string, timestamp: number): Promise<UIElement[]> {
    const elements: UIElement[] = [];
    
    // Extract text regions using OCR
    const textRegions = await this.extractTextRegions(framePath);
    
    // Convert text regions to UI elements
    for (const region of textRegions) {
      if (region.text.trim().length > 0) {
        elements.push({
          type: this.classifyTextElement(region.text),
          bounds: region.bounds,
          confidence: region.confidence,
          timestamp
        });
      }
    }

    // Detect window-like structures using edge detection
    const windowElements = await this.detectWindows(framePath, timestamp);
    elements.push(...windowElements);

    return elements;
  }

  private async extractTextRegions(framePath: string): Promise<TextRegion[]> {
    if (!this.tesseractWorker) {
      await this.initialize();
    }

    try {
      const result = await this.tesseractWorker!.recognize(framePath);
      const page = result.data as { words?: TesseractWord[] }; // Type workaround for Tesseract
      
      if (!page.words || !Array.isArray(page.words)) {
        return [];
      }
      
      return page.words.map((word: TesseractWord) => ({
        text: word.text,
        bounds: {
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0
        },
        confidence: word.confidence / 100
      }));
    } catch (error) {
      
      return [];
    }
  }

  private classifyTextElement(text: string): string {
    const lowerText = text.toLowerCase();
    
    // Common UI element patterns
    if (lowerText.match(/^(ok|cancel|submit|save|delete|edit|new|add|remove|close)$/)) {
      return 'button';
    }
    if (lowerText.includes('@') || lowerText.match(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i)) {
      return 'email_field';
    }
    if (lowerText.match(/^https?:\/\//)) {
      return 'url';
    }
    if (text.match(/^[A-Z][a-z]+ [A-Z][a-z]+/)) {
      return 'title';
    }
    if (text.length > 50) {
      return 'paragraph';
    }
    
    return 'text';
  }

  private async detectWindows(framePath: string, timestamp: number): Promise<UIElement[]> {
    const elements: UIElement[] = [];
    
    try {
      // Load image and detect edges
      const image = sharp(framePath);
      const metadata = await image.metadata();
      
      if (!metadata.width || !metadata.height) return elements;

      // Convert to grayscale and find edges
      await image
        .grayscale()
        .convolve({
          width: 3,
          height: 3,
          kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] // Edge detection kernel
        })
        .toBuffer();

      // Analyze color distribution to find potential window boundaries
      const stats = await sharp(framePath).stats();
      
      // Simple heuristic: if we have distinct color regions, likely a window
      if (stats.channels.length >= 3) {
        const colorVariance = stats.channels.reduce((acc, channel) => 
          acc + channel.stdev, 0) / stats.channels.length;
        
        if (colorVariance > 30) {
          elements.push({
            type: 'window',
            bounds: {
              x: 0,
              y: 0,
              width: metadata.width,
              height: metadata.height
            },
            confidence: 0.7,
            timestamp
          });
        }
      }
    } catch (error) {
      
    }

    return elements;
  }

  private deduplicateUIElements(elements: UIElement[]): UIElement[] {
    const unique: UIElement[] = [];
    
    for (const element of elements) {
      const isDuplicate = unique.some(existing => 
        existing.type === element.type &&
        Math.abs(existing.bounds.x - element.bounds.x) < 10 &&
        Math.abs(existing.bounds.y - element.bounds.y) < 10 &&
        Math.abs(existing.bounds.width - element.bounds.width) < 10 &&
        Math.abs(existing.bounds.height - element.bounds.height) < 10
      );
      
      if (!isDuplicate) {
        unique.push(element);
      }
    }
    
    return unique;
  }

  async analyzeMouseActivity(frames: ExtractedFrame[]): Promise<MouseActivity> {
    const positions: Array<{ x: number; y: number; timestamp: number }> = [];
    const clicks: Array<{ x: number; y: number; type: 'left' | 'right'; timestamp: number }> = [];
    
    // Look for mouse cursor in frames
    for (let i = 0; i < frames.length; i++) {
      const mousePos = await this.detectMouseCursor(frames[i].framePath);
      if (mousePos) {
        positions.push({
          x: mousePos.x,
          y: mousePos.y,
          timestamp: frames[i].timestamp
        });
        
        // Detect clicks by looking for UI changes between frames
        if (i > 0) {
          const hasUIChange = await this.detectSignificantChange(
            frames[i-1].framePath,
            frames[i].framePath
          );
          
          if (hasUIChange && mousePos) {
            clicks.push({
              x: mousePos.x,
              y: mousePos.y,
              type: 'left',
              timestamp: frames[i].timestamp
            });
          }
        }
      }
    }

    // Calculate mouse statistics
    let totalDistance = 0;
    for (let i = 1; i < positions.length; i++) {
      const dx = positions[i].x - positions[i-1].x;
      const dy = positions[i].y - positions[i-1].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    const duration = frames.length > 0 ? 
      (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000 : 1;

    return {
      positions,
      clicks,
      totalDistance,
      averageSpeed: totalDistance / duration
    };
  }

  private async detectMouseCursor(framePath: string): Promise<{ x: number; y: number } | null> {
    // Simple heuristic: look for small, high-contrast regions that could be a cursor
    try {
      const image = sharp(framePath);
      const metadata = await image.metadata();
      
      if (!metadata.width || !metadata.height) return null;

      // For now, return center of screen as a placeholder
      // In a real implementation, you'd use template matching or ML
      return {
        x: metadata.width / 2,
        y: metadata.height / 2
      };
    } catch {
      return null;
    }
  }

  private async detectSignificantChange(frame1Path: string, frame2Path: string): Promise<boolean> {
    try {
      // Compare two frames to detect significant changes
      const [stats1, stats2] = await Promise.all([
        sharp(frame1Path).stats(),
        sharp(frame2Path).stats()
      ]);

      // Calculate difference in mean values across channels
      let totalDiff = 0;
      for (let i = 0; i < Math.min(stats1.channels.length, stats2.channels.length); i++) {
        totalDiff += Math.abs(stats1.channels[i].mean - stats2.channels[i].mean);
      }

      // Threshold for significant change
      return totalDiff > 10;
    } catch {
      return false;
    }
  }

  async generateSceneDescription(frames: ExtractedFrame[]): Promise<string> {
    const descriptions: string[] = [];
    
    // Analyze key frames
    const keyFrames = frames.filter((_, i) => i % 5 === 0).slice(0, 3);
    
    for (const frame of keyFrames) {
      const description = await this.describeFrame(frame.framePath);
      if (description) {
        descriptions.push(`At ${(frame.timestamp / 1000).toFixed(1)}s: ${description}`);
      }
    }

    return descriptions.join(' ');
  }

  private async describeFrame(framePath: string): Promise<string> {
    try {
      // Extract text from frame
      const textRegions = await this.extractTextRegions(framePath);
      const visibleText = textRegions
        .filter(r => r.confidence > 0.5)
        .map(r => r.text)
        .join(' ');

      // Analyze colors
      const colorAnalysis = await this.analyzeColors(framePath);

      // Build description
      const parts: string[] = [];
      
      if (colorAnalysis.isDarkMode) {
        parts.push('Dark theme interface');
      } else {
        parts.push('Light theme interface');
      }

      if (visibleText.length > 0) {
        const preview = visibleText.substring(0, 50);
        parts.push(`with text "${preview}${visibleText.length > 50 ? '...' : ''}"`);
      }

      return parts.join(' ');
    } catch {
      return 'Desktop activity';
    }
  }

  private async analyzeColors(framePath: string): Promise<ColorAnalysis> {
    try {
      const { dominant } = await sharp(framePath)
        .resize(100, 100) // Resize for faster processing
        .toBuffer()
        .then(buffer => sharp(buffer).stats());

      const brightness = (dominant.r + dominant.g + dominant.b) / 3;
      
      return {
        dominantColors: [{
          color: `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`,
          percentage: 100
        }],
        isDarkMode: brightness < 128,
        averageBrightness: brightness
      };
    } catch {
      return {
        dominantColors: [],
        isDarkMode: false,
        averageBrightness: 128
      };
    }
  }
}