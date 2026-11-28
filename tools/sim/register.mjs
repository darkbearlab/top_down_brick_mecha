// node --import ./tools/sim/register.mjs ...：先裝瀏覽器的假環境，再掛載入鉤子
import { register } from 'node:module';
import './shim.mjs';
// --headless：用無頭模式跑（src/headless.js：不建任何畫面物件，跟伺服器同一條路）；結果跟一般模式在統計上相近，但亂數順序不同所以不會一模一樣
if (process.argv.includes('--headless')) globalThis.__HEADLESS__ = true;
register('./hooks.mjs', import.meta.url);
