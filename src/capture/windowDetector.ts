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
   * Create a bounding box that encompasses all provided windows
   */
  createBoundingBoxForWindows(windows: WindowInfo[], padding: number = 0): CropArea {
    if (windows.length === 0) {
      throw new Error('Cannot create bounding box for empty window list');
    }

    // Find the bounds that encompass all windows
    let minX = Math.min(...windows.map(w => w.x));
    let minY = Math.min(...windows.map(w => w.y));
    let maxX = Math.max(...windows.map(w => w.x + w.width));
    let maxY = Math.max(...windows.map(w => w.y + w.height));

    // Apply padding
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX + (padding * 2),
      height: maxY - minY + (padding * 2),
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
      const windows: WindowInfo[] = [];
      const trimmedOutput = output.trim();
      
      log(`[WindowDetector] Parsing AppleScript output for ${bundleId}: ${trimmedOutput.substring(0, 200)}...`);
      
      // Handle empty output or "missing value"
      if (!trimmedOutput || trimmedOutput === 'missing value' || trimmedOutput === '{}') {
        log(`[WindowDetector] No windows found for ${bundleId}`);
        return windows;
      }
      
      // AppleScript returns a list format like:
      // {{title:"Window 1", x:100, y:200, width:800, height:600, visible:true}, {title:"Window 2", ...}}
      // We need to parse this format
      
      // Split on record boundaries - for AppleScript list format like {{...}, {...}}
      // If it's a single record, it won't have outer list braces
      let windowRecords: string[];
      
      if (trimmedOutput.startsWith('{{') && trimmedOutput.endsWith('}}')) {
        // Multiple records in list format: {{record1}, {record2}, ...}
        const cleanOutput = trimmedOutput.slice(1, -1); // Remove outer {}
        windowRecords = this.splitAppleScriptRecords(cleanOutput);
      } else if (trimmedOutput.startsWith('{') && trimmedOutput.endsWith('}')) {
        // Single record: {record}
        windowRecords = [trimmedOutput];
      } else {
        // Unexpected format
        log(`[WindowDetector] Unexpected AppleScript output format: ${trimmedOutput.substring(0, 100)}...`);
        return windows;
      }
      
      for (let i = 0; i < windowRecords.length; i++) {
        const record = windowRecords[i].trim();
        if (!record) continue;
        
        try {
          const windowInfo = this.parseWindowRecord(record, bundleId, i);
          if (windowInfo) {
            windows.push(windowInfo);
          }
        } catch (error) {
          log(`[WindowDetector] Error parsing window record ${i}: ${error}`);
        }
      }
      
      log(`[WindowDetector] Successfully parsed ${windows.length} windows for ${bundleId}`);
      return windows;
    } catch (error) {
      log(`[WindowDetector] Error parsing AppleScript output: ${error}`);
      return [];
    }
  }
  
  private splitAppleScriptRecords(output: string): string[] {
    const records: string[] = [];
    let currentRecord = '';
    let braceDepth = 0;
    let inString = false;
    let i = 0;
    
    while (i < output.length) {
      const char = output[i];
      
      if (char === '"' && (i === 0 || output[i - 1] !== '\\')) {
        inString = !inString;
      }
      
      if (!inString) {
        if (char === '{') {
          braceDepth++;
        } else if (char === '}') {
          braceDepth--;
        }
      }
      
      currentRecord += char;
      
      // If we're at depth 0 and hit a comma, or at the end, we have a complete record
      if (!inString && braceDepth === 0 && (char === ',' || i === output.length - 1)) {
        const cleanRecord = currentRecord.replace(/,$/, '').trim();
        if (cleanRecord) {
          records.push(cleanRecord);
        }
        currentRecord = '';
      }
      
      i++;
    }
    
    return records;
  }
  
  private parseWindowRecord(record: string, bundleId: string, windowId: number): WindowInfo | null {
    try {
      // Remove outer braces if present
      const cleanRecord = record.replace(/^{|}$/g, '').trim();
      
      // Parse key-value pairs
      const properties: Record<string, any> = {};
      const pairs = this.extractKeyValuePairs(cleanRecord);
      
      for (const [key, value] of pairs) {
        properties[key] = value;
      }
      
      // Extract required properties
      const title = properties.title || '';
      const x = parseInt(properties.x) || 0;
      const y = parseInt(properties.y) || 0;
      const width = parseInt(properties.width) || 0;
      const height = parseInt(properties.height) || 0;
      const visible = properties.visible === 'true' || properties.visible === true;
      
      // Skip invalid windows
      if (width <= 0 || height <= 0) {
        log(`[WindowDetector] Skipping invalid window: ${title} (${width}x${height})`);
        return null;
      }
      
      const windowInfo: WindowInfo = {
        windowId,
        bundleId,
        title,
        x,
        y,
        width,
        height,
        isVisible: visible,
        processName: bundleId.split('.').pop() || 'unknown'
      };
      
      log(`[WindowDetector] Parsed window: "${title}" at (${x},${y}) size ${width}x${height} visible=${visible}`);
      return windowInfo;
    } catch (error) {
      log(`[WindowDetector] Error parsing window record: ${error}`);
      return null;
    }
  }
  
  private extractKeyValuePairs(record: string): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    const regex = /(\w+):\s*([^,}]+)(?=,|\s*}|$)/g;
    let match;
    
    while ((match = regex.exec(record)) !== null) {
      const key = match[1].trim();
      let value = match[2].trim();
      
      // Remove quotes from string values
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      
      pairs.push([key, value]);
    }
    
    return pairs;
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