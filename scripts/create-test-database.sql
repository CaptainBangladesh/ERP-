-- Runs once, when the PostgreSQL container initialises its data volume.
--
-- Creates the database the test harness truncates between tests, kept separate from the
-- development database so running the suite can never destroy work in progress.
--
-- This creates a DATABASE, not data. The application still seeds nothing: migrations create
-- schema only, and every row in the running system is one a user typed.
CREATE DATABASE erp_test OWNER erp;
