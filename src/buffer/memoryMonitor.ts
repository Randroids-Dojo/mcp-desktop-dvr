import { EventEmitter } from 'events';
import { log } from '../utils/logger.js';

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  totalMB: number;
  percentUsed: number;
}

export interface MemoryThresholds {
  warningMB: number;
  criticalMB: number;
  maxMB: number;
}

export class MemoryMonitor extends EventEmitter {
  private monitorInterval?: ReturnType<typeof setInterval>;
  private thresholds: MemoryThresholds;
  private lastStats?: MemoryStats;
  
  constructor(thresholds: MemoryThresholds = {
    warningMB: 1000,    // Warning at 1GB
    criticalMB: 1300,   // Critical at 1.3GB
    maxMB: 1500,        // Target max 1.5GB
  }) {
    super();
    this.thresholds = thresholds;
  }
  
  startMonitoring(intervalMs: number = 10000): void {
    if (this.monitorInterval) {
      this.stopMonitoring();
    }
    
    log('[MemoryMonitor] Starting memory monitoring');
    
    // Initial check
    this.checkMemory();
    
    // Set up periodic monitoring
    this.monitorInterval = setInterval(() => {
      this.checkMemory();
    }, intervalMs);
  }
  
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
      log('[MemoryMonitor] Stopped memory monitoring');
    }
  }
  
  private checkMemory(): void {
    const stats = this.getMemoryStats();
    this.lastStats = stats;
    
    // Check thresholds
    if (stats.totalMB > this.thresholds.maxMB) {
      log(`[MemoryMonitor] CRITICAL: Memory usage exceeded max threshold: ${stats.totalMB.toFixed(2)}MB > ${this.thresholds.maxMB}MB`);
      this.emit('memoryExceeded', stats);
    } else if (stats.totalMB > this.thresholds.criticalMB) {
      log(`[MemoryMonitor] WARNING: Memory usage critical: ${stats.totalMB.toFixed(2)}MB`);
      this.emit('memoryCritical', stats);
    } else if (stats.totalMB > this.thresholds.warningMB) {
      log(`[MemoryMonitor] WARNING: Memory usage high: ${stats.totalMB.toFixed(2)}MB`);
      this.emit('memoryWarning', stats);
    }
    
    // Emit regular update
    this.emit('memoryUpdate', stats);
  }
  
  getMemoryStats(): MemoryStats {
    const memUsage = process.memoryUsage();
    const totalBytes = memUsage.heapUsed + memUsage.external;
    const totalMB = totalBytes / (1024 * 1024);
    const percentUsed = (totalMB / this.thresholds.maxMB) * 100;
    
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      totalMB,
      percentUsed,
    };
  }
  
  getLastStats(): MemoryStats | undefined {
    return this.lastStats;
  }
  
  isMemoryPressure(): boolean {
    const stats = this.getMemoryStats();
    return stats.totalMB > this.thresholds.warningMB;
  }
  
  shouldEvictSegments(): boolean {
    const stats = this.getMemoryStats();
    return stats.totalMB > this.thresholds.criticalMB;
  }
}