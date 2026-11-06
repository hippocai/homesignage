const { db } = require('../../config/database');
const run = (sql, ...args) =>
  new Promise((resolve, reject) =>
    db.run(sql, args, function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    })
  );
const all = (sql, ...args) =>
  new Promise((resolve, reject) =>
    db.all(sql, args, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
const one = async (sql, ...args) => (await all(sql, ...args))[0];

const schema = `
CREATE TABLE IF NOT EXISTS briefing_sources (
 id TEXT PRIMARY KEY, config TEXT NOT NULL, due INTEGER DEFAULT 0, last_ok INTEGER, error TEXT, etag TEXT, modified TEXT
);
CREATE TABLE IF NOT EXISTS briefing_events (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, identity TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
 version INTEGER DEFAULT 1, edition INTEGER DEFAULT 1, payload TEXT NOT NULL, targets TEXT NOT NULL,
 starts INTEGER NOT NULL, expires INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS briefing_evidence (
 source_id TEXT NOT NULL, ref TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES briefing_events(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, article TEXT NOT NULL, PRIMARY KEY(source_id,ref)
);
CREATE TABLE IF NOT EXISTS briefing_history (
 id INTEGER PRIMARY KEY, event_id TEXT, version INTEGER, state TEXT, payload TEXT, targets TEXT, at INTEGER
);
CREATE TRIGGER IF NOT EXISTS briefing_event_history AFTER UPDATE ON briefing_events BEGIN
 INSERT INTO briefing_history(event_id,version,state,payload,targets,at) VALUES(OLD.id,OLD.version,OLD.state,OLD.payload,OLD.targets,OLD.updated);
END;
CREATE TABLE IF NOT EXISTS briefing_group_actions (
 id TEXT PRIMARY KEY, op TEXT, original TEXT, destination TEXT, source TEXT, ref TEXT, at INTEGER
);
CREATE TRIGGER IF NOT EXISTS briefing_merge AFTER INSERT ON briefing_group_actions WHEN NEW.op='merge' BEGIN
 UPDATE briefing_evidence SET event_id=NEW.destination WHERE event_id=NEW.original;
 UPDATE briefing_events SET state='withdrawn',version=version+1,updated=NEW.at WHERE id=NEW.original;
 UPDATE briefing_events SET version=version+1,updated=NEW.at WHERE id=NEW.destination;
END;
DROP TRIGGER IF EXISTS briefing_split;
CREATE TRIGGER briefing_split AFTER INSERT ON briefing_group_actions WHEN NEW.op='split' BEGIN
 INSERT INTO briefing_events(id,kind,identity,state,payload,targets,starts,expires,updated)
 SELECT NEW.destination,e.kind,NEW.destination,e.state,json_set(e.payload,'$.title',json_extract(a.article,'$.title'),'$.summary',json_extract(a.article,'$.title'),'$.speech',json_extract(a.article,'$.title'),'$.excerpt',json_extract(a.article,'$.excerpt'),'$.url',json_extract(a.article,'$.url'),'$.speak',0),e.targets,e.starts,e.expires,NEW.at
 FROM briefing_events e JOIN briefing_evidence a ON e.id=a.event_id WHERE e.id=NEW.original AND a.source_id=NEW.source AND a.ref=NEW.ref;
 UPDATE briefing_evidence SET event_id=NEW.destination WHERE source_id=NEW.source AND ref=NEW.ref AND event_id=NEW.original;
 UPDATE briefing_events SET version=version+1,updated=NEW.at WHERE id=NEW.original;
END;
CREATE TABLE IF NOT EXISTS briefing_claims (
 device TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, event TEXT NOT NULL REFERENCES briefing_events(id) ON DELETE CASCADE,
 edition INTEGER NOT NULL, claimed INTEGER NOT NULL, result TEXT DEFAULT 'claimed', PRIMARY KEY(device,event,edition)
);
CREATE INDEX IF NOT EXISTS briefing_claim_clock ON briefing_claims(device,claimed);
CREATE TABLE IF NOT EXISTS briefing_topic_cache (
 key TEXT PRIMARY KEY, matched INTEGER NOT NULL, decided INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pig_household (
 id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL DEFAULT '{}', plans TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO pig_household(id) VALUES(1);
CREATE TABLE IF NOT EXISTS pig_conversation (
 id TEXT PRIMARY KEY, created INTEGER NOT NULL, message TEXT NOT NULL, reply TEXT NOT NULL, next_plans TEXT NOT NULL
);
DROP TRIGGER IF EXISTS pig_save_turn;
CREATE TRIGGER pig_save_turn AFTER INSERT ON pig_conversation BEGIN
 UPDATE pig_household SET plans=NEW.next_plans, revision=revision+1 WHERE id=1 AND plans!=NEW.next_plans;
END;
CREATE TABLE IF NOT EXISTS pig_guests (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pig_chat_audit (
 id INTEGER PRIMARY KEY, attempt TEXT UNIQUE, created INTEGER NOT NULL, finished INTEGER, scope TEXT NOT NULL, actor TEXT NOT NULL,
 ip TEXT NOT NULL, turn_id TEXT NOT NULL, message TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS pig_audit_session ON pig_chat_audit(scope,id);
CREATE TABLE IF NOT EXISTS pig_impact (
 event TEXT PRIMARY KEY REFERENCES briefing_events(id) ON DELETE CASCADE, version INTEGER NOT NULL, context TEXT NOT NULL,
 speech TEXT NOT NULL, evidence TEXT NOT NULL, repeatable INTEGER NOT NULL, until_ms INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS pig_context_changed AFTER UPDATE ON pig_household
 WHEN OLD.profile!=NEW.profile OR OLD.plans!=NEW.plans BEGIN DELETE FROM pig_impact; END;
CREATE TABLE IF NOT EXISTS briefing_weather (city TEXT, day TEXT, high REAL NOT NULL, PRIMARY KEY(city,day));
CREATE TABLE IF NOT EXISTS briefing_usage (day TEXT, provider TEXT, calls INTEGER DEFAULT 0, tokens INTEGER DEFAULT 0, PRIMARY KEY(day,provider));
CREATE TABLE IF NOT EXISTS provider_credentials (provider TEXT PRIMARY KEY, api_key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS briefing_info (item TEXT PRIMARY KEY REFERENCES info_items(id) ON DELETE CASCADE, targets TEXT NOT NULL, edition INTEGER DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS one_companion_per_scene ON components(scene_id) WHERE type='companion';
`;
const exec = (sql) => new Promise((resolve, reject) => db.exec(sql, (e) => (e ? reject(e) : resolve())));
async function init() {
  await exec(schema);
  await exec(require('./ranking-schema'));
  if (!(await all('PRAGMA table_info(briefing_sources)')).some(c=>c.name==='topic_policy')) {
    await run('ALTER TABLE briefing_sources ADD COLUMN topic_policy TEXT');
  }
  const turns = await all('PRAGMA table_info(pig_conversation)');
  if (!turns.some(c=>c.name==='scope')) await run("ALTER TABLE pig_conversation ADD COLUMN scope TEXT NOT NULL DEFAULT 'admin'");
  if (!turns.some(c=>c.name==='actions')) await run("ALTER TABLE pig_conversation ADD COLUMN actions TEXT NOT NULL DEFAULT '[]'");
  if (!(await all('PRAGMA table_info(timed_reminders)')).some(c=>c.name==='start_date')) await run('ALTER TABLE timed_reminders ADD COLUMN start_date TEXT');
  await require('./record-schema')({one,exec});
  await run('CREATE INDEX IF NOT EXISTS pig_turn_scope ON pig_conversation(scope,created)');
  await exec(`CREATE TRIGGER IF NOT EXISTS pig_audit_turn AFTER INSERT ON pig_conversation BEGIN
    UPDATE pig_chat_audit SET status='ok',reply=NEW.reply,finished=CAST(strftime('%s','now') AS INTEGER)*1000
    WHERE turn_id=NEW.id AND scope=NEW.scope AND message=NEW.message AND status='pending';
  END`);
  await run("UPDATE pig_chat_audit SET status='failed', finished=?, error='服务重启，回复未完成' WHERE status='pending'",Date.now());
  await run(`INSERT INTO pig_chat_audit(created,finished,scope,actor,ip,turn_id,message,reply,status)
    SELECT created,created,scope,'历史后台','',id,message,reply,'ok' FROM pig_conversation c
    WHERE NOT EXISTS(SELECT 1 FROM pig_chat_audit a WHERE a.turn_id=c.id AND a.status='ok')`);
  const claims = await all('PRAGMA table_info(briefing_claims)');
  if (!claims.some(c => c.name === 'occurrence'))
    await run('ALTER TABLE briefing_claims ADD COLUMN occurrence INTEGER NOT NULL DEFAULT 1');
  for(const c of await all("SELECT id,scene_id,config FROM components WHERE type='companion' AND json_type(config,'$.reminders') IS NULL")) {
    // A shared scene has one policy. Prefer the first enabled binding with saved rules.
    const old=await one(`SELECT s.value FROM device_scenes ds JOIN settings s ON s.key='briefing.device.'||ds.device_id
      WHERE ds.scene_id=? ORDER BY ds.enabled DESC,ds.sort_order,ds.device_id LIMIT 1`,c.scene_id);
    const legacy=require('./rules').device(old?JSON.parse(old.value):{});
    await run("UPDATE components SET config=json_set(config,'$.reminders',json(?)) WHERE id=?",JSON.stringify(legacy),c.id);
  }
  await run(`UPDATE components SET config=json_remove(config,'$.reminders.latitude','$.reminders.longitude')
    WHERE type='companion' AND (json_type(config,'$.reminders.latitude') IS NOT NULL
      OR json_type(config,'$.reminders.longitude') IS NOT NULL)`);
  if(!claims.some(c=>c.name==='component')) await exec(`BEGIN IMMEDIATE;
    ALTER TABLE briefing_claims RENAME TO pig_previous_claims;
    CREATE TABLE briefing_claims(device TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,component TEXT NOT NULL,
      event TEXT NOT NULL REFERENCES briefing_events(id) ON DELETE CASCADE,edition INTEGER NOT NULL,claimed INTEGER NOT NULL,
      result TEXT DEFAULT 'claimed',occurrence INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(device,component,event,edition));
    INSERT INTO briefing_claims SELECT old.device,coalesce(pig.id,''),old.event,old.edition,old.claimed,old.result,old.occurrence
      FROM pig_previous_claims old LEFT JOIN (SELECT ds.device_id,c.id FROM device_scenes ds JOIN components c ON c.scene_id=ds.scene_id AND c.type='companion') pig ON pig.device_id=old.device;
    DROP TABLE pig_previous_claims;
    CREATE INDEX briefing_claim_clock ON briefing_claims(device,component,claimed); COMMIT;`);
  await run("UPDATE briefing_events SET state='published', version=version+1 WHERE state='review' AND kind IN ('news','ranking') AND expires>?", Date.now());
  await run(`UPDATE briefing_events SET payload=json_set(payload,'$.excerpt',coalesce(
    (SELECT json_extract(article,'$.excerpt') FROM briefing_evidence WHERE event_id=briefing_events.id LIMIT 1),''))
    WHERE kind IN ('news','ranking') AND expires>? AND json_type(payload,'$.excerpt') IS NULL`, Date.now());
  const cols = await all('PRAGMA table_info(info_items)');
  if (!cols.some((x) => x.name === 'companion_targets'))
    await run("ALTER TABLE info_items ADD COLUMN companion_targets TEXT NOT NULL DEFAULT '[]'");
  if (!cols.some((x) => x.name === 'companion_edition'))
    await run('ALTER TABLE info_items ADD COLUMN companion_edition INTEGER NOT NULL DEFAULT 1');
  await exec(`
    CREATE TRIGGER IF NOT EXISTS briefing_info_insert AFTER INSERT ON info_items WHEN NEW.companion_targets!='[]' BEGIN
      INSERT INTO briefing_info(item,targets,edition) VALUES(NEW.id,NEW.companion_targets,NEW.companion_edition);
    END;
    CREATE TRIGGER IF NOT EXISTS briefing_info_update AFTER UPDATE ON info_items WHEN NEW.companion_targets!='[]' OR OLD.companion_targets!='[]' BEGIN
      INSERT INTO briefing_info(item,targets,edition) VALUES(NEW.id,NEW.companion_targets,NEW.companion_edition)
      ON CONFLICT(item) DO UPDATE SET targets=excluded.targets,edition=excluded.edition;
      UPDATE briefing_events SET state='withdrawn',version=version+1 WHERE kind='family' AND id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS briefing_info_delete AFTER DELETE ON info_items BEGIN
      UPDATE briefing_events SET state='withdrawn',version=version+1 WHERE kind='family' AND id=OLD.id;
    END;
  `);
}
module.exports = { run, all, one, init };
