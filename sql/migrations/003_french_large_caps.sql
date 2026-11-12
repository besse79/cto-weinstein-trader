-- Manually curated French-listed large-cap research universe.
-- Source: Euronext SBF120 published index constituents (2026); mnemonics are
-- checked by Yahoo metadata only on the user's explicit per-batch import.
-- No automatic provider access, no changes to existing instrument rows.
INSERT INTO instruments(symbol,name,currency) VALUES
 ('TTE.PA','TotalEnergies','EUR'),
 ('MC.PA','LVMH','EUR'),
 ('AIR.PA','Airbus','EUR'),
 ('AI.PA','Air Liquide','EUR'),
 ('BNP.PA','BNP Paribas','EUR'),
 ('OR.PA','L''Oreal','EUR'),
 ('SAN.PA','Sanofi','EUR'),
 ('CS.PA','AXA','EUR'),
 ('DG.PA','Vinci','EUR'),
 ('GLE.PA','Societe Generale','EUR'),
 ('EL.PA','EssilorLuxottica','EUR'),
 ('RMS.PA','Hermes International','EUR'),
 ('ENGI.PA','Engie','EUR'),
 ('BN.PA','Danone','EUR'),
 ('SGO.PA','Saint-Gobain','EUR'),
 ('ORA.PA','Orange','EUR'),
 ('ML.PA','Michelin','EUR'),
 ('VIE.PA','Veolia','EUR'),
 ('PUB.PA','Publicis Groupe','EUR'),
 ('HO.PA','Thales','EUR')
ON CONFLICT(symbol) DO NOTHING;
