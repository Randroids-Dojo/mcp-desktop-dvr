import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DesktopCapture } from './capture/desktopCapture.js';
import { VideoAnalyzer } from './analysis/index.js';
import { log } from './utils/logger.js';

export class DesktopDVRServer {
  private server: Server;
  private desktopCapture: DesktopCapture;

  constructor(useOptimizedBuffer: boolean = true) {
    this.desktopCapture = new DesktopCapture(useOptimizedBuffer);
    
    this.server = new Server(
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

    this.setupHandlers();
    this.setupShutdownHandlers();
  }

  private setupHandlers(): void {
    // Tool: analyze-desktop-now
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
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
              bundleId: {
                type: 'string',
                description: 'Application bundle ID to capture (e.g., org.godotengine.godot, com.microsoft.VSCode). Leave empty for full screen.',
              },
              windowPadding: {
                type: 'number',
                description: 'Padding around window in pixels (default: 10)',
                minimum: 0,
                maximum: 100,
                default: 10,
              },
              captureAllWindows: {
                type: 'boolean',
                description: 'Capture all windows for the bundle ID instead of just the main window (useful for apps like Godot with editor + game windows)',
                default: false,
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
        {
          name: 'configure-capture',
          description: 'Update capture settings while recording is active',
          inputSchema: {
            type: 'object',
            properties: {
              fps: {
                type: 'number',
                description: 'Frames per second (1-60)',
                minimum: 1,
                maximum: 60,
              },
              quality: {
                type: 'number',
                description: 'Video quality (1-100)',
                minimum: 1,
                maximum: 100,
              },
            },
          },
        },
        {
          name: 'list-available-windows',
          description: 'List available applications and windows for capture',
          inputSchema: {
            type: 'object',
            properties: {
              bundleId: {
                type: 'string',
                description: 'Optional: specific bundle ID to check (e.g., org.godotengine.godot)',
              },
            },
          },
        },
        {
          name: 'cleanup-recording-processes',
          description: 'Emergency cleanup of any dangling recording processes (use if recording gets stuck)',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const toolArgs = args as Record<string, any>;
      
      log(`[MCP] Tool called: ${name}`);

      return await this.handleToolCall(name, toolArgs);
    });
  }

  private async handleToolCall(name: string, toolArgs: Record<string, any>): Promise<any> {
    switch (name) {
      case 'analyze-desktop-now':
        return await this.handleAnalyzeDesktopNow(toolArgs);
      case 'start-continuous-capture':
        return await this.handleStartContinuousCapture(toolArgs);
      case 'stop-capture':
        return await this.handleStopCapture();
      case 'get-capture-status':
        return await this.handleGetCaptureStatus();
      case 'configure-capture':
        return await this.handleConfigureCapture(toolArgs);
      case 'list-available-windows':
        return await this.handleListAvailableWindows(toolArgs);
      case 'cleanup-recording-processes':
        return await this.handleCleanupRecordingProcesses();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleAnalyzeDesktopNow(toolArgs: Record<string, any>): Promise<any> {
    try {
      const duration = toolArgs?.duration_seconds || 30;
      const analysisType = toolArgs?.analysis_type || 'full_analysis';
      
      // Check if capture is active
      const status = this.desktopCapture.getStatus();
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
      const videoPath = await this.desktopCapture.extractLastNSeconds(duration);
      
      // Perform video analysis
      const analyzer = new VideoAnalyzer();
      const analysisResult = await analyzer.analyze(videoPath, {
        duration,
        analysisType
      });
      
      // Get file details
      const fs = await import('fs').then(m => m.promises);
      const videoStats = await fs.stat(videoPath);
      const videoSizeMB = (videoStats.size / 1024 / 1024).toFixed(2);
      
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
              videoInfo: {
                filePath: videoPath,
                sizeBytes: videoStats.size,
                sizeMB: videoSizeMB,
                format: 'MP4 (H.264)',
                createdAt: videoStats.birthtime.toISOString()
              },
              analysisDetails: {
                method: analysisResult.results.enhancedDetails?.llmAnalysis ? 'LLM Analysis (OpenAI)' : 'OCR Fallback',
                llmProvider: analysisResult.results.enhancedDetails?.llmAnalysis?.provider || null,
                confidence: analysisResult.results.enhancedDetails?.llmAnalysis?.confidence || null,
                fallbackReason: analysisResult.results.llmError ? {
                  error: analysisResult.results.llmError.error,
                  provider: analysisResult.results.llmError.provider,
                  timestamp: analysisResult.results.llmError.timestamp,
                  explanation: 'LLM analysis failed, automatically fell back to OCR-based analysis'
                } : null,
                preprocessing: analysisResult.results.enhancedDetails?.llmAnalysis ? {
                  videoCompression: videoStats.size > 20 * 1024 * 1024 ? 'Applied (video > 20MB)' : 'Not needed',
                  maxVideoSize: '20MB',
                  targetBitrate: videoStats.size > 20 * 1024 * 1024 ? 'Calculated based on duration' : 'Original',
                  resolution: videoStats.size > 20 * 1024 * 1024 ? 'Scaled to max 1280px width' : 'Original'
                } : {
                  frameExtraction: 'Every 0.5-1 seconds',
                  maxFrames: `${Math.min(duration * 2, 60)} frames`,
                  ocrPreprocessing: 'Grayscale, normalize, resize to 1920x1080 max'
                }
              },
              apiCall: analysisResult.results.enhancedDetails?.llmAnalysis ? {
                provider: analysisResult.results.enhancedDetails.llmAnalysis.provider,
                model: 'gpt-4o',
                maxTokens: 1000,
                temperature: 0.3,
                inputFormat: 'Base64-encoded MP4 video',
                promptType: 'Structured analysis with JSON response'
              } : null,
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
  }

  private async handleStartContinuousCapture(toolArgs: Record<string, any>): Promise<any> {
    try {
      await this.desktopCapture.startCapture({
        fps: toolArgs?.fps || 30,
        quality: toolArgs?.quality || 70,
        bundleId: toolArgs?.bundleId,
        windowPadding: toolArgs?.windowPadding || 10,
        captureAllWindows: toolArgs?.captureAllWindows || false,
      });
      const status = this.desktopCapture.getStatus();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              message: status.bundleId 
                ? `Window-specific capture started for ${status.bundleId}` 
                : 'Full screen capture started',
              isRecording: status.isRecording,
              fps: status.fps,
              quality: status.quality,
              outputPath: status.outputPath,
              bundleId: status.bundleId,
              targetWindow: status.targetWindow ? {
                title: status.targetWindow.title,
                size: `${status.targetWindow.width}x${status.targetWindow.height}`,
                position: `${status.targetWindow.x},${status.targetWindow.y}`,
              } : undefined,
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
  }

  private async handleStopCapture(): Promise<any> {
    try {
      const outputPath = await this.desktopCapture.stopCapture();
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
  }

  private async handleGetCaptureStatus(): Promise<any> {
    const status = this.desktopCapture.getStatus();
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
  }

  private async handleConfigureCapture(toolArgs: Record<string, any>): Promise<any> {
    try {
      const newSettings: any = {};
      if (toolArgs?.fps !== undefined) newSettings.fps = toolArgs.fps;
      if (toolArgs?.quality !== undefined) newSettings.quality = toolArgs.quality;
      
      await this.desktopCapture.updateCaptureSettings(newSettings);
      const updatedStatus = this.desktopCapture.getStatus();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              message: 'Capture settings updated successfully. New settings will apply to the next segment.',
              isRecording: updatedStatus.isRecording,
              fps: updatedStatus.fps,
              quality: updatedStatus.quality,
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
              message: error instanceof Error ? error.message : 'Failed to update capture settings',
            }),
          },
        ],
      };
    }
  }

  private async handleCleanupRecordingProcesses(): Promise<any> {
    try {
      const { execSync } = await import('child_process');
      
      // Check for existing processes
      let processCount = 0;
      try {
        const stdout = execSync('ps aux | grep -i aperture | grep -v grep || echo ""', 
          { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        
        if (stdout.trim()) {
          processCount = stdout.trim().split('\n').length;
          
          // Kill aperture processes
          execSync('pkill -f "aperture.*record" 2>/dev/null || true');
          execSync('pkill -f "aperture.*events" 2>/dev/null || true');
          
          // Wait for cleanup
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        // Continue with cleanup attempt even if detection failed
      }
      
      // Reset capture state
      (this.desktopCapture as any).isRecording = false;
      (this.desktopCapture as any).currentSegmentPath = undefined;
      if ((this.desktopCapture as any).segmentInterval) {
        clearInterval((this.desktopCapture as any).segmentInterval);
        (this.desktopCapture as any).segmentInterval = undefined;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              message: `Emergency cleanup completed. Cleaned up ${processCount} aperture processes and reset capture state.`,
              processesFound: processCount,
              captureStateReset: true,
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
              message: error instanceof Error ? error.message : 'Failed to cleanup recording processes',
            }),
          },
        ],
      };
    }
  }

