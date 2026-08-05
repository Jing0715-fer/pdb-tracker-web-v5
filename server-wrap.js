process.on('uncaughtException', (err) => { console.error('[FATAL] uncaughtException:', err); });
process.on('unhandledRejection', (err) => { console.error('[FATAL] unhandledRejection:', err); });
process.on('SIGTERM', () => { console.error('[FATAL] SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { console.error('[FATAL] SIGINT'); process.exit(0); });
require('./server.js');
