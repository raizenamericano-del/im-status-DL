import 'dotenv/config';
import { spawn } from 'node:child_process';
const worker = process.env.SERVICE_ROLE === 'worker';
const child = spawn(
  process.execPath,
  worker
    ? ['--import', 'tsx', 'worker/bootstrap.ts']
    : [
        'node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '0.0.0.0',
        '--port',
        process.env.PORT || '3000',
      ],
  { stdio: 'inherit' },
);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 1));
