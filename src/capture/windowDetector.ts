import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '../utils/logger.js';

const execAsync = promisify(exec);

export interface WindowInfo {
  windowId: number;
  bundleId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isVisible: boolean;
  processName: string;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class WindowDetector {
  /**
   * Find all windows for a specific application bundle ID
   */
  async findWindowsByBundleId(bundleId: string): Promise<WindowInfo[]> {
    try {
      log(`[WindowDetector] Finding windows for bundle ID: ${bundleId}`);
      
      // Use AppleScript to get window information
      const script = `
        tell application "System Events"
          set appProcesses to application processes whose bundle identifier is "${bundleId}"
          set windowList to {}
          repeat with appProcess in appProcesses
            try
              set appWindows to windows of appProcess
              repeat with appWindow in appWindows
                try
                  set windowPosition to position of appWindow
                  set windowSize to size of appWindow
                  set windowTitle to title of appWindow
                  set windowVisible to visible of appWindow
                  set windowInfo to {¬
                    title: windowTitle, ¬
                    x: item 1 of windowPosition, ¬
                    y: item 2 of windowPosition, ¬
                    width: item 1 of windowSize, ¬
                    height: item 2 of windowSize, ¬
                    visible: windowVisible¬
                  }
                  set end of windowList to windowInfo
                end try
              end repeat
            end try
          end repeat
          return windowList
        end tell
      `;
      
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
      const windowData = this.parseAppleScriptOutput(stdout, bundleId);
      
      log(`[WindowDetector] Found ${windowData.length} windows for ${bundleId}`);
      return windowData;
    } catch (error) {
      log(`[WindowDetector] Error finding windows: ${error}`);
      return [];
    }
  }

  /**
   * Find the main/frontmost window for an application
   */
  async findMainWindowByBundleId(bundleId: string): Promise<WindowInfo | null> {
    const windows = await this.findWindowsByBundleId(bundleId);
    
    // Filter for visible windows and get the largest one (likely main window)
    const visibleWindows = windows.filter(w => w.isVisible && w.width > 100 && w.height > 100);
    
    if (visibleWindows.length === 0) {
      return null;
    }
    
    // Sort by size (area) and return the largest
    visibleWindows.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    return visibleWindows[0];
  }

  /**
   * Get crop area for a specific window with optional padding
   */
  windowToCropArea(window: WindowInfo, padding: number = 0): CropArea {
    return {
      x: Math.max(0, window.x - padding),
      y: Math.max(0, window.y - padding),
      width: window.width + (padding * 2),
      height: window.height + (padding * 2),
    };
  }

  /**
   * Get a list of common application bundle IDs
   */
  getCommonBundleIds(): Record<string, string> {
    return {
      'godot': 'org.godotengine.godot',
      'vscode': 'com.microsoft.VSCode',
      'finder': 'com.apple.finder',
      'safari': 'com.apple.Safari',
      'chrome': 'com.google.Chrome',
      'firefox': 'org.mozilla.firefox',
      'terminal': 'com.apple.Terminal',
      'iterm': 'com.googlecode.iterm2',
      'xcode': 'com.apple.dt.Xcode',
      'figma': 'com.figma.Desktop',
      'slack': 'com.tinyspeck.slackmacgap',
      'discord': 'com.hnc.Discord',
      'notion': 'notion.id',
      'obsidian': 'md.obsidian',
      'arc': 'company.thebrowser.Browser',
    };
  }

  /**
   * Validate that a bundle ID application is running
   */
  async isApplicationRunning(bundleId: string): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          set appProcesses to application processes whose bundle identifier is "${bundleId}"
          return (count of appProcesses) > 0
        end tell
      `;
      
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
      return stdout.trim() === 'true';
    } catch (error) {
      log(`[WindowDetector] Error checking if app is running: ${error}`);
      return false;
    }
  }

  private parseAppleScriptOutput(output: string, bundleId: string): WindowInfo[] {
    try {
      // This is a simplified parser - AppleScript output format can vary
      // In a production system, you'd want more robust parsing
      const windows: WindowInfo[] = [];
      
      // For now, return a placeholder implementation
      // In reality, you'd need to parse the specific AppleScript output format
      log(`[WindowDetector] Parsing AppleScript output for ${bundleId}: ${output.substring(0, 100)}...`);
      
      return windows;
    } catch (error) {
      log(`[WindowDetector] Error parsing AppleScript output: ${error}`);
      return [];
    }
  }

  /**
   * Alternative approach using native macOS tools
   */
  async findWindowsUsingNativeTools(bundleId: string): Promise<WindowInfo[]> {
    try {
      // Use yabai or similar window manager tools if available
      // This is a placeholder for a more robust implementation
      const { stdout } = await execAsync(`ps aux | grep "${bundleId}" | grep -v grep`);
      
      if (stdout.trim()) {
        log(`[WindowDetector] Found running process for ${bundleId}`);
        // In a full implementation, you'd use native tools to get window positions
        return [];
      }
      
      return [];
    } catch (error) {
      log(`[WindowDetector] Native tools approach failed: ${error}`);
      return [];
    }
  }
}