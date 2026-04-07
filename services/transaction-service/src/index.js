require('dotenv').config();
const App = require('./app');
const { initDB } = require('./db/db');
const { startRecoveryWorker } = require('./services/transaction/recovery.worker');

const deps = [{ method: initDB, args: [] }];

(async () => {
  const app = new App({ deps });
  await app.init();
  startRecoveryWorker({ pool: app.pool, settings: app.configs });
})();
