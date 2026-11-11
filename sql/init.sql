CREATE TABLE IF NOT EXISTS instruments (
  id BIGSERIAL PRIMARY KEY, symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'EUR'
);
CREATE TABLE IF NOT EXISTS candles (
  instrument_id BIGINT NOT NULL REFERENCES instruments(id),
  day DATE NOT NULL, open NUMERIC(18,6) NOT NULL, high NUMERIC(18,6) NOT NULL,
  low NUMERIC(18,6) NOT NULL, close NUMERIC(18,6) NOT NULL,
  volume BIGINT NOT NULL, PRIMARY KEY(instrument_id,day),
  CHECK (low>0 AND high>=GREATEST(open,close,low) AND low<=LEAST(open,close) AND close>0 AND volume>=0)
);
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY, instrument_id BIGINT NOT NULL REFERENCES instruments(id),
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')), qty NUMERIC(18,6) NOT NULL CHECK(qty>0),
  price NUMERIC(18,6) NOT NULL CHECK(price>0),
  fee NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(fee>=0),
  stop NUMERIC(18,6), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode TEXT NOT NULL DEFAULT 'PAPER' CHECK (mode='PAPER')
);
CREATE TABLE IF NOT EXISTS risk_stops (
  instrument_id BIGINT PRIMARY KEY REFERENCES instruments(id),
  initial_stop NUMERIC(18,6) NOT NULL,
  current_stop NUMERIC(18,6) NOT NULL,
  entry_price NUMERIC(18,6) NOT NULL,
  peak_price NUMERIC(18,6) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO settings(key,value) VALUES ('initial_cash','500'),('account_type','CTO'),('paper_only','true') ON CONFLICT DO NOTHING;
INSERT INTO instruments(symbol,name,currency) VALUES
 ('AC.PA','Accor','EUR'),('SU.PA','Schneider Electric','EUR'),
 ('LR.PA','Legrand','EUR'),('SAF.PA','Safran','EUR')
 ON CONFLICT DO NOTHING;
