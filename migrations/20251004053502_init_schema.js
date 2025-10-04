// expense-backend/migrations/20251004053502_init_schema.js
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('expenses', (table) => {
    table.increments('id').primary();
    table.decimal('amount', 10, 2).notNullable();
    table.string('currency').notNullable();
    table.date('date').notNullable();
    table.text('description');
    table.string('category');
    table.string('merchant');
    table.string('receipt_url');
    table.enum('status', ['draft', 'submitted', 'approved', 'rejected']).defaultTo('draft');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('expenses');
};