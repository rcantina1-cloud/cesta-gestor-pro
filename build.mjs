
// Gestor Pro: gera a pasta "dist" (a pasta publicada pelo Netlify).
// Site estático: confere os arquivos, copia para dist/ e valida o resultado.
// Não altera nenhum arquivo de origem.
import { existsSync, mkdirSync, rmSync, cpSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(raiz);
const DIST = 'dist';

// 1) Conferência dos arquivos de origem (sintaxe, manifest, ícones)
execFileSync(process.execPath, ['scripts/verify.mjs'], { stdio: 'inherit' });

// 2) Recria dist do zero
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 3) Copia tudo o que o site precisa para rodar
const arquivos = [
  'index.html', 'app.js', 'supa.js', 'styles.css',
  'sw.js', 'manifest.webmanifest', 'admin.html', 'admin.js'
];
const pastas = ['icons'];
for (const f of arquivos) cpSync(f, join(DIST, f));
for (const p of pastas) cpSync(p, join(DIST, p), { recursive: true });

// 4) Valida o resultado: dist existe, não está vazia e tem o essencial
const esperados = [...arquivos, 'icons/icon-192.png', 'icons/icon-512.png'];
const faltando = esperados.filter(f => !existsSync(join(DIST, f)) || statSync(join(DIST, f)).size === 0);
if (!existsSync(DIST) || faltando.length) {
  console.error('ERRO: dist incompleta. Faltando/vazio:', faltando.join(', '));
  process.exit(1);
}
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
for (const ref of ['styles.css', 'app.js', 'manifest.webmanifest']) {
  if (!html.includes(ref)) { console.error('ERRO: index.html não referencia ' + ref); process.exit(1); }
}
for (const f of ['app.js', 'supa.js', 'sw.js', 'admin.js']) {
  execFileSync(process.execPath, ['--check', join(DIST, f)], { stdio: 'inherit' });
}

const lista = (d, p = '') => readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? lista(join(d, e.name), p + e.name + '/') : [p + e.name]);
console.log('Gestor Pro: pasta "' + DIST + '" gerada com ' + lista(DIST).length + ' arquivos:');
for (const f of lista(DIST)) console.log('  - ' + f);
