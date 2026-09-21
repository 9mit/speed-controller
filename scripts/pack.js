/**
 * OTT SPEED PLAYBACK - Cross-Platform Extension Packager
 * Generates clean store-ready ZIP archive without external dependencies.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version || '2.3.0';
const zipName = `ott-speed-playback-v${version}.zip`;
const zipPath = path.join(rootDir, zipName);

const includeFiles = [
    'manifest.json',
    'background.js',
    'content.js',
    'main_world.js',
    'styles.css',
    'popup.html',
    'popup.css',
    'popup.js',
    'options.html',
    'options.css',
    'options.js',
    'icon16.png',
    'icon48.png',
    'icon128.png',
    'LICENSE',
    'README.md',
    'PRIVACY.md'
];

console.log(`Packaging OTT SPEED PLAYBACK v${version} into ${zipName}...`);

for (const file of includeFiles) {
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) {
        console.error(`Error: Required file missing: ${file}`);
        process.exit(1);
    }
}

try {
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }

    if (process.platform === 'win32') {
        const fileList = includeFiles.map(f => `"${f}"`).join(', ');
        const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path ${fileList} -DestinationPath '${zipName}' -Force"`;
        execSync(psCommand, { cwd: rootDir, stdio: 'inherit' });
    } else {
        const fileList = includeFiles.join(' ');
        execSync(`zip -q -9 "${zipName}" ${fileList}`, { cwd: rootDir, stdio: 'inherit' });
    }

    const stats = fs.statSync(zipPath);
    console.log(`\x1b[32m✔ Package created successfully: ${zipName} (${(stats.size / 1024).toFixed(1)} KB)\x1b[0m`);
} catch (err) {
    console.error('Failed to create zip package:', err.message);
    process.exit(1);
}
