// expense-backend/knexfile.js
module.exports = {
  client: 'mysql2', // Explicitly set to MySQL
  connection: {
  host: 'localhost',
  user: 'root',
  password: 'WWW.password@123',       // leave blank if you don’t have one
  database: 'expense_db',
  port: 3306,
},
  migrations: {
    tableName: 'knex_migrations',
  },
};