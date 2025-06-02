# Quick Setup Guide

## 1. Install Dependencies
```bash
npm install
```

## 2. Build Project
```bash
npm run build
```

## 3. Enable macOS Permissions
System Preferences > Privacy & Security > Screen Recording > Enable for Terminal/Claude Desktop

## 4. Configure Claude Desktop
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "desktop-dvr": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-desktop-dvr/dist/index.js"]
    }
  }
}
```

## 5. Restart Claude Desktop

## 6. Test
Ask Claude: "Start desktop recording"

## Development
```bash
npm run dev        # Development mode
npm run test       # Run tests
npm run lint       # Check code style
npm run typecheck  # Type validation
```

## Troubleshooting
- **Permission denied**: Enable Screen Recording in System Preferences
- **Module not found**: Run `npm run build`
- **MCP not working**: Restart Claude Desktop after config changes
- **Check logs**: `tail -f ~/.mcp-desktop-dvr/debug.log`