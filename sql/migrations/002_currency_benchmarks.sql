-- Idempotent market benchmarks for existing PostgreSQL volumes.
-- EXSA is traded in EUR on Xetra; SPY is traded in USD.
INSERT INTO instruments(symbol,name,currency) VALUES
 ('EXSA.DE','iShares STOXX Europe 600 ETF','EUR'),
 ('SPY','S&P 500 Benchmark ETF','USD')
ON CONFLICT(symbol) DO NOTHING;
