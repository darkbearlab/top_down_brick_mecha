// 無頭模式的開關：伺服器 / 量記憶體的腳本在載入任何遊戲模組之前先 import 這個檔案（它沒有 import，一定最先跑）
// 之後 core.js 的 HEADLESS = true：只跑遊戲規則，不建任何畫面物件（見 core.js）
globalThis.__HEADLESS__ = true;
