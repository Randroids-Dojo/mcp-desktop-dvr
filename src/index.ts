import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DesktopCapture } from './capture/desktopCapture.js';
import { VideoAnalyzer } from './analysis/index.js';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const logDir = join(homedir(), '.mcp-desktop-dvr');
const logPath = join(logDir, 'debug.log');

// Ensure log directory exists
try {
  mkdirSync(logDir, { recursive: true });
} catch (e) {
  // Ignore if already exists
}

export function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}\n`;
  try {
    appendFileSync(logPath, logMessage);
  } catch (e) {
    // Ignore errors
  }
}

const desktopCapture = new DesktopCapture();

const server = new Server(
  {
    name: 'desktop-dvr',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Add request logging by wrapping handlers

// Tool: analyze-desktop-now
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'analyze-desktop-now',
      description: 'Extract and analyze the last N seconds of desktop activity',
      inputSchema: {
        type: 'object',
        properties: {
          duration_seconds: {
            type: 'number',
            description: 'Number of seconds to analyze (1-300)',
            minimum: 1,
            maximum: 300,
            default: 30,
          },
          analysis_type: {
            type: 'string',
            enum: ['ui_elements', 'mouse_activity', 'full_analysis'],
            description: 'Type of analysis to perform',
            default: 'full_analysis',
          },
        },
      },
    },
    {
      name: 'start-continuous-capture',
      description: 'Start continuous desktop recording',
      inputSchema: {
        type: 'object',
        properties: {
          fps: {
            type: 'number',
            description: 'Frames per second (1-60)',
            minimum: 1,
            maximum: 60,
            default: 30,
          },
          quality: {
            type: 'number',
            description: 'Video quality (1-100)',
            minimum: 1,
            maximum: 100,
            default: 70,
          },
        },
      },
    },
    {
      name: 'stop-capture',
      description: 'Stop desktop recording',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get-capture-status',
      description: 'Get current capture status and statistics',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = args as Record<string, any>;
  
  log(`[MCP] Tool called: ${name}`);

  switch (name) {
    case 'analyze-desktop-now':
      try {
        const duration = toolArgs?.duration_seconds || 30;
        const analysisType = toolArgs?.analysis_type || 'full_analysis';
        
        // Check if capture is active
        const status = desktopCapture.getStatus();
        if (!status.isRecording) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error',
                  message: 'No active desktop capture. Please start continuous capture first.',
                }),
              },
            ],
          };
        }

        // Extract the requested video segment
        const videoPath = await desktopCapture.extractLastNSeconds(duration);
        
        // Perform video analysis
        const analyzer = new VideoAnalyzer();
        const analysisResult = await analyzer.analyze(videoPath, {
          duration,
          analysisType
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: `Analyzed ${duration} seconds of desktop video`,
                videoPath: analysisResult.videoPath,
                duration: analysisResult.duration,
                analysisType: analysisResult.analysisType,
                timestamp: analysisResult.timestamp,
                results: {
                  summary: analysisResult.results.summary,
                  errors: analysisResult.results.errors || [],
                  warnings: analysisResult.results.warnings || [],
                  currentFile: analysisResult.results.currentFile,
                  userActions: analysisResult.results.userActions || [],
                  keyFrames: analysisResult.results.keyFrames || [],
                  enhancedDetails: analysisResult.results.enhancedDetails ? {
                    context: analysisResult.results.enhancedDetails.context,
                    clickContexts: analysisResult.results.enhancedDetails.clickContexts
                  } : undefined
                },
                bufferStatus: (status as any).bufferStatus,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to analyze desktop',
              }),
            },
          ],
        };
      }

    case 'start-continuous-capture':
      try {
        await desktopCapture.startCapture({
          fps: toolArgs?.fps || 30,
          quality: toolArgs?.quality || 70,
        });
        const status = desktopCapture.getStatus();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: 'Desktop capture started',
                isRecording: status.isRecording,
                fps: status.fps,
                quality: status.quality,
                outputPath: status.outputPath,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to start capture',
              }),
            },
          ],
        };
      }

    case 'stop-capture':
      try {
        const outputPath = await desktopCapture.stopCapture();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: 'Desktop capture stopped',
                outputPath,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to stop capture',
              }),
            },
          ],
        };
      }

    case 'get-capture-status':
      const status = desktopCapture.getStatus();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              isRecording: status.isRecording,
              startTime: status.startTime,
              duration: status.duration,
              fps: status.fps,
              quality: status.quality,
              outputPath: status.outputPath,
            }),
          },
        ],
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  log('[MCP] Starting Desktop DVR MCP server');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Desktop DVR MCP server running on stdio');
  log('[MCP] Server connected and ready');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
