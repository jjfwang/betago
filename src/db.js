import knex from 'knex';
import config from '../knexfile.cjs';

const db = knex(config.development);

export default db;
