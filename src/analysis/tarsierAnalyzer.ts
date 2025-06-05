import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TarsierAnalysisResult {
  video_path: string;
  frame_count?: number;
  analysis?: string;
  processing_time_seconds: number;
  model_used: string;
  device: string;
  prompt?: string;
  error?: string;
}

export interface TarsierAnalysisOptions {
  frameCount?: number;
  prompt?: string;
  model?: string;
}

export class TarsierAnalyzer {
  private readonly pythonScriptPath: string;

  constructor() {
    this.pythonScriptPath = path.join(__dirname, 'tarsier_analyzer.py');
  }

  async analyzeVideo(
    videoPath: string, 
    options: TarsierAnalysisOptions = {}
  ): Promise<TarsierAnalysisResult> {
    const {
      frameCount = 16,
      prompt,
      model = 'omni-research/Tarsier2-Recap-7b'
    } = options;

    logger.info(`Starting Tarsier analysis for video: ${videoPath}`);
    
    return new Promise((resolve, reject) => {
      const args = [
        this.pythonScriptPath,
        videoPath,
        '--frames', frameCount.toString(),
        '--model', model
      ];

      if (prompt) {
        args.push('--prompt', prompt);
      }

      const python = spawn('python3', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Set a timeout of 60 minutes for the analysis (allows for model download)
      const timeout = setTimeout(() => {
        killed = true;
        python.kill('SIGTERM');
        logger.error('Tarsier analysis timed out after 60 minutes');
        reject(new Error('Tarsier analysis timed out. Model may need to be downloaded or initialized. Try running with ANALYZER_PREFERENCE=ocr'));
      }, 60 * 60 * 1000);

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log progress messages from Python script
        const lines = data.toString().split('\n');
        lines.forEach((line: string) => {
          if (line.trim()) {
            logger.info(`Tarsier: ${line.trim()}`);
          }
        });
      });

      python.on('close', (code) => {
        clearTimeout(timeout);
        
        if (killed) {
          return; // Already rejected due to timeout
        }
        
        if (code === 0) {
          try {
            const result: TarsierAnalysisResult = JSON.parse(stdout);
            logger.info(`Tarsier analysis completed in ${result.processing_time_seconds}s`);
            resolve(result);
          } catch (error) {
            logger.error('Failed to parse Tarsier analysis result:', error);
            reject(new Error(`Failed to parse analysis result: ${error}`));
          }
        } else {
          logger.error(`Tarsier analysis failed with code ${code}: ${stderr}`);
          reject(new Error(`Analysis failed: ${stderr || 'Unknown error'}`));
        }
      });

      python.on('error', (error) => {
        clearTimeout(timeout);
        logger.error('Failed to start Tarsier analysis:', error);
        reject(new Error(`Failed to start analysis: ${error.message}`));
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      return new Promise((resolve) => {
        const python = spawn('python3', ['-c', 'import torch, transformers, cv2; print("OK")'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Set a 10 second timeout for availability check
        const timeout = setTimeout(() => {
          python.kill('SIGTERM');
          logger.warn('Tarsier availability check timed out');
          resolve(false);
        }, 10000);

        python.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code === 0);
        });

        python.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  async getModelInfo(): Promise<{ device: string; model: string; available: boolean }> {
    try {
      return new Promise((resolve, reject) => {
        const python = spawn('python3', ['-c', `
import torch
import sys
try:
    from transformers import AutoProcessor
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = "omni-research/Tarsier2-Recap-7b"
    print(f'{{"device": "{device}", "model": "{model}", "available": true}}')
except Exception as e:
    print(f'{{"device": "unknown", "model": "unknown", "available": false, "error": "{str(e)}"}}')
        `], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        python.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        python.on('close', (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout.trim()));
            } catch {
              resolve({ device: 'unknown', model: 'unknown', available: false });
            }
          } else {
            resolve({ device: 'unknown', model: 'unknown', available: false });
          }
        });

        python.on('error', () => {
          resolve({ device: 'unknown', model: 'unknown', available: false });
        });
      });
    } catch {
      return { device: 'unknown', model: 'unknown', available: false };
    }
  }
}