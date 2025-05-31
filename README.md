# MCP Desktop DVR

⚠️ **WORK IN PROGRESS - USE WITH CAUTION** ⚠️

An experimental MCP server for desktop video capture and analysis on macOS. Enables Claude to analyze screen activity through a 30-minute rolling buffer.

## Status

This project is actively under development. Core functionality works but expect bugs and breaking changes.

## Features

- Continuous desktop recording with 30-minute rolling buffer
- Visual analysis with OCR and UI detection
- Extract and analyze recent screen activity on demand

## Requirements

- macOS 10.15+
- Node.js 18+
- Screen Recording permission
- ffmpeg

## Quick Setup

```bash
git clone https://github.com/yourusername/mcp-desktop-dvr.git
cd mcp-desktop-dvr
npm install
npm run build
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

## Main Tools

- `analyze-desktop-now` - Analyze last N seconds of activity
- `start-continuous-capture` - Begin recording
- `stop-capture` - Stop recording
- `get-capture-status` - Check status

## Important Notes

- **Privacy**: Records everything on screen - use responsibly
- **Performance**: Can use significant CPU/memory during capture
- **Permissions**: Requires Screen Recording access in System Preferences
- **Development**: Must restart Claude Desktop after code changes

## Development

```bash
npm run dev      # Development mode
npm run build    # Build for production
npm test         # Run tests
```

Debug logs: `~/.mcp-desktop-dvr/debug.log`

## License

ISC