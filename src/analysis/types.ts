export interface AnalysisOptions {
  duration: number;
  analysisType: 'ui_elements' | 'mouse_activity' | 'full_analysis';
}

export interface UIElement {
  type: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  timestamp: number;
}

export interface MouseActivity {
  positions: Array<{
    x: number;
    y: number;
    timestamp: number;
  }>;
  clicks: Array<{
    x: number;
    y: number;
    type: 'left' | 'right';
    timestamp: number;
  }>;
  totalDistance: number;
  averageSpeed: number;
}

export interface AnalysisResult {
  videoPath: string;
  duration: number;
  analysisType: string;
  timestamp: string;
  results: {
    uiElements?: UIElement[];
    mouseActivity?: MouseActivity;
    summary?: string;
    keyFrames?: Array<{
      timestamp: number;
      description: string;
    }>;
    // Focused analysis results
    errors?: string[];
    warnings?: string[];
    currentFile?: string;
    userActions?: string[];
    llmError?: {
      provider: string;
      error: string;
      timestamp: string;
    };
    enhancedDetails?: {
      context: {
        appName?: string;
        windowTitle?: string;
        isDarkTheme: boolean;
        primaryColors: string[];
      };
      regions: Array<{
        name: string;
        bounds: { x: number; y: number; width: number; height: number };
        content?: string;
      }>;
      clickContexts: Array<{
        position: { x: number; y: number };
        nearbyText: string;
        timestamp: number;
      }>;
      llmAnalysis?: {
        provider: string;
        description: string;
        confidence: number;
      };
      tarsierAnalysis?: {
        provider: string;
        description: string;
        confidence: number;
        processingTime: number;
        device: string;
        analysisMethod: 'ocr' | 'tarsier' | 'hybrid';
      };
    };
  };
}