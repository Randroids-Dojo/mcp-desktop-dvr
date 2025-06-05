# MCP Desktop DVR - User Guide

## Setup

### 1. Prerequisites
- macOS (required for aperture screen recording)
- Node.js 18+ 
- Screen Recording permission in System Preferences > Privacy & Security

### 2. Build
```bash
npm install
npm run build
```

### 3. Configure Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "desktop-dvr": {
      "command": "node",
      "args": ["/path/to/mcp-desktop-dvr/dist/index.js"],
      "env": {
        "ANALYZER_PREFERENCE": "auto",
        "OPENAI_API_KEY": "sk-..."  // Optional: for enhanced AI analysis
      }
    }
  }
}
```

### 4. Restart Claude Desktop
Required for MCP server registration.

## Usage

### Available Tools

#### `start-continuous-capture`
Begin 30-minute rolling desktop recording.
```
Options:
- fps: Frame rate (default: 30)
- quality: Video quality 1-100 (default: 70)
- bundleId: Capture specific app (e.g., "com.apple.finder")
```

#### `stop-capture`
Stop recording and save final segment.

#### `get-capture-status`
Check recording status, duration, and buffer info.

#### `analyze-desktop-now`
Extract and analyze recent desktop activity.
```
Options:
- seconds: Duration to analyze (default: 10)
- includeOCR: Extract text from screen (default: true)
```

#### `configure-capture`
Update recording settings during capture.

### Common Workflows

**Basic Recording:**
1. `start-continuous-capture`
2. Work normally (30-minute buffer maintained)
3. `analyze-desktop-now` when needed
4. `stop-capture` when done

**App-Specific Recording:**
1. `start-continuous-capture` with bundleId
2. Records only that application window

**Troubleshooting:**
1. Check `get-capture-status` for errors
2. Review logs: `tail -f ~/.mcp-desktop-dvr/debug.log`
3. Verify Screen Recording permission enabled

## Output

- **Recordings**: `~/.mcp-desktop-dvr/buffer/hot/` and `~/.mcp-desktop-dvr/buffer/cold/`
- **Extracted clips**: `~/.mcp-desktop-dvr/buffer/extracts/`
  - MP4 files: `extract_<timestamp>_<duration>s.mp4`
  - GIF segments: `extract_<timestamp>_<duration>s_part01.gif`, `part02.gif`, etc.
- **Debug frames**: `~/.mcp-desktop-dvr/debug-frames/`
- **Logs**: `~/.mcp-desktop-dvr/debug.log`

### File Structure Example
When analyzing a 30-second clip with OpenAI:
```
~/.mcp-desktop-dvr/buffer/extracts/
├── extract_1701234567890_30s.mp4      # Original video
├── extract_1701234567890_30s_part01.gif  # Seconds 0-10
├── extract_1701234567890_30s_part02.gif  # Seconds 10-20
└── extract_1701234567890_30s_part03.gif  # Seconds 20-30
```

## Video Analysis

The `analyze-desktop-now` tool supports multiple analysis methods:

### Analysis Options
- **OpenAI GPT-4o** (Primary): Most accurate analysis via Responses API
  - Requires `OPENAI_API_KEY` environment variable
  - Automatically creates 10-second GIF segments from extracted videos
  - Preserves all GIF files locally alongside MP4 extracts
  - Uploads only first segment to OpenAI for analysis
  - ~3-5 seconds processing time
  
- **Tarsier2-7B** (Fallback): Local AI analysis
  - No API key required
  - Runs on device using Metal Performance Shaders
  - ~5-15 seconds processing time
  
- **OCR** (Final Fallback): Basic text extraction
  - Always available
  - Limited to text content only

### Configuration
Set `ANALYZER_PREFERENCE` in your MCP config:
- `"auto"` (default): OpenAI → Tarsier → OCR
- `"openai"`: Force OpenAI only
- `"tarsier"`: Force local AI only
- `"ocr"`: Force OCR only

### Response Format
When using OpenAI analysis, the response includes detailed GIF information:

```json
{
  "status": "success",
  "videoPath": "/path/to/extract_1234567890_30s.mp4",
  "apiCall": {
    "provider": "OpenAI",
    "inputFormat": "GIF segments (first segment uploaded)",
    "gifFiles": {
      "allSegments": [
        "/path/to/extract_1234567890_30s_part01.gif",
        "/path/to/extract_1234567890_30s_part02.gif", 
        "/path/to/extract_1234567890_30s_part03.gif"
      ],
      "uploadedFile": "/path/to/extract_1234567890_30s_part01.gif",
      "totalSegments": 3,
      "segmentDuration": 10
    }
  },
  "results": {
    "summary": "Analysis of desktop activity...",
    "userActions": ["..."],
    "errors": [],
    "warnings": []
  }
}
```

## Performance

- CPU: <15% sustained
- Memory: <1.5GB total
- Buffer: 30-minute rolling window
- Extraction: <2 seconds for 30-second clips
- Analysis: 3-15 seconds depending on method

## Development

For development and testing:
```bash
npm run dev        # Development mode
npm run test       # Run tests
npm run lint       # Check code style
npm run typecheck  # Type validation
```

Quick test after setup: Ask Claude "Start desktop recording"