const { healthCheck } = require("./health.entiry");



function health(){
    
    this.route.get('/health',healthCheck(this));

}

module.exports=health;