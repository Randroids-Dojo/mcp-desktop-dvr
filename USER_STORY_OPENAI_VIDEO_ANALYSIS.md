# User Story: OpenAI API Video Analysis

## Story
**As a** developer using MCP Desktop DVR  
**I want** to analyze desktop video clips using OpenAI's vision API  
**So that** I get more accurate and comprehensive analysis than current OCR-based approach

## Acceptance Criteria

1. **API Integration**
   - [ ] Create OpenAI API client wrapper for video analysis
   - [ ] Support configurable API key via environment variable `OPENAI_API_KEY`
   - [ ] Handle API errors gracefully with meaningful error messages

2. **Video Processing**
   - [ ] Accept video clips (10-30 seconds) from the analyze-desktop-now tool
   - [ ] Convert video to format/size acceptable by OpenAI API
   - [ ] Send video with appropriate prompt for desktop analysis

3. **Analysis Features**
   - [ ] Detect and describe what's happening on screen
   - [ ] Identify applications being used
   - [ ] Detect errors, warnings, or issues
   - [ ] Describe user interactions and UI changes
   - [ ] Return structured analysis results

4. **Configuration**
   - [ ] Optional feature - only used when API key is provided
   - [ ] Configurable model selection (default: gpt-4o)
   - [ ] Rate limiting to prevent excessive API usage

## Technical Implementation

```typescript
// src/analysis/openaiAnalyzer.ts
interface OpenAIVideoAnalysis {
  description: string;
  detectedApplications: string[];
  errors: string[];
  warnings: string[];
  keyActions: string[];
  summary: string;
}

class OpenAIAnalyzer {
  async analyzeVideo(videoPath: string, duration: number): Promise<OpenAIVideoAnalysis>
}
```

## Definition of Done
- [ ] OpenAI analyzer implemented and tested
- [ ] Integrated into analyze-desktop-now tool as optional enhancement
- [ ] Falls back to OCR analysis when API unavailable
- [ ] Unit tests for API wrapper
- [ ] Documentation updated with setup instructions