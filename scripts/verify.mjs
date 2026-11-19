// Gestor Pro é um site estático. Este passo confere se os arquivos essenciais
// existem e têm sintaxe válida. É chamado por scripts/build.mjs (que gera a dist).
// Não altera nenhum arquivo.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const obrigatorios = [
  'index.html', 'app.js', 'supa.js', 'styles.css',
  'manifest.webmanifest', 'sw.js', 'admin.html', 'admin.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'netlify.toml'
];
const faltando = obrigatorios.filter(f => !existsSync(f));
if (faltando.length) {
  console.error('Arquivos ausentes:', faltando.join(', '));
  process.exit(1);
}

JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
for (const f of ['app.js', 'supa.js', 'sw.js', 'admin.js']) {
  execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
}
console.log('Gestor Pro: arquivos conferidos. Origem OK.');
