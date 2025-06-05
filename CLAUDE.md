# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server for desktop video capture and analysis on macOS. The project enables Claude Code to analyze desktop activity through intelligent video capture and extraction with a 30-minute rolling buffer.

## Current State

✅ **FULLY FUNCTIONAL** - The MCP server is production-ready with all core features implemented:
- Desktop capture with aperture-node
- 30-minute circular buffer system
- Precise video extraction (10s, 30s clips)
- Advanced visual analysis with OCR and UI detection
- Comprehensive test suite (unit, integration, performance)
- Window-specific capture support
- Error handling and logging

## Project Status

✅ **READY TO USE** - All dependencies are installed and configured:

**Core Dependencies:**
- `@modelcontextprotocol/sdk` - MCP server framework
- `aperture` - macOS screen recording
- `sharp` - Image processing for visual analysis
- `tesseract.js` - OCR text extraction
- `typescript` - TypeScript support

**Development Dependencies:**
- `jest` - Testing framework
- `eslint` - Code linting
- `tsx` - Development runtime

## Planned Architecture

### Core Components
1. **MCP Server**: TypeScript implementation using `@modelcontextprotocol/sdk`
2. **Desktop Capture**: aperture-node for native macOS screen recording
3. **Buffer System**: 30-minute rolling buffer with hybrid memory/disk storage
4. **Video Processing**: H.264 encoding with VideoToolbox hardware acceleration

### Key Tools to Implement
- `analyze-desktop-now`: Extract and analyze the last N seconds of desktop activity
- `start-continuous-capture`: Begin recording desktop
- `stop-capture`: Stop recording
- `get-capture-status`: Check capture status
- `configure-capture`: Update capture settings

## Development Commands

Once the project is set up, these commands should be configured in package.json:

```bash
# Run the MCP server
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Type check
npm run typecheck
```

## Technical Requirements

### macOS Permissions
The application requires Screen Recording permission in System Preferences.

### Performance Targets
- CPU usage: < 15% sustained
- Memory: < 1.5GB total allocation
- Capture latency: < 100ms
- Extraction time: < 2 seconds for 30-second clip

### Video Encoding Settings
- Codec: H.264 with VideoToolbox
- Quality: 65-75 (1-100 scale)
- Frame rate: 30fps
- Keyframe interval: Every 90 frames (3 seconds)
- Bitrate: 4 Mbps

## Project Structure (Recommended)

```
mcp-desktop-dvr/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── capture/          # Desktop capture implementation
│   ├── buffer/           # Circular buffer system
│   ├── analysis/         # Video analysis tools
│   └── types/            # TypeScript type definitions
├── tests/                # Test files
├── package.json
├── tsconfig.json
├── .eslintrc.json
└── CLAUDE.md
```

## Implementation Status

✅ **COMPLETED ROADMAP:**
1. ✅ Basic Capture MCP - Fully implemented with 5 core tools
2. ✅ Circular Buffer System - 30-minute rolling buffer with optimization
3. ✅ Analysis Features - Visual analysis, OCR, UI detection
4. ✅ Production Optimization - Memory monitoring, error handling, tests

**Available for immediate use!**

## MCP Configuration

Add to Claude Desktop configuration:
```json
{
  "mcpServers": {
    "desktop-dvr": {
      "command": "node",
      "args": ["path/to/mcp-desktop-dvr/dist/index.js"],
      "env": {
        "ANALYZER_PREFERENCE": "auto"
      }
    }
  }
}
```

### Analyzer Configuration Options

The MCP server supports multiple video analyzers with configurable preferences:

**Environment Variables:**
- `ANALYZER_PREFERENCE` - Controls which analyzer to use:
  - `"auto"` (default) - Uses OpenAI if API key is set, otherwise Tarsier, then OCR
  - `"openai"` - Forces OpenAI analyzer (requires OPENAI_API_KEY)
  - `"tarsier"` - Forces Tarsier2-7B local AI analyzer (recommended)
  - `"ocr"` - Forces OCR text extraction only

- `OPENAI_API_KEY` - Your OpenAI API key (if using OpenAI analyzer)
- `OPENAI_MODEL` - OpenAI model to use (default: "gpt-4o")

**Example Configurations:**

1. **Auto mode (OpenAI → Tarsier → OCR) - RECOMMENDED:**
```json
"env": {
  "OPENAI_API_KEY": "sk-...",
  "ANALYZER_PREFERENCE": "auto"
}
```

2. **Force OpenAI only (requires API key):**
```json
"env": {
  "OPENAI_API_KEY": "sk-...",
  "ANALYZER_PREFERENCE": "openai"
}
```

3. **Force Tarsier even with OpenAI key:**
```json
"env": {
  "OPENAI_API_KEY": "sk-...",
  "ANALYZER_PREFERENCE": "tarsier"
}
```

## Development Notes

### Essential Development Workflow
1. Make code changes
2. `npm run build` 
3. **Restart Claude Desktop** (crucial - it caches the built code)
4. Test the changes

### Debugging
- Debug logs are written to `~/.mcp-desktop-dvr/debug.log`
- Essential logging is kept for production use
- Use `tail -f ~/.mcp-desktop-dvr/debug.log` to monitor

