import { execSync } from 'child_process';

const volumes = execSync('docker volume ls --quiet', { encoding: 'utf8' })
  .split('\n')
  .map(v => v.trim())
  .filter(Boolean);

console.log(`Checking ${volumes.length} volumes...`);

async function run() {
  for (const vol of volumes) {
    try {
      execSync('docker rm -f temp-pg', { stdio: 'ignore' });
    } catch {}

    try {
      execSync(`docker run -d --name temp-pg -v ${vol}:/var/lib/postgresql/data postgres:17-alpine`, { stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 2000));

      for (const db of ['erp_dev', 'erp', 'postgres']) {
        for (const user of ['erp', 'postgres']) {
          try {
            const res = execSync(`docker exec temp-pg psql -U ${user} -d ${db} -c "SELECT count(*) FROM leads;"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            if (res.includes('count')) {
              console.log(`FOUND LEADS TABLE IN VOLUME [${vol}] db [${db}]:\n${res}`);
            }
          } catch {}
        }
      }
    } catch (err) {
      // container start error
    }
  }

  try {
    execSync('docker rm -f temp-pg', { stdio: 'ignore' });
  } catch {}
}

run();
