#!/usr/bin/env python3
"""
Tarsier2-7B Video Analysis for MCP Desktop DVR
Extracts frames from video clips and analyzes them using Tarsier2-Recap-7B model.
"""

import cv2
import os
import sys
import argparse
import json
from typing import List, Dict, Any
from pathlib import Path
import torch
from transformers import AutoProcessor, AutoModelForVision2Seq
from PIL import Image
import time

class TarsierVideoAnalyzer:
    def __init__(self, model_name: str = "omni-research/Tarsier2-Recap-7b"):
        """Initialize the Tarsier video analyzer."""
        self.model_name = model_name
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        print(f"Using device: {self.device}", file=sys.stderr)
        
        # Load processor and model
        self.processor = None
        self.model = None
        self._load_model()
        
    def _load_model(self):
        """Load the Tarsier model and processor."""
        try:
            print("Loading Tarsier2-Recap-7B processor...", file=sys.stderr)
            self.processor = AutoProcessor.from_pretrained(self.model_name)
            
            print("Loading Tarsier2-Recap-7B model...", file=sys.stderr)
            self.model = AutoModelForVision2Seq.from_pretrained(
                self.model_name,
                torch_dtype=torch.float16 if self.device == "mps" else torch.float32,
                device_map="auto" if self.device != "mps" else None
            )
            
            if self.device == "mps":
                self.model = self.model.to(self.device)
                
            print("Model loaded successfully!", file=sys.stderr)
            
        except Exception as e:
            print(f"Error loading model: {e}", file=sys.stderr)
            raise

    def extract_frames_evenly(self, video_path: str, frame_count: int = 16, output_dir: str = None) -> List[str]:
        """
        Extract frames evenly spaced across the video clip.
        
        Args:
            video_path: Path to the video file
            frame_count: Number of frames to extract
            output_dir: Directory to save frames (defaults to temp directory)
            
        Returns:
            List of frame file paths
        """
        if output_dir is None:
            output_dir = os.path.join(os.path.expanduser("~"), ".mcp-desktop-dvr", "tarsier-frames")
        
        os.makedirs(output_dir, exist_ok=True)
        
        # Clean up old frames
        for file in os.listdir(output_dir):
            if file.startswith("frame_") and file.endswith(".png"):
                os.remove(os.path.join(output_dir, file))
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")
            
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames == 0:
            raise ValueError(f"Video has no frames: {video_path}")
            
        frame_paths = []
        interval = max(1, total_frames // frame_count)
        
        for i in range(frame_count):
            frame_index = min(i * interval, total_frames - 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            
            ret, frame = cap.read()
            if not ret:
                break
                
            frame_path = os.path.join(output_dir, f"frame_{i:02d}.png")
            cv2.imwrite(frame_path, frame)
            frame_paths.append(frame_path)
            
        cap.release()
        return frame_paths

    def analyze_frames(self, frame_paths: List[str], prompt: str = "Describe what is happening in this video sequence.") -> str:
        """
        Analyze extracted frames using Tarsier2-Recap-7B.
        
        Args:
            frame_paths: List of frame file paths
            prompt: Analysis prompt
            
        Returns:
            Analysis result as string
        """
        if not frame_paths:
            return "No frames to analyze"
            
        try:
            # Load images
            images = []
            for frame_path in frame_paths:
                if os.path.exists(frame_path):
                    image = Image.open(frame_path).convert("RGB")
                    images.append(image)
            
            if not images:
                return "No valid frames found"
            
            print(f"Analyzing {len(images)} frames...", file=sys.stderr)
            
            # Prepare inputs for the model
            inputs = self.processor(images=images, text=prompt, return_tensors="pt")
            
            if self.device == "mps":
                inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            # Generate analysis
            with torch.no_grad():
                generated_ids = self.model.generate(
                    **inputs,
                    max_new_tokens=256,
                    do_sample=False,
                    pad_token_id=self.processor.tokenizer.eos_token_id
                )
            
            # Decode the result
            generated_text = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
            
            # Extract only the generated part (remove the input prompt)
            if prompt in generated_text:
                result = generated_text.replace(prompt, "").strip()
            else:
                result = generated_text.strip()
                
            return result
            
        except Exception as e:
            error_msg = f"Analysis failed: {str(e)}"
            print(error_msg, file=sys.stderr)
            return error_msg

    def analyze_video(self, video_path: str, frame_count: int = 16, prompt: str = None) -> Dict[str, Any]:
        """
        Complete video analysis pipeline.
        
        Args:
            video_path: Path to video file
            frame_count: Number of frames to extract
            prompt: Custom analysis prompt
            
        Returns:
            Analysis results dictionary
        """
        if prompt is None:
            prompt = (
                "Analyze this desktop screen recording sequence. "
                "Describe the user interface elements, actions being performed, "
                "applications in use, and any significant changes or events. "
                "Focus on what the user is doing and what software they are interacting with."
            )
        
        start_time = time.time()
        
        try:
            # Extract frames
            print(f"Extracting {frame_count} frames from {video_path}...", file=sys.stderr)
            frame_paths = self.extract_frames_evenly(video_path, frame_count)
            
            # Analyze frames
            analysis_result = self.analyze_frames(frame_paths, prompt)
            
            end_time = time.time()
            processing_time = end_time - start_time
            
            return {
                "video_path": video_path,
                "frame_count": len(frame_paths),
                "analysis": analysis_result,
                "processing_time_seconds": round(processing_time, 2),
                "model_used": self.model_name,
                "device": self.device,
                "prompt": prompt
            }
            
        except Exception as e:
            return {
                "video_path": video_path,
                "error": str(e),
                "processing_time_seconds": time.time() - start_time,
                "model_used": self.model_name,
                "device": self.device
            }

def main():
    """CLI interface for Tarsier video analysis."""
    parser = argparse.ArgumentParser(description="Analyze video clips using Tarsier2-Recap-7B")
    parser.add_argument("video_path", help="Path to video file")
    parser.add_argument("--frames", type=int, default=16, help="Number of frames to extract (default: 16)")
    parser.add_argument("--prompt", help="Custom analysis prompt")
    parser.add_argument("--output", help="Output JSON file path")
    parser.add_argument("--model", default="omni-research/Tarsier2-Recap-7b", help="Model name")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video_path):
        print(f"Error: Video file not found: {args.video_path}", file=sys.stderr)
        sys.exit(1)
    
    try:
        analyzer = TarsierVideoAnalyzer(args.model)
        result = analyzer.analyze_video(args.video_path, args.frames, args.prompt)
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(result, f, indent=2)
            print(f"Results saved to {args.output}", file=sys.stderr)
        else:
            print(json.dumps(result, indent=2))
            
    except KeyboardInterrupt:
        print("\nAnalysis interrupted by user", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()