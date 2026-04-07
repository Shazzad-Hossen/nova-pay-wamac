require('dotenv').config({ override: process.env.DOTENV_OVERRIDE === 'true' });
const App = require('./app');
const { initDB } = require('./db/db');
const { createPayrollQueue } = require('./queue/queue');
const { startPayrollWorker } = require('./services/payroll/payroll.worker');

const deps = [{ method: initDB, args: [] }];

(async () => {
  const { queue, connection } = createPayrollQueue();
  const app = new App({ deps, payrollQueue: queue });
  await app.init();
  startPayrollWorker({ pool: app.pool, settings: app.configs, connection });
})();
