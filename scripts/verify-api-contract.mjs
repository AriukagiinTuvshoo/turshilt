import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const backendDir = path.join(repoRoot, 'backend');
const winPython = path.join(backendDir, '.venv', 'Scripts', 'python.exe');
const nixPython = path.join(backendDir, '.venv', 'bin', 'python');
const pythonBin = fs.existsSync(winPython)
  ? winPython
  : fs.existsSync(nixPython)
    ? nixPython
    : 'python3';

execFileSync(pythonBin, ['scripts/verify_api_contract.py'], {
  cwd: backendDir,
  stdio: 'inherit',
  env: { ...process.env, PYTHONPATH: backendDir },
});
