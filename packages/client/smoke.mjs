import { tokensCss, radius, elevation } from './src/ui/tokens.ts';
const css = tokensCss();
const checks = ['--radius-sm','--radius-pill','--shadow-lg','--c-oxblood','--fs-display'];
const missing = checks.filter(k => !css.includes(k));
console.log('tokensCss length:', css.length);
console.log('radius.pill:', radius.pill, '| elevation.lg:', elevation.lg);
console.log(missing.length ? 'MISSING: '+missing.join(',') : 'all expected token vars present');