  private async handleListAvailableWindows(toolArgs: Record<string, any>): Promise<any> {
    try {
      const bundleId = toolArgs?.bundleId;
      
      if (bundleId) {
        // Check specific bundle ID
        const isRunning = await this.desktopCapture.isApplicationRunning(bundleId);
        const windows = isRunning ? await this.desktopCapture.getAvailableWindows(bundleId) : [];
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                bundleId,
                isRunning,
                windows: windows.map(w => ({
                  title: w.title,
                  size: `${w.width}x${w.height}`,
                  position: `${w.x},${w.y}`,
                  visible: w.isVisible,
                })),
              }),
            },
          ],
        };
      } else {
        // List common applications
        const commonBundles = this.desktopCapture.getCommonBundleIds();
        const runningApps: any[] = [];
        
        for (const [name, bundle] of Object.entries(commonBundles)) {
          const isRunning = await this.desktopCapture.isApplicationRunning(bundle);
          if (isRunning) {
            const windows = await this.desktopCapture.getAvailableWindows(bundle);
            runningApps.push({
              name,
              bundleId: bundle,
              isRunning,
              windowCount: windows.length,
              mainWindow: windows[0] ? {
                title: windows[0].title,
                size: `${windows[0].width}x${windows[0].height}`,
              } : null,
            });
          }
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: `Found ${runningApps.length} running applications`,
                runningApplications: runningApps,
                commonBundleIds: commonBundles,
              }),
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              message: error instanceof Error ? error.message : 'Failed to list windows',
            }),
          },
        ],
      };
    }
  }

  private setupShutdownHandlers(): void {
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      log('[MCP] Received SIGINT, shutting down gracefully');
      await this.desktopCapture.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log('[MCP] Received SIGTERM, shutting down gracefully');
      await this.desktopCapture.shutdown();
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    log('[MCP] Starting Desktop DVR MCP server');
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Desktop DVR MCP server running on stdio');
    log('[MCP] Server connected and ready');
  }

  async shutdown(): Promise<void> {
    await this.desktopCapture.shutdown();
  }
}