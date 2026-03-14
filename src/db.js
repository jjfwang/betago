import knex from 'knex';
import config from '../knexfile.cjs';

const environment = process.env.NODE_ENV ?? "development";
const db = knex(config[environment] ?? config.development);

export default db;
