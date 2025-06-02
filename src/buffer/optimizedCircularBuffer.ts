import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createReadStream, createWriteStream } from 'fs';
import { EventEmitter } from 'events';
import { MemoryMonitor } from './memoryMonitor.js';
import { log } from '../utils/logger.js';

interface BufferSegment {
  id: string;
  startTime: Date;
  endTime: Date;
  filePath: string;
  sizeBytes: number;
  durationSeconds: number;
  tier: 'hot' | 'cold';
  inMemory: boolean;
  memoryData?: Buffer;
  lastAccessed: Date;
}

interface OptimizationConfig {
  hotTierMaxSegments: number;
  hotTierMaxSizeMB: number;
  memoryPressureEvictionThreshold: number;
  enableMemoryMapping: boolean;
}

const execAsync = promisify(exec);

export class OptimizedCircularBuffer extends EventEmitter {
  private segments: Map<string, BufferSegment> = new Map();
  private segmentOrder: string[] = []; // Maintain insertion order
  private maxDurationMs: number = 30 * 60 * 1000; // 30 minutes
  private segmentDurationMs: number = 60 * 1000; // 1 minute segments
  private bufferDir: string;
  private extractDir: string;
  private hotDir: string;
  private coldDir: string;
  private isInitialized: boolean = false;
  
  private memoryMonitor: MemoryMonitor;
  private config: OptimizationConfig;
  private hotTierSize: number = 0;
  
  constructor(bufferDir?: string, config?: Partial<OptimizationConfig>) {
    super();
    this.bufferDir = bufferDir || path.join(os.tmpdir(), 'desktop-dvr-buffer');
    this.extractDir = path.join(this.bufferDir, 'extracts');
    this.hotDir = path.join(this.bufferDir, 'hot');
    this.coldDir = path.join(this.bufferDir, 'cold');
    
    this.config = {
      hotTierMaxSegments: 5, // Keep last 5 segments in hot tier (5 minutes)
      hotTierMaxSizeMB: 500, // Max 500MB for hot tier
      memoryPressureEvictionThreshold: 0.8, // Evict when 80% of max memory
      enableMemoryMapping: true,
      ...config
    };
    
    this.memoryMonitor = new MemoryMonitor();
    this.setupMemoryHandlers();
  }
  
  private setupMemoryHandlers(): void {
    this.memoryMonitor.on('memoryWarning', (stats) => {
      log(`[OptimizedBuffer] Memory warning: ${stats.totalMB.toFixed(2)}MB used`);
      this.evictLRUSegments(1);
    });
    
    this.memoryMonitor.on('memoryCritical', (stats) => {
      log(`[OptimizedBuffer] Memory critical: ${stats.totalMB.toFixed(2)}MB used`);
      this.evictLRUSegments(3);
    });
    
    this.memoryMonitor.on('memoryExceeded', (stats) => {
      log(`[OptimizedBuffer] Memory exceeded: ${stats.totalMB.toFixed(2)}MB used`);
      this.evictAllFromMemory();
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    log('[OptimizedBuffer] Initializing optimized buffer system');
    
    // Create directory structure
    await fs.mkdir(this.bufferDir, { recursive: true });
    await fs.mkdir(this.extractDir, { recursive: true });
    await fs.mkdir(this.hotDir, { recursive: true });
    await fs.mkdir(this.coldDir, { recursive: true });
    
    // Start memory monitoring
    this.memoryMonitor.startMonitoring(5000); // Check every 5 seconds
    
    // Clean up any existing segments from previous runs
    await this.cleanupOldSegments();
    
    this.isInitialized = true;
    log('[OptimizedBuffer] Initialization complete');
  }

  async addVideoChunk(videoPath: string, durationSeconds: number = 60): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Buffer not initialized. Call initialize() first.');
    }

    const now = new Date();
    const stats = await fs.stat(videoPath);
    
    // Create segment metadata
    const segmentId = `segment_${now.getTime()}`;
    const isHot = this.segmentOrder.length < this.config.hotTierMaxSegments;
    const tierPath = isHot ? this.hotDir : this.coldDir;
    const segmentPath = path.join(tierPath, `${segmentId}.mp4`);
    
    // Copy the video file to appropriate tier
    await fs.copyFile(videoPath, segmentPath);
    
    // Calculate start time based on duration
    const startTime = new Date(now.getTime() - (durationSeconds * 1000));
    
    // Create segment object
    const segment: BufferSegment = {
      id: segmentId,
      startTime: startTime,
      endTime: now,
      filePath: segmentPath,
      sizeBytes: stats.size,
      durationSeconds: durationSeconds,
      tier: isHot ? 'hot' : 'cold',
      inMemory: false,
      lastAccessed: now,
    };
    
    // Add to segments map and maintain order
    this.segments.set(segmentId, segment);
    this.segmentOrder.push(segmentId);
    
    // Update hot tier size if needed
    if (isHot) {
      this.hotTierSize += stats.size;
    }
    
    log(`[OptimizedBuffer] Added ${segment.tier} segment: ${segment.startTime.toISOString()} to ${segment.endTime.toISOString()} (${segment.durationSeconds}s)`);

    // Manage tiers and memory
    await this.manageTiers();
    await this.pruneOldSegments(now);
  }

