const express = require('express')
const { configs } = require('./utils/configs')
const cors = require('cors');
const morgan = require('morgan');
const http= require('node:http');
const  setvices = require('./services');
const { pool } = require('./db/db');
const { metricsHandler } = require('./metrics/metrics');
const { applySecurity } = require('./middleware/security');
const { swaggerUi, swaggerSpec } = require('./docs/swagger');


class App {
    constructor({deps}){
        this. deps = deps;
        this.express = express();
        this.configs = configs;
        this.router = new express.Router();
        this.pool = pool
    }

    async init(){
        this.express.use(cors({origin: this.configs.origin, credentials: true}))
        applySecurity(this.express, {
          serviceName: 'ledger-service',
          sensitivePaths: ['/ledger']
        });
        this.express.use(express.json());
    this.express.get('/openapi.json', (req, res) => res.json(swaggerSpec));
    this.express.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
        this.express.get('/metrics', metricsHandler);
        this.express.use('/api', this.router);

           //load all dependencies
        if (this.deps) {
            await Promise.all(
                this.deps.map(async (dep) => {
                    try {
                        const res = await dep.method(...dep.args);
                        console.log(res);
                    } catch (error) {
                        console.error(`${dep.method.name} failed:`, error);
                        throw error;
                    }
                })
            );
        }

        this.server = http.createServer(this.express);
         setvices(this);
        this.listen();
    }

        configure(callback) {
        callback.call({
          ...this.express,
          route: this.router,
          settings: this.configs,
          pool: this.pool,
        });
      }


    listen(){
        this.server.listen(this.configs.port, () => console.log(`✅ Server running on port ${this.configs.port}`) )
    }

}

module.exports = App