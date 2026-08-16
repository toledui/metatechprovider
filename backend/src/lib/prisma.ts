import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";
import "../config/env.js";

function required(name: string): string {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const adapter = new PrismaMariaDb({
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  database: required("DATABASE_NAME"),
  connectionLimit: Number(process.env.DATABASE_CONNECTION_LIMIT ?? "5"),
});

export const prisma = new PrismaClient({ adapter });
