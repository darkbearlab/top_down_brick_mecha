// node --import ./tools/sim/register.mjs ...：先裝瀏覽器的假環境，再掛載入鉤子
import { register } from 'node:module';
import './shim.mjs';
register('./hooks.mjs', import.meta.url);
