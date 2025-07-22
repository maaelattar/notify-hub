import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load environment variables
config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://notifyhub_user:notifyhub_password@localhost:5432/notifyhub',
  entities: [
    process.env.NODE_ENV === 'production' 
      ? 'dist/**/*.entity.js'
      : 'src/**/*.entity.ts'
  ],
  migrations: [
    process.env.NODE_ENV === 'production'
      ? 'dist/migrations/*.js'
      : 'src/migrations/*.ts'
  ],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
