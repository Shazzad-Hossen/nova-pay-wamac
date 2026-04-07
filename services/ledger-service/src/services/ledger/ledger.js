const { createEntry, checkEntry, getBalance, getTransaction, checkAuditChain } = require("./ledger.entity");



function ledger(){
    
    this.route.post('/ledger',createEntry(this));
    this.route.get('/ledger/check',checkEntry(this));
    this.route.get('/ledger/audit/check', checkAuditChain(this));
    this.route.get('/ledger/balance/:accountId',getBalance(this));
    this.route.get('/ledger/transaction/:id',getTransaction(this));
    

}

module.exports=ledger;