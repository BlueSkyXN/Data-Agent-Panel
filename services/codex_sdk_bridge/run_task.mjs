import fs from 'node:fs/promises';
import { Codex } from '@openai/codex-sdk';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node run_task.mjs <handoff.md>');
  process.exit(2);
}
const prompt = await fs.readFile(file, 'utf8');
const codex = new Codex();
const thread = codex.startThread();
const result = await thread.run(prompt);
console.log(JSON.stringify({ threadId: thread.id, result }, null, 2));
