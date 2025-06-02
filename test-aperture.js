import { recorder } from 'aperture';

console.log('Testing aperture recorder...');

async function testRecording() {
  try {
    console.log('Starting recording...');
    await recorder.startRecording({
      fps: 30,
      videoCodec: 'h264',
      highlightClicks: true,
      showCursor: true
    });
    
    console.log('Recording started successfully!');
    
    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Stopping recording...');
    const filePath = await recorder.stopRecording();
    console.log('Recording saved to:', filePath);
    
  } catch (error) {
    console.error('Error:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
  }
}

testRecording();