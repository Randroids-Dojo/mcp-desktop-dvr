# Troubleshooting Capture Error - Progress Report

## Issue
Failed to start capture: Error: Could not start recording within 5 seconds

## Root Cause Identified
The error is due to macOS permissions for screen recording. The aperture library is failing with:
```
Error Domain=AVFoundationErrorDomain Code=-11805 "Cannot Record"
```

## Analysis Completed

1. **Code Review**: The desktopCapture.ts implementation is correct. The error handling at line 158-166 attempts to handle timeout errors.

2. **Permission Issue**: The terminal needs Screen Recording permission in macOS System Preferences.

3. **Test Results**: Created test-aperture.js which confirmed the permission error.

## Next Steps After Restart

1. **Grant Permissions**:
   - Go to System Preferences > Privacy & Security > Screen Recording
   - Enable permission for Terminal (or your terminal app)

2. **Test Recording**:
   ```bash
   cd /Users/randroid/Dev/AI/MCPs/mcp-desktop-dvr
   node test-aperture.js
   ```

3. **Update Error Handling**: Consider improving the error message in desktopCapture.ts to specifically mention screen recording permissions when AVFoundationErrorDomain Code=-11805 is encountered.

4. **Clean Up**:
   - Remove test-aperture.js after successful test
   - Update TodoWrite items 2-4 as completed

## Todo Status
- ✅ Investigate capture error: 'Could not start recording within 5 seconds' 
- ✅ Check aperture-node implementation and timeout settings
- ✅ Verify macOS permissions for screen recording (FOUND THE ISSUE)
- ⏳ Test and fix the capture initialization (pending permission grant)

## Code Changes Needed
After permissions are granted, consider adding better error handling:

```typescript
// In startSegmentRecording method around line 158
try {
  await recorder.startRecording(recordingOptions);
} catch (error: any) {
  // Check for macOS permission error
  if (error?.message?.includes('AVFoundationErrorDomain') && error?.message?.includes('-11805')) {
    throw new Error('Screen Recording permission required. Please enable in System Preferences > Privacy & Security > Screen Recording');
  }
  // Existing timeout handling...
  if (error?.code === 'RECORDER_TIMEOUT' && this.checkApertureRunning()) {
    // Recording started despite timeout, continue normally
  } else {
    throw error;
  }
}
```