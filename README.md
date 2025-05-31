# MCP Desktop DVR

A Model Context Protocol (MCP) server that provides desktop video capture and analysis capabilities for macOS. This tool enables Claude to analyze desktop activity through intelligent video capture with a 30-minute rolling buffer and advanced visual analysis.

## Features

- **Continuous Desktop Recording**: Captures your screen activity in a 30-minute rolling buffer
- **Visual Content Analysis**: 
  - OCR text extraction from screen captures
  - Application and window detection
  - UI element identification (buttons, text fields, windows)
  - Mouse activity tracking with click context
  - Dark/light theme detection
  - Multi-region screen analysis
- **Instant Analysis**: Extract and analyze the last N seconds of activity on demand
- **Smart Buffer Management**: Automatic segment rotation to maintain the 30-minute window
- **Hardware Acceleration**: Uses VideoToolbox for efficient H.264 encoding on macOS
- **Precise Extraction**: Frame-accurate video extraction without quality loss

## Current Status

✅ **The MCP server is fully functional** with desktop capture, buffer management, and visual analysis capabilities.

### What's Working:
- ✅ Desktop capture using aperture-node
- ✅ 30-minute circular buffer with automatic rotation
- ✅ Precise video extraction (10s, 30s, etc.)
- ✅ Visual analysis with OCR and UI detection
- ✅ Application context detection (Godot, VS Code, etc.)
- ✅ Mouse activity tracking
- ✅ Dark/light theme detection
- ✅ Debug frame saving for analysis verification

## Requirements

- macOS 10.15 or later
- Node.js 18 or later
- Screen Recording permission in System Preferences
- ffmpeg (for video processing)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/mcp-desktop-dvr.git
cd mcp-desktop-dvr
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Usage

### Configuring Claude Desktop

Add the following to your Claude Desktop configuration file:

```json
{
  "mcpServers": {
    "desktop-dvr": {
      "command": "node",
      "args": ["/path/to/mcp-desktop-dvr/dist/index.js"]
    }
  }
}
```

**Important**: After making changes to the code, you must:
1. Run `npm run build`
2. **Restart Claude Desktop** (it caches the built code)

### Available Tools

#### `analyze-desktop-now`
Extract and analyze the last N seconds of desktop activity with visual content analysis.

Parameters:
- `duration_seconds` (number, 1-300): Number of seconds to analyze (default: 30)
- `analysis_type` (string): Type of analysis - "ui_elements", "mouse_activity", or "full_analysis" (default: "full_analysis")

Returns detailed analysis including:
- Detected text and UI elements
- Application context (app name, window title)
- Mouse activity with click locations
- Visual changes timeline
- Theme detection (dark/light)

#### `start-continuous-capture`
Start continuous desktop recording.

Parameters:
- `fps` (number, 1-60): Frames per second (default: 30)
- `quality` (number, 1-100): Video quality (default: 70)

#### `stop-capture`
Stop desktop recording.

#### `get-capture-status`
Get current capture status and statistics.

## Visual Analysis Details

The enhanced visual analyzer performs:

1. **Frame Extraction**: Extracts frames at configurable intervals
2. **Text Recognition**: Uses Tesseract.js OCR with preprocessing for dark themes
3. **Application Detection**: Identifies common applications (Godot, VS Code, Chrome, etc.)
4. **Region Analysis**: Analyzes different screen regions (top bar, center, sidebars)
5. **Change Detection**: Tracks visual changes between frames
6. **Click Context**: Extracts text near mouse click locations

Debug frames are saved to `~/.mcp-desktop-dvr/debug-frames/` for analysis verification.

## Development

### Project Structure

```
mcp-desktop-dvr/
├── src/
│   ├── index.ts                  # MCP server entry point
│   ├── capture/
│   │   └── desktopCapture.ts    # Screen recording management
│   ├── buffer/
│   │   └── circularBuffer.ts    # 30-minute rolling buffer
│   ├── analysis/
│   │   ├── videoAnalyzer.ts     # Main analysis orchestrator
│   │   ├── visualAnalyzer.ts    # Basic visual analysis
│   │   ├── enhancedVisualAnalyzer.ts # Advanced OCR and detection
│   │   └── frameExtractor.ts    # Frame extraction utilities
│   └── types/                   # TypeScript definitions
├── tests/                       # Test files
├── package.json
├── tsconfig.json
└── README.md
```

### Scripts

```bash
# Run in development mode with hot reload
npm run dev

# Build TypeScript to JavaScript
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Type check
npm run typecheck

# Format code
npm run format
```

### Debug Logs

Debug logs are written to `~/.mcp-desktop-dvr/debug.log`. Monitor them with:
```bash
tail -f ~/.mcp-desktop-dvr/debug.log
```

## Performance

Current performance characteristics:
- CPU usage: ~10-15% during capture
- Memory: ~500MB-1GB with buffer
- Frame extraction: <2s for 30 frames
- OCR processing: ~100-200ms per frame

## Privacy & Security

- Requires explicit Screen Recording permission
- All recordings are stored locally in `~/.mcp-desktop-dvr/`
- No data is transmitted over the network
- Recordings are automatically cleaned up based on the rolling buffer
- Debug frames can be disabled by setting `debugMode = false`

## Troubleshooting

### Screen Recording Permission

If you see permission errors:
1. Open System Preferences > Security & Privacy > Privacy
2. Select Screen Recording
3. Enable permission for Terminal/iTerm/VS Code

### OCR Not Detecting Text

The analyzer includes aggressive preprocessing for dark themes. If text isn't detected:
- Check debug frames in `~/.mcp-desktop-dvr/debug-frames/`
- The preprocessed images show what OCR sees
- Adjust preprocessing parameters if needed

### High CPU Usage

To reduce CPU usage:
- Lower FPS: Use 15 instead of 30
- Reduce quality: Use 50 instead of 70
- Increase frame extraction interval

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC License

## Acknowledgments

Built with:
- [MCP SDK](https://github.com/anthropics/model-context-protocol) by Anthropic
- [Aperture](https://github.com/wulkano/aperture) for macOS screen recording
- [Sharp](https://sharp.pixelplumbing.com/) for image processing
- [Tesseract.js](https://tesseract.projectnaptha.com/) for OCR
- TypeScript and Node.js