  private async manageTiers(): Promise<void> {
    // Check if we need to demote segments from hot to cold
    const hotSegments = this.segmentOrder
      .map(id => this.segments.get(id)!)
      .filter(seg => seg.tier === 'hot');
    
    // Check segment count
    if (hotSegments.length > this.config.hotTierMaxSegments) {
      const toDemote = hotSegments.slice(0, hotSegments.length - this.config.hotTierMaxSegments);
      for (const segment of toDemote) {
        await this.demoteSegment(segment);
      }
    }
    
    // Check hot tier size
    const hotTierSizeMB = this.hotTierSize / (1024 * 1024);
    if (hotTierSizeMB > this.config.hotTierMaxSizeMB) {
      const toDemote = hotSegments.slice(0, Math.ceil(hotSegments.length / 2));
      for (const segment of toDemote) {
        await this.demoteSegment(segment);
      }
    }
  }

  private async demoteSegment(segment: BufferSegment): Promise<void> {
    if (segment.tier !== 'hot') return;
    
    log(`[OptimizedBuffer] Demoting segment ${segment.id} to cold tier`);
    
    const newPath = path.join(this.coldDir, path.basename(segment.filePath));
    await fs.rename(segment.filePath, newPath);
    
    segment.filePath = newPath;
    segment.tier = 'cold';
    
    // Evict from memory if present
    if (segment.inMemory) {
      segment.memoryData = undefined;
      segment.inMemory = false;
    }
    
    this.hotTierSize -= segment.sizeBytes;
  }

  private async promoteSegment(segment: BufferSegment): Promise<void> {
    if (segment.tier !== 'cold') return;
    
    log(`[OptimizedBuffer] Promoting segment ${segment.id} to hot tier`);
    
    const newPath = path.join(this.hotDir, path.basename(segment.filePath));
    await fs.rename(segment.filePath, newPath);
    
    segment.filePath = newPath;
    segment.tier = 'hot';
    segment.lastAccessed = new Date();
    
    this.hotTierSize += segment.sizeBytes;
  }

  private async loadSegmentToMemory(segment: BufferSegment): Promise<void> {
    if (segment.inMemory || this.memoryMonitor.shouldEvictSegments()) {
      return;
    }
    
    log(`[OptimizedBuffer] Loading segment ${segment.id} to memory`);
    
    try {
      segment.memoryData = await fs.readFile(segment.filePath);
      segment.inMemory = true;
      segment.lastAccessed = new Date();
    } catch (error) {
      log(`[OptimizedBuffer] Failed to load segment to memory: ${error}`);
    }
  }

  private evictLRUSegments(count: number): void {
    const inMemorySegments = Array.from(this.segments.values())
      .filter(seg => seg.inMemory)
      .sort((a, b) => a.lastAccessed.getTime() - b.lastAccessed.getTime());
    
    const toEvict = inMemorySegments.slice(0, Math.min(count, inMemorySegments.length));
    
    for (const segment of toEvict) {
      log(`[OptimizedBuffer] Evicting segment ${segment.id} from memory`);
      segment.memoryData = undefined;
      segment.inMemory = false;
    }
  }

  private evictAllFromMemory(): void {
    log('[OptimizedBuffer] Evicting all segments from memory due to memory pressure');
    
    for (const segment of this.segments.values()) {
      if (segment.inMemory) {
        segment.memoryData = undefined;
        segment.inMemory = false;
      }
    }
  }

  async extractLastNSeconds(seconds: number): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Buffer not initialized. Call initialize() first.');
    }

    const now = new Date();
    const startTime = new Date(now.getTime() - seconds * 1000);
    
    // Find relevant segments
    const relevantSegments = this.segmentOrder
      .map(id => this.segments.get(id)!)
      .filter(segment => 
        segment.endTime >= startTime && segment.startTime <= now
      )
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    log(`[OptimizedBuffer] Extracting ${seconds}s from ${relevantSegments.length} segments`);

    if (relevantSegments.length === 0) {
      throw new Error('No video data available for the requested time range');
    }

    // Update last accessed time and potentially promote cold segments
    for (const segment of relevantSegments) {
      segment.lastAccessed = new Date();
      if (segment.tier === 'cold' && relevantSegments.length <= 2) {
        // Promote frequently accessed cold segments
        await this.promoteSegment(segment);
      }
    }

    // Generate output filename
    const outputFilename = `extract_${now.getTime()}_${seconds}s.mp4`;
    const outputPath = path.join(this.extractDir, outputFilename);

    if (relevantSegments.length === 1) {
      // Single segment - trim to requested duration
      const segment = relevantSegments[0];
      const trimStart = Math.max(0, (startTime.getTime() - segment.startTime.getTime()) / 1000);
      const trimDuration = seconds;
      
      const ffmpegCmd = `ffmpeg -ss ${trimStart} -i "${segment.filePath}" -t ${trimDuration} -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -y`;
      await execAsync(ffmpegCmd);
      return outputPath;
    }

    // Multiple segments - concatenate
    const concatFilePath = path.join(this.extractDir, `concat_${now.getTime()}.txt`);
    const concatContent = relevantSegments
      .map(seg => `file '${seg.filePath}'`)
      .join('\n');
    await fs.writeFile(concatFilePath, concatContent);

    try {
      const tempPath = path.join(this.extractDir, `temp_${now.getTime()}.mp4`);
      const concatCmd = `ffmpeg -f concat -safe 0 -i "${concatFilePath}" -c copy "${tempPath}" -y`;
      await execAsync(concatCmd);

      const firstSegment = relevantSegments[0];
      const trimStart = Math.max(0, (startTime.getTime() - firstSegment.startTime.getTime()) / 1000);
      
      const trimCmd = `ffmpeg -ss ${trimStart} -i "${tempPath}" -t ${seconds} -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -y`;
      await execAsync(trimCmd);

      await fs.unlink(concatFilePath);
      await fs.unlink(tempPath);

      return outputPath;
    } catch (error) {
      try {
        await fs.unlink(concatFilePath);
      } catch {}
      throw new Error(`Failed to extract video: ${error}`);
    }
  }

  getStatus(): {
    isActive: boolean;
    totalSegments: number;
    hotSegments: number;
    coldSegments: number;
    inMemorySegments: number;
    oldestSegmentTime: Date | null;
    newestSegmentTime: Date | null;
    totalSizeBytes: number;
    hotTierSizeMB: number;
    bufferDurationSeconds: number;
    memoryStats: ReturnType<MemoryMonitor['getMemoryStats']>;
  } {
    const segments = Array.from(this.segments.values());
    const hotSegments = segments.filter(s => s.tier === 'hot');
    const coldSegments = segments.filter(s => s.tier === 'cold');
    const inMemorySegments = segments.filter(s => s.inMemory);
    
    const totalSizeBytes = segments.reduce((sum, seg) => sum + seg.sizeBytes, 0);
    const oldestSegment = segments[0];
    const newestSegment = segments[segments.length - 1];
    
    let bufferDurationSeconds = 0;
    if (oldestSegment && newestSegment) {
      bufferDurationSeconds = Math.floor(
        (newestSegment.endTime.getTime() - oldestSegment.startTime.getTime()) / 1000
      );
    }

    return {
      isActive: segments.length > 0,
      totalSegments: segments.length,
      hotSegments: hotSegments.length,
      coldSegments: coldSegments.length,
      inMemorySegments: inMemorySegments.length,
      oldestSegmentTime: oldestSegment?.startTime || null,
      newestSegmentTime: newestSegment?.endTime || null,
      totalSizeBytes,
      hotTierSizeMB: this.hotTierSize / (1024 * 1024),
      bufferDurationSeconds,
      memoryStats: this.memoryMonitor.getMemoryStats(),
    };
  }

  private async pruneOldSegments(now: Date): Promise<void> {
    const cutoffTime = new Date(now.getTime() - this.maxDurationMs);
    
    const toRemove: string[] = [];
    for (const [id, segment] of this.segments) {
      if (segment.endTime < cutoffTime) {
        toRemove.push(id);
      }
    }
    
    for (const id of toRemove) {
      const segment = this.segments.get(id)!;
      try {
        await fs.unlink(segment.filePath);
        log(`[OptimizedBuffer] Pruned old segment: ${segment.id}`);
      } catch (error) {
        log(`[OptimizedBuffer] Failed to delete segment file: ${error}`);
      }
      
      this.segments.delete(id);
      const index = this.segmentOrder.indexOf(id);
      if (index > -1) {
        this.segmentOrder.splice(index, 1);
      }
      
      if (segment.tier === 'hot') {
        this.hotTierSize -= segment.sizeBytes;
      }
    }
  }

  private async cleanupOldSegments(): Promise<void> {
    try {
      // Clean up hot directory
      const hotFiles = await fs.readdir(this.hotDir);
      for (const file of hotFiles) {
        if (file.endsWith('.mp4')) {
          await fs.unlink(path.join(this.hotDir, file));
        }
      }
      
      // Clean up cold directory
      const coldFiles = await fs.readdir(this.coldDir);
      for (const file of coldFiles) {
        if (file.endsWith('.mp4')) {
          await fs.unlink(path.join(this.coldDir, file));
        }
      }
      
      // Clean up extracts
      const extractFiles = await fs.readdir(this.extractDir);
      for (const file of extractFiles) {
        await fs.unlink(path.join(this.extractDir, file));
      }
    } catch (error) {
      log(`[OptimizedBuffer] Error during cleanup: ${error}`);
    }
  }

  async shutdown(): Promise<void> {
    log('[OptimizedBuffer] Shutting down');
    this.memoryMonitor.stopMonitoring();
    this.evictAllFromMemory();
    await this.cleanupOldSegments();
  }
}