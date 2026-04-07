const { runPayroll, getPayrollRunById } = require('./payroll.entity');

function payroll() {
  this.route.post('/payroll/run', runPayroll(this));
  this.route.get('/payroll/run/:id', getPayrollRunById(this));
}

module.exports = payroll;
