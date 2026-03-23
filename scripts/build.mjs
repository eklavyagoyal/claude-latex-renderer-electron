import { mkdir, readFile, rm, writeFile, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const vendorDir = path.join(distDir, 'vendor');
const mathJaxFontDir = path.join(vendorDir, 'output', 'fonts', 'mathjax-newcm');

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(vendorDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
    outfile: path.join(distDir, 'main.js'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    sourcemap: 'inline',
    legalComments: 'none',
  });

  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'src', 'injected.ts')],
    outfile: path.join(distDir, 'injected.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    sourcemap: 'inline',
    legalComments: 'none',
  });

  await mkdir(mathJaxFontDir, { recursive: true });

  await copyFile(
    path.join(
      projectRoot,
      'node_modules',
      '@mathjax',
      'mathjax-newcm-font',
      'tex-mml-svg-mathjax-newcm.js'
    ),
    path.join(vendorDir, 'mathjax.js')
  );

  await copyFile(
    path.join(projectRoot, 'node_modules', '@mathjax', 'mathjax-newcm-font', 'svg.js'),
    path.join(mathJaxFontDir, 'svg.js')
  );

  await cp(
    path.join(projectRoot, 'node_modules', '@mathjax', 'mathjax-newcm-font', 'svg'),
    path.join(mathJaxFontDir, 'svg'),
    { recursive: true }
  );

  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8')
  );

  packageJson.main = 'dist/main.js';
  packageJson.scripts = {
    build: 'node scripts/build.mjs',
    start: 'npm run build && electron .',
    dev: 'npm run start',
  };
  packageJson.description = 'Desktop wrapper that injects LaTeX rendering into Claude.';
  packageJson.license = 'MIT';
  packageJson.private = true;

  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n'
  );
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
