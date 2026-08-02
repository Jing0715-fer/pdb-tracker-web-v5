const cluster = require('cluster');
const numCPUs = 2;

if (cluster.isPrimary && numCPUs > 1) {
  console.log(`API Primary ${process.pid} is running`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    console.error(`API Worker ${worker.process.pid} died (code ${code}). Restarting...`);
    cluster.fork();
  });
} else {
  process.on('uncaughtException', (err) => {
    console.error(`[FATAL] API Worker ${process.pid} uncaughtException:`, err);
  });
  process.on('unhandledRejection', (err) => {
    console.error(`[FATAL] API Worker ${process.pid} unhandledRejection:`, err);
  });
  require('./server.js');
}
