import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** The six tables in schema pi. Measures and filter columns are not stored here. */
export const pi = pgSchema('pi');

export const customer = pi.table('customer', {
  customerId: integer('customer_id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const users = pi.table(
  'users',
  {
    userId: integer('user_id').primaryKey().generatedAlwaysAsIdentity(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customer.customerId),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [uniqueIndex('ux_users_username').on(sql`lower(${table.username})`)],
);

export const userSession = pi.table('user_session', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.userId, { onDelete: 'cascade' }),
  createdDateTime: timestamp('created_date_time', { withTimezone: true }).notNull().defaultNow(),
  expiresDateTime: timestamp('expires_date_time', { withTimezone: true }).notNull(),
});

export const factSavings = pi.table(
  'fact_savings',
  {
    customerId: integer('customer_id')
      .notNull()
      .references(() => customer.customerId),
    month: char('month', { length: 7 }).notNull(),
    market: text('market').notNull(),
    programType: text('program_type').notNull(),
    claimsDenied: integer('claims_denied').notNull(),
    grossSavings: numeric('gross_savings', { precision: 14, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [
    index('ix_fact_savings_month').on(table.customerId, table.month),
    index('ix_fact_savings_filters').on(table.customerId, table.market, table.programType),
  ],
);

export const dataset = pi.table(
  'dataset',
  {
    datasetId: integer('dataset_id').primaryKey().generatedAlwaysAsIdentity(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customer.customerId),
    name: text('name').notNull(),
    description: text('description'),
    datasetStatusId: integer('dataset_status_id').notNull().default(1),
    copiedFromDatasetId: integer('copied_from_dataset_id').references((): AnyPgColumn => dataset.datasetId, {
      onDelete: 'set null',
    }),
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.userId),
    readpolicyId: integer('readpolicy_id').notNull().default(1),
    createdUserId: integer('created_user_id')
      .notNull()
      .references(() => users.userId),
    lastModifiedUserId: integer('last_modified_user_id')
      .notNull()
      .references(() => users.userId),
    createdDateTime: timestamp('created_date_time', { withTimezone: true }).notNull().defaultNow(),
    lastModifiedDateTime: timestamp('last_modified_date_time', { withTimezone: true }).notNull().defaultNow(),
    lastAccessedDateTime: timestamp('last_accessed_date_time', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ux_dataset_owner_name')
      .on(table.customerId, table.ownerUserId, sql`lower(${table.name})`)
      .where(sql`${table.datasetStatusId} = 1`),
  ],
);

export const datasetFilter = pi.table(
  'dataset_filter',
  {
    datasetId: integer('dataset_id')
      .notNull()
      .references(() => dataset.datasetId, { onDelete: 'cascade' }),
    attributeKey: text('attribute_key').notNull(),
    value: text('value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.datasetId, table.attributeKey, table.value] })],
);
