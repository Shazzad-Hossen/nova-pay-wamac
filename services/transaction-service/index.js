require('dotenv').config();
const App = require('./src/app');
const { initDB } = require('./src/db/db');

const deps = [{ method: initDB, args: [] }];

(async () => {
	const app = new App({ deps });
	await app.init();
})();
