import { DesktopDVRServer } from './server.js';

async function main() {
  const server = new DesktopDVRServer(true); // Enable optimized buffer with memory management
  await server.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
