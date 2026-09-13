// Preload entry for `node --test --import ./scripts/test-setup.mjs`: installs
// the Vue SFC loader and browser globals in every test-file process.
import { registerVueLoader, setupDom } from './test-env.mjs';

registerVueLoader();
setupDom();
