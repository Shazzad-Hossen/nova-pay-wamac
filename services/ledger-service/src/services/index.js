const health = require("./health/health");
const ledger = require("./ledger/ledger");

module.exports= (app) => {

    app.configure(health);
    app.configure(ledger);

  };