### Video Extraction Details
- Uses ffmpeg with re-encoding (`libx264`) for precise cuts (avoids keyframe alignment issues)
- Segments are typically 60 seconds but can vary based on actual recording duration
- Extracted videos are precisely trimmed to requested duration
- Multiple segments are concatenated before trimming when needed

### Current Status
The MCP server is fully functional with:
- Desktop capture using aperture-node
- Circular buffer system with 30-minute rolling storage
- Precise video extraction (10s, 30s, etc.)
- **Visual analysis capabilities:**
  - Frame extraction from video recordings
  - OCR text extraction using Tesseract.js
  - UI element detection (windows, buttons, text fields)
  - Mouse activity tracking and click detection
  - Scene description and summarization
  - Color analysis and theme detection
- Proper error handling and logging

### Visual Analysis Details
The `analyze-desktop-now` tool now supports **three analysis methods**:

#### 🌐 **OpenAI GPT-4o Vision Analysis** (Primary Method with API key)
- **Uses GPT-4o** via the Responses API for advanced video understanding
- **Creates multiple 10-second GIF segments** from extracted videos for optimal analysis
- **Automatically segments videos**: 30s video → 3 GIF files (part01.gif, part02.gif, part03.gif)
- **Uploads first segment to OpenAI** while preserving all segments locally
- **Comprehensive analysis** of UI elements, applications, and user interactions
- **Excellent accuracy** for all types of interfaces and content
- **Cloud-based processing** with fast response times

**What OpenAI excels at:**
- **Comprehensive understanding**: Full context awareness of what's happening
- **Error detection**: Accurately identifies issues and problems
- **User workflow analysis**: Understands complex multi-step processes
- **Natural language descriptions**: Clear, detailed explanations
- **High confidence results**: Reliable analysis with confidence scores

#### 🤖 **Tarsier2-7B AI Vision Analysis** (Local Fallback)
- **Uses Tarsier2-Recap-7B** for local video understanding
- **Direct visual analysis** without requiring API keys
- **No OCR limitations** - can analyze any visual content
- **Fast local processing** with M2 Metal Performance Shaders acceleration
- **Privacy-focused** - all processing happens locally

**What Tarsier excels at:**
- **Application identification**: Accurately detects software being used
- **Error detection**: Identifies visual error dialogs and warning messages
- **User action tracking**: Understands clicks, selections, and UI interactions
- **File context**: Determines which files are being edited or viewed
- **Visual UI analysis**: Describes interface elements, themes, and layouts

#### 📝 **OCR Text Analysis** (Final Fallback)
- **Automatic fallback** when AI vision methods are unavailable
- **Focused on text extraction** for development environments
- **Good for text-heavy interfaces** like IDEs and terminals
- **Limited effectiveness** with modern GUIs and graphical content

**Current Status:** 
✅ **Hybrid analysis system implemented** - Intelligent fallback from OpenAI → Tarsier → OCR

**Technical Implementation:**
- **Primary**: OpenAI GPT-4o via Responses API (when API key available)
- **Local Fallback**: Tarsier2-Recap-7B with PyTorch MPS acceleration
- **Final Fallback**: Enhanced OCR with Tesseract.js
- **GIF Segmentation**: Automatic 10-second segments with intelligent naming
- **File Management**: GIF files preserved locally alongside MP4 extracts
- **Smart Upload**: Only first GIF segment uploaded to OpenAI for analysis
- **Frame extraction**: 16 evenly-spaced frames per analysis (OCR/Tarsier)
- **Processing time**: ~3-5 seconds (OpenAI), ~5-15 seconds (Tarsier/OCR)

**Dependencies:**
- `openai`: OpenAI SDK for GPT-4o vision analysis
- `torch`, `transformers`, `opencv-python`: Tarsier AI analysis
- `sharp`: High-performance image processing  
- `tesseract.js`: OCR fallback analysis
- `ffmpeg`: Frame extraction and GIF conversion

**Analysis quality indicators:**
- **"OpenAI vision analysis"**: GPT-4o was used successfully
- **"Advanced AI vision analysis"**: Tarsier was used successfully
- **"OCR text analysis"**: Fallback method was used
- **"Hybrid analysis"**: Multiple methods provided results

Debug frames are saved to `~/.mcp-desktop-dvr/tarsier-frames/` and `~/.mcp-desktop-dvr/debug-frames/`.

### File Output Structure

When using OpenAI analysis, the system creates multiple files for each extraction:

**For a 30-second video extraction:**
```
~/.mcp-desktop-dvr/buffer/extracts/
├── extract_1234567890_30s.mp4          # Original extracted video
├── extract_1234567890_30s_part01.gif   # Seconds 0-10
├── extract_1234567890_30s_part02.gif   # Seconds 10-20
└── extract_1234567890_30s_part03.gif   # Seconds 20-30
```

**File naming convention:**
- MP4: `extract_<timestamp>_<duration>s.mp4`
- GIFs: `extract_<timestamp>_<duration>s_part<XX>.gif`

**Analysis output includes:**
```json
{
  "apiCall": {
    "provider": "OpenAI",
    "inputFormat": "GIF segments (first segment uploaded)",
    "gifFiles": {
      "allSegments": ["path/to/part01.gif", "path/to/part02.gif", "path/to/part03.gif"],
      "uploadedFile": "path/to/part01.gif",
      "totalSegments": 3,
      "segmentDuration": 10
    }
  }
}
```