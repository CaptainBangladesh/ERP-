import { execSync } from 'child_process';

const output = execSync('git fsck --lost-found', { encoding: 'utf8' });
const blobs = output
  .split('\n')
  .filter(line => line.includes('dangling blob'))
  .map(line => line.split(' ')[2].trim());

console.log(`Checking ${blobs.length} dangling blobs...`);

for (const blob of blobs) {
  try {
    const content = execSync(`git cat-file -p ${blob}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (content.includes('Import spreadsheet') || content.includes('Mailboxes') || content.includes('BoardSetupModal') || content.includes('activeGroup')) {
      console.log(`FOUND RICH LEADS PAGE IN BLOB: ${blob}`);
      console.log('Snippet:', content.slice(0, 300));
      process.exit(0);
    }
  } catch {}
}

console.log('No matching dangling blob found');
