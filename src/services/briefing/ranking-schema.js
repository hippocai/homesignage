// A snapshot, its cards and the source headlines are committed by one SQLite statement.
module.exports = `
CREATE TABLE IF NOT EXISTS briefing_rank_snapshots(
 source TEXT PRIMARY KEY REFERENCES briefing_sources(id) ON DELETE CASCADE,
 signature TEXT NOT NULL, policy TEXT NOT NULL, at INTEGER NOT NULL, expires INTEGER NOT NULL,
 targets TEXT NOT NULL, groups_json TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS briefing_rank_snapshot AFTER INSERT ON briefing_rank_snapshots BEGIN
 UPDATE briefing_events SET expires=NEW.at
 WHERE kind='ranking' AND expires>NEW.at
 AND id IN (SELECT event_id FROM briefing_evidence WHERE source_id=NEW.source)
 AND NOT EXISTS (SELECT 1 FROM briefing_evidence b WHERE b.event_id=briefing_events.id AND b.source_id!=NEW.source)
 AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.groups_json));

 INSERT INTO briefing_events(id,kind,identity,state,payload,targets,starts,expires,updated)
 SELECT json_extract(value,'$.id'),'ranking','story:'||json_extract(value,'$.id'),'published',
 json_extract(value,'$.payload'),NEW.targets,NEW.at,NEW.expires,NEW.at FROM json_each(NEW.groups_json) WHERE true
 ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires=excluded.expires,
 version=briefing_events.version+(json_extract(excluded.payload,'$.revision')!=json_extract(briefing_events.payload,'$.revision')),
 edition=briefing_events.edition+(json_extract(excluded.payload,'$.revision')!=json_extract(briefing_events.payload,'$.revision')),
 updated=CASE WHEN json_extract(excluded.payload,'$.revision')!=json_extract(briefing_events.payload,'$.revision')
 THEN NEW.at ELSE briefing_events.updated END WHERE briefing_events.state='published';

 INSERT INTO briefing_evidence(source_id,ref,event_id,fingerprint,article)
 SELECT NEW.source,json_extract(a.value,'$.ref'),json_extract(g.value,'$.id'),json_extract(a.value,'$.title'),a.value
 FROM json_each(NEW.groups_json) g,json_each(g.value,'$.members') a WHERE true
 ON CONFLICT(source_id,ref) DO UPDATE SET article=excluded.article,event_id=excluded.event_id,fingerprint=excluded.fingerprint;
END;`;
