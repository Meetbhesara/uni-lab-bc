const express = require('express');
const router = express.Router();
const employeeExpenseController = require('../controllers/employeeExpenseController');
const { employeeAuth } = require('../middlewares/employeeAuth');

// Employee specific routes
router.post('/', employeeAuth, employeeExpenseController.addExpense);
router.get('/my-expenses', employeeAuth, employeeExpenseController.getExpensesForEmployee);

// If an admin needs all: 
router.get('/all', employeeExpenseController.getAllExpenses); // Optionally wrap in admin auth
router.get('/admin/:employeeId', employeeExpenseController.getExpensesByEmployee);
router.post('/admin/add-expense', employeeExpenseController.adminAddExpense);

module.exports = router;
