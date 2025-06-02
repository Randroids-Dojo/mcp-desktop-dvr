# MCP Desktop DVR

✅ **PRODUCTION READY**

MCP server for desktop video capture and analysis on macOS. Enables Claude to analyze screen activity through a 30-minute rolling buffer.

## Features

- **30-minute rolling buffer** of desktop activity
- **Visual analysis** with OCR and UI detection
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
      "args": ["/path/to/mcp-desktop-dvr/dist/index.js"]
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

## Documentation

- [Setup Guide](SETUP.md) - Installation steps
- [User Guide](USER_GUIDE.md) - Detailed usage
- [CLAUDE.md](CLAUDE.md) - Development info

## License

ISC