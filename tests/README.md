# Test Suite Documentation

This project has several types of tests with different requirements and purposes.

## Test Categories

### 1. Unit Tests (Mocked)
These tests use mocks to test logic in isolation without external dependencies.

```bash
npm test:unit
```

Files:
- `windowDetector.test.ts` - Tests window detection logic
- `memoryMonitor.test.ts` - Tests memory monitoring
- `desktopCapture-focused.test.ts` - Tests capture logic validation

### 2. Integration Tests with Real Dependencies

#### Real Screen Capture Tests
These tests actually capture your screen and **require macOS Screen Recording permission**.

```bash
npm run test:real
```

When you run these tests:
1. You'll be prompted to grant Screen Recording permission if not already granted
2. Go to System Preferences > Privacy & Security > Screen Recording
3. Enable permission for your terminal application
4. The tests will capture real screen content

#### Real Performance Tests
These tests measure actual performance with real video capture.

```bash
npm run test:real:perf
```

These tests:
- Capture screen for extended periods (15-30 seconds)
- Measure memory usage and performance metrics
- Test concurrent operations

#### Real Buffer Tests with FFmpeg
These tests use real FFmpeg to create and process test videos.

```bash
npm run test:real:buffer
```

Requirements:
- FFmpeg must be installed (`brew install ffmpeg`)
- Tests create real video files using test patterns

### 3. All Real Tests
Run all tests that use real system resources:

```bash
npm run test:all:real
```

## Running Tests

### Quick Unit Tests Only
For fast feedback during development:
```bash
npm run test:unit
```

### Full Test Suite
Including mocked integration tests:
```bash
npm test
```

### Watch Mode
For development:
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## macOS Permissions

For real capture tests to work, you need:

1. **Screen Recording Permission**
   - System Preferences > Privacy & Security > Screen Recording
   - Enable for your terminal app (Terminal.app, iTerm2, VS Code, etc.)

2. **FFmpeg Installation**
   ```bash
   brew install ffmpeg
   ```

## Test Philosophy

1. **Unit Tests**: Test logic and validation without external dependencies
2. **Integration Tests (Mocked)**: Test component integration with controlled inputs
3. **Integration Tests (Real)**: Test actual system integration with real capture

The real tests are essential for:
- Verifying actual screen capture works
- Testing performance with real video data
- Ensuring FFmpeg commands work correctly
- Validating the full capture → buffer → extract pipeline

## CI Considerations

For CI environments where screen recording isn't available:
- Run only unit tests and mocked integration tests
- Skip real capture tests
- Use the `npm run ci` command which excludes real tests

## Debugging Failed Tests

1. **Permission Issues**: Check System Preferences for Screen Recording permission
2. **FFmpeg Issues**: Ensure FFmpeg is installed and in PATH
3. **Timing Issues**: Some tests are timing-sensitive; run individually if flaky
4. **Resource Issues**: Close other applications if memory/CPU tests fail

## Writing New Tests

1. **Unit Tests**: Mock external dependencies, test logic only
2. **Integration Tests**: Use real dependencies when testing integration points
3. **Performance Tests**: Use consistent hardware/conditions for meaningful results