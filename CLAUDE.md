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
      "args": ["path/to/mcp-desktop-dvr/dist/index.js"]
    }
  }
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
The `analyze-desktop-now` tool uses a **focused analyzer** with significant limitations:

**What it was designed to focus on:**
- **Error Messages**: Detects error text, exceptions, and failures on screen
- **Warning Messages**: Identifies warnings and deprecated notices  
- **Application Context**: Determines which app is being used (Godot, VS Code, etc.)
- **Current File**: Extracts the name of the file being edited
- **Click Context**: Analyzes text near where clicks occurred
- **Code Snippets**: Identifies function definitions and important code

**MAJOR LIMITATIONS:**
- **OCR-based analysis is fundamentally inadequate** for modern GUI applications
- **Game content produces garbage text** due to stylized fonts, graphics, and UI elements
- **Visual interactions are poorly captured** - relies on text extraction rather than computer vision
- **Analysis quality is inconsistent** across different applications and themes
- **Limited usefulness for general desktop activity** beyond text-heavy development environments

**Current Status:** 
⚠️ **Analysis system needs major overhaul** - OCR approach is insufficient for comprehensive desktop analysis

**Future Direction:**
- Replace OCR-based analysis with direct image analysis using LLM vision capabilities
- Implement computer vision techniques for UI element detection
- Add support for visual pattern recognition instead of text extraction
- Consider streaming frame images directly to LLM for contextual analysis

Dependencies for current (limited) visual analysis:
- `sharp`: High-performance image processing
- `tesseract.js`: OCR for text extraction with dark theme preprocessing (produces poor results)
- `ffmpeg`: Frame extraction from video files

Debug frames are saved to `~/.mcp-desktop-dvr/debug-frames/` for verification.