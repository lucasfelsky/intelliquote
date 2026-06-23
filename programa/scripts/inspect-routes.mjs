import { app } from '../dist/src/app.js';

const list = [];

function decodeRegex(src) {
  if (src.includes('fast_slash')) return '';
  const m = src.match(/\^\\?\/((?:[^\\\/]|\\\/)+?)\\?\/\?\?\(\?=\\\/\|\$\)/);
  if (m) return '/' + m[1].replace(/\\\//g, '/');
  return '';
}

function dump(stack, prefix) {
  for (const layer of stack) {
    if (!layer) continue;
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      const fullPath = prefix + layer.route.path;
      console.log(methods.padEnd(6), fullPath);
      continue;
    }
    if (layer.handle && layer.handle.stack) {
      const sub = decodeRegex(layer.regexp.toString());
      dump(layer.handle.stack, prefix + sub);
    }
  }
}

console.log('=== ALL ROUTES ===');
dump(app._router.stack, '');
