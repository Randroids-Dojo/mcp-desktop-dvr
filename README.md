# MCP Desktop DVR

A Model Context Protocol (MCP) server that provides desktop video capture and analysis capabilities for macOS. This tool enables Claude Code to analyze desktop activity through intelligent video capture with a 30-minute rolling buffer.

## Features

- **Continuous Desktop Recording**: Capture your screen with hardware-accelerated encoding
- **30-Minute Rolling Buffer**: Maintains the last 30 minutes of desktop activity
- **On-Demand Analysis**: Extract and analyze any time window from the buffer
- **Low Resource Usage**: Optimized for minimal CPU and memory impact
- **macOS Native**: Built with native macOS APIs for best performance

## Current Status

⚠️ **This project is in early development**. The MCP server skeleton is implemented, but the core functionality is not yet complete:

### What's Working:
- ✅ Basic MCP server setup with tool definitions
- ✅ Development environment and build configuration
- ✅ TypeScript, ESLint, and Prettier setup

### Not Yet Implemented:
- ❌ **Desktop capture**: Aperture integration for screen recording
- ❌ **Circular buffer**: 30-minute rolling buffer system
- ❌ **Video analysis**: Extraction and analysis of video segments
- ❌ **Permissions handling**: macOS Screen Recording permission requests
- ❌ **Tests**: Unit and integration tests

All tools currently return a "not_implemented" status. See the [Implementation Roadmap](#implementation-roadmap) section for planned development phases.

## Requirements

- macOS 10.15 or later
- Node.js 18 or later
- Screen Recording permission in System Preferences

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

### Running the MCP Server

For development:
```bash
npm run dev
```

For production:
```bash
npm start
```

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

### Available Tools

#### `analyze-desktop-now`
Extract and analyze the last N seconds of desktop activity.

Parameters:
- `duration_seconds` (number, 1-300): Number of seconds to analyze (default: 30)
- `analysis_type` (string): Type of analysis - "ui_elements", "mouse_activity", or "full_analysis" (default: "full_analysis")

#### `start-continuous-capture`
Start continuous desktop recording.

Parameters:
- `fps` (number, 1-60): Frames per second (default: 30)
- `quality` (number, 1-100): Video quality (default: 70)

#### `stop-capture`
Stop desktop recording.

#### `get-capture-status`
Get current capture status and statistics.

## Development

### Project Structure

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

### Architecture

The system uses a hybrid approach for the 30-minute rolling buffer:
- **Hot tier**: Last 5 minutes in RAM for fast access
- **Cold tier**: Remaining 25 minutes in memory-mapped files
- **Segment size**: 30-second chunks for optimal seeking

Video encoding uses H.264 with VideoToolbox hardware acceleration for minimal CPU usage.

## Performance

Target performance metrics:
- CPU usage: < 15% sustained
- Memory: < 1.5GB total allocation
- Capture latency: < 100ms
- Extraction time: < 2 seconds for 30-second clip

## Privacy & Security

- Requires explicit Screen Recording permission
- All recordings are stored locally
- No data is transmitted over the network
- Recordings are automatically cleaned up based on the rolling buffer

## Troubleshooting

### Screen Recording Permission

If you see permission errors, ensure Screen Recording is enabled:
1. Open System Preferences > Security & Privacy
2. Click Privacy tab
3. Select Screen Recording
4. Enable permission for your terminal or IDE

### High CPU Usage

If CPU usage is higher than expected:
- Lower the FPS setting (e.g., from 30 to 15)
- Reduce quality setting (e.g., from 70 to 50)
- Check for other resource-intensive applications

## Implementation Roadmap

Based on the research in INITIAL_RESEARCH.md:

### Phase 1: Basic Capture MCP
- [ ] Integrate aperture for screen recording
- [ ] Implement basic file-based capture
- [ ] Handle macOS permissions
- [ ] Test integration with Claude Desktop

### Phase 2: Circular Buffer System
- [ ] Implement in-memory circular buffer
- [ ] Add memory-mapped file backing
- [ ] Create extraction mechanism
- [ ] Optimize segment boundaries

### Phase 3: Analysis Features
- [ ] Add mouse/keyboard event capture
- [ ] Implement UI element detection
- [ ] Create analysis patterns
- [ ] Add performance metrics

### Phase 4: Production Optimization
- [ ] Resource monitoring and limits
- [ ] Configuration management
- [ ] Error handling
- [ ] Performance profiling

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC License

## Acknowledgments

Built with:
- [MCP SDK](https://github.com/anthropics/model-context-protocol) by Anthropic
- [Aperture](https://github.com/wulkano/aperture) for macOS screen recording
- TypeScript and Node.js