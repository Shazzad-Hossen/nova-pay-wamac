require('dotenv').config();
const App = require('./app');
const { initDB } = require('./db/db');


const deps = [{ method: initDB, args: [] }];

(async () => {
  const app = new App({ deps });
  await app.init();
})();
