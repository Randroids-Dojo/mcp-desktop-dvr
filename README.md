# MCP Desktop DVR

✅ **PRODUCTION READY**

MCP server for desktop video capture and analysis on macOS. Enables Claude to analyze screen activity through a 30-minute rolling buffer.

## Features

- **30-minute rolling buffer** of desktop activity
- **AI-powered visual analysis** with Tarsier2-7B (local) or OpenAI (cloud)
- **Intelligent fallback** from AI vision to OCR text extraction
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
        "ANALYZER_PREFERENCE": "tarsier"  // Recommended: Use local AI
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

### 🤖 Tarsier2-7B (Recommended - Local AI)
- **Runs locally** on your Mac using Metal Performance Shaders
- **No API keys required** - completely private
- **Excellent visual understanding** of UIs, games, and graphics
- **Fast processing** (~5-15 seconds for 30-second clips)

### ☁️ OpenAI GPT-4 Vision (Cloud)
- **Requires OpenAI API key** and internet connection
- **Advanced analysis** with GPT-4's capabilities
- **Good for complex scenarios** requiring reasoning
- **Usage costs** apply per analysis

### 📝 OCR Text Extraction (Fallback)
- **Basic text extraction** from screenshots
- **Limited effectiveness** with modern UIs
- **Always available** as final fallback

## Configuration

Set environment variables in your MCP config:

```json
"env": {
  "ANALYZER_PREFERENCE": "tarsier",    // Options: "auto", "tarsier", "openai", "ocr"
  "OPENAI_API_KEY": "sk-...",          // For OpenAI (optional)
  "OPENAI_MODEL": "gpt-4o"             // OpenAI model (optional)
}
```

### Analyzer Selection Logic

- `"auto"` (default) - Uses OpenAI if API key set, otherwise Tarsier, then OCR
- `"tarsier"` - Forces Tarsier2-7B local AI (recommended)
- `"openai"` - Forces OpenAI GPT-4 Vision (requires API key)
- `"ocr"` - Forces basic OCR text extraction

## Documentation

- [Setup Guide](SETUP.md) - Installation steps
- [User Guide](USER_GUIDE.md) - Detailed usage
- [CLAUDE.md](CLAUDE.md) - Development info

## License

ISC