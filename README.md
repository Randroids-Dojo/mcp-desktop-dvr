# MCP Desktop DVR

✅ **PRODUCTION READY**

MCP server for desktop video capture and analysis on macOS. Enables Claude to analyze screen activity through a 30-minute rolling buffer.

## Features

- **30-minute rolling buffer** of desktop activity
- **AI-powered visual analysis** with OpenAI GPT-4o (cloud) or Tarsier2-7B (local)
- **Intelligent fallback** from OpenAI → Tarsier → OCR
- **Window-specific capture** by application
- **Precise extraction** of time segments
- **Production-ready** with comprehensive testing

## Requirements

- macOS 10.15+
- Node.js 18+
- Screen Recording permission

## Quick Setup

```bash
npm install && npm run build
```

Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "desktop-dvr": {
      "command": "node",
      "args": ["/path/to/mcp-desktop-dvr/dist/index.js"],
      "env": {
        "ANALYZER_PREFERENCE": "auto"  // Auto-select best available analyzer
      }
    }
  }
}
```

## Tools

- `start-continuous-capture` - Begin recording
- `analyze-desktop-now` - Extract and analyze recent activity
- `get-capture-status` - Check recording status
- `stop-capture` - Stop recording
- `configure-capture` - Update settings

## Usage

Ask Claude:
- "Start desktop recording"
- "Analyze the last 30 seconds"
- "What errors are on my screen?"

## Video Analysis Options

The `analyze-desktop-now` tool supports multiple analyzers with different strengths:

### ☁️ OpenAI GPT-4o Vision (Primary - Cloud)
- **Most accurate analysis** using GPT-4o via Responses API
- **Converts video to GIF** for optimal API compatibility
- **Comprehensive understanding** of complex workflows
- **Requires OpenAI API key** and internet connection
- **Fast processing** (~3-5 seconds)

### 🤖 Tarsier2-7B (Fallback - Local AI)
- **Runs locally** on your Mac using Metal Performance Shaders
- **No API keys required** - completely private
- **Excellent visual understanding** of UIs, games, and graphics
- **Moderate processing time** (~5-15 seconds for 30-second clips)

### 📝 OCR Text Extraction (Final Fallback)
- **Basic text extraction** from screenshots
- **Limited effectiveness** with modern UIs
- **Always available** as final fallback

## Configuration

Set environment variables in your MCP config:

```json
"env": {
  "ANALYZER_PREFERENCE": "auto",       // Options: "auto", "openai", "tarsier", "ocr"
  "OPENAI_API_KEY": "sk-...",          // For OpenAI (recommended)
  "OPENAI_MODEL": "gpt-4o"             // OpenAI model (default: gpt-4o)
}
```

### Analyzer Selection Logic

- `"auto"` (default) - Uses OpenAI if API key set, otherwise Tarsier, then OCR
- `"openai"` - Forces OpenAI GPT-4o Vision (requires API key)
- `"tarsier"` - Forces Tarsier2-7B local AI
- `"ocr"` - Forces basic OCR text extraction

## Documentation

- [User Guide](USER_GUIDE.md) - Setup and usage instructions
- [CLAUDE.md](CLAUDE.md) - Development info

## License

ISC