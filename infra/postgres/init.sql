-- Runs once when the database volume is first created.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Separate database for integration tests, so tests never touch development data.
CREATE DATABASE edm_test OWNER edm;
\connect edm_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
