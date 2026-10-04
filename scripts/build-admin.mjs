import { mkdirSync, cpSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve('public/admin');
mkdirSync(resolve(source, 'vendor'), { recursive: true });
copyFileSync(resolve('node_modules/lucide/dist/umd/lucide.js'), resolve(source, 'vendor/lucide.js'));
copyFileSync(resolve('node_modules/lucide/LICENSE'), resolve(source, 'vendor/LUCIDE-LICENSE.txt'));
copyFileSync(resolve('node_modules/@fontsource-variable/inter/LICENSE'), resolve(source, 'vendor/INTER-LICENSE.txt'));
for (const subset of ['latin', 'latin-ext']) {
  copyFileSync(resolve(`node_modules/@fontsource-variable/inter/files/inter-${subset}-wght-normal.woff2`), resolve(source, `vendor/inter-${subset}.woff2`));
}
cpSync(source, resolve('dist/public/admin'), { recursive: true